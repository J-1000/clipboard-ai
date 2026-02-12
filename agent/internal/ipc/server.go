package ipc

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
	"github.com/clipboard-ai/agent/internal/executor"
)

// Server provides HTTP API over Unix socket
type Server struct {
	socketPath string
	monitor    *clipboard.Monitor
	config     *config.Config
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
	Text      string `json:"text"`
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Length    int    `json:"length"`
}

// ConfigResponse is returned by /config endpoint
type ConfigResponse struct {
	Provider config.ProviderConfig          `json:"provider"`
	Actions  map[string]config.ActionConfig `json:"actions"`
	Settings config.SettingsConfig          `json:"settings"`
}

// NewServer creates a new IPC server
func NewServer(socketPath string, monitor *clipboard.Monitor, cfg *config.Config) *Server {
	return &Server{
		socketPath: socketPath,
		monitor:    monitor,
		config:     cfg,
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

	mux := http.NewServeMux()
	mux.HandleFunc("/status", s.handleStatus)
	mux.HandleFunc("/clipboard", s.handleClipboard)
	mux.HandleFunc("/config", s.handleConfig)
	mux.HandleFunc("/action", s.handleAction)

	server := &http.Server{Handler: mux}

	go func() {
		<-ctx.Done()
		server.Shutdown(context.Background())
	}()

	return server.Serve(listener)
}

// handleStatus returns agent status
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	current := s.monitor.Current()
	resp := StatusResponse{
		Status:  "running",
		Uptime:  time.Since(s.startTime).Round(time.Second).String(),
		Version: "0.1.0",
	}
	resp.Clipboard.Text = truncate(current.Text, 100)
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
		Length:    len(current.Text),
	}

	writeJSON(w, resp)
}

// handleConfig returns current configuration
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	resp := ConfigResponse{
		Provider: s.config.Provider,
		Actions:  s.config.Actions,
		Settings: s.config.Settings,
	}

	writeJSON(w, resp)
}

// ActionRequest for triggering an action
type ActionRequest struct {
	Action string `json:"action"`
	Text   string `json:"text"` // optional, uses clipboard if empty
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

	// Use clipboard content if text not provided
	text := req.Text
	if text == "" {
		text = s.monitor.Current().Text
	}

	if text == "" {
		writeJSON(w, ActionResponse{
			Success: false,
			Action:  req.Action,
			Error:   "No text available",
		})
		return
	}

	result := executor.Execute(r.Context(), req.Action)
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
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
