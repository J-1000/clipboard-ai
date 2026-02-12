package executor

import (
	"bytes"
	"context"
	"os/exec"
	"time"
)

const defaultTimeout = 30 * time.Second

// Result holds the outcome of an action execution
type Result struct {
	Action  string
	Output  string
	Error   error
	Elapsed time.Duration
}

// Execute spawns `cbai <action>` and captures its output
func Execute(ctx context.Context, action string) Result {
	start := time.Now()

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "cbai", action)
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
