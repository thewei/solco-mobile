# Mobile Web E2E Progress

## Status: Historical Phase 2 evidence — Pane Terminal path superseded by 2026-08-30 Conversation convergence

Date: 2026-08-25 (historical validation)

> The checks below record what the pre-convergence Web build did, not the current product contract.
> The normal `TerminalsSection` and `/pane/[paneId]` navigation are removed/demoted in the current
> convergence source; Batch 10 IA cleanup is source-audited, while overall acceptance remains open
> for runtime/operator and native VT gates. The Host now advertises `herdr_tui=true` for the shared
> session. Batch 0 found global semantics rather than
> client-local isolation; that contention is an accepted, disclosed behavior. Do not use this document as evidence that
> Pane Terminal is supported.

## Verified Capabilities

### Connection
- [x] `#pair=<token>` QR deep-link auto-connect
- [x] Manual connect via `/connect` page (HOST URL + credential)
- [x] `serve-web.mjs` proxying `/api/*` to Mac Host Remote API (port 8757)
- [x] WebSocket events bridge for live updates

### Agent Browsing
- [x] Bootstrap projection loads workspaces, projects, agents
- [x] Workspace/Project picker (Jump to… bottom sheet)
- [x] Agent status sections (IDLE/WORKING/DONE/BLOCKED)
- [x] Agent detail page with Chat and Terminal tabs

### Terminal (Web)
- [x] wterm (Zig→WASM) rendering ANSI-formatted agent output
- [x] Remote API `format=ansi` parameter passes raw ANSI to client
- [x] Custom Solco dark theme via CSS variables
- [x] 5s polling for output refresh
- [x] Event-driven invalidation via WS bridge

### Terminal Input
- [x] wterm `onData` → `vtDataToHerdrKeys()` → `sendAgentKeys` API
- [x] VT escape sequence mapping (Enter, Backspace, Arrow keys, Ctrl+C, etc.)
- [x] Single-character key protocol (Herdr rejects multi-char strings)
- [x] Copy button for terminal output

### Prompt
- [x] Text prompt via Chat tab → `POST /agents/{ref}/prompt`
- [x] Quick prompts (Continue, Summarize, What do you need?)
- [x] Per-agent session draft persistence

## Key Bugs Fixed

1. **React 18 Strict Mode + Pair Fragment** — Double mount strips hash on first pass; module-level cache preserves pair info for second mount.
2. **VT→Herdr Key Mapping** — wterm sends VT sequences (`\r`, `\x1b[A`); Herdr expects named keys (`ENTER`, `UP`) or single characters.
3. **Mac App Crash on Mobile Icon** — GPUI recursive update panic; fixed with `cx.defer()` then removed `mobile_url_input` entirely.
4. **Remote+Mobile Settings Merge** — Eliminated duplicate sections; Mobile now owns all host connectivity settings.
5. **QR Pairing Simplification** — Removed Web URL input; QR directly embeds Mac's `ip:port#pair=token`.

## Architecture

```
Phone Browser                              Mac
┌───────────────────┐                ┌──────────────┐
│  Expo Web Export  │  HTTP/WS       │  Solco   │
│  (dist/ static)   │◄──────────────►│  Remote API  │
│                   │  serve-web     │  (port 8757) │
│  wterm (WASM)     │  proxy :8090   │              │
│  React Query      │                │  Herdr       │
│  Tamagui          │                │  Runtime     │
└───────────────────┘                └──────────────┘
```

## Remote API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/hello` | GET | Health check + version negotiation |
| `/api/v1/bootstrap` | GET | Full workspace/project/agent projection |
| `/api/v1/projects/{id}/agents` | GET | Project-scoped agent list |
| `/api/v1/agents/{ref}/output?format=ansi` | GET | Agent terminal output (ANSI) |
| `/api/v1/agents/{ref}/prompt` | POST | Send prompt text to agent |
| `/api/v1/agents/{ref}/keys` | POST | Send terminal keys to agent |
| `/api/v1/events` | WS | Real-time event stream |

## Herdr Key Protocol

Herdr `agent.send_keys` accepts:
- Single ASCII characters: `"a"`, `"1"`, `"/"`, etc.
- Named keys: `ENTER`, `BACKSPACE`, `TAB`, `ESC`, `SPACE`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `CTRL_C`, `CTRL_D`, `CTRL_Z`
- Does NOT accept: multi-char strings, raw control chars (`\r`, `\x7f`), ANSI sequences (`\x1b[A`)

---

## Phase 2: Pane Terminal + Terminals Section (2026-08-25)

### Remote API Additions (solco)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/panes/{pane_id}/output` | GET | Pane terminal output (format=text\|ansi) |
| `/api/v1/panes/{pane_id}/keys` | POST | Send terminal keys to any pane |
| `/api/v1/workspaces` | POST | Create workspace |
| `/api/v1/workspaces/{id}` | DELETE/PUT | Close/rename workspace |
| `/api/v1/workspaces/{id}/move` | POST | Reorder workspace |
| `/api/v1/tabs` | POST | Create tab |
| `/api/v1/tabs/{id}` | DELETE/PUT | Close/rename tab |
| `/api/v1/panes/{id}/split` | POST | Split pane |
| `/api/v1/panes/{id}` | DELETE | Close pane |
| `/api/v1/agents` | POST | Start new agent |
| `/api/v1/agents/{ref}/stop` | POST | Stop agent |
| `/api/v1/agents/{ref}/interrupt` | POST | Interrupt agent |

### Verified Capabilities

#### Terminals Section (Home Page)
- [x] Collapsible TERMINALS section below Agents with pane count badge
- [x] Panes grouped by Tab (tab header card + pane rows)
- [x] Agent-attached panes show agent name + kind label + colored status dot
- [x] Non-agent panes show terminal icon + title + cwd
- [x] Click pane row → navigate to Pane Terminal detail or Agent detail
- [x] `TerminalSquare` icon entry point in header for Remote Control screen

#### Pane Terminal Page (`/pane/[paneId]`)
- [x] Header: pane title + tab name + cwd
- [x] wterm renders full ANSI terminal output via `getPaneOutput(format=ansi)`
- [x] Input: wterm `onData` → `vtDataToHerdrKeys()` → `sendPaneKeys` API
- [x] Copy button (web)
- [x] Native fallback: ScrollView with monospace text + follow-latest

#### Remote Control Screen (`/control`)
- [x] Full workspace → tab → pane tree view
- [x] Create workspace action
- [x] Tab/pane rename and close actions
- [x] Navigate to Agent detail or Pane Terminal from pane row

### Modified Files

| File | Change |
|---|---|
| `src/features/host/queries.ts` | `usePaneOutput`, `useSendPaneKeys` hooks |
| `src/app/pane/[paneId].tsx` | New Pane Terminal detail page |
| `src/app/index.tsx` | `TerminalsSection` + `PaneRow` + header icon |
| `src/app/control.tsx` | Remote Control tree view |
| `src/app/_layout.tsx` | Registered `pane/[paneId]` and `control` routes |
| `src/lib/host-client.ts` | `getPaneOutput`, `sendPaneKeys` + all P0/P1 methods |
| `scripts/serve-web.mjs` | `/pane/` dynamic route fallback |

### Known Issues
- **ego-browser click compatibility**: React Native Web's Responder event system (TouchableOpacity/Pressable) does not respond to ego-browser coordinate clicks. Real browser touch/mouse works correctly.

---

## Phase 3: Agent Composer + History + Virtual Keyboard v2 (2026-08-25)

### Virtual Keyboard v2
- Three-page layout: ABC (QWERTY 26-key + esc/tab/↑/^C/⌫/⏎), 123 (digits + symbols), Ctrl (control combos + paste)
- Shift key toggles uppercase for letter input
- Long-press repeat for Backspace, arrow keys, Space (400ms delay, 80ms interval)
- Clipboard paste button (Ctrl page)
- Enter key at QWERTY-standard position (end of a-l row)
- Virtual keyboard pushes terminal content up, auto-scrolls to bottom on open

### Agent Composer
- "+" header button → `/new-agent` → choose agent type → choose/create pane → start agent
- 10 agent types: Claude, Cursor, Codex, Gemini, Opencode, Copilot, Kiro, Antigravity, Grok, Kimi
- Auto-creates tab if no free pane available
- Error display and navigation to agent detail on success

### Agent History
- `/history` page with list and search
- Remote API: `GET /api/v1/history/sessions`, `GET /api/v1/history/sessions/search`
- Session cards show agent type, project, relative time, messages, git branch, model
- "Agent History" entry on home screen (gated by `capabilities.history`)

### Navigation Fixes
- Back button (← ArrowLeft) added to Pane Terminal and Agent detail pages
- Back navigates to previous page or home screen

### GPUI Stability
- Resolved: `create_tab`, `split_pane`, `create_workspace` via Remote API no longer crash Mac App

### Modified Files (Phase 3)

| File | Change |
|---|---|
| `src/app/pane/[paneId].tsx` | Virtual keyboard v2 (3 pages, Shift, repeat, paste), back button |
| `src/app/agent/[agentId].tsx` | Back button, navigation fix |
| `src/app/new-agent.tsx` | Agent Composer (new file) |
| `src/app/history.tsx` | Agent History browser (new file) |
| `src/app/index.tsx` | "+" button, "Agent History" card, TERMINALS default expanded |
| `src/app/_layout.tsx` | Registered `/new-agent`, `/history` routes |
| `src/features/host/queries.ts` | `useCreateTab`, `useStartAgent`, `useHistorySessions`, `useSearchHistorySessions` |
| `src/lib/host-client.ts` | `listSessions`, `searchSessions` methods |
| `src/contracts/host.ts` | `SessionMeta` schema |
| `src/components/web-terminal.tsx` | `scrollToBottomTrigger` prop |
| `src/components/workspace-picker.tsx` | Backdrop dismiss |

### Remote API Additions (solco, Phase 3)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/v1/history/sessions` | GET | List agent sessions (limit, project_path) |
| `/api/v1/history/sessions/search` | GET | Search sessions (q, limit) |
| `/api/v1/agents` | POST | Start new agent in pane |
| `/api/v1/tabs` | POST | Create new tab |
