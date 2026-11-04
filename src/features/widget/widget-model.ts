// [INPUT]: the v3 tree (workspaces → tabs → panes), the Herdr instance it came from and whether the Host serves Chat.
// [OUTPUT]: WidgetData (the three counts + the most urgent agents as rows), WidgetState (what the widget can
//           say: unpaired / offline / ready), buildWidgetData, paneUri (the deep link a row opens), visibleRows.
// [POS]: Pure model of the Android home-screen widget; no IO, no React, no native import. The widget view
//        (solco-widget.tsx), the headless task (task-handler.tsx) and the live push (widget-sync.tsx) all
//        draw from this one shape, so the three can never disagree about order or counts.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariant: titles are the Mac sidebar's own (paneTitle) and are shown on the home screen only — the widget
// is declared `not_keyguard`, so it never appears on the lock screen. Nothing here is persisted.
import type { TreeWorkspace } from '@/contracts/host-v3';
import { paneTitle, summarize, type FlatPane } from '@/features/host/pane-model';

/** The receiver name registered by the config plugin; the one key between app.config.ts and the code. */
export const WIDGET_NAME = 'SolcoAgents';
/** Most rows the widget ever draws. */
export const WIDGET_MAX_ROWS = 3;

export type WidgetRowStatus = 'blocked' | 'working' | 'idle';

export interface WidgetRow {
  paneId: string;
  title: string;
  status: WidgetRowStatus;
  /** The Workspace label, drawn small beside the title. */
  caption: string;
  /** Deep link into the app: that agent's Chat (or its Terminal when the Host does not serve Chat). */
  uri: string;
}

export interface WidgetData {
  needsYou: number;
  working: number;
  idle: number;
  /** Most urgent first: needs you, then working, then idle (each most recently worked first). */
  rows: WidgetRow[];
}

export type WidgetState =
  | { kind: 'unpaired' }
  | { kind: 'offline' }
  | { kind: 'ready'; data: WidgetData; at: number };

/** The `solco://` link for a pane; expo-router turns it into the same route a notification tap opens. */
export function paneUri(item: FlatPane, instance: string, chatServed: boolean): string {
  const title = paneTitle(item.pane);
  const query = `terminalId=${encodeURIComponent(item.pane.terminalId)}&instance=${encodeURIComponent(instance)}&title=${encodeURIComponent(title)}`;
  return item.pane.agent && chatServed
    ? `solco://chat/${encodeURIComponent(item.pane.paneId)}?${query}`
    : `solco://terminal/${encodeURIComponent(item.pane.terminalId)}?instance=${encodeURIComponent(instance)}&title=${encodeURIComponent(title)}`;
}

export function buildWidgetData(workspaces: readonly TreeWorkspace[], instance: string, chatServed: boolean): WidgetData {
  const { needsYou, working, idle } = summarize(workspaces);
  const status = (list: FlatPane[], value: WidgetRowStatus) => list.map((item) => ({ item, status: value }));
  const rows = [...status(needsYou, 'blocked'), ...status(working, 'working'), ...status(idle, 'idle')]
    .slice(0, WIDGET_MAX_ROWS)
    .map(({ item, status: rowStatus }): WidgetRow => ({
      paneId: item.pane.paneId,
      title: paneTitle(item.pane),
      status: rowStatus,
      caption: item.workspace.label,
      uri: paneUri(item, instance, chatServed),
    }));
  return { needsYou: needsYou.length, working: working.length, idle: idle.length, rows };
}

/**
 * How many rows fit a widget of this height (dp): the header takes ~46 dp, each row ~32 dp. A launcher that
 * reports no usable height gets the full list.
 */
export function visibleRows(heightDp: number | undefined): number {
  if (!heightDp || heightDp <= 0) return WIDGET_MAX_ROWS;
  return Math.max(1, Math.min(WIDGET_MAX_ROWS, Math.floor((heightDp - 46) / 32)));
}
