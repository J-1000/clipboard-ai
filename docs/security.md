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

## Plugin trust model

Plugin actions in `~/.clipboard-ai/actions` run as local JavaScript with your user privileges. Only install trusted code and keep the plugin directory private to your account.
