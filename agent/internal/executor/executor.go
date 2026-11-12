package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	defaultTimeout = 30 * time.Second
	maxInputRunes  = 100_000
	truncatedMark  = "\n…[truncated]"
)

type inputEnvelope struct {
	Text string `json:"text"`
	RTF  string `json:"rtf,omitempty"`
}

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
	// Source names the client that asked for a manual run through the agent
	// (menubar, raycast, mcp, api). Empty for automatic clipboard triggers.
	Source string
}

// ExecuteFunc allows tests to override the executor behavior.
type ExecuteFunc func(ctx context.Context, action string, text string) Result

// ExecuteWithOptionsFunc allows tests to override ExecuteWithOptions behavior.
type ExecuteWithOptionsFunc func(ctx context.Context, action string, text string, opts Options) Result

var executeWithOptionsFn ExecuteWithOptionsFunc = runExecuteWithOptions

// Result holds the outcome of an action execution
type Result struct {
	Action  string
	Output  string // the CLI's stdout: the action result
	Stderr  string // the CLI's stderr: warnings and error messages
	Error   error
	Elapsed time.Duration
}

// Diagnostic returns the most useful explanation of a failed run: the CLI's
// stderr when it wrote any, otherwise its stdout, otherwise the process error.
func (r Result) Diagnostic() string {
	if s := strings.TrimSpace(r.Stderr); s != "" {
		return s
	}
	if s := strings.TrimSpace(r.Output); s != "" {
		return s
	}
	if r.Error != nil {
		return r.Error.Error()
	}
	return ""
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

	// Separate user-controlled args with "--" so clipboard-derived values can't
	// be parsed as cbai global flags (e.g. an injected --force bypassing the
	// sensitive-data guard). cbai routes post-"--" tokens into the action args.
	cmdArgs := append([]string{"run", action, "--"}, opts.Args...)
	cmd := exec.CommandContext(ctx, "cbai", cmdArgs...)
	cmd.Env = append(os.Environ(), "CBAI_DAEMON_MODE=true")
	// If the CLI leaves a child holding its output pipes open, don't wait on
	// them forever once the process itself has been killed.
	cmd.WaitDelay = 2 * time.Second
	if opts.Trigger != "" {
		cmd.Env = append(cmd.Env, "CBAI_TRIGGER="+opts.Trigger)
	}
	if opts.Source != "" {
		cmd.Env = append(cmd.Env, "CBAI_SOURCE="+opts.Source)
	}
	if opts.InputType != "" {
		cmd.Env = append(cmd.Env, "CBAI_INPUT_TYPE="+opts.InputType)
	}
	if text != "" || opts.InputRTF != "" {
		payload, err := json.Marshal(inputEnvelope{
			Text: capInput(text),
			RTF:  capInput(opts.InputRTF),
		})
		if err != nil {
			return Result{Action: action, Error: err, Elapsed: time.Since(start)}
		}
		cmd.Env = append(cmd.Env, "CBAI_INPUT_STDIN=json")
		cmd.Stdin = bytes.NewReader(payload)
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
	if ctxErr := ctx.Err(); ctxErr != nil {
		err = ctxErr
	}

	elapsed := time.Since(start)

	return Result{
		Action:  action,
		Output:  stdout.String(),
		Stderr:  stderr.String(),
		Error:   err,
		Elapsed: elapsed,
	}
}

func capInput(value string) string {
	runes := []rune(value)
	if len(runes) <= maxInputRunes {
		return value
	}
	return string(runes[:maxInputRunes]) + truncatedMark
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
