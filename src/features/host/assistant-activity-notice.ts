// [INPUT]: Host's per-device notification Activity cursor and a native local notifier
// [OUTPUT]: one summarized, resumable Activity notice per Assistant per batch
// [POS]: OS delivery intent, independent from the person's "Mark seen" cursor.
// [PROTOCOL]: Update this header on changes, then check CLAUDE.md
import type { AssistantActivityPage, AssistantOverview, Fact } from '@/contracts/host-v3';
import type { NotificationRequest } from '@/features/host/attention-delivery';

export const ACTIVITY_NOTICE_PREFIX = 'solco-assistant-activity/';

export function assistantActivityNotice(id: string, facts: readonly Fact[]): NotificationRequest {
  const count = facts.length;
  const attention = facts.some((f) => ['blocked', 'held', 'ready', 'routine_failed'].includes(f.kind));
  // Never put a task name, prompt, assistant profile or evidence in a lock-screen notification.
  return {
    identifier: ACTIVITY_NOTICE_PREFIX + id,
    title: attention ? 'Solco · Assistant needs you' : 'Solco · Assistant activity',
    body: attention ? `${count} new update${count === 1 ? '' : 's'} · review needed` : `${count} new task update${count === 1 ? '' : 's'}`,
    data: { route: JSON.stringify({ pathname: '/assistants/activity/[id]', params: { id } }) },
  };
}

export interface AssistantActivityNoticeDeps {
  overview(): Promise<AssistantOverview>;
  unread(id: string): Promise<AssistantActivityPage>;
  ack(requestId: string, id: string, seq: number): Promise<number>;
  schedule(request: NotificationRequest): Promise<void>;
  /** The Mac's proactivity rules decide quiet hours, not a phone clock guess. */
  mayNotify?(id: string): Promise<boolean>;
  nextRequestId(): string;
  /** Prevent an obsolete Mac's in-flight page from notifying after a Host switch. */
  isCurrent(): boolean;
}

/**
 * Reading never ACKs. A successfully scheduled local notification advances
 * only the separate per-device notification cursor. A failed OS schedule
 * leaves that cursor unchanged. If the network drops after schedule, reuse
 * the same requestId/seq next poll without reposting this in-memory notice.
 *
 * A process crash between OS scheduling and Host ACK may replay a notice:
 * at-least-once is intentional, not a false exactly-once guarantee.
 */
export function createAssistantActivityNoticePump(deps: AssistantActivityNoticeDeps) {
  let polling = false;
  const posted = new Map<string, { seq: number; requestId: string }>();
  return {
    async poll(): Promise<void> {
      if (polling || !deps.isCurrent()) return;
      polling = true;
      try {
        const overview = await deps.overview();
        if (!deps.isCurrent()) return;
        for (const assistant of overview.assistants) {
          if (!deps.isCurrent()) break;
          try {
            const page = await deps.unread(assistant.id);
            if (!deps.isCurrent()) break;
            if (page.facts.length === 0 || page.nextSeq <= page.ackSeq) continue;
            if (deps.mayNotify && !(await deps.mayNotify(assistant.id))) continue;
            if (!deps.isCurrent()) break;
            const previous = posted.get(assistant.id);
            if (!previous || previous.seq !== page.nextSeq) {
              await deps.schedule(assistantActivityNotice(assistant.id, page.facts));
              if (!deps.isCurrent()) break;
              posted.set(assistant.id, { seq: page.nextSeq, requestId: deps.nextRequestId() });
            }
            const delivery = posted.get(assistant.id)!;
            const acknowledged = await deps.ack(delivery.requestId, assistant.id, delivery.seq);
            if (acknowledged >= delivery.seq) posted.delete(assistant.id);
          } catch {
            // A read failure, notification denial, or uncertain ACK leaves
            // the authoritative cursor unchanged. Other Assistants proceed.
          }
        }
      } catch {
        // Host offline: the next pass resumes after the stored watermark.
      } finally {
        polling = false;
      }
    },
  };
}
