package clipboard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"

	"golang.design/x/clipboard"
)

// Content represents clipboard content
type Content struct {
	Text      string
	RTF       string
	Image     []byte
	ImageMime string
	Timestamp time.Time
	Type      ContentType
	Signature string
}

// ContentType indicates the type of clipboard content
type ContentType string

const (
	ContentTypeText    ContentType = "text"
	ContentTypeURL     ContentType = "url"
	ContentTypeCode    ContentType = "code"
	ContentTypeImage   ContentType = "image"
	ContentTypeRTF     ContentType = "rtf"
	ContentTypeUnknown ContentType = "unknown"

	defaultPollIntervalMs = 150
)

var logRTFReadFailureOnce sync.Once

// Handler is called when clipboard content changes
type Handler func(content Content)

// Monitor watches the clipboard for changes
type Monitor struct {
	pollInterval  time.Duration
	handler       Handler
	lastSignature string
	mu            sync.RWMutex
	current       Content

	// Read/clock seams. Defaulted to the real clipboard in NewMonitor so the
	// poll/dedupe logic can be exercised with fakes and no GUI/cgo dependency.
	readText  func() []byte
	readImage func() []byte
	readRTF   func() string
	now       func() time.Time
}

// NewMonitor creates a new clipboard monitor
func NewMonitor(pollIntervalMs int, handler Handler) *Monitor {
	if pollIntervalMs <= 0 {
		pollIntervalMs = defaultPollIntervalMs
	}

	return &Monitor{
		pollInterval: time.Duration(pollIntervalMs) * time.Millisecond,
		handler:      handler,
		readText:     func() []byte { return clipboard.Read(clipboard.FmtText) },
		readImage:    func() []byte { return clipboard.Read(clipboard.FmtImage) },
		readRTF:      readRTF,
		now:          time.Now,
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
	if content, ok := m.checkImage(); ok {
		m.update(content)
		return
	}

	data := m.readText()
	if data == nil {
		return
	}

	text := string(data)
	rtf := m.readRTF()
	contentType := detectContentType(text)
	signature := text

	if rtf != "" {
		signature = rtf
		contentType = ContentTypeRTF
	}

	if signature == m.lastSignature {
		return
	}

	content := Content{
		Text:      text,
		RTF:       rtf,
		Timestamp: m.now(),
		Type:      contentType,
		Signature: signature,
	}

	m.update(content)
}

func (m *Monitor) checkImage() (Content, bool) {
	data := m.readImage()
	if len(data) == 0 {
		return Content{}, false
	}

	signature := hashBytes(data)
	if signature == m.lastSignature {
		return Content{}, false
	}

	return Content{
		Image:     data,
		ImageMime: "image/png",
		Timestamp: m.now(),
		Type:      ContentTypeImage,
		Signature: signature,
	}, true
}

func (m *Monitor) update(content Content) {
	m.lastSignature = content.Signature

	m.mu.Lock()
	m.current = content
	m.mu.Unlock()

	if m.handler != nil {
		m.handler(content)
	}
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func readRTF() string {
	cmd := exec.Command("pbpaste", "-Prefer", "rtf")
	output, err := cmd.Output()
	if err != nil {
		logRTFReadFailureOnce.Do(func() {
			slog.Warn("failed to read RTF clipboard content", "error", err)
		})
		return ""
	}
	rtf := strings.TrimSpace(string(output))
	if !strings.HasPrefix(rtf, "{\\rtf") {
		return ""
	}
	return rtf
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
