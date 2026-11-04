#!/usr/bin/env bash
# [INPUT]: an Android phone on adb (USB, or wireless: PHONE_ADDR=<ip>:5555), the working tree of this repo.
# [OUTPUT]: a standalone RELEASE apk (JS bundled in, no Metro, no dev launcher) built for the phone's own CPU
#           ABI only, installed over the previous copy (data kept), post-install grants, launched and verified.
# [POS]: dev-infrastructure script only; no business or auth logic (see AGENTS.md). Used by
#        .agents/skills/solco-mobile-install. The release build type is signed with the debug keystore (Expo
#        prebuild default), so it replaces a dev build of the same package in place.
# [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
set -euo pipefail
cd "$(dirname "$0")/.."

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PACKAGE="com.whstudio.solco.mobile"
PHONE_ADDR="${PHONE_ADDR:-192.168.1.20:5555}" # adb-over-Wi-Fi address of your phone; DHCP moves it, override via PHONE_ADDR
APK="android/app/build/outputs/apk/release/app-release.apk"
unset CI # a CI=true environment turns Expo into non-interactive mode and breaks the bundle step

command -v "$ADB" >/dev/null || { echo "adb not found at $ADB" >&2; exit 1; }

echo "==> 1/6 device"
device() { "$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}'; }
DEVICE="$(device)"
if [[ -z "$DEVICE" ]]; then
  "$ADB" connect "$PHONE_ADDR" >/dev/null 2>&1 || true
  sleep 2
  DEVICE="$(device)"
fi
[[ -n "$DEVICE" ]] || { echo "no authorized device (USB: accept the RSA prompt; wireless: plug USB once and run 'adb tcpip 5555', then 'adb connect $PHONE_ADDR')" >&2; "$ADB" devices >&2; exit 1; }
A=("$ADB" -s "$DEVICE")
echo "device: $DEVICE ($("${A[@]}" shell getprop ro.product.model | tr -d '\r'))"

echo "==> 2/6 ABI"
ABI="$("${A[@]}" shell getprop ro.product.cpu.abilist | tr -d '\r' | cut -d, -f1)"
[[ -n "$ABI" ]] || { echo "could not read the phone's CPU ABI" >&2; exit 1; }
echo "building only: $ABI (the default build carries four ABIs)"

echo "==> 3/6 build (release, $ABI)"
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures="$ABI")
[[ -f "$APK" ]] || { echo "apk missing: $APK" >&2; exit 1; }
ls -lh "$APK" | awk '{print "apk size: " $5}'

echo "==> 4/6 install (-r keeps data; vivo asks for a confirmation ON THE PHONE SCREEN — the command waits for it)"
"${A[@]}" install -r "$APK"

echo "==> 5/6 grants"
"${A[@]}" shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
"${A[@]}" shell dumpsys deviceidle whitelist "+$PACKAGE" >/dev/null 2>&1 || true

echo "==> 6/6 launch + verify"
"${A[@]}" shell am force-stop "$PACKAGE"
"${A[@]}" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 4
PID="$("${A[@]}" shell pidof "$PACKAGE" | tr -d '\r')"
[[ -n "$PID" ]] || { echo "app is not running after launch" >&2; exit 1; }
echo "running, pid $PID"
"${A[@]}" exec-out screencap -p > /tmp/phone-release.png && echo "screen probe: /tmp/phone-release.png (a locked phone shows the lock screen — unlock and look)"
