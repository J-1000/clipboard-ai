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
	Timeout           time.Duration
	Trigger           string
	InputType         string
	InputRTF          string
	InputImagePath    string
	InputImageMime    string
	SensitiveGuardHit bool
	ModelOverride     string
	EndpointOverride  string
	Args              []string
}

// ExecuteFunc allows tests to override the executor behavior.
type ExecuteFunc func(ctx context.Context, action string, text string) Result

// ExecuteWithOptionsFunc allows tests to override ExecuteWithOptions behavior.
type ExecuteWithOptionsFunc func(ctx context.Context, action string, text string, opts Options) Result

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
	executeWithOptionsFn = func(ctx context.Context, action string, text string, _ Options) Result {
		return fn(ctx, action, text)
	}
}

// SetExecuteWithOptionsFunc overrides ExecuteWithOptions behavior (useful for tests).
func SetExecuteWithOptionsFunc(fn ExecuteWithOptionsFunc) {
	executeWithOptionsFn = fn
}

// ResetExecuteFunc restores the default executor implementation.
func ResetExecuteFunc() {
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

	cmdArgs := append([]string{"run", action}, opts.Args...)
	cmd := exec.CommandContext(ctx, "cbai", cmdArgs...)
	cmd.Env = append(os.Environ(), "CBAI_DAEMON_MODE=true")
	if opts.Trigger != "" {
		cmd.Env = append(cmd.Env, "CBAI_TRIGGER="+opts.Trigger)
	}
	if opts.InputType != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_TYPE="+opts.InputType)
	}
	if text != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_TEXT="+text)
	}
	if opts.InputRTF != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_RTF="+opts.InputRTF)
	}
	if opts.InputImagePath != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_IMAGE_PATH="+opts.InputImagePath)
	}
	if opts.InputImageMime != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_IMAGE_MIME="+opts.InputImageMime)
	}
	if opts.SensitiveGuardHit {
		cmd.Env = append(cmd.Env, "CBAI_SENSITIVE_GUARD_HIT=true")
	}
	if opts.ModelOverride != "" {
		cmd.Env = append(cmd.Env, "CBAI_MODEL_OVERRIDE="+opts.ModelOverride)
	}
	if opts.EndpointOverride != "" {
		cmd.Env = append(cmd.Env, "CBAI_ENDPOINT_OVERRIDE="+opts.EndpointOverride)
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

// WriteTempImage writes image bytes to a temp file and returns its path.
func WriteTempImage(data []byte) (string, error) {
	file, err := os.CreateTemp("", "clipboard-ai-image-*.png")
	if err != nil {
		return "", err
	}
	defer file.Close()

	if _, err := file.Write(data); err != nil {
		os.Remove(file.Name())
		return "", err
	}

	return file.Name(), nil
}
