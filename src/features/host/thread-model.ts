// [INPUT]: v3 tree panes (flattened with their Workspace), the chosen Workspace filter and the search words.
// [OUTPUT]: workspaceMark (the two letters and the hue of a Workspace's badge), providerMark (the agent's two-letter
//           mark), threadSections (the Chats list: needs-you, working, earlier — filtered and searched) and
//           threadMatch (where a search hit sits inside a title).
// [POS]: Pure presentation model of the Chats tab (designs/mobile-t3-redesign `chats`): what is a card row and what is a
//        slim row, which words a badge shows. No IO, no state; the Host's titles and statuses are the only inputs.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { comparePanes, paneTitle, type FlatPane } from '@/features/host/pane-model';

/** A stable hue (0–359) from the Workspace's name, so one Workspace keeps one color on every screen and device. */
function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** `solco-mobile` → SM, `herdr` → HE: the first letters of the first two words, else the first two letters. */
export function workspaceMark(label: string): { letters: string; hue: number } {
  const name = label.trim() || '?';
  const words = name.split(/[\s\-_./]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : name.slice(0, 2);
  return { letters: letters.toUpperCase(), hue: hueOf(name.toLowerCase()) };
}

const PROVIDER_MARKS: [RegExp, string][] = [
  [/claude/i, 'CC'],
  [/codex/i, 'CX'],
  [/cursor/i, 'CU'],
  [/antigravity|agy/i, 'AG'],
  [/^omp$|oh-my-pi/i, 'OM'],
  [/^pi$/i, 'PI'],
];

export function providerMark(provider: string): string {
  const hit = PROVIDER_MARKS.find(([pattern]) => pattern.test(provider));
  return hit ? hit[1] : provider.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
}

export interface ThreadSections {
  /** Blocked on a person: the unlabeled group at the top, card rows. */
  needsYou: FlatPane[];
  /** Working: the `Working` shelf, card rows. */
  working: FlatPane[];
  /** Everything settled: the `Earlier` shelf, slim rows. */
  earlier: FlatPane[];
}

const agentPanes = (panes: readonly FlatPane[]) => panes.filter((item) => item.pane.agent);

/**
 * Splits the agent panes into the three groups of the Chats list, most recently worked first inside each, after the
 * Workspace filter and the search words (a case-insensitive substring of the title, like the design's search).
 */
export function threadSections(panes: readonly FlatPane[], { workspaceId, query = '' }: { workspaceId?: string; query?: string } = {}): ThreadSections {
  const words = query.trim().toLowerCase();
  const kept = agentPanes(panes)
    .filter((item) => !workspaceId || item.workspace.id === workspaceId)
    .filter((item) => !words || paneTitle(item.pane).toLowerCase().includes(words))
    .sort((a, b) => comparePanes(a.pane, b.pane));
  return {
    needsYou: kept.filter((item) => item.pane.agent?.status === 'blocked'),
    working: kept.filter((item) => item.pane.agent?.status === 'working'),
    earlier: kept.filter((item) => item.pane.agent?.status !== 'blocked' && item.pane.agent?.status !== 'working'),
  };
}

/** Splits a title around the first hit of the search words: `[before, hit, after]`, or null when there is none. */
export function threadMatch(title: string, query: string): [string, string, string] | null {
  const words = query.trim().toLowerCase();
  if (!words) return null;
  const at = title.toLowerCase().indexOf(words);
  if (at < 0) return null;
  return [title.slice(0, at), title.slice(at, at + words.length), title.slice(at + words.length)];
}
