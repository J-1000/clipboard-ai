#!/bin/bash
# Boot smoke test for the clipboard-ai agent.
#
# A released binary built with CGO_ENABLED=0 boots and then panics in
# clipboard.Init() ("clipboard: cannot use when CGO_ENABLED=0"), and launchd's
# KeepAlive respawns it into a crash loop. This script catches that whole class
# of startup failure: it runs the agent for a couple of seconds and asserts the
# process is still alive (i.e. did not exit non-zero on boot).
set -u

BIN="${1:-}"
if [[ -z "$BIN" || ! -x "$BIN" ]]; then
    echo "usage: $0 <path-to-agent-binary>" >&2
    exit 2
fi

# --version must succeed (exercises the binary without the run loop).
if ! "$BIN" --version; then
    echo "FAIL: agent --version exited non-zero" >&2
    exit 1
fi

# Boot the run loop in the background and confirm it survives.
"$BIN" >/tmp/agent-boot-smoke.log 2>&1 &
PID=$!
sleep 2

if ! kill -0 "$PID" 2>/dev/null; then
    wait "$PID"
    CODE=$?
    echo "FAIL: agent exited within 2s (code $CODE)" >&2
    echo "--- agent output ---" >&2
    cat /tmp/agent-boot-smoke.log >&2
    exit 1
fi

kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
echo "PASS: agent booted and stayed alive for 2s"
