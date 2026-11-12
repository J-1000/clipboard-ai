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

# Both toolchains are required. Check before touching anything, so a missing
# tool cannot leave a LaunchAgent that points at a binary that was never built.
for tool in go bun; do
    if ! command -v "$tool" &> /dev/null; then
        echo "Error: '$tool' is required to build clipboard-ai from source." >&2
        echo "       Go: https://go.dev/dl/   Bun: https://bun.sh/" >&2
        exit 1
    fi
done

# Create config directory
echo "Creating config directory..."
mkdir -p "$CONFIG_DIR"
# The directory holds the config (which may contain an API key), history, and
# the agent socket; keep it private to this user.
chmod 700 "$CONFIG_DIR"

# Copy default config if not exists
if [[ ! -f "$CONFIG_DIR/config.toml" ]]; then
    echo "Installing default configuration..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    cp "$SCRIPT_DIR/../configs/default.toml" "$CONFIG_DIR/config.toml"
fi
chmod 600 "$CONFIG_DIR/config.toml"

# Resolve a version to stamp into both binaries so `cbai doctor`'s daemon/CLI
# version match is meaningful for source installs (not just tagged releases).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CBAI_VERSION="$(git -C "$SCRIPT_DIR/.." describe --tags --always 2>/dev/null || echo dev)"

# Build the Go agent
echo "Building clipboard-ai-agent..."
cd "$SCRIPT_DIR/../agent"

go build -ldflags "-X main.version=$CBAI_VERSION" -o clipboard-ai-agent ./cmd/clipboard-ai-agent/

echo "Installing agent to $INSTALL_DIR..."
# /usr/local/bin does not exist on every Mac.
sudo mkdir -p "$INSTALL_DIR"
sudo cp clipboard-ai-agent "$INSTALL_DIR/"
rm clipboard-ai-agent

# Build and install CLI
echo "Building cbai CLI..."
cd "$SCRIPT_DIR/../cli"

bun install --frozen-lockfile
bun build src/index.ts --outdir dist --target node --define "__CBAI_VERSION__=\"$CBAI_VERSION\""

echo "Installing CLI to $INSTALL_DIR..."
sudo cp dist/index.js "$INSTALL_DIR/cbai"
sudo chmod +x "$INSTALL_DIR/cbai"

# The installed `cbai` is a `#!/usr/bin/env node` script. bun/npm above are only
# *build-time* tools; at runtime the daemon needs the interpreter named by the
# shebang on its PATH. Verify it exists so a missing node fails loudly here
# rather than silently on the first triggered action.
CBAI_INTERPRETER="node"
if [[ -f "$INSTALL_DIR/cbai" ]]; then
    SHEBANG_INTERP="$(sed -n '1s|^#!.*[ /]||p' "$INSTALL_DIR/cbai")"
    [[ -n "$SHEBANG_INTERP" ]] && CBAI_INTERPRETER="$SHEBANG_INTERP"
fi
if ! command -v "$CBAI_INTERPRETER" &> /dev/null; then
    echo "Warning: '$CBAI_INTERPRETER' (the cbai interpreter) was not found on PATH."
    echo "         Triggered actions will fail until it is installed and on the"
    echo "         daemon's PATH. Install it, then re-run this installer."
fi

# Install LaunchAgent
echo "Installing LaunchAgent..."
mkdir -p "$LAUNCH_AGENTS_DIR"

PLIST_SOURCE="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$LAUNCH_AGENTS_DIR/$PLIST_NAME"

# The daemon spawns `cbai` (a `#!/usr/bin/env node` script). launchd does NOT
# inherit the interactive shell's PATH, so unless we inject the directory that
# holds `node` (and Homebrew's bin on Apple Silicon), every daemon-triggered
# action fails with `env: node: No such file or directory`.
AGENT_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if command -v brew &> /dev/null; then
    AGENT_PATH="$(brew --prefix)/bin:$AGENT_PATH"
fi
if NODE_BIN="$(command -v node 2>/dev/null)"; then
    AGENT_PATH="$(dirname "$NODE_BIN"):$AGENT_PATH"
fi

# Replace placeholders
sed -e "s|__INSTALL_PATH__|$INSTALL_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__AGENT_PATH__|$AGENT_PATH|g" \
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
