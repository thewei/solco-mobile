// [INPUT]: the Host's read-only Git DTOs (GitStatus, GitDiff) and the tree's workspaces.
// [OUTPUT]: workspaceOfPane, workspaceOfTerminal, groupFiles, statusBadge, branchLine, summaryLine, fileParts, diffRows, diffNotice, gitFailureMessage;
//           for the writes: groupPaths, commitPlan, syncActions, gitWriteFailureMessage.
// [POS]: Pure presentation model behind the Changes screens; no IO, no state. The Host owns every Git fact —
//        this only words and orders them.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { GitDiff, GitFile, GitStatus, GitSyncOp, TreeWorkspace } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';

/** The Workspace a pane lives in (the Changes view is per Workspace folder), or null when the pane is gone. */
export function workspaceOfPane(workspaces: readonly TreeWorkspace[], paneId: string): TreeWorkspace | null {
  return workspaces.find((w) => w.tabs.some((t) => t.panes.some((p) => p.paneId === paneId))) ?? null;
}

/** Same, for a screen that only knows the pane's terminal id (the terminal route). */
export function workspaceOfTerminal(workspaces: readonly TreeWorkspace[], terminalId: string): TreeWorkspace | null {
  return workspaces.find((w) => w.tabs.some((t) => t.panes.some((p) => p.terminalId === terminalId))) ?? null;
}

export interface FileGroup {
  key: 'staged' | 'changes' | 'untracked';
  title: string;
  files: GitFile[];
}

/** Git UIs' three lists. A file edited after staging is honestly in both Staged and Changes. */
export function groupFiles(files: readonly GitFile[]): FileGroup[] {
  const groups: FileGroup[] = [
    { key: 'staged', title: 'Staged', files: files.filter((f) => f.staged && f.status !== 'untracked') },
    { key: 'changes', title: 'Changes', files: files.filter((f) => f.unstaged && f.status !== 'untracked') },
    { key: 'untracked', title: 'Untracked', files: files.filter((f) => f.status === 'untracked') },
  ];
  return groups.filter((g) => g.files.length > 0);
}

const BADGES: Record<string, { letter: string; tone: 'add' | 'change' | 'delete' | 'warn' | 'muted' }> = {
  modified: { letter: 'M', tone: 'change' },
  added: { letter: 'A', tone: 'add' },
  deleted: { letter: 'D', tone: 'delete' },
  renamed: { letter: 'R', tone: 'change' },
  copied: { letter: 'C', tone: 'change' },
  typechange: { letter: 'T', tone: 'change' },
  conflicted: { letter: '!', tone: 'warn' },
  untracked: { letter: 'U', tone: 'add' },
};

export function statusBadge(status: string) {
  return BADGES[status] ?? { letter: '?', tone: 'muted' as const };
}

/** "main · ↑1 ↓2", "Detached at abc1234", "Not on a branch yet". */
export function branchLine(status: GitStatus): string {
  const base = status.detached ? `Detached at ${status.head ?? 'HEAD'}` : status.branch || 'No commits yet';
  const up = status.upstream;
  const sync = up ? [up.ahead ? `↑${up.ahead}` : '', up.behind ? `↓${up.behind}` : ''].filter(Boolean).join(' ') : '';
  return sync ? `${base} · ${sync}` : base;
}

export function summaryLine(status: GitStatus): string {
  if (status.files.length === 0) return 'Working tree clean';
  const count = `${status.files.length}${status.truncated ? '+' : ''} file${status.files.length === 1 ? '' : 's'}`;
  return `${count} · +${status.additions} −${status.deletions}`;
}

/** Name first, folder as the caption (a phone row has no room for the whole path). */
export function fileParts(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? { name: path, dir: '' } : { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}

export type DiffRow =
  | { key: string; type: 'hunk'; text: string }
  | { key: string; type: 'line'; kind: '+' | '-' | ' '; old?: number; new?: number; text: string };

export function diffRows(diff: GitDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  diff.hunks.forEach((hunk, h) => {
    rows.push({ key: `h${h}`, type: 'hunk', text: hunk.header });
    (hunk.lines ?? []).forEach((line, i) => rows.push({ key: `h${h}l${i}`, type: 'line', kind: line.k, old: line.o, new: line.n, text: line.t }));
  });
  return rows;
}

/** Why a diff has nothing (or not everything) to show, in a sentence; null when it is shown whole. */
export function diffNotice(diff: GitDiff): string | null {
  if (diff.binary) return 'Binary file — no text diff.';
  if (diff.tooLarge) return 'This diff is too large to show on the phone.';
  if (diff.hunks.length === 0) return 'No line changes (mode or rename only).';
  if (diff.truncated) return 'Long diff — showing the first part.';
  return null;
}

export function gitFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong. Pull to retry.';
  switch (error.code) {
    case 'git_unavailable':
      return 'The Changes view is not enabled on the computer.';
    case 'unknown_workspace':
      return 'That workspace is gone.';
    case 'workspace_no_directory':
      return 'That workspace has no folder.';
    case 'unknown_file':
      return 'That file is no longer changed. Go back and refresh.';
    case 'git_failed':
      return 'The repository could not be read.';
    default:
      return error.kind === 'transport' ? 'Can’t reach the computer. Pull to retry.' : 'Something went wrong. Pull to retry.';
  }
}

// ---- writes (needs `capabilities.gitWrite`) ----

/** The paths a group's bulk action (Stage all / Unstage all) covers. */
export function groupPaths(group: FileGroup): string[] {
  return group.files.map((f) => f.path);
}

export interface CommitPlan {
  /** what the commit takes: every staged file */
  paths: string[];
  /**
   * Staged files that were edited again after staging. Git commits a file by its path, so those edits go in too —
   * the sheet says so instead of letting the commit surprise.
   */
  alsoUnstaged: string[];
}

/** Null when nothing is staged (there is nothing to commit). */
export function commitPlan(status: GitStatus): CommitPlan | null {
  const staged = status.files.filter((f) => f.staged && f.status !== 'untracked');
  if (staged.length === 0) return null;
  return { paths: staged.map((f) => f.path), alsoUnstaged: staged.filter((f) => f.unstaged).map((f) => f.path) };
}

export interface SyncAction {
  op: GitSyncOp;
  label: string;
  /** Pull and Push touch the remote or the branch: they ask first. Fetch only reads. */
  confirm?: { title: string; message: string; button: string };
}

const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

/** Fetch always; Pull when behind; Push when ahead (or a branch that has never been published). Nothing on a detached HEAD but Fetch. */
export function syncActions(status: GitStatus): SyncAction[] {
  if (!status.repo) return [];
  const actions: SyncAction[] = [{ op: 'fetch', label: 'Fetch' }];
  if (status.detached || !status.branch) return actions;
  const up = status.upstream;
  if (up && up.behind > 0) {
    actions.push({
      op: 'pull',
      label: `Pull ↓${up.behind}`,
      confirm: { title: `Pull ${commits(up.behind)} from ${up.name}?`, message: 'Fast-forward only: nothing is merged or rewritten, and a diverged branch is refused.', button: 'Pull' },
    });
  }
  if (up && up.ahead > 0) {
    actions.push({
      op: 'push',
      label: `Push ↑${up.ahead}`,
      confirm: { title: `Push ${commits(up.ahead)} to ${up.name}?`, message: 'This publishes them to the remote.', button: 'Push' },
    });
  } else if (!up && status.head) {
    actions.push({
      op: 'push',
      label: 'Publish',
      confirm: { title: `Publish ${status.branch}?`, message: 'This pushes the branch to the remote and sets it as the upstream.', button: 'Publish' },
    });
  }
  return actions;
}

/** One sentence per refusal code of the write endpoints; Git's own text never reaches the phone. */
export function gitWriteFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong.';
  switch (error.code) {
    case 'git_write_unavailable':
      return 'Changing Git from the phone is not enabled on the computer.';
    case 'git_stale':
      return 'The repository changed on the computer. Review the list and try again.';
    case 'unknown_file':
      return 'A file is no longer changed. The list was refreshed.';
    case 'git_hook_failed':
      return 'A Git hook refused the commit. Fix it on the computer.';
    case 'git_merge_in_progress':
      return 'A merge, revert or conflict is in progress. Finish it on the computer.';
    case 'git_locked':
      return 'Git is busy with another operation. Try again in a moment.';
    case 'git_rejected':
      return 'The remote refused it — the branch has diverged. Resolve it on the computer.';
    case 'git_no_upstream':
      return 'This branch has no upstream to pull from. Push it first.';
    case 'git_detached':
      return 'Not on a branch. Check one out on the computer.';
    case 'git_timeout':
      return 'The remote took too long to answer.';
    case 'bad_request':
      return 'That commit message or selection is not valid.';
    case 'git_failed':
      return 'Git failed. Check the repository on the computer.';
    default:
      return error.kind === 'transport' ? 'Can’t reach the computer.' : 'Something went wrong.';
  }
}
