# Solco Mobile source
> L2 | Parent: ../CLAUDE.md

Members:
- `app/` — Expo Router screens; presentation/navigation only. `+html.tsx` is the Web-only root HTML shell (PWA metadata/viewport); native platforms ignore it.
- `components/` — reusable mobile UI components built from Tamagui/Gorhom Bottom Sheet before custom primitives.
- `contracts/` — transport-independent typed Solco Host DTO validation; no Herdr protocol types. `__fixtures__/` holds golden wire fixtures copied verbatim from the Go Host's `internal/remotehost/testdata/api-v3` (`pnpm sync:fixtures`) — never hand-edit; `*.contract.test.ts` pins both ends.
- `features/` — feature-local presentation/data helpers; `chat/` is the v3 Chat projection, `host/` the Host queries.
- `lib/` — transport-independent client utilities and secure credential storage.
- `state/` — small client-local state (the selected Herdr session); Host/server state belongs in TanStack Query.
- `theme/` — Solco Mobile design tokens and visual constants.

Rules:
- Screens never call Herdr, SSH, or platform networking directly. They consume a Solco Host client/service boundary.
- Remote-facing identifiers are opaque strings. Do not parse Project paths or derive runtime IDs in UI code.
- Keep semantic Agent Chat as the primary work surface for agent panes; the terminal is the phone's own observe grid (never attaches, never reflows the Mac).
- Prefer Tamagui and Gorhom Bottom Sheet over bespoke modal/sheet/menu gesture implementations. SDK 54 `@expo/ui` is deferred until it is mature enough for the project's stability bar.
- Secure device credentials are persisted only through `expo-secure-store` or a future narrower native credential adapter.
- The mobile app has no demo/mock runtime path; every server projection and mutation comes from the authenticated Host API.

[PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
