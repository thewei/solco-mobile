import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIceSource } from './ice-source';

const LIST = [{ urls: ['stun:a:3478'] }];

describe('ice source', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first connect on the LAN asks nothing of the caller but primes the cache', async () => {
    const ask = vi.fn(() => Promise.resolve(LIST));
    const src = createIceSource({ ask });
    expect(await src(0, false)).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(1);
    // the route is dead now, the ask would hang: the cached list answers at once
    ask.mockImplementation(() => new Promise(() => undefined));
    expect(await src(1, false)).toEqual(LIST);
  });

  it('a reconnect with no list waits for the ask, bounded', async () => {
    const src = createIceSource({ ask: () => new Promise(() => undefined), askMs: 1500 });
    const p = src(1, false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toEqual([]);
  });

  it('uses a fresh answer when there is no cache', async () => {
    expect(await createIceSource({ ask: () => Promise.resolve(LIST) })(1, true)).toEqual(LIST);
  });

  it('a rejected ask is a miss, not an error', async () => {
    expect(await createIceSource({ ask: () => Promise.reject(new Error('x')) })(1, true)).toEqual([]);
  });

  it('an old cache is not reused, a client-less ask is empty', async () => {
    let t = 0;
    const ask = vi.fn<() => Promise<typeof LIST> | null>(() => Promise.resolve(LIST));
    const src = createIceSource({ ask, now: () => t, ttlMs: 1000 });
    await src(0, false);
    t = 5000;
    ask.mockImplementation(() => new Promise(() => undefined));
    const p = src(1, false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toEqual([]);
    ask.mockImplementation(() => null);
    expect(await createIceSource({ ask })(1, true)).toEqual([]);
  });
});
