package notify

import (
	"os/exec"
	"strings"
)

// Send displays a macOS notification using osascript
func Send(title, message string) error {
	// Escape double quotes in the message
	title = strings.ReplaceAll(title, `"`, `\"`)
	message = strings.ReplaceAll(message, `"`, `\"`)

	script := `display notification "` + message + `" with title "` + title + `"`
	cmd := exec.Command("osascript", "-e", script)
	return cmd.Run()
}

// SendWithSubtitle displays a notification with a subtitle
func SendWithSubtitle(title, subtitle, message string) error {
	title = strings.ReplaceAll(title, `"`, `\"`)
	subtitle = strings.ReplaceAll(subtitle, `"`, `\"`)
	message = strings.ReplaceAll(message, `"`, `\"`)

	script := `display notification "` + message + `" with title "` + title + `" subtitle "` + subtitle + `"`
	cmd := exec.Command("osascript", "-e", script)
	return cmd.Run()
}

// SendWithSound displays a notification with the default sound
func SendWithSound(title, message string) error {
	title = strings.ReplaceAll(title, `"`, `\"`)
	message = strings.ReplaceAll(message, `"`, `\"`)

	script := `display notification "` + message + `" with title "` + title + `" sound name "default"`
	cmd := exec.Command("osascript", "-e", script)
	return cmd.Run()
}
