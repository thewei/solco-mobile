# state/
> L2 | Parent: ../CLAUDE.md

Members:
- `session-store.ts` — the selected Herdr session (instance; never persisted) plus the composers' last Agent/Terminal pick, which IS persisted across restarts through `lib/launch-pick-storage` (`hydrateLaunchPick()` runs once from the root layout; a pick made before the read finishes wins).
- `appearance-store.ts` — the System / Light / Dark choice (2026-11-08), persisted through `lib/appearance-storage` (`hydrateAppearance()` runs once from the root layout, which keeps the splash up until it answers so no frame draws the wrong palette); one enum, nothing sent to the Host.
- `chat-prefs-store.ts` — 客户端本地聊天偏好（TOC 对话大纲轨开关，默认关闭），经 `lib/chat-prefs-storage` 持久化，`hydrateChatPrefs()` 由根布局调用。
- `session-store.test.ts` — hydrate / save-on-change / pick-before-hydrate.
- `share-store.ts` — the shared text waiting for a destination (memory only; cleared once a Chat owns it as its draft).
- `route-notice-store.ts` — the one-line route-switch notice (not persisted; same line at most once per 30 s).
- `results-store.ts` — dismissed task-result cards (2026-11-07): one watermark (epoch ms) per Assistant, persisted through `lib/results-seen-storage` (`hydrateResultsSeen()` runs once from the root layout; newest wins, so a dismissal made before the read finishes is kept); only Assistant ids and times, nothing sent to the Host.
- `results-store.test.ts` — hydrate / save-on-dismiss / never backwards / dismissal-before-read.

Rule: client-local session state only — nothing here touches Herdr or holds credentials; the only persisted field is the harmless launch preference (an agent id the composer re-validates against the Host's kinds, and a boolean). Connection truth is the reducer, runtime truth stays with the Host.


[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
