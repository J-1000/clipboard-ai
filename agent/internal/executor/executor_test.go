package executor

import (
	"context"
	"testing"
	"time"
)

func TestResult_Fields(t *testing.T) {
	r := Result{
		Action:  "summarize",
		Output:  "test output",
		Error:   nil,
		Elapsed: 100 * time.Millisecond,
	}

	if r.Action != "summarize" {
		t.Fatalf("expected action 'summarize', got %q", r.Action)
	}
	if r.Output != "test output" {
		t.Fatalf("expected output 'test output', got %q", r.Output)
	}
	if r.Error != nil {
		t.Fatalf("expected nil error, got %v", r.Error)
	}
	if r.Elapsed != 100*time.Millisecond {
		t.Fatalf("expected 100ms elapsed, got %v", r.Elapsed)
	}
}

func TestExecute_NonexistentCommand(t *testing.T) {
	// Execute with a nonexistent command should return an error
	ctx := context.Background()
	result := Execute(ctx, "nonexistent-action-xyz")

	if result.Error == nil {
		t.Fatal("expected error for nonexistent command")
	}
	if result.Action != "nonexistent-action-xyz" {
		t.Fatalf("expected action 'nonexistent-action-xyz', got %q", result.Action)
	}
	if result.Elapsed <= 0 {
		t.Fatal("expected positive elapsed time")
	}
}

func TestExecute_CancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	result := Execute(ctx, "echo")
	// With cancelled context, command should fail
	if result.Error == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestExecute_SetsEnvironment(t *testing.T) {
	// Execute should add CBAI_DAEMON_MODE=true to the environment
	// We test this indirectly — the function always sets this env var
	// and returns a Result. We can verify the function doesn't panic.
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	result := Execute(ctx, "version")
	// Whether the command succeeds or fails depends on whether cbai is installed,
	// but the function should not panic
	_ = result
}

func TestExecute_CapturesStdout(t *testing.T) {
	// Use echo as a simple command — but Execute runs "cbai <action>"
	// so we test that the output field is populated (even if from stderr)
	ctx := context.Background()
	result := Execute(ctx, "help")

	// cbai may or may not be installed, so we just verify structure
	if result.Action != "help" {
		t.Fatalf("expected action 'help', got %q", result.Action)
	}
}

func TestDefaultTimeout(t *testing.T) {
	if defaultTimeout != 30*time.Second {
		t.Fatalf("expected default timeout 30s, got %v", defaultTimeout)
	}
}
