# Android Development Preparation — Solco Mobile

Status: **Prepared and build-verified on 2026-08-31** — toolchain checked, `expo prebuild -p android`
generates, and `:app:assembleDebug` **succeeds**: `android/app/build/outputs/apk/debug/app-debug.apk`
(dev-client build, ~212 MB). Install on a device with `adb install -r`.
Baseline: Expo SDK 54 / RN 0.81 / React 19.1 (the newest line supporting the local Xcode 16.1 iOS gate).

This document owns the "how" for starting Android work: environment state, the dev-build
loop, and the A04 native VT renderer decision path. Architecture rationale stays in
`mobile-product-architecture.md`; the web/PWA runbook stays in `web-pwa-local-domain.md`.

## 1. Toolchain status (verified 2026-08-31)

| Piece | State |
| --- | --- |
| JDK 17 (`java -version`) | ✅ openjdk 17.0.12 (corretto) — Expo SDK 54 requirement |
| Android SDK (`~/Library/Android/sdk`) | ✅ platforms 34/35/36, build-tools 34–36, NDK 25/26/27/28, licenses accepted |
| NDK 27.1.12297006 | ✅ repaired — the directory held only an aborted Android Studio `.installer` stub (no `source.properties`); reinstalled via `sdkmanager "ndk;27.1.12297006"` |
| `adb` | ✅ on PATH via SDK platform-tools |
| `ANDROID_HOME` | ⚠️ not exported by default shells; **Gradle reads `android/local.properties`** (`sdk.dir`). NOTE: `prebuild --clean` deletes it — re-create after every clean prebuild |
| Device/emulator | none attached at prep time; `adb devices` empty — first run needs one |
| `pnpm doctor` | one unrelated check: pnpm cache dir permission (no Android impact) |

## 1.1 Resolved during preparation

- **Brand assets created** (`assets/`): `icon.png`, `splash-icon.png`,
  `android-adaptive-fg.png`. The project had no `assets/` at all, so the splash plugin
  referenced a `drawable/splashscreen_logo` that was never generated and
  `:app:assembleDebug` failed at resource linking. `app.config.ts` now wires `icon`,
  `android.icon`, `android.adaptiveIcon`, and the splash plugin `image`.
- **Real brand art shipped (2026-10-31)**: all three assets plus `public/` web icons are
  derived from the Solco desktop master (`solco:/resources/icon.png`, ram + `>-` mark,
  1024px, 100px transparent border). Re-derive from that master when the desktop logo
  changes; no placeholder art remains.

The `android/` directory is **generated, not source** (Expo CNG): it is gitignored and
regenerated with `npx expo prebuild -p android --clean`. Never hand-edit it except for
verified config-plugin gaps; prefer `app.config.ts` + plugins.

## 2. Development build loop

```sh
# one-time per clone / after native dependency changes
export ANDROID_HOME=$HOME/Library/Android/sdk   # or rely on android/local.properties
npx expo prebuild -p android --clean --no-install
# ⚠️ --clean deletes android/local.properties — recreate before any gradle call:
printf 'sdk.dir=%s/Library/Android/sdk\n' "$HOME" > android/local.properties

# assemble only (no device needed)
cd android && ./gradlew :app:assembleDebug && cd ..
# → android/app/build/outputs/apk/debug/app-debug.apk (install with adb install -r)

# full dev-client loop (needs a device/emulator on adb)
pnpm android            # expo run:android — builds debug + installs + starts metro
pnpm start              # subsequent sessions: expo start --dev-client
```

Dev-build semantics (per AGENTS.md): Expo Go is a convenience smoke surface only;
anything touching native modules (SecureStore already ships in dev builds) validates on
the Development Build. Connect-screen URL on an emulator is `http://10.0.2.2:<host-port>`
(Host 8756, or `https://solco.dev.local` from a LAN device on the Tailwind/WARP-free
path — see the transport discipline in `web-pwa-local-domain.md`).

## 3. A04 — native VT renderer decision path

**Phase 1 shipped 2026-08-31**: the native TUI route now renders a real terminal through
`src/components/native-terminal.tsx` — an embedded **xterm.js** (vendored, offline) inside
`react-native-webview`. Rationale: no maintained RN-native VT component exists for
RN 0.81/New Arch, and this composition is two mature owners wired together. It shares the
web path's exact data plane: base64 output frames in, raw-byte input + semantic key events
(incl. `key_c`+Ctrl) out, fit-driven session resize, shared-geometry drift realign. A
semantic key row (Esc/Tab/arrows/Home/End/PgUp/PgDn/Ctrl+C) sits under the terminal for
soft keyboards. Build requirements: `react-native-webview` is a native module →
`prebuild --clean` + `assembleDebug/Release`; vendored files must stay `.txt` (see §3.1).

**Phase 2 (endgame, optional)** — a true native module remains valuable if
WebView throughput/IME ever disappoints:

1. **Mature-owner spike (preferred).** Candidate owners must pass all of:
   - RN 0.81 + New Architecture compatibility (Fabric or interop layer);
   - real VT100/xterm parse + grid render (not regex-ANSI-on-Text);
   - IME/CJK composition, physical-keyboard key events, paste;
   - per-frame resize (cols×rows → `POST /tui/session/{id}/resize`).
2. **Narrow local Expo Module (fallback).** Wrap a mature Apache-2.0 Android terminal
   emulator core (e.g. the ConnectBot terminal-emulator lineage) exposing exactly:
   `write(bytes)`, `onInput(bytes)`, `resize(cols,rows)`, `focus()/IME`. All protocol
   logic stays JS (`features/tui/transport.ts`). GPL cores (Termux) are out.
3. **Either path consumes the same Host contract** — one shared session, semantic input,
   base64 output frames, Host-owned resize authority.

### 3.1 Metro asset trap that bit this integration

Metro 0.83 removed `txt` from default `assetExts`, so `require('.../xterm.js.txt')`
failed with `UnableToResolveError`. `metro.config.js` (new) pushes `txt` back into
`resolver.assetExts`. The vendored files are committed under `assets/terminal/` and
loaded at runtime via `expo-asset` + fetch, inlined into the WebView HTML — fully
offline. Remember: **after adding any npm dependency, restart Metro** — a long-running
instance cannot resolve freshly installed packages (cryptic `UnableToResolveError`
surfacing on the device as "There was a problem loading the project").

## 4. Native input contract now complete (this change)

`HerdrTuiKeyCode` on both sides now carries letter keys `key_a`…`key_z` with modifiers,
encoded Host-side: Ctrl+letter → 0x01–0x1A (Ctrl+C=0x03 interrupt, Ctrl+D=0x04 EOF,
Ctrl+L clear, Ctrl+R search), Shift → uppercase, Alt/Meta → ESC prefix. Fixtures
`tui_input.json` + `tui_input_letter.json` pin the wire spelling; the native client
sends `{kind:"key", code:"key_c", modifiers:{ctrl:true}}` and never builds escape
sequences itself. Named keys (arrows/Home/PgUp/F1…) were already covered; the raw
`{data}` path stays for the web WTerm client only.

Native TUI acceptance (from audit A04) remains the release gate: CJK/IME, Ctrl/Esc/Tab/
arrows, paste, resize/orientation, sustained output, reconnect, shared-client geometry
disclosure, and **no second Herdr TUI child** while Desktop is attached.

## 5. Real-device deployment record (2026-08-31, vivo device)

First end-to-end device session, verified working:

```sh
adb devices                       # your device serial
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081     # Metro over USB
adb reverse tcp:8756 tcp:8756     # Host API over USB → connect with http://127.0.0.1:8756
pnpm start &                      # expo start --dev-client (Metro on 8081)
adb shell am start -n com.whstudio.solco.mobile/.MainActivity
adb exec-out screencap -p > /tmp/phone.png   # visual verification from the desk
```

Device facts: 1260×2800 @ 560dpi — scale tap coordinates from screenshots by
`realWidth / imageWidth`. Board rendered connected to the Mac over the
reverse-proxied Host.

## 5.1 Root cause of recurring "Unable to reach Solco Host" (2026-08-31)

Symptom: the phone frequently showed "Unable to reach Solco Host" while the Mac app
sat untouched. Forensics: the Mac Host process stayed healthy; `adb reverse --list` had
gone **empty** while the device was still attached; during monitoring the mapping set
flapped from two entries to zero within minutes, and the adb daemon itself restarted once.

Root cause chain:

1. The phone's stored Host address was `http://127.0.0.1:8756` — a **transport-ephemeral
   loopback** that only resolves while `adb reverse` is alive.
2. The USB link flaps (re-plug, screen-lock USB reset, vivo power management, adb daemon
   restart). Every flap wipes reverse mappings **silently** — no app-visible event.
3. The app then connection-refuses on bootstrap → the generic error card.

Protocol fixes shipped with this diagnosis:

- **Loopback-aware error card** (`src/app/index.tsx` + `isLoopbackHostUrl`): when the
  stored address is loopback-shaped, the error card explains the USB-reverse mechanism
  and adds a "Change Host address" shortcut.
- **Connection-first UX**: the connect form takes **Host IP** (`192.168.x.x`, optional
  `:port`, default 8756) + access token — not a raw URL. The "Android development"
  card was removed; pairing via QR is the intended production flow.
- **QR pairing protocol** (`solco://pair?h=<ip>&p=<port>&fp=<fingerprint>&c=<code>&n=<name>`):
  consumed by `src/app/pair.tsx` (system camera opens the deep link). Web keeps its
  same-origin `#pair=<token>` flow. Pure helpers + unit tests in `src/lib/host-address.ts`.
- **Connection diagnostics log** (`src/lib/connection-log.ts`): bounded ring buffer of
  connect/event/request failures (never logs tokens), mirrored to
  `adb logcat -s ReactNativeJS`; the error card exposes "Copy connection diagnostics".
- **Operational rule**: configure the phone with the Mac's **LAN IP**
  (`ipconfig getifaddr en0` → e.g. `192.168.1.50`), verified to stay connected after
  removing the reverse mapping. Reserve `127.0.0.1` + `adb reverse` for Metro/hot-reload
  only. `scripts/android-debug.sh` re-asserts the whole chain after any USB reset.

Traps hit and cleared (do not relearn these the hard way):

1. **vivo install interception** — the first `adb install` fails with a bare
   "Performing Streamed Install" because Funtouch OS shows a `PackageInterceptActivity`
   confirmation **on the phone**; the command blocks until it is confirmed (or times
   out). Confirm the dialog, or enable "USB install" in developer options. An existing
   install from another signature also needs `adb uninstall com.whstudio.solco.mobile` first.
2. **`prebuild --clean` deletes `android/local.properties`** — the next gradle run fails
   with "SDK location not found". Recreate the file after every clean prebuild.
3. **Broken NDK stub** — an aborted Android Studio install left
   `ndk/27.1.12297006/` containing only `.installer`; Gradle fails with
   `[CXX1101] … did not have a source.properties file`. Repair with
   `sdkmanager "ndk;27.1.12297006"`.
4. **Missing brand assets break resource linking** — no `assets/` meant the splash
   plugin referenced a never-generated `drawable/splashscreen_logo`. Real brand assets
   (Solco ram master) are wired in `app.config.ts` since 2026-10-31.
5. **Reverse mappings are USB-lifetime** — see §5.1; the LAN IP is the durable path.
6. **Token persistence differs by platform** — native stores the credential in
   SecureStore (Android Keystore) and survives restarts; web deliberately keeps it in
   session memory only. Both are correct; do not "unify" them.
7. **Debug builds need Metro on every cold start** — after an adb restart the dev-client
   falls back to its launcher. A release build (`assembleRelease`) embeds the JS bundle
   and is the standalone path for production use.

## 5.2 Release closed-loop session (2026-08-31 evening): three crash/black-screen root causes

The first release-build closed-loop on the vivo phone hit three independent blockers.
All verified fixed on device: launch → connect → board → New Agent → conversation
send/reply → history list/detail → in-place Continue (LIVE switch, seq continuity) →
Remote Control tree → **herdr TUI rendering at the mobile 51×42 geometry with keyboard
input echo and the semantic key row**.

1. **Launch crash: `NoClassDefFoundError: expo.modules.kotlin.types.AnyTypeCache`** —
   `pnpm add expo-asset` had installed the new independent version line
   (`expo-asset@57`, compiled against an unreleased expo-modules-core), while SDK 54's
   Expo autolinking packages expo-modules-core 3.0.x without that class. Rule: on this
   project **every Expo module goes through `npx expo install <name>`**, never raw
   `pnpm add` — the SDK pins the compatible line (here `expo-asset@^12.0.13`, the same
   build expo itself depends on).
2. **Connect fails with "Network request failed" while the network is fine** — release
   builds block cleartext HTTP; only `android/app/src/debug/AndroidManifest.xml` carried
   `usesCleartextTraffic`. The flag now lives in the main manifest
   (`android:usesCleartextTraffic="true"`; SDK 54's `ExpoConfig.android` type has no such
   field, so `app.config.ts` only documents the coupling — re-add it after any
   `prebuild --clean`). Diagnosed by confirming Mac listen `*:8756`, firewall off,
   phone ping + `nc` OK before touching the manifest.
3. **TUI terminal renders a blank canvas** — `native-terminal.tsx` joined per-frame
   base64 chunks directly; each chunk carries its own `=` padding, and Chrome's strict
   `atob` throws `InvalidCharacterError` on padding before the end of the string (the
   same join would also misalign 6-bit groups — stripping padding per chunk is NOT a
   fix either). Fix: accumulate raw `Uint8Array` chunks and `encodeBase64` once per
   flush. The instrumentation that found it (kept, logcat-visible):
   `[tui-webview]` asset/html/ready/first-flush logs, `glue-error` postMessage from an
   in-page `window.onerror`, and `[tui] frames=/bytes=` stream counters.

Host-side companion fix (solco): a brand-new live session has no transcript on
disk, so `live_session_source` failed with "live session identity is not indexed yet"
and the conversation surface stuck on Loading with a red banner. It now returns
`Ok(None)` → an empty conversation window (`sendable: true`), letting the client render
the empty state and send the first prompt; the transcript appears once the agent writes
it.

Device-operation notes (vivo device, this session):

- **Wi-Fi adb beats USB**: `adb tcpip 5555 && adb connect <phone-ip>:5555` — the USB
  link flapped constantly (install killed mid-stream, daemon restarts). The Wi-Fi
  transport survived the whole session.
- **Every release reinstall needs the on-phone security approval**: wake → unlock →
  `adb install -r` → poll `uiautomator dump` for
  `deleted_file_state_cb` → tap the checkbox (≈630,2450) → tap 继续安装 (≈630,2621).
  With the screen asleep or locked (fingerprint), the install hangs or aborts with
  "User rejected permissions". `svc power stayon true` prevents mid-approval sleeps.
- **vivo adds FLAG_SECURE while a `secureTextEntry` field is focused** — `adb
  screencap` returns a black frame (uiautomator dump still works). Blur the field
  before screenshotting; it is not an app bug.
- **vivo IME composes latin input** — `adb shell input text` lands in the IME
  composition buffer and only reaches the field on blur/commit. Verify text entry via
  uiautomator bounds + a blur step, not immediately after typing.
- Diagnostics pattern that cracked the WebView: a visible `#dbg` overlay inside the
  WebView HTML (screenshot-visible even without logcat) + `glue-error` postMessage —
  one install answered asset loading, glue readiness, and the failing decode at once.

## 5.3 TUI touch interaction (2026-08-31 night): clicks, scrolling, Chinese IME

The herdr TUI is mouse-aware: the macOS client converts native clicks in
`terminal_interact.rs` via ghostty's `encode_mouse` into SGR sequences
(`ESC [ < cb ; col ; row M/m`) written to the shared TUI's PTY. The PTY-side TUI
consumes those reports directly, **without** a DECSET 1000/1006 handshake we could
observe mid-session — so xterm.js (which only reports mouse when the app requests it)
never produced any. Fixes in `native-terminal.tsx` glue, all gated on
`term.buffer.type === 'alternate'` (the TUI's full-screen buffer):

- **Tap → SGR click**: touchstart/touchend with <12px movement and <400ms emit
  press+release at the touched cell (1-based, computed from element rect ÷ cols/rows).
  This makes `switch`, tab headers, and every other TUI control tappable.
- **Swipe → SGR wheel**: touchmove accumulates dy and emits button-64/65 wheel reports
  per 40px — the TUI scrolls its conversation view (`ui.mouse_scroll_lines`), solving
  "can't scroll past two screens".
- **Chinese IME duplication fix**: Android IMEs drive the xterm textarea with
  `keyCode 229`/`isComposing` keydowns; xterm treated them as real keys while its
  composition helper ALSO delivered the final text → duplicated and split characters.
  `customKeyEventHandler` now drops composing keydowns so only the composed string is
  delivered once.
- **Terminal gutters**: the TUI route drops the 18px screen gutter to 8px per side —
  the VT canvas needs every column and the wide right gutter read as a dead margin
  (the remaining sliver is the fit remainder: cols × cell width < container width).

Verification recipe for input on the phone: `adb shell input text` goes through the
vivo IME composition buffer and only lands on commit — for pinyin testing switch the
IME to 中文 mode, type letters (composing), commit, then screenshot the TUI input line.

Follow-up (same night, verified on device):

- **Alternate-screen gate removed**: the first SGR synthesis version gated taps/wheels
  on `term.buffer.active.type === 'alternate'` and swallowed everything — the herdr TUI
  paints the main buffer. The shared PTY child is always the mouse-aware TUI, so the
  gate is gone (taps confirmed: switcher opens/closes; wheels scroll).
- **Terminal-first page**: the title/description/status block moved into the native
  nav (`Stack.Screen` `headerTitle` shows "Herdr TUI" + `56×42 · rev N` subtitle;
  `headerRight` holds the key-row toggle and close-session icons). The key row is
  hidden by default — the nav keyboard icon toggles it.
- **Keyboard safety padding**: edge-to-edge Android ignores `adjustResize`, so the IME
  covered the terminal. The screen listens to `keyboardDidShow/DidHide` and pads the
  page by the reported keyboard height; the WebView refits and the Host PTY follows
  (rows shrink while typing).

## 5.4 Scroll latency: TUI input rides the stream WebSocket (2026-08-31 night)

Per-scroll-report HTTP POSTs made fast swipes lag behind the finger — the root cost is
per-report request setup, not payload size. Root fix, both repos:

- **Solco Host** (`internal/remotehost/terminal.go`): the terminal stream WebSocket now
  accepts the same input requests as HTTP `/input` as inbound frames —
  `{"text":...}` / `{"keys":[...]}` events — handled by the same `handleInput` path,
  scope-gated (`ScopeTerminalInput`); malformed frames are rejected with `input.error`,
  never fatal. One persistent, already-authenticated connection; no per-report HTTP setup.
- **Solco Mobile**: the Host client's `sendInput` sends input frames over the
  stream socket; `src/app/terminal/[terminalId].tsx` routes taps and keys through it; the
  WebView glue accumulates wheel lines (15px/line) and
  flushes one batched SGR payload every 30ms (cap 120 lines/flush) — verify with the
  WS probe: a batch must produce output frames immediately.
- **Scroll semantics**: wheel-down at the conversation tail is a no-op by design — a
  "scroll doesn't work" observation may just be at-bottom. Scroll-up (finger drag
  down) always moves into history.
- **Rebind budget**: A07's 4×1s rebind attempts always died during a `crepus` host
  rebuild+restart (~30s), freezing the view at a stale frame with subtitle `error`.
  Now exponential backoff (1s→8s, 8 attempts ≈ 47s of coverage).
- Lesson: when a swipe "does nothing", check the nav subtitle first — a dead stream
  (`error`) means input still lands server-side but the phone can never see the
  redraw.

## 6. Open items before the first Android acceptance session

1. Attach a device or start an emulator; `adb devices` must list it.
2. `pnpm android` once to install the dev build + verify Metro attach.
3. Drive the connect screen with a real token (SecureStore path on native).
4. Pick the A04 spike owner (§3) and timebox it before building any terminal UI.
