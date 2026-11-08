// [INPUT]: the Host's terminal history text (plain UTF-8) and a local search string.
// [OUTPUT]: historyRows (numbered lines), filterRows (local case-insensitive search), rowsText (what Copy puts on the clipboard), historyFailure (one sentence per refusal).
// [POS]: Pure model of the read-only terminal history page; nothing here talks to the Host or the renderer.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { HostV3Error } from '@/lib/host-client-v3';

export type HistoryRow = { n: number; text: string };

export function historyRows(text: string): HistoryRow[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, index) => ({ n: index + 1, text: line }));
}

export function filterRows(rows: HistoryRow[], query: string): HistoryRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.text.toLowerCase().includes(needle));
}

export function rowsText(rows: HistoryRow[]): string {
  return rows.map((row) => row.text).join('\n');
}

export function historyFailure(error: unknown): string {
  if (error instanceof HostV3Error) {
    if (error.code === 'history_busy') return 'The terminal is still printing. Try again in a moment.';
    if (error.code === 'unknown_terminal') return 'This terminal no longer exists.';
  }
  return 'The history could not be read.';
}
