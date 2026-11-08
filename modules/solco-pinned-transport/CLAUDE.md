# modules/solco-pinned-transport/
> L2 | Parent: ../../CLAUDE.md

Local Expo Module (Android first; iOS deliberately absent until its own Xcode gate). It exists because the Go Host's certificate is self-signed and is trusted only by the fingerprint carried in the pairing link, which React Native's `fetch`/`WebSocket` cannot express.

Members:
- `expo-module.config.json` — autolinking entry (`platforms: ["android"]`).
- `android/build.gradle` — library plugin + OkHttp (same 4.9.2 line React Native resolves) and JVM test deps.
- `android/src/main/java/com/whstudio/solco/pinnedtransport/PinnedClient.kt` — pure Kotlin: `PinnedTrustManager` (leaf DER SHA-256 must equal the pin; no roots, no chain, no hostname check), `PinnedClient.request` (https only, no redirects, 4 MiB body cap, method allow-list, the caller's timeout up to 170 s applied to the call and to the read — OkHttp's 10 s read default would cut a launch the Host is still running) and `openSocket` (wss only, subprotocol header, 25 s ping).
- `android/src/main/java/com/whstudio/solco/pinnedtransport/SolcoPinnedTransportModule.kt` — thin Expo glue: `request`, `openSocket/sendText/sendBinary/closeSocket`, one `onSocketEvent` stream, coded errors (`ERR_PIN_MISMATCH`, `ERR_INVALID_ARGUMENT`, `ERR_TRANSPORT`).
- `android/src/test/.../PinnedClientTest.kt` — JVM tests against a TLS MockWebServer (right pin, wrong pin sends no bytes, IP-addressed host, redirects, body cap, WebSocket subprotocols).

JS side: `src/lib/pinned-transport.ts` (typed seam, tested with a fake) and `src/lib/pinned-transport-native.ts` (the only binding).

Verify: `npx expo prebuild -p android --no-install`, then `cd android && ./gradlew :solco-pinned-transport:testDebugUnitTest` (add `-PndkVersion=<installed NDK>` when the pinned NDK is not installed locally; the module itself needs no NDK).

Rule: the pin is the only trust root; never add a system-trust or cleartext fallback here.

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
