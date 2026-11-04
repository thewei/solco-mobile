import { describe, expect, it } from 'vitest';

import type { TreePane, TreeWorkspace } from '@/contracts/host-v3';

import { agoShort, backgroundBusy, backgroundStatus, backgroundSummary, comparePanes, flattenPanes, paneRoute, paneTitle, summarize } from './pane-model';

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
  const at = (status: string, lastActiveMs?: number, id = status): TreePane => ({ paneId: id, terminalId: id, agent: { provider: 'omp', status, lastActiveMs } });
  it('orders blocked, working, other agents newest first, then plain panes', () => {
    const rows = [shell, at('idle', 100, 'old'), at('idle', 900, 'new'), at('working'), at('blocked')];
    expect(rows.sort(comparePanes).map((pane) => pane.paneId)).toEqual(['blocked', 'working', 'new', 'old', 'p1']);
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
