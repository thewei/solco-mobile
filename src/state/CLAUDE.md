# state/
> L2 | Parent: ../CLAUDE.md

Members:
- `session-store.ts` — the selected Herdr session (instance; never persisted) plus the Home composer's last Agent/Terminal pick, which IS persisted across restarts through `lib/launch-pick-storage` (`hydrateLaunchPick()` runs once from the root layout; a pick made before the read finishes wins).
- `session-store.test.ts` — hydrate / save-on-change / pick-before-hydrate.
- `share-store.ts` — the shared text waiting for a destination (memory only; cleared once a Chat owns it as its draft).
- `route-notice-store.ts` — the one-line route-switch notice (not persisted; same line at most once per 30 s).
- `project-store.ts` — the Workspace the phone's Changes/Files tabs show, one per Herdr session (memory only; `features/host/project-model` falls back when it is gone).
- `drawer-store.ts` — which list the Home drawer shows, Agents (default) or Workspaces (memory only, client-local).

Rule: client-local session state only — nothing here touches Herdr or holds credentials; the only persisted field is the harmless launch preference (an agent id the composer re-validates against the Host's kinds, and a boolean). Connection truth is the reducer, runtime truth stays with the Host.

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
