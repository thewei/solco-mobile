# modules/solco-foreground-service/
> L2 | Parent: ../../CLAUDE.md

Local Expo Module (Android only, same gate as solco-pinned-transport). It exists because Chinese
Android ROMs (vivo/OriginOS among them) kill backgrounded app processes, which dies with them the
pinned Host socket and every live event. A `specialUse` foreground service holds the process while
the app is backgrounded; Android 15 caps `dataSync` at 6 h/day, and this app is sideloaded so the
Play specialUse policy never applies.

Members:
- `expo-module.config.json` — autolinking entry (`platforms: ["android"]`).
- `android/build.gradle` — library plugin; `compileOnly com.facebook.react:react-android` (headless JS task API, version supplied by the app).
- `android/src/main/AndroidManifest.xml` — the service declaration (`specialUse` type + subtype property), `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. A library manifest merges into the app at build, so prebuild regeneration re-merges it with no app-side manual step.
- `android/src/main/java/com/whstudio/solco/foregroundservice/KeepAliveService.kt` — the service: silent `IMPORTANCE_LOW` channel `solco.keepalive.status` + ongoing notification that is the live agent status line (title/text carried by `start`, rewritten in place by `KeepAliveService.post`), `startForeground` with `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` on API 34+; `START_NOT_STICKY` (a system reap is rebuilt by the next background transition; swipe-kill is the documented free-path boundary).
- `android/src/main/java/com/whstudio/solco/foregroundservice/SolcoForegroundServiceModule.kt` — thin Expo glue: `start(title,text)`/`update(title,text)`/`stop` (a `stop` arriving before the service has called `startForeground` is deferred — polled every 100 ms, ≤10 s, via `KeepAliveService.startPending` — because stopping first crashes the app with `ForegroundServiceDidNotStartInTimeException`; `start` cancels a pending stop)/`isIgnoringBatteryOptimizations`/`openIgnoreBatteryOptimizations`, coded errors (`ERR_NO_CONTEXT`). `start` also starts the headless JS task `SolcoKeepAlive` (never settles, no timeout, no wake lock; registered by `src/features/host/keep-alive-task.ts`) and `stop` finishes it: React Native pauses every JS timer in the background unless a headless task runs, and TanStack Query notifies observers through `setTimeout`, so without it a tree refetched by an event never reached the notification effect (verified on a vivo device: agent working→done with the app backgrounded now raises the alert within ~8 s).

OEM note (vivo/OriginOS, measured 2026-11-02): without the user's "允许后台高耗电" + recents lock the OEM freezer sets `cgroup.freeze=1` on the whole process ~6 s after backgrounding (AMS still reports `isFrozen=false`, foreground service or not) — no JS, native thread or socket runs. Check with `adb shell cat /sys/fs/cgroup/apps/uid_<uid>/pid_*/cgroup.freeze` (0 = running). A new package id loses all such whitelists; the vivo notification page also defaults to no banner / no lock-screen display and the channel to silent.

JS side: `src/lib/foreground-service.ts` (typed seam; `start` swallows the Android 12+ "FGS from
background" rejection — backgrounding is best effort) and `src/lib/foreground-service-native.ts`
(the only binding; null on iOS/Web). Consumers: `src/features/host/background-bridge.tsx` owns the
start/update/stop lifecycle (paired → held in the foreground too; the status text comes from `features/host/keep-alive-status.ts`) and the Connect screen's
keep-alive card uses the battery helpers.

Verify: `npx expo prebuild -p android --no-install`, then `cd android && ./gradlew :solco-foreground-service:testDebugUnitTest` (no tests yet — the module is thin glue; behavior is exercised on the device via the background-bridge).

Rule: this module never touches the Host wire contract or credentials; it holds a process, nothing else.

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
