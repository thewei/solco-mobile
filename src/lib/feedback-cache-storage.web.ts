// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadFeedbackCache(hostId)` / `saveFeedbackCache(hostId, cache)` / `forgetFeedbackCache(hostId)` — same contract as the native module.
// [POS]: Web/PWA twin of `feedback-cache-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { parseFeedbackCache, serializeFeedbackCache, type FeedbackCache } from '@/features/feedback/cache';

const key = (hostId: string) => `solco.feedbackCache.${hostId.slice(0, 64)}`;

export async function loadFeedbackCache(hostId: string): Promise<FeedbackCache | null> {
  try {
    return parseFeedbackCache(globalThis.localStorage?.getItem(key(hostId)));
  } catch {
    return null;
  }
}

export async function forgetFeedbackCache(hostId: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key(hostId));
  } catch {
    // nothing to remove
  }
}

export async function saveFeedbackCache(hostId: string, cache: FeedbackCache): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key(hostId), serializeFeedbackCache(cache));
  } catch {
    // private mode / quota: nothing to keep
  }
}
