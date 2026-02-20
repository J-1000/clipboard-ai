package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

func TestDefault(t *testing.T) {
	cfg := Default()

	if cfg.Provider.Type != "ollama" {
		t.Fatalf("expected provider type 'ollama', got %q", cfg.Provider.Type)
	}
	if cfg.Provider.Endpoint != "http://localhost:11434/v1" {
		t.Fatalf("expected endpoint 'http://localhost:11434/v1', got %q", cfg.Provider.Endpoint)
	}
	if cfg.Provider.Model != "mistral" {
		t.Fatalf("expected model 'mistral', got %q", cfg.Provider.Model)
	}

	// Check default actions
	if len(cfg.Actions) != 2 {
		t.Fatalf("expected 2 default actions, got %d", len(cfg.Actions))
	}
	if !cfg.Actions["summarize"].Enabled {
		t.Fatal("expected summarize action to be enabled")
	}
	if cfg.Actions["summarize"].Trigger != "length > 200" {
		t.Fatalf("expected summarize trigger 'length > 200', got %q", cfg.Actions["summarize"].Trigger)
	}
	if !cfg.Actions["explain"].Enabled {
		t.Fatal("expected explain action to be enabled")
	}
	if cfg.Actions["explain"].Trigger != "mime:code" {
		t.Fatalf("expected explain trigger 'mime:code', got %q", cfg.Actions["explain"].Trigger)
	}

	// Check default settings
	if cfg.Settings.PollInterval != 150 {
		t.Fatalf("expected poll interval 150, got %d", cfg.Settings.PollInterval)
	}
	if !cfg.Settings.SafeMode {
		t.Fatal("expected safe mode to be true")
	}
	if !cfg.Settings.Notifications {
		t.Fatal("expected notifications to be true")
	}
	if cfg.Settings.LogLevel != "info" {
		t.Fatalf("expected log level 'info', got %q", cfg.Settings.LogLevel)
	}
	if cfg.Settings.ClipboardDedupeWindow != 1000 {
		t.Fatalf("expected clipboard dedupe window 1000, got %d", cfg.Settings.ClipboardDedupeWindow)
	}
}

func TestLoad_MissingFile(t *testing.T) {
	// When config file doesn't exist, Load should return defaults without error
	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected no error for missing config, got %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config")
	}
	if cfg.Provider.Type != "ollama" {
		t.Fatalf("expected default provider type 'ollama', got %q", cfg.Provider.Type)
	}
}

func TestLoad_ValidTOML(t *testing.T) {
	// Create a temp config file
	tmpDir := t.TempDir()
	configDir := filepath.Join(tmpDir, ".clipboard-ai")
	os.MkdirAll(configDir, 0700)

	configFile := filepath.Join(configDir, "config.toml")
	content := `
[provider]
type = "openai"
endpoint = "https://api.openai.com/v1"
model = "gpt-4"
api_key = "sk-test"

[actions.translate]
enabled = true
trigger = "contains:translate"
timeout_ms = 12000
retry_count = 2
retry_backoff_ms = 250
cooldown_ms = 1000

[settings]
poll_interval = 300
safe_mode = false
notifications = false
log_level = "debug"
clipboard_dedupe_window_ms = 2000
`
	os.WriteFile(configFile, []byte(content), 0600)

	// Override getConfigPath temporarily using env
	// Since getConfigPath is unexported and uses UserHomeDir, we test Load with
	// the actual path — but for unit tests, we test the TOML parsing directly
	cfg := Default()
	_, err := toml.DecodeFile(configFile, cfg)
	if err != nil {
		t.Fatalf("failed to decode TOML: %v", err)
	}

	if cfg.Provider.Type != "openai" {
		t.Fatalf("expected provider type 'openai', got %q", cfg.Provider.Type)
	}
	if cfg.Provider.Endpoint != "https://api.openai.com/v1" {
		t.Fatalf("expected endpoint 'https://api.openai.com/v1', got %q", cfg.Provider.Endpoint)
	}
	if cfg.Provider.Model != "gpt-4" {
		t.Fatalf("expected model 'gpt-4', got %q", cfg.Provider.Model)
	}
	if cfg.Provider.APIKey != "sk-test" {
		t.Fatalf("expected api key 'sk-test', got %q", cfg.Provider.APIKey)
	}

	// Actions should include the new one plus defaults that weren't overridden
	if !cfg.Actions["translate"].Enabled {
		t.Fatal("expected translate action to be enabled")
	}
	if cfg.Actions["translate"].Trigger != "contains:translate" {
		t.Fatalf("expected translate trigger, got %q", cfg.Actions["translate"].Trigger)
	}
	if cfg.Actions["translate"].TimeoutMs != 12000 {
		t.Fatalf("expected timeout_ms 12000, got %d", cfg.Actions["translate"].TimeoutMs)
	}
	if cfg.Actions["translate"].RetryCount != 2 {
		t.Fatalf("expected retry_count 2, got %d", cfg.Actions["translate"].RetryCount)
	}
	if cfg.Actions["translate"].RetryBackoffMs != 250 {
		t.Fatalf("expected retry_backoff_ms 250, got %d", cfg.Actions["translate"].RetryBackoffMs)
	}
	if cfg.Actions["translate"].CooldownMs != 1000 {
		t.Fatalf("expected cooldown_ms 1000, got %d", cfg.Actions["translate"].CooldownMs)
	}

	// Settings should be overridden
	if cfg.Settings.PollInterval != 300 {
		t.Fatalf("expected poll interval 300, got %d", cfg.Settings.PollInterval)
	}
	if cfg.Settings.SafeMode {
		t.Fatal("expected safe mode to be false")
	}
	if cfg.Settings.Notifications {
		t.Fatal("expected notifications to be false")
	}
	if cfg.Settings.LogLevel != "debug" {
		t.Fatalf("expected log level 'debug', got %q", cfg.Settings.LogLevel)
	}
	if cfg.Settings.ClipboardDedupeWindow != 2000 {
		t.Fatalf("expected clipboard dedupe window 2000, got %d", cfg.Settings.ClipboardDedupeWindow)
	}
}

func TestLoad_InvalidTOML(t *testing.T) {
	tmpDir := t.TempDir()
	configFile := filepath.Join(tmpDir, "bad.toml")
	os.WriteFile(configFile, []byte("this is [not valid"), 0600)

	cfg := Default()
	_, err := toml.DecodeFile(configFile, cfg)
	if err == nil {
		t.Fatal("expected error for invalid TOML")
	}
}

func TestLoad_InvalidPollInterval(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	configDir := filepath.Join(tmpHome, ".clipboard-ai")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("failed to create config dir: %v", err)
	}

	configFile := filepath.Join(configDir, "config.toml")
	content := `
[settings]
poll_interval = 0
`
	if err := os.WriteFile(configFile, []byte(content), 0600); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid poll_interval")
	}
	if !strings.Contains(err.Error(), "settings.poll_interval") {
		t.Fatalf("expected poll_interval error, got %v", err)
	}
}

func TestLoad_InvalidActionReliabilitySettings(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	configDir := filepath.Join(tmpHome, ".clipboard-ai")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		t.Fatalf("failed to create config dir: %v", err)
	}

	configFile := filepath.Join(configDir, "config.toml")
	content := `
[actions.summarize]
enabled = true
trigger = "length > 200"
retry_count = -1
`
	if err := os.WriteFile(configFile, []byte(content), 0600); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for invalid retry_count")
	}
	if !strings.Contains(err.Error(), "actions.summarize.retry_count") {
		t.Fatalf("expected retry_count error, got %v", err)
	}
}

func TestGetSocketPath(t *testing.T) {
	path := GetSocketPath()
	if path == "" {
		t.Fatal("expected non-empty socket path")
	}
	if filepath.Base(path) != "agent.sock" {
		t.Fatalf("expected socket file 'agent.sock', got %q", filepath.Base(path))
	}
}

func TestGetDataDir(t *testing.T) {
	dir := GetDataDir()
	if dir == "" {
		t.Fatal("expected non-empty data dir")
	}
	if filepath.Base(dir) != ".clipboard-ai" {
		t.Fatalf("expected dir '.clipboard-ai', got %q", filepath.Base(dir))
	}
}
