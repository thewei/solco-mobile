import { describe, expect, it } from 'vitest';

import type { AssistantApproval, AssistantCoordinator, AssistantResult, AssistantRun, AssistantTask, TreeWorkspace } from '@/contracts/host-v3';
import {
  adoptableCoordinatorPane,
  approvalLine,
  coordinatorStartAgent,
  assistantLine,
  createRequestIds,
  mixedChats,
  openableResult,
  openableRun,
  personalAgentMessage,
  landingAssistant,
  resultCards,
  sortAssistants,
  taskActions,
  taskBuckets,
  taskStateLabel,
  conversationState,
  conversationWord,
  sendWhenReady,
  waitForCoordinatorPane,
} from '@/features/host/personal-agent-model';
import { HostV3Error } from '@/lib/host-client-v3';

const NOW = 1_800_000_000_000;

const task = (over: Partial<AssistantTask> & { id: string }): AssistantTask => ({
  assistantId: 'a_1', goalId: '', ruleId: '', parentTaskId: '', kind: 'research', title: over.id, brief: '', repoPath: '', agent: 'claude', model: '',
  state: 'queued', needsYou: false, reviewState: '', attempt: 1, revision: 1, createdAt: NOW, updatedAt: NOW, runs: [], ...over,
});
const run = (over: Partial<AssistantRun>): AssistantRun => ({
  id: 'r_1', taskId: 't_1', ruleId: '', eventId: '', idempotencyKey: '', status: 'running', claimant: 'daemon', herdrSession: 'default', workspaceId: 'w1', paneId: 'w1:p1',
  agentSessionId: '', label: '', result: '', error: '', createdAt: NOW, startedAt: NOW, finishedAt: 0, ...over,
});

describe('personal agent model', () => {
  it('sorts Assistants by what needs you, then by name', () => {
    const row = (name: string, needsYou: number, approvals = 0) => ({ id: name, name, status: 'active', revision: 1, tasks: 0, queued: 0, running: 0, needsYou, done: 0, goals: 0, approvals, updatedAt: 0 });
    expect(sortAssistants([row('Zed', 0), row('Ada', 0), row('Bob', 1), row('Cy', 0, 2)]).map((r) => r.name)).toEqual(['Cy', 'Bob', 'Ada', 'Zed']);
  });

  it('opens the only Assistant, else the one used last, else shows the list', () => {
    const row = (id: string) => ({ id, name: id, status: 'active', revision: 1, tasks: 0, queued: 0, running: 0, needsYou: 0, done: 0, goals: 0, approvals: 0, updatedAt: 0 });
    expect(landingAssistant([row('a')], '')).toBe('a');
    expect(landingAssistant([row('a')], 'gone')).toBe('a');
    expect(landingAssistant([row('a'), row('b')], 'b')).toBe('b');
    expect(landingAssistant([row('a'), row('b')], '')).toBe('');
    expect(landingAssistant([row('a'), row('b')], 'gone')).toBe('');
    expect(landingAssistant([], 'a')).toBe('');
  });

  it("turns the core's results into cards: newest first, only those after the dismissal, capped", () => {
    const r = (taskId: string, state: string, at: number): AssistantResult => ({ taskId, title: taskId, state, at });
    const cards = resultCards([r('a', 'done', 5000), r('b', 'failed', 9000), r('c', 'review_required', 7000)], 0);
    expect(cards.map((c) => c.result.taskId)).toEqual(['b', 'c', 'a']);
    expect(cards.map((c) => c.label)).toEqual(['Failed', 'Ready for review', 'Finished']);
    expect(cards[0]?.failed).toBe(true);
    expect(resultCards([r('a', 'done', 5000)], 5000)).toEqual([]); // dismissed at its own time
    expect(resultCards([r('a', 'done', 1), r('b', 'done', 2), r('c', 'done', 3), r('d', 'done', 4)], 0).map((c) => c.result.taskId)).toEqual(['d', 'c', 'b']);
  });

  it('opens a result only into the pane its own Herdr session and pane id name', () => {
    const tree = [{ id: 'w1', label: 'x', tabs: [{ id: 'w1:t1', label: 'omp', panes: [{ paneId: 'w1:p1', terminalId: 'term_a' }] }] }] as unknown as TreeWorkspace[];
    const base = { taskId: 't', title: 'T', state: 'done', at: 1 };
    expect(openableResult({ ...base, herdrSession: 'default', paneId: 'w1:p1' }, tree, 'default')?.paneId).toBe('w1:p1');
    expect(openableResult({ ...base, herdrSession: 'other', paneId: 'w1:p1' }, tree, 'default')).toBeNull();
    expect(openableResult({ ...base, herdrSession: 'default', paneId: 'w9:p9' }, tree, 'default')).toBeNull();
    expect(openableResult(base, tree, 'default')).toBeNull();
  });

  it('words an Assistant row from its counters, never inventing state', () => {
    const row = { id: 'a', name: 'Ada', status: 'active', revision: 1, tasks: 3, queued: 1, running: 1, needsYou: 2, done: 1, goals: 2, approvals: 1, updatedAt: 0 };
    expect(assistantLine(row)).toBe('3 need you · 1 running · 1 queued');
    expect(assistantLine({ ...row, needsYou: 0, running: 0, queued: 0, goals: 0, approvals: 0 })).toBe('Idle');
    expect(assistantLine({ ...row, status: 'disabled' })).toBe('Paused');
  });

  it('buckets tasks: needs you first, then live work, then history', () => {
    const buckets = taskBuckets([
      task({ id: 'done', state: 'done', updatedAt: NOW - 1 }),
      task({ id: 'ask', state: 'done', needsYou: true }),
      task({ id: 'run', state: 'running' }),
      task({ id: 'wait', state: 'queued' }),
      task({ id: 'blocked', state: 'blocked' }),
      task({ id: 'old', state: 'failed', updatedAt: NOW - 5 }),
    ]);
    expect(buckets.needsYou.map((t) => t.id)).toEqual(['ask']);
    expect(buckets.live.map((t) => t.id)).toEqual(['blocked', 'run', 'wait']);
    expect(buckets.done.map((t) => t.id)).toEqual(['done', 'old']);
  });

  it('an inbox-flagged task joins Needs you even when the task itself does not ask', () => {
    const buckets = taskBuckets([task({ id: 'stuck', state: 'running' }), task({ id: 'ok', state: 'running' })], new Set(['stuck']));
    expect(buckets.needsYou.map((t) => t.id)).toEqual(['stuck']);
    expect(buckets.live.map((t) => t.id)).toEqual(['ok']);
  });

  it('labels states in the desktop page\'s words and offers only the actions the core allows', () => {
    expect(taskStateLabel('review_required')).toBe('Review needed');
    expect(taskStateLabel('uncertain')).toBe('Unsure if it started');
    expect(taskStateLabel('weird')).toBe('weird');
    expect(taskActions(task({ id: 't', needsYou: true, state: 'done' }))).toEqual(['ack']);
    expect(taskActions(task({ id: 't', state: 'failed' }))).toEqual(['retry']);
    expect(taskActions(task({ id: 't', state: 'running' }))).toEqual([]);
    expect(taskActions(task({ id: 't', state: 'draft' }))).toEqual(['publish']);
    expect(taskStateLabel('waiting')).toBe('Waiting for another task');
  });

  it('words an approval and its expiry', () => {
    const a = { id: 'p', assistantId: 'a', subjectKind: 'task', subjectId: 't', action: 'merge work/x', actionHash: '0'.repeat(64), expectedRevision: 5, expiresAt: NOW + 3_600_000, state: 'pending', decidedAt: 0, createdAt: NOW } satisfies AssistantApproval;
    expect(approvalLine(a, NOW)).toBe('Expires in 1h 0m');
    expect(approvalLine({ ...a, expiresAt: NOW - 1 }, NOW)).toBe('Expired');
  });

  it('opens a run only when this phone\'s tree still lists its real pane in the same Herdr session', () => {
    const tree: TreeWorkspace[] = [{ id: 'w1', name: 'x', tabs: [{ id: 't', label: 'x', panes: [{ paneId: 'w1:p1', terminalId: 'term', focused: false } as never] }] } as never];
    expect(openableRun([run({})], tree, 'default')?.paneId).toBe('w1:p1');
    expect(openableRun([run({ herdrSession: 'other' })], tree, 'default')).toBeNull();
    expect(openableRun([run({ paneId: 'w9:p9' })], tree, 'default')).toBeNull();
    expect(openableRun([run({ paneId: '' })], tree, 'default')).toBeNull();
  });

  it('reuses a request id only after a transport failure of the same request', () => {
    let n = 0;
    const ids = createRequestIds(() => `req_${++n}`);
    expect(ids.begin('rename:a:Grace')).toBe('req_1');
    ids.settle(new HostV3Error('transport', 'x'));
    expect(ids.begin('rename:a:Grace')).toBe('req_1');
    expect(ids.begin('rename:a:Other')).toBe('req_2');
    ids.settle(null);
    expect(ids.begin('rename:a:Other')).toBe('req_3');
  });

  it('words refusals from the core\'s stable codes', () => {
    const refused = (code: string, status = 409, message?: string) => new HostV3Error('http', message ?? code, { status, code });
    expect(personalAgentMessage(refused('stale_revision'))).toContain('changed');
    expect(personalAgentMessage(refused('assistant_disabled'))).toContain('paused');
    expect(personalAgentMessage(refused('personal_agent_unavailable', 404))).toContain('not available');
    expect(personalAgentMessage(refused('invalid', 400, 'a commitment needs a kind'))).toBe('a commitment needs a kind');
    expect(personalAgentMessage(new Error('boom'))).toBe('The computer did not answer. Try again.');
  });
});

describe('conversationState', () => {
  const co = (patch: Partial<AssistantCoordinator>): AssistantCoordinator => ({ assistantId: 'a_1', state: 'ready', revision: 1, ...patch });
  const tree = [{ workspaceId: 'w1', tabs: [{ tabId: 't1', label: 'x', panes: [{ paneId: 'w1:p1' }] }] }] as unknown as TreeWorkspace[];

  it('opens a ready Coordinator only through its own session and pane id', () => {
    expect(conversationState(co({ herdrSession: 'default', paneId: 'w1:p1' }), tree, 'default').kind).toBe('open');
    expect(conversationState(co({ herdrSession: 'other', paneId: 'w1:p1' }), tree, 'default')).toEqual({ kind: 'elsewhere' });
    expect(conversationState(co({ herdrSession: 'default', paneId: 'w9:p9' }), tree, 'default')).toEqual({ kind: 'elsewhere' });
  });

  it('starting waits; none, stopped and failed offer a start', () => {
    expect(conversationState(co({ state: 'starting' }), tree, 'default')).toEqual({ kind: 'starting' });
    expect(conversationState(co({ state: 'none' }), tree, 'default')).toEqual({ kind: 'idle', failed: false });
    expect(conversationState(co({ state: 'stopped' }), tree, 'default')).toEqual({ kind: 'idle', failed: false });
    expect(conversationState(co({ state: 'failed' }), tree, 'default')).toEqual({ kind: 'idle', failed: true });
  });
});

describe('conversationWord', () => {
  const base = { paused: false, launching: false, paneOpen: false, working: false, coordinatorState: undefined as string | undefined };

  it('says the desktop page\'s words for every Coordinator state', () => {
    const word = (coordinatorState?: string) => conversationWord({ ...base, coordinatorState });
    expect(word()).toBe('Sleeping');
    expect(word('none')).toBe('Sleeping');
    expect(word('stopped')).toBe('Sleeping');
    expect(word('starting')).toBe('Waking up…');
    expect(word('ready')).toBe('Not in this window');
    expect(word('failed')).toBe('Could not start');
    expect(word('blocked')).toBe('Needs permission');
    expect(word('uncertain')).toBe('Check start');
  });

  it('puts a pane, a launch and a pause ahead of the core state', () => {
    expect(conversationWord({ ...base, paneOpen: true, coordinatorState: 'ready' })).toBe('Ready');
    expect(conversationWord({ ...base, paneOpen: true, working: true })).toBe('Working');
    expect(conversationWord({ ...base, launching: true, coordinatorState: 'uncertain' })).toBe('Waking up…');
    expect(conversationWord({ ...base, paused: true, paneOpen: true, working: true })).toBe('Paused');
  });
});

describe('coordinatorStartAgent', () => {
  it('names the first Agent the desktop offers, and nothing when it offers none', () => {
    expect(coordinatorStartAgent([{ id: 'omp' }, { id: 'claude' }])).toBe('omp');
    expect(coordinatorStartAgent([])).toBeNull();
  });
});

describe('adoptableCoordinatorPane', () => {
  const co = (patch: Partial<AssistantCoordinator>): AssistantCoordinator => ({ assistantId: 'a_1', state: 'ready', herdrSession: 'default', paneId: 'w1:p1', revision: 1, ...patch });
  const tree = (agent: boolean) =>
    [{ id: 'w1', label: 'x', tabs: [{ id: 'w1:t1', label: 'omp', panes: [{ paneId: 'w1:p1', terminalId: 'term_a', ...(agent ? { agent: { kind: 'omp', provider: 'omp', status: 'idle' } } : {}) }] }] }] as unknown as TreeWorkspace[];

  it('carries a ready Coordinator whose pane Herdr already names an Agent', () => {
    expect(adoptableCoordinatorPane(co({}), tree(true), 'default', true)?.paneId).toBe('w1:p1');
  });
  it('waits while the pane is still a plain terminal, but a Host without Chat has no such wait', () => {
    expect(adoptableCoordinatorPane(co({}), tree(false), 'default', true)).toBeNull();
    expect(adoptableCoordinatorPane(co({}), tree(false), 'default', false)?.paneId).toBe('w1:p1');
  });
  it('never adopts a Coordinator that is starting, stopped, in another Herdr session, or missing from the tree', () => {
    expect(adoptableCoordinatorPane(co({ state: 'starting' }), tree(true), 'default', true)).toBeNull();
    expect(adoptableCoordinatorPane(co({ state: 'stopped' }), tree(true), 'default', true)).toBeNull();
    expect(adoptableCoordinatorPane(co({ herdrSession: 'other' }), tree(true), 'default', true)).toBeNull();
    expect(adoptableCoordinatorPane(co({ paneId: 'w9:p9' }), tree(true), 'default', true)).toBeNull();
  });
});

describe('mixedChats', () => {
  const row = (id: string, name: string, updatedAt: number, asking = 0) => ({ id, name, status: 'active', revision: 1, tasks: 0, queued: 0, running: 0, needsYou: asking, done: 0, goals: 0, approvals: 0, updatedAt });
  const group = (id: string, title: string, updatedAt: number) => ({ id, title, members: [], lastSeq: 0, open: 0, updatedAt });
  it('orders Assistants and Groups together by recent activity, not Groups first', () => {
    const out = mixedChats([row('a_1', 'Ada', 300), row('a_2', 'Bo', 100)], [group('g_1', 'Team', 200)]);
    expect(out.map((e) => e.id)).toEqual(['a_1', 'g_1', 'a_2']);
  });
  it('an Assistant that needs the person comes first whatever its age', () => {
    const out = mixedChats([row('a_1', 'Ada', 300), row('a_2', 'Bo', 1, 2)], [group('g_1', 'Team', 200)]);
    expect(out[0]?.id).toBe('a_2');
  });
  it('the Primary Assistant stays first even when another one needs the person', () => {
    const out = mixedChats([{ ...row('a_1', 'Ada', 1), primary: true }, row('a_2', 'Bo', 500, 3)], [group('g_1', 'Team', 900)]);
    expect(out.map((e) => e.id)).toEqual(['a_1', 'a_2', 'g_1']);
  });
  it('an older Host without a time falls back to the name', () => {
    expect(mixedChats([row('a_2', 'Bo', 0), row('a_1', 'Ada', 0)], []).map((e) => e.id)).toEqual(['a_1', 'a_2']);
  });
});

describe('waiting for a started Coordinator', () => {
  const coordinator = (over: Partial<AssistantCoordinator>): AssistantCoordinator => ({ assistantId: 'a_1', state: 'starting', taskId: 't_1', revision: 1, ...over }) as AssistantCoordinator;
  const tree = (agent: boolean): TreeWorkspace[] => [
    {
      id: 'w1', label: 'solco', tabs: [{ id: 'w1:t1', label: 'omp', panes: [{ paneId: 'w1:p1', terminalId: 'term_a', ...(agent ? { agent: { kind: 'omp', provider: 'omp', status: 'idle' } } : {}) }] }],
    } as unknown as TreeWorkspace,
  ];
  const ready = coordinator({ state: 'ready', herdrSession: 'default', workspaceId: 'w1', paneId: 'w1:p1' });
  const run = async (reads: { coordinator: AssistantCoordinator; workspaces: TreeWorkspace[] }[], over: { timeoutMs?: number; chatServed?: boolean } = {}) => {
    let clock = 0;
    let at = 0;
    return waitForCoordinatorPane({
      read: async () => reads[Math.min(at++, reads.length - 1)]!,
      instance: 'default',
      chatServed: over.chatServed ?? true,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      ...(over.timeoutMs ? { timeoutMs: over.timeoutMs } : {}),
    });
  };

  it('resolves with the pane once it is listed and named as an Agent', async () => {
    const pane = await run([
      { coordinator: coordinator({}), workspaces: [] },
      { coordinator: ready, workspaces: tree(false) }, // listed, but Herdr has not named the Agent: still the Terminal
      { coordinator: ready, workspaces: tree(true) },
    ]);
    expect(pane.paneId).toBe('w1:p1');
  });

  it('does not wait for the Agent name where Chat is not served', async () => {
    expect((await run([{ coordinator: ready, workspaces: tree(false) }], { chatServed: false })).paneId).toBe('w1:p1');
  });

  it('ends with a sentence when it failed, stopped, runs elsewhere or never comes up', async () => {
    await expect(run([{ coordinator: coordinator({ state: 'failed' }), workspaces: [] }])).rejects.toThrow('could not start');
    await expect(run([{ coordinator: coordinator({ state: 'stopped' }), workspaces: [] }])).rejects.toThrow('stopped before');
    await expect(run([{ coordinator: ready, workspaces: [] }])).rejects.toThrow('cannot reach');
    await expect(run([{ coordinator: coordinator({}), workspaces: [] }], { timeoutMs: 4000 })).rejects.toThrow('taking too long');
  });
});

describe('sending to a just-started Coordinator', () => {
  const refused = (code: string) => new HostV3Error('http', 'x', { status: 409, code });
  const run = (failures: unknown[], timeoutMs?: number) => {
    let clock = 0;
    let calls = 0;
    const result = sendWhenReady({
      send: async () => {
        const failure = failures[calls++];
        if (failure) throw failure;
      },
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return { result, calls: () => calls };
  };

  it('retries the nothing-typed refusals until the agent takes the message — once', async () => {
    const r = run([refused('not_ready'), refused('busy'), undefined]);
    await expect(r.result).resolves.toBeUndefined();
    expect(r.calls()).toBe(3);
  });

  it('never retries any other failure (an uncertain delivery must not be doubled)', async () => {
    const r = run([refused('delivery_uncertain'), undefined]);
    await expect(r.result).rejects.toMatchObject({ code: 'delivery_uncertain' });
    expect(r.calls()).toBe(1);
    const plain = run([new Error('offline'), undefined]);
    await expect(plain.result).rejects.toThrow('offline');
    expect(plain.calls()).toBe(1);
  });

  it('gives the last refusal back when the agent never becomes ready', async () => {
    const r = run(Array.from({ length: 100 }, () => refused('not_ready')), 4000);
    await expect(r.result).rejects.toMatchObject({ code: 'not_ready' });
  });
});
