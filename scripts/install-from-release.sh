#!/bin/bash
set -euo pipefail

# Install clipboard-ai from a published GitHub release (no build toolchain
# required). Downloads the host-arch agent binary and the CLI bundle, verifies
# them against SHA256SUMS when present, clears the Gatekeeper quarantine, and
# renders the LaunchAgent.
#
# Usage: ./scripts/install-from-release.sh [vTAG]   (default: latest)

REPO="${CBAI_REPO:-J-1000/clipboard-ai}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
CONFIG_DIR="$HOME/.clipboard-ai"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="ai.clipboard.agent.plist"
TAG="${1:-latest}"

if [[ "$(uname)" != "Darwin" ]]; then
    echo "Error: clipboard-ai only supports macOS" >&2
    exit 1
fi

case "$(uname -m)" in
    arm64) ASSET_ARCH="arm64" ;;
    x86_64) ASSET_ARCH="amd64" ;;
    *) echo "Error: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

if [[ "$TAG" == "latest" ]]; then
    API="https://api.github.com/repos/$REPO/releases/latest"
else
    API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

echo "Resolving release ($TAG) for darwin-$ASSET_ARCH..."
ASSETS_JSON="$(curl -fsSL "$API")"

asset_url() {
    # $1 = substring to match in the asset name
    echo "$ASSETS_JSON" | grep -o "\"browser_download_url\": \"[^\"]*$1[^\"]*\"" | head -1 | cut -d'"' -f4
}

AGENT_URL="$(asset_url "clipboard-ai-agent-darwin-$ASSET_ARCH")"
CLI_URL="$(asset_url "index.js")"
SUMS_URL="$(asset_url "SHA256SUMS")"

if [[ -z "$AGENT_URL" || -z "$CLI_URL" ]]; then
    echo "Error: could not find release assets for darwin-$ASSET_ARCH" >&2
    exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

echo "Downloading agent and CLI..."
curl -fsSL -o "clipboard-ai-agent-darwin-$ASSET_ARCH" "$AGENT_URL"
curl -fsSL -o index.js "$CLI_URL"

if [[ -n "$SUMS_URL" ]]; then
    echo "Verifying checksums..."
    curl -fsSL -o SHA256SUMS "$SUMS_URL"
    # Only check the lines for the files we downloaded.
    grep -E "clipboard-ai-agent-darwin-$ASSET_ARCH|index.js" SHA256SUMS > to-check.txt || true
    if [[ -s to-check.txt ]] && ! shasum -a 256 -c to-check.txt; then
        echo "Error: checksum verification failed" >&2
        exit 1
    fi
else
    echo "Warning: no SHA256SUMS asset found; skipping verification."
fi

echo "Clearing quarantine and installing..."
xattr -d com.apple.quarantine "clipboard-ai-agent-darwin-$ASSET_ARCH" 2>/dev/null || true
chmod +x "clipboard-ai-agent-darwin-$ASSET_ARCH"
sudo cp "clipboard-ai-agent-darwin-$ASSET_ARCH" "$INSTALL_DIR/clipboard-ai-agent"
sudo cp index.js "$INSTALL_DIR/cbai"
sudo chmod +x "$INSTALL_DIR/cbai"

mkdir -p "$CONFIG_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$CONFIG_DIR/config.toml" && -f "$SCRIPT_DIR/../configs/default.toml" ]]; then
    cp "$SCRIPT_DIR/../configs/default.toml" "$CONFIG_DIR/config.toml"
fi

# Render the LaunchAgent with a PATH that can resolve node (see install.sh).
AGENT_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
command -v brew &>/dev/null && AGENT_PATH="$(brew --prefix)/bin:$AGENT_PATH"
if NODE_BIN="$(command -v node 2>/dev/null)"; then
    AGENT_PATH="$(dirname "$NODE_BIN"):$AGENT_PATH"
else
    echo "Warning: node not found on PATH; install Node.js so triggered actions can run."
fi

mkdir -p "$LAUNCH_AGENTS_DIR"
PLIST_DEST="$LAUNCH_AGENTS_DIR/$PLIST_NAME"
sed -e "s|__INSTALL_PATH__|$INSTALL_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__AGENT_PATH__|$AGENT_PATH|g" \
    "$SCRIPT_DIR/$PLIST_NAME" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo
echo "Installed from release $TAG. Run 'cbai doctor' to verify."
