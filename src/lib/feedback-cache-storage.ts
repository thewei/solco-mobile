// [INPUT]: expo-file-system (the app's private document folder), imported lazily so nothing here needs a native module at test time.
// [OUTPUT]: `loadFeedbackCache(hostId)` / `saveFeedbackCache(hostId, cache)` — the Feedback inbox's saved copy per paired Mac, across app restarts.
// [POS]: native twin (`feedback-cache-storage.web.ts` is the browser one). Agent questions the Host already showed this phone, in the
//        app's private folder; not SecureStore (too large, not a credential).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every failure is swallowed (null = no copy; a lost copy only means an offline open shows nothing); nothing here is logged.
import { parseFeedbackCache, serializeFeedbackCache, type FeedbackCache } from '@/features/feedback/cache';

const fileName = (hostId: string) => `feedback-cache-${hostId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}.json`;

async function file(hostId: string) {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, fileName(hostId));
}

export async function loadFeedbackCache(hostId: string): Promise<FeedbackCache | null> {
  try {
    const f = await file(hostId);
    return f.exists ? parseFeedbackCache(await f.text()) : null;
  } catch {
    return null;
  }
}

export async function saveFeedbackCache(hostId: string, cache: FeedbackCache): Promise<void> {
  try {
    const f = await file(hostId);
    if (!f.exists) f.create();
    f.write(serializeFeedbackCache(cache));
  } catch {
    // keep going; the next read saves again
  }
}
