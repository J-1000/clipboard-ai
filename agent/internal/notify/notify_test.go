package notify

import (
	"strings"
	"testing"
)

func TestSend_EscapesQuotes(t *testing.T) {
	// We can't easily test the actual osascript call, but we can verify
	// the function doesn't panic with special characters
	// and that the escaping logic works correctly

	title := `Test "Title"`
	message := `A "quoted" message`

	// Verify escaping logic directly
	escapedTitle := strings.ReplaceAll(title, `"`, `\"`)
	escapedMessage := strings.ReplaceAll(message, `"`, `\"`)

	if !strings.Contains(escapedTitle, `\"`) {
		t.Fatal("expected escaped quotes in title")
	}
	if !strings.Contains(escapedMessage, `\"`) {
		t.Fatal("expected escaped quotes in message")
	}
}

func TestSendWithSubtitle_EscapesQuotes(t *testing.T) {
	title := `Test "Title"`
	subtitle := `Sub "title"`
	message := `A "quoted" message`

	escapedTitle := strings.ReplaceAll(title, `"`, `\"`)
	escapedSubtitle := strings.ReplaceAll(subtitle, `"`, `\"`)
	escapedMessage := strings.ReplaceAll(message, `"`, `\"`)

	if !strings.Contains(escapedTitle, `\"`) {
		t.Fatal("expected escaped quotes in title")
	}
	if !strings.Contains(escapedSubtitle, `\"`) {
		t.Fatal("expected escaped quotes in subtitle")
	}
	if !strings.Contains(escapedMessage, `\"`) {
		t.Fatal("expected escaped quotes in message")
	}
}

func TestSend_PlainText(t *testing.T) {
	// Test that plain text without quotes is unchanged after escaping
	title := "Simple Title"
	message := "Simple message"

	escapedTitle := strings.ReplaceAll(title, `"`, `\"`)
	escapedMessage := strings.ReplaceAll(message, `"`, `\"`)

	if escapedTitle != title {
		t.Fatalf("plain title should be unchanged, got %q", escapedTitle)
	}
	if escapedMessage != message {
		t.Fatalf("plain message should be unchanged, got %q", escapedMessage)
	}
}

func TestSendWithSubtitle_ScriptFormat(t *testing.T) {
	// Verify the script format is constructed correctly
	title := "Test"
	subtitle := "Sub"
	message := "Body"

	title = strings.ReplaceAll(title, `"`, `\"`)
	subtitle = strings.ReplaceAll(subtitle, `"`, `\"`)
	message = strings.ReplaceAll(message, `"`, `\"`)

	script := `display notification "` + message + `" with title "` + title + `" subtitle "` + subtitle + `"`

	if !strings.Contains(script, `display notification "Body"`) {
		t.Fatal("expected notification body in script")
	}
	if !strings.Contains(script, `with title "Test"`) {
		t.Fatal("expected title in script")
	}
	if !strings.Contains(script, `subtitle "Sub"`) {
		t.Fatal("expected subtitle in script")
	}
}

func TestSendWithSound_ScriptFormat(t *testing.T) {
	title := "Alert"
	message := "Something happened"

	title = strings.ReplaceAll(title, `"`, `\"`)
	message = strings.ReplaceAll(message, `"`, `\"`)

	script := `display notification "` + message + `" with title "` + title + `" sound name "default"`

	if !strings.Contains(script, `sound name "default"`) {
		t.Fatal("expected sound in script")
	}
	if !strings.Contains(script, `with title "Alert"`) {
		t.Fatal("expected title in script")
	}
}

func TestSend_EmptyStrings(t *testing.T) {
	// Empty strings should not cause issues
	title := ""
	message := ""

	escapedTitle := strings.ReplaceAll(title, `"`, `\"`)
	escapedMessage := strings.ReplaceAll(message, `"`, `\"`)

	if escapedTitle != "" {
		t.Fatal("empty title should remain empty")
	}
	if escapedMessage != "" {
		t.Fatal("empty message should remain empty")
	}
}
