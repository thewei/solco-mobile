import { describe, expect, it } from 'vitest';

import { parseResultsSeen, serializeResultsSeen } from './results-seen';

describe('results-seen codec', () => {
  it('round-trips a watermark map', () => {
    expect(parseResultsSeen(serializeResultsSeen({ a_1: 1800000000000, a_2: 5 }))).toEqual({ a_1: 1800000000000, a_2: 5 });
  });

  it('reads nothing, garbage and the wrong shape as "nothing seen"', () => {
    for (const raw of [undefined, null, '', 'not json', '[]', '{"a":"x"}', '{"a":-1}', '{"a":1.5}']) {
      expect(parseResultsSeen(raw)).toEqual({});
    }
  });

  it('keeps only the 32 newest watermarks', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`a_${i}`, i + 1]));
    const kept = parseResultsSeen(serializeResultsSeen(many));
    expect(Object.keys(kept)).toHaveLength(32);
    expect(kept.a_39).toBe(40);
    expect(kept.a_7).toBeUndefined();
    expect(kept.a_8).toBe(9);
  });
});
