package ipc

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
)

func newTestServer() *Server {
	cfg := config.Default()
	mon := clipboard.NewMonitor(100, nil)
	return NewServer("/tmp/test.sock", mon, cfg, "test-version")
}

func TestNewServer(t *testing.T) {
	cfg := config.Default()
	mon := clipboard.NewMonitor(100, nil)
	s := NewServer("/tmp/test.sock", mon, cfg, "test-version")

	if s == nil {
		t.Fatal("expected non-nil server")
	}
	if s.socketPath != "/tmp/test.sock" {
		t.Fatalf("expected socket path '/tmp/test.sock', got %q", s.socketPath)
	}
	if s.monitor != mon {
		t.Fatal("expected monitor to be set")
	}
	if s.config != cfg {
		t.Fatal("expected config to be set")
	}
	if s.version != "test-version" {
		t.Fatalf("expected version 'test-version', got %q", s.version)
	}
}

func TestHandleStatus_GET(t *testing.T) {
	s := newTestServer()
	s.startTime = time.Now().Add(-5 * time.Second)

	req := httptest.NewRequest(http.MethodGet, "/status", nil)
	w := httptest.NewRecorder()

	s.handleStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp StatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Status != "running" {
		t.Fatalf("expected status 'running', got %q", resp.Status)
	}
	if resp.Version != "test-version" {
		t.Fatalf("expected version 'test-version', got %q", resp.Version)
	}
	if resp.Uptime == "" {
		t.Fatal("expected non-empty uptime")
	}
}

func TestHandleStatus_WrongMethod(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodPost, "/status", nil)
	w := httptest.NewRecorder()

	s.handleStatus(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleClipboard_GET(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/clipboard", nil)
	w := httptest.NewRecorder()

	s.handleClipboard(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ClipboardResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Length != 0 {
		t.Fatalf("expected length 0 for empty clipboard, got %d", resp.Length)
	}
}

func TestHandleClipboard_WrongMethod(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodPost, "/clipboard", nil)
	w := httptest.NewRecorder()

	s.handleClipboard(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleConfig_GET(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/config", nil)
	w := httptest.NewRecorder()

	s.handleConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp ConfigResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Provider.Type != "ollama" {
		t.Fatalf("expected provider type 'ollama', got %q", resp.Provider.Type)
	}
	if resp.Settings.PollInterval != 150 {
		t.Fatalf("expected poll interval 150, got %d", resp.Settings.PollInterval)
	}
}

func TestHandleConfig_WrongMethod(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodDelete, "/config", nil)
	w := httptest.NewRecorder()

	s.handleConfig(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleAction_WrongMethod(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/action", nil)
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHandleAction_InvalidJSON(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBufferString("not json"))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleAction_NoText(t *testing.T) {
	s := newTestServer()

	body, _ := json.Marshal(ActionRequest{Action: "summarize"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	// Should return error since clipboard is empty and no text provided
	var resp ActionResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Success {
		t.Fatal("expected success=false when no text available")
	}
	if resp.Error != "No text available" {
		t.Fatalf("expected 'No text available' error, got %q", resp.Error)
	}
}

func TestHandleAction_UsesRequestText(t *testing.T) {
	s := newTestServer()

	var gotText string
	executor.SetExecuteFunc(func(ctx context.Context, action string, text string) executor.Result {
		gotText = text
		return executor.Result{
			Action: action,
			Output: "ok",
		}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{
		Action: "summarize",
		Text:   "hello from request",
	})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	var resp ActionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !resp.Success {
		t.Fatalf("expected success=true, got error %q", resp.Error)
	}
	if gotText != "hello from request" {
		t.Fatalf("expected text 'hello from request', got %q", gotText)
	}
	if resp.Result != "ok" {
		t.Fatalf("expected result 'ok', got %q", resp.Result)
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		input  string
		maxLen int
		want   string
	}{
		{"hello", 10, "hello"},
		{"hello", 5, "hello"},
		{"hello world", 5, "hello..."},
		{"", 5, ""},
		{"abc", 0, "..."},
	}

	for _, tt := range tests {
		got := truncate(tt.input, tt.maxLen)
		if got != tt.want {
			t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
		}
	}
}

func TestTruncate_UnicodeBoundary(t *testing.T) {
	got := truncate("你好世界", 2)
	if got != "你好..." {
		t.Fatalf("truncate should preserve rune boundaries, got %q", got)
	}
}

func TestTextLength_Unicode(t *testing.T) {
	if got := textLength("你好"); got != 2 {
		t.Fatalf("expected rune length 2, got %d", got)
	}
}

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeJSON(w, map[string]string{"key": "value"})

	if w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("expected Content-Type 'application/json', got %q", w.Header().Get("Content-Type"))
	}

	var result map[string]string
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	if result["key"] != "value" {
		t.Fatalf("expected key='value', got %q", result["key"])
	}
}

func TestStart_ListensOnSocket(t *testing.T) {
	tmpDir := t.TempDir()
	socketPath := filepath.Join(tmpDir, "test.sock")

	cfg := config.Default()
	mon := clipboard.NewMonitor(100, nil)
	s := NewServer(socketPath, mon, cfg, "test-version")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.Start(ctx)
	}()

	// Wait for server to start
	time.Sleep(100 * time.Millisecond)

	// Try connecting
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		t.Fatalf("failed to connect to socket: %v", err)
	}
	conn.Close()

	// Shutdown
	cancel()
}
