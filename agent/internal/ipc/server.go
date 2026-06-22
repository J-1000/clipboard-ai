package ipc

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
)

const maxActionRequestBodyBytes = 10 << 20
const maxClipboardImageBytes = 25 << 20

// maxConcurrentActionRequests bounds in-flight /action executions so a burst of
// HTTP requests can't spawn unbounded LLM-calling subprocesses. Excess requests
// get 429 rather than queueing.
const maxConcurrentActionRequests = 4

// Server provides HTTP API over Unix socket
type Server struct {
	socketPath string
	monitor    *clipboard.Monitor
	mu         sync.RWMutex
	config     *config.Config
	version    string
	startTime  time.Time
	listener   net.Listener
	actionSem  chan struct{}
}

// SetConfig atomically swaps the config used by /config and /action.
func (s *Server) SetConfig(cfg *config.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = cfg
}

func (s *Server) configSnapshot() *config.Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config
}

// StatusResponse is returned by /status endpoint
type StatusResponse struct {
	Status    string `json:"status"`
	Uptime    string `json:"uptime"`
	Version   string `json:"version"`
	Clipboard struct {
		Text      string `json:"text"`
		Type      string `json:"type"`
		Timestamp string `json:"timestamp"`
	} `json:"clipboard"`
}

// ClipboardResponse is returned by /clipboard endpoint
type ClipboardResponse struct {
	Text           string `json:"text"`
	RTF            string `json:"rtf,omitempty"`
	ImageBase64    string `json:"image_base64,omitempty"`
	ImageMime      string `json:"image_mime,omitempty"`
	ImageTruncated bool   `json:"image_truncated,omitempty"`
	ImageSizeBytes int    `json:"image_size_bytes,omitempty"`
	Type           string `json:"type"`
	Timestamp      string `json:"timestamp"`
	Length         int    `json:"length"`
}

// ConfigResponse is returned by /config endpoint
type ConfigResponse struct {
	Provider config.ProviderConfig          `json:"provider"`
	Actions  map[string]config.ActionConfig `json:"actions"`
	Settings config.SettingsConfig          `json:"settings"`
}

// HistoryRecord mirrors CLI history records stored in history.jsonl.
type HistoryRecord struct {
	ID        string   `json:"id"`
	Timestamp string   `json:"timestamp"`
	Action    string   `json:"action"`
	Args      []string `json:"args"`
	Source    string   `json:"source"`
	Trigger   string   `json:"trigger"`
	Provider  string   `json:"provider"`
	Model     string   `json:"model"`
	LatencyMs int      `json:"latency_ms"`
	Status    string   `json:"status"`
	Copy      bool     `json:"copy"`
	Input     string   `json:"input"`
	Output    string   `json:"output,omitempty"`
	Error     string   `json:"error,omitempty"`
	ReplayOf  string   `json:"replay_of,omitempty"`
}

// HistoryResponse is returned by /history.
type HistoryResponse struct {
	Records        []HistoryRecord `json:"records"`
	SkippedCorrupt int             `json:"skipped_corrupt,omitempty"`
}

// NewServer creates a new IPC server
func NewServer(socketPath string, monitor *clipboard.Monitor, cfg *config.Config, version string) *Server {
	return &Server{
		socketPath: socketPath,
		monitor:    monitor,
		config:     cfg,
		version:    version,
		startTime:  time.Now(),
		actionSem:  make(chan struct{}, maxConcurrentActionRequests),
	}
}

// Start begins listening on the Unix socket
func (s *Server) Start(ctx context.Context) error {
	// Ensure directory exists
	dir := filepath.Dir(s.socketPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return err
	}

	// Remove existing socket
	os.Remove(s.socketPath)

	oldUmask := syscall.Umask(0077)
	listener, err := net.Listen("unix", s.socketPath)
	syscall.Umask(oldUmask)
	if err != nil {
		return err
	}
	s.listener = listener
	// Remove the socket file when Serve returns so a stale socket isn't left on
	// disk after shutdown.
	defer os.Remove(s.socketPath)

	// Set socket permissions
	if err := os.Chmod(s.socketPath, 0600); err != nil {
		listener.Close()
		return err
	}

	server := &http.Server{Handler: s.Handler()}

	go func() {
		<-ctx.Done()
		server.Shutdown(context.Background())
	}()

	return server.Serve(listener)
}

// Handler returns the HTTP handler for the IPC API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", s.handleStatus)
	mux.HandleFunc("/clipboard", s.handleClipboard)
	mux.HandleFunc("/config", s.handleConfig)
	mux.HandleFunc("/action", s.handleAction)
	mux.HandleFunc("/history", s.handleHistory)
	return mux
}

// handleStatus returns agent status
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	current := s.monitor.Current()
	displayText := current.Text
	if current.Type == clipboard.ContentTypeImage {
		displayText = "[image]"
	} else if current.Type == clipboard.ContentTypeRTF && displayText == "" {
		displayText = "[rtf]"
	}
	resp := StatusResponse{
		Status:  "running",
		Uptime:  time.Since(s.startTime).Round(time.Second).String(),
		Version: s.version,
	}
	resp.Clipboard.Text = truncate(displayText, 100)
	resp.Clipboard.Type = string(current.Type)
	resp.Clipboard.Timestamp = current.Timestamp.Format(time.RFC3339)

	writeJSON(w, resp)
}

// handleClipboard returns current clipboard content
func (s *Server) handleClipboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	current := s.monitor.Current()
	resp := ClipboardResponse{
		Text:      current.Text,
		Type:      string(current.Type),
		Timestamp: current.Timestamp.Format(time.RFC3339),
		Length:    textLength(current.Text),
	}
	if current.Type == clipboard.ContentTypeRTF {
		resp.RTF = current.RTF
	}
	if current.Type == clipboard.ContentTypeImage && len(current.Image) > 0 {
		resp.ImageMime = current.ImageMime
		resp.ImageSizeBytes = len(current.Image)
		if len(current.Image) > maxClipboardImageBytes {
			resp.ImageTruncated = true
		} else {
			resp.ImageBase64 = base64.StdEncoding.EncodeToString(current.Image)
		}
	}

	writeJSON(w, resp)
}

// handleConfig returns current configuration
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writeJSON(w, redactedConfigResponse(s.configSnapshot()))
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	limit := 20
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			http.Error(w, "Invalid limit", http.StatusBadRequest)
			return
		}
		if parsed > 100 {
			parsed = 100
		}
		limit = parsed
	}

	records, skipped, err := readHistoryRecords(filepath.Join(config.GetDataDir(), "history.jsonl"), limit)
	if err != nil {
		http.Error(w, "Failed to read history", http.StatusInternalServerError)
		return
	}

	writeJSON(w, HistoryResponse{
		Records:        records,
		SkippedCorrupt: skipped,
	})
}

func redactedConfigResponse(cfg *config.Config) ConfigResponse {
	provider := cfg.Provider
	settings := cfg.Settings

	if provider.APIKey != "" {
		provider.APIKey = "<redacted>"
	}
	if settings.HTTPAuthToken != "" {
		settings.HTTPAuthToken = "<redacted>"
	}

	return ConfigResponse{
		Provider: provider,
		Actions:  cfg.Actions,
		Settings: settings,
	}
}

// ActionRequest for triggering an action
type ActionRequest struct {
	Action      string   `json:"action"`
	Text        string   `json:"text,omitempty"` // optional, uses clipboard if empty
	RTF         string   `json:"rtf,omitempty"`
	ImageBase64 string   `json:"image_base64,omitempty"`
	ImageMime   string   `json:"image_mime,omitempty"`
	Type        string   `json:"type,omitempty"`
	Args        []string `json:"args,omitempty"`
}

// ActionResponse from triggering an action
type ActionResponse struct {
	Success bool   `json:"success"`
	Action  string `json:"action"`
	Result  string `json:"result,omitempty"`
	Error   string `json:"error,omitempty"`
}

// builtinActionNames is the set of action ids and aliases the CLI registry
// ships (see cli/src/lib/builtin-actions.ts). Kept here so the agent can reject
// requests for unknown actions before spawning a subprocess. Custom/plugin
// actions are still accepted when the user has configured them (see isKnownAction).
var builtinActionNames = map[string]struct{}{
	"summary": {}, "summarize": {}, "sum": {},
	"explain":   {},
	"translate": {},
	"improve":   {},
	"extract":   {},
	"tldr":      {},
	"classify":  {},
	"summarize_url": {}, "summarize-url": {},
	"caption": {}, "describe": {}, "describe-image": {},
	"ocr": {}, "extract-text": {},
}

var actionNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// isKnownAction reports whether name is a builtin action or one the user has
// configured (covers plugin/custom actions the agent can't enumerate itself).
func isKnownAction(cfg *config.Config, name string) bool {
	if _, ok := builtinActionNames[name]; ok {
		return true
	}
	if cfg != nil {
		if _, ok := cfg.Actions[name]; ok {
			return true
		}
	}
	return false
}

// handleAction triggers an AI action
func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxActionRequestBodyBytes)
	var req ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			http.Error(w, "Request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate the action name against the known registry before spawning a
	// subprocess. (`enabled` gates automatic clipboard triggers, not manual
	// /action calls — mirroring `cbai run`, which runs disabled actions too.)
	req.Action = strings.TrimSpace(req.Action)
	if req.Action == "" || !actionNamePattern.MatchString(req.Action) {
		http.Error(w, "Invalid action name", http.StatusBadRequest)
		return
	}
	if !isKnownAction(s.configSnapshot(), req.Action) {
		http.Error(w, "Unknown action", http.StatusBadRequest)
		return
	}

	// Bound concurrent executions; shed load with 429 instead of queueing.
	if s.actionSem != nil {
		select {
		case s.actionSem <- struct{}{}:
			defer func() { <-s.actionSem }()
		default:
			http.Error(w, "Too many concurrent actions", http.StatusTooManyRequests)
			return
		}
	}

	// Use clipboard content if payload not provided
	inputText := req.Text
	inputRTF := req.RTF
	inputType := strings.TrimSpace(req.Type)
	imageMime := req.ImageMime
	var imageBytes []byte

	if inputText == "" && inputRTF == "" && req.ImageBase64 == "" {
		current := s.monitor.Current()
		inputText = current.Text
		inputRTF = current.RTF
		imageBytes = current.Image
		imageMime = current.ImageMime
		inputType = string(current.Type)
	}

	if req.ImageBase64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(req.ImageBase64)
		if err != nil {
			http.Error(w, "Invalid image_base64", http.StatusBadRequest)
			return
		}
		imageBytes = decoded
	}

	if inputType == "" {
		switch {
		case len(imageBytes) > 0:
			inputType = string(clipboard.ContentTypeImage)
		case inputRTF != "":
			inputType = string(clipboard.ContentTypeRTF)
		default:
			inputType = string(clipboard.ContentTypeText)
		}
	}

	if inputText == "" && inputRTF == "" && len(imageBytes) == 0 {
		writeJSON(w, ActionResponse{
			Success: false,
			Action:  req.Action,
			Error:   "No content available",
		})
		return
	}

	opts := executor.Options{
		InputType: inputType,
		InputRTF:  inputRTF,
		Args:      req.Args,
	}
	cfg := s.configSnapshot()
	if actionCfg, ok := cfg.Actions[req.Action]; ok {
		opts.ModelOverride = actionCfg.Model
		opts.EndpointOverride = actionCfg.Endpoint
	}
	if len(imageBytes) > 0 {
		path, err := executor.WriteTempImage(imageBytes)
		if err != nil {
			http.Error(w, "Failed to store image", http.StatusInternalServerError)
			return
		}
		defer os.Remove(path)
		opts.InputImagePath = path
		opts.InputImageMime = imageMime
	}

	result := executor.ExecuteWithOptions(r.Context(), req.Action, inputText, opts)
	if result.Error != nil {
		writeJSON(w, ActionResponse{
			Success: false,
			Action:  req.Action,
			Error:   result.Error.Error(),
		})
		return
	}

	writeJSON(w, ActionResponse{
		Success: true,
		Action:  req.Action,
		Result:  result.Output,
	})
}

func readHistoryRecords(path string, limit int) ([]HistoryRecord, int, error) {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return []HistoryRecord{}, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()

	var records []HistoryRecord
	skipped := 0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var record HistoryRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			skipped++
			continue
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		return nil, skipped, err
	}

	for i, j := 0, len(records)-1; i < j; i, j = i+1, j-1 {
		records[i], records[j] = records[j], records[i]
	}
	if limit >= 0 && len(records) > limit {
		records = records[:limit]
	}

	return records, skipped, nil
}

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// truncate shortens a string
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}

func textLength(s string) int {
	return utf8.RuneCountInString(s)
}
