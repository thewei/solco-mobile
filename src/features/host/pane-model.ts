// [INPUT]: v3 tree DTOs (workspaces → tabs → panes) and whether the Host serves Chat.
// [OUTPUT]: paneTitle (the Mac sidebar's title chain), paneRoute (where a pane opens), flattenPanes,
//           summarize (needs-you / working / idle groups, most recently worked first), agoShort,
//           comparePanes (the urgency order of the lists), agentAge + reportsAges (the age word of a settled row, and
//           `New` for an agent that never ran a turn — for 10 minutes after the Host first saw it, then its age).
// [POS]: Pure presentation model shared by Chats, Sessions and the Workspace page; no IO, no state.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { TreeBackground, TreePane, TreeWorkspace } from '@/contracts/host-v3';

const cwdLeaf = (pane: TreePane): string | undefined => pane.cwd?.split('/').filter(Boolean).pop();

/**
 * An agent is called what the Mac sidebar calls it: the Host forwards the desktop's own title (the agent's
 * session title, else its name, else the provider's display name). Without one (an older Host) the pane label
 * and the raw provider stand in; a plain pane keeps its Herdr label.
 */
export function paneTitle(pane: TreePane): string {
  if (pane.agent) return pane.agent.title?.trim() || pane.label?.trim() || pane.agent.provider || cwdLeaf(pane) || 'Terminal';
  return pane.label?.trim() || cwdLeaf(pane) || 'Terminal';
}

/** The Mac's compact "last worked" age: `<1m`, `5m`, `3h` (under 48 h), `2d`; empty while unknown. */
export function agoShort(thenMs: number | undefined, now: number): string {
  if (!thenMs) return '';
  const minutes = Math.floor(Math.max(0, now - thenMs) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * True when the Host reports a last-worked time for at least one agent. Only then does a missing time mean "never worked";
 * an older Host, or the resident Host without a session catalog, reports none and says nothing about any single agent.
 */
export function reportsAges(items: readonly FlatPane[]): boolean {
  return items.some((item) => item.pane.agent?.lastActiveMs !== undefined);
}

/** How long after the Host first saw an agent that never ran a turn the row says `New` (then the age since). */
const NEW_WINDOW_MS = 10 * 60_000;

/**
 * What a settled agent row shows where its age goes: the Mac's `5m` / `3h`. An agent without a time, when `agesKnown`
 * (see `reportsAges`), has not run a turn yet, so there is nothing to date by work: it reads `New` for 10 minutes after
 * the Host first saw it (`firstSeenMs`), then the age since (`2h`); an older Host sends no `firstSeenMs`, so it reads `New`.
 * A Host that reports no times at all says nothing about any single agent, and a plain pane shows nothing.
 */
export function agentAge(pane: TreePane, now: number, agesKnown: boolean): string {
  const worked = agoShort(pane.agent?.lastActiveMs, now);
  if (worked || !agesKnown || !pane.agent) return worked;
  const seen = pane.agent.firstSeenMs;
  if (seen === undefined) return 'New';
  return now - seen < NEW_WINDOW_MS ? 'New' : agoShort(seen, now);
}

/**
 * Newest first by last-worked time; an agent that never ran a turn has none, so the moment the Host first saw it stands in
 * (it then ages like any chat instead of staying first forever). With neither time (an older Host) it counts as newest — it
 * was just created; ties (every agent of a Host that reports no times) keep the tree's order.
 */
const lastWorked = (pane: TreePane) => pane.agent?.lastActiveMs ?? pane.agent?.firstSeenMs ?? Number.POSITIVE_INFINITY;
const newestFirst = (a: TreePane, b: TreePane) => (lastWorked(a) === lastWorked(b) ? 0 : lastWorked(b) > lastWorked(a) ? 1 : -1);

const URGENCY: Record<string, number> = { blocked: 0, working: 1 };

/** Drawer order inside a Workspace: blocked, working, other agents (most recently worked first; a chat that never ran a turn counts from when the Host first saw it), then plain panes. */
export function comparePanes(a: TreePane, b: TreePane): number {
  const rank = (pane: TreePane) => (pane.agent ? (URGENCY[pane.agent.status] ?? 2) : 3);
  return rank(a) - rank(b) || newestFirst(a, b);
}

export type PaneRoute =
  | { pathname: '/chat/[paneId]'; params: { paneId: string; terminalId: string; instance: string; title: string; draft?: string } }
  | { pathname: '/terminal/[terminalId]'; params: { terminalId: string; instance: string; title: string } };

/** An agent pane opens its Chat when the Host serves it; every other pane opens its terminal. */
export function paneRoute(pane: TreePane, instance: string, chatServed: boolean): PaneRoute {
  const title = paneTitle(pane);
  return pane.agent && chatServed
    ? { pathname: '/chat/[paneId]', params: { paneId: pane.paneId, terminalId: pane.terminalId, instance, title } }
    : { pathname: '/terminal/[terminalId]', params: { terminalId: pane.terminalId, instance, title } };
}

export interface FlatPane {
  pane: TreePane;
  workspace: TreeWorkspace;
  tabLabel: string;
}

export function flattenPanes(workspaces: readonly TreeWorkspace[]): FlatPane[] {
  return workspaces.flatMap((workspace) =>
    workspace.tabs.flatMap((tab) => tab.panes.map((pane) => ({ pane, workspace, tabLabel: tab.label }))),
  );
}

export interface TreeSummary {
  /** Agents that are blocked on a human. */
  needsYou: FlatPane[];
  working: FlatPane[];
  /** Every other agent (idle, done, …). */
  idle: FlatPane[];
}

export function summarize(workspaces: readonly TreeWorkspace[]): TreeSummary {
  const panes = flattenPanes(workspaces);
  // Array#sort is stable, so panes with equal times keep the tree's order.
  const recent = (items: FlatPane[]) => items.sort((a, b) => newestFirst(a.pane, b.pane));
  return {
    needsYou: recent(panes.filter((item) => item.pane.agent?.status === 'blocked')),
    working: recent(panes.filter((item) => item.pane.agent?.status === 'working')),
    idle: recent(panes.filter((item) => item.pane.agent && item.pane.agent.status !== 'blocked' && item.pane.agent.status !== 'working')),
  };
}

/** The status word a background item draws with the shared slot (a service has its own square shape). */
export function backgroundStatus(item: TreeBackground): string {
  if (item.kind === 'service') return 'done';
  return item.state === 'working' ? 'working' : 'idle';
}

/** `2 sub-agents · 1 service` — the fold's one line. */
export function backgroundSummary(items: readonly TreeBackground[]): string {
  const subs = items.filter((item) => item.kind === 'subagent').length;
  const services = items.length - subs;
  return [subs ? `${subs} sub-agent${subs === 1 ? '' : 's'}` : '', services ? `${services} service${services === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}

/** Something in the list is still doing work: the fold starts open (the desktop's rule), else folded. */
export function backgroundBusy(items: readonly TreeBackground[]): boolean {
  return items.some((item) => item.state === 'working');
}
