// [INPUT]: the paired Host client's Feedback operations (and, when the Host offers them, the inbox management ones), the app's colour scheme, and an optional landing (a
//          notification tap or link naming a thread and an Ask).
// [OUTPUT]: `createFeedbackController` — answers the shared Feedback page's `feedback.*` bridge calls
//           (Snapshot/Answer[+context refs]/PickContext/End/DeleteThreads/Cleanup/SetRetention/OpenProject), and `feedbackFailureText` (a Host refusal in the sentence the page shows).
// [POS]: the phone's counterpart of the desktop `FeedbackBridge` Go service (solco internal/nativeui/feedback_bridge.go),
//        minus "Open project" (a Mac action). The Host's `GET /feedback` already is the page's snapshot; this only adds the
//        page's theme, the one-shot landing and the phone's `canOpenGit: false`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: no IO of its own (operations are injected); the landing is handed out once, with the first snapshot that
//             actually arrives; a failed write changes nothing but the rejection the page shows.
import { remember, replay, type FeedbackCache, type FeedbackCaps } from '@/features/feedback/cache';
import { feedbackContextRefSchema, type FeedbackAnswer, type FeedbackAnswerRequest, type FeedbackPick, type FeedbackSnapshot } from '@/contracts/host-v3';

export interface FeedbackOps {
  snapshot(thread: string, query: string): Promise<FeedbackSnapshot>;
  answer(askId: string, request: FeedbackAnswerRequest): Promise<void>;
  end(askId: string): Promise<void>;
  /** The answer form's file / Skill picker; present only when the Host advertises `capabilities.feedbackContext`. */
  pick?(thread: string, kind: 'files' | 'skills', query: string): Promise<FeedbackPick['items']>;
  /** Present only when the Host advertises `capabilities.feedbackManage`; without it the page hides every management control. */
  manage?: {
    deleteThreads(ids: string[]): Promise<number>;
    cleanup(days: number, dryRun: boolean): Promise<number>;
    setRetention(days: number): Promise<void>;
  };
}

/** The saved copy of the inbox (IO injected): what the page shows while the Host cannot be reached. */
export interface FeedbackStore {
  load(): Promise<FeedbackCache | null>;
  save(cache: FeedbackCache): void;
  caps: FeedbackCaps;
  now?: () => number;
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
  canManage: boolean;
  canPick: boolean;
  /** Unix ms of the saved copy this read comes from: the Host could not be reached. Absent = live. */
  stale?: number;
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

/** A copy is written at most this often while reads keep succeeding. */
const SAVE_EVERY_MS = 4_000;

export function createFeedbackController(ops: FeedbackOps, scheme: () => 'light' | 'dark', landing?: FeedbackLanding, saved?: FeedbackStore) {
  let pending = landing;
  const now = saved?.now ?? Date.now;
  let copy: FeedbackCache | null = null;
  const copyLoaded = saved ? saved.load().then((c) => { copy ??= c; }) : Promise.resolve();
  let lastSave = -Infinity;
  const read = async (selected: string, query: string): Promise<{ snapshot: FeedbackSnapshot; stale?: number }> => {
    try {
      const snapshot = await ops.snapshot(selected, query);
      if (saved) {
        copy = remember(copy, snapshot, query, saved.caps, now());
        if (now() - lastSave >= SAVE_EVERY_MS) {
          lastSave = now();
          saved.save(copy);
        }
      }
      return { snapshot };
    } catch (error) {
      await copyLoaded;
      // A refusal the Host stated (unauthorized, not found, …) is shown as it is; only an unreachable Host falls back.
      if (!copy || (typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string')) throw error;
      return { snapshot: replay(copy, selected), stale: copy.savedAt };
    }
  };
  return {
    async call(method: string, args: readonly unknown[]): Promise<unknown> {
      try {
        switch (method) {
          case 'feedback.Snapshot': {
            // A pending landing names the thread to read, whatever the page last had open.
            const selected = pending?.thread ?? (typeof args[0] === 'string' ? args[0] : '');
            const query = pending ? '' : typeof args[1] === 'string' ? args[1].trim() : '';
            const { snapshot, stale } = await read(selected, query);
            const view: FeedbackPageView = { ...snapshot, theme: scheme(), canOpenGit: false, canManage: !!ops.manage, canPick: !!ops.pick };
            if (stale) {
              view.stale = stale;
              return view; // the landing stays pending until a live read can honour it
            }
            if (pending) {
              view.focus = pending;
              pending = undefined;
            }
            return view;
          }
          case 'feedback.Answer': {
            const [askId, answers, attachments, context] = args;
            if (typeof askId !== 'string' || typeof answers !== 'object' || answers === null) throw new Error('Bad request.');
            const request: FeedbackAnswerRequest = { answers: answers as Record<string, FeedbackAnswer> };
            if (Array.isArray(attachments) && attachments.length > 0) request.attachments = attachments as NonNullable<FeedbackAnswerRequest['attachments']>;
            if (Array.isArray(context) && context.length > 0) {
              const refs = context.map((ref) => feedbackContextRefSchema.safeParse({ kind: (ref as { kind?: unknown })?.kind, name: (ref as { name?: unknown })?.name }));
              if (refs.some((r) => !r.success)) throw new Error('Bad request.');
              request.context = refs.flatMap((r) => (r.success ? [r.data] : []));
            }
            await ops.answer(askId, request);
            return null;
          }
          case 'feedback.End': {
            if (typeof args[0] !== 'string') throw new Error('Bad request.');
            await ops.end(args[0]);
            return null;
          }
          case 'feedback.PickContext': {
            const [thread, kind, query] = args;
            if (!ops.pick) throw new Error('This Mac does not offer the file picker to the phone.');
            if (typeof thread !== 'string' || (kind !== 'files' && kind !== 'skills') || typeof query !== 'string') throw new Error('Bad request.');
            return ops.pick(thread, kind, query);
          }
          case 'feedback.DeleteThreads': {
            const ids = args[0];
            if (!ops.manage) throw new Error('This Mac does not manage Feedback from the phone.');
            if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) throw new Error('Bad request.');
            return ops.manage.deleteThreads(ids as string[]);
          }
          case 'feedback.Cleanup': {
            const [days, dryRun] = args;
            if (!ops.manage) throw new Error('This Mac does not manage Feedback from the phone.');
            if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) throw new Error('Bad request.');
            return ops.manage.cleanup(days, dryRun === true);
          }
          case 'feedback.SetRetention': {
            const days = args[0];
            if (!ops.manage) throw new Error('This Mac does not manage Feedback from the phone.');
            if (typeof days !== 'number' || !Number.isInteger(days) || days < 0) throw new Error('Bad request.');
            await ops.manage.setRetention(days);
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
