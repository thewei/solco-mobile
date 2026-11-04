// [INPUT]: each tree the shared events socket delivers, the instance, the pane the user is looking at,
//          and a Notifier (the expo-notifications seam; a fake in tests).
// [OUTPUT]: createAttentionDelivery(notifier) → { apply(tree) } returning the events it posted.
// [POS]: The decision between "a tree changed" and "a notification is raised", extracted from
//        background-bridge so it is testable without React Native. Foreground and background are the same
//        path: the only suppression is the pane the user is looking at right now (its own screen already
//        says so). First observation never notifies — that is attention.ts's ledger, unchanged.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { TreeWorkspace } from '@/contracts/host-v3';

import { classifyTree, isReplyable, REPLY_CATEGORY, type AttentionEvent, type Phase } from '@/features/host/attention';
import { paneRoute } from '@/features/host/pane-model';

export interface NotificationRequest {
  identifier: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  categoryIdentifier?: string;
}

export interface Notifier {
  schedule(request: NotificationRequest): Promise<void>;
  dismiss(identifier: string): Promise<void>;
}

/** The pane on screen (Chat uses `paneId`, Terminal `terminalId`); either may be absent. */
export interface ViewedPane {
  paneId?: string;
  terminalId?: string;
}

export interface TreeUpdate {
  workspaces: readonly TreeWorkspace[];
  instance: string;
  chatServed: boolean;
  viewing?: ViewedPane;
}

function isViewed(event: AttentionEvent, viewing: ViewedPane | undefined): boolean {
  if (!viewing) return false;
  const { paneId, terminalId } = event.pane.pane;
  return (viewing.paneId !== undefined && viewing.paneId === paneId) || (viewing.terminalId !== undefined && viewing.terminalId === terminalId);
}

export function createAttentionDelivery(notifier: Notifier) {
  let ledger: ReadonlyMap<string, Phase> = new Map();
  const notified = new Set<string>();

  return {
    /** Syncs the ledger with the tree, raises the notifications it earns and withdraws the stale ones. */
    async apply(update: TreeUpdate): Promise<AttentionEvent[]> {
      const { events, next } = classifyTree(ledger, update.workspaces, update.instance);
      ledger = next;
      const withdrawn = [...notified].filter((identity) => !next.has(identity) || next.get(identity) === 'working');
      const posted: AttentionEvent[] = [];
      for (const event of events) {
        if (isViewed(event, update.viewing)) continue;
        notified.add(event.identity);
        const route = paneRoute(event.pane.pane, update.instance, update.chatServed);
        await notifier.schedule({
          identifier: event.identity,
          title: event.title,
          body: event.body,
          data: { route: JSON.stringify(route), instance: update.instance, paneId: event.pane.pane.paneId },
          ...(isReplyable(event.kind) && update.chatServed ? { categoryIdentifier: REPLY_CATEGORY } : {}),
        });
        posted.push(event);
      }
      for (const identity of withdrawn) {
        notified.delete(identity);
        await notifier.dismiss(identity);
      }
      return posted;
    },
    /** Whether an identity still has a live notification (the approval upgrade stops when it was withdrawn). */
    has: (identity: string) => notified.has(identity),
  };
}
