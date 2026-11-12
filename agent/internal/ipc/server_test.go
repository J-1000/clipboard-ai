package ipc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	if resp.Privacy.DefaultSnoozeMinutes != 15 {
		t.Fatalf("expected default snooze 15, got %d", resp.Privacy.DefaultSnoozeMinutes)
	}
}

func TestHandleControls_PauseClearsClipboardAndResume(t *testing.T) {
	s := newTestServer()
	setMonitorCurrent(t, s.monitor, clipboard.Content{Text: "secret", Type: clipboard.ContentTypeText})

	pauseBody := bytes.NewBufferString(`{"action":"pause"}`)
	pauseRequest := httptest.NewRequest(http.MethodPost, "/controls", pauseBody)
	pauseRecorder := httptest.NewRecorder()
	s.handleControls(pauseRecorder, pauseRequest)

	var paused ControlsResponse
	if err := json.NewDecoder(pauseRecorder.Body).Decode(&paused); err != nil {
		t.Fatalf("decode pause response: %v", err)
	}
	if paused.Monitoring || !paused.Paused {
		t.Fatalf("pause response = %#v", paused)
	}
	if current := s.monitor.Current(); current.Text != "" || len(current.Image) != 0 {
		t.Fatalf("pause retained clipboard payload: %#v", current)
	}

	resumeBody := bytes.NewBufferString(`{"action":"resume"}`)
	resumeRequest := httptest.NewRequest(http.MethodPost, "/controls", resumeBody)
	resumeRecorder := httptest.NewRecorder()
	s.handleControls(resumeRecorder, resumeRequest)
	var resumed ControlsResponse
	if err := json.NewDecoder(resumeRecorder.Body).Decode(&resumed); err != nil {
		t.Fatalf("decode resume response: %v", err)
	}
	if !resumed.Monitoring || resumed.Paused || resumed.SnoozedUntil != "" {
		t.Fatalf("resume response = %#v", resumed)
	}
}

func TestHandleControls_SnoozesForConfiguredDefault(t *testing.T) {
	s := newTestServer()
	started := time.Now()
	req := httptest.NewRequest(http.MethodPost, "/controls", bytes.NewBufferString(`{"action":"snooze"}`))
	w := httptest.NewRecorder()
	s.handleControls(w, req)

	var response ControlsResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode snooze response: %v", err)
	}
	until, err := time.Parse(time.RFC3339, response.SnoozedUntil)
	if err != nil {
		t.Fatalf("invalid snoozed_until %q: %v", response.SnoozedUntil, err)
	}
	if until.Before(started.Add(14*time.Minute)) || until.After(started.Add(16*time.Minute)) {
		t.Fatalf("snoozed_until = %v, want about 15 minutes", until)
	}
	if response.Monitoring || response.Paused {
		t.Fatalf("snooze response = %#v", response)
	}
}

func TestHandleControls_RejectsInvalidControl(t *testing.T) {
	s := newTestServer()
	for _, body := range []string{
		`{"action":"unknown"}`,
		`{"action":"snooze","duration_minutes":10081}`,
		`not json`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/controls", bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		s.handleControls(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %q returned %d, want 400", body, w.Code)
		}
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

func TestHandleAction_ReturnsSubprocessDiagnostic(t *testing.T) {
	s := newTestServer()
	executor.SetExecuteWithOptionsFunc(func(context.Context, string, string, executor.Options) executor.Result {
		return executor.Result{
			Action: "summarize",
			Output: "  Error: safe mode blocks cloud providers in daemon mode\n",
			Error:  errors.New("exit status 1"),
		}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summarize", Text: "hello"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	var resp ActionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Success {
		t.Fatal("expected failed action response")
	}
	if resp.Error != "Error: safe mode blocks cloud providers in daemon mode" {
		t.Fatalf("error = %q, want subprocess diagnostic", resp.Error)
	}
}

func TestActionExecutionError_FallsBackToExitError(t *testing.T) {
	got := actionExecutionError(executor.Result{Output: " \n", Error: errors.New("signal: killed")})
	if got != "signal: killed" {
		t.Fatalf("error = %q, want exit error fallback", got)
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

func TestHandleAction_PassesUnknownNamesToTheCLI(t *testing.T) {
	s := newTestServer()

	var gotAction string
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotAction = action
		return executor.Result{
			Action: action,
			Stderr: "Error: Unknown action \"my_plugin\"\n",
			Error:  errors.New("exit status 1"),
		}
	})
	defer executor.ResetExecuteFunc()

	// Not a built-in and not in the config: the CLI registry decides, so plugin
	// actions work without a config entry.
	body, _ := json.Marshal(ActionRequest{Action: "my_plugin", Text: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 with an application error, got %d", w.Code)
	}
	if gotAction != "my_plugin" {
		t.Fatalf("executor received action %q, want my_plugin", gotAction)
	}
	var resp ActionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Success || resp.Error != `Error: Unknown action "my_plugin"` {
		t.Fatalf("response = %#v, want the CLI's unknown-action diagnostic", resp)
	}
}

func TestHandleAction_PrefersStderrDiagnosticOverStdout(t *testing.T) {
	s := newTestServer()
	executor.SetExecuteWithOptionsFunc(func(context.Context, string, string, executor.Options) executor.Result {
		return executor.Result{
			Action: "summarize",
			Output: "partial output\n",
			Stderr: "Error: all provider profiles failed: default: Connection error.\n",
			Error:  errors.New("exit status 1"),
		}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summarize", Text: "hello"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	var resp ActionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Success || resp.Error != "Error: all provider profiles failed: default: Connection error." {
		t.Fatalf("response = %#v, want the stderr diagnostic", resp)
	}
}

func TestHandleAction_TrimsTrailingNewlineFromResult(t *testing.T) {
	s := newTestServer()
	executor.SetExecuteWithOptionsFunc(func(context.Context, string, string, executor.Options) executor.Result {
		return executor.Result{Action: "summarize", Output: "line one\nline two\n"}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summarize", Text: "hello"})
	req := httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body))
	w := httptest.NewRecorder()

	s.handleAction(w, req)

	var resp ActionResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Result != "line one\nline two" {
		t.Fatalf("result = %q, want inner newlines kept and the trailing one removed", resp.Result)
	}
}

func TestHandleAction_AppliesConfiguredTimeout(t *testing.T) {
	s := newTestServer()
	cfg := config.Default()
	cfg.Actions["summarize"] = config.ActionConfig{Enabled: true, Trigger: "length > 200", TimeoutMs: 90000}
	s.SetConfig(cfg)

	var gotOpts executor.Options
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotOpts = opts
		return executor.Result{Action: action, Output: "ok"}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summarize", Text: "hello"})
	s.handleAction(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body)))
	if gotOpts.Timeout != 90*time.Second {
		t.Fatalf("timeout = %v, want the configured 90s", gotOpts.Timeout)
	}

	// An action without a configured timeout leaves the executor default in place.
	body, _ = json.Marshal(ActionRequest{Action: "explain", Text: "hello"})
	s.handleAction(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body)))
	if gotOpts.Timeout != 0 {
		t.Fatalf("timeout = %v, want 0 so the executor default applies", gotOpts.Timeout)
	}
}

func TestHandleAction_NormalizesRequestSource(t *testing.T) {
	s := newTestServer()

	var gotOpts executor.Options
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotOpts = opts
		return executor.Result{Action: action, Output: "ok"}
	})
	defer executor.ResetExecuteFunc()

	for source, want := range map[string]string{"menubar": "menubar", "Raycast": "raycast", "mcp": "mcp", "": "api", "something-else": "api"} {
		body, _ := json.Marshal(ActionRequest{Action: "summarize", Text: "hello", Source: source})
		s.handleAction(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body)))

		if gotOpts.Source != want {
			t.Fatalf("source %q recorded as %q, want %q", source, gotOpts.Source, want)
		}
	}
}

func TestFreshReadsBypassTheMonitorCache(t *testing.T) {
	s := newTestServer()
	s.monitor.SetReaders(
		func() []byte { return []byte("live clipboard") },
		func() []byte { return nil },
		func() string { return "" },
	)

	// The monitor itself holds nothing (as when paused), so a plain read is empty.
	plain := httptest.NewRecorder()
	s.handleClipboard(plain, httptest.NewRequest(http.MethodGet, "/clipboard", nil))
	var cached ClipboardResponse
	if err := json.NewDecoder(plain.Body).Decode(&cached); err != nil {
		t.Fatalf("decode cached response: %v", err)
	}
	if cached.Text != "" {
		t.Fatalf("cached read returned %q, want empty", cached.Text)
	}

	fresh := httptest.NewRecorder()
	s.handleClipboard(fresh, httptest.NewRequest(http.MethodGet, "/clipboard?fresh=true", nil))
	var live ClipboardResponse
	if err := json.NewDecoder(fresh.Body).Decode(&live); err != nil {
		t.Fatalf("decode fresh response: %v", err)
	}
	if live.Text != "live clipboard" || live.Type != "text" || live.Length != 14 {
		t.Fatalf("fresh read = %#v, want the live clipboard text", live)
	}
	if current := s.monitor.Current(); current.Text != "" {
		t.Fatalf("a fresh read must not populate the monitor, got %q", current.Text)
	}

	var gotText string
	executor.SetExecuteWithOptionsFunc(func(ctx context.Context, action string, text string, opts executor.Options) executor.Result {
		gotText = text
		return executor.Result{Action: action, Output: "ok"}
	})
	defer executor.ResetExecuteFunc()

	body, _ := json.Marshal(ActionRequest{Action: "summarize", Fresh: true})
	w := httptest.NewRecorder()
	s.handleAction(w, httptest.NewRequest(http.MethodPost, "/action", bytes.NewBuffer(body)))
	if gotText != "live clipboard" {
		t.Fatalf("fresh action ran on %q, want the live clipboard text", gotText)
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

func TestErrorResponsesAreJSON(t *testing.T) {
	s := newTestServer()

	// A protocol error (wrong method) must return a JSON {"error": ...} body.
	req := httptest.NewRequest(http.MethodPost, "/status", nil)
	w := httptest.NewRecorder()
	s.handleStatus(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("expected JSON content type, got %q", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("error body is not JSON: %v", err)
	}
	if body["error"] == "" {
		t.Fatalf("expected an error message, got %v", body)
	}
}

func TestHandler_SetsAPIVersionHeader(t *testing.T) {
	s := newTestServer()
	req := httptest.NewRequest(http.MethodGet, "/status", nil)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)
	if got := w.Header().Get("X-API-Version"); got != apiVersion {
		t.Fatalf("expected X-API-Version %q, got %q", apiVersion, got)
	}
}

func TestLocalProviderChain_ReturnsSecretsOnlyOnUnixHandler(t *testing.T) {
	cfg := config.Default()
	cfg.Provider.APIKey = "default-secret"
	cfg.Providers["cloud"] = config.ProviderConfig{
		Type: "openai", Endpoint: "https://api.openai.com/v1", Model: "gpt-5-mini", APIKey: "cloud-secret", Fallbacks: []string{"local"}, DailyTokenLimit: 50_000,
	}
	cfg.Providers["local"] = config.ProviderConfig{
		Type: "ollama", Endpoint: "http://localhost:11434/v1", Model: "mistral",
	}
	action := cfg.Actions["summarize"]
	action.ProviderProfile = "cloud"
	action.DailyTokenLimit = 10_000
	action.MaxTokens = 2048
	cfg.Actions["summarize"] = action
	s := NewServer("/tmp/test.sock", clipboard.NewMonitor(100, nil), cfg, "test")

	request := httptest.NewRequest(http.MethodGet, "/provider-chain?action=summarize", nil)
	localRecorder := httptest.NewRecorder()
	s.LocalHandler().ServeHTTP(localRecorder, request)
	if localRecorder.Code != http.StatusOK {
		t.Fatalf("local provider chain returned %d: %s", localRecorder.Code, localRecorder.Body.String())
	}
	var response ProviderChainResponse
	if err := json.NewDecoder(localRecorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode provider chain: %v", err)
	}
	if len(response.Profiles) != 2 || response.Profiles[0].Name != "cloud" || response.Profiles[1].Name != "local" {
		t.Fatalf("provider chain = %#v", response.Profiles)
	}
	if response.Profiles[0].APIKey != "cloud-secret" {
		t.Fatalf("local provider chain did not return selected credential")
	}
	if response.ActionDailyTokenLimit != 10_000 || response.MaxTokens != 2048 {
		t.Fatalf("provider limits = %#v", response)
	}

	publicRecorder := httptest.NewRecorder()
	s.Handler().ServeHTTP(publicRecorder, httptest.NewRequest(http.MethodGet, "/provider-chain?action=summarize", nil))
	if publicRecorder.Code != http.StatusNotFound {
		t.Fatalf("public HTTP handler exposed provider chain with status %d", publicRecorder.Code)
	}

	configRecorder := httptest.NewRecorder()
	s.Handler().ServeHTTP(configRecorder, httptest.NewRequest(http.MethodGet, "/config", nil))
	for _, secret := range []string{"default-secret", "cloud-secret"} {
		if strings.Contains(configRecorder.Body.String(), secret) {
			t.Fatalf("public config leaked %q: %s", secret, configRecorder.Body.String())
		}
	}
	if !strings.Contains(configRecorder.Body.String(), `"providers"`) || !strings.Contains(configRecorder.Body.String(), `"daily_token_limit"`) {
		t.Fatalf("public config did not use the documented lowercase JSON shape: %s", configRecorder.Body.String())
	}
}

func TestResolveProviderChain_ActionFallbacksOverridePrimaryDefaults(t *testing.T) {
	cfg := config.Default()
	cfg.Providers["cloud"] = config.ProviderConfig{Type: "openai", Model: "gpt", Fallbacks: []string{"default"}}
	cfg.Providers["local"] = config.ProviderConfig{Type: "ollama", Model: "mistral"}
	action := config.ActionConfig{
		ProviderProfile: "cloud", FallbackProfiles: []string{"local"}, Model: "action-model", Endpoint: "https://override.invalid/v1",
	}

	chain := resolveProviderChain(cfg, action)
	if len(chain) != 2 || chain[0].Name != "cloud" || chain[1].Name != "local" {
		t.Fatalf("chain = %#v", chain)
	}
	if chain[0].Model != "action-model" || chain[0].Endpoint != "https://override.invalid/v1" {
		t.Fatalf("primary legacy overrides not applied: %#v", chain[0])
	}
}
