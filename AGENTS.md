# AGENTS.md

## Start here

Before developing Solco Mobile, read:

1. `CLAUDE.md` — repository ownership and dependency rules.
2. `docs/mobile-product-architecture.md` — canonical mobile architecture and Host boundary.
3. `docs/mobile-ui-ux.md` — Agent-first phone interaction contract and Moshi-derived reference principles.
4. `docs/implementation-roadmap.md` — implementation order and acceptance gates.
5. `docs/web-pwa-architecture.md` + `docs/web-pwa-local-domain.md` — Web/PWA track: architecture and the local-domain runbook (prox / serve-web / same-origin API bridge).
6. `docs/android-development-prep.md` — Android track: toolchain state, dev-build loop, and the A04 native VT decision path.

## Private assets (solco-docs)

`docs/` and `.agents/` (the `solco-mobile-dev` / `solco-mobile-install` skills and their device facts) are symlinks into the **private** sibling repository `../solco-docs` (its `solco-mobile/` folder); `.gitignore` keeps them out of every commit here, and everything "Start here" names under `docs/` is read through the link as before. The rulebook is the `solco-docs` skill in the Solco repository (`../solco/.agents/skills/solco-docs/SKILL.md`); these rules apply to every session:

- **Read.** A path that does not resolve means a missing link or checkout: `bash ../solco-docs/link.sh --check`, then `bash ../solco-docs/link.sh`. No `../solco-docs`: stop and tell the user; never recreate, stub or guess those files here.
- **Write and commit.** Mobile architecture, UX and roadmap text, runbooks, skills and device facts are written through the link and committed in solco-docs (`bash ../solco/.agents/skills/solco-docs/scripts/commit-docs.sh -m "…" -- docs/…`); code, tests and rules are a separate commit here (`bash ../solco/.agents/skills/solco-commit/scripts/commit-paths.sh`). Two repositories, two commits, never `git add -A`; also check `git -C ../solco-docs status --short`. The Android keystore and every other key stay in solco-docs, never here.
- **Authorship.** Commit as the user's GitHub identity: both scripts set it, a hand-typed `git commit` passes it (the skill has name and address). Never a placeholder name, never the personal address from the global git config.
- **No leak back.** Nothing private goes into this repository's files, commit messages or CI: document text, device serials, adb or LAN addresses, tokens, pairing codes, keystores, home paths. `pnpm typecheck`, `pnpm lint`, `pnpm test` and CI pass on a clone without solco-docs.
- **Publish.** Push only when asked, after the outbound scan and author check (`solco-commit`); solco-docs stays private, no force-push and no tag there.

## Product boundary

- **Solco Mobile is a client of the Solco Mac Host.**
- **Herdr remains behind the Mac Host runtime boundary.** Do not expose Herdr protocol types or socket/CLI details as mobile domain APIs.
- Mobile Workspace/Project/Tab/Pane selection is client-local. It must not move the Mac user's navigation unless a future explicit `Show on Mac` action is invoked.
- Agent semantic operations are primary. Terminal is an advanced surface, not the default mobile interaction model.
- Business API contracts are independent of LAN, Tailscale, Relay, or SSH transport.

## Technology ownership

Prefer mature owners before custom code:

1. Expo SDK APIs / Expo Router.
2. Tamagui packaged components and tokens.
3. Gorhom Bottom Sheet for mature cross-platform sheet/modal behavior on the Xcode-compatible SDK 54 baseline.
4. React Native platform APIs.
5. Proven compatible libraries already selected by the architecture.
6. A local Expo Module for app-specific Swift/Kotlin only when no mature owner exists.
7. Hand-written gesture/modal/navigation infrastructure only as a last resort.

Baseline:

- Expo SDK 54 / React Native 0.81 / React 19.1, selected because it is the newest stable Expo line that officially supports the local Xcode 16.1 toolchain.
- Expo Development Build as the native development baseline; Expo Go is only a convenience smoke surface when a feature happens to fit it.
- Expo Router for navigation; do not add direct React Navigation application imports while Expo Router owns the stack.
- Tamagui 2 for cross-platform design-system components.
- Gorhom Bottom Sheet 5 for Workspace/Project jump sheets and other modal sheet flows; SDK 54 `@expo/ui` stays deferred because its SwiftUI/Compose surface is still beta/alpha.
- TanStack Query for Host/server state, Zustand only for small client-local state, Zod at external data boundaries, SecureStore for device credentials.

## Web / PWA local integration

- `scripts/serve-web.mjs` is infrastructure only: serve `dist/`, proxy `/api/*` to the Mac Host, pass through WS upgrades. No business or auth logic there — contract and credential semantics live in `src/contracts/` and the Mac Host.
- `.prox.yaml` owns the local domain (`solco.dev.local`, hosts transport), the 8090 port, and the `web`/`export` tasks. Port changes move in lockstep with serve-web's `PORT` and require `prox scan → generate → reload`.
- The Host wire contract is pinned twice: Zod schemas in `src/contracts/host-v3.ts` and the golden fixtures in `src/contracts/__fixtures__/v3/` copied verbatim from the solco repo's `internal/remotehost/testdata/api-v3` (`pnpm sync:fixtures`). Never edit fixtures by hand; regenerate from the Go Host and keep `pnpm test` green in both repos in the same change.
- WebSocket credentials travel as the subprotocol pair `['solco.bearer', token]` (browsers cannot set the Authorization header on WS). Do not reintroduce header-based WS auth.
- The device credential (token + pinned fingerprint) lives only in SecureStore through `src/lib/host-connection-v3.ts`. Pairing needs the native pinned transport (`modules/solco-pinned-transport`, Android first); iOS and Web have none, so LAN/Tailscale direct connections never fall back to an unpinned fetch; a relay host is one the user registered explicitly at pairing — an explicit new path, not a fallback. Tokens never enter Zustand or logs.
- Runbook-level operation (prox commands, troubleshooting, the `.test` DNS lesson) lives in `docs/web-pwa-local-domain.md` — follow it instead of improvising DNS or proxy changes.

## Checks

Before calling a slice complete, run the checks that are possible in the current environment:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm doctor
pnpm export:web
```

Android is the first implementation/validation platform. For Android-facing slices, verify a local Development Build or Gradle debug assembly whenever the Android SDK/JDK toolchain is available. iOS remains a supported secondary target on Xcode 16.1 and requires its own Development Build gate before iOS-specific work is called complete. Never claim a native build passed when the local SDK/toolchain cannot satisfy Expo's minimum requirements.

## Git safety

Do not stage, commit, push, reset, restore, or rewrite user Git state unless explicitly requested.

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
