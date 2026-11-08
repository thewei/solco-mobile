import { describe, expect, it } from 'vitest';

import { HostV3Error } from '@/lib/host-client-v3';

import { filterRows, historyFailure, historyRows, rowsText } from './terminal-history-model';

describe('terminal history model', () => {
  it('numbers lines from 1 and drops the trailing newline, keeping blank lines between', () => {
    expect(historyRows('a\n\nb\n')).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: '' },
      { n: 3, text: 'b' },
    ]);
    expect(historyRows('')).toEqual([]);
    expect(historyRows('x\r\ny')).toEqual([{ n: 1, text: 'x' }, { n: 2, text: 'y' }]);
  });

  it('searches locally, case-insensitively, keeping the original line numbers', () => {
    const rows = historyRows('Error: boom\nok\nerror again\n');
    expect(filterRows(rows, 'ERROR').map((r) => r.n)).toEqual([1, 3]);
    expect(filterRows(rows, '   ')).toBe(rows);
    expect(filterRows(rows, 'nope')).toEqual([]);
  });

  it('copies exactly the rows on screen', () => {
    expect(rowsText(historyRows('a\nb\nc'))).toBe('a\nb\nc');
    expect(rowsText(filterRows(historyRows('a\nb\nc'), 'b'))).toBe('b');
  });

  it('names the refusals a person can act on', () => {
    const busy = new HostV3Error('http', 'history', { code: 'history_busy', status: 409 });
    expect(historyFailure(busy)).toMatch(/still printing/);
    expect(historyFailure(new HostV3Error('http', 'x', { code: 'unknown_terminal', status: 404 }))).toMatch(/no longer exists/);
    expect(historyFailure(new Error('boom'))).toMatch(/could not be read/);
  });
});
