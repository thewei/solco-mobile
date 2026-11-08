#!/usr/bin/env bash
# [INPUT]: this worktree (branch exp/native-terminal-ghostty); optional ABI (default: the phone's, else arm64-v8a).
# [OUTPUT]: a standalone RELEASE apk, applicationId com.whstudio.solco.mobile.ghostty (installs NEXT TO the real Solco).
# [POS]: dev-infrastructure only. `expo prebuild` regenerates android/ and overwrites the two tracked files there
#        (app/build.gradle carries the Tailcat AAR dependency), so they are restored and given the side-by-side id.
# [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
set -euo pipefail
cd "$(dirname "$0")/.."
unset CI
export SOLCO_APP_ID_SUFFIX=.ghostty
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
ABI="${1:-$("$ADB" shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r' | cut -d, -f1)}"
ABI="${ABI:-arm64-v8a}"

echo "==> 1/3 prebuild (id suffix $SOLCO_APP_ID_SUFFIX)"
pnpm expo prebuild --platform android --no-install
git checkout -- android/app/build.gradle android/app/src/androidTest
sed -i '' "s/namespace 'com.whstudio.solco.mobile'/namespace 'com.whstudio.solco.mobile.ghostty'/; s/applicationId 'com.whstudio.solco.mobile'/applicationId 'com.whstudio.solco.mobile.ghostty'/" android/app/build.gradle

echo "==> 2/3 build (release, $ABI)"
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures="$ABI")

git checkout -- android/app/build.gradle # the suffixed ids are for this build only; keep the tracked file clean
APK=android/app/build/outputs/apk/release/app-release.apk
echo "==> 3/3 done"
ls -lh "$APK" | awk '{print "apk size: " $5}'
echo "$APK"
