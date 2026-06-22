# Clipboard AI for Raycast

Run [clipboard-ai](../../README.md) actions on your current clipboard directly
from Raycast, via the agent's local HTTP API.

## Commands

- **Summarize Clipboard** — concise summary of the clipboard text
- **Explain Clipboard** — explain the clipboard (good for code)
- **Translate Clipboard** — translate to a target language (argument)
- **Classify Clipboard** — categorize the clipboard content
- **Extract Data from Clipboard** — pull structured JSON out of the clipboard
- **Summarize Clipboard URL** — fetch and summarize a URL on the clipboard
- **Clipboard AI History** — browse recent action runs
- **Setup Clipboard AI** — shows the required local HTTP API configuration

## Setup

The extension talks to the agent over its local HTTP API, which is **disabled by
default**. Enable it in `~/.clipboard-ai/config.toml`:

```toml
[settings]
http_enabled = true
http_addr = "127.0.0.1:9159"
http_auth_token = "set-a-long-random-token"
```

Then restart the agent and set the extension preferences:

- **HTTP API Base URL** — e.g. `http://127.0.0.1:9159`
- **HTTP Auth Token** — the value of `http_auth_token`

Run **Setup Clipboard AI** for a guided summary. If a command reports it can't
reach the API, it will show the exact steps to fix it.

## Notes

- The auth token grants full access to the API (including clipboard content and
  history) — treat it like a password.
- Requests time out after 60 seconds.
