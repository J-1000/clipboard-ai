package clipboard

import (
	"context"
	"sync"
	"time"

	"golang.design/x/clipboard"
)

// Content represents clipboard content
type Content struct {
	Text      string
	Timestamp time.Time
	Type      ContentType
}

// ContentType indicates the type of clipboard content
type ContentType string

const (
	ContentTypeText    ContentType = "text"
	ContentTypeURL     ContentType = "url"
	ContentTypeCode    ContentType = "code"
	ContentTypeUnknown ContentType = "unknown"

	defaultPollIntervalMs = 150
)

// Handler is called when clipboard content changes
type Handler func(content Content)

// Monitor watches the clipboard for changes
type Monitor struct {
	pollInterval time.Duration
	handler      Handler
	lastContent  string
	mu           sync.RWMutex
	current      Content
}

// NewMonitor creates a new clipboard monitor
func NewMonitor(pollIntervalMs int, handler Handler) *Monitor {
	if pollIntervalMs <= 0 {
		pollIntervalMs = defaultPollIntervalMs
	}

	return &Monitor{
		pollInterval: time.Duration(pollIntervalMs) * time.Millisecond,
		handler:      handler,
	}
}

// Start begins monitoring the clipboard
func (m *Monitor) Start(ctx context.Context) error {
	// Initialize clipboard
	if err := clipboard.Init(); err != nil {
		return err
	}

	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			m.check()
		}
	}
}

// check reads the clipboard and fires handler if changed
func (m *Monitor) check() {
	data := clipboard.Read(clipboard.FmtText)
	if data == nil {
		return
	}

	text := string(data)
	if text == m.lastContent {
		return
	}

	m.lastContent = text
	content := Content{
		Text:      text,
		Timestamp: time.Now(),
		Type:      detectContentType(text),
	}

	m.mu.Lock()
	m.current = content
	m.mu.Unlock()

	if m.handler != nil {
		m.handler(content)
	}
}

// Current returns the current clipboard content
func (m *Monitor) Current() Content {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current
}

// detectContentType attempts to classify the content
func detectContentType(text string) ContentType {
	if len(text) == 0 {
		return ContentTypeUnknown
	}

	// Check for URL
	if isURL(text) {
		return ContentTypeURL
	}

	// Check for code patterns
	if looksLikeCode(text) {
		return ContentTypeCode
	}

	return ContentTypeText
}

// isURL checks if text looks like a URL
func isURL(text string) bool {
	prefixes := []string{"http://", "https://", "ftp://", "file://"}
	for _, p := range prefixes {
		if len(text) > len(p) && text[:len(p)] == p {
			return true
		}
	}
	return false
}

// looksLikeCode checks if text appears to be code
func looksLikeCode(text string) bool {
	codeIndicators := []string{
		"func ", "function ", "def ", "class ",
		"import ", "require(", "package ",
		"if (", "for (", "while (",
		"const ", "let ", "var ",
		"return ", "=> {", "->",
	}
	for _, indicator := range codeIndicators {
		if containsString(text, indicator) {
			return true
		}
	}
	return false
}

// containsString checks if text contains substr
func containsString(text, substr string) bool {
	if len(substr) > len(text) {
		return false
	}
	for i := 0; i <= len(text)-len(substr); i++ {
		if text[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
