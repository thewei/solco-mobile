import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForUsableOffer, type GatheringPeer } from './ice-gather';

const options = { timeoutMs: 6000, graceMs: 1500 };

function fakePeer(): GatheringPeer {
  return { iceGatheringState: 'gathering', onicecandidate: null, onicegatheringstatechange: null };
}

async function settled(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('waitForUsableOffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('settles a grace period after the first reflexive candidate, not at the ceiling', async () => {
    const pc = fakePeer();
    const wait = waitForUsableOffer(pc, options);
    pc.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.2 5000 typ host' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await settled(wait)).toBe(false); // a host candidate alone does not start the grace
    pc.onicecandidate?.({ candidate: { candidate: 'candidate:2 1 udp 1 1.2.3.4 5001 typ srflx raddr 0.0.0.0 rport 0' } });
    await vi.advanceTimersByTimeAsync(1499);
    expect(await settled(wait)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(wait)).toBe(true);
  });

  it('settles at once when gathering completes', async () => {
    const pc = fakePeer();
    const wait = waitForUsableOffer(pc, options);
    pc.onicecandidate?.({ candidate: null });
    expect(await settled(wait)).toBe(true);
  });

  it('settles on the gathering-state change to complete', async () => {
    const pc = fakePeer();
    const wait = waitForUsableOffer(pc, options);
    pc.iceGatheringState = 'complete';
    pc.onicegatheringstatechange?.();
    expect(await settled(wait)).toBe(true);
  });

  it('still bounds the wait when no reflexive candidate ever shows up', async () => {
    const pc = fakePeer();
    const wait = waitForUsableOffer(pc, options);
    await vi.advanceTimersByTimeAsync(5999);
    expect(await settled(wait)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(wait)).toBe(true);
  });
});
