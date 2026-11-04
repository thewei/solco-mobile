// [INPUT]: the Host's read-only SessionRow / TrashEntry DTOs and a clock.
// [OUTPUT]: sessionAgentName, runningLabel, runningTone, sessionCaption, splitSessions, continueFailureMessage, trashCaption, trashFailureMessage.
// [POS]: Pure presentation model behind the phone's Sessions screen; no IO, no state. The Mac owns every
//        fact — what exists, what matches a search, and which session an Agent is running (the
//        desktop's exact-identity rule); this only words and groups them.
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

/** The pill's word for a running session (the desktop's own: Running / Needs you / Ready / Open). */
export function runningLabel(state: string): string {
  switch (state) {
    case 'working':
      return 'Running';
    case 'attention':
      return 'Needs you';
    case 'review':
      return 'Ready';
    default:
      return 'Open';
  }
}

export type RunningTone = 'accent' | 'attention' | 'success' | 'muted';

export function runningTone(state: string): RunningTone {
  switch (state) {
    case 'working':
      return 'accent';
    case 'attention':
      return 'attention';
    case 'review':
      return 'success';
    default:
      return 'muted';
  }
}

/** "Claude Code · solco · 3h": agent, project, and how long ago it was written. */
export function sessionCaption(row: SessionRow, now: number): string {
  return [sessionAgentName(row.agent), row.project, row.updatedMs ? agoShort(row.updatedMs, now) : '']
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** The Host already lists running sessions first; the screen draws them as their own group. */
export function splitSessions(rows: readonly SessionRow[]): { running: SessionRow[]; rest: SessionRow[] } {
  return { running: rows.filter((row) => row.running), rest: rows.filter((row) => !row.running) };
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

/** "Claude Code · solco · deleted 3h ago". */
export function trashCaption(entry: TrashEntry, now: number): string {
  const ago = entry.deletedMs ? `deleted ${agoShort(entry.deletedMs, now)} ago` : '';
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
