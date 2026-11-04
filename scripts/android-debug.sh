#!/usr/bin/env bash
# [INPUT]: an Android device on adb, the Solco Mac Host port, and the Metro dev server.
# [OUTPUT]: one command that (re)establishes the full device debug chain: reverse proxies,
#           APK install when requested, app launch, and a screen probe.
# [POS]: dev-infrastructure script only; no business or auth logic (see AGENTS.md).
#        Why this exists: `adb reverse` mappings are USB-session-scoped — any USB
#        re-enumeration (re-plug, screen-lock reset, vivo power management) silently
#        drops them and the app's loopback Host address dead-ends with
#        "Unable to reach Solco Host". Re-run this script to restore the chain.
# [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
set -euo pipefail

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
HOST_PORT="${HOST_PORT:-8756}"
METRO_PORT="${METRO_PORT:-8081}"
PACKAGE="com.whstudio.solco.mobile"
APK="android/app/build/outputs/apk/debug/app-debug.apk"

command -v "$ADB" >/dev/null || { echo "adb not found at $ADB"; exit 1; }

DEVICE="$($ADB devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [[ -z "$DEVICE" ]]; then
  echo "No authorized device. Check USB debugging and accept the phone prompt:"
  $ADB devices
  exit 1
fi
echo "device: $DEVICE"

if [[ "${1:-}" == "--install" ]]; then
  [[ -f "$APK" ]] || { echo "APK missing: $APK (run android/gradlew :app:assembleDebug first)"; exit 1; }
  # vivo-style interceptors confirm on the phone screen; retry once if it times out.
  "$ADB" install -r "$APK" || "$ADB" install -r "$APK"
fi

# Reverse mappings are dropped by USB re-enumeration; always re-assert them.
"$ADB" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT"
"$ADB" reverse "tcp:$HOST_PORT" "tcp:$HOST_PORT"
echo "reverse:"; "$ADB" reverse --list

"$ADB" shell am start -n "$PACKAGE/.MainActivity" >/dev/null
sleep 3
"$ADB" exec-out screencap -p > /tmp/phone-screen.png
echo "screen probe: /tmp/phone-screen.png"
echo "tip: a loopback Host address (127.0.0.1:$HOST_PORT) needs this script after every USB reset;"
echo "     prefer the Mac's LAN IP ($(ipconfig getifaddr en0 2>/dev/null || echo '<lan-ip>')):$HOST_PORT for a USB-independent connection."
