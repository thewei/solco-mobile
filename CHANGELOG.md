# Changelog

Curated companion app releases matching the desktop Solco host.

## v0.13.0 — 2026-11-05

### New
- Assistants: each Assistant's conversation, inbox and Coordinator start — the full Assistants experience on the phone
- Assistants: real group chats bring several Assistants into one conversation
- Assistants: a replayable Activity history of each Assistant's durable work
- Assistants: run reports arrive in Chat, with verified replies marked
- Automations: a dedicated Automations screen (what runs when, last result, drafts waiting), opened from Home or an automation notification
- Automations: manage like on the Mac — approve drafts, run now, pause/resume, edit, delete, create, scheduler control, run history
- Push: opt-in Android system notifications for Assistant and automation steps, with tap-to-open routing and token renewal
- Home: agents listed as calm borderless rows with per-row actions under ⋯
- Chat: Assistant replies stream live, and missed frames recover after a drop

### Fixed
- Chat: reconnects are fenced and WebView updates publish only after render, ending ghost updates
- Assistants: uncertain Coordinator status reports are reconciled instead of guessed

## v0.12.0 — 2026-11-02

### New
- Navigation: bottom tab bar for Agents, Changes, Files, Sessions, and Quota with adaptive capability visibility
- Git: review working tree changes, stage/unstage files, commit message composer, and sync operations
- Devices: bridged device switching between connected Herdr sessions and saved remote machines in the drawer
- Sessions Trash: swipe or long-press to move sessions to Trash with instantaneous Undo and Put Back view
- Files: read-only file browser with inline previews (text, markdown, images) and Attach to Chat draft hand-off
- Background work: sub-agents and active pane services fold out directly under their parent agent row
- Live status: persistent agent status line in notifications and Home view with Needs You / Working / Idle cues

### Fixed
- Chat: lock tool rollups to a single line and anchor context window sheets cleanly above the composer
- Connection: stack blocked network cards properly instead of squeezing elements into one row
- Chat identity: render title, provider, and secondary action menus reliably in custom header subviews

### Improved
- Chat motion: fluid cross-fade transition and zoom animation expanding from the tapped composer card
- Composer: bottom composer rises in a single smooth motion with the software keyboard
- Connection manager: race direct LAN and relay paths to prioritize lowest latency with seamless fallback
