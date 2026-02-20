package executor

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"time"
)

const defaultTimeout = 30 * time.Second

// ExecuteFunc allows tests to override the executor behavior.
type ExecuteFunc func(ctx context.Context, action string, text string) Result

var executeFn ExecuteFunc = runExecute

// Result holds the outcome of an action execution
type Result struct {
	Action  string
	Output  string
	Error   error
	Elapsed time.Duration
}

// Execute spawns `cbai <action>` and captures its output
func Execute(ctx context.Context, action string, text string) Result {
	return executeFn(ctx, action, text)
}

// SetExecuteFunc overrides the executor implementation (useful for tests).
func SetExecuteFunc(fn ExecuteFunc) {
	executeFn = fn
}

// ResetExecuteFunc restores the default executor implementation.
func ResetExecuteFunc() {
	executeFn = runExecute
}

func runExecute(ctx context.Context, action string, text string) Result {
	start := time.Now()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "cbai", action)
	cmd.Env = append(os.Environ(), "CBAI_DAEMON_MODE=true")
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
