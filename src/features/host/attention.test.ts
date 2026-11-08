import { describe, expect, it } from 'vitest';

import type { ChatInteraction, TreePane, TreeWorkspace } from '@/contracts/host-v3';

import { approvalOf, classifyTree, identityOf, isReplyable, parseApproval, parseReply, phaseOf, type Phase } from '@/features/host/attention';
const pane = (paneId: string, status?: string, lastActiveMs?: number): TreePane => ({
  paneId,
  terminalId: `t-${paneId}`,
  ...(status ? { agent: { provider: 'claude', status, ...(lastActiveMs === undefined ? {} : { lastActiveMs }) } } : {}),
});

const tree = (...panes: TreePane[]): TreeWorkspace[] => [
  { id: 'w1', label: 'acme', status: 'ok', tabs: [{ id: 'tab1', label: 'main', status: 'ok', panes }] },
];

const INSTANCE = 'w1';
const ledgerOf = (...entries: [string, string][]): Map<string, Phase> =>
  new Map(entries.map(([terminal, phase]) => [identityOf(INSTANCE, `t-${terminal}`), phaseOf(phase)] as const));

describe('phaseOf', () => {
  it('maps Herdr status words onto the desktop phases', () => {
    expect(phaseOf('working')).toBe('working');
    expect(phaseOf('running')).toBe('working');
    expect(phaseOf('needs_attention')).toBe('blocked');
    expect(phaseOf('done')).toBe('done');
    expect(phaseOf('completed')).toBe('done');
    expect(phaseOf('idle')).toBe('idle');
    expect(phaseOf('failed')).toBe('failed');
    expect(phaseOf('error')).toBe('failed');
    expect(phaseOf(undefined)).toBe('unknown');
    expect(phaseOf('something-new')).toBe('unknown');
  });
});

// The transition table is the ported desktop contract (solco workbench_test.go).
describe('classifyTree transitions', () => {
  it('notifies exactly working→blocked, working/blocked→done and working→idle', () => {
    const ledger = ledgerOf(['a', 'working'], ['b', 'working'], ['c', 'blocked'], ['d', 'working'], ['e', 'idle']);
    const workspaces = tree(
      pane('a', 'blocked'),
      pane('b', 'done'),
      pane('c', 'done'),
      pane('d', 'idle'),
      pane('e', 'blocked'),
    );
    const { events } = classifyTree(ledger, workspaces, INSTANCE);
    expect(events.map((event) => [event.pane.pane.paneId, event.body])).toEqual([
      ['a', 'Needs attention'],
      ['b', 'Finished — ready for review'],
      ['c', 'Finished — ready for review'],
      ['d', 'Ready'],
    ]);
  });

  it('never notifies first observation, echoes, failed or review-cleared transitions', () => {
    const ledger = ledgerOf(['a', 'working'], ['b', 'working'], ['c', 'done'], ['d', 'idle'], ['e', 'working']);
    const workspaces = tree(
      pane('f', 'blocked'),
      pane('a', 'working'),
      pane('b', 'failed'),
      pane('c', 'working'),
      pane('d', 'done'),
      pane('e', 'error'),
    );
    const { events } = classifyTree(ledger, workspaces, INSTANCE);
    expect(events).toEqual([]);
  });

  it('carries the desktop notification copy: title = "<agent> — <body>"', () => {
    const ledger = ledgerOf(['a', 'working']);
    const { events } = classifyTree(ledger, tree(pane('a', 'done')), INSTANCE);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('claude — Finished — ready for review');
    expect(events[0]!.identity).toBe(identityOf(INSTANCE, 't-a'));
  });
});

describe('classifyTree ledger', () => {
  it('keys identities by instance/terminal so replacements never stack', () => {
    const { next } = classifyTree(new Map(), tree(pane('a', 'working')), INSTANCE);
    expect([...next.keys()]).toEqual([identityOf(INSTANCE, 't-a')]);
    expect(next.get(identityOf(INSTANCE, 't-a'))).toBe('working');
  });

  it('withdraws identities whose pane vanished and drops them from the ledger', () => {
    const ledger = ledgerOf(['gone', 'blocked'], ['stay', 'blocked']);
    const { dismissIds, next, events } = classifyTree(ledger, tree(pane('stay', 'blocked')), INSTANCE);
    expect(dismissIds).toEqual([identityOf(INSTANCE, 't-gone')]);
    expect(events).toEqual([]);
    expect(next.has(identityOf(INSTANCE, 't-gone'))).toBe(false);
  });
});

describe('inline Reply', () => {
  it('is offered only once the agent has stopped', () => {
    expect(isReplyable('ready')).toBe(true);
    expect(isReplyable('ready-for-review')).toBe(true);
    expect(isReplyable('needs-attention')).toBe(false);
  });

  it('carries the kind on the event', () => {
    const { events } = classifyTree(ledgerOf(['a', 'working']), tree(pane('a', 'done')), INSTANCE);
    expect(events[0]!.kind).toBe('ready-for-review');
  });

  it('parses a typed reply and drops everything else', () => {
    const data = { instance: 'w1', paneId: 'p1' };
    expect(parseReply('reply', '  keep going ', data)).toEqual({ instance: 'w1', paneId: 'p1', text: 'keep going' });
    expect(parseReply('reply', '   ', data)).toBeNull();
    expect(parseReply('reply', null, data)).toBeNull();
    expect(parseReply('expo.modules.notifications.actions.DEFAULT', 'x', data)).toBeNull();
    expect(parseReply('reply', 'x', { instance: 'w1' })).toBeNull();
    expect(parseReply('reply', 'x', undefined)).toBeNull();
  });
});

describe('inline Approve / Deny', () => {
  const card = (options: string[], over: Partial<ChatInteraction> = {}): ChatInteraction => ({ id: 'c1', kind: 'permission', prompt: 'Proceed?', options, ...over });

  it('takes the card\'s own yes/no rows, in every provider vocabulary', () => {
    expect(approvalOf(card(['Yes', 'No']))).toEqual({ interactionId: 'c1', approve: 'Yes', deny: 'No' });
    expect(approvalOf(card(['Run once', 'Skip']))).toMatchObject({ approve: 'Run once', deny: 'Skip' });
    expect(approvalOf(card(['Yes, run command', 'No, cancel']))).toMatchObject({ approve: 'Yes, run command', deny: 'No, cancel' });
  });

  it('never picks a row that saves the choice', () => {
    const claude = card(['Yes', "Yes, and don't ask again for this command", 'No']);
    expect(approvalOf(claude)).toMatchObject({ approve: 'Yes', deny: 'No' });
    expect(approvalOf(card(['Yes, allow all edits during this session', 'No']))).toBeNull();
    expect(approvalOf(card(['Add Shell(echo) to allowlist', 'Skip']))).toBeNull();
  });

  it('offers nothing for questions, multi-select, or a deny that needs typed text', () => {
    expect(approvalOf(undefined)).toBeNull();
    expect(approvalOf(card(['Yes', 'No'], { kind: 'question' }))).toBeNull();
    expect(approvalOf(card(['Yes', 'No'], { multi: true }))).toBeNull();
    expect(approvalOf(card(['Yes', 'No, tell Claude what to do differently'], { textOptions: ['No, tell Claude what to do differently'] }))).toBeNull();
    expect(approvalOf(card(['Yes']))).toBeNull();
  });

  it('turns a tap into the exact answer for that card and drops everything else', () => {
    const data = { instance: 'w1', paneId: 'p1', approval: { interactionId: 'c1', approve: 'Yes', deny: 'No' } };
    expect(parseApproval('approve', data)).toEqual({ instance: 'w1', paneId: 'p1', request: { interactionId: 'c1', option: 'Yes' } });
    expect(parseApproval('deny', data)).toEqual({ instance: 'w1', paneId: 'p1', request: { interactionId: 'c1', option: 'No' } });
    expect(parseApproval('reply', data)).toBeNull();
    expect(parseApproval('approve', { instance: 'w1', paneId: 'p1' })).toBeNull();
    expect(parseApproval('approve', { ...data, approval: { interactionId: '', approve: 'Yes', deny: 'No' } })).toBeNull();
    expect(parseApproval('approve', undefined)).toBeNull();
  });
});
