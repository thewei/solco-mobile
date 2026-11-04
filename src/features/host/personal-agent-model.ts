// [INPUT]: the Assistants wire types (contracts/host-v3), the phone's tree and a clock.
// [OUTPUT]: sortAssistants, mixedChats, conversationState, assistantLine, taskBuckets, taskStateLabel, taskActions, goalActions, goalLine, approvalLine, openableRun,
//           parsePrReference + prWatchCommitment (the desktop's PR Watch spec), createRequestIds (write receipts' ids), personalAgentMessage.
// [POS]: Pure presentation model behind the phone's Assistants screens; no IO, no state. The Mac's Go core owns every fact — which
//        Assistants exist, what each task is doing, whether an action is still allowed — this only orders and words them with the
//        desktop page's vocabulary. It never infers a state (a task is "running" only when the core says so) and never matches a
//        run to a pane by title: a run opens only when its own Herdr session and pane id are in this phone's tree.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type {
  AssistantApproval,
  AssistantCoordinator,
  AssistantCommitmentInput,
  AssistantGoal,
  AssistantGoalAction,
  AssistantOverviewGroup,
  AssistantOverviewRow,
  AssistantRun,
  AssistantTask,
  AssistantTaskAction,
  TreePane,
  TreeWorkspace,
} from '@/contracts/host-v3';
import { agoShort, flattenPanes } from '@/features/host/pane-model';
import { formatInMs } from '@/features/host/quota-model';
import { HostV3Error } from '@/lib/host-client-v3';

/** Needs-you and approvals first, then the quiet ones by name. */
export function sortAssistants(rows: readonly AssistantOverviewRow[]): AssistantOverviewRow[] {
  const weight = (r: AssistantOverviewRow) => r.needsYou + r.approvals;
  return [...rows].sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name));
}

export type ChatEntry =
  | { kind: 'assistant'; id: string; at: number; row: AssistantOverviewRow }
  | { kind: 'group'; id: string; at: number; group: AssistantOverviewGroup };

/** The Chats list is one list: what needs the person first, then the most recently active, Assistants and Groups mixed. */
export function mixedChats(rows: readonly AssistantOverviewRow[], groups: readonly AssistantOverviewGroup[]): ChatEntry[] {
  const entries: ChatEntry[] = [
    ...rows.map((row): ChatEntry => ({ kind: 'assistant', id: row.id, at: row.updatedAt, row })),
    ...groups.map((group): ChatEntry => ({ kind: 'group', id: group.id, at: group.updatedAt, group })),
  ];
  const asking = (e: ChatEntry) => (e.kind === 'assistant' ? e.row.needsYou + e.row.approvals : 0);
  const name = (e: ChatEntry) => (e.kind === 'assistant' ? e.row.name : e.group.title);
  return entries.sort((a, b) => Number(asking(b) > 0) - Number(asking(a) > 0) || b.at - a.at || name(a).localeCompare(name(b)));
}

/** One line of counters; "Idle" when the core reports nothing, "Paused" when the Assistant is. */
export function assistantLine(row: AssistantOverviewRow): string {
  if (row.status !== 'active') return 'Paused'; // the core's word is "disabled"
  const parts: string[] = [];
  const asking = row.needsYou + row.approvals;
  if (asking > 0) parts.push(`${asking} ${asking === 1 ? 'needs' : 'need'} you`);
  if (row.running > 0) parts.push(`${row.running} running`);
  if (row.queued > 0) parts.push(`${row.queued} queued`);
  if (row.goals > 0) parts.push(`${row.goals} goal${row.goals === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'Idle';
}

const LIVE = new Set(['waiting', 'blocked', 'uncertain', 'review_required', 'starting', 'claimed', 'running', 'queued', 'draft']);
const LIVE_ORDER = ['waiting', 'blocked', 'uncertain', 'review_required', 'starting', 'claimed', 'running', 'queued', 'draft'];

export interface TaskBuckets {
  needsYou: AssistantTask[];
  live: AssistantTask[];
  done: AssistantTask[];
}

/** What needs you, what is moving, what is history (newest first). */
export function taskBuckets(tasks: readonly AssistantTask[], flagged: ReadonlySet<string> = new Set()): TaskBuckets {
  const asks = (t: AssistantTask) => t.needsYou || flagged.has(t.id);
  const needsYou = tasks.filter(asks).sort((a, b) => b.updatedAt - a.updatedAt);
  const rest = tasks.filter((t) => !asks(t));
  const live = rest.filter((t) => LIVE.has(t.state)).sort((a, b) => LIVE_ORDER.indexOf(a.state) - LIVE_ORDER.indexOf(b.state) || b.updatedAt - a.updatedAt);
  const done = rest.filter((t) => !LIVE.has(t.state)).sort((a, b) => b.updatedAt - a.updatedAt);
  return { needsYou, live, done };
}

const TASK_STATES: Record<string, string> = {
  draft: 'Draft',
  waiting: 'Waiting for another task',
  queued: 'Queued',
  claimed: 'Starting',
  starting: 'Starting',
  running: 'Running',
  blocked: 'Waiting for you',
  review_required: 'Review needed',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  uncertain: 'Unsure if it started',
};

export function taskStateLabel(state: string): string {
  return TASK_STATES[state] ?? state;
}

/** The only task writes the phone offers: Publish a draft the Coordinator filed, Got it for a finished task that asks, Retry for a failed or cancelled one. */
export function taskActions(task: Pick<AssistantTask, 'needsYou' | 'state'>): AssistantTaskAction[] {
  if (task.state === 'draft') return ['publish'];
  if (task.needsYou) return ['ack'];
  if (task.state === 'failed' || task.state === 'cancelled') return ['retry'];
  return [];
}

/** Goal writes by state. Completing a goal needs evidence a person reads, so it stays on the Mac. */
export function goalActions(state: string): AssistantGoalAction[] {
  switch (state) {
    case 'draft':
      return ['approve', 'cancel'];
    case 'active':
      return ['pause', 'cancel'];
    case 'paused':
      return ['resume', 'cancel'];
    default:
      return [];
  }
}

function specOf(spec: string): { repo?: string; number?: number } {
  try {
    const parsed: unknown = JSON.parse(spec);
    return typeof parsed === 'object' && parsed !== null ? (parsed as { repo?: string; number?: number }) : {};
  } catch {
    return {};
  }
}

/** What a goal is doing, from its first commitment's own timestamps. */
export function goalLine(goal: AssistantGoal, now: number): string {
  if (goal.state === 'draft') return 'Draft — nothing runs until you start it';
  if (goal.state === 'paused') return 'Paused';
  if (goal.state === 'completed') return 'Completed';
  if (goal.state === 'cancelled') return 'Cancelled';
  const c = goal.commitments[0];
  if (!c) return 'Active';
  const spec = c.kind === 'pr_watch' ? specOf(c.spec) : {};
  const parts = [spec.repo && spec.number ? `Watching ${spec.repo}#${spec.number}` : c.kind === 'pr_watch' ? 'Watching a pull request' : 'Active'];
  if (c.lastCheckedAt > 0) parts.push(`checked ${agoShort(c.lastCheckedAt, now)} ago`);
  if (c.nextCheckAt > now) parts.push(`next in ${formatInMs(c.nextCheckAt - now)}`);
  if (c.lastError) parts.push('last check failed');
  return parts.join(' · ');
}

export function approvalLine(approval: AssistantApproval, now: number): string {
  if (approval.state !== 'pending') return approval.state.charAt(0).toUpperCase() + approval.state.slice(1);
  if (approval.expiresAt > 0 && approval.expiresAt <= now) return 'Expired';
  return approval.expiresAt > 0 ? `Expires in ${formatInMs(approval.expiresAt - now)}` : 'Waiting for you';
}

/** The pane a task's newest run left behind, when this phone's tree still lists it in the run's own Herdr session. */
export function openableRun(runs: readonly AssistantRun[], workspaces: readonly TreeWorkspace[], instance: string): TreePane | null {
  const panes = flattenPanes(workspaces);
  const newest = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  for (const run of newest) {
    if (!run.paneId || run.herdrSession !== instance) continue;
    const found = panes.find((entry) => entry.pane.paneId === run.paneId);
    if (found) return found.pane;
  }
  return null;
}

/** The Assistant's conversation as the phone can use it: where it is, in the core's own words. */
export type ConversationState =
  | { kind: 'open'; pane: TreePane }
  | { kind: 'starting' }
  | { kind: 'elsewhere' }
  | { kind: 'idle'; failed: boolean };

/**
 * `ready` opens only when the Coordinator's own Herdr session and pane id are in this phone's tree (never by title); a ready one
 * the tree does not list is `elsewhere` (another Herdr session or a closed pane) — the phone does not guess. `none`, `stopped`
 * and `failed` are `idle`: the person can start it again.
 */
export function conversationState(co: AssistantCoordinator, workspaces: readonly TreeWorkspace[], instance: string): ConversationState {
  if (co.state === 'starting') return { kind: 'starting' };
  if (co.state === 'ready') {
    if (co.paneId && co.herdrSession === instance) {
      const found = flattenPanes(workspaces).find((entry) => entry.pane.paneId === co.paneId);
      if (found) return { kind: 'open', pane: found.pane };
    }
    return { kind: 'elsewhere' };
  }
  return { kind: 'idle', failed: co.state === 'failed' };
}

/** `owner/repo#12` or a github.com pull-request URL. */
export function parsePrReference(text: string): { repo: string; number: number } | null {
  const value = text.trim();
  const short = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/.exec(value);
  const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(value);
  const m = short ?? url;
  if (!m?.[1] || !m[2]) return null;
  const number = Number(m[2]);
  return number > 0 ? { repo: m[1], number } : null;
}

/** The commitment the desktop's "Watch a PR" sheet makes: deterministic checks, a research-only Agent when the PR moves. */
export function prWatchCommitment(pr: { repo: string; number: number }): AssistantCommitmentInput {
  return {
    kind: 'pr_watch',
    spec: JSON.stringify({ repo: pr.repo, number: pr.number }),
    successCriteria: `${pr.repo}#${pr.number} is reviewed and settled`,
    exitCondition: 'merged or closed',
  };
}

/**
 * requestId lifecycle for writes. The Mac remembers every id it answered (a repeat replays the first receipt), so an id is
 * reused only when the same request failed with no answer (transport) — the Mac may have done it; any other outcome starts afresh.
 */
export function createRequestIds(generate: () => string) {
  let pending: { id: string; key: string } | null = null;
  return {
    begin(key: string): string {
      if (!pending || pending.key !== key) pending = { id: generate(), key };
      return pending.id;
    },
    settle(error: unknown | null) {
      if (!(error instanceof HostV3Error) || error.kind !== 'transport') pending = null;
    },
  };
}

/** The id a write's receipt carries (a created Assistant or Goal), or null. */
export function receiptId(receipt: unknown): string | null {
  return typeof receipt === 'object' && receipt !== null && 'id' in receipt && typeof receipt.id === 'string' ? receipt.id : null;
}

/** One sentence for a failed read or write: the core's own words for a bad request, ours for the rest. */
export function personalAgentMessage(error: unknown): string {
  if (error instanceof HostV3Error) {
    switch (error.code) {
      case 'stale_revision':
        return 'That changed on your computer in the meantime. It has been refreshed — try again.';
      case 'assistant_disabled':
        return 'This Assistant is paused. Resume it first.';
      case 'personal_agent_unavailable':
        return 'Assistants are not available on your computer.';
      case 'not_found':
        return 'That no longer exists.';
      case 'bad_state':
      case 'not_claimable':
        return 'That is no longer possible in its current state.';
      case 'busy':
        return 'Your computer is busy with it. Try again in a moment.';
      case 'uncertain':
        return 'Your computer could not confirm whether that started. Check it there before retrying.';
      case 'request_conflict':
        return 'That request was already used for something else. Try again.';
      case 'invalid':
      case 'bad_request':
        return error.message || 'Your computer refused that request.';
      default:
    }
    if (error.kind === 'transport') return 'Could not reach the computer. Try again.';
    if (error.status === 403) return 'This phone is not allowed to change Assistants.';
  }
  return 'The computer did not answer. Try again.';
}
