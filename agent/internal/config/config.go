package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/BurntSushi/toml"
)

// Config represents the application configuration
type Config struct {
	Provider ProviderConfig           `toml:"provider"`
	Actions  map[string]ActionConfig  `toml:"actions"`
	Settings SettingsConfig           `toml:"settings"`
}

// ProviderConfig configures the LLM provider
type ProviderConfig struct {
	Type     string `toml:"type"`     // ollama, openai
	Endpoint string `toml:"endpoint"` // API endpoint
	Model    string `toml:"model"`    // model name
	APIKey   string `toml:"api_key"`  // API key (optional for local)
}

// ActionConfig configures an individual action
type ActionConfig struct {
	Enabled        bool   `toml:"enabled"`
	Trigger        string `toml:"trigger"`          // trigger expression
	TimeoutMs      int    `toml:"timeout_ms"`       // action execution timeout override
	RetryCount     int    `toml:"retry_count"`      // retries after initial attempt
	RetryBackoffMs int    `toml:"retry_backoff_ms"` // delay between retries
	CooldownMs     int    `toml:"cooldown_ms"`      // minimum delay between invocations
}

// SettingsConfig contains general settings
type SettingsConfig struct {
	PollInterval          int    `toml:"poll_interval"`             // ms between clipboard checks
	SafeMode              bool   `toml:"safe_mode"`                 // require confirmation for cloud
	Notifications         bool   `toml:"notifications"`             // show macOS notifications
	LogLevel              string `toml:"log_level"`                 // debug, info, warn, error
	ClipboardDedupeWindow int    `toml:"clipboard_dedupe_window_ms"` // suppress duplicate clipboard events for this duration
}

// Default returns a config with sensible defaults
func Default() *Config {
	return &Config{
		Provider: ProviderConfig{
			Type:     "ollama",
			Endpoint: "http://localhost:11434/v1",
			Model:    "mistral",
		},
		Actions: map[string]ActionConfig{
			"summarize": {Enabled: true, Trigger: "length > 200"},
			"explain":   {Enabled: true, Trigger: "mime:code"},
		},
		Settings: SettingsConfig{
			PollInterval:          150,
			SafeMode:              true,
			Notifications:         true,
			LogLevel:              "info",
			ClipboardDedupeWindow: 1000,
		},
	}
}

// Load reads config from the standard location
func Load() (*Config, error) {
	cfg := Default()

	configPath := getConfigPath()
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return cfg, nil
	}

	if _, err := toml.DecodeFile(configPath, cfg); err != nil {
		return nil, err
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	if c.Settings.PollInterval <= 0 {
		return fmt.Errorf("invalid settings.poll_interval %d: must be greater than 0", c.Settings.PollInterval)
	}
	if c.Settings.ClipboardDedupeWindow < 0 {
		return fmt.Errorf(
			"invalid settings.clipboard_dedupe_window_ms %d: must be greater than or equal to 0",
			c.Settings.ClipboardDedupeWindow,
		)
	}

	for name, action := range c.Actions {
		if action.TimeoutMs < 0 {
			return fmt.Errorf("invalid actions.%s.timeout_ms %d: must be greater than or equal to 0", name, action.TimeoutMs)
		}
		if action.RetryCount < 0 {
			return fmt.Errorf("invalid actions.%s.retry_count %d: must be greater than or equal to 0", name, action.RetryCount)
		}
		if action.RetryBackoffMs < 0 {
			return fmt.Errorf(
				"invalid actions.%s.retry_backoff_ms %d: must be greater than or equal to 0",
				name,
				action.RetryBackoffMs,
			)
		}
		if action.CooldownMs < 0 {
			return fmt.Errorf("invalid actions.%s.cooldown_ms %d: must be greater than or equal to 0", name, action.CooldownMs)
		}
	}

	return nil
}

// getConfigPath returns the path to the config file
func getConfigPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".clipboard-ai", "config.toml")
}

// GetSocketPath returns the path to the Unix socket
func GetSocketPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".clipboard-ai", "agent.sock")
}

// GetDataDir returns the data directory path
func GetDataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".clipboard-ai")
}
