// [INPUT]: nothing but numbers and route labels — no sockets, timers or storage.
// [OUTPUT]: nextP2PDelayMs (the P2P retry ladder), p2pBeatsRelay (keep a new link only if it is not slower), describeRouteChange (the one-line wording of a
//           switch), isOffLan, routeKeyOf and withTimeout.
// [POS]: Small pure helpers around route changes. Which route serves and when to look again is
//        lib/connection-manager.ts; this file keeps the P2P ladder, the toast wording and the probe
//        timeout wrapper.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

export type RouteKind = 'direct' | 'p2p' | 'relay' | 'tailcat';

/** The P2P ladder's ceiling; also the cap of every other retry here. */
export const OPTIMIZE_MAX_MS = 300_000;
/** The same switch is announced at most once per this window. */
export const NOTICE_DEDUPE_MS = 30_000;

/** P2P attempts start sooner than direct re-checks (15 s, doubling, capped at 5 min): it is the quickest win on a relay. */
export const P2P_BASE_MS = 15_000;
export function nextP2PDelayMs(misses: number): number {
  const exp = Math.min(Math.max(0, Math.floor(misses)), 10);
  return Math.min(P2P_BASE_MS * 2 ** exp, OPTIMIZE_MAX_MS);
}

/** A P2P link that lived less than this when trouble ended it counts as a quick death. */
export const P2P_STABLE_MS = 300_000;

/**
 * What a P2P link's end teaches. One that dies young (it opened, then the path went quiet) must not be
 * reopened every few seconds: each early death doubles the wait on the same ladder as a failed attempt.
 * A link that held for P2P_STABLE_MS wipes the record.
 */
export function p2pAfterTrouble(deaths: number, lifetimeMs: number): { deaths: number; holdMs: number } {
  if (lifetimeMs >= P2P_STABLE_MS) return { deaths: 0, holdMs: 0 };
  const next = Math.max(0, Math.floor(deaths)) + 1;
  return { deaths: next, holdMs: nextP2PDelayMs(next - 1) };
}

/** A fresh P2P link is kept only if its round trip is no worse than the relay's by more than this. */
export const P2P_SLACK_MS = 30;
/** A link that lost the round-trip comparison is not tried again for this long. */
export const P2P_SLOWER_HOLD_MS = 120_000;

/** P2P replaces the relay only when it answers as fast: a TURN-relayed path often takes the same detour (or a longer one). */
export function p2pBeatsRelay(p2pMs: number, relayMs: number): boolean {
  return p2pMs <= relayMs + P2P_SLACK_MS;
}

export interface RouteLabel {
  route: RouteKind;
  /** Human label of a direct address kind: LAN / Tailscale / USB. */
  via?: string;
  /** The address, shown only for a direct route. */
  address?: string;
}

const routeName = (label: RouteLabel): string => {
  if (label.route === 'relay') return 'Relay';
  if (label.route === 'tailcat') return 'Tunnel';
  if (label.route === 'p2p') return 'P2P';
  return label.via ?? 'Direct';
};

/** The one-line toast for a switch; null when nothing meaningfully changed. */
export function describeRouteChange(from: RouteLabel, to: RouteLabel, ms?: number): string | null {
  if (from.route === to.route && from.address === to.address) return null;
  const latency = ms !== undefined && ms >= 0 ? ` · ${Math.round(ms)} ms` : '';
  if (to.route === 'relay') {
    return from.route === 'relay' ? null : 'Direct path unavailable — now using the relay';
  }
  if (to.route === 'tailcat') {
    return from.route === 'tailcat' ? null : 'Direct path unavailable — now using the tunnel';
  }
  const target = to.route === 'direct' && to.address ? `${routeName(to)} (${to.address})` : routeName(to);
  if (from.route === 'relay' || from.route === 'tailcat') return `Back on ${target}${latency}`;
  return `Switched to ${target}${latency}`;
}

/**
 * Judge whether a connection route is off-LAN (cellular / internet / tunnel / relay / p2p), where STUN/TURN
 * ICE candidates must be gathered for WebRTC, or local direct (LAN, Tailscale IP, USB) where host candidates
 * connect immediately without waiting.
 */
export function isOffLan(
  route: RouteLabel | null | undefined,
  connection?: { host?: string; relay?: unknown; tailcat?: unknown } | null,
  p2pActive = false,
): boolean {
  if (route) {
    const isDirectLocal = route.route === 'direct' && (route.via === 'LAN' || route.via === 'Tailscale' || route.via === 'USB');
    return !isDirectLocal;
  }
  return Boolean(connection?.relay) || Boolean(connection?.tailcat) || p2pActive;
}

export function routeKeyOf(
  route: RouteLabel | null | undefined,
  connection?: { host?: string; relay?: unknown; tailcat?: unknown } | null,
): string {
  if (route) {
    return route.route === 'direct' ? `direct:${route.via}:${route.address}` : route.route;
  }
  if (!connection) return '';
  return `${connection.relay ? 'relay' : connection.tailcat ? 'tailcat' : 'direct'}|${connection.host ?? ''}`;
}

/** Reject after `ms` so a stalled handshake cannot park a probe forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
