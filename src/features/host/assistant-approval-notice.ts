// [INPUT]: the Mac's pending Assistant approvals (GET /personal-agent/approvals) and a native local notifier.
// [OUTPUT]: one notification per pending approval with inline Approve / Deny (`assistantApprovalNotice`), `parseAssistantApproval`
//           (the tap's decision, null for anything else) and `createAssistantApprovalNoticePump` (post once, withdraw once decided).
// [POS]: The phone's answer to "an Assistant is waiting for a yes" without opening the app. The body is one fixed sentence — the
//        action text, like the Assistant's name, task, brief and memory, never reaches the shade or the lock screen (user choice,
//        2026-11-07) — so the buttons answer a request the person already knows about; the tap on the body opens the chat, where the
//        approval card spells the exact action. The buttons echo the card's `actionHash`, so a yes can only apply to the action the
//        core still holds (it refuses a stale hash). A card that is decided elsewhere, expires or goes stale is withdrawn from the shade. Not the Activity
//        notice (`assistant-activity-notice.ts`): that one is a content-free summary with its own acknowledged cursor.
// [PROTOCOL]: Update this header on changes, then check CLAUDE.md
import type { AssistantApproval } from '@/contracts/host-v3';
import type { NotificationRequest } from '@/features/host/attention-delivery';

export const ASSISTANT_APPROVAL_CATEGORY = 'assistant-approval';
export const ASSISTANT_APPROVE_ACTION = 'assistant-approve';
export const ASSISTANT_DENY_ACTION = 'assistant-deny';
export const APPROVAL_NOTICE_PREFIX = 'solco-assistant-approval/';

/** What every approval notification says: the action itself stays out of it. */
export const APPROVAL_NOTICE_BODY = 'Tap to review what it asks, or answer here.';

/** The question as a notification: a fixed sentence and the buttons; tapping the body opens the Assistant's chat. */
export function assistantApprovalNotice(approval: AssistantApproval): NotificationRequest {
  return {
    identifier: APPROVAL_NOTICE_PREFIX + approval.id,
    title: 'Solco · Approval needed',
    body: APPROVAL_NOTICE_BODY,
    categoryIdentifier: ASSISTANT_APPROVAL_CATEGORY,
    data: {
      approval: { id: approval.id, actionHash: approval.actionHash },
      route: JSON.stringify({ pathname: '/assistants/[id]', params: { id: approval.assistantId } }),
    },
  };
}

export interface AssistantApprovalAnswer {
  approvalId: string;
  actionHash: string;
  approve: boolean;
}

/** Reads an Approve / Deny tap; a plain tap or a malformed payload is null. */
export function parseAssistantApproval(actionIdentifier: string, data: unknown): AssistantApprovalAnswer | null {
  if (actionIdentifier !== ASSISTANT_APPROVE_ACTION && actionIdentifier !== ASSISTANT_DENY_ACTION) return null;
  if (typeof data !== 'object' || data === null) return null;
  const { approval } = data as Record<string, unknown>;
  if (typeof approval !== 'object' || approval === null) return null;
  const { id, actionHash } = approval as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || typeof actionHash !== 'string' || actionHash.length !== 64) return null;
  return { approvalId: id, actionHash, approve: actionIdentifier === ASSISTANT_APPROVE_ACTION };
}

export interface AssistantApprovalNoticeDeps {
  approvals(): Promise<AssistantApproval[]>;
  schedule(request: NotificationRequest): Promise<void>;
  dismiss(identifier: string): Promise<void>;
  /** The Mac's proactivity rules decide quiet hours for that Assistant, not a phone clock guess. */
  mayNotify?(assistantId: string): Promise<boolean>;
  now(): number;
  /** Prevent an obsolete Mac's in-flight read from notifying after a Host switch. */
  isCurrent(): boolean;
}

/**
 * Posts each pending approval once (a re-poll never raises it again; a quiet-hours deferral or a failed OS schedule is simply
 * tried at the next poll) and withdraws the notification once the card is decided, expired or gone. Memory only: after a cold
 * start a still-pending card is posted once more under the same identifier, which replaces the earlier one.
 */
export function createAssistantApprovalNoticePump(deps: AssistantApprovalNoticeDeps) {
  let polling = false;
  const posted = new Map<string, string>(); // approval id → action hash it was posted for
  return {
    async poll(): Promise<void> {
      if (polling || !deps.isCurrent()) return;
      polling = true;
      try {
        const all = await deps.approvals();
        if (!deps.isCurrent()) return;
        const now = deps.now();
        const open = all.filter((a) => a.state === 'pending' && (a.expiresAt === 0 || a.expiresAt > now));
        const openIds = new Set(open.map((a) => a.id));
        for (const [id] of posted) {
          if (openIds.has(id)) continue;
          posted.delete(id);
          await deps.dismiss(APPROVAL_NOTICE_PREFIX + id).catch(() => undefined);
        }
        for (const approval of open) {
          if (!deps.isCurrent()) break;
          if (posted.get(approval.id) === approval.actionHash) continue;
          try {
            if (deps.mayNotify && !(await deps.mayNotify(approval.assistantId))) continue;
            if (!deps.isCurrent()) break;
            await deps.schedule(assistantApprovalNotice(approval));
            posted.set(approval.id, approval.actionHash);
          } catch {
            // Notifications denied or the Mac unreachable for this one: the next poll tries again.
          }
        }
      } catch {
        // Host offline: the next pass resumes.
      } finally {
        polling = false;
      }
    },
  };
}
