# Solco Mobile

Phone-native companion client for the Solco Mac Host.

## Status

Foundation/proof stage. The current UI connects to the authenticated Solco Host API; there is no
in-memory demo/runtime adapter. Contract fixtures remain test-only wire snapshots and are never used
as screen data.

## Stack

- Expo SDK 54 / React Native 0.81 / React 19.1
- Expo Development Builds + Continuous Native Generation
- Expo Router
- Tamagui 2
- Gorhom Bottom Sheet 5 for mature sheet/modal behavior
- TanStack Query
- Zustand for small client-local state only
- Zod
- Expo SecureStore
- pnpm 11

## Product boundary

Solco Mobile is a second client of Solco. The Mac Host remains the product/runtime integration boundary over Herdr. Mobile navigation is independent from the Mac UI and all runtime actions use explicit opaque IDs through the Solco Host API.

Agent interaction is primary. Terminal is an advanced fallback surface.

## Read first

`AGENTS.md` and `CLAUDE.md` state the ownership rules. Architecture notes, UX references and the roadmap are kept privately by the maintainer.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm doctor
pnpm start
```

For the real native application use a Development Build rather than Expo Go:

```sh
pnpm ios
pnpm android
```

### Current iOS toolchain note

The development machine runs macOS 15.6.1 with Xcode 16.1. Expo SDK 54 is the newest stable Expo line whose official matrix supports Xcode 16.x (minimum 16.1), so the project deliberately targets SDK 54 to preserve local native compilation. Android is the first implementation/validation platform; iOS remains a supported secondary target on this Xcode baseline. SDK 55+ is deferred until the local Xcode constraint changes.

## Current validation UI

The initial vertical slice intentionally exercises the selected stack:

- Agent board with Needs You / Working / Done sections;
- connected Mac presentation;
- Gorhom Bottom Sheet Workspace/Project picker;
- Expo Router Agent detail;
- Tamagui Chat/Terminal dual view;
- sticky prompt composer;
- SecureStore device credential adapter;
- strict typed Host contracts validated against Mac-generated golden wire fixtures.

## License

[MIT](LICENSE)

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
