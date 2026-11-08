// [INPUT]: the Assistants wire types (contracts/host-v3), the phone's tree and a clock.
// [OUTPUT]: sortAssistants, mixedChats, landingAssistant (the chat the Assistants entry opens directly), resultCards + openableResult (a settled task, from the core's `results`, as a system card in the chat window), conversationState, conversationWord (the header's one word, the desktop's own), waitForCoordinatorPane (a just-started Coordinator's addressable Agent pane), adoptableCoordinatorPane (the live pane a window may carry in place), sendWhenReady (retries only the Host's nothing-typed `not_ready`/`busy` refusals), assistantLine, taskBuckets, taskStateLabel, taskActions, approvalLine, openableRun,
//           createRequestIds (write receipts' ids), personalAgentMessage.
// [POS]: Pure presentation model behind the phone's Assistants screens; no IO, no state. The Mac's Go core owns every fact — which
//        Assistants exist, what each task is doing, whether an action is still allowed — this only orders and words them with the
//        desktop page's vocabulary. It never infers a state (a task is "running" only when the core says so) and never matches a
//        run to a pane by title: a run opens only when its own Herdr session and pane id are in this phone's tree.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type {
  AssistantApproval,
  AssistantCoordinator,
  AssistantOverviewGroup,
  AssistantOverviewRow,
  AssistantResult,
  AssistantRun,
  AssistantTask,
  AssistantTaskAction,
  TreePane,
  TreeWorkspace,
} from '@/contracts/host-v3';
import { flattenPanes } from '@/features/host/pane-model';
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

/** The Chats list is one list: the Primary Assistant always first, then what needs the person, then the most recently active, Assistants and Groups mixed. */
export function mixedChats(rows: readonly AssistantOverviewRow[], groups: readonly AssistantOverviewGroup[]): ChatEntry[] {
  const entries: ChatEntry[] = [
    ...rows.map((row): ChatEntry => ({ kind: 'assistant', id: row.id, at: row.updatedAt, row })),
    ...groups.map((group): ChatEntry => ({ kind: 'group', id: group.id, at: group.updatedAt, group })),
  ];
  const asking = (e: ChatEntry) => (e.kind === 'assistant' ? e.row.needsYou + e.row.approvals : 0);
  const name = (e: ChatEntry) => (e.kind === 'assistant' ? e.row.name : e.group.title);
  const primary = (e: ChatEntry) => (e.kind === 'assistant' && e.row.primary === true ? 1 : 0);
  return entries.sort((a, b) => primary(b) - primary(a) || Number(asking(b) > 0) - Number(asking(a) > 0) || b.at - a.at || name(a).localeCompare(name(b)));
}

/**
 * The Assistant the Assistants entry opens directly: the only one there is, else the one used last. '' = show the list (several
 * Assistants and none remembered, or the remembered one is gone).
 */
export function landingAssistant(rows: readonly AssistantOverviewRow[], last: string): string {
  const only = rows.length === 1 ? rows[0] : undefined;
  if (only) return only.id;
  return rows.some((row) => row.id === last) ? last : '';
}

/** A settled task as a card in the Assistant's chat window: the core's words about a committed state, never an Agent's. */
export interface ResultCard {
  result: AssistantResult;
  label: string;
  failed: boolean;
}

const RESULT_LABEL: Record<string, string> = { done: 'Finished', failed: 'Failed', review_required: 'Ready for review' };

/**
 * The core's settled tasks (`results` on the Assistant page: the last day, never the Coordinator's own Agents) that came after
 * the person last dismissed the cards, newest first. The filter lives in the core — the desktop reads the same projection — so
 * nothing here decides what counts as a result and no text is generated.
 */
export function resultCards(results: readonly AssistantResult[], seenAt: number, limit = 3): ResultCard[] {
  return results
    .filter((r) => r.at > seenAt)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((result) => ({ result, label: RESULT_LABEL[result.state] ?? result.state, failed: result.state === 'failed' }));
}

/** The pane a result's newest run lives in, only when its own Herdr session and pane id are in this phone's tree. */
export function openableResult(result: AssistantResult, workspaces: readonly TreeWorkspace[], instance: string): TreePane | null {
  if (!result.paneId || result.herdrSession !== instance) return null;
  return flattenPanes(workspaces).find((entry) => entry.pane.paneId === result.paneId)?.pane ?? null;
}

/** One line of counters; "Idle" when the core reports nothing, "Paused" when the Assistant is. */
export function assistantLine(row: AssistantOverviewRow): string {
  if (row.status !== 'active') return 'Paused'; // the core's word is "disabled"
  const parts: string[] = [];
  const asking = row.needsYou + row.approvals;
  if (asking > 0) parts.push(`${asking} ${asking === 1 ? 'needs' : 'need'} you`);
  if (row.running > 0) parts.push(`${row.running} running`);
  if (row.queued > 0) parts.push(`${row.queued} queued`);
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

/**
 * The chat window header's one word — the desktop page's own (`coordinatorStatus` in its AssistantsPage), so both ends name the same
 * state the same way. Paused beats everything; a pane carrying the chat is Ready or Working; without one the core's Coordinator state
 * speaks: none/stopped (asleep) are one word, because start and stop are not the person's business, and only a real problem names itself.
 */
export function conversationWord(input: { paused: boolean; launching: boolean; paneOpen: boolean; working: boolean; coordinatorState: string | undefined }): string {
  if (input.paused) return 'Paused';
  if (input.launching) return 'Waking up…';
  if (input.paneOpen) return input.working ? 'Working' : 'Ready';
  switch (input.coordinatorState) {
    case 'starting':
      return 'Waking up…';
    case 'ready':
      return 'Not in this window';
    case 'failed':
      return 'Could not start';
    case 'blocked':
      return 'Needs permission';
    case 'uncertain':
      return 'Check start';
    default:
      return 'Sleeping';
  }
}

/**
 * The Coordinator's pane when this phone may carry its chat in place: the core says `ready`, the pane is in this phone's tree
 * under the Coordinator's own Herdr session, and (where Chat is served) Herdr has named it an Agent — before that the route
 * would be a Terminal. Anything else is null: the window keeps showing history.
 */
export function adoptableCoordinatorPane(co: AssistantCoordinator, workspaces: readonly TreeWorkspace[], instance: string, chatServed: boolean): TreePane | null {
  const convo = conversationState(co, workspaces, instance);
  return convo.kind === 'open' && (convo.pane.agent || !chatServed) ? convo.pane : null;
}

/**
 * The Agent a Coordinator start names: the first one the desktop offers (its Settings → Agents toggles already filter the list),
 * exactly as the desktop's own start resolves it. null = none is offered — the desktop refuses that start, so the phone must
 * not hand the Host an empty choice (which the plugin would default to omp even with omp switched off).
 */
export function coordinatorStartAgent(agents: readonly { id: string }[]): string | null {
  return agents[0]?.id ?? null;
}

export const COORDINATOR_AGENT_UNAVAILABLE = 'No Agent is available for the Coordinator — turn it on in Settings → Agents on your Mac.';

/** What one look at a starting Coordinator needs: the core's row for it and this phone's tree. */
export interface CoordinatorSnapshot {
  coordinator: AssistantCoordinator;
  workspaces: readonly TreeWorkspace[];
}

/**
 * After a Coordinator start: look until its Herdr pane is addressable — in this phone's tree and (where Chat is served) named
 * as an Agent by Herdr, because before that the route would be a Terminal. A failed, stopped or unreachable Coordinator ends
 * the wait with the sentence the person reads; so does `timeoutMs` (the desktop gives a start 90 s). Reads are the caller's.
 */
export async function waitForCoordinatorPane(options: {
  read: () => Promise<CoordinatorSnapshot>;
  instance: string;
  chatServed: boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
  everyMs?: number;
}): Promise<TreePane> {
  const { read, instance, chatServed, sleep, now, timeoutMs = 90_000, everyMs = 1500 } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    const { coordinator, workspaces } = await read();
    const convo = conversationState(coordinator, workspaces, instance);
    if (convo.kind === 'open' && (convo.pane.agent || !chatServed)) return convo.pane;
    if (convo.kind === 'idle') throw new Error(convo.failed ? 'The Coordinator could not start on your Mac.' : 'The Coordinator stopped before it was ready.');
    if (convo.kind === 'elsewhere') throw new Error('The Coordinator runs somewhere this phone cannot reach. Restart it on your Mac.');
    if (now() >= deadline) throw new Error('The Coordinator is taking too long to start. Check your Mac.');
    await sleep(everyMs);
  }
}

/**
 * A just-started Coordinator's pane is an Agent before its TUI takes input (it boots, then works through its standing
 * brief). The Host refuses with `not_ready` / `busy` in that window and types nothing, so only those two refusals are
 * retried — every other failure (above all `delivery_uncertain`) ends the wait at once, so a message is never doubled.
 */
export async function sendWhenReady(options: {
  send: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
  everyMs?: number;
}): Promise<void> {
  const { send, sleep, now, timeoutMs = 90_000, everyMs = 1500 } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      return await send();
    } catch (failure) {
      const code = failure instanceof HostV3Error ? failure.code : undefined;
      if ((code !== 'not_ready' && code !== 'busy') || now() >= deadline) throw failure;
    }
    await sleep(everyMs);
  }
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

/**
 * Why a Group could not be archived / deleted. A `bad_state` refusal carries the core's own instruction (an Assistant's terminal
 * for the Group is still open, or one is still starting) — that sentence is the useful one; everything else is the generic wording.
 */
export function groupLifecycleMessage(error: unknown): string {
  if (error instanceof HostV3Error && error.code === 'bad_state' && error.message.trim() !== '') return error.message;
  return personalAgentMessage(error);
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
