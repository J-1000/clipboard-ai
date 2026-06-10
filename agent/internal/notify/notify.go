package notify

import (
	"os/exec"
)

// Send displays a macOS notification using osascript
func Send(title, message string) error {
	cmd := notificationCommand(title, "", message, false)
	return cmd.Run()
}

// SendWithSubtitle displays a notification with a subtitle
func SendWithSubtitle(title, subtitle, message string) error {
	cmd := notificationCommand(title, subtitle, message, false)
	return cmd.Run()
}

// SendWithSound displays a notification with the default sound
func SendWithSound(title, message string) error {
	cmd := notificationCommand(title, "", message, true)
	return cmd.Run()
}

func notificationCommand(title, subtitle, message string, sound bool) *exec.Cmd {
	script := `on run argv
  set notificationTitle to item 1 of argv
  set notificationMessage to item 2 of argv
  if (count of argv) is greater than or equal to 3 and item 3 of argv is not "" then
    set notificationSubtitle to item 3 of argv
    if (count of argv) is greater than or equal to 4 and item 4 of argv is "default" then
      display notification notificationMessage with title notificationTitle subtitle notificationSubtitle sound name "default"
    else
      display notification notificationMessage with title notificationTitle subtitle notificationSubtitle
    end if
  else
    if (count of argv) is greater than or equal to 4 and item 4 of argv is "default" then
      display notification notificationMessage with title notificationTitle sound name "default"
    else
      display notification notificationMessage with title notificationTitle
    end if
  end if
end run`

	args := []string{"-e", script, title, message, subtitle}
	if sound {
		args = append(args, "default")
	}

	return exec.Command("osascript", args...)
}
