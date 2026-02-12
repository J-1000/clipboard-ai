package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

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
		log.Fatalf("Failed to load config: %v", err)
	}

	// Set up logging
	log.SetPrefix("[clipboard-ai] ")
	log.SetFlags(log.Ltime)

	log.Printf("Starting clipboard-ai-agent %s", version)
	log.Printf("Provider: %s (%s)", cfg.Provider.Type, cfg.Provider.Model)
	log.Printf("Safe mode: %v", cfg.Settings.SafeMode)

	// Set up context with cancellation (before handler so closure can capture ctx)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create rules engine
	rulesEngine := rules.NewEngine(cfg.Actions)

	// Create clipboard handler
	handler := func(content clipboard.Content) {
		log.Printf("Clipboard changed: %s (%d chars)", content.Type, len(content.Text))

		// Evaluate rules
		matches := rulesEngine.Evaluate(content)
		for _, match := range matches {
			log.Printf("Triggered action: %s", match.ActionName)

			go func(actionName string) {
				result := executor.Execute(ctx, actionName)
				if result.Error != nil {
					log.Printf("Action %s failed: %v", actionName, result.Error)
					if cfg.Settings.Notifications {
						notify.SendWithSubtitle("clipboard-ai", actionName+" failed", result.Error.Error())
					}
					return
				}
				log.Printf("Action %s completed in %v", actionName, result.Elapsed)
				if cfg.Settings.Notifications {
					output := result.Output
					if len(output) > 200 {
						output = output[:200] + "..."
					}
					notify.SendWithSubtitle("clipboard-ai", actionName, output)
				}
			}(match.ActionName)
		}
	}

	// Create clipboard monitor
	monitor := clipboard.NewMonitor(cfg.Settings.PollInterval, handler)

	// Create IPC server
	socketPath := config.GetSocketPath()
	server := ipc.NewServer(socketPath, monitor, cfg)

	// Handle shutdown signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Start IPC server in goroutine
	go func() {
		log.Printf("IPC server listening on %s", socketPath)
		if err := server.Start(ctx); err != nil && ctx.Err() == nil {
			log.Printf("IPC server error: %v", err)
		}
	}()

	// Start clipboard monitor in goroutine
	go func() {
		log.Printf("Clipboard monitor started (poll interval: %dms)", cfg.Settings.PollInterval)
		if err := monitor.Start(ctx); err != nil && ctx.Err() == nil {
			log.Printf("Monitor error: %v", err)
		}
	}()

	// Wait for shutdown signal
	sig := <-sigCh
	log.Printf("Received signal %v, shutting down...", sig)
	cancel()

	log.Println("Goodbye!")
}
