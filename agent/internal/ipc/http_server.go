package ipc

import (
	"context"
	"net/http"
	"strings"
)

// HTTPServer exposes the IPC API over localhost with token auth.
type HTTPServer struct {
	addr string
	api  *Server
}

// NewHTTPServer creates a new local HTTP server. The auth token is read from the
// shared *Server's live config per request (not captured here) so that rotating
// settings.http_auth_token via hot-reload takes effect without a restart.
func NewHTTPServer(addr string, api *Server) *HTTPServer {
	return &HTTPServer{
		addr: addr,
		api:  api,
	}
}

// Start begins listening on the configured address.
func (s *HTTPServer) Start(ctx context.Context) error {
	server := &http.Server{
		Addr:    s.addr,
		Handler: s.authMiddleware(s.api.Handler()),
	}

	go func() {
		<-ctx.Done()
		server.Shutdown(context.Background())
	}()

	return server.ListenAndServe()
}

func (s *HTTPServer) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Read the token from the live config snapshot so a hot-reload rotation
		// is honored immediately.
		token := s.api.configSnapshot().Settings.HTTPAuthToken
		if !isAuthorized(r, token) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAuthorized(r *http.Request, token string) bool {
	if token == "" {
		return false
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
			value := strings.TrimSpace(authHeader[7:])
			if value == token {
				return true
			}
		}
	}

	if r.Header.Get("X-API-Key") == token {
		return true
	}
	if r.Header.Get("X-Clipboard-AI-Token") == token {
		return true
	}

	return false
}
