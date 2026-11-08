# Solco Mobile

React Native mobile client for Solco. Expo SDK 54 + React Native 0.81 + Expo Router + Tamagui 2 + Gorhom Bottom Sheet.

<directory>
src/app/ - Expo Router screens and navigation composition
src/components/ - reusable product UI components
src/contracts/ - typed Solco Host API contracts/projections + __fixtures__/ golden wire fixtures pinned with the Go Host (`pnpm sync:fixtures`)
src/features/ - feature-local data and presentation helpers
src/lib/ - transport-independent client utilities and secure device storage (incl. the pinned transport seam and the v3 Host client)
src/state/ - client-local navigation/session state only
src/theme/ - Solco Mobile design tokens
modules/ - local Expo Modules (solco-pinned-transport: Android certificate-fingerprint pinning for the Go Host v3; solco-foreground-service: Android background keep-alive foreground service + battery-optimization helpers)
src/generated/ - `chat-page.ts`: the desktop Chat page as one embedded HTML string, produced by `pnpm sync:chat-page` from solco/frontend (`bun run build:mobile`); never hand-edited
plugins/ - Expo CNG iOS scene-lifecycle compatibility plugin for SDK 54 / Xcode 27; remove once upgrading to SDK 58 (see plugins/CLAUDE.md)
scripts/ - dev-infrastructure scripts; sync-chat-page.mjs builds/embeds the shared Chat page; serve-web.mjs serves dist/ + same-origin /api proxy for the local PWA topology; check-design-tokens.mjs runs solco's `design/gen.mjs --check` against `src/theme/*.generated.ts` (`pnpm check:tokens`); sync-v3-fixtures.mjs copies the Go Host's golden files (`pnpm check:fixtures` / `pnpm check:chat-page` are the read-only drift checks, run locally beside the solco repo); e2e-v3.sh runs the v3 codecs against a live Go Host; android-release.sh and `android-debug.sh --install` queue their `adb install` on one machine-wide `lockf` lock (`/tmp/solco-phone-install.lock`, `PHONE_LOCK_WAIT` seconds) because the phone has a single install-confirmation dialog that concurrent sessions overwrite
.github/ - CI: typecheck + lint + test on push/PR (the drift checks need the sibling solco repo, so they stay local)
public/ - web-static assets served at root: PWA manifest and placeholder icons (validation-period artwork)
docs/ - canonical mobile architecture, UX reference, roadmap, and the Web/PWA track (architecture, implementation plan, local-domain runbook)
</directory>

<config>
package.json - dependency/version and script policy (`main` is `index.ts`, not `expo-router/entry`: it imports the router entry and registers the Android widget's headless task at bundle load)
pnpm-workspace.yaml - overrides: reanimated/worklets pins and one copy of React Navigation (expo-router's; every navigator must share its NavigationContainer); patchedDependencies in `patches/` (react-native-svg; expo-libghostty — Android: a drag with no local scrollback sends PageUp/PageDown so the program scrolls its own pages)
app.config.ts - Expo application/native configuration (expo-camera plugin for QR pairing; RECORD_AUDIO declared for dictation, expo-camera's own mic request off; iOS NSMicrophoneUsageDescription); expo-share-intent (Android `text/*` only, iOS disabled); react-native-android-widget (the `SolcoAgents` home-screen widget, 4×2, `not_keyguard`, 30-minute system tick)
.prox.yaml - local dev domain wiring (solco.dev.local via hosts transport; web/export tasks)
.env.example - optional Solco Host endpoint for preconfiguring the real HTTP adapter
tamagui.config.ts - Tamagui provider/theme configuration
tsconfig.json - strict TypeScript and @/* source alias
vitest.config.ts - contract and pure Conversation-state test runner
eslint.config.js - Expo flat ESLint baseline
</config>

Product rule: **Solco Mobile is a second client of the Solco Mac Host, not a second Herdr runtime and not a remote-control layer over the Mac GUI.** Mobile navigation is client-local. Runtime operations target explicit opaque IDs through the Solco Host API.

UI rule: Agent-first, phone-native, dark developer-tool surface. Semantic Conversation is the default Agent and History surface; Live/History share one `ConversationSurface`. Use mature owners before custom code: Expo Router / Tamagui / Gorhom Bottom Sheet / Expo SDK APIs / proven compatible libraries / custom native module. Prefer packaged, maintained components over hand-rolled gesture/modal infrastructure. Expo UI remains deferred while the Xcode-compatible SDK 54 line still exposes it as beta/alpha.

Transport rule: business APIs are transport-independent. LAN/Tailscale/Relay/SSH are connection transports beneath the same Host API contract. Do not make SSH or Herdr protocol types public UI/domain contracts.

Development rule: use Expo Development Builds, not Expo Go, as the production-development baseline. Custom Swift/Kotlin should use a local Expo Module unless a mature compatible library already owns the capability.

[PROTOCOL]: 变更时更新此头部，然后检查子目录 CLAUDE.md
