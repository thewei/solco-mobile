# Solco Mobile UI / UX

Status: **Conversation interaction contract / semantic surface implemented; shared TUI shipped with the native xterm WebView renderer (touch scrollback, Ctrl modifier); device acceptance in progress**
Baseline: 2026-08-30
Reference: Moshi is an interaction reference, not an architecture or branding dependency.

## 1. Product thesis

Solco Mobile exists to answer three questions quickly:

1. **What needs me?**
2. **What is still working?**
3. **What should I tell the Agent next?**

Desktop topology is secondary. A phone should not spend its permanent screen budget on a Workspace tree, split-pane layout, toolbar ribbon, or terminal chrome.

## 2. What to learn from Moshi

Moshi demonstrates several phone-native interaction patterns that are directly useful to Solco:

### Agent status as the home surface

Its Agents view groups running work into **Needs you / Working / Done**. This is much more scannable on a phone than starting from terminal sessions or project folders.

Solco adopts the same information hierarchy, but the cards represent Solco Host Agent projections and remain scoped by the user's current Solco Workspace/Project filters.

### One semantic surface, two lifecycles

Moshi Chat View demonstrates the value of message/tool cards for a live coding-agent session. Solco
uses one semantic `ConversationSurface` for both Live Chat and History Detail; only the controller/lifecycle
differs (prompt versus Continue). The Mac Host normalizes provider output, so Mobile never simulates Chat
with local prompt arrays, raw `agent.read`, provider files, or ANSI parsing.

### Jump-to navigation belongs in a sheet

Workspace/Project/Tab/Pane selection should be transient and searchable. A modal Bottom Sheet provides the hierarchy only when the user asks for it.

The validation screen already implements Workspace + Project selection with Gorhom Bottom Sheet 5, using the Expo 54-compatible Gesture Handler/Reanimated stack.

### Terminal controls are capability-gated

Herdr TUI is the only normal Terminal implementation. Mobile attaches to one Host-owned
shared/global session; focus, Tab selection, input, and resize can therefore be observed by and
change the Mac/other clients. The UI discloses that behavior at the entry point. A future TUI must use
a real VT renderer and one shared session per Host, never a Pane picker or per-Pane process fleet.

## 3. Visual direction

Name: **Quiet Operations**.

The surface should feel like a native operations companion for developers, not a colorful chat app and not a tiny IDE. The visual anchor is Agent state: attention amber, working indigo, successful green, all on near-black neutral surfaces.

**Markdown parity note (2026-08-30):** `MarkdownContent` is one shared,
bounded adapter for Live and History, currently backed by safe plain `Text`.
No renderer dependency has yet passed the Expo SDK 54 / React Native 0.81 /
React 19 Android+iOS+web compatibility spike, so this remains an explicit
presentation gap; no row-local regex Markdown parser is introduced.

Principles:

- dark-first;
- restrained borders rather than heavy shadows;
- compact but touch-safe rows;
- system typography until a concrete branding font is approved;
- one accent family, not multiple decorative gradients;
- status color carries meaning only, never decoration;
- cards only where grouping/action affordance benefits from a bounded surface.

Initial design tokens live in `src/theme/tokens.ts`.

## 4. Home: Agent board

The first connected screen is **Agents**, not Hosts or Projects.

Header:

- Solco identity;
- connected Mac identity/status;
- Search;
- New Agent.

Context control:

- compact `Workspace / Project` pill;
- tap opens `Jump to…` Bottom Sheet;
- the selection belongs to the phone and does not focus the Mac.

Sections:

1. Needs You
2. Working
3. Done

Each Agent card contains only scan-critical information:

- Agent/work name;
- Project;
- Agent kind;
- status;
- freshness;
- one/two-line current summary.

Do not include terminal IDs, Pane IDs, paths, token accounting, or every possible action in the card.

## 5. Agent detail

Agent detail has two explicit modes.

### Chat

Primary mobile work surface.

Includes:

- Project and Agent identity;
- working/blocked status;
- bounded message/output timeline;
- structured tool/task cards when the Host can provide safe structure;
- approval/question cards when the action maps safely to the running Agent;
- sticky composer;
- stop/interrupt action while working.

Composer priorities:

- text prompt;
- send;
- future voice dictation;
- future image/file attachment;
- clear progress/offline state;
- no desktop keyboard assumptions.

Follow behavior:

- follow latest while the user remains at the bottom;
- once the user scrolls up, do not yank the viewport as new output arrives;
- show a jump-to-latest control.

### Terminal

Shipped on the explicit `herdr_tui` capability as the `/terminal/[terminalId]` route: one Host-owned
shared/global session rendered by an embedded xterm.js WebView (vendored assets), with direct typing,
a whole-line input, a key row plus a Ctrl modifier toggle, touch scrollback, and a jump-to-latest
control. The retired `/pane/[paneId]` route is diagnostic-only under an opt-in build flag and is not
a product escape hatch.

## 6. Workspace and Project navigation

`Jump to…` is a native modal sheet.

Initial hierarchy:

```text
Workspace
  Project

Approved next:
  Agent
  Task
  Tab / Pane
```

Search should match labels and product metadata but never require the user to know runtime identifiers.

Changing mobile selection updates mobile local state/query scope only.

## 7. New Agent

New Agent should be a mobile composer, not a desktop form.

First version:

- Project context at top, tappable to change through Sheet;
- large multi-line instruction field;
- Agent picker;
- mode/branch options progressively disclosed;
- attachments accessible from one compact action;
- primary Start button near the keyboard.

Do not expose runtime Tab/Pane creation details.

## 8. Tasks

Tasks are operational shortcuts rather than configuration-first UI.

Phone first:

- status list;
- start/stop/restart;
- ports/health summary where available;
- jump to owning Agent/Pane.

Desktop/Host remains the better place for complex Task definition editing initially.

## 9. History

History is a secondary navigation destination.

- searchable semantic Conversation metadata list filtered by opaque `project_id`;
- bounded paged Conversation windows from Host;
- Continue resumes through Host/Herdr and returns a Live identity;
- History and Live Detail retain one visual ConversationSurface;
- never download every transcript in bootstrap;
- mobile caches only bounded presentation data and preserves draft text on failure.

## 10. Offline and reconnect

Phone lifecycle is expected to disconnect.

When foreground connection drops:

- preserve the last bounded UI projection;
- show stale/offline state without pretending actions succeeded;
- queue no dangerous runtime mutation by default;
- reconnect transport;
- refetch Host bootstrap/current Agent;
- reconcile by opaque identity.

Agent work continues on the Mac/Herdr runtime while the phone is absent.

## 11. Component ownership

Use these owners before custom primitives:

| Interaction | Owner |
| --- | --- |
| app navigation/back | Expo Router |
| modal jump/project selection | Gorhom Bottom Sheet 5 |
| menu/context actions | Tamagui / platform APIs first; reassess Expo UI after SDK upgrade |
| layout/text/button/input/card/tabs | Tamagui |
| server loading/cache | TanStack Query |
| local Workspace/Project choice | Zustand |
| secret credential | SecureStore |
| icons | Lucide React Native |

Do not implement a custom Bottom Sheet, gesture recognizer, focus manager, navigation stack, or secure-storage wrapper beyond the narrow application adapter unless the selected mature owner is proven insufficient.

## 12. Current validation surface

Current source is a real-Host-only vertical slice. The mobile bundle has no in-memory
runtime or demo adapter; validation starts at the authenticated Connect screen:

- dark Solco Agent board;
- Needs You / Working / Done grouping;
- connected Mac indicator;
- mature Bottom Sheet Workspace/Project picker;
- semantic Live Agent detail route using ConversationSurface;
- semantic History list/detail using the same ConversationSurface;
- sticky prompt/Continue composer with session-memory draft;
- capability-gated global Herdr TUI action (`herdr_tui=true` on the implemented Host; native xterm WebView renderer live with touch scrollback);
- typed Host v2 DTOs validated against Mac-generated golden wire fixtures.

The semantic UI is wired directly to the authenticated HTTP Host contract. The native xterm WebView TUI renderer is live;
remaining acceptance is the real-device pass (edge-to-edge layout, keyboard ride-up, touch scrollback, Ctrl sequences,
reconnect) on Android first, iOS second.

## 13. Visual acceptance later

Before visual design is considered complete, verify on real devices at minimum:

- 375px-class iPhone width;
- large iPhone width;
- Android phone with gesture navigation;
- keyboard open/closed;
- Dynamic Type / font scaling;
- dark appearance contrast;
- slow/offline status;
- Bottom Sheet interaction and keyboard behavior;
- Agent timeline while streaming updates.

Tablet can adapt later using the same components; do not design the first release as a tablet split IDE.

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
