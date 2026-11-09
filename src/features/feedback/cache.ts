// [INPUT]: the Host's Feedback snapshots (`FeedbackSnapshot`) as they are read, and the capabilities that gated the page.
// [OUTPUT]: `FeedbackCache` + `remember` (fold a live read in) / `replay` (the page's snapshot from the saved copy, marked
//           offline) / `parseFeedbackCache` / `serializeFeedbackCache`.
// [POS]: the phone's saved copy of the Feedback inbox (2026-11-09: a lost connection must not blank the page). Pure — the
//        file lives in `lib/feedback-cache-storage`. Holds what the Host already showed this phone (thread list, a few
//        opened timelines); attachment bytes never reach the phone, so none are kept.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: only a full read (no search query) replaces the saved list; a saved copy is never shown as live
//             (`replay` says offline and the page's write buttons stay off); every bound is a constant here.
import { z } from 'zod';

import { feedbackSnapshotSchema, feedbackThreadSchema, type FeedbackSnapshot } from '@/contracts/host-v3';

export const MAX_SAVED_THREADS = 200;
export const MAX_SAVED_DETAILS = 6;

const capsSchema = z.object({ manage: z.boolean(), context: z.boolean() });
export type FeedbackCaps = z.infer<typeof capsSchema>;

const cacheSchema = z.object({
  savedAt: z.number().int().nonnegative(),
  caps: capsSchema,
  snapshot: feedbackSnapshotSchema,
  /** Opened timelines, newest read last. */
  details: z.array(feedbackThreadSchema),
});
export type FeedbackCache = z.infer<typeof cacheSchema>;

/** Fold one live read into the saved copy. A broker-offline read or a query-filtered list changes nothing but the timeline it carries. */
export function remember(prev: FeedbackCache | null, snap: FeedbackSnapshot, query: string, caps: FeedbackCaps, now: number): FeedbackCache {
  const full = query.trim() === '' && snap.online;
  const base = prev?.snapshot ?? { online: true, threads: [], waiting: 0, selected: '' };
  const snapshot: FeedbackSnapshot = full
    ? { online: true, threads: snap.threads.slice(0, MAX_SAVED_THREADS), waiting: snap.waiting, selected: '', retentionDays: snap.retentionDays }
    : base;
  let details = prev?.details ?? [];
  if (snap.detail && snap.online) {
    details = [...details.filter((d) => d.id !== snap.detail!.id), snap.detail].slice(-MAX_SAVED_DETAILS);
  }
  return { savedAt: now, caps, snapshot, details };
}

/** The page's snapshot from the saved copy: always offline, with the timeline of `selected` when one was saved. */
export function replay(cache: FeedbackCache, selected: string): FeedbackSnapshot {
  const detail = cache.details.find((d) => d.id === selected);
  return { ...cache.snapshot, online: false, selected: detail ? selected : '', detail };
}

export function parseFeedbackCache(text: string | null | undefined): FeedbackCache | null {
  if (!text) return null;
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeFeedbackCache(cache: FeedbackCache): string {
  return JSON.stringify(cache);
}
