import { describe, expect, it } from 'vitest';

import type { Fact } from '@/contracts/host-v3';
import { mergeActivityFacts, nextActivityCursor } from '@/features/host/activity-model';

const f = (seq: number, id = 'f_' + String(seq)): Fact => ({
  seq, id, assistantId: 'a_1', kind: 'task_added', text: String(seq), createdAt: 1000 + seq,
});

describe('Assistant Activity replay', () => {
  it('deduplicates retry pages by stable fact ID and preserves oldest-first order', () => {
    const first = mergeActivityFacts([], [f(4), f(7)]);
    expect(mergeActivityFacts(first, [f(7), f(11), f(9)])).toEqual([f(4), f(7), f(9), f(11)]);
    expect(mergeActivityFacts([f(4)], [f(4, 'f_updated')])).toHaveLength(2);
  });

  it('cannot rewind an ACK-safe polling cursor', () => {
    expect(nextActivityCursor(17, 11)).toBe(17);
    expect(nextActivityCursor(17, 21)).toBe(21);
  });
});
