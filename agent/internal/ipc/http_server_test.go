package ipc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/clipboard-ai/agent/internal/clipboard"
	"github.com/clipboard-ai/agent/internal/config"
)

func TestIsAuthorized(t *testing.T) {
	token := "test-token"

	tests := []struct {
		name    string
		token   string
		headers map[string]string
		want    bool
	}{
		{
			name:  "authorizes bearer token",
			token: token,
			headers: map[string]string{
				"Authorization": "Bearer test-token",
			},
			want: true,
		},
		{
			name:  "authorizes lowercase bearer prefix",
			token: token,
			headers: map[string]string{
				"Authorization": "bearer test-token",
			},
			want: true,
		},
		{
			name:  "authorizes bearer with whitespace",
			token: token,
			headers: map[string]string{
				"Authorization": "Bearer   test-token   ",
			},
			want: true,
		},
		{
			name:  "authorizes x-api-key",
			token: token,
			headers: map[string]string{
				"X-API-Key": "test-token",
			},
			want: true,
		},
		{
			name:  "authorizes x-clipboard-ai-token",
			token: token,
			headers: map[string]string{
				"X-Clipboard-AI-Token": "test-token",
			},
			want: true,
		},
		{
			name:  "rejects wrong token",
			token: token,
			headers: map[string]string{
				"Authorization": "Bearer wrong",
			},
			want: false,
		},
		{
			name:  "rejects when server token is empty",
			token: "",
			headers: map[string]string{
				"Authorization": "Bearer test-token",
			},
			want: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/status", nil)
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}

			if got := isAuthorized(req, tc.token); got != tc.want {
				t.Fatalf("isAuthorized() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestAuthMiddleware(t *testing.T) {
	token := "test-token"
	cfg := config.Default()
	cfg.Settings.HTTPAuthToken = token
	api := NewServer("/tmp/test.sock", clipboard.NewMonitor(100, nil), cfg, "test-version")
	httpServer := NewHTTPServer("127.0.0.1:0", api)

	handler := httpServer.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	t.Run("rejects unauthorized requests", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/status", nil)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", w.Code)
		}
	})

	t.Run("passes authorized requests", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/status", nil)
		req.Header.Set("X-API-Key", token)
		w := httptest.NewRecorder()

		handler.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d", w.Code)
		}
	})
}

func TestHTTPConfigDoesNotLeakCredentials(t *testing.T) {
	cfg := config.Default()
	cfg.Provider.APIKey = "sk-http-secret"
	cfg.Settings.HTTPAuthToken = "http-auth-secret"
	api := NewServer("/tmp/test.sock", clipboard.NewMonitor(100, nil), cfg, "test-version")
	httpServer := NewHTTPServer("127.0.0.1:0", api)
	handler := httpServer.authMiddleware(api.Handler())

	req := httptest.NewRequest(http.MethodGet, "/config", nil)
	req.Header.Set("X-API-Key", "http-auth-secret")
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	body := w.Body.String()
	for _, leaked := range []string{"sk-http-secret", "http-auth-secret"} {
		if strings.Contains(body, leaked) {
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

func TestAuthMiddleware_HonorsRotatedTokenOnReload(t *testing.T) {
	cfg := config.Default()
	cfg.Settings.HTTPAuthToken = "old-token"
	api := NewServer("/tmp/test.sock", clipboard.NewMonitor(100, nil), cfg, "test-version")
	httpServer := NewHTTPServer("127.0.0.1:0", api)
	handler := httpServer.authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	do := func(token string) int {
		req := httptest.NewRequest(http.MethodGet, "/status", nil)
		req.Header.Set("X-API-Key", token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w.Code
	}

	if do("old-token") != http.StatusNoContent {
		t.Fatal("old token should be accepted before rotation")
	}

	// Rotate the token via the live config (as a hot-reload would).
	rotated := config.Default()
	rotated.Settings.HTTPAuthToken = "new-token"
	api.SetConfig(rotated)

	if do("old-token") != http.StatusUnauthorized {
		t.Fatal("old token must be rejected after rotation")
	}
	if do("new-token") != http.StatusNoContent {
		t.Fatal("new token must be accepted after rotation")
	}
}
