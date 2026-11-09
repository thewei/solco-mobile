import { describe, expect, it } from 'vitest';

import type { FeedbackSnapshot, FeedbackThread } from '@/contracts/host-v3';
import { MAX_SAVED_DETAILS, parseFeedbackCache, remember, replay, serializeFeedbackCache } from './cache';

const caps = { manage: true, context: false };
const thread = (id: string): FeedbackThread => ({ id, projectKey: 'k', project: 'p', title: id, createdAt: 1, lastAt: 2, waiting: 0 });
const snap = (over: Partial<FeedbackSnapshot> = {}): FeedbackSnapshot => ({
  online: true,
  waiting: 1,
  selected: '',
  threads: [{ id: 't1', project: 'p', title: 'one', lastAt: 2, waiting: 1, askCount: 1 }],
  ...over,
});

describe('feedback saved copy', () => {
  it('saves the full list and replays it as offline, with the timeline that was opened', () => {
    let c = remember(null, snap(), '', caps, 100);
    c = remember(c, snap({ selected: 't1', detail: thread('t1') }), '', caps, 200);
    const back = replay(c, 't1');
    expect(back.online).toBe(false);
    expect(back.threads).toHaveLength(1);
    expect(back.detail?.id).toBe('t1');
    expect(c.savedAt).toBe(200);
    // a timeline never opened is not invented
    expect(replay(c, 't9')).toMatchObject({ selected: '', detail: undefined });
  });

  it('keeps the list when a search or a broker-offline read comes in, and bounds the timelines', () => {
    let c = remember(null, snap(), '', caps, 1);
    c = remember(c, snap({ threads: [] }), 'needle', caps, 2);
    expect(c.snapshot.threads).toHaveLength(1);
    c = remember(c, snap({ online: false, threads: [] }), '', caps, 3);
    expect(c.snapshot.threads).toHaveLength(1);
    for (let i = 0; i < MAX_SAVED_DETAILS + 3; i++) c = remember(c, snap({ selected: `d${i}`, detail: thread(`d${i}`) }), '', caps, 10 + i);
    expect(c.details).toHaveLength(MAX_SAVED_DETAILS);
    expect(c.details.at(-1)?.id).toBe(`d${MAX_SAVED_DETAILS + 2}`);
  });

  it('round-trips through the file text and rejects damage', () => {
    const c = remember(null, snap({ selected: 't1', detail: thread('t1') }), '', caps, 5);
    expect(parseFeedbackCache(serializeFeedbackCache(c))).toEqual(c);
    expect(parseFeedbackCache('{"savedAt":"x"}')).toBeNull();
    expect(parseFeedbackCache('not json')).toBeNull();
    expect(parseFeedbackCache(null)).toBeNull();
  });
});
