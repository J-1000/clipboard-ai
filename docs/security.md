# Security

## Sensitive-data guard

The sensitive-data guard scans clipboard text before an action runs. Configure it in `~/.clipboard-ai/config.toml`:

```toml
[settings]
sensitive_guard = "warn" # "block", "warn", or "off"
```

Modes:

- `warn`: notify or print a warning, then run the action.
- `block`: skip daemon-triggered actions; manual CLI actions require `--force`.
- `off`: do not scan clipboard text before actions.

The scanner currently detects likely AWS access keys, generic `api_key` assignments, JWTs, private-key headers, and Luhn-valid credit-card numbers. The pattern list is implemented in both Go (`agent/internal/guard`) and TypeScript (`cli/src/lib/sensitive-guard.ts`) and should stay in sync.

When the guard fires, clipboard content is not written to history. The history record keeps action metadata but replaces input with `[sensitive content omitted]` and omits output.

## Monitoring privacy controls

Automatic monitoring can be paused, resumed, or snoozed with the CLI, native
menubar app, or authenticated `/controls` HTTP endpoint. Pause and snooze clear
the clipboard payload currently retained by the agent.

The `[privacy]` configuration can also restrict reads according to the
frontmost macOS application:

```toml
[privacy]
start_paused = false
default_snooze_minutes = 15
app_allowlist = []
app_denylist = ["1Password", "com.example.BankingApp"]
```

Entries may be display names or bundle identifiers. If the allowlist is
non-empty, all unlisted applications are blocked; the denylist always wins.
The agent checks the policy before reading `NSPasteboard`, so a blocked payload
is not copied into agent memory. Explicit content submitted by a local API or
MCP client remains the caller's responsibility.

These controls govern automatic monitoring. A manual action is an explicit
request, so it reads the clipboard at the moment it runs: `cbai <action>`,
`cbai clipboard`, menubar quick actions, and the Raycast commands work while
monitoring is paused or snoozed. Such a read is not stored by the monitor and
never triggers other actions. MCP tool calls without `text` do not do this;
they use what monitoring last read.

## Local transports and credentials

The primary IPC socket lives at `~/.clipboard-ai/agent.sock`; its directory and
socket are restricted to the current user. The CLI and native menubar app use
this private socket. A socket-only `/provider-chain` endpoint supplies selected
provider credentials to the CLI and is not registered on the TCP HTTP server.

The optional TCP API is disabled by default, requires an auth token, and must
bind to loopback unless `http_allow_remote = true` is explicitly configured.
`GET /config` redacts all provider API keys and the HTTP auth token. Treat the
HTTP token as a password because authenticated callers can read clipboard and
history content and can execute actions.

Automatic text and RTF payloads are sent to the CLI through stdin, capped in
the agent at 100,000 Unicode characters, instead of being exposed through child
process environment variables. Image inputs use a private temporary file that
is removed after execution.

## Plugin trust model

Plugin actions in `~/.clipboard-ai/actions` run as local JavaScript with your user privileges. Only install trusted code and keep the plugin directory private to your account.
