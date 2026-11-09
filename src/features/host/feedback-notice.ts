// [INPUT]: a `feedback` frame of the Host's events socket (kind ask|resolved, opaque thread/ask ids, the waiting count).
// [OUTPUT]: feedbackNotice(frame) → what the bridge does with it: raise the NotificationRequest, or dismiss the one an
//           answered/ended Ask left in the shade.
// [POS]: The phone's wording of "an Agent is waiting for your reply" (2026-11-09 decision: a phone notification never carries
//        the question). The frame holds ids and a count and nothing else, so the sentence is fixed — the project, the Agent
//        and the question stay on the Mac and in the Feedback screen. One identifier per Ask
//        (`solco-feedback/<thread>/<ask>`, the desktop's own id), so answering anywhere clears it. A tap opens
//        `/feedback` on that thread and Ask. Pure, tested.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { EventMessage } from '@/contracts/host-v3';

import type { NotificationRequest } from '@/features/host/attention-delivery';

export type FeedbackFrame = Extract<EventMessage, { t: 'feedback' }>;

export const FEEDBACK_NOTIFICATION_PREFIX = 'solco-feedback/';

export type FeedbackNoticeAction = { kind: 'show'; request: NotificationRequest } | { kind: 'dismiss'; identifier: string };

export function feedbackNotice(frame: FeedbackFrame): FeedbackNoticeAction {
  const identifier = `${FEEDBACK_NOTIFICATION_PREFIX}${frame.threadId}/${frame.askId}`;
  if (frame.kind === 'resolved') return { kind: 'dismiss', identifier };
  const route = JSON.stringify({ pathname: '/feedback', params: { thread: frame.threadId, ask: frame.askId } });
  return {
    kind: 'show',
    request: {
      identifier,
      title: 'An Agent is waiting for your reply',
      body: frame.waiting > 1 ? `${frame.waiting} questions are waiting.` : 'Open Feedback to answer.',
      data: { route, thread: frame.threadId, ask: frame.askId },
    },
  };
}
