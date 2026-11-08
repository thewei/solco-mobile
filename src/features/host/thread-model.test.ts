// [INPUT]: hand-built tree panes.
// [OUTPUT]: pins the Chats list's grouping, filtering, search and badge rules.
// [POS]: Pure model test beside thread-model.ts.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { describe, expect, it } from 'vitest';

import type { TreePane, TreeWorkspace } from '@/contracts/host-v3';
import type { FlatPane } from '@/features/host/pane-model';
import { providerMark, threadMatch, threadSections, workspaceMark } from '@/features/host/thread-model';

const workspace = (id: string, label: string): TreeWorkspace => ({ id, label, status: 'idle', tabs: [] });
const flat = (ws: TreeWorkspace, paneId: string, title: string, status: string, lastActiveMs: number): FlatPane => {
  const pane: TreePane = { paneId, terminalId: `t-${paneId}`, agent: { provider: 'claude-code', status, title, lastActiveMs } };
  return { pane, workspace: ws, tabLabel: 'main' };
};

const solco = workspace('w1', 'solco');
const mobile = workspace('w2', 'solco-mobile');
const panes: FlatPane[] = [
  flat(solco, 'a', 'Fix chat loading stuck', 'blocked', 5),
  flat(mobile, 'b', '重新设计手机端界面', 'working', 9),
  flat(solco, 'c', 'Generate commit message', 'idle', 3),
  flat(mobile, 'd', 'Quota on the phone', 'done', 7),
  flat(solco, 'e', 'Assistants memory', 'working', 8),
  { pane: { paneId: 'plain', terminalId: 't-plain' }, workspace: solco, tabLabel: 'main' },
];

describe('threadSections', () => {
  it('groups agents by urgency, newest first, and leaves plain terminals out', () => {
    const sections = threadSections(panes);
    expect(sections.needsYou.map((p) => p.pane.paneId)).toEqual(['a']);
    expect(sections.working.map((p) => p.pane.paneId)).toEqual(['b', 'e']);
    expect(sections.earlier.map((p) => p.pane.paneId)).toEqual(['d', 'c']);
  });

  it('keeps a chat that never ran a turn in view: first in Earlier, inside the six rows the list shows (2026-11-07, user-reported)', () => {
    const settled = Array.from({ length: 8 }, (_, i) => flat(solco, `old${i}`, `Chat ${i}`, 'idle', 100 - i));
    const fresh: FlatPane = { pane: { paneId: 'new', terminalId: 't-new', agent: { provider: 'omp', status: 'idle', title: 'Oh My Pi' } }, workspace: mobile, tabLabel: 'main' };
    const earlier = threadSections([...settled, fresh]).earlier.map((p) => p.pane.paneId);
    expect(earlier[0]).toBe('new');
    expect(earlier.indexOf('new')).toBeLessThan(6);
  });

  it('dates a chat that never ran a turn by when the Host first saw it: first while new, aging with the rest after (2026-11-07)', () => {
    const settled = Array.from({ length: 8 }, (_, i) => flat(solco, `old${i}`, `Chat ${i}`, 'idle', 100 - i));
    const seen = (paneId: string, firstSeenMs: number): FlatPane => ({
      pane: { paneId, terminalId: `t-${paneId}`, agent: { provider: 'omp', status: 'idle', title: 'Oh My Pi', firstSeenMs } },
      workspace: mobile,
      tabLabel: 'main',
    });
    const earlier = (extra: FlatPane) => threadSections([...settled, extra]).earlier.map((p) => p.pane.paneId);
    expect(earlier(seen('new', 200))[0]).toBe('new');
    expect(earlier(seen('stale', 50)).indexOf('stale')).toBeGreaterThanOrEqual(6);
  });

  it('filters by Workspace', () => {
    const sections = threadSections(panes, { workspaceId: 'w2' });
    expect(sections.needsYou).toEqual([]);
    expect(sections.working.map((p) => p.pane.paneId)).toEqual(['b']);
    expect(sections.earlier.map((p) => p.pane.paneId)).toEqual(['d']);
  });

  it('searches titles case-insensitively and trims the words', () => {
    expect(threadSections(panes, { query: '  QUOTA ' }).earlier.map((p) => p.pane.paneId)).toEqual(['d']);
    expect(threadSections(panes, { query: '手机' }).working.map((p) => p.pane.paneId)).toEqual(['b']);
    const none = threadSections(panes, { query: 'nothing like this' });
    expect([none.needsYou, none.working, none.earlier].every((group) => group.length === 0)).toBe(true);
  });

  it('combines the Workspace filter with the search', () => {
    expect(threadSections(panes, { workspaceId: 'w1', query: 'quota' }).earlier).toEqual([]);
  });
});

describe('threadMatch', () => {
  it('splits a title around the first hit', () => {
    expect(threadMatch('Quota on the phone', 'on the')).toEqual(['Quota ', 'on the', ' phone']);
    expect(threadMatch('Quota', 'zzz')).toBeNull();
    expect(threadMatch('Quota', '  ')).toBeNull();
  });
});

describe('badges', () => {
  it('draws two letters: word initials, else the first two letters', () => {
    expect(workspaceMark('solco-mobile').letters).toBe('SM');
    expect(workspaceMark('herdr').letters).toBe('HE');
    expect(workspaceMark('My Project').letters).toBe('MP');
    expect(workspaceMark('x').letters).toBe('X');
    expect(workspaceMark('').letters).toBe('?');
  });

  it('keeps one hue per Workspace, whatever its case', () => {
    expect(workspaceMark('Solco').hue).toBe(workspaceMark('solco').hue);
    expect(workspaceMark('solco').hue).not.toBe(workspaceMark('herdr').hue);
    expect(workspaceMark('solco').hue).toBeGreaterThanOrEqual(0);
    expect(workspaceMark('solco').hue).toBeLessThan(360);
  });

  it('names the agent by two letters', () => {
    expect(providerMark('claude-code')).toBe('CC');
    expect(providerMark('Codex')).toBe('CX');
    expect(providerMark('cursor-agent')).toBe('CU');
    expect(providerMark('antigravity')).toBe('AG');
    expect(providerMark('omp')).toBe('OM');
    expect(providerMark('pi')).toBe('PI');
    expect(providerMark('some-new-agent')).toBe('SO');
  });
});
