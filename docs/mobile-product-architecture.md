# Solco Mobile Product Architecture

Status: **Canonical mobile direction / Conversation convergence in progress**
Baseline: 2026-08-30

Solco Mobile is a phone-native client for the Solco Mac Host. It is not a second Herdr runtime, a screen-sharing client, or a remote-control wrapper around the macOS GPUI application.

## 1. Product goal

The phone should make long-running coding Agents useful away from the desk:

1. see what needs attention immediately;
2. choose a Solco Workspace and Project without moving the Mac user's view;
3. open a live Agent and continue the same development session;
4. send prompts, approvals, stop/interrupt actions, and bounded task commands;
5. use the real Herdr TUI through the Host when the shared/global TUI capability is available;
6. reconnect after foreground/background transitions without creating another Agent session.

The mobile experience should feel designed for a small touch screen rather than a reduced desktop client.

## 1a. 2026-08-30 convergence checkpoint (Current)

- Host Remote API v2 now exposes one semantic Conversation DTO for Live and History, bounded windows,
  capability flags, and opaque Conversation identities. The Mac Remote crate is the wire authority;
  Mobile fixtures are copied verbatim from it.
- Mobile Agent Chat and History Detail render the same `ConversationSurface`; controllers differ only
  in lifecycle (prompt versus Continue). Mobile no longer uses `LocalPrompt[]` or raw `agent.read` as
  Chat transcript truth.
- History Continue is Host-owned and follows Continue/Fork → readiness → identity verification → one
  `agent.prompt`; failed phases preserve the draft and never auto-retry.
- Batch-0 inspection of installed Herdr 0.8.2 / protocol 20 found global focus and no client-scoped
  TUI lease/target/resize/reconnect contract. The product decision accepts those shared/global
  semantics: Mobile is not an independent Herdr TUI client; it is an authenticated viewer/controller
  attached to one Host-owned shared Herdr TUI session. Focus, Tab selection, input, and resize may
  change the Mac view. The Host implementation now advertises `herdr_tui=true`; runtime/operator
  attach and native VT verification remain open. No per-Pane Terminal or fake mobile TUI is introduced. Evidence lives in the Mac
  `docs/remote-tui-protocol-probe-2026-08-29.md`.

## 2. Runtime and ownership

```text
Herdr Runtime
     ↑
Solco Mac Host/Core
     ↑
versioned Solco Host API
     ↑
connection transport
     ↑
Solco Mobile
```

Ownership rules:

- Herdr remains authoritative for runtime Workspaces, Tabs, Panes, Agents, terminal sessions, layouts, and processes.
- Solco Mac Host owns Solco Workspace configuration, Project projection, Task semantics while needed, History projection, authentication, pairing, and the product API.
- Mobile owns presentation, cached server state, device credentials, and its own selected Workspace/Project/Agent/Pane.
- Mobile never talks to the Herdr socket/CLI directly.
- Mobile never treats Project path, terminal ID, or Herdr global focus as a public product identifier.

## 3. Expo versus bare React Native

### Decision

Use **Expo SDK 54 with Expo Development Builds and Continuous Native Generation (CNG)**.

The local build constraint is authoritative: macOS 15.6.1 with Xcode 16.1 must remain able to compile the iOS target. Expo's current matrix makes SDK 54 the newest stable line that officially supports Xcode 16.x. Android is the first implementation and validation platform; iOS remains a supported secondary target. Do not use Expo Go as the production-development baseline, and do not move to SDK 55+ until the local Xcode constraint changes.

### Why Expo wins for Solco Mobile

Expo no longer implies that an application cannot contain native Swift/Kotlin. Development Builds can include arbitrary compatible native libraries, and app-specific native capability can live in a local Expo Module. This preserves access to:

- Keychain/Keystore and SecureStore;
- native networking and discovery APIs;
- future SSH fallback implementation;
- future terminal/native rendering modules;
- push notifications and background integration;
- app links, camera/QR pairing, biometrics, file/image pickers;
- normal iOS/Android native configuration through config plugins and prebuild.

Expo additionally owns a large amount of integration/version work that otherwise becomes application maintenance: Router, native module compatibility, config generation, development clients, EAS/native build integration, and platform APIs.

### Why not bare React Native 0.87 now

The product requirement is not "newest React Native"; it is a reliable client whose Android target can be developed first while preserving local iOS buildability on Xcode 16.1. Expo SDK 54 targets React Native 0.81 and still satisfies Tamagui 2's supported floor. Bare React Native 0.87 would increase native maintenance while moving outside the validated Expo/Xcode line.

Re-evaluate the framework baseline only when the development Mac can move beyond Xcode 16.x or a measured RN 0.81 blocker appears.

## 4. Version baseline

Initial validated dependency direction:

| Layer | Choice |
| --- | --- |
| Native framework | Expo SDK 54 |
| React Native | 0.81.5 |
| React | 19.1.0 |
| Language | TypeScript 5.9, strict |
| Navigation | Expo Router 6 |
| Cross-platform UI system | Tamagui 2.7.x |
| Modal sheet | Gorhom Bottom Sheet 5.2.x |
| Server/Host state | TanStack Query 5 |
| Small local state | Zustand 5 |
| External contract validation | Zod 4 |
| Device secrets | Expo SecureStore |
| Icons | Lucide React Native |
| Package manager | pnpm 11 |

Expo SDK 54 targets RN 0.81 and requires Node 20.19+. The current Node 24 satisfies that runtime requirement. Expo's official matrix lists Xcode 16.1+ for SDK 54, so the local Xcode 16.1 installation is exactly on the supported floor.

## 5. UI component ownership

### Tamagui is the primary design system

Use Tamagui for:

- typography;
- layout stacks;
- buttons and inputs;
- tabs/segmented product surfaces where platform-native behavior is not required;
- cards/list rows;
- semantic tokens and dark theme;
- responsive tablet adaptation.

Reasons:

- packaged components rather than source-copy generation;
- React Native and web compatibility;
- React 19/New Architecture support;
- typed design tokens;
- unstyled/styled components make a custom Solco visual language possible without adopting Material Design.

### Gorhom Bottom Sheet owns sheet/modal gesture behavior

Use Gorhom Bottom Sheet 5 for Workspace/Project jump sheets and other sheet-style flows. It is a mature packaged component with keyboard handling, modal presentation, scrollable integration, accessibility support, React Native Web support, and current peer support for Reanimated 4.

SDK 54's `@expo/ui` is intentionally not a core dependency because its SwiftUI surface is still beta and Jetpack Compose surface alpha on this SDK line. Re-evaluate Expo UI after a future SDK upgrade, but do not trade current stability for platform-native novelty.

### Rejected as primary UI system

**React Native Paper**: mature, but intentionally Material Design 3. Making it look like Solco would mean fighting its primary visual opinion.

**Gluestack UI**: capable, but the current component-generation/source ownership model introduces more application-owned generated UI code than desired for this project.

**Hand-built primitives**: only when Tamagui/Gorhom/Expo SDK APIs cannot satisfy a measured product requirement.

## 6. Navigation architecture

Use Expo Router as the only application navigation owner.

Initial routes:

```text
/
  Agent board
/agent/:agentId
  semantic Live Conversation detail

Approved next:
/connect
/pair
/project/:projectId
/task/:taskId
/history
  semantic Conversation list
/history/:conversationId
  shared History/Live Conversation detail
/settings
```

Do not make Workspace/Project/Tab hierarchy permanent navigation chrome. On a phone it belongs in searchable modal sheets or compact contextual controls.

The native stack owns screen navigation/back behavior. Avoid adding direct React Navigation imports while Expo Router owns the stack.

## 7. State model

Use three deliberately separate state classes.

### Host/server state - TanStack Query

Examples:

- Host bootstrap;
- Workspaces/Projects;
- Agents and statuses;
- Tasks;
- History metadata;
- bounded semantic Conversation windows (Live + History).

Reconnect invalidates/refetches the authoritative Host projection.

### Event stream - Host event client

WebSocket events update/invalidate Query cache. Event delivery is optimization, not a second truth source. On reconnect, bootstrap/refetch repairs missed events.

### Client-local state - Zustand

Only small local concerns:

- selected Workspace/Project;
- sheet/filter preferences;
- ephemeral composer options and reading position.

Conversation drafts are session-memory feature state, never persistent Zustand/AsyncStorage state.

Do not mirror Host runtime state into a large Zustand application store.

## 8. Host API boundary

Mobile contracts should track the Solco Host DTOs, not Herdr protocol shapes.

Initial model families:

- `HostBootstrap`
- `WorkspaceSummary`
- `ProjectSummary`
- `AgentSummary`
- `TaskSummary`
- bounded semantic Conversation windows (Live + History)
- Conversation revision/source/status/capability flags
- version/capabilities

All identifiers are opaque client strings.

Planned commands include:

- start/create Agent;
- prompt Agent;
- interrupt/semantic key Agent;
- read bounded Agent output;
- wait/follow Agent status;
- Task start/stop/restart;
- History Continue through the Host-owned transaction;
- Herdr TUI only through the capability-gated Host-owned shared/global session; global focus/resize
  effects are disclosed and semantic Chat/History never open it implicitly.

The phone never receives a generic `callHerdr(method, params)` endpoint.

## 9. Connection transport

The application protocol stays unchanged across transports.

Approved progression (the former in-memory mock was removed on 2026-08-31; golden fixtures remain
contract-test artifacts only):

1. local authenticated Host API;
2. authenticated LAN direct HTTPS/WSS;
3. Tailscale/WireGuard overlay for early remote private beta;
4. Solco outbound Relay for the eventual normal public-internet experience;
5. SSH port forwarding as an advanced/developer fallback;
6. optional direct-path/QUIC/WebRTC optimization only after measurements justify it.

Transport identity and pairing are separate from Workspace/Project/Agent identity.

Paired Macs (product decision 2026-10-31): the phone keeps a book of Macs in SecureStore, one record per certificate fingerprint (≤8 Macs × 5 addresses), with first-paired and last-connected times, the route judged from the address (LAN / Tailscale / USB) and the phone's network type at the last connect — never a location. Pairing the same Mac over a new address merges into one card; removing the active Mac leaves none active. When the current address does not answer, the client races the Mac's earlier addresses and adopts the first that answers (same certificate, same token); connection failures are classified (timeout / refused / unreachable / certificate / revoked) and show the address, route and phone network. Titles, last-active times and the Needs you / Working / Idle grouping are the Mac's own facts forwarded by the Host (desktop-resolved title chain; only the Mac window's active Herdr session has them), and Idle rows are not polled for a peek line.

## 9a. Web and PWA surface

The Web build is the same mobile client compiled to DOM via react-native-web (`pnpm export:web`, verified 2026-08-24). It is not a second product: styles and interaction follow this document and `mobile-ui-ux.md` unchanged, and desktop browsers render a centered phone-width shell instead of a responsive fork.

Platform seams are the only permitted `Platform.OS === 'web'` branches: web persists both the Host `baseUrl` and `credential` in localStorage through the single seam (product decision 2026-08-31: the PWA must survive page reloads on a LAN tool; expo-secure-store has no web build in SDK 54); the wire naming contract is snake_case with a single transform to internal camelCase in `src/contracts/`.

The target topology is Host-served: the Mac Host serves the exported `dist/` same-origin alongside `/api/v1` (Tailscale HTTPS), eliminating CORS and enabling PWA install. Install acceptance therefore runs over Tailscale HTTPS — a plain LAN IP is a non-secure context where installation and service workers are unavailable. Service workers are explicitly out of scope for the validation track. Full rules: `web-pwa-architecture.md`; sequencing: `web-implementation-plan.md`.

## 10. Security

- Pair each mobile device with the Mac Host.
- Store the device credential in platform secure storage, currently Expo SecureStore.
- Remote API still authenticates even when the connection is carried inside SSH or Tailscale.
- Do not persist raw passwords/private keys in Zustand, AsyncStorage, or application logs.
- Do not accept unknown SSH host keys silently if the advanced SSH transport is implemented.
- Public Relay must remain non-authoritative and should carry encrypted/authenticated client-to-Host traffic without owning Herdr runtime truth.

## 11. Native module strategy

Native code is allowed, but only behind a stable seam.

Use a local Expo Module for an app-specific native capability when no mature package owns it. Likely future candidates:

- SSH direct TCP forwarding fallback;
- Bonjour/Network.framework edge cases not covered by a stable Expo/community package;
- specialized terminal emulator/render integration;
- advanced background networking if Relay requirements demand it.

JavaScript/TypeScript surfaces consume small interfaces such as `connect`, `disconnect`, `status`, or byte streams. They must not become bindings to entire platform frameworks.

## 12. Current environment constraint

The development Mac runs macOS 15.6.1 and uses Xcode 16.1. Local native compilation remains a hard project requirement, but Android is the first implementation/acceptance platform.

Expo SDK 54 is therefore the current compatibility ceiling: Expo's official matrix requires Xcode 16.1+, while SDK 55+ requires the Xcode 26 generation. M0 closes first on a real local Android Development Build/assemble gate; iOS Development Build validation is a secondary platform gate and must pass before iOS-specific work is called complete.

## 13. External research references

Primary references used for this decision:

- Expo SDK version matrix: https://docs.expo.dev/versions/latest/
- Expo custom native code / Development Builds: https://docs.expo.dev/workflow/customizing/
- Expo SDK 54 matrix: https://docs.expo.dev/versions/v54.0.0/
- Expo SDK 54 Reanimated compatibility: https://docs.expo.dev/versions/v54.0.0/sdk/reanimated/
- Gorhom Bottom Sheet: https://gorhom.dev/react-native-bottom-sheet/
- Tamagui installation/requirements: https://tamagui.dev/docs/intro/installation
- Moshi Chat View: https://getmoshi.app/docs/chat-view
- Moshi Agents & Usages: https://getmoshi.app/docs/agents-usages

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
