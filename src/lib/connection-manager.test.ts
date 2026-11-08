import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chooseRoute,
  createConnectionManager,
  raceRoutes,
  MIN_GAP_MS,
  NETWORK_DEBOUNCE_MS,
  PROBE_TIMEOUT_MS,
  RELAY_PROBE_TIMEOUT_MS,
  UPGRADE_FIRST_MS,
  type Decision,
  type DirectAddress,
  type ManagerView,
  type Reason,
  type RouteKind,
} from '@/lib/connection-manager';

const clock = { now: () => Date.now(), setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** A probe's behaviour: answers after n ms, fails fast, or hangs until the probe timeout. */
type Behaviour = number | 'fail' | 'hang';
const answer = (behaviour: Behaviour, timeoutMs = PROBE_TIMEOUT_MS) =>
  new Promise<void>((resolve, reject) => {
    if (behaviour === 'fail') setTimeout(() => reject(new Error('refused')), 80);
    else if (behaviour === 'hang') setTimeout(() => reject(new Error('timed out')), timeoutMs);
    else setTimeout(resolve, behaviour);
  });

const ADDRESS: DirectAddress = { host: '192.168.1.5', port: 8756 };

function setup(initial: { route?: RouteKind; direct?: Behaviour; relay?: Behaviour; tailcat?: Behaviour; addresses?: DirectAddress[]; hasRelay?: boolean; hasTailcat?: boolean } = {}) {
  const state = { route: initial.route ?? 'relay', direct: initial.direct ?? 20, relay: initial.relay ?? 150, tailcat: initial.tailcat ?? 150 };
  const addresses = initial.addresses ?? [ADDRESS];
  const view = (): ManagerView => ({ id: 'mac', route: state.route, direct: addresses, hasRelay: initial.hasRelay ?? true, hasTailcat: initial.hasTailcat ?? false });
  const applied: { decision: Decision; reason: Reason; from: RouteKind; took: number }[] = [];
  const refreshed: true[] = [];
  let races = 0;
  const timeouts = { relay: 0, tailcat: 0 };
  const manager = createConnectionManager({
    ...clock,
    view,
    probeDirect: (_address, timeoutMs) => {
      races += 1;
      return answer(state.direct, timeoutMs);
    },
    probeRelay: (timeoutMs) => {
      timeouts.relay = timeoutMs;
      return answer(state.relay, timeoutMs);
    },
    probeTailcat: (timeoutMs) => {
      timeouts.tailcat = timeoutMs;
      return answer(state.tailcat, timeoutMs);
    },
    apply: async (_id, decision, context) => {
      applied.push({ decision, ...context });
      const changed = decision.route !== state.route;
      state.route = decision.route;
      return changed;
    },
    refresh: () => refreshed.push(true),
  });
  return { manager, state, applied, refreshed, races: () => races, timeouts };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('chooseRoute', () => {
  it('prefers a direct route unless it is clearly slower than the relay', () => {
    const direct = { address: ADDRESS, rtt: 100 };
    expect(chooseRoute(direct, { rtt: 90 })).toEqual({ route: 'direct', address: ADDRESS });
    expect(chooseRoute({ ...direct, rtt: 175 }, { rtt: 90 })).toEqual({ route: 'direct', address: ADDRESS }); // ≤ 90×1.5+40
    expect(chooseRoute({ ...direct, rtt: 900 }, { rtt: 100 })).toEqual({ route: 'relay' });
  });

  it('takes whichever answered, and nothing when neither did', () => {
    expect(chooseRoute({ address: ADDRESS, rtt: 400 }, null)).toEqual({ route: 'direct', address: ADDRESS });
    expect(chooseRoute(null, { rtt: 400 })).toEqual({ route: 'relay' });
    expect(chooseRoute(null, null)).toBeNull();
  });

  it('decides the fallback by speed: the relay and the tunnel rank only by their answer', () => {
    expect(chooseRoute(null, null, { rtt: 300 })).toEqual({ route: 'tailcat' });
    expect(chooseRoute({ address: ADDRESS, rtt: 90 }, null, { rtt: 300 })).toEqual({ route: 'direct', address: ADDRESS });
    expect(chooseRoute({ address: ADDRESS, rtt: 900 }, null, { rtt: 300 })).toEqual({ route: 'tailcat' });
    expect(chooseRoute(null, { rtt: 100 }, { rtt: 250 })).toEqual({ route: 'relay' });
    expect(chooseRoute(null, { rtt: 400 }, { rtt: 250 })).toEqual({ route: 'tailcat' });
    expect(chooseRoute(null, { rtt: 250 }, { rtt: 250 })).toEqual({ route: 'relay' }); // a tie serves the relay
  });
});

describe('raceRoutes', () => {
  const probe = (kind: RouteKind, behaviour: Behaviour) => ({ kind, address: kind === 'direct' ? ADDRESS : undefined, run: () => answer(behaviour) });

  it('settles at once on a quick direct answer, without waiting for the relay', async () => {
    const result = raceRoutes([probe('direct', 30), probe('relay', 400)], clock);
    await vi.advanceTimersByTimeAsync(30);
    const settled = await result;
    expect(settled.direct?.rtt).toBe(30);
    expect(settled.relay).toBeNull();
    expect(settled.took).toBe(30);
  });

  it('holds a relay answer for a short window so a direct one that is a moment behind still wins', async () => {
    const result = raceRoutes([probe('relay', 120), probe('direct', 200)], clock);
    await vi.advanceTimersByTimeAsync(400);
    const settled = await result;
    expect(settled.relay?.rtt).toBe(120);
    expect(settled.direct?.rtt).toBe(200);
    expect(chooseRoute(settled.direct, settled.relay)).toEqual({ route: 'direct', address: ADDRESS });
  });

  it('gives up on a hung direct address after the relay window, not after the probe timeout', async () => {
    const result = raceRoutes([probe('relay', 150), probe('direct', 'hang')], clock);
    await vi.advanceTimersByTimeAsync(450);
    const settled = await result;
    expect(settled.direct).toBeNull();
    expect(settled.relay?.rtt).toBe(150);
    expect(settled.took).toBeLessThan(500);
  });

  it('settles empty when every probe fails', async () => {
    const result = raceRoutes([probe('direct', 'fail'), probe('relay', 'fail')], clock);
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ direct: null, relay: null });
  });
});

describe('a network change', () => {
  it('upgrades from the relay to a direct path within a debounce and one quick probe', async () => {
    const t = setup({ route: 'relay', direct: 30, relay: 150 });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS - 1);
    expect(t.applied).toHaveLength(0); // still debouncing
    await vi.advanceTimersByTimeAsync(40);
    expect(t.applied).toHaveLength(1);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'direct', address: ADDRESS }, reason: 'network', from: 'relay' });
  });

  it('hands a dead-slow tunnel over to a faster relay', async () => {
    const t = setup({ route: 'tailcat', direct: 'fail', relay: 120, tailcat: 400, hasTailcat: true });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 600);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'relay' }, reason: 'network', from: 'tailcat' });
  });

  it('hands a slow relay over to a faster tunnel', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 400, tailcat: 120, hasTailcat: true });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 600);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'tailcat' }, reason: 'network', from: 'relay' });
  });

  it('gives the relay probe the desktop-matched 8 s headroom', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 'fail' });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 100);
    expect(t.timeouts.relay).toBe(RELAY_PROBE_TIMEOUT_MS);
  });

  it('folds a burst of network events into one race', async () => {
    const t = setup({ route: 'relay', direct: 30 });
    for (let i = 0; i < 5; i += 1) {
      t.manager.signal({ t: 'network' });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 100);
    expect(t.races()).toBe(1);
  });

  it('falls back from a dead direct route to the relay in about a second, not the probe timeout', async () => {
    const t = setup({ route: 'direct', direct: 'hang', relay: 150 });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 150 + 800);
    expect(t.applied).toHaveLength(1);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'relay' }, reason: 'network', from: 'direct' });
    expect(t.applied[0]!.took).toBeLessThan(1_000);
  });

  it('rebuilds the sockets when the route stays the same', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 100 });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 600);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'relay' } });
    expect(t.refreshed).toEqual([true]);
  });

  it('rebuilds on any trouble that leaves the route unchanged, not only on a network change', async () => {
    // A silent events socket (`failure`) or a returning app is exactly how a half-open P2P channel shows up; the provider leaves P2P on every refresh.
    const failure = setup({ route: 'relay', direct: 'fail', relay: 100 });
    failure.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS + 600);
    expect(failure.refreshed).toEqual([true]);

    const foreground = setup({ route: 'relay', direct: 'fail', relay: 100 });
    foreground.manager.signal({ t: 'background' });
    await vi.advanceTimersByTimeAsync(6_000);
    foreground.manager.signal({ t: 'foreground' });
    await vi.advanceTimersByTimeAsync(600);
    expect(foreground.refreshed).toEqual([true]);
  });

  it('does not refresh when the route changed (the client is rebuilt by the new connection)', async () => {
    const t = setup({ route: 'relay', direct: 20 });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 100);
    expect(t.refreshed).toEqual([]);
  });
});

describe('trouble signals', () => {
  it('races at once on a failure and folds repeated failures into one race', async () => {
    const t = setup({ route: 'direct', direct: 'fail', relay: 100 });
    for (let i = 0; i < 4; i += 1) t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(600);
    expect(t.applied).toHaveLength(1);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'relay' }, reason: 'failure' });
  });

  it('spaces two failure-driven races by the minimum gap instead of dropping the second', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 100 });
    t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(300); // first race done at ~100 ms
    expect(t.applied).toHaveLength(1);
    t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(300);
    expect(t.applied).toHaveLength(1); // held back by the gap
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(t.applied).toHaveLength(2);
  });

  it('folds a failure that arrives mid-race into one follow-up race', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 400 });
    t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(100);
    t.manager.signal({ t: 'failure' });
    t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS + 1_500);
    expect(t.applied).toHaveLength(2);
  });
});

describe('nothing answers', () => {
  it('retries quickly at first, then backs off, and stops once something answers', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 'fail' });
    t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(100); // race 1 fails
    expect(t.races()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000 + 100); // retry after 1 s
    expect(t.races()).toBe(2);
    await vi.advanceTimersByTimeAsync(2_000 + 100); // then 2 s
    expect(t.races()).toBe(3);
    t.state.relay = 100;
    await vi.advanceTimersByTimeAsync(4_000 + 300); // then 4 s — and now the relay answers
    expect(t.applied.at(-1)).toMatchObject({ decision: { route: 'relay' }, reason: 'retry' });
    const before = t.races();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(t.races()).toBe(before); // settled: no further retry (only the upgrade ladder looks later)
  });

  it('is told by an alive signal to stop retrying', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 'fail' });
    t.manager.signal({ t: 'failure' });
    await vi.advanceTimersByTimeAsync(100);
    t.manager.signal({ t: 'alive' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.races()).toBe(1);
  });
});

describe('looking for a faster path while on the relay', () => {
  it('first looks soon after the app starts on the relay, then on a widening ladder', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 100 });
    t.manager.reset();
    await vi.advanceTimersByTimeAsync(UPGRADE_FIRST_MS - 1);
    expect(t.races()).toBe(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(t.races()).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000 + 700);
    expect(t.races()).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000 + 700);
    expect(t.races()).toBe(3);
  });

  it('moves to the direct path on the first win (no second confirming probe) when it is not slower', async () => {
    const t = setup({ route: 'relay', direct: 40, relay: 180 });
    t.manager.reset();
    await vi.advanceTimersByTimeAsync(UPGRADE_FIRST_MS + 200);
    expect(t.applied).toHaveLength(1);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'direct' }, reason: 'upgrade' });
  });

  it('stays on the relay when the direct path answers but is much slower', async () => {
    const t = setup({ route: 'relay', direct: 900, relay: 100 });
    t.manager.reset();
    await vi.advanceTimersByTimeAsync(UPGRADE_FIRST_MS + 1_200);
    expect(t.applied[0]).toMatchObject({ decision: { route: 'relay' } });
    expect(t.refreshed).toEqual([]); // an upgrade look that changes nothing must not disturb the sockets
  });

  it('does not look while the Mac has no relay or no direct address, and never on a direct route', async () => {
    const direct = setup({ route: 'direct', direct: 20 });
    direct.manager.reset();
    const noAddress = setup({ route: 'relay', addresses: [] });
    noAddress.manager.reset();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(direct.races()).toBe(0);
    expect(noAddress.races()).toBe(0);
  });
});

describe('the app in the background', () => {
  it('pauses the ladders and resumes with a race when it returns after a while', async () => {
    const t = setup({ route: 'relay', direct: 30 });
    t.manager.reset();
    t.manager.signal({ t: 'background' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.races()).toBe(0);
    t.manager.signal({ t: 'foreground' });
    await vi.advanceTimersByTimeAsync(300);
    expect(t.races()).toBe(1);
    expect(t.applied[0]).toMatchObject({ reason: 'foreground' });
  });

  it('ignores a quick glance away (under five seconds)', async () => {
    const t = setup({ route: 'direct', direct: 30 });
    t.manager.signal({ t: 'background' });
    await vi.advanceTimersByTimeAsync(2_000);
    t.manager.signal({ t: 'foreground' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.races()).toBe(0);
  });

  it('still reacts to a network change while backgrounded, but never retries there', async () => {
    const t = setup({ route: 'relay', direct: 'fail', relay: 'fail' });
    t.manager.signal({ t: 'background' });
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(NETWORK_DEBOUNCE_MS + 200);
    expect(t.races()).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.races()).toBe(1);
  });
});

describe('dispose', () => {
  it('stops everything', async () => {
    const t = setup({ route: 'relay', direct: 30 });
    t.manager.reset();
    t.manager.dispose();
    t.manager.signal({ t: 'network' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.races()).toBe(0);
  });
});
