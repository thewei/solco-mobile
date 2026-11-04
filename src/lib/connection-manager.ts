// [INPUT]: injected deps only — a clock, timers, the active Mac's view (current route, direct addresses, relay),
//          bootstrap probes per route, `apply` (adopt a route) and `refresh` (rebuild the client). No React,
//          no sockets, no storage: the whole policy runs under fake timers in vitest.
// [OUTPUT]: createConnectionManager(deps) → { signal, reset, dispose }, plus the two pure pieces it is built
//           from: raceRoutes (probe every route at once, measure each one's round trip, settle early) and
//           chooseRoute (the fastest route wins, a direct one gets a bias).
// [POS]: The one owner of "which way in is the Mac reached, and is it still alive". It replaces the three
//        separate pieces that used to guess: a recovery that only a failed bootstrap could trigger (then
//        throttled for 30 s), an upgrade loop that only ran on the relay, and a 2.5 s grace before a relay
//        answer counted. Now every sign of trouble (the phone's network changed, a request failed, the
//        events socket went silent) triggers the same race at once, and while on the relay a ladder keeps
//        looking for a faster direct path.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: `refresh()` (route unchanged after a non-upgrade race) always also leaves a P2P link; one race at a time (signals during a race are folded into one follow-up); the race never
// changes the route unless a probe really answered; a direct route is preferred while it is not clearly
// slower than the relay (≤ 1.5× + 40 ms); nothing runs while the app is in the background; no token,
// address or body is ever passed through here except the address a probe is about to dial.

export type RouteKind = 'direct' | 'relay';
export interface DirectAddress {
  host: string;
  port: number;
}

/** What the manager needs to know about the active Mac, read fresh before every race. */
export interface ManagerView {
  id: string;
  route: RouteKind;
  /** Direct addresses to try (empty when the phone has no pinned transport). */
  direct: DirectAddress[];
  hasRelay: boolean;
}

export type Reason = 'network' | 'failure' | 'foreground' | 'retry' | 'upgrade';
export type Signal = { t: 'network' } | { t: 'failure' } | { t: 'alive' } | { t: 'foreground' } | { t: 'background' };
export type Decision = { route: 'direct'; address: DirectAddress } | { route: 'relay' };

export interface ManagerDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  view(): ManagerView | null;
  probeDirect(address: DirectAddress, timeoutMs: number): Promise<void>;
  probeRelay(timeoutMs: number): Promise<void>;
  /** Adopt the decision. Resolves true when the connection (route or address) really changed. */
  apply(id: string, decision: Decision, context: { reason: Reason; from: RouteKind; took: number }): Promise<boolean>;
  /** The route stayed but its sockets may be dead: leave any P2P link, rebuild the client and refetch. */
  refresh(): void;
}

/** The phone's network flaps (several events per switch): act once, shortly after the last. */
export const NETWORK_DEBOUNCE_MS = 300;
/** Between two races started by trouble signals (a network change ignores it). */
export const MIN_GAP_MS = 1_500;
/** Pause before the next race while nothing answers: quick first, then settling at 10 s, then 30 s. */
export const RETRY_LADDER_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;
export const RETRY_IDLE_MS = 30_000;
export const RETRY_IDLE_AFTER = 8;
/** While on the relay, how long until the next look for a direct path. */
export const UPGRADE_LADDER_MS = [15_000, 30_000, 60_000, 120_000] as const;
/** First look after the app starts on the relay. */
export const UPGRADE_FIRST_MS = 3_000;
export const PROBE_TIMEOUT_MS = 5_000;
/** The app has to have been away this long before coming back counts as a reason to re-check. */
export const FOREGROUND_AFTER_MS = 5_000;
/** A direct route wins unless it is slower than relay × FACTOR + SLACK. */
export const DIRECT_FACTOR = 1.5;
export const DIRECT_SLACK_MS = 40;
/** A direct answer this quick needs no comparison. */
const DIRECT_INSTANT_MS = 150;

export interface RouteProbe {
  kind: RouteKind;
  address?: DirectAddress;
  run(): Promise<void>;
}

export interface RaceResult {
  direct: { address: DirectAddress; rtt: number } | null;
  relay: { rtt: number } | null;
  /** Wall time until the race settled. */
  took: number;
}

interface RaceClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Start every probe together and measure each one's round trip. The race settles when all have answered
 * or failed, or early once the first answer has had its comparison window: a quick direct answer ends it
 * at once, a slow direct one waits (up to 600 ms) for the relay, a relay answer waits (300–800 ms) for a
 * direct one — Happy Eyeballs with a measured preference instead of a fixed grace.
 */
export function raceRoutes(probes: RouteProbe[], clock: RaceClock): Promise<RaceResult> {
  return new Promise((resolve) => {
    const start = clock.now();
    let pending = probes.length;
    let done = false;
    let timer: unknown = null;
    let direct: RaceResult['direct'] = null;
    let relay: RaceResult['relay'] = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer !== null) clock.clearTimer(timer);
      resolve({ direct, relay, took: clock.now() - start });
    };
    if (pending === 0) {
      finish();
      return;
    }
    const answered = (probe: RouteProbe) => {
      if (done) return;
      const rtt = clock.now() - start;
      if (probe.kind === 'direct') {
        if (!direct || rtt < direct.rtt) direct = { address: probe.address!, rtt };
      } else if (!relay || rtt < relay.rtt) relay = { rtt };
      if (direct && direct.rtt <= DIRECT_INSTANT_MS) return finish();
      if (timer === null) {
        const wait = probe.kind === 'direct' ? Math.min(rtt, 600) : Math.min(Math.max(rtt, 300), 800);
        timer = clock.setTimer(finish, wait);
      }
    };
    for (const probe of probes) {
      probe.run().then(
        () => answered(probe),
        () => undefined,
      ).finally(() => {
        pending -= 1;
        if (pending === 0) finish();
      });
    }
  });
}

/** The fastest way in. A direct route is preferred (private, cheaper) while it is not clearly slower. */
export function chooseRoute(direct: RaceResult['direct'], relay: RaceResult['relay']): Decision | null {
  if (direct && relay) {
    return direct.rtt <= relay.rtt * DIRECT_FACTOR + DIRECT_SLACK_MS ? { route: 'direct', address: direct.address } : { route: 'relay' };
  }
  if (direct) return { route: 'direct', address: direct.address };
  if (relay) return { route: 'relay' };
  return null;
}

const PRIORITY: Record<Reason, number> = { upgrade: 0, retry: 1, foreground: 2, failure: 3, network: 4 };

export interface ConnectionManager {
  signal(signal: Signal): void;
  /** The active Mac (or its route) changed: forget the ladders and, on the relay, look for a direct path soon. */
  reset(): void;
  dispose(): void;
}

export function createConnectionManager(deps: ManagerDeps): ConnectionManager {
  let foreground = true;
  let backgroundedAt: number | null = null;
  let inflight = false;
  let queued: Reason | null = null;
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  let timerReason: Reason = 'upgrade';
  let lastRaceAt = Number.NEGATIVE_INFINITY;
  let failures = 0;
  let upgradeStep = 0;
  let disposed = false;

  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    timerAt = Number.POSITIVE_INFINITY;
  };

  /** One pending run at a time: the earliest time wins, the strongest reason names it. */
  const schedule = (reason: Reason, delay: number) => {
    if (disposed) return;
    const at = deps.now() + delay;
    if (timer !== null) {
      if (PRIORITY[reason] > PRIORITY[timerReason]) timerReason = reason;
      if (at >= timerAt) return;
      deps.clearTimer(timer);
    } else timerReason = reason;
    timerAt = at;
    timer = deps.setTimer(() => {
      timer = null;
      timerAt = Number.POSITIVE_INFINITY;
      void run(timerReason);
    }, delay);
  };

  const retryDelay = (): number =>
    failures >= RETRY_IDLE_AFTER ? RETRY_IDLE_MS : (RETRY_LADDER_MS[Math.min(failures - 1, RETRY_LADDER_MS.length - 1)] ?? RETRY_IDLE_MS);

  const scheduleUpgrade = (view: ManagerView, route: RouteKind) => {
    if (route === 'relay' && view.direct.length > 0) {
      schedule('upgrade', UPGRADE_LADDER_MS[Math.min(upgradeStep, UPGRADE_LADDER_MS.length - 1)] ?? UPGRADE_LADDER_MS[0]);
      upgradeStep += 1;
    } else upgradeStep = 0;
  };

  const run = async (reason: Reason): Promise<void> => {
    if (disposed) return;
    if (!foreground && (reason === 'upgrade' || reason === 'retry')) return; // resumed by the next foreground
    if (inflight) {
      if (!queued || PRIORITY[reason] > PRIORITY[queued]) queued = reason;
      return;
    }
    const view = deps.view();
    if (!view) return;
    inflight = true;
    lastRaceAt = deps.now();
    try {
      const probes: RouteProbe[] = [
        ...view.direct.map((address): RouteProbe => ({ kind: 'direct', address, run: () => deps.probeDirect(address, PROBE_TIMEOUT_MS) })),
        ...(view.hasRelay ? [{ kind: 'relay', run: () => deps.probeRelay(PROBE_TIMEOUT_MS) } satisfies RouteProbe] : []),
      ];
      const result = await raceRoutes(probes, deps);
      const decision = chooseRoute(result.direct, result.relay);
      if (!decision) {
        failures += 1;
        schedule('retry', retryDelay());
        return;
      }
      failures = 0;
      const changed = await deps.apply(view.id, decision, { reason, from: view.route, took: result.took });
      if (!changed && reason !== 'upgrade') deps.refresh();
      scheduleUpgrade(view, decision.route);
    } catch {
      failures += 1;
      schedule('retry', retryDelay());
    } finally {
      inflight = false;
      const next = queued;
      queued = null;
      if (next && failures === 0) schedule(next, Math.max(0, MIN_GAP_MS - (deps.now() - lastRaceAt)));
    }
  };

  return {
    signal(signal) {
      if (disposed) return;
      switch (signal.t) {
        case 'network':
          failures = 0;
          upgradeStep = 0;
          schedule('network', NETWORK_DEBOUNCE_MS);
          return;
        case 'failure': {
          // Already recovering: the retry ladder owns the pace; every reconnect attempt failing must not add races.
          if (failures > 0) return;
          if (inflight) {
            if (!queued || PRIORITY.failure > PRIORITY[queued]) queued = 'failure';
            return;
          }
          schedule('failure', Math.max(0, MIN_GAP_MS - (deps.now() - lastRaceAt)));
          return;
        }
        case 'alive':
          failures = 0;
          if (timer !== null && timerReason === 'retry') clear();
          return;
        case 'background':
          foreground = false;
          backgroundedAt = deps.now();
          clear();
          return;
        case 'foreground': {
          const away = backgroundedAt === null ? 0 : deps.now() - backgroundedAt;
          foreground = true;
          backgroundedAt = null;
          if (away >= FOREGROUND_AFTER_MS || failures > 0) schedule('foreground', 0);
          return;
        }
      }
    },
    reset() {
      failures = 0;
      upgradeStep = 0;
      clear();
      const view = deps.view();
      if (view && foreground && view.route === 'relay' && view.direct.length > 0) schedule('upgrade', UPGRADE_FIRST_MS);
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
