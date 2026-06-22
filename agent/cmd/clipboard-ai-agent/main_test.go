package main

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/rules"
)

func TestRuntimeStateSwap(t *testing.T) {
	firstCfg := config.Default()
	firstCfg.Provider.Model = "first-model"
	firstRules, err := rules.NewEngine(firstCfg.Actions)
	if err != nil {
		t.Fatalf("failed to create first rules engine: %v", err)
	}

	state := &runtimeState{cfg: firstCfg, rulesEngine: firstRules}

	secondCfg := config.Default()
	secondCfg.Provider.Model = "second-model"
	secondRules, err := rules.NewEngine(secondCfg.Actions)
	if err != nil {
		t.Fatalf("failed to create second rules engine: %v", err)
	}

	state.swap(secondCfg, secondRules)

	gotCfg, gotRules := state.snapshot()
	if gotCfg != secondCfg {
		t.Fatal("expected swapped config pointer")
	}
	if gotRules != secondRules {
		t.Fatal("expected swapped rules engine pointer")
	}
	if gotCfg.Provider.Model != "second-model" {
		t.Fatalf("expected second model, got %q", gotCfg.Provider.Model)
	}
}

func TestLogRestartRequiredSettings(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))

	previous := config.Default()
	next := config.Default()
	next.Settings.HTTPEnabled = true
	next.Settings.HTTPAddress = "127.0.0.1:9160"
	next.Settings.PollInterval = 500

	logRestartRequiredSettings(logger, previous, next)

	output := buf.String()
	for _, setting := range []string{
		"settings.http_enabled",
		"settings.http_addr",
		"settings.poll_interval",
	} {
		if !strings.Contains(output, setting) {
			t.Fatalf("expected restart-required log for %s, got %q", setting, output)
		}
	}
}

func TestAcquireActionSlot_Unlimited(t *testing.T) {
	release, ok := acquireActionSlot(context.Background(), nil)
	if !ok {
		t.Fatal("nil semaphore should always grant a slot")
	}
	release() // must be a no-op, not panic
}

func TestAcquireActionSlot_BoundsConcurrency(t *testing.T) {
	sem := make(chan struct{}, 2)

	r1, ok1 := acquireActionSlot(context.Background(), sem)
	r2, ok2 := acquireActionSlot(context.Background(), sem)
	if !ok1 || !ok2 {
		t.Fatal("first two acquisitions should succeed")
	}

	// Third acquisition must block until a slot frees; with a cancelled context
	// it returns ok=false instead of blocking forever.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := acquireActionSlot(ctx, sem); ok {
		t.Fatal("third acquisition should fail when full and ctx is cancelled")
	}

	// Release one slot; a new acquisition now succeeds.
	r1()
	r3, ok3 := acquireActionSlot(context.Background(), sem)
	if !ok3 {
		t.Fatal("acquisition should succeed after a slot is released")
	}
	r2()
	r3()
}
