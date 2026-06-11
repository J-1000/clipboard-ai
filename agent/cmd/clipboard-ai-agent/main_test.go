package main

import (
	"bytes"
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
