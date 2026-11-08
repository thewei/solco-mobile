import { describe, expect, it } from 'vitest';

import type { TreePane, TreeWorkspace } from '@/contracts/host-v3';

import { createAttentionDelivery, type NotificationRequest, type Notifier } from '@/features/host/attention-delivery';

const pane = (paneId: string, status?: string): TreePane => ({
  paneId,
  terminalId: `t-${paneId}`,
  ...(status ? { agent: { provider: 'claude', status } } : {}),
});
const tree = (...panes: TreePane[]): TreeWorkspace[] => [
  { id: 'w1', label: 'wh-studio', status: 'ok', tabs: [{ id: 'tab1', label: 'main', status: 'ok', panes }] },
];

function recorder() {
  const scheduled: NotificationRequest[] = [];
  const dismissed: string[] = [];
  const notifier: Notifier = {
    schedule: async (request) => void scheduled.push(request),
    dismiss: async (identifier) => void dismissed.push(identifier),
  };
  return { notifier, scheduled, dismissed };
}

const apply = (delivery: ReturnType<typeof createAttentionDelivery>, workspaces: TreeWorkspace[], extra: { viewing?: { paneId?: string; terminalId?: string } } = {}) =>
  delivery.apply({ workspaces, instance: 'w1', chatServed: true, ...extra });

describe('attention delivery', () => {
  it('raises a notification when an agent that was working needs you or finishes', async () => {
    const { notifier, scheduled } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'working'), pane('b', 'working')));
    await apply(delivery, tree(pane('a', 'blocked'), pane('b', 'done')));
    expect(scheduled.map((request) => request.body)).toEqual(['Needs attention', 'Finished — ready for review']);
    expect(scheduled[0]?.identifier).toBe('solco-agent/w1/t-a');
    expect(JSON.parse(String(scheduled[0]?.data.route))).toMatchObject({ pathname: '/chat/[paneId]', params: { paneId: 'a' } });
  });

  it('delivers the same way with the app in the foreground — nothing is gated on app state', async () => {
    // The delivery has no app-state input at all: what the bridge used to drop in the foreground now lands.
    const { notifier, scheduled } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'working')), { viewing: { paneId: 'other' } });
    await apply(delivery, tree(pane('a', 'idle')), { viewing: { paneId: 'other' } });
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.body).toBe('Ready');
  });

  it('stays quiet for the pane the user is looking at, and still syncs its ledger', async () => {
    const { notifier, scheduled } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'working')));
    await apply(delivery, tree(pane('a', 'blocked')), { viewing: { paneId: 'a' } });
    expect(scheduled).toEqual([]);
    // Terminal screens carry the terminal id instead.
    await apply(delivery, tree(pane('a', 'working')));
    await apply(delivery, tree(pane('a', 'done')), { viewing: { terminalId: 't-a' } });
    expect(scheduled).toEqual([]);
  });

  it('catches up after a gap: a tree read on reconnect that moved on while the socket was down notifies', async () => {
    const { notifier, scheduled } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'working')));
    // …socket dead, no trees…, then the first tree after reconnecting.
    await apply(delivery, tree(pane('a', 'done')));
    expect(scheduled).toHaveLength(1);
  });

  it('never notifies the first observation or an echo', async () => {
    const { notifier, scheduled } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'blocked')));
    await apply(delivery, tree(pane('a', 'blocked')));
    expect(scheduled).toEqual([]);
  });

  it('attaches Reply to a stopped agent only, and only when the Host serves chat', async () => {
    const { notifier, scheduled } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'working'), pane('b', 'working')));
    await apply(delivery, tree(pane('a', 'blocked'), pane('b', 'idle')));
    expect(scheduled.map((request) => request.categoryIdentifier)).toEqual([undefined, 'agent-reply']);
  });

  it('withdraws a notification when the agent resumes working or its pane vanishes', async () => {
    const { notifier, dismissed } = recorder();
    const delivery = createAttentionDelivery(notifier);
    await apply(delivery, tree(pane('a', 'working'), pane('b', 'working')));
    await apply(delivery, tree(pane('a', 'done'), pane('b', 'done')));
    expect(delivery.has('solco-agent/w1/t-a')).toBe(true);
    await apply(delivery, tree(pane('a', 'working')));
    expect(dismissed.sort()).toEqual(['solco-agent/w1/t-a', 'solco-agent/w1/t-b']);
    expect(delivery.has('solco-agent/w1/t-a')).toBe(false);
  });
});
