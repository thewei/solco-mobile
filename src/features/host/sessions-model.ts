// [INPUT]: the Host's read-only SessionRow / TrashEntry DTOs and a clock.
// [OUTPUT]: sessionAgentName, runningStatus, sessionCaption, sessionShelves, sessionAgents, continueFailureMessage, trashCaption,
//           trashFailureMessage.
// [POS]: Pure presentation model behind the phone's Sessions screen; no IO, no state. The Mac owns every
//        fact — what exists, what matches a search, and which session an Agent is running (the
//        desktop's exact-identity rule); this only words and groups them (Today / Yesterday / Earlier, as the draft's shelves).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { SessionRow, TrashEntry } from '@/contracts/host-v3';
import { agoShort } from '@/features/host/pane-model';
import { HostV3Error } from '@/lib/host-client-v3';

const AGENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  omp: 'OMP',
  cursor: 'Cursor Agent',
  antigravity: 'Antigravity',
};

/** A new Host id still renders by its id. */
export function sessionAgentName(id: string): string {
  return AGENT_NAMES[id] ?? id;
}

/** The thread-row status a running session shows (the desktop's pill vocabulary: Running / Needs you / Ready / Open). */
export function runningStatus(state: string): 'running' | 'needs' | 'ready' | 'open' {
  switch (state) {
    case 'working':
      return 'running';
    case 'attention':
      return 'needs';
    case 'review':
      return 'ready';
    default:
      return 'open';
  }
}

/** "Claude Code · solco": the agent and the project, the second line of a session row. */
export function sessionCaption(row: Pick<SessionRow, 'agent' | 'project'>): string {
  return [sessionAgentName(row.agent), row.project].filter((part): part is string => Boolean(part)).join(' · ');
}

export type SessionShelfLabel = 'Today' | 'Yesterday' | 'Earlier';

/**
 * The list as the draft's shelves: Today, Yesterday, Earlier by the local calendar day a session was last written; a
 * session an Agent runs belongs to Today whatever its file says, and leads its shelf (the Host already sends running first).
 * An empty shelf is left out. The Mac's order inside a shelf is kept.
 */
export function sessionShelves(rows: readonly SessionRow[], now: number): { label: SessionShelfLabel; rows: SessionRow[] }[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  midnight.setDate(midnight.getDate() - 1);
  const yesterday = midnight.getTime();
  const shelves: Record<SessionShelfLabel, SessionRow[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const row of rows) {
    const at = row.updatedMs ?? 0;
    shelves[row.running || at >= today ? 'Today' : at >= yesterday ? 'Yesterday' : 'Earlier'].push(row);
  }
  for (const label of Object.keys(shelves) as SessionShelfLabel[]) {
    // Stable: running rows first, the Mac's order otherwise.
    shelves[label] = [...shelves[label].filter((row) => row.running), ...shelves[label].filter((row) => !row.running)];
  }
  return (['Today', 'Yesterday', 'Earlier'] as const).filter((label) => shelves[label].length > 0).map((label) => ({ label, rows: shelves[label] }));
}

/** The agents present in a list (id, name), in first-seen order: the choices of "Filter by agent". */
export function sessionAgents(rows: readonly SessionRow[]): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const row of rows) {
    if (seen.has(row.agent)) continue;
    seen.add(row.agent);
    out.push({ id: row.agent, name: sessionAgentName(row.agent) });
  }
  return out;
}

/** One line per Continue failure (the Mac's own detail rides along only for a generic failure). */
export function continueFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'unknown_session':
      return 'This session is no longer listed. Pull to refresh.';
    case 'needs_project':
      return 'This session has no project folder, so it can’t be continued.';
    case 'cannot_continue':
      return 'This session can’t be continued from here.';
    case 'path_unavailable':
      return 'The project folder isn’t available.';
    case 'launch_conflict':
      return 'This session is already being continued.';
    case 'launch_uncertain':
      return 'It may have started. Check Home before trying again.';
    case 'continue_unavailable':
      return 'Continuing sessions is not enabled on the computer.';
    case 'launch_failed':
      return 'The session could not be continued.';
    default:
  }
  if (error.kind === 'transport') return 'Could not reach the computer. Try again.';
  return error.message;
}

/** "Claude Code · solco · moved 3h ago". */
export function trashCaption(entry: TrashEntry, now: number): string {
  const ago = entry.deletedMs ? `moved ${agoShort(entry.deletedMs, now)} ago` : '';
  return [sessionAgentName(entry.agent), entry.project, ago].filter((part): part is string => Boolean(part)).join(' · ');
}

/** One line per Trash failure; the Mac's refusal decides the wording, never a guess. */
export function trashFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'session_in_use':
      return 'An Agent is still using this session. Try again when it’s idle.';
    case 'session_exists':
      return 'Can’t put it back — a session file already exists there.';
    case 'unknown_session':
      return 'This session is no longer listed. Pull to refresh.';
    case 'unknown_entry':
      return 'This entry is no longer in the Trash. Pull to refresh.';
    case 'trash_unavailable':
      return 'The Trash is not enabled on the computer.';
    case 'trash_failed':
      return 'The Trash could not be changed.';
    default:
  }
  if (error.kind === 'transport') return 'Could not reach the computer. Try again.';
  return error.message;
}
