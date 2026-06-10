package notify

import (
	"strings"
	"testing"
)

func TestNotificationCommandPassesTextAsArguments(t *testing.T) {
	tests := []struct {
		name     string
		title    string
		subtitle string
		message  string
		sound    bool
	}{
		{
			name:    "quotes",
			title:   `Test "Title"`,
			message: `A "quoted" message`,
		},
		{
			name:    "backslashes",
			title:   `C:\Users\test`,
			message: `path \ with \ backslashes`,
		},
		{
			name:    "quote after backslash",
			title:   `Prefix \" title`,
			message: `Prefix \" message`,
		},
		{
			name:    "newlines",
			title:   "Line 1\nLine 2",
			message: "Body 1\nBody 2",
		},
		{
			name:    "injection payload",
			title:   `\" & (do shell script "touch /tmp/pwned") & "`,
			message: `\" & (do shell script "touch /tmp/pwned") & "`,
		},
		{
			name:     "subtitle and sound",
			title:    `Title "quoted"`,
			subtitle: `Sub \" title`,
			message:  "Message\nbody",
			sound:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cmd := notificationCommand(tt.title, tt.subtitle, tt.message, tt.sound)

			if cmd.Args[0] != "osascript" {
				t.Fatalf("expected osascript command, got %q", cmd.Args[0])
			}

			args := cmd.Args
			if len(args) < 6 {
				t.Fatalf("expected osascript, -e, script, title, message, subtitle args; got %q", args)
			}
			if args[0] != "osascript" || args[1] != "-e" {
				t.Fatalf("unexpected command prefix: %q", args[:2])
			}

			script := args[2]
			assertNoUserTextInScript(t, script, tt.title)
			assertNoUserTextInScript(t, script, tt.subtitle)
			assertNoUserTextInScript(t, script, tt.message)

			if args[3] != tt.title {
				t.Fatalf("title arg mismatch: got %q want %q", args[3], tt.title)
			}
			if args[4] != tt.message {
				t.Fatalf("message arg mismatch: got %q want %q", args[4], tt.message)
			}
			if args[5] != tt.subtitle {
				t.Fatalf("subtitle arg mismatch: got %q want %q", args[5], tt.subtitle)
			}

			if tt.sound {
				if len(args) != 7 || args[6] != "default" {
					t.Fatalf("expected default sound arg, got %q", args)
				}
				return
			}
			if len(args) != 6 {
				t.Fatalf("unexpected extra args without sound: %q", args)
			}
		})
	}
}

func TestNotificationCommandScriptUsesArgv(t *testing.T) {
	cmd := notificationCommand("title", "subtitle", "message", true)
	script := cmd.Args[2]

	for _, want := range []string{
		"on run argv",
		"item 1 of argv",
		"item 2 of argv",
		"item 3 of argv",
		`display notification notificationMessage`,
		`sound name "default"`,
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q:\n%s", want, script)
		}
	}
}

func assertNoUserTextInScript(t *testing.T, script, text string) {
	t.Helper()
	if text != "" && strings.Contains(script, text) {
		t.Fatalf("script contains user-controlled text %q:\n%s", text, script)
	}
}
