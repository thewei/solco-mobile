import { describe, expect, it } from 'vitest';

import type { TreePane, TreeWorkspace } from '@/contracts/host-v3';

import { agentAge, agoShort, backgroundBusy, backgroundStatus, backgroundSummary, comparePanes, flattenPanes, paneRoute, paneTitle, reportsAges, summarize } from './pane-model';

const shell: TreePane = { paneId: 'p1', terminalId: 't1', cwd: '/Users/me/proj' };
const agent = (status: string): TreePane => ({ paneId: 'p2', terminalId: 't2', agent: { provider: 'claude', status } });
const ws = (panes: TreePane[]): TreeWorkspace => ({
  id: 'w1',
  label: 'solco',
  status: 'idle',
  tabs: [{ id: 'tab1', label: '1', status: 'idle', panes }],
});

describe('paneTitle', () => {
  it('names a plain pane by its label, then its cwd leaf', () => {
    expect(paneTitle({ ...shell, label: ' build ' })).toBe('build');
    expect(paneTitle(shell)).toBe('proj');
    expect(paneTitle({ paneId: 'p', terminalId: 't' })).toBe('Terminal');
  });
  it('names an agent as the Mac sidebar does: its title first, never the terminal label', () => {
    const titled: TreePane = { paneId: 'p', terminalId: 't', label: 'bun.native', agent: { provider: 'claude', status: 'idle', title: ' Fix the parser ' } };
    expect(paneTitle(titled)).toBe('Fix the parser');
    expect(paneTitle({ ...titled, agent: { provider: 'claude', status: 'idle', title: 'Claude Code' } })).toBe('Claude Code');
  });
  it('falls back for an older Host that sends no title: label, then provider', () => {
    expect(paneTitle({ ...agent('idle'), label: 'omp' })).toBe('omp');
    expect(paneTitle(agent('idle'))).toBe('claude');
  });
});

describe('agoShort', () => {
  const now = 10_000_000_000;
  it('reads like the Mac: <1m, minutes, hours under 48, then days; empty when unknown', () => {
    expect(agoShort(undefined, now)).toBe('');
    expect(agoShort(now - 30_000, now)).toBe('<1m');
    expect(agoShort(now - 5 * 60_000, now)).toBe('5m');
    expect(agoShort(now - 47 * 3_600_000, now)).toBe('47h');
    expect(agoShort(now - 50 * 3_600_000, now)).toBe('2d');
    expect(agoShort(now + 60_000, now)).toBe('<1m');
  });
});

describe('comparePanes', () => {
  const at = (status: string, lastActiveMs?: number, id = status, firstSeenMs?: number): TreePane => ({ paneId: id, terminalId: id, agent: { provider: 'omp', status, lastActiveMs, firstSeenMs } });
  it('orders blocked, working, other agents newest first, then plain panes', () => {
    const rows = [shell, at('idle', 100, 'old'), at('idle', 900, 'new'), at('working'), at('blocked')];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['blocked', 'working', 'new', 'old', 'p1']);
  });
  it('puts an agent that never ran a turn first among the settled ones: it was just created (2026-11-07, user-reported)', () => {
    const rows = [at('idle', 100, 'old'), at('idle', undefined, 'fresh'), at('idle', 900, 'new')];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['fresh', 'new', 'old']);
  });
  it('dates an agent that never ran a turn by when the Host first saw it: it ages like any chat and is not pinned first forever (2026-11-07)', () => {
    const rows = [at('idle', 3_000, 'worked-3'), at('idle', undefined, 'seen-2', 2_000), at('idle', 1_000, 'worked-1'), at('idle', undefined, 'seen-4', 4_000)];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['seen-4', 'worked-3', 'seen-2', 'worked-1']);
  });
  it('prefers the last-worked time to the first-seen one', () => {
    const rows = [at('idle', undefined, 'seen-3', 3_000), at('idle', 5_000, 'worked-5', 100)];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['worked-5', 'seen-3']);
  });
  it('never lets a fresh agent outrank urgency', () => {
    const rows = [at('idle', undefined, 'fresh'), at('working', 50, 'busy'), at('blocked', undefined, 'asking')];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['asking', 'busy', 'fresh']);
  });
  it('keeps the tree order when the Host reports no times at all', () => {
    const rows = [at('idle', undefined, 'a'), at('idle', undefined, 'b'), at('idle', undefined, 'c')];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['a', 'b', 'c']);
  });
});

describe('agentAge', () => {
  const now = 10_000_000;
  const at = (lastActiveMs?: number, firstSeenMs?: number): TreePane => ({ paneId: 'p', terminalId: 't', agent: { provider: 'omp', status: 'idle', lastActiveMs, firstSeenMs } });
  it('is the Mac age while the agent has a time', () => {
    expect(agentAge(at(now - 5 * 60_000), now, true)).toBe('5m');
    expect(agentAge(at(now - 5 * 60_000), now, false)).toBe('5m');
  });
  it('says New for an agent without a time, when the Host reports times for others', () => {
    expect(agentAge(at(undefined), now, true)).toBe('New');
  });
  it('says New for a chat the Host first saw under 10 minutes ago, then how long ago it did (2026-11-07)', () => {
    expect(agentAge(at(undefined, now - 30_000), now, true)).toBe('New');
    expect(agentAge(at(undefined, now - 9 * 60_000), now, true)).toBe('New');
    expect(agentAge(at(undefined, now - 10 * 60_000), now, true)).toBe('10m');
    expect(agentAge(at(undefined, now - 2 * 3_600_000), now, true)).toBe('2h');
  });
  it('prefers the last-worked time to the first-seen one', () => {
    expect(agentAge(at(now - 5 * 60_000, now - 30_000), now, true)).toBe('5m');
  });
  it('does not date an agent by first sight when the Host reports no times at all: it says nothing about any single agent', () => {
    expect(agentAge(at(undefined, now - 2 * 3_600_000), now, false)).toBe('');
    expect(agentAge(at(undefined, now - 30_000), now, false)).toBe('');
  });
  it('says nothing about an agent without a time when the Host reports none at all', () => {
    expect(agentAge(at(undefined), now, false)).toBe('');
  });
  it('is empty for a plain pane', () => {
    expect(agentAge(shell, now, true)).toBe('');
  });
});

describe('reportsAges', () => {
  const item = (pane: TreePane) => flattenPanes([ws([pane])])[0]!;
  const at = (lastActiveMs?: number): TreePane => ({ paneId: 'p', terminalId: 't', agent: { provider: 'omp', status: 'idle', lastActiveMs } });
  it('is true once any agent carries a last-worked time', () => {
    expect(reportsAges([item(at(undefined)), item(at(5))])).toBe(true);
  });
  it('is false for agents without times, plain panes and nothing', () => {
    expect(reportsAges([item(at(undefined)), item(shell)])).toBe(false);
    expect(reportsAges([])).toBe(false);
  });
});

describe('paneRoute', () => {
  it('opens an agent pane in Chat only when the Host serves it', () => {
    expect(paneRoute(agent('idle'), 'default', true).pathname).toBe('/chat/[paneId]');
    expect(paneRoute(agent('idle'), 'default', false).pathname).toBe('/terminal/[terminalId]');
  });
  it('always opens a plain pane in its terminal', () => {
    const route = paneRoute(shell, 'default', true);
    expect(route).toEqual({ pathname: '/terminal/[terminalId]', params: { terminalId: 't1', instance: 'default', title: 'proj' } });
  });
});

describe('summarize', () => {
  it('lists each group most recently worked first', () => {
    const mk = (id: string, status: string, lastActiveMs: number): TreePane => ({ paneId: id, terminalId: id, agent: { provider: 'omp', status, lastActiveMs } });
    const s = summarize([ws([mk('a', 'idle', 1), mk('b', 'idle', 3), mk('c', 'done', 2)])]);
    expect(s.idle.map((item) => item.pane.paneId)).toEqual(['b', 'c', 'a']);
  });
  it('lists an agent that never ran a turn first, like the Chats list', () => {
    const mk = (id: string, lastActiveMs?: number): TreePane => ({ paneId: id, terminalId: id, agent: { provider: 'omp', status: 'idle', lastActiveMs } });
    const s = summarize([ws([mk('a', 1), mk('fresh'), mk('b', 3)])]);
    expect(s.idle.map((item) => item.pane.paneId)).toEqual(['fresh', 'b', 'a']);
  });
  it('counts blocked agents as needing you and working agents as working', () => {
    const tree = [ws([shell, agent('blocked')]), ws([agent('working'), agent('idle')])];
    const s = summarize(tree);
    expect(s.needsYou).toHaveLength(1);
    expect(s.working).toHaveLength(1);
    expect(s.idle).toHaveLength(1);
    expect(flattenPanes(tree)).toHaveLength(4);
  });
  it('is empty for an empty tree', () => {
    expect(summarize([])).toEqual({ needsYou: [], working: [], idle: [] });
  });
});

describe('background', () => {
  const sub = (state: string) => ({ kind: 'subagent', id: 'a', title: 'Explore', state });
  const svc = { kind: 'service', id: 'svc:p', title: 'node', detail: ':3000', state: 'running' };
  it('summarizes sub-agents and services in one line', () => {
    expect(backgroundSummary([sub('working'), sub('done'), svc])).toBe('2 sub-agents · 1 service');
    expect(backgroundSummary([svc])).toBe('1 service');
  });
  it('opens the fold only while something works; a service is a square, not a status', () => {
    expect(backgroundBusy([sub('working'), svc])).toBe(true);
    expect(backgroundBusy([sub('done'), svc])).toBe(false);
    expect(backgroundStatus(sub('working'))).toBe('working');
    expect(backgroundStatus(sub('stopped'))).toBe('idle');
  });
});
