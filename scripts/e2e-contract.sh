#!/bin/bash
# End-to-end contract test for the agent <-> CLI seam.
#
# Builds the real agent and the real CLI bundle, starts the agent in an isolated
# HOME with monitoring paused (so the developer's clipboard is never read), and
# checks what POST /action returns for success, JSON actions, provider failure,
# safe-mode blocking, and unknown actions. Unit tests mock this seam, so this
# script is the only place the two halves are exercised together.
#
# Requirements: macOS, go, bun, node, curl, jq.
# Usage: ./scripts/e2e-contract.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
AGENT_PID=""
STUB_PID=""

cleanup() {
    for pid in "$AGENT_PID" "$STUB_PID"; do
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    rm -rf "$WORK"
}
trap cleanup EXIT

for tool in go bun node curl jq; do
    command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 2; }
done

echo "==> building agent and CLI"
mkdir -p "$WORK/bin" "$WORK/home/.clipboard-ai"
(cd "$ROOT/agent" && go build -o "$WORK/bin/clipboard-ai-agent" ./cmd/clipboard-ai-agent/)
(cd "$ROOT/cli" && bun install --frozen-lockfile >/dev/null && bun build src/index.ts --outdir "$WORK/cli" --target node >/dev/null)
cp "$WORK/cli/index.js" "$WORK/bin/cbai"
chmod +x "$WORK/bin/cbai"

echo "==> starting stub provider"
node "$ROOT/scripts/e2e/stub-provider.mjs" > "$WORK/stub.log" 2>&1 &
STUB_PID=$!
PORT=""
for _ in $(seq 1 50); do
    PORT="$(sed -n 's/^PORT=//p' "$WORK/stub.log" | head -1)"
    [[ -n "$PORT" ]] && break
    sleep 0.1
done
[[ -n "$PORT" ]] || { echo "stub provider did not start" >&2; cat "$WORK/stub.log" >&2; exit 1; }

cat > "$WORK/home/.clipboard-ai/config.toml" <<TOML
[provider]
type = "ollama"
endpoint = "http://127.0.0.1:$PORT/v1"
model = "stub"

[settings]
safe_mode = true
notifications = false
history_enabled = true
sensitive_guard = "off"

[privacy]
start_paused = true

[actions.summarize]
enabled = false
trigger = ""

[actions.explain]
enabled = false
trigger = ""

# Routed to a closed port: exercises the provider-failure path.
[actions.tldr]
enabled = false
trigger = ""
endpoint = "http://127.0.0.1:9/v1"

# Routed to a non-local endpoint: exercises the safe-mode path.
[actions.improve]
enabled = false
trigger = ""
endpoint = "https://example.invalid/v1"
TOML

echo "==> starting agent"
SOCK="$WORK/home/.clipboard-ai/agent.sock"
HOME="$WORK/home" PATH="$WORK/bin:$PATH" "$WORK/bin/clipboard-ai-agent" > "$WORK/agent.log" 2>&1 &
AGENT_PID=$!
for _ in $(seq 1 50); do
    [[ -S "$SOCK" ]] && break
    sleep 0.1
done
[[ -S "$SOCK" ]] || { echo "agent did not create its socket" >&2; cat "$WORK/agent.log" >&2; exit 1; }

FAILURES=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; echo "      $2"; FAILURES=$((FAILURES + 1)); }

# call_action <json body> -> prints the response body
call_action() {
    curl -sS --max-time 60 --unix-socket "$SOCK" -H "Content-Type: application/json" \
        -d "$1" http://localhost/action
}

# 1. A text action returns exactly the model output: no progress line, no header.
RESP="$(call_action '{"action":"summary","text":"hello world"}')"
if [[ "$(jq -r '.success' <<<"$RESP")" == "true" && "$(jq -r '.result' <<<"$RESP")" == "STUB-OUTPUT" ]]; then
    pass "summary returns the bare model output"
else
    fail "summary returns the bare model output" "$RESP"
fi

# 2. A JSON action returns parseable JSON.
RESP="$(call_action '{"action":"classify","text":"hello world"}')"
if [[ "$(jq -r '.success' <<<"$RESP")" == "true" ]] && jq -e '.result | fromjson | .category == "other"' <<<"$RESP" >/dev/null 2>&1; then
    pass "classify result is parseable JSON"
else
    fail "classify result is parseable JSON" "$RESP"
fi

# 3. A provider failure reports the real error, not the progress message.
RESP="$(call_action '{"action":"tldr","text":"hello world"}')"
ERR="$(jq -r '.error // ""' <<<"$RESP")"
if [[ "$(jq -r '.success' <<<"$RESP")" == "false" && "$ERR" == *"all provider profiles failed"* && "$ERR" != *"Summarizing"* ]]; then
    pass "provider failure carries the CLI diagnostic"
else
    fail "provider failure carries the CLI diagnostic" "$RESP"
fi

# 4. A safe-mode block is reported as a safe-mode block.
RESP="$(call_action '{"action":"improve","text":"hello world"}')"
ERR="$(jq -r '.error // ""' <<<"$RESP")"
if [[ "$(jq -r '.success' <<<"$RESP")" == "false" && "$ERR" == *"safe mode"* ]]; then
    pass "safe-mode block is reported as such"
else
    fail "safe-mode block is reported as such" "$RESP"
fi

# 5. With monitoring paused and no text supplied there is nothing to act on.
RESP="$(call_action '{"action":"summary"}')"
if [[ "$(jq -r '.success' <<<"$RESP")" == "false" && "$(jq -r '.error' <<<"$RESP")" == "No content available" ]]; then
    pass "no input yields 'No content available'"
else
    fail "no input yields 'No content available'" "$RESP"
fi

# 6. A malformed action name is rejected before anything is spawned.
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --unix-socket "$SOCK" -H "Content-Type: application/json" \
    -d '{"action":"bad name;","text":"x"}' http://localhost/action)"
if [[ "$CODE" == "400" ]]; then
    pass "malformed action name returns 400"
else
    fail "malformed action name returns 400" "status $CODE"
fi

# 7. Runs requested through the agent are labelled with the requesting client.
call_action '{"action":"summary","text":"hello world","source":"raycast"}' >/dev/null
HIST="$(curl -sS --unix-socket "$SOCK" 'http://localhost/history?limit=1')"
if [[ "$(jq -r '.records[0].source' <<<"$HIST")" == "raycast" ]]; then
    pass "history records the requesting client"
else
    fail "history records the requesting client" "$HIST"
fi

echo
if [[ "$FAILURES" -gt 0 ]]; then
    echo "$FAILURES contract check(s) failed"
    echo "--- agent log ---"
    tail -20 "$WORK/agent.log"
    exit 1
fi
echo "all contract checks passed"
