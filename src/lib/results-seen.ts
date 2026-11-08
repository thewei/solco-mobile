// [INPUT]: the raw text a storage twin read back (anything, including nothing or garbage).
// [OUTPUT]: `ResultsSeen` (Assistant id → newest dismissed task-result time), `parseResultsSeen`, `serializeResultsSeen`.
// [POS]: pure codec between `state/results-store` and `results-seen-storage` (native file / web localStorage). A harmless UI watermark — opaque ids and epoch milliseconds, never a task title, a credential or anything sent to the Host.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: unreadable input is "nothing seen" (never throws); at most MAX_ASSISTANTS entries are kept, the newest watermarks first.
import { z } from 'zod';

export type ResultsSeen = Record<string, number>;

const MAX_ASSISTANTS = 32;

const seenSchema = z.record(z.string().min(1).max(64), z.number().int().nonnegative());

export function parseResultsSeen(raw: string | null | undefined): ResultsSeen {
  if (!raw) return {};
  try {
    const parsed = seenSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function serializeResultsSeen(seen: ResultsSeen): string {
  const newest = Object.entries(seen)
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_ASSISTANTS);
  return JSON.stringify(Object.fromEntries(newest));
}
