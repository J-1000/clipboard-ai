package clipboard

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"os/exec"
	"regexp"
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
	pollInterval           time.Duration
	handler                Handler
	lastChangeCount        int
	changeCountInitialized bool
	baselined              bool

	// mu guards lastSignature and current: Clear() is called from the IPC and
	// config-reload goroutines while the poll goroutine reads and writes both.
	mu            sync.RWMutex
	lastSignature string
	current       Content

	// Read/clock seams. Defaulted to the real clipboard in NewMonitor so the
	// poll/dedupe logic can be exercised with fakes and no GUI/cgo dependency.
	readText        func() []byte
	readImage       func() []byte
	readRTF         func() string
	readChangeCount func() int
	shouldRead      func() bool
	now             func() time.Time
}

// NewMonitor creates a new clipboard monitor
func NewMonitor(pollIntervalMs int, handler Handler) *Monitor {
	if pollIntervalMs <= 0 {
		pollIntervalMs = defaultPollIntervalMs
	}

	return &Monitor{
		pollInterval:    time.Duration(pollIntervalMs) * time.Millisecond,
		handler:         handler,
		readText:        func() []byte { return clipboard.Read(clipboard.FmtText) },
		readImage:       func() []byte { return clipboard.Read(clipboard.FmtImage) },
		readRTF:         readRTF,
		readChangeCount: pasteboardChangeCount,
		now:             time.Now,
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
			m.poll()
		}
	}
}

// poll uses NSPasteboard.changeCount as the inexpensive change signal. The
// first poll establishes a baseline and reads the current payload once; later
// polls do no clipboard payload work until AppKit reports a change.
func (m *Monitor) poll() {
	changeCount := m.readChangeCount()
	if changeCount >= 0 {
		if m.changeCountInitialized && changeCount == m.lastChangeCount {
			return
		}
		m.lastChangeCount = changeCount
		m.changeCountInitialized = true
	}
	// The first poll only records what is already on the clipboard. Content
	// that was copied before the agent started must not trigger actions.
	fire := m.baselined
	m.baselined = true

	if m.shouldRead != nil && !m.shouldRead() {
		m.clear()
		return
	}
	m.checkAndUpdate(fire)
}

// SetReaders replaces the pasteboard accessors. It exists so tests in other
// packages can exercise on-demand reads without touching the real clipboard.
func (m *Monitor) SetReaders(text func() []byte, image func() []byte, rtf func() string) {
	m.readText = text
	m.readImage = image
	m.readRTF = rtf
}

// SetReadPolicy installs a policy checked after changeCount advances but before
// any clipboard payload is read.
func (m *Monitor) SetReadPolicy(shouldRead func() bool) {
	m.shouldRead = shouldRead
}

// check reads the clipboard and fires the handler if the content changed.
func (m *Monitor) check() {
	m.checkAndUpdate(true)
}

// checkAndUpdate reads the clipboard and stores the content if it changed.
// The handler is called only when fire is true.
func (m *Monitor) checkAndUpdate(fire bool) {
	content, ok := m.readContent()
	if !ok {
		m.clear()
		return
	}

	m.mu.Lock()
	if content.Signature == m.lastSignature {
		m.mu.Unlock()
		return
	}
	m.lastSignature = content.Signature
	m.current = content
	m.mu.Unlock()

	if fire && m.handler != nil {
		m.handler(content)
	}
}

// readContent reads the pasteboard once and classifies what it holds. ok is
// false when the pasteboard has no supported content. It does not touch the
// monitor's stored state.
func (m *Monitor) readContent() (Content, bool) {
	if data := m.readImage(); len(data) > 0 {
		return Content{
			Image:     data,
			ImageMime: "image/png",
			Timestamp: m.now(),
			Type:      ContentTypeImage,
			Signature: hashBytes(data),
		}, true
	}

	data := m.readText()
	text := string(data)
	rtf := m.readRTF()
	if len(data) == 0 && rtf == "" {
		return Content{}, false
	}

	contentType := detectContentType(text)
	signature := text
	if rtf != "" {
		signature = rtf
		contentType = ContentTypeRTF
	}

	return Content{
		Text:      text,
		RTF:       rtf,
		Timestamp: m.now(),
		Type:      contentType,
		Signature: signature,
	}, true
}

// ReadNow reads the clipboard on demand for an explicit, user-initiated
// request. It bypasses the read policy (pause, snooze, application lists) and
// the concealed-entry check, does not change the monitor's stored state, and
// never fires the handler. It returns an empty Content when the clipboard holds
// nothing supported.
func (m *Monitor) ReadNow() Content {
	content, _ := m.readContent()
	return content
}

func (m *Monitor) clear() {
	m.mu.Lock()
	m.lastSignature = ""
	m.current = Content{}
	m.mu.Unlock()
}

// Clear removes all clipboard payload held by the monitor.
func (m *Monitor) Clear() {
	m.clear()
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

// Weak code signals that also occur in English ("I want to return home", "let
// me know", "click here -> there") only count when they appear in a clearly
// code-shaped form: a real declaration/assignment, an arrow to an identifier or
// call, or a return that leads into a statement/call.
var (
	declRe   = regexp.MustCompile(`\b(?:let|var|const)\s+[A-Za-z_$][\w$]*\s*=`)
	arrowRe  = regexp.MustCompile(`->[A-Za-z_(]`)
	returnRe = regexp.MustCompile(`\breturn\b[^.!?\n]*[;(]`)
)

// looksLikeCode checks if text appears to be code.
func looksLikeCode(text string) bool {
	// Strong indicators are code-specific enough to classify on their own.
	strongIndicators := []string{
		"func ", "function ", "def ", "class ",
		"import ", "require(", "package ",
		"if (", "for (", "while (",
		"=> {",
	}
	for _, indicator := range strongIndicators {
		if containsString(text, indicator) {
			return true
		}
	}

	return declRe.MatchString(text) || arrowRe.MatchString(text) || returnRe.MatchString(text)
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
