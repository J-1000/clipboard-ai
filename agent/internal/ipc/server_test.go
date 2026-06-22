package ipc

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

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

func TestHandleClipboard_OmitsOversizedImage(t *testing.T) {
	s := newTestServer()
	setMonitorCurrent(t, s.monitor, clipboard.Content{
		Image:     bytes.Repeat([]byte("a"), maxClipboardImageBytes+1),
		ImageMime: "image/png",
		Type:      clipboard.ContentTypeImage,
		Timestamp: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	})

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
	if resp.ImageBase64 != "" {
		t.Fatal("expected oversized image_base64 to be omitted")
	}
	if !resp.ImageTruncated {
		t.Fatal("expected image_truncated=true")
	}
	if resp.ImageSizeBytes != maxClipboardImageBytes+1 {
		t.Fatalf("expected image_size_bytes %d, got %d", maxClipboardImageBytes+1, resp.ImageSizeBytes)
	}
	if resp.ImageMime != "image/png" {
		t.Fatalf("expected image mime image/png, got %q", resp.ImageMime)
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

func TestHandleConfig_RedactsSecrets(t *testing.T) {
	s := newTestServer()
	s.config.Provider.APIKey = "sk-test-secret"
	s.config.Settings.HTTPAuthToken = "http-test-secret"

	req := httptest.NewRequest(http.MethodGet, "/config", nil)
	w := httptest.NewRecorder()

	s.handleConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	for _, leaked := range []string{"sk-test-secret", "http-test-secret"} {
		if bytes.Contains([]byte(body), []byte(leaked)) {
			t.Fatalf("response leaked secret %q: %s", leaked, body)
		}
	}

	var resp ConfigResponse
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Provider.APIKey != "<redacted>" {
		t.Fatalf("expected redacted api key, got %q", resp.Provider.APIKey)
	}
	if resp.Settings.HTTPAuthToken != "<redacted>" {
		t.Fatalf("expected redacted http auth token, got %q", resp.Settings.HTTPAuthToken)
	}
}

func TestHandleConfig_UsesSwappedConfig(t *testing.T) {
	s := newTestServer()

	next := config.Default()
	next.Provider.Model = "reloaded-model"
	s.SetConfig(next)

	req := httptest.NewRequest(http.MethodGet, "/config", nil)
	w := httptest.NewRecorder()

	s.handleConfig(w, req)

	var resp ConfigResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Provider.Model != "reloaded-model" {
		t.Fatalf("expected reloaded model, got %q", resp.Provider.Model)
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

func TestHandleHistory_GET(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	dataDir := filepath.Join(tmpHome, ".clipboard-ai")
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		t.Fatalf("failed to create data dir: %v", err)
	}
	history := `{"id":"old","timestamp":"2026-06-11T10:00:00Z","action":"summarize","args":[],"source":"manual","trigger":"cli","provider":"ollama","model":"mistral","latency_ms":10,"status":"success","copy":false,"input":"old","output":"old out"}
not json
{"id":"new","timestamp":"2026-06-11T11:00:00Z","action":"explain","args":[],"source":"manual","trigger":"cli","provider":"ollama","model":"mistral","latency_ms":20,"status":"success","copy":false,"input":"new","output":"new out"}
`
	if err := os.WriteFile(filepath.Join(dataDir, "history.jsonl"), []byte(history), 0600); err != nil {
		t.Fatalf("failed to write history: %v", err)
	}

	s := newTestServer()
	req := httptest.NewRequest(http.MethodGet, "/history?limit=1", nil)
	w := httptest.NewRecorder()

	s.handleHistory(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp HistoryResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(resp.Records))
	}
	if resp.Records[0].ID != "new" {
		t.Fatalf("expected newest record first, got %q", resp.Records[0].ID)
	}
	if resp.SkippedCorrupt != 1 {
		t.Fatalf("expected skipped_corrupt 1, got %d", resp.SkippedCorrupt)
	}
}

func TestHandleHistory_InvalidLimit(t *testing.T) {
	s := newTestServer()
	req := httptest.NewRequest(http.MethodGet, "/history?limit=-1", nil)
	w := httptest.NewRecorder()

	s.handleHistory(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
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

func TestHandleAction_OversizedBody(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(
		http.MethodPost,
		"/action",
		bytes.NewReader([]byte(`{"action":"summarize","text":"`+strings.Repeat("a", maxActionRequestBodyBytes)+`"}`)),
	)
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", w.Code)
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
	if resp.Error != "No content available" {
		t.Fatalf("expected 'No content available' error, got %q", resp.Error)
	}
}

func TestHandleAction_UsesRequestText(t *testing.T) {
	s := newTestServer()

	var gotText string
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, _ executor.Options) executor.Result {
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

func TestHandleAction_AppliesConfiguredOverrides(t *testing.T) {
	s := newTestServer()
	s.config.Actions["summarize"] = config.ActionConfig{
		Model:    "llama3.2:1b",
		Endpoint: "http://localhost:11435/v1",
	}

	var gotOptions executor.Options
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotOptions = opts
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
	if gotOptions.ModelOverride != "llama3.2:1b" {
		t.Fatalf("expected model override 'llama3.2:1b', got %q", gotOptions.ModelOverride)
	}
	if gotOptions.EndpointOverride != "http://localhost:11435/v1" {
		t.Fatalf("expected endpoint override 'http://localhost:11435/v1', got %q", gotOptions.EndpointOverride)
	}
}

func TestHandleAction_PassesArgs(t *testing.T) {
	s := newTestServer()

	var gotOptions executor.Options
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotOptions = opts
		return executor.Result{
			Action: action,
			Output: "ok",
		}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{
		Action: "translate",
		Text:   "hello",
		Args:   []string{"Spanish"},
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
	if !reflect.DeepEqual(gotOptions.Args, []string{"Spanish"}) {
		t.Fatalf("expected args [Spanish], got %#v", gotOptions.Args)
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

func TestStart_SocketPermissions(t *testing.T) {
	tmpDir, err := os.MkdirTemp("/tmp", "cbai-ipc-")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	socketPath := filepath.Join(tmpDir, ".clipboard-ai", "agent.sock")
	s := NewServer(socketPath, clipboard.NewMonitor(100, nil), config.Default(), "test-version")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.Start(ctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(socketPath); err == nil {
			break
		}
		select {
		case err := <-errCh:
			t.Fatalf("server exited before creating socket: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for socket")
		}
		time.Sleep(10 * time.Millisecond)
	}

	dirInfo, err := os.Stat(filepath.Dir(socketPath))
	if err != nil {
		t.Fatalf("failed to stat socket dir: %v", err)
	}
	if got := dirInfo.Mode().Perm(); got != 0700 {
		t.Fatalf("expected socket dir mode 0700, got %o", got)
	}

	socketInfo, err := os.Stat(socketPath)
	if err != nil {
		t.Fatalf("failed to stat socket: %v", err)
	}
	if got := socketInfo.Mode().Perm(); got != 0600 {
		t.Fatalf("expected socket mode 0600, got %o", got)
	}

	cancel()
	select {
	case <-errCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for server shutdown")
	}
}

func setMonitorCurrent(t *testing.T, monitor *clipboard.Monitor, content clipboard.Content) {
	t.Helper()

	current := reflect.ValueOf(monitor).Elem().FieldByName("current")
	reflect.NewAt(current.Type(), unsafe.Pointer(current.UnsafeAddr())).Elem().Set(reflect.ValueOf(content))
}

func TestHandleAction_RejectsUnknownAction(t *testing.T) {
	s := newTestServer()

	spawned := false
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		spawned = true
		return executor.Result{Action: action, Output: "ok"}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "definitely-not-an-action", Text: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown action, got %d", w.Code)
	}
	if spawned {
		t.Fatal("unknown action must not spawn a subprocess")
	}
}

func TestHandleAction_RejectsMalformedActionName(t *testing.T) {
	s := newTestServer()
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		t.Fatal("malformed action name must not spawn a subprocess")
		return executor.Result{}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summary; rm -rf /", Text: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed action name, got %d", w.Code)
	}
}

func TestHandleAction_PassesInjectedFlagAsPositionalArg(t *testing.T) {
	s := newTestServer()

	var gotArgs []string
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotArgs = opts.Args
		return executor.Result{Action: action, Output: "ok"}
	})
	defer executor.ResetExecuteFunc()

	// Args flow verbatim into opts.Args; the executor separates them with --, so
	// "--force" reaches cbai positionally and cannot toggle the global guard flag.
	body, _ := json.Marshal(ActionRequest{Action: "summary", Text: "hi", Args: []string{"--force"}})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if len(gotArgs) != 1 || gotArgs[0] != "--force" {
		t.Fatalf("expected args [--force] passed through to executor, got %v", gotArgs)
	}
}

func TestHandleAction_RateLimitsWhenSaturated(t *testing.T) {
	s := newTestServer()
	// Saturate the concurrency semaphore so the next request is shed.
	for i := 0; i < cap(s.actionSem); i++ {
		s.actionSem <- struct{}{}
	}

	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		t.Fatal("executor must not run when the action limiter is saturated")
		return executor.Result{}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summary", Text: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 when saturated, got %d", w.Code)
	}
}
