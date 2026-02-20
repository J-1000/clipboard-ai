package executor

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"time"
)

const defaultTimeout = 30 * time.Second

// Options controls action execution behavior.
type Options struct {
	Timeout time.Duration
	Trigger string
}

// ExecuteFunc allows tests to override the executor behavior.
type ExecuteFunc func(ctx context.Context, action string, text string) Result

// ExecuteWithOptionsFunc allows tests to override ExecuteWithOptions behavior.
type ExecuteWithOptionsFunc func(ctx context.Context, action string, text string, opts Options) Result

var executeFn ExecuteFunc = runExecute
var executeWithOptionsFn ExecuteWithOptionsFunc = runExecuteWithOptions

// Result holds the outcome of an action execution
type Result struct {
	Action  string
	Output  string
	Error   error
	Elapsed time.Duration
}

// Execute spawns `cbai <action>` and captures its output
func Execute(ctx context.Context, action string, text string) Result {
	return ExecuteWithOptions(ctx, action, text, Options{})
}

// ExecuteWithOptions spawns `cbai run <action>` with optional execution controls.
func ExecuteWithOptions(ctx context.Context, action string, text string, opts Options) Result {
	return executeWithOptionsFn(ctx, action, text, opts)
}

// SetExecuteFunc overrides the executor implementation (useful for tests).
func SetExecuteFunc(fn ExecuteFunc) {
	executeFn = fn
	executeWithOptionsFn = func(ctx context.Context, action string, text string, _ Options) Result {
		return fn(ctx, action, text)
	}
}

// SetExecuteWithOptionsFunc overrides ExecuteWithOptions behavior (useful for tests).
func SetExecuteWithOptionsFunc(fn ExecuteWithOptionsFunc) {
	executeWithOptionsFn = fn
	executeFn = func(ctx context.Context, action string, text string) Result {
		return fn(ctx, action, text, Options{})
	}
}

// ResetExecuteFunc restores the default executor implementation.
func ResetExecuteFunc() {
	executeFn = runExecute
	executeWithOptionsFn = runExecuteWithOptions
}

func runExecuteWithOptions(ctx context.Context, action string, text string, opts Options) Result {
	start := time.Now()

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "cbai", "run", action)
	cmd.Env = append(os.Environ(), "CBAI_DAEMON_MODE=true")
	if opts.Trigger != "" {
		cmd.Env = append(cmd.Env, "CBAI_TRIGGER="+opts.Trigger)
	}
	if text != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_TEXT="+text)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	elapsed := time.Since(start)

	output := stdout.String()
	if output == "" && stderr.String() != "" {
		output = stderr.String()
	}

	return Result{
		Action:  action,
		Output:  output,
		Error:   err,
		Elapsed: elapsed,
	}
}

func runExecute(ctx context.Context, action string, text string) Result {
	return runExecuteWithOptions(ctx, action, text, Options{})
}
