// [INPUT]: a way to ask the Mac for its STUN/TURN list (HostClientV3.p2pIce), the clock.
// [OUTPUT]: createIceSource() → (attempt, offLan) => Promise<P2PIceServer[]> — the list for one offer.
// [POS]: Why a cache: an offer without server-reflexive candidates is never given ICE servers by the Mac
//        (it keys on the offer), and host-only ICE dies on cellular NAT. After Wi-Fi → cellular the Host client
//        still points at the dead LAN route for seconds, so asking then hangs. The list is therefore fetched in
//        the background while the link is healthy and reused for a reconnect at once (STUN needs no credential,
//        a stale TURN credential only costs the relay candidate); only without any list does a reconnect wait,
//        bounded, for a fresh answer.
// [PROTOCOL]: 变更时更新此头部
import type { P2PIceServer } from '@/contracts/host-v3';

export const ICE_ASK_MS = 1_500;
export const ICE_TTL_MS = 30 * 60_000;

export interface IceSourceOptions {
  ask: () => Promise<P2PIceServer[]> | null;
  now?: () => number;
  askMs?: number;
  ttlMs?: number;
}

export function createIceSource(opts: IceSourceOptions): (attempt: number, offLan: boolean) => Promise<P2PIceServer[]> {
  const now = opts.now ?? Date.now;
  const askMs = opts.askMs ?? ICE_ASK_MS;
  const ttlMs = opts.ttlMs ?? ICE_TTL_MS;
  let cached: { list: P2PIceServer[]; at: number } | null = null;

  const refresh = (): Promise<P2PIceServer[]> | null => {
    const asked = opts.ask();
    if (!asked) return null;
    const stored = asked.then((list) => {
      if (list.length) cached = { list, at: now() };
      return list;
    });
    stored.catch(() => undefined); // a failed refresh is a miss, never an error
    return stored;
  };

  return async (attempt, offLan) => {
    const fresh = refresh();
    if (!offLan && attempt < 1) return []; // first connect on the LAN: no server may delay it; the ask only primes the cache
    if (cached && now() - cached.at < ttlMs) return cached.list;
    if (!fresh) return [];
    return Promise.race([fresh, new Promise<P2PIceServer[]>((resolve) => setTimeout(() => resolve([]), askMs))]).catch((): P2PIceServer[] => []);
  };
}
