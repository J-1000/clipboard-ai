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

# Ask about config
read -p "Remove configuration directory ($CONFIG_DIR)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing configuration..."
    rm -rf "$CONFIG_DIR"
fi

echo
echo "Uninstallation complete!"
