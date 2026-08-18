#!/bin/sh

set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <binary> <output-directory> <release-version> <architecture>" >&2
  exit 2
fi

binary_path=$1
output_directory=$2
release_version=${3#v}
architecture=$4

if [ ! -f "$binary_path" ]; then
  echo "menubar binary not found: $binary_path" >&2
  exit 1
fi

short_version=${release_version%%-*}
case "$short_version" in
  ""|*[!0-9.]*|.*|*.)
    echo "invalid release version: $release_version" >&2
    exit 2
    ;;
esac

case "$architecture" in
  arm64|amd64)
    ;;
  *)
    echo "unsupported architecture: $architecture" >&2
    exit 2
    ;;
esac

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(dirname -- "$script_directory")
info_template="$repository_root/menubar/Resources/Info.plist"
app_directory="$output_directory/Clipboard AI.app"
contents_directory="$app_directory/Contents"
archive_path="$output_directory/clipboard-ai-menubar-darwin-$architecture.zip"

mkdir -p "$contents_directory/MacOS"
install -m 0755 "$binary_path" "$contents_directory/MacOS/ClipboardAIMenuBar"
install -m 0644 "$info_template" "$contents_directory/Info.plist"

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $short_version" "$contents_directory/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $short_version" "$contents_directory/Info.plist"

ditto -c -k --keepParent --norsrc --noextattr --noqtn --noacl "$app_directory" "$archive_path"
echo "$archive_path"
