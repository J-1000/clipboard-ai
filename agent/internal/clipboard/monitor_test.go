package clipboard

import (
	"testing"
)

func TestNewMonitor(t *testing.T) {
	called := false
	handler := func(c Content) { called = true }

	m := NewMonitor(200, handler)
	if m == nil {
		t.Fatal("expected non-nil monitor")
	}
	if m.pollInterval.Milliseconds() != 200 {
		t.Fatalf("expected 200ms poll interval, got %v", m.pollInterval)
	}
	if m.handler == nil {
		t.Fatal("expected handler to be set")
	}
	_ = called
}

func TestNewMonitor_ZeroInterval(t *testing.T) {
	m := NewMonitor(0, nil)
	if m.pollInterval != 0 {
		t.Fatalf("expected 0 poll interval, got %v", m.pollInterval)
	}
}

func TestCurrent_EmptyMonitor(t *testing.T) {
	m := NewMonitor(100, nil)
	current := m.Current()

	if current.Text != "" {
		t.Fatalf("expected empty text, got %q", current.Text)
	}
	if current.Type != "" {
		t.Fatalf("expected empty type, got %q", current.Type)
	}
}

func TestDetectContentType_Empty(t *testing.T) {
	ct := detectContentType("")
	if ct != ContentTypeUnknown {
		t.Fatalf("expected 'unknown' for empty string, got %q", ct)
	}
}

func TestDetectContentType_URL(t *testing.T) {
	tests := []struct {
		input string
		want  ContentType
	}{
		{"https://example.com", ContentTypeURL},
		{"http://example.com/path", ContentTypeURL},
		{"ftp://files.example.com", ContentTypeURL},
		{"file:///home/user/doc.txt", ContentTypeURL},
	}

	for _, tt := range tests {
		got := detectContentType(tt.input)
		if got != tt.want {
			t.Errorf("detectContentType(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestDetectContentType_Code(t *testing.T) {
	tests := []string{
		"func main() {}",
		"function hello() { return 1; }",
		"def my_function():",
		"class MyClass:",
		"import os",
		"const x = 42",
		"let y = 10",
		"var z = 5",
		"return value",
		"package main",
		"require('fs')",
		"if (condition) {}",
		"for (let i = 0; i < 10; i++) {}",
		"while (true) {}",
		"const fn = () => { return 1; }",
		"obj->method()",
	}

	for _, input := range tests {
		got := detectContentType(input)
		if got != ContentTypeCode {
			t.Errorf("detectContentType(%q) = %q, want 'code'", input, got)
		}
	}
}

func TestDetectContentType_Text(t *testing.T) {
	tests := []string{
		"hello world",
		"this is just some plain text",
		"The quick brown fox jumps over the lazy dog",
		"12345",
	}

	for _, input := range tests {
		got := detectContentType(input)
		if got != ContentTypeText {
			t.Errorf("detectContentType(%q) = %q, want 'text'", input, got)
		}
	}
}

func TestIsURL(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"https://example.com", true},
		{"http://example.com", true},
		{"ftp://files.example.com", true},
		{"file:///tmp/test", true},
		{"not-a-url", false},
		{"", false},
		{"https:", false},  // too short
		{"http://", false}, // too short (equal to prefix length)
	}

	for _, tt := range tests {
		got := isURL(tt.input)
		if got != tt.want {
			t.Errorf("isURL(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestLooksLikeCode(t *testing.T) {
	if !looksLikeCode("func main() {}") {
		t.Fatal("expected Go code to be detected")
	}
	if looksLikeCode("hello world") {
		t.Fatal("expected plain text to not be detected as code")
	}
}

func TestContainsString(t *testing.T) {
	tests := []struct {
		text   string
		substr string
		want   bool
	}{
		{"hello world", "world", true},
		{"hello world", "hello", true},
		{"hello world", "xyz", false},
		{"short", "longerthantext", false},
		{"", "a", false},
		{"a", "a", true},
		{"abc", "abc", true},
	}

	for _, tt := range tests {
		got := containsString(tt.text, tt.substr)
		if got != tt.want {
			t.Errorf("containsString(%q, %q) = %v, want %v", tt.text, tt.substr, got, tt.want)
		}
	}
}

func TestContentTypeConstants(t *testing.T) {
	if ContentTypeText != "text" {
		t.Fatalf("expected 'text', got %q", ContentTypeText)
	}
	if ContentTypeURL != "url" {
		t.Fatalf("expected 'url', got %q", ContentTypeURL)
	}
	if ContentTypeCode != "code" {
		t.Fatalf("expected 'code', got %q", ContentTypeCode)
	}
	if ContentTypeUnknown != "unknown" {
		t.Fatalf("expected 'unknown', got %q", ContentTypeUnknown)
	}
}
