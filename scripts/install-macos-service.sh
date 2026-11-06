#!/bin/sh
# Keeps the OS server running on a Mac, including after restarts, so schedules fire.
# Run it yourself: sh scripts/install-macos-service.sh
# To remove it: launchctl bootout "gui/$(id -u)/dev.osapp.server" && rm ~/Library/LaunchAgents/dev.osapp.server.plist
#
# Keys are not stored in this service. Add them in the app, and they stay encrypted in ~/.os-app.
set -e

server_dir="$(cd "$(dirname "$0")/../server" && pwd)"
node_bin="$(command -v node)"
data_dir="$HOME/.os-app"
plist="$HOME/Library/LaunchAgents/dev.osapp.server.plist"

mkdir -p "$data_dir" "$HOME/Library/LaunchAgents"
chmod 700 "$data_dir"

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.osapp.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$server_dir/node_modules/tsx/dist/cli.mjs</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$server_dir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$data_dir/server.log</string>
  <key>StandardErrorPath</key><string>$data_dir/server.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/dev.osapp.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "OS server installed. It starts now and at every login. Logs: $data_dir/server.log"
