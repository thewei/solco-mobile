// [INPUT]: the paired Host client's three Feedback operations, the app's colour scheme, and an optional landing (a
//          notification tap or link naming a thread and an Ask).
// [OUTPUT]: `createFeedbackController` — answers the shared Feedback page's `feedback.*` bridge calls
//           (Snapshot/Answer/End/OpenProject), and `feedbackFailureText` (a Host refusal in the sentence the page shows).
// [POS]: the phone's counterpart of the desktop `FeedbackBridge` Go service (solco internal/nativeui/feedback_bridge.go),
//        minus "Open project" (a Mac action). The Host's `GET /feedback` already is the page's snapshot; this only adds the
//        page's theme, the one-shot landing and the phone's `canOpenGit: false`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: no IO of its own (operations are injected); the landing is handed out once, with the first snapshot that
//             actually arrives; a failed write changes nothing but the rejection the page shows.
import type { FeedbackAnswer, FeedbackAnswerRequest, FeedbackSnapshot } from '@/contracts/host-v3';

export interface FeedbackOps {
  snapshot(thread: string): Promise<FeedbackSnapshot>;
  answer(askId: string, request: FeedbackAnswerRequest): Promise<void>;
  end(askId: string): Promise<void>;
}

export interface FeedbackLanding {
  thread: string;
  ask: string;
}

/** What the Feedback page reads: the Host's snapshot plus its theme, the landing and what this client cannot do. */
export interface FeedbackPageView extends FeedbackSnapshot {
  theme: 'light' | 'dark';
  focus?: FeedbackLanding;
  canOpenGit: false;
}

/** The sentence the page shows for a refused write or a failed read. */
export function feedbackFailureText(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'feedback_final':
      return 'That question is already closed.';
    case 'feedback_not_found':
      return 'That question is no longer there.';
    case 'feedback_offline':
      return "The feedback service is not running on the Mac, so the Agent cannot receive this yet.";
    case 'feedback_unavailable':
      return 'This Mac does not serve Feedback.';
  }
  return error instanceof Error && error.message ? error.message : 'Something went wrong.';
}

export function createFeedbackController(ops: FeedbackOps, scheme: () => 'light' | 'dark', landing?: FeedbackLanding) {
  let pending = landing;
  return {
    async call(method: string, args: readonly unknown[]): Promise<unknown> {
      try {
        switch (method) {
          case 'feedback.Snapshot': {
            // A pending landing names the thread to read, whatever the page last had open.
            const selected = pending?.thread ?? (typeof args[0] === 'string' ? args[0] : '');
            const snapshot = await ops.snapshot(selected);
            const view: FeedbackPageView = { ...snapshot, theme: scheme(), canOpenGit: false };
            if (pending) {
              view.focus = pending;
              pending = undefined;
            }
            return view;
          }
          case 'feedback.Answer': {
            const [askId, answers, attachments] = args;
            if (typeof askId !== 'string' || typeof answers !== 'object' || answers === null) throw new Error('Bad request.');
            const request: FeedbackAnswerRequest = { answers: answers as Record<string, FeedbackAnswer> };
            if (Array.isArray(attachments) && attachments.length > 0) request.attachments = attachments as NonNullable<FeedbackAnswerRequest['attachments']>;
            await ops.answer(askId, request);
            return null;
          }
          case 'feedback.End': {
            if (typeof args[0] !== 'string') throw new Error('Bad request.');
            await ops.end(args[0]);
            return null;
          }
          case 'feedback.OpenProject':
            throw new Error('Open the project on the Mac.');
          default:
            throw new Error(`${method} is not available on the phone.`);
        }
      } catch (error) {
        throw new Error(feedbackFailureText(error));
      }
    },
  };
}
