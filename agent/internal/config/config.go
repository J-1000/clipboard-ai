package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/BurntSushi/toml"
)

// Config represents the application configuration
type Config struct {
	Provider  ProviderConfig            `toml:"provider" json:"provider"`
	Providers map[string]ProviderConfig `toml:"providers" json:"providers,omitempty"`
	Actions   map[string]ActionConfig   `toml:"actions" json:"actions"`
	Settings  SettingsConfig            `toml:"settings" json:"settings"`
	Privacy   PrivacyConfig             `toml:"privacy" json:"privacy"`

	// UnknownKeys lists keys present in the config file that no setting
	// consumes (usually typos). It is filled by LoadFromPath for the caller to
	// report; it is never read from or written to the file.
	UnknownKeys []string `toml:"-" json:"-"`
}

// ProviderConfig configures the LLM provider
type ProviderConfig struct {
	Type            string   `toml:"type" json:"type"`                     // ollama, openai
	Endpoint        string   `toml:"endpoint" json:"endpoint"`             // API endpoint
	Model           string   `toml:"model" json:"model"`                   // model name
	APIKey          string   `toml:"api_key" json:"api_key,omitempty"`     // API key (optional for local)
	Fallbacks       []string `toml:"fallbacks" json:"fallbacks,omitempty"` // ordered named-profile fallbacks
	DailyTokenLimit int      `toml:"daily_token_limit" json:"daily_token_limit,omitempty"`
}

// ActionConfig configures an individual action
type ActionConfig struct {
	Enabled          bool     `toml:"enabled" json:"enabled"`
	Trigger          string   `toml:"trigger" json:"trigger"`         // trigger expression
	Prompt           string   `toml:"prompt" json:"prompt,omitempty"` // custom action: prompt template (no JS plugin needed)
	ProviderProfile  string   `toml:"provider_profile" json:"provider_profile,omitempty"`
	FallbackProfiles []string `toml:"fallback_profiles" json:"fallback_profiles,omitempty"`
	DailyTokenLimit  int      `toml:"daily_token_limit" json:"daily_token_limit,omitempty"`
	Model            string   `toml:"model" json:"model,omitempty"`                       // legacy optional model override
	Endpoint         string   `toml:"endpoint" json:"endpoint,omitempty"`                 // legacy optional endpoint override
	MaxTokens        int      `toml:"max_tokens" json:"max_tokens,omitempty"`             // optional max completion tokens override
	TimeoutMs        int      `toml:"timeout_ms" json:"timeout_ms,omitempty"`             // action execution timeout override
	RetryCount       int      `toml:"retry_count" json:"retry_count,omitempty"`           // retries after initial attempt
	RetryBackoffMs   int      `toml:"retry_backoff_ms" json:"retry_backoff_ms,omitempty"` // delay between retries
	CooldownMs       int      `toml:"cooldown_ms" json:"cooldown_ms,omitempty"`           // minimum delay between invocations
}

// SettingsConfig contains general settings
type SettingsConfig struct {
	PollInterval          int    `toml:"poll_interval" json:"poll_interval"`                           // ms between clipboard checks
	SafeMode              bool   `toml:"safe_mode" json:"safe_mode"`                                   // require confirmation for cloud
	Notifications         bool   `toml:"notifications" json:"notifications"`                           // show macOS notifications
	LogLevel              string `toml:"log_level" json:"log_level"`                                   // debug, info, warn, error
	ClipboardDedupeWindow int    `toml:"clipboard_dedupe_window_ms" json:"clipboard_dedupe_window_ms"` // suppress duplicates
	HTTPEnabled           bool   `toml:"http_enabled" json:"http_enabled"`
	HTTPAddress           string `toml:"http_addr" json:"http_addr"`
	HTTPAuthToken         string `toml:"http_auth_token" json:"http_auth_token,omitempty"`
	HTTPAllowRemote       bool   `toml:"http_allow_remote" json:"http_allow_remote"`
	HistoryEnabled        bool   `toml:"history_enabled" json:"history_enabled"`
	HistoryMaxEntries     int    `toml:"history_max_entries" json:"history_max_entries"`
	HistoryTruncateChars  int    `toml:"history_truncate_chars" json:"history_truncate_chars"`
	SensitiveGuard        string `toml:"sensitive_guard" json:"sensitive_guard"`
	MaxConcurrentActions  int    `toml:"max_concurrent_actions" json:"max_concurrent_actions"`
	MaxTokens             int    `toml:"max_tokens" json:"max_tokens"`
}

// PrivacyConfig controls whether clipboard payloads may be read for automatic
// monitoring. Applications may be identified by bundle id or display name.
type PrivacyConfig struct {
	StartPaused          bool     `toml:"start_paused" json:"start_paused"`
	DefaultSnoozeMinutes int      `toml:"default_snooze_minutes" json:"default_snooze_minutes"`
	AppAllowlist         []string `toml:"app_allowlist" json:"app_allowlist"`
	AppDenylist          []string `toml:"app_denylist" json:"app_denylist"`
	// SkipConcealed makes automatic monitoring ignore entries that the source
	// application marked as concealed, transient, or auto-generated.
	SkipConcealed bool `toml:"skip_concealed" json:"skip_concealed"`
}

var profileNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

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
			"caption":   {Enabled: false, Trigger: "mime:image"},
			"ocr":       {Enabled: false, Trigger: "mime:image"},
		},
		Providers: make(map[string]ProviderConfig),
		Settings: SettingsConfig{
			PollInterval:          150,
			SafeMode:              true,
			Notifications:         true,
			LogLevel:              "info",
			ClipboardDedupeWindow: 1000,
			HTTPEnabled:           false,
			HTTPAddress:           "127.0.0.1:9159",
			HistoryEnabled:        true,
			HistoryMaxEntries:     1000,
			HistoryTruncateChars:  2000,
			SensitiveGuard:        "warn",
			MaxConcurrentActions:  4,
			MaxTokens:             1024,
		},
		Privacy: PrivacyConfig{
			DefaultSnoozeMinutes: 15,
			SkipConcealed:        true,
		},
	}
}

// Load reads config from the standard location
func Load() (*Config, error) {
	return LoadFromPath(ConfigPath())
}

// LoadFromPath reads and validates a config file from path.
func LoadFromPath(configPath string) (*Config, error) {
	cfg := Default()

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return cfg, nil
	}

	metadata, err := toml.DecodeFile(configPath, cfg)
	if err != nil {
		return nil, err
	}
	for _, key := range metadata.Undecoded() {
		cfg.UnknownKeys = append(cfg.UnknownKeys, key.String())
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

// ReloadFromPath loads a replacement config while preserving the previous
// config on validation or parsing failure.
func ReloadFromPath(configPath string, previous *Config) (*Config, error) {
	cfg, err := LoadFromPath(configPath)
	if err != nil {
		return previous, err
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
	if c.Settings.HTTPEnabled {
		addr := strings.TrimSpace(c.Settings.HTTPAddress)
		if addr == "" {
			return fmt.Errorf("invalid settings.http_addr: must be non-empty when http_enabled is true")
		}
		if strings.TrimSpace(c.Settings.HTTPAuthToken) == "" {
			return fmt.Errorf("invalid settings.http_auth_token: must be non-empty when http_enabled is true")
		}
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			return fmt.Errorf("invalid settings.http_addr %q: %w", addr, err)
		}
		if !c.Settings.HTTPAllowRemote && !isLoopbackHost(host) {
			return fmt.Errorf(
				"settings.http_addr %q binds a non-loopback address, exposing the API to the network; "+
					"set http_allow_remote = true to opt in", addr,
			)
		}
	}
	if c.Settings.HistoryMaxEntries < 0 {
		return fmt.Errorf("invalid settings.history_max_entries %d: must be greater than or equal to 0", c.Settings.HistoryMaxEntries)
	}
	if c.Settings.HistoryTruncateChars < 0 {
		return fmt.Errorf("invalid settings.history_truncate_chars %d: must be greater than or equal to 0", c.Settings.HistoryTruncateChars)
	}
	if c.Settings.MaxConcurrentActions < 0 {
		return fmt.Errorf("invalid settings.max_concurrent_actions %d: must be greater than or equal to 0", c.Settings.MaxConcurrentActions)
	}
	if c.Settings.MaxTokens < 0 {
		return fmt.Errorf("invalid settings.max_tokens %d: must be greater than or equal to 0", c.Settings.MaxTokens)
	}
	if err := c.validateProviderProfiles(); err != nil {
		return err
	}
	if c.Privacy.DefaultSnoozeMinutes <= 0 {
		return fmt.Errorf(
			"invalid privacy.default_snooze_minutes %d: must be greater than 0",
			c.Privacy.DefaultSnoozeMinutes,
		)
	}
	allowlist, err := normalizeApplicationList("privacy.app_allowlist", c.Privacy.AppAllowlist)
	if err != nil {
		return err
	}
	denylist, err := normalizeApplicationList("privacy.app_denylist", c.Privacy.AppDenylist)
	if err != nil {
		return err
	}
	allowed := make(map[string]struct{}, len(allowlist))
	for _, app := range allowlist {
		allowed[strings.ToLower(app)] = struct{}{}
	}
	for _, app := range denylist {
		if _, exists := allowed[strings.ToLower(app)]; exists {
			return fmt.Errorf("application %q appears in both privacy.app_allowlist and privacy.app_denylist", app)
		}
	}
	c.Privacy.AppAllowlist = allowlist
	c.Privacy.AppDenylist = denylist
	switch strings.ToLower(strings.TrimSpace(c.Settings.SensitiveGuard)) {
	case "", "block", "warn", "off":
		if strings.TrimSpace(c.Settings.SensitiveGuard) == "" {
			c.Settings.SensitiveGuard = "warn"
		} else {
			c.Settings.SensitiveGuard = strings.ToLower(strings.TrimSpace(c.Settings.SensitiveGuard))
		}
	default:
		return fmt.Errorf("invalid settings.sensitive_guard %q: must be block, warn, or off", c.Settings.SensitiveGuard)
	}

	for name, action := range c.Actions {
		action.ProviderProfile = strings.TrimSpace(action.ProviderProfile)
		fallbacks, err := normalizeProfileReferences(action.FallbackProfiles)
		if err != nil {
			return fmt.Errorf("invalid actions.%s.fallback_profiles: %w", name, err)
		}
		action.FallbackProfiles = fallbacks
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
		if action.MaxTokens < 0 {
			return fmt.Errorf("invalid actions.%s.max_tokens %d: must be greater than or equal to 0", name, action.MaxTokens)
		}
		if action.DailyTokenLimit < 0 {
			return fmt.Errorf("invalid actions.%s.daily_token_limit %d: must be greater than or equal to 0", name, action.DailyTokenLimit)
		}
		if action.ProviderProfile != "" {
			if err := c.requireProviderProfile(action.ProviderProfile, "actions."+name+".provider_profile"); err != nil {
				return err
			}
		}
		for _, fallback := range action.FallbackProfiles {
			if err := c.requireProviderProfile(fallback, "actions."+name+".fallback_profiles"); err != nil {
				return err
			}
		}
		c.Actions[name] = action
	}

	return nil
}

func (c *Config) validateProviderProfiles() error {
	if c.Provider.DailyTokenLimit < 0 {
		return fmt.Errorf("invalid provider.daily_token_limit %d: must be greater than or equal to 0", c.Provider.DailyTokenLimit)
	}
	defaultFallbacks, err := normalizeProfileReferences(c.Provider.Fallbacks)
	if err != nil {
		return fmt.Errorf("invalid provider.fallbacks: %w", err)
	}
	c.Provider.Fallbacks = defaultFallbacks
	for _, fallback := range c.Provider.Fallbacks {
		if err := c.requireProviderProfile(fallback, "provider.fallbacks"); err != nil {
			return err
		}
	}
	for name, provider := range c.Providers {
		if name == "default" || !profileNamePattern.MatchString(name) {
			return fmt.Errorf("invalid providers.%s: profile names must match %s and cannot be default", name, profileNamePattern.String())
		}
		if provider.DailyTokenLimit < 0 {
			return fmt.Errorf("invalid providers.%s.daily_token_limit %d: must be greater than or equal to 0", name, provider.DailyTokenLimit)
		}
		if strings.TrimSpace(provider.Type) == "" || strings.TrimSpace(provider.Model) == "" {
			return fmt.Errorf("invalid providers.%s: type and model must be non-empty", name)
		}
		fallbacks, err := normalizeProfileReferences(provider.Fallbacks)
		if err != nil {
			return fmt.Errorf("invalid providers.%s.fallbacks: %w", name, err)
		}
		provider.Fallbacks = fallbacks
		for _, fallback := range provider.Fallbacks {
			if fallback == name {
				return fmt.Errorf("invalid providers.%s.fallbacks: profile cannot fall back to itself", name)
			}
			if err := c.requireProviderProfile(fallback, "providers."+name+".fallbacks"); err != nil {
				return err
			}
		}
		c.Providers[name] = provider
	}
	return c.validateProviderFallbackCycles()
}

func (c *Config) requireProviderProfile(name, setting string) error {
	name = strings.TrimSpace(name)
	if name == "default" {
		return nil
	}
	if _, ok := c.Providers[name]; !ok {
		return fmt.Errorf("invalid %s: unknown provider profile %q", setting, name)
	}
	return nil
}

func (c *Config) validateProviderFallbackCycles() error {
	visiting := make(map[string]bool)
	visited := make(map[string]bool)
	var visit func(string) error
	visit = func(name string) error {
		if visited[name] {
			return nil
		}
		if visiting[name] {
			return fmt.Errorf("provider fallback cycle includes %q", name)
		}
		visiting[name] = true
		provider := c.Provider
		if name != "default" {
			provider = c.Providers[name]
		}
		for _, fallback := range provider.Fallbacks {
			if err := visit(fallback); err != nil {
				return err
			}
		}
		visiting[name] = false
		visited[name] = true
		return nil
	}
	profiles := make([]string, 0, len(c.Providers)+1)
	profiles = append(profiles, "default")
	for name := range c.Providers {
		profiles = append(profiles, name)
	}
	for _, name := range profiles {
		if err := visit(name); err != nil {
			return err
		}
	}
	return nil
}

func normalizeProfileReferences(values []string) ([]string, error) {
	if values == nil {
		return nil, nil
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("profile names must be non-empty")
		}
		if _, duplicate := seen[value]; duplicate {
			return nil, fmt.Errorf("duplicate profile %q", value)
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

func normalizeApplicationList(setting string, values []string) ([]string, error) {
	if values == nil {
		return nil, nil
	}
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("invalid %s: application identifiers must be non-empty", setting)
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized, nil
}

// isLoopbackHost reports whether an http_addr host binds only the loopback
// interface. An empty host (e.g. ":9159") binds all interfaces and is not
// considered loopback.
func isLoopbackHost(host string) bool {
	host = strings.TrimSpace(host)
	if host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// ConfigPath returns the path to the config file.
func ConfigPath() string {
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
