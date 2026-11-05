# Solco Mobile documentation
> L2 | Parent: ../CLAUDE.md

Members:
- `debug/` — 原生构建/安装异常的证据链、稳定修复与尚未完成的环境/设备复验门禁；子目录通过 `debug/CLAUDE.md` 索引。
- `mobile-product-architecture.md` — canonical mobile architecture, ownership, technology selection, Host API and transport boundaries.
- `personal-agent-mobile-plan.md` — historical 2026-11-03 Go Assistant/Host v3 implementation planning; the current management screens and resident Host are now present in code, so check actual capabilities rather than older pending-state notes.
- `assistants-chat-first-mobile-plan.md` — **2026-11-04 Chat-first / Assistant Network UX plan**: Contacts + human_dm/peer_dm/group list, typed @, shared ChatPageView, Primary Assistant, Owner Control Center; Network N0–N6 in desktop collaboration plan. Resident Host not yet GUI-independent Provider Chat.
- `assistants-platform-mobile-plan.md` — **V3 mobile settings baseline**: Profile/Permissions, Agent/Model/Effort, Memory Folder, Routine/Automations and proactive controls; superseded extension model now uses MCP services, not Lua/TS plugin runtime.
- `assistants-messenger-agent-mobile-plan.md` — **latest 2026-11-04 messenger-style Assistant/Group mobile plan (M-U0–M-U5)**: Chats/Contacts, circle initial avatars, + → New Assistant/New Group, direct shared ChatPageView for person/group, initial Agent prompt and authorized MCP Servers, Goal follow-through facts and Routine draft/approval; Go Workflow framework research deferred.
- `mobile-ui-ux.md` — phone interaction model, Moshi reference analysis, navigation hierarchy, Agent/Terminal behavior, and component ownership.
- `implementation-roadmap.md` — implementation phases, validation gates, and environment blockers (M0–M8 plus the W0–W3 Web/PWA track).
- `web-pwa-architecture.md` — Web/PWA identity, platform-gap rules, wire contract, target topology (Host-served static bundle), and PWA boundaries.
- `web-implementation-plan.md` — Web/PWA track execution phases and acceptance gates.
- `web-pwa-local-domain.md` — operational runbook: prox/Caddy local domain (`solco.dev.local`), serve-web static + same-origin `/api` bridge, WS subprotocol auth, verification checklist, and DNS troubleshooting (the `.test` resolver lesson).

Rules:
- Architecture owns durable decisions; roadmap owns sequence; UX owns interaction semantics.
- Clearly label Current, Approved Next, and Deferred. Never describe a mock/prototype as a connected Host feature.
- External products are references only. Do not copy their runtime architecture, branding, proprietary assets, or assumptions into Solco.
- Keep the mobile contract aligned with the Mac Host architecture: explicit opaque IDs, client-local semantic navigation, Conversation-first operations, and a capability-gated Host-owned shared/global Herdr TUI. Shared TUI focus/Tab/resize effects are explicit product semantics; the old Pane-terminal validation is historical and not a current product path.

[PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
