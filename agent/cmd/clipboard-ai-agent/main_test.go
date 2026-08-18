package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
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

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("hello", 200); got != "hello" {
		t.Fatalf("short string should be unchanged, got %q", got)
	}
	// 250 multi-byte runes; truncation must not split a rune.
	long := strings.Repeat("é", 250)
	got := truncateRunes(long, 200)
	if !utf8.ValidString(got) {
		t.Fatal("truncated output must remain valid UTF-8")
	}
	if r := []rune(got); len(r) != 203 || string(r[:200]) != strings.Repeat("é", 200) {
		t.Fatalf("expected 200 runes + ellipsis, got %d runes", len(r))
	}
}

func TestIsTransientExecutionFailure(t *testing.T) {
	tests := []struct {
		name   string
		result executor.Result
		want   bool
	}{
		{name: "success", result: executor.Result{}, want: false},
		{name: "cancelled", result: executor.Result{Error: context.Canceled}, want: false},
		{name: "deadline", result: executor.Result{Error: context.DeadlineExceeded}, want: true},
		{name: "rate limit", result: executor.Result{Error: errors.New("exit status 1"), Output: "Error: 429 rate limit exceeded"}, want: true},
		{name: "server error", result: executor.Result{Error: errors.New("exit status 1"), Output: "HTTP 503 service unavailable"}, want: true},
		{name: "network reset", result: executor.Result{Error: errors.New("exit status 1"), Output: "fetch failed: ECONNRESET"}, want: true},
		{name: "safe mode", result: executor.Result{Error: errors.New("exit status 1"), Output: "safe mode blocks cloud providers"}, want: false},
		{name: "authentication", result: executor.Result{Error: errors.New("exit status 1"), Output: "invalid API key (401 unauthorized)"}, want: false},
		{name: "invalid config", result: executor.Result{Error: errors.New("exit status 1"), Output: "invalid provider configuration"}, want: false},
		{name: "unknown failure", result: executor.Result{Error: errors.New("exit status 1")}, want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isTransientExecutionFailure(tc.result); got != tc.want {
				t.Fatalf("isTransientExecutionFailure() = %v, want %v", got, tc.want)
			}
		})
	}
}
