import { describe, expect, it } from 'vitest';

import type { TreePane, TreeWorkspace } from '@/contracts/host-v3';

import { buildWidgetData, paneUri, visibleRows } from '@/features/widget/widget-model';
import { flattenPanes } from '@/features/host/pane-model';

const agent = (paneId: string, status: string, lastActiveMs?: number, title?: string): TreePane => ({
  paneId,
  terminalId: `t-${paneId}`,
  agent: { provider: 'claude', status, ...(title ? { title } : {}), ...(lastActiveMs === undefined ? {} : { lastActiveMs }) },
});

const tree = (...panes: TreePane[]): TreeWorkspace[] => [
  { id: 'w1', label: 'acme', status: 'ok', tabs: [{ id: 'tab1', label: 'main', status: 'ok', panes }] },
];

describe('buildWidgetData', () => {
  it('counts every group and lists the three most urgent agents: needs you, working, then idle by recency', () => {
    const data = buildWidgetData(
      tree(agent('a', 'idle', 50), agent('b', 'working', 10), agent('c', 'blocked', 5), agent('d', 'idle', 90), agent('e', 'working', 20)),
      'w1',
      true,
    );
    expect(data).toMatchObject({ needsYou: 1, working: 2, idle: 2 });
    expect(data.rows.map((row) => [row.paneId, row.status])).toEqual([
      ['c', 'blocked'],
      ['e', 'working'],
      ['b', 'working'],
    ]);
  });

  it('uses the Mac sidebar title and the workspace label', () => {
    const [row] = buildWidgetData(tree(agent('a', 'blocked', 1, 'Fix the build')), 'w1', true).rows;
    expect(row).toMatchObject({ title: 'Fix the build', caption: 'acme' });
  });

  it('skips plain terminals and answers with no rows for an empty tree', () => {
    expect(buildWidgetData(tree({ paneId: 'p', terminalId: 't-p' }), 'w1', true)).toEqual({ needsYou: 0, working: 0, idle: 0, rows: [] });
    expect(buildWidgetData([], 'w1', true).rows).toEqual([]);
  });
});

describe('paneUri', () => {
  const [item] = flattenPanes(tree(agent('w1:p 2', 'blocked', 1, 'A & B')));

  it('opens the agent Chat with its terminal, instance and title encoded', () => {
    expect(paneUri(item!, 'inst/1', true)).toBe('solco://chat/w1%3Ap%202?terminalId=t-w1%3Ap%202&instance=inst%2F1&title=A%20%26%20B');
  });

  it('falls back to the Terminal when the Host does not serve Chat', () => {
    expect(paneUri(item!, 'w1', false)).toBe('solco://terminal/t-w1%3Ap%202?instance=w1&title=A%20%26%20B');
  });
});

describe('visibleRows', () => {
  it('fits the rows to the widget height and never goes below one', () => {
    expect(visibleRows(undefined)).toBe(3);
    expect(visibleRows(0)).toBe(3);
    expect(visibleRows(160)).toBe(3);
    expect(visibleRows(110)).toBe(2);
    expect(visibleRows(70)).toBe(1);
    expect(visibleRows(20)).toBe(1);
  });
});
