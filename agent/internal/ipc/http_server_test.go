package ipc

import (
	"net/http"
	"net/http/httptest"
	"testing"
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
	httpServer := NewHTTPServer("127.0.0.1:0", token, nil)

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
