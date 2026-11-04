import { describe, expect, it } from 'vitest';

import type { AssistantApproval, AssistantCoordinator, AssistantGoal, AssistantRun, AssistantTask, TreeWorkspace } from '@/contracts/host-v3';
import {
  approvalLine,
  assistantLine,
  createRequestIds,
  goalActions,
  goalLine,
  mixedChats,
  openableRun,
  parsePrReference,
  personalAgentMessage,
  prWatchCommitment,
  sortAssistants,
  taskActions,
  taskBuckets,
  taskStateLabel,
  conversationState,
} from '@/features/host/personal-agent-model';
import { HostV3Error } from '@/lib/host-client-v3';

const NOW = 1_800_000_000_000;

const task = (over: Partial<AssistantTask> & { id: string }): AssistantTask => ({
  assistantId: 'a_1', goalId: '', ruleId: '', parentTaskId: '', kind: 'research', title: over.id, brief: '', repoPath: '', agent: 'claude', model: '',
  state: 'queued', needsYou: false, reviewState: '', attempt: 1, revision: 1, createdAt: NOW, updatedAt: NOW, runs: [], ...over,
});
const goal = (over: Partial<AssistantGoal>): AssistantGoal => ({
  id: 'g_1', assistantId: 'a_1', title: 'Watch PR 12', objective: '', state: 'active', evidence: '', commitments: [], revision: 2, createdAt: NOW, updatedAt: NOW, ...over,
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

  it('words an Assistant row from its counters, never inventing state', () => {
    const row = { id: 'a', name: 'Ada', status: 'active', revision: 1, tasks: 3, queued: 1, running: 1, needsYou: 2, done: 1, goals: 2, approvals: 1, updatedAt: 0 };
    expect(assistantLine(row)).toBe('3 need you · 1 running · 1 queued · 2 goals');
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
    expect(goalActions('draft')).toEqual(['approve', 'cancel']);
    expect(goalActions('active')).toEqual(['pause', 'cancel']);
    expect(goalActions('paused')).toEqual(['resume', 'cancel']);
    expect(goalActions('completed')).toEqual([]);
  });

  it('describes a goal from its commitments', () => {
    const g = goal({ commitments: [{ id: 'c', assistantId: 'a_1', goalId: 'g_1', kind: 'pr_watch', successCriteria: '', exitCondition: 'merged or closed', spec: '{"repo":"o/r","number":12}', state: 'active', nextCheckAt: NOW + 120_000, lastCheckedAt: NOW - 60_000, lastError: '', cursor: '', revision: 1, createdAt: NOW, updatedAt: NOW }] });
    expect(goalLine(g, NOW)).toBe('Watching o/r#12 · checked 1m ago · next in 2m');
    expect(goalLine(goal({ state: 'draft' }), NOW)).toBe('Draft — nothing runs until you start it');
    expect(goalLine(goal({ state: 'paused' }), NOW)).toBe('Paused');
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

  it('parses a PR reference from owner/repo#N or a GitHub URL', () => {
    expect(parsePrReference('o/r#12')).toEqual({ repo: 'o/r', number: 12 });
    expect(parsePrReference(' https://github.com/o/r/pull/12/files ')).toEqual({ repo: 'o/r', number: 12 });
    expect(parsePrReference('o/r')).toBeNull();
    expect(parsePrReference('o/r#0')).toBeNull();
    expect(parsePrReference('https://example.com/o/r/pull/3')).toBeNull();
  });

  it('builds the PR Watch commitment the desktop builds', () => {
    const c = prWatchCommitment({ repo: 'o/r', number: 12 });
    expect(c).toMatchObject({ kind: 'pr_watch', exitCondition: 'merged or closed' });
    expect(JSON.parse(c.spec ?? '')).toEqual({ repo: 'o/r', number: 12 });
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
    expect(personalAgentMessage(refused('invalid', 400, 'pr_watch needs repo'))).toBe('pr_watch needs repo');
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
  it('an older Host without a time falls back to the name', () => {
    expect(mixedChats([row('a_2', 'Bo', 0), row('a_1', 'Ada', 0)], []).map((e) => e.id)).toEqual(['a_1', 'a_2']);
  });
});
