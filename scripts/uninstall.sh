#!/bin/bash
set -e

# clipboard-ai uninstaller
# This script removes the clipboard-ai agent and CLI

INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
CONFIG_DIR="$HOME/.clipboard-ai"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="ai.clipboard.agent.plist"

echo "clipboard-ai uninstaller"
echo "========================"
echo

# Check for macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: clipboard-ai only supports macOS"
    exit 1
fi

# Stop the agent
echo "Stopping agent..."
PLIST_DEST="$LAUNCH_AGENTS_DIR/$PLIST_NAME"
if [[ -f "$PLIST_DEST" ]]; then
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
    rm "$PLIST_DEST"
fi

# Remove binaries
echo "Removing binaries..."
sudo rm -f "$INSTALL_DIR/clipboard-ai-agent"
sudo rm -f "$INSTALL_DIR/cbai"

# Always remove the runtime socket so a stale one isn't left behind.
rm -f "$CONFIG_DIR/agent.sock"

# --all removes everything without prompting.
REMOVE_ALL=false
[[ "${1:-}" == "--all" ]] && REMOVE_ALL=true

confirm() {
    # $1 = prompt. Returns 0 (yes) when --all or the user answers y.
    if [[ "$REMOVE_ALL" == true ]]; then
        return 0
    fi
    read -p "$1 [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
}

# Logs and history are removed independently of config so you can keep your
# settings while clearing data (or vice versa).
if [[ -f "$CONFIG_DIR/agent.log" || -f "$CONFIG_DIR/agent.err" ]]; then
    if confirm "Remove agent logs (agent.log, agent.err)?"; then
        rm -f "$CONFIG_DIR/agent.log" "$CONFIG_DIR/agent.err"
    fi
fi

if [[ -f "$CONFIG_DIR/history.jsonl" ]]; then
    echo "Note: history.jsonl contains clipboard content from past action runs."
    if confirm "Remove action history (history.jsonl)?"; then
        rm -f "$CONFIG_DIR/history.jsonl"
    fi
fi

if [[ -f "$CONFIG_DIR/config.toml" ]]; then
    if confirm "Remove configuration (config.toml)?"; then
        rm -f "$CONFIG_DIR/config.toml"
    fi
fi

# Remove the config directory only if it's now empty.
rmdir "$CONFIG_DIR" 2>/dev/null || true

echo
echo "Uninstallation complete!"
