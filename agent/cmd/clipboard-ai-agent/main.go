package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/clipboard-ai/agent/internal/automation"
	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
	"github.com/clipboard-ai/agent/internal/guard"
	"github.com/clipboard-ai/agent/internal/ipc"
	"github.com/clipboard-ai/agent/internal/notify"
	"github.com/clipboard-ai/agent/internal/rules"
)

// version is stamped at build time via
// `-ldflags "-X main.version=<tag>"` (see install.sh and the release workflow).
// "dev" marks an unstamped local build.
var version = "dev"

type runtimeState struct {
	mu          sync.RWMutex
	cfg         *config.Config
	rulesEngine *rules.Engine
}

func (s *runtimeState) snapshot() (*config.Config, *rules.Engine) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg, s.rulesEngine
}

func (s *runtimeState) swap(cfg *config.Config, rulesEngine *rules.Engine) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	s.rulesEngine = rulesEngine
}

func main() {
	versionFlag := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println("clipboard-ai-agent", version)
		os.Exit(0)
	}

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Set up structured logging
	level := parseLogLevel(cfg.Settings.LogLevel)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	logger.Info("agent starting",
		"version", version,
		"provider.type", cfg.Provider.Type,
		"provider.model", cfg.Provider.Model,
		"safe_mode", cfg.Settings.SafeMode,
		"http_enabled", cfg.Settings.HTTPEnabled,
	)

	// Set up context with cancellation (before handler so closure can capture ctx)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create rules engine
	rulesEngine, err := rules.NewEngine(cfg.Actions)
	if err != nil {
		logger.Error("failed to create rules engine", "error", err)
		os.Exit(1)
	}
	state := &runtimeState{cfg: cfg, rulesEngine: rulesEngine}
	controller := automation.NewController(time.Duration(cfg.Settings.ClipboardDedupeWindow) * time.Millisecond)

	// Track in-flight action goroutines so shutdown can wait for them to finish
	// (their deferred temp-file cleanup must run, and subprocesses must drain).
	var actionWG sync.WaitGroup

	// Bound concurrent action subprocesses across all clipboard changes. nil
	// (max_concurrent_actions = 0) means unlimited.
	var actionSem chan struct{}
	if cfg.Settings.MaxConcurrentActions > 0 {
		actionSem = make(chan struct{}, cfg.Settings.MaxConcurrentActions)
	}

	// Create clipboard handler
	handler := func(content clipboard.Content) {
		cfg, rulesEngine := state.snapshot()
		logFields := []any{
			"type", content.Type,
			"length_chars", len([]rune(content.Text)),
		}
		if content.Type == clipboard.ContentTypeImage {
			logFields = append(logFields, "image_bytes", len(content.Image))
		}
		logger.Info("clipboard changed", logFields...)
		now := time.Now()

		if controller.ShouldSkipClipboard(content.Signature, now) {
			logger.Debug("skipped duplicate clipboard content",
				"dedupe_window_ms", cfg.Settings.ClipboardDedupeWindow,
			)
			return
		}

		// Evaluate rules
		matches := rulesEngine.Evaluate(content)
		for _, match := range matches {
			guardHit := false
			// Scan the RTF payload too: a styled paste can carry a secret that
			// isn't in the plain-text representation.
			guardInput := content.Text
			if content.RTF != "" {
				guardInput += "\n" + content.RTF
			}
			if guardInput != "" && cfg.Settings.SensitiveGuard != "off" {
				findings := guard.Scan(guardInput)
				if len(findings) > 0 {
					guardHit = true
					logger.Warn("sensitive clipboard content detected",
						"action", match.ActionName,
						"mode", cfg.Settings.SensitiveGuard,
						"findings", len(findings),
					)
					if cfg.Settings.Notifications {
						message := "clipboard looks like it contains a secret"
						if cfg.Settings.SensitiveGuard == "block" {
							message += " — action skipped"
						}
						notify.SendWithSubtitle("clipboard-ai", "Sensitive content", message)
					}
					if cfg.Settings.SensitiveGuard == "block" {
						continue
					}
				}
			}

			cooldown := time.Duration(match.Config.CooldownMs) * time.Millisecond
			if !controller.AllowAction(match.ActionName, cooldown, now) {
				logger.Debug("skipped action due to cooldown",
					"action", match.ActionName,
					"cooldown_ms", match.Config.CooldownMs,
				)
				continue
			}

			logger.Info("action triggered", "action", match.ActionName)

			actionWG.Add(1)
			go func(actionName string, actionCfg config.ActionConfig, content clipboard.Content, sensitiveGuardHit bool) {
				defer actionWG.Done()

				// Acquire a concurrency slot (or bail if shutting down).
				release, ok := acquireActionSlot(ctx, actionSem)
				if !ok {
					return
				}
				defer release()

				opts := executor.Options{
					Trigger:          actionCfg.Trigger,
					ModelOverride:    actionCfg.Model,
					EndpointOverride: actionCfg.Endpoint,
				}
				if sensitiveGuardHit {
					opts.SensitiveGuardHit = true
				}
				if actionCfg.TimeoutMs > 0 {
					opts.Timeout = time.Duration(actionCfg.TimeoutMs) * time.Millisecond
				}
				opts.InputType = string(content.Type)
				if content.RTF != "" {
					opts.InputRTF = content.RTF
				}

				if content.Type == clipboard.ContentTypeImage && len(content.Image) > 0 {
					path, err := executor.WriteTempImage(content.Image)
					if err != nil {
						logger.Error("failed to write image temp file", "action", actionName, "error", err)
						return
					}
					defer os.Remove(path)
					opts.InputImagePath = path
					opts.InputImageMime = content.ImageMime
				}

				attempts := actionCfg.RetryCount + 1
				backoff := time.Duration(actionCfg.RetryBackoffMs) * time.Millisecond
				var result executor.Result

				for attempt := 1; attempt <= attempts; attempt++ {
					result = executor.ExecuteWithOptions(ctx, actionName, content.Text, opts)
					if result.Error == nil {
						break
					}

					if attempt == attempts {
						break
					}

					logger.Warn("action attempt failed",
						"action", actionName,
						"attempt", attempt,
						"attempts_total", attempts,
						"error", result.Error,
						"retry_backoff", backoff.String(),
					)

					if backoff <= 0 {
						continue
					}

					select {
					case <-ctx.Done():
						return
					case <-time.After(backoff):
					}
				}

				if result.Error != nil {
					logger.Error("action failed", "action", actionName, "error", result.Error)
					if cfg.Settings.Notifications {
						if strings.Contains(result.Output, "safe mode") {
							notify.SendWithSubtitle("clipboard-ai", "Safe mode", actionName+" blocked — cloud provider not allowed")
						} else {
							notify.SendWithSubtitle("clipboard-ai", actionName+" failed", result.Error.Error())
						}
					}
					return
				}
				logger.Info("action completed",
					"action", actionName,
					"elapsed_ms", result.Elapsed.Milliseconds(),
				)
				if cfg.Settings.Notifications {
					output := result.Output
					if len(output) > 200 {
						output = output[:200] + "..."
					}
					notify.SendWithSubtitle("clipboard-ai", actionName, output)
				}
			}(match.ActionName, match.Config, content, guardHit)
		}
	}

	// Create clipboard monitor
	monitor := clipboard.NewMonitor(cfg.Settings.PollInterval, handler)

	// Create IPC server
	socketPath := config.GetSocketPath()
	server := ipc.NewServer(socketPath, monitor, cfg, version)
	configPath := config.ConfigPath()

	reloadConfig := func(reason string) {
		previousCfg, _ := state.snapshot()
		nextCfg, err := config.ReloadFromPath(configPath, previousCfg)
		if err != nil {
			logger.Error("config reload rejected", "reason", reason, "error", err)
			if previousCfg.Settings.Notifications {
				notify.SendWithSubtitle("clipboard-ai", "Config reload failed", err.Error())
			}
			return
		}

		nextRulesEngine, err := rules.NewEngine(nextCfg.Actions)
		if err != nil {
			logger.Error("config reload rejected", "reason", reason, "error", err)
			if previousCfg.Settings.Notifications {
				notify.SendWithSubtitle("clipboard-ai", "Config reload failed", err.Error())
			}
			return
		}

		logRestartRequiredSettings(logger, previousCfg, nextCfg)
		state.swap(nextCfg, nextRulesEngine)
		server.SetConfig(nextCfg)
		logger.Info("config reloaded",
			"reason", reason,
			"provider.type", nextCfg.Provider.Type,
			"provider.model", nextCfg.Provider.Model,
			"actions", len(nextCfg.Actions),
		)
	}

	// Start optional local HTTP server
	if cfg.Settings.HTTPEnabled {
		if cfg.Settings.HTTPAllowRemote {
			logger.Warn("http server binding a non-loopback address (http_allow_remote=true); the API is reachable from the network",
				"address", cfg.Settings.HTTPAddress,
			)
		}
		httpServer := ipc.NewHTTPServer(cfg.Settings.HTTPAddress, server)
		go func() {
			logger.Info("http server listening", "address", cfg.Settings.HTTPAddress)
			if err := httpServer.Start(ctx); err != nil && ctx.Err() == nil {
				logger.Error("http server error", "error", err)
			}
		}()
	}

	// Handle shutdown signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	reloadCh := make(chan string, 4)
	go watchConfigFile(ctx, configPath, reloadCh, logger)

	// Start IPC server in goroutine
	go func() {
		logger.Info("ipc server listening", "socket_path", socketPath)
		if err := server.Start(ctx); err != nil && ctx.Err() == nil {
			logger.Error("ipc server error", "error", err)
		}
	}()

	// Start clipboard monitor in goroutine
	go func() {
		logger.Info("clipboard monitor started", "poll_interval_ms", cfg.Settings.PollInterval)
		if err := monitor.Start(ctx); err != nil && ctx.Err() == nil {
			logger.Error("clipboard monitor error", "error", err)
		}
	}()

	// Process config reloads in a dedicated goroutine. A single consumer makes
	// reloads single-flighted, and keeps the signal loop below responsive to
	// shutdown even while a reload is in progress.
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case reason := <-reloadCh:
				reloadConfig(reason)
			}
		}
	}()

	for {
		sig := <-sigCh
		if sig == syscall.SIGHUP {
			select {
			case reloadCh <- "SIGHUP":
			default:
				logger.Warn("config reload skipped because reload queue is full")
			}
			continue
		}
		logger.Info("shutdown signal received", "signal", sig.String())
		cancel()
		waitForActions(&actionWG, logger)
		logger.Info("agent stopped")
		return
	}
}

// acquireActionSlot reserves a slot in the concurrency semaphore, returning a
// release function. A nil semaphore means unlimited. ok is false if ctx is
// cancelled before a slot frees up.
func acquireActionSlot(ctx context.Context, sem chan struct{}) (release func(), ok bool) {
	if sem == nil {
		return func() {}, true
	}
	select {
	case sem <- struct{}{}:
		return func() { <-sem }, true
	case <-ctx.Done():
		return func() {}, false
	}
}

// waitForActions blocks until all in-flight action goroutines finish (so their
// deferred temp-file cleanup runs), bounded by a timeout so a hung action can't
// wedge shutdown forever.
func waitForActions(wg *sync.WaitGroup, logger *slog.Logger) {
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		logger.Warn("timed out waiting for in-flight actions to finish")
	}
}

func parseLogLevel(level string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func watchConfigFile(ctx context.Context, configPath string, reloadCh chan<- string, logger *slog.Logger) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		logger.Error("failed to create config watcher", "error", err)
		return
	}
	defer watcher.Close()

	dir := filepath.Dir(configPath)
	if err := watcher.Add(dir); err != nil {
		logger.Error("failed to watch config directory", "path", dir, "error", err)
		return
	}

	var debounce *time.Timer
	var debounceC <-chan time.Time
	scheduleReload := func() {
		if debounce == nil {
			debounce = time.NewTimer(200 * time.Millisecond)
			debounceC = debounce.C
			return
		}
		if !debounce.Stop() {
			select {
			case <-debounce.C:
			default:
			}
		}
		debounce.Reset(200 * time.Millisecond)
		debounceC = debounce.C
	}

	for {
		select {
		case <-ctx.Done():
			if debounce != nil {
				debounce.Stop()
			}
			return
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if event.Name != configPath {
				continue
			}
			if event.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) != 0 {
				scheduleReload()
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			logger.Error("config watcher error", "error", err)
		case <-debounceC:
			debounceC = nil
			select {
			case reloadCh <- "config file changed":
			default:
				logger.Warn("config reload skipped because reload queue is full")
			}
		}
	}
}

func logRestartRequiredSettings(logger *slog.Logger, previous *config.Config, next *config.Config) {
	if previous.Settings.HTTPEnabled != next.Settings.HTTPEnabled {
		logger.Warn("config change requires restart",
			"setting", "settings.http_enabled",
			"old", previous.Settings.HTTPEnabled,
			"new", next.Settings.HTTPEnabled,
		)
	}
	if previous.Settings.HTTPAddress != next.Settings.HTTPAddress {
		logger.Warn("config change requires restart",
			"setting", "settings.http_addr",
			"old", previous.Settings.HTTPAddress,
			"new", next.Settings.HTTPAddress,
		)
	}
	if previous.Settings.PollInterval != next.Settings.PollInterval {
		logger.Warn("config change requires restart",
			"setting", "settings.poll_interval",
			"old", previous.Settings.PollInterval,
			"new", next.Settings.PollInterval,
		)
	}
}
