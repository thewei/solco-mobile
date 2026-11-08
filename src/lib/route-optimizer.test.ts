import { describe, expect, it } from 'vitest';

import { describeRouteChange, nextP2PDelayMs, p2pAfterTrouble, p2pBeatsRelay, P2P_SLACK_MS, P2P_STABLE_MS, withTimeout } from '@/lib/route-optimizer';

describe('nextP2PDelayMs', () => {
  it('starts at 15 s, doubles, caps at 5 min', () => {
    expect([0, 1, 2, 4, 10].map(nextP2PDelayMs)).toEqual([15_000, 30_000, 60_000, 240_000, 300_000]);
  });
});

describe('p2pBeatsRelay', () => {
  it('keeps a link that is as fast as the relay within the slack, drops a slower one', () => {
    expect(p2pBeatsRelay(40, 120)).toBe(true);
    expect(p2pBeatsRelay(150, 120)).toBe(true);
    expect(p2pBeatsRelay(120 + P2P_SLACK_MS, 120)).toBe(true);
    expect(p2pBeatsRelay(120 + P2P_SLACK_MS + 1, 120)).toBe(false);
  });
});

describe('p2pAfterTrouble', () => {
  it('doubles the wait on every early death and forgives a link that held', () => {
    const first = p2pAfterTrouble(0, 14_000);
    expect(first).toEqual({ deaths: 1, holdMs: 15_000 });
    const second = p2pAfterTrouble(first.deaths, 14_000);
    expect(second).toEqual({ deaths: 2, holdMs: 30_000 });
    expect(p2pAfterTrouble(second.deaths, 20_000).holdMs).toBe(60_000);
    expect(p2pAfterTrouble(second.deaths, P2P_STABLE_MS)).toEqual({ deaths: 0, holdMs: 0 });
  });
  it('is capped like every other P2P wait', () => {
    expect(p2pAfterTrouble(40, 1_000).holdMs).toBe(300_000);
  });
});

describe('describeRouteChange', () => {
  const lan = { route: 'direct' as const, via: 'LAN', address: '192.168.0.59' };
  const relay = { route: 'relay' as const };
  it('says what changed, with latency when known', () => {
    expect(describeRouteChange(relay, lan, 12.4)).toBe('Back on LAN (192.168.0.59) · 12 ms');
    expect(describeRouteChange(lan, relay)).toBe('Direct path unavailable — now using the relay');
    expect(describeRouteChange(lan, { route: 'p2p' })).toBe('Switched to P2P');
    expect(describeRouteChange(relay, { route: 'p2p' }, 40)).toBe('Back on P2P · 40 ms');
    expect(describeRouteChange(lan, { ...lan, address: '100.64.0.2', via: 'Tailscale' })).toBe('Switched to Tailscale (100.64.0.2)');
  });
  it('is silent when nothing changed', () => {
    expect(describeRouteChange(lan, lan)).toBeNull();
    expect(describeRouteChange(relay, relay)).toBeNull();
  });
});

describe('withTimeout', () => {
  it('passes a result through and rejects a stall', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toThrow('timed out');
  });
});
