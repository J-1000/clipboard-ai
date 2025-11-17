#!/bin/bash
set -e

# clipboard-ai installer
# This script installs the clipboard-ai agent and CLI

INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
CONFIG_DIR="$HOME/.clipboard-ai"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="ai.clipboard.agent.plist"

echo "clipboard-ai installer"
echo "======================"
echo

# Check for macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: clipboard-ai only supports macOS"
    exit 1
fi

# Create config directory
echo "Creating config directory..."
mkdir -p "$CONFIG_DIR"

# Copy default config if not exists
if [[ ! -f "$CONFIG_DIR/config.toml" ]]; then
    echo "Installing default configuration..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cp "$SCRIPT_DIR/../configs/default.toml" "$CONFIG_DIR/config.toml"
fi

# Build the Go agent
echo "Building clipboard-ai-agent..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../agent"

if command -v go &> /dev/null; then
    go build -o clipboard-ai-agent ./cmd/clipboard-ai-agent/

    echo "Installing agent to $INSTALL_DIR..."
    sudo cp clipboard-ai-agent "$INSTALL_DIR/"
    rm clipboard-ai-agent
else
    echo "Warning: Go not found, skipping agent build"
    echo "Please install the agent binary manually"
fi

# Build and install CLI
echo "Building cbai CLI..."
cd "$SCRIPT_DIR/../cli"

if command -v bun &> /dev/null; then
    bun install
    bun run build

    echo "Installing CLI to $INSTALL_DIR..."
    sudo cp dist/index.js "$INSTALL_DIR/cbai"
    sudo chmod +x "$INSTALL_DIR/cbai"
elif command -v npm &> /dev/null; then
    npm install
    npm run build

    echo "Installing CLI to $INSTALL_DIR..."
    sudo cp dist/index.js "$INSTALL_DIR/cbai"
    sudo chmod +x "$INSTALL_DIR/cbai"
else
    echo "Warning: Neither bun nor npm found, skipping CLI build"
fi

# Install LaunchAgent
echo "Installing LaunchAgent..."
mkdir -p "$LAUNCH_AGENTS_DIR"

PLIST_SOURCE="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$LAUNCH_AGENTS_DIR/$PLIST_NAME"

# Replace placeholders
sed -e "s|__INSTALL_PATH__|$INSTALL_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    "$PLIST_SOURCE" > "$PLIST_DEST"

# Load the agent
echo "Loading LaunchAgent..."
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo
echo "Installation complete!"
echo
echo "The agent is now running in the background."
echo "Use 'cbai status' to check the agent status."
echo "Use 'cbai --help' to see available commands."
echo
echo "Configuration file: $CONFIG_DIR/config.toml"
