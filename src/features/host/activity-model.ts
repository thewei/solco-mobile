// [INPUT]: Solco Activity pages arriving after reconnects or HTTP retries
// [OUTPUT]: stable fact-ID de-duplication and monotonic cursor advancement
// [POS]: UI-only replay projection; the Host/Plugin remain the activity authority
// [PROTOCOL]: Update this header on changes, then check CLAUDE.md
import type { Fact } from '@/contracts/host-v3';

export function mergeActivityFacts(previous: readonly Fact[], incoming: readonly Fact[]): Fact[] {
  const byId = new Map<string, Fact>();
  for (const fact of previous) byId.set(fact.id, fact);
  for (const fact of incoming) byId.set(fact.id, fact);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

// A lost connection can replay a page. Never move back across a previously
// confirmed sequence (an "old" GET may settle after a newer GET).
export function nextActivityCursor(previous: number, pageNext: number): number {
  return Math.max(previous, pageNext);
}
