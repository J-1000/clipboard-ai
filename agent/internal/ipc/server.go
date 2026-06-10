package ipc

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
)

// Server provides HTTP API over Unix socket
type Server struct {
	socketPath string
	monitor    *clipboard.Monitor
	config     *config.Config
	version    string
	startTime  time.Time
	listener   net.Listener
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
	Text        string `json:"text"`
	RTF         string `json:"rtf,omitempty"`
	ImageBase64 string `json:"image_base64,omitempty"`
	ImageMime   string `json:"image_mime,omitempty"`
	Type        string `json:"type"`
	Timestamp   string `json:"timestamp"`
	Length      int    `json:"length"`
}

// ConfigResponse is returned by /config endpoint
type ConfigResponse struct {
	Provider config.ProviderConfig          `json:"provider"`
	Actions  map[string]config.ActionConfig `json:"actions"`
	Settings config.SettingsConfig          `json:"settings"`
}

// NewServer creates a new IPC server
func NewServer(socketPath string, monitor *clipboard.Monitor, cfg *config.Config, version string) *Server {
	return &Server{
		socketPath: socketPath,
		monitor:    monitor,
		config:     cfg,
		version:    version,
		startTime:  time.Now(),
	}
}

// Start begins listening on the Unix socket
func (s *Server) Start(ctx context.Context) error {
	// Ensure directory exists
	dir := filepath.Dir(s.socketPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	// Remove existing socket
	os.Remove(s.socketPath)

	listener, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return err
	}
	s.listener = listener

	// Set socket permissions
	os.Chmod(s.socketPath, 0600)

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
		resp.ImageBase64 = base64.StdEncoding.EncodeToString(current.Image)
		resp.ImageMime = current.ImageMime
	}

	writeJSON(w, resp)
}

// handleConfig returns current configuration
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writeJSON(w, redactedConfigResponse(s.config))
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
	Action      string `json:"action"`
	Text        string `json:"text,omitempty"` // optional, uses clipboard if empty
	RTF         string `json:"rtf,omitempty"`
	ImageBase64 string `json:"image_base64,omitempty"`
	ImageMime   string `json:"image_mime,omitempty"`
	Type        string `json:"type,omitempty"`
}

// ActionResponse from triggering an action
type ActionResponse struct {
	Success bool   `json:"success"`
	Action  string `json:"action"`
	Result  string `json:"result,omitempty"`
	Error   string `json:"error,omitempty"`
}

// handleAction triggers an AI action
func (s *Server) handleAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
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
