# Local HTTP API

The agent can expose a localhost HTTP API for external integrations.

- Disabled by default
- Requires token auth on every request
- Intended for local tools (Raycast, Alfred, editor scripts)

## Enable

Set in `~/.clipboard-ai/config.toml`:

```toml
[settings]
http_enabled = true
http_addr = "127.0.0.1:9159"
http_auth_token = "replace-with-a-long-random-token"
```

Restart the agent after changing config.

## Authentication

Pass one of these headers with the configured token value:

- `Authorization: Bearer <token>`
- `X-API-Key: <token>`
- `X-Clipboard-AI-Token: <token>`

If auth is missing or invalid, API returns `401 Unauthorized`.

## Versioning

Every response carries an `X-API-Version` header (currently `1`). A breaking
change to the API will bump this value, so clients can detect incompatibility
without relying on a path prefix.

## Endpoints

Base URL: `http://127.0.0.1:9159`

### `GET /status`

Returns agent status and clipboard preview.

```json
{
  "status": "running",
  "uptime": "3m12s",
  "version": "v1.0.0",
  "clipboard": {
    "text": "latest clipboard preview...",
    "type": "text",
    "timestamp": "2026-02-22T12:00:00Z"
  }
}
```

### `GET /clipboard`

Returns current clipboard payload.

Text payload:

```json
{
  "text": "full clipboard text",
  "type": "text",
  "timestamp": "2026-02-22T12:00:00Z",
  "length": 19
}
```

Image payload includes:

- `image_base64` (omitted when the image exceeds the 25 MB cap)
- `image_mime`
- `image_size_bytes` — raw image size in bytes
- `image_truncated` — `true` when the image was too large to inline (so
  `image_base64` is omitted)
- `type: "image"`

RTF payload includes:

- `rtf`
- `type: "rtf"`

### `GET /config`

Returns active provider/action/settings config used by the running agent.

### `POST /action`

Trigger an action and return the result.

Request body:

```json
{
  "action": "summarize",
  "args": [],
  "text": "optional input override",
  "type": "text"
}
```

Behavior:

- If `text`/`rtf`/`image_base64` are not provided, the agent uses current clipboard content.
- If no content is available, response is:

```json
{
  "success": false,
  "action": "summarize",
  "error": "No content available"
}
```

Success response:

```json
{
  "success": true,
  "action": "summarize",
  "result": "..."
}
```

**Error contract:** `/action` returns **HTTP 200** for *application* failures
(the action ran but errored), with `success: false` and an `error` message — so
clients should branch on the `success` field, not only the status code. *Protocol*
errors (bad method, invalid JSON, unknown/invalid action name, body too large,
rate-limited) return a non-2xx status with a JSON body `{"error": "..."}`.
Unknown or malformed action names return `400`; a saturated action queue returns
`429`.

Use `args` for actions that accept CLI arguments. Example:

```json
{
  "action": "translate",
  "args": ["Spanish"]
}
```

### `GET /history`

Returns recent action history from `~/.clipboard-ai/history.jsonl`, newest first.

Query parameters:

- `limit`: maximum records to return, default `20`, capped at `100`

```json
{
  "records": [
    {
      "id": "mabc123-def456",
      "timestamp": "2026-06-11T12:00:00Z",
      "action": "summarize",
      "args": [],
      "source": "manual",
      "trigger": "cli",
      "provider": "ollama",
      "model": "mistral",
      "latency_ms": 315,
      "status": "success",
      "copy": false,
      "input": "...",
      "output": "...",
      "replay_of": "mxyz789-...optional id this run replayed"
    }
  ],
  "skipped_corrupt": 0
}
```

Additional fields:

- `replay_of` (per record) — present when the run was a replay (`cbai rerun`),
  set to the original run id.
- `skipped_corrupt` (top level) — number of unparseable history lines skipped
  while reading; omitted when `0`.

## Errors

Every non-2xx response uses a JSON body of the form:

```json
{ "error": "message" }
```

`401` is returned for missing/invalid auth; see the `/action` error contract for
the 200-with-`success:false` application-error case.

## Security

`GET /clipboard` and `GET /history` return the **full** clipboard text and stored
action input/output to any holder of the token. Treat `http_auth_token` like a
password, keep `http_addr` on loopback, and see `docs/security.md`.

## cURL Examples

```bash
TOKEN="your-token"
BASE="http://127.0.0.1:9159"

curl -s "$BASE/status" \
  -H "Authorization: Bearer $TOKEN"

curl -s "$BASE/clipboard" \
  -H "X-API-Key: $TOKEN"

curl -s "$BASE/action" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"tldr"}'

curl -s "$BASE/history?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

## Integration Examples

See:

- `docs/integrations/local-http-clients.md`
- `scripts/examples/http-action.sh`
