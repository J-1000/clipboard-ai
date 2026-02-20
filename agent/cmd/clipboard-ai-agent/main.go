package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/clipboard-ai/agent/internal/automation"
	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
	"github.com/clipboard-ai/agent/internal/ipc"
	"github.com/clipboard-ai/agent/internal/notify"
	"github.com/clipboard-ai/agent/internal/rules"
)

var version = "0.1.0"

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
	)

	// Set up context with cancellation (before handler so closure can capture ctx)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create rules engine
	rulesEngine := rules.NewEngine(cfg.Actions)
	controller := automation.NewController(time.Duration(cfg.Settings.ClipboardDedupeWindow) * time.Millisecond)

	// Create clipboard handler
	handler := func(content clipboard.Content) {
		logger.Info("clipboard changed",
			"type", content.Type,
			"length_chars", len([]rune(content.Text)),
		)
		now := time.Now()

		if controller.ShouldSkipClipboard(content.Text, now) {
			logger.Debug("skipped duplicate clipboard content",
				"dedupe_window_ms", cfg.Settings.ClipboardDedupeWindow,
			)
			return
		}

		// Evaluate rules
		matches := rulesEngine.Evaluate(content)
		for _, match := range matches {
			cooldown := time.Duration(match.Config.CooldownMs) * time.Millisecond
			if !controller.AllowAction(match.ActionName, cooldown, now) {
				logger.Debug("skipped action due to cooldown",
					"action", match.ActionName,
					"cooldown_ms", match.Config.CooldownMs,
				)
				continue
			}

			logger.Info("action triggered", "action", match.ActionName)

			go func(actionName string, actionCfg config.ActionConfig, text string) {
				opts := executor.Options{Trigger: actionCfg.Trigger}
				if actionCfg.TimeoutMs > 0 {
					opts.Timeout = time.Duration(actionCfg.TimeoutMs) * time.Millisecond
				}

				attempts := actionCfg.RetryCount + 1
				backoff := time.Duration(actionCfg.RetryBackoffMs) * time.Millisecond
				var result executor.Result

				for attempt := 1; attempt <= attempts; attempt++ {
					result = executor.ExecuteWithOptions(ctx, actionName, text, opts)
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
			}(match.ActionName, match.Config, content.Text)
		}
	}

	// Create clipboard monitor
	monitor := clipboard.NewMonitor(cfg.Settings.PollInterval, handler)

	// Create IPC server
	socketPath := config.GetSocketPath()
	server := ipc.NewServer(socketPath, monitor, cfg, version)

	// Handle shutdown signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

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

	// Wait for shutdown signal
	sig := <-sigCh
	logger.Info("shutdown signal received", "signal", sig.String())
	cancel()

	logger.Info("agent stopped")
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
