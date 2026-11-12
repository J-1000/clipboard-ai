# Native menubar app

The SwiftUI menubar app is a private local client for `clipboard-ai-agent`. It
connects directly to `~/.clipboard-ai/agent.sock`; the optional TCP HTTP server
does not need to be enabled, and no HTTP auth token is stored in the app.

## Requirements

- macOS 14 or newer
- A running `clipboard-ai-agent` and installed `cbai` CLI
- Swift 6 / Xcode 16 for source builds

## Run from source

```bash
cd menubar
swift run ClipboardAIMenuBar
```

The app is an accessory application, so it appears only in the system menubar.
Choose **Quit** from the bottom of its window to stop it.

Tagged release automation is configured to package a standard
`Clipboard AI.app` for Apple Silicon and Intel Macs. No release is currently
published; see the release-availability note in the main README.

## What the app exposes

- Live agent and monitoring state, with pause, resume, and 15/30/60-minute or
  configured-default snooze controls
- Quick clipboard actions for Summary, Explain, Improve, and TL;DR, plus
  Classify, Extract, Caption, and OCR in the overflow menu
- The newest 50 history records, with inputs, outputs, errors, provider/model
  metadata, source, trigger, latency, and timestamps
- **Run Again** for retained text inputs and **Copy Result** for successful runs
- A read-only view of the active provider profiles, behavior, privacy settings,
  and configured actions; provider secrets are redacted by the agent

History entries whose input was suppressed by the sensitive-data guard cannot
be replayed. Image history stores a placeholder rather than the original image,
so image runs also cannot be replayed from history; use a quick action on the
current clipboard instead.

Quick actions read the clipboard at the moment you click, so they also work
while monitoring is paused or snoozed. Runs started from the app are recorded
in history with the source `menubar`.

Quick actions and replay requests still pass through the agent's safe-mode,
sensitive-data, provider-limit, and concurrency checks. Application failures
are shown in the app with the diagnostic returned by the CLI.

## Keyboard access and appearance

- `Command-R`: refresh status, history, and settings
- `Command-Shift-R`: replay the selected history record
- `Command-C`: copy the visible result
- `Command-Q`: quit the app

The interface follows the system light/dark appearance, supports selectable
result text and VoiceOver labels, and removes movement from transient feedback
when Reduce Motion is enabled.
