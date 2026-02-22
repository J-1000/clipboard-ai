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

- `image_base64`
- `image_mime`
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
```

## Integration Examples

See:

- `docs/integrations/local-http-clients.md`
- `scripts/examples/http-action.sh`
