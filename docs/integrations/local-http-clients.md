# Local HTTP Integration Snippets

These examples assume:

- API enabled at `http://127.0.0.1:9159`
- Token available in `CBAI_HTTP_TOKEN`

## Raycast Script Command

Create a Script Command in Raycast with:

```bash
#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title CBAI TLDR
# @raycast.mode compact

set -euo pipefail

BASE="http://127.0.0.1:9159"
TOKEN="${CBAI_HTTP_TOKEN:?set CBAI_HTTP_TOKEN}"

curl -s "$BASE/action" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"tldr"}' | jq -r '.result // .error'
```

## Alfred Script Filter (Bash)

Use a Script Filter that outputs JSON:

```bash
#!/bin/bash
set -euo pipefail

BASE="http://127.0.0.1:9159"
TOKEN="${CBAI_HTTP_TOKEN:?set CBAI_HTTP_TOKEN}"

RESULT=$(curl -s "$BASE/action" \
  -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"summarize"}')

TEXT=$(printf "%s" "$RESULT" | jq -r '.result // .error')

jq -n --arg t "$TEXT" '{items:[{title:"clipboard-ai",subtitle:$t,arg:$t}]}'
```

## Editor Shell Task (VS Code)

Example one-liner task command:

```bash
curl -s http://127.0.0.1:9159/action \
  -H "X-Clipboard-AI-Token: $CBAI_HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"explain"}'
```
