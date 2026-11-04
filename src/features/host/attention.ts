// [INPUT]: v3 tree DTOs and the per-agent previous runtime phases keyed by the desktop's stable
//          notification identity (instance/terminal).
// [OUTPUT]: phaseOf (Herdr agent_status → runtime phase), identityOf, classifyTree(previous,
//           workspaces, instance) → { events, dismissIds, next }.
// [POS]: Faithful port of the Host's desktop notification rules (solco internal/agent: workbench.go
//        ClassifyTransition + notifications.go NotificationFor). Only three transitions notify —
//        working→blocked, working/blocked→done, working→idle; first observation, same-status echoes,
//        started-working, review-cleared and failed never do. The ledger keys mirror the desktop's
//        stable ID, so one agent's notification replaces itself instead of stacking. Also the inline
//        Reply contract (REPLY_CATEGORY, isReplyable, parseReply) and the inline Approve/Deny contract
//        (APPROVE_CATEGORY, approvalOf, parseApproval). Pure, tested.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { ChatAnswerRequest, ChatInteraction, TreeWorkspace } from '@/contracts/host-v3';

import { flattenPanes, paneTitle, type FlatPane } from '@/features/host/pane-model';

/** The desktop's runtime phases; Herdr's own agent_status words map onto them. */
export type Phase = 'unknown' | 'working' | 'blocked' | 'done' | 'idle' | 'failed';

export function phaseOf(status: string | undefined): Phase {
  switch (status) {
    case 'working':
    case 'pending':
    case 'running':
    case 'launch_pending':
    case 'launch-pending':
      return 'working';
    case 'blocked':
    case 'needs_attention':
    case 'needs-attention':
      return 'blocked';
    case 'done':
    case 'completed':
      return 'done';
    case 'idle':
      return 'idle';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return 'unknown';
  }
}

/** The desktop's stable per-agent notification identity (nativeui/agent_notifications.go). */
export function identityOf(instance: string, terminalId: string): string {
  return `solco-agent/${instance}/${terminalId}`;
}

export type AttentionKind = 'needs-attention' | 'ready-for-review' | 'ready';

const NOTIFICATION_BODY: Record<AttentionKind, string> = {
  'needs-attention': 'Needs attention',
  'ready-for-review': 'Finished — ready for review',
  ready: 'Ready',
};

/** ClassifyTransition ported: unknown previous = first observation, identical phases = echo; only
 *  working→blocked, working/blocked→done and working→idle classify at all (failed never notifies). */
function transitionOf(previous: Phase, next: Phase): AttentionKind | null {
  if (previous === 'unknown' || previous === next) return null;
  if (next === 'blocked') return previous === 'working' ? 'needs-attention' : null;
  if (next === 'done') return previous === 'working' || previous === 'blocked' ? 'ready-for-review' : null;
  if (next === 'idle') return previous === 'working' ? 'ready' : null;
  return null;
}

export interface AttentionEvent {
  pane: FlatPane;
  kind: AttentionKind;
  /** Desktop vocabulary, verbatim (notifications.go): the notification body, and the title's tail. */
  title: string;
  body: string;
  identity: string;
}

// Versioned id: Android resurrects a deleted channel when the same id is re-created, so a config
// change (silent LOW → heads-up HIGH) must ship under a new id, not re-create the old one.
export const ATTENTION_CHANNEL = 'attention-3';

/** Notification category carrying the inline Reply action (text input, never opens the app). */
export const REPLY_CATEGORY = 'agent-reply';
export const REPLY_ACTION = 'reply';

/** Only an agent that stopped (ready / ready-for-review) can take a typed follow-up: a blocked one
 *  waits on its card, whose answer needs the interaction id only the open Chat holds. */
export function isReplyable(kind: AttentionKind): boolean {
  return kind !== 'needs-attention';
}

export interface ReplyRequest {
  instance: string;
  paneId: string;
  text: string;
}

/** Reads the inline Reply response; anything else (a tap, an empty reply, a malformed payload) is null. */
export function parseReply(actionIdentifier: string, userText: string | null | undefined, data: unknown): ReplyRequest | null {
  if (actionIdentifier !== REPLY_ACTION) return null;
  const text = (userText ?? '').trim();
  if (text === '' || typeof data !== 'object' || data === null) return null;
  const { instance, paneId } = data as Record<string, unknown>;
  if (typeof instance !== 'string' || typeof paneId !== 'string' || instance === '' || paneId === '') return null;
  return { instance, paneId, text };
}

/** Notification category carrying the inline Approve / Deny actions of a blocked agent's permission card. */
export const APPROVE_CATEGORY = 'agent-approve';
export const APPROVE_ACTION = 'approve';
export const DENY_ACTION = 'deny';

/** The card's own rows that grant or refuse once — never a row that persists a choice. */
export interface Approval {
  interactionId: string;
  approve: string;
  deny: string;
}

// A row that saves the choice ("don't ask again", "all edits this session", an allowlist, Run Everything)
// is never one a notification button may pick: the phone only ever grants or refuses the one prompt.
const PERSISTENT_ROW = /always|don'?t ask|do not ask|never|\ball\b|everything|session|allowlist|persist|settings|remember/i;
const AFFIRM_ROW = /^(yes|run once|allow once|approve|allow|proceed)\b/i;
const DENY_ROW = /^(no|skip|deny|reject|cancel)\b/i;

/**
 * The Approve/Deny pair of a permission card, from its own option text; null when the card is anything
 * else or either side cannot be told apart with certainty (then the notification only opens the Chat).
 * A Deny that needs typed text (Claude's "No, and tell Claude…") is not a button.
 */
export function approvalOf(card: ChatInteraction | undefined): Approval | null {
  if (!card || card.kind !== 'permission' || card.multi) return null;
  const typed = new Set(card.textOptions ?? []);
  const approve = card.options.find((option) => !typed.has(option) && AFFIRM_ROW.test(option) && !PERSISTENT_ROW.test(option));
  const deny = card.options.find((option) => !typed.has(option) && DENY_ROW.test(option) && !PERSISTENT_ROW.test(option));
  return approve && deny ? { interactionId: card.id, approve, deny } : null;
}

export interface ApprovalAnswer {
  instance: string;
  paneId: string;
  request: ChatAnswerRequest;
}

/** Reads an Approve / Deny tap; anything else (a plain tap, a malformed payload) is null. */
export function parseApproval(actionIdentifier: string, data: unknown): ApprovalAnswer | null {
  if (actionIdentifier !== APPROVE_ACTION && actionIdentifier !== DENY_ACTION) return null;
  if (typeof data !== 'object' || data === null) return null;
  const { instance, paneId, approval } = data as Record<string, unknown>;
  if (typeof instance !== 'string' || typeof paneId !== 'string' || instance === '' || paneId === '') return null;
  if (typeof approval !== 'object' || approval === null) return null;
  const { interactionId, approve, deny } = approval as Record<string, unknown>;
  const option = actionIdentifier === APPROVE_ACTION ? approve : deny;
  if (typeof interactionId !== 'string' || interactionId === '' || typeof option !== 'string' || option === '') return null;
  return { instance, paneId, request: { interactionId, option } };
}

export interface AttentionDiff {
  events: AttentionEvent[];
  /** Identities whose pane vanished from the tree — their notifications, if any, are withdrawn. */
  dismissIds: string[];
  next: Map<string, Phase>;
}

export function classifyTree(previous: ReadonlyMap<string, Phase>, workspaces: readonly TreeWorkspace[], instance: string): AttentionDiff {
  const next = new Map<string, Phase>();
  const events: AttentionEvent[] = [];
  const live = new Set<string>();
  for (const pane of flattenPanes(workspaces)) {
    const identity = identityOf(instance, pane.pane.terminalId);
    live.add(identity);
    const phase = phaseOf(pane.pane.agent?.status);
    next.set(identity, phase);
    const kind = transitionOf(previous.get(identity) ?? 'unknown', phase);
    if (!kind) continue;
    const body = NOTIFICATION_BODY[kind];
    events.push({ pane, kind, identity, body, title: `${paneTitle(pane.pane)} — ${body}` });
  }
  const dismissIds = [...previous.keys()].filter((identity) => !live.has(identity));
  return { events, dismissIds, next };
}
