// [INPUT]: the stored HostBookV3 (every paired Mac), the native PinnedTransport (route=lan) and
//          user actions.
// [OUTPUT]: HostV3Provider + useHostV3 → { status, connection, client, hosts, activeId, pair,
//           switchTo, remove, probe, signal, markConnected, noteNet, pinnedAvailable, p2pActive, route }.
// [POS]: Lifecycle owner of the paired Go Hosts: loads the book from SecureStore, trades a pairing code
//        for a device token (a Mac paired again merges into its card), switches the active Mac, drops
//        one on remove or on a revoked token (nothing else is switched to silently), and stamps a Mac
//        when it answers. Screens never build a client or touch storage themselves. The connection's
//        optional `relay` is the route the client serves on: pairing through the relay needs no
//        native pinned transport (the relay URL is CA-signed). Which route serves is the
//        ConnectionManager's call (lib/connection-manager.ts): the provider feeds it signals
//        (network changed, request failed, socket silent, app foregrounded), supplies the probes
//        and applies its decision to the book; `epoch` rebuilds the client when the route stays
//        but its sockets may be dead. Every bootstrap answer (app query and route probes) also
//        carries the Mac's `net` — its serving address — which `noteNet` merges into the card
//        (host-book.mergeAdvertised), so a changed LAN/Tailscale address is probed at once.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariant: a LAN/Tailscale direct connection is always certificate-pinned — without the native
// pinned transport (iOS/Web today) a direct pair refuses, it never falls back to an unpinned
// fetch. A relay is different: it is a host the user registered by pairing, an explicit path.
// Tokens live in SecureStore only. `connection` and `client` stay referentially stable while the
// active Mac's transport fields do not change, so stamping a last-connected time never restarts a
// query or a socket.
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { BootstrapV3, HostServingAddress } from '@/contracts/host-v3';
import { createHostClientV3, HostV3Error, pairWithHost, routeAnswered, type HostClientV3 } from '@/lib/host-client-v3';
import { createConnectionManager, type ConnectionManager, type Decision, type Signal } from '@/lib/connection-manager';
import {
  activateHost,
  activeRecord,
  adoptAddress,
  emptyBook,
  fallbackAddresses,
  hostId,
  hostRoute,
  mergeAdvertised,
  pairHost,
  readHostBookV3,
  removeHost,
  setTailcat,
  sortedHosts,
  toConnection,
  touchConnected,
  writeHostBookV3,
  type HostBookV3,
  type HostRecordV3,
} from '@/lib/host-book';
import type { HostConnectionV3 } from '@/lib/host-connection-v3';
import type { PairTarget } from '@/lib/pairing-v3';
import { getTailcatTransport, resetTailcatClients, tailcatClientKey } from '@/lib/tailcat-transport';
import type { PinnedTransport } from '@/lib/pinned-transport';
import { describeRouteChange, p2pAfterTrouble, p2pBeatsRelay, P2P_SLOWER_HOLD_MS, withTimeout, type RouteLabel } from '@/lib/route-optimizer';
import { getCreatePeer } from '@/lib/p2p-native';
import { openP2PRoute, type OpenP2PRoute } from '@/lib/p2p-session';
import { useRouteNotice } from '@/state/route-notice-store';
import { readPhoneNetwork } from '@/lib/phone-network';
import { getPinnedTransport } from '@/lib/pinned-transport-native';
import { useSessionStore } from '@/state/session-store';

/** A Mac that answered "no P2P" is not asked again for this long. */
const P2P_UNAVAILABLE_HOLD_MS = 600_000;

export type HostV3Status = 'loading' | 'unpaired' | 'paired';

interface HostV3ContextValue {
  status: HostV3Status;
  /** The active Mac's transport fields (stable while they do not change). */
  connection: HostConnectionV3 | null;
  client: HostClientV3 | null;
  /** Every paired Mac, the active one first then the most recently reached. */
  hosts: HostRecordV3[];
  activeId: string | null;
  /**
   * False where the native pinned transport does not exist; a direct LAN/Tailscale pair is then
   * impossible (pairing through an explicitly registered relay still works).
   */
  pinnedAvailable: boolean;
  pair(target: PairTarget): Promise<void>;
  /** Make a paired Mac the active one; its queries start from nothing. */
  switchTo(id: string): Promise<void>;
  /** Forget one Mac on this phone (the Mac itself still lists the device until revoked there). */
  remove(id: string): Promise<void>;
  /** Ask a paired Mac (any, not only the active one) whether it answers; rejects with a HostV3Error. */
  probe(id: string): Promise<void>;
  /**
   * A sign about the connection (phone network changed, a request failed, the events socket went silent
   * or came alive, the app left/returned). The ConnectionManager decides what to do: race every route,
   * pick the fastest, rebuild the sockets. Fire and forget; safe to call from any render or effect.
   */
  signal(signal: Signal): void;
  /** True while the active Mac is served over a WebRTC DataChannel (above the relay, below a direct address). */
  p2pActive: boolean;
  /** Current active route label (direct with via, relay, tailcat, or p2p). */
  route: RouteLabel | null;
  /**
   * Reached through the relay: try to open a P2P link through it (needs the Mac's `capabilities.p2p`
   * and the native WebRTC module). Failure leaves the relay in place; a Mac without P2P is not asked
   * again for ten minutes.
   */
  connectP2P(id: string): Promise<'connected' | 'unavailable' | 'failed' | 'skip'>;
  /** The active Mac answered: stamp the time and the phone's network on its card. */
  markConnected(id: string): Promise<void>;
  /**
   * The Mac's own word on where it serves now (bootstrap `net`, any successful
   * connect): merges into the active card's address history and restarts the
   * route ladders when something is new, so a changed address is probed at once.
   * Fire and forget.
   */
  noteNet(addresses: HostServingAddress[] | undefined): void;
}

const HostV3Context = createContext<HostV3ContextValue | null>(null);

function deviceName(): string {
  return Constants.deviceName?.trim() || 'Phone';
}

const VIA: Record<string, string> = { lan: 'LAN', tailscale: 'Tailscale', usb: 'USB', other: 'Direct' };

/** Where the phone currently reaches a Mac: the tunnel or the relay while the card's route says so, else its address. */
/** How long before an unanswered tunnel enroll is tried again for the same Mac. */
const ENROLL_RETRY_MS = 10 * 60_000;
/** Minimum gap between two rebuilds of the tunnel client caused by failed probes. */
const TUNNEL_REBUILD_GAP_MS = 20_000;

function routeOf(record: HostRecordV3): RouteLabel {
  if (record.tailcat && record.lastRoute === 'tailcat') return { route: 'tailcat' };
  if (record.relay && record.lastRoute === 'relay') return { route: 'relay' };
  return { route: 'direct', via: VIA[hostRoute(record.host)] ?? 'Direct', address: record.host };
}

function directLabel(address: { host: string }): RouteLabel {
  return { route: 'direct', via: VIA[hostRoute(address.host)] ?? 'Direct', address: address.host };
}

const sameConnection = (a: HostConnectionV3 | null, b: HostConnectionV3 | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.host === b.host &&
    a.port === b.port &&
    a.fingerprint === b.fingerprint &&
    a.token === b.token &&
    a.deviceId === b.deviceId &&
    a.name === b.name &&
    a.relay?.url === b.relay?.url &&
    a.relay?.secret === b.relay?.secret);

export function HostV3Provider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const transport = useMemo(() => getPinnedTransport(), []);
  const [book, setBook] = useState<HostBookV3>(emptyBook);
  const [loaded, setLoaded] = useState(false);
  // The latest book, so two quick actions never build on a stale one; writes are chained in order.
  const bookRef = useRef<HostBookV3>(book);
  const writes = useRef<Promise<void>>(Promise.resolve());
  // A pairing deep link can finish before the stored book is read (a child's effect runs before this
  // provider's): every action first awaits the one read, so it builds on the stored Macs and a late
  // read never overwrites what the user just did.
  const load = useRef<Promise<void> | null>(null);

  const ensureLoaded = useCallback((): Promise<void> => {
    load.current ??= readHostBookV3()
      .catch(() => emptyBook())
      .then((stored) => {
        bookRef.current = stored;
        setBook(stored);
        setLoaded(true);
      });
    return load.current;
  }, []);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  const commit = useCallback((next: HostBookV3): Promise<void> => {
    bookRef.current = next;
    setBook(next);
    setLoaded(true);
    writes.current = writes.current.then(() => writeHostBookV3(next)).catch(() => undefined);
    return writes.current;
  }, []);

  const record = activeRecord(book);
  const connectionRef = useRef<HostConnectionV3 | null>(null);
  const nextConnection = record ? toConnection(record) : null;
  if (!sameConnection(connectionRef.current, nextConnection)) connectionRef.current = nextConnection;
  const connection = connectionRef.current;

  // Bumped when the route stays but its sockets may be dead (a network switch): a new client, so every
  // effect keyed on it reopens its socket.
  const [epoch, setEpoch] = useState(0);
  // The tunnel transport, built once per Mac while the tunnel address exists: the base client dials
  // through it when the manager says tailcat, and the race probes it before that.
  const [tunnelTransport, setTunnelTransport] = useState<PinnedTransport | null>(null);
  const tunnelForConnection = record?.tailcat ?? null;
  useEffect(() => {
    let live = true;
    if (!tunnelForConnection || !record) {
      setTunnelTransport(null);
      return undefined;
    }
    void getTailcatTransport(toConnection(record)).then((built) => {
      if (!live) return;
      setTunnelTransport(built);
      // The tunnel just became usable (first pairing, or the address arrived): let the manager count it in.
      if (built) queueMicrotask(() => managerRef.current?.reset());
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the record drives the tunnel identity
  }, [tunnelForConnection]);
  // The route the active Mac was reached on before any P2P overlay: the one signalling rides.
  const activeRoute = record ? routeOf(record).route : null;
  const baseTransport = activeRoute === 'tailcat' ? tunnelTransport : transport;
  const baseClient = useMemo(
    () => (connection && (baseTransport || connection.relay) ? createHostClientV3(baseTransport, connection) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `epoch` only forces a rebuild
    [baseTransport, connection, epoch],
  );
  const createPeer = useMemo(() => getCreatePeer(), []);
  const [p2p, setP2P] = useState<{ id: string; route: OpenP2PRoute; openedAt: number } | null>(null);
  const p2pRef = useRef(p2p);
  p2pRef.current = p2p;
  // Per Mac: when a P2P attempt may start again, and how many links in a row died young.
  const p2pHold = useRef(new Map<string, number>());
  const p2pDeaths = useRef(new Map<string, number>());
  // The path went quiet under the open link (a silent events socket, a request that timed out, the app coming
  // back): leave it at once — the relay serves meanwhile — and make a link that dies young wait longer to return.
  const leaveP2PAfterTrouble = useCallback(() => {
    const current = p2pRef.current;
    if (!current) return;
    current.route.close();
    setP2P(null);
    const next = p2pAfterTrouble(p2pDeaths.current.get(current.id) ?? 0, Date.now() - current.openedAt);
    p2pDeaths.current.set(current.id, next.deaths);
    if (next.holdMs > 0) p2pHold.current.set(current.id, Math.max(p2pHold.current.get(current.id) ?? 0, Date.now() + next.holdMs));
  }, []);
  const p2pRoute = p2p && p2p.id === book.activeId ? p2p.route : undefined;
  // direct > P2P > relay: a live channel replaces the relay for everything the client does.
  const client = useMemo(
    () => (p2pRoute && connection && baseClient ? createHostClientV3(transport, connection, p2pRoute) : baseClient),
    [transport, connection, baseClient, p2pRoute],
  );

  // Another Mac means another set of Herdr sessions: nothing cached or picked for the old one applies.
  const resetServerState = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: ['v3'] });
    queryClient.removeQueries({ queryKey: ['v3'] });
    useSessionStore.getState().selectInstance(null);
  }, [queryClient]);

  const switchTo = useCallback(
    async (id: string) => {
      await ensureLoaded();
      if (bookRef.current.activeId === id) return;
      const next = activateHost(bookRef.current, id);
      if (next === bookRef.current) return;
      await resetServerState();
      await commit(next);
    },
    [commit, ensureLoaded, resetServerState],
  );

  const remove = useCallback(
    async (id: string) => {
      await ensureLoaded();
      if (!bookRef.current.hosts.some((host) => hostId(host) === id)) return;
      const wasActive = bookRef.current.activeId === id;
      if (wasActive) await resetServerState();
      await commit(removeHost(bookRef.current, id));
    },
    [commit, ensureLoaded, resetServerState],
  );

  const pair = useCallback(
    async (target: PairTarget) => {
      // pairWithHost owns the route refusal: a direct pair needs the pinned transport, a relay
      // pair (explicitly registered by the QR) works wherever plain HTTPS does. The tunnel node
      // public key rides the body so the Mac admits the tunnel after the window closes, and the
      // tunnel transport lets the pair itself ride the tunnel when the Mac's address is
      // unreachable (the phone on cellular, away from home).
      const clientKey = await tailcatClientKey();
      const tunnel = target.tailcat ? await getTailcatTransport(target) : null;
      const way = { via: 'direct' as 'direct' | 'tunnel' | 'relay' };
      const paired = await pairWithHost(transport, target, deviceName(), clientKey ?? undefined, tunnel, (via) => {
        way.via = via;
      });
      const network = await readPhoneNetwork();
      await ensureLoaded();
      await resetServerState();
      // A pair that went through the tunnel proves the tunnel is the way that works from here: start on
      // it instead of failing once on the LAN address first.
      await commit(pairHost(bookRef.current, paired, { now: Date.now(), network, route: way.via === 'tunnel' ? 'tailcat' : undefined }));
    },
    [commit, ensureLoaded, resetServerState, transport],
  );

  // A Mac paired before the tunnel existed hands over this phone's node key once the phone reaches it, and
  // keeps the tunnel address it gets back; an old Mac or a tunnel that is not up yet just means "later".
  const enrollAttempts = useRef(new Map<string, number>());
  const migrateToTunnel = useCallback(
    async (target: HostRecordV3) => {
      if (target.tailcat) return;
      const id = hostId(target);
      if (Date.now() - (enrollAttempts.current.get(id) ?? 0) < ENROLL_RETRY_MS) return;
      enrollAttempts.current.set(id, Date.now());
      try {
        const clientKey = await tailcatClientKey();
        if (!clientKey) return;
        const connection = target.relay && target.lastRoute === 'relay' ? toConnection(target) : { ...toConnection(target), relay: undefined };
        const address = await createHostClientV3(transport, connection).enrollTunnel(clientKey);
        await ensureLoaded();
        const next = setTailcat(bookRef.current, id, address);
        if (next !== bookRef.current) await commit(next);
      } catch {
        // The legacy routes keep working.
      }
    },
    [commit, ensureLoaded, transport],
  );

  const markConnected = useCallback(
    async (id: string) => {
      await ensureLoaded();
      const target = bookRef.current.hosts.find((host) => hostId(host) === id);
      if (target) void migrateToTunnel(target);
      const network = await readPhoneNetwork();
      // The client answered on the relay or the tunnel only while the card's route says so; otherwise
      // the stamp moves the current address to the front as before.
      const route =
        target?.relay && target.lastRoute === 'relay'
          ? ('relay' as const)
          : target?.tailcat && target.lastRoute === 'tailcat'
            ? ('tailcat' as const)
            : undefined;
      const updated = touchConnected(bookRef.current, id, { now: Date.now(), network, route });
      if (updated !== bookRef.current) await commit(updated);
    },
    [commit, ensureLoaded, migrateToTunnel],
  );

  const probe = useCallback(
    async (id: string) => {
      const target = bookRef.current.hosts.find((host) => hostId(host) === id);
      // Without a pinned transport only a Mac whose tunnel or relay endpoint is reachable qualifies.
      const tunnel = tunnelTransport ?? null;
      if (!target || (!transport && !tunnel && !(target.relay && target.lastRoute === 'relay'))) {
        throw new HostV3Error('transport', 'This computer is not paired on this phone.');
      }
      const route = target.tailcat && target.lastRoute === 'tailcat' ? tunnel : transport;
      await createHostClientV3(route, toConnection(target)).bootstrap();
    },
    [transport, tunnelTransport],
  );

  // The one owner of "which way in, and is it alive" (lib/connection-manager.ts). It reads the active Mac
  // fresh before every race, probes through bootstrap (the same call the app's first read uses), and
  // hands back a decision; applying it is the only thing that writes a route into the book.
  const applyDecision = useCallback(
    async (id: string, decision: Decision, context: { reason: string; took: number }): Promise<boolean> => {
      const target = bookRef.current.hosts.find((host) => hostId(host) === id);
      if (!target) return false;
      const from = routeOf(target);
      // An upgrade look only moves a Mac that is still on a non-direct route (the route may have changed while probing).
      if (context.reason === 'upgrade' && from.route !== 'relay' && from.route !== 'tailcat') return false;
      const before = toConnection(target);
      const network = await readPhoneNetwork();
      let label: RouteLabel;
      if (decision.route === 'relay') {
        label = { route: 'relay' };
        const touched = touchConnected(bookRef.current, id, { now: Date.now(), network, route: 'relay' });
        if (touched !== bookRef.current) await commit(touched);
      } else if (decision.route === 'tailcat') {
        label = { route: 'tailcat' };
        const touched = touchConnected(bookRef.current, id, { now: Date.now(), network, route: 'tailcat' });
        if (touched !== bookRef.current) await commit(touched);
      } else {
        label = directLabel(decision.address);
        const adopted = adoptAddress(bookRef.current, id, decision.address, { now: Date.now(), network });
        if (adopted !== bookRef.current) await commit(adopted);
      }
      const text = describeRouteChange(from, label, context.took);
      if (text) useRouteNotice.getState().post(text);
      const after = bookRef.current.hosts.find((host) => hostId(host) === id);
      return after !== undefined && !sameConnection(before, toConnection(after));
    },
    [commit],
  );

  // A probe the Host refused with 401 still reached it: the route is alive, the app's own queries meet the 401
  // and forget the Mac (rather than the manager retrying a revoked phone on its ladder).
  const answered = useCallback(
    (probe: Promise<BootstrapV3>): Promise<BootstrapV3 | undefined> =>
      probe.then(
        (boot) => boot,
        (error: unknown) => {
          if (!routeAnswered(error)) throw error;
          void queryClient.invalidateQueries({ queryKey: ['v3'] });
          return undefined;
        },
      ),
    [queryClient],
  );
  const managerRef = useRef<ConnectionManager | null>(null);
  // The Mac's own word on where it serves now (bootstrap `net`, read over a
  // certificate-pinned connection, so it can ride the relay too): new addresses
  // join the card's history, and a change restarts the ladders — while the route
  // is the relay, the fresh address is probed within seconds.
  const noteNet = useCallback(
    (addresses: HostServingAddress[] | undefined) => {
      const id = bookRef.current.activeId;
      if (!id || !addresses?.length) return;
      const next = mergeAdvertised(bookRef.current, id, addresses);
      if (next === bookRef.current) return;
      void commit(next);
      managerRef.current?.reset();
    },
    [commit],
  );
  const lastTunnelRebuild = useRef(0);
  const managerDeps = useRef({ transport, tunnelTransport, queryClient, applyDecision, leaveP2PAfterTrouble, answered, noteNet });
  managerDeps.current = { transport, tunnelTransport, queryClient, applyDecision, leaveP2PAfterTrouble, answered, noteNet };
  if (managerRef.current === null) {
    managerRef.current = createConnectionManager({
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      view: () => {
        const target = activeRecord(bookRef.current);
        if (!target) return null;
        const { transport: pinned } = managerDeps.current;
        return {
          id: hostId(target),
          route:
            target.relay && target.lastRoute === 'relay'
              ? 'relay'
              : target.tailcat && target.lastRoute === 'tailcat'
                ? 'tailcat'
                : 'direct',
          direct: pinned ? [{ host: target.host, port: target.port }, ...fallbackAddresses(target)] : [],
          hasRelay: Boolean(target.relay),
          hasTailcat: Boolean(target.tailcat) && managerDeps.current.tunnelTransport !== null,
        };
      },
      probeTailcat: async (timeoutMs) => {
        const target = activeRecord(bookRef.current);
        const tunnel = managerDeps.current.tunnelTransport;
        if (!target?.tailcat || !tunnel) throw new Error('no tunnel');
        try {
          const boot = await managerDeps.current.answered(withTimeout(createHostClientV3(tunnel, toConnection(target)).bootstrap(), timeoutMs));
          managerDeps.current.noteNet(boot?.net?.addresses);
        } catch (error) {
          // A tunnel client that never answered may be holding paths of an old network: rebuild it (rate-limited) for the next race.
          if (Date.now() - lastTunnelRebuild.current > TUNNEL_REBUILD_GAP_MS) {
            lastTunnelRebuild.current = Date.now();
            void resetTailcatClients();
          }
          throw error;
        }
      },
      probeDirect: async (address, timeoutMs) => {
        const target = activeRecord(bookRef.current);
        if (!target) throw new Error('no active Mac');
        const direct = { ...toConnection(target), relay: undefined, host: address.host, port: address.port };
        const boot = await managerDeps.current.answered(withTimeout(createHostClientV3(managerDeps.current.transport, direct).bootstrap(), timeoutMs));
        managerDeps.current.noteNet(boot?.net?.addresses);
      },
      probeRelay: async (timeoutMs) => {
        const target = activeRecord(bookRef.current);
        if (!target?.relay) throw new Error('no relay');
        const boot = await managerDeps.current.answered(withTimeout(createHostClientV3(managerDeps.current.transport, { ...toConnection(target), relay: target.relay }).bootstrap(), timeoutMs));
        managerDeps.current.noteNet(boot?.net?.addresses);
      },
      apply: (id, decision, context) => managerDeps.current.applyDecision(id, decision, context),
      refresh: () => {
        managerDeps.current.leaveP2PAfterTrouble();
        setEpoch((value) => value + 1); // a new client: every socket opened on the old one reopens
        void managerDeps.current.queryClient.invalidateQueries({ queryKey: ['v3'] });
      },
    });
  }
  const signal = useCallback((next: Signal) => {
    // A WebRTC link does not survive a network switch (no ICE restart): leave it at once, the relay serves meanwhile.
    if (next.t === 'network' && p2pRef.current) {
      p2pRef.current.route.close();
      setP2P(null);
    }
    // The tunnel client of the old network keeps dead paths: rebuild it before the race that follows probes it.
    if (next.t === 'network') {
      lastTunnelRebuild.current = Date.now();
      void resetTailcatClients();
    }
    managerRef.current?.signal(next);
  }, []);
  useEffect(() => () => managerRef.current?.dispose(), []);
  // A different Mac, or the same one on another route: forget the ladders (on the relay a look for a direct path starts soon).
  const routeKey = book.activeId ? `${book.activeId}:${record?.relay && record.lastRoute === 'relay' ? 'relay' : record?.tailcat && record.lastRoute === 'tailcat' ? 'tailcat' : 'direct'}` : null;
  useEffect(() => {
    if (routeKey) managerRef.current?.reset();
  }, [routeKey]);

  const connectingP2P = useRef(false);
  const connectP2P = useCallback(
    async (id: string) => {
      await ensureLoaded();
      const target = bookRef.current.hosts.find((host) => hostId(host) === id);
      if (!target || !createPeer) return 'skip' as const;
      const isRelayed = (target.relay && target.lastRoute === 'relay') || (target.tailcat && target.lastRoute === 'tailcat');
      if (!isRelayed) return 'skip' as const;
      if (bookRef.current.activeId !== id || p2pRef.current?.id === id || connectingP2P.current) return 'skip' as const;
      const hold = p2pHold.current.get(id);
      if (hold !== undefined && Date.now() < hold) return 'skip' as const;
      connectingP2P.current = true;
      const startedAt = Date.now();
      try {
        // Signalling rides the route that already works (relay or tailcat), authenticated by the device token.
        const activeVia = target.tailcat && target.lastRoute === 'tailcat' ? 'tailcat' : 'relay';
        const signallingTransport = activeVia === 'tailcat' ? tunnelTransport : transport;
        if (!signallingTransport && activeVia === 'tailcat') return 'skip' as const;
        const targetConn = toConnection(target);
        const route = await openP2PRoute(createHostClientV3(signallingTransport, targetConn), createPeer);
        const current = bookRef.current.hosts.find((host) => hostId(host) === id);
        if (bookRef.current.activeId !== id || (current?.lastRoute !== 'relay' && current?.lastRoute !== 'tailcat')) {
          route.close(); // the Mac moved to a direct address while P2P was connecting
          return 'skip' as const;
        }
        // The path is only worth having if it answers as fast as the fallback it would replace.
        const sample = async (client: HostClientV3, tries: number) => {
          let best = Infinity;
          for (let i = 0; i < tries; i += 1) {
            const t = Date.now();
            await client.bootstrap();
            best = Math.min(best, Date.now() - t);
          }
          return best;
        };
        try {
          const fallbackClient = createHostClientV3(signallingTransport, targetConn);
          const [viaP2P, viaFallback] = [
            await sample(createHostClientV3(transport, targetConn, route), 3),
            await sample(fallbackClient, 2),
          ];
          console.log(`[p2p] rtt p2p=${viaP2P}ms ${activeVia}=${viaFallback}ms keep=${p2pBeatsRelay(viaP2P, viaFallback)}`);
          if (!p2pBeatsRelay(viaP2P, viaFallback)) {
            route.close();
            p2pHold.current.set(id, Date.now() + P2P_SLOWER_HOLD_MS);
            return 'skip' as const;
          }
        } catch (error) {
          console.log(`[p2p] rtt probe failed: ${error instanceof Error ? error.message : String(error)}`);
          route.close(); // a link that cannot answer a request is not a route
          return 'failed' as const;
        }
        route.onClose(() => {
          if (p2pRef.current?.route !== route) return;
          leaveP2PAfterTrouble();
          useRouteNotice.getState().post(`P2P link lost — back on ${activeVia === 'tailcat' ? 'the tunnel' : 'the relay'}`);
          void queryClient.invalidateQueries({ queryKey: ['v3'] });
        });
        setP2P({ id, route, openedAt: Date.now() });
        const text = describeRouteChange({ route: activeVia }, { route: 'p2p' }, Date.now() - startedAt);
        if (text) useRouteNotice.getState().post(text);
        void queryClient.invalidateQueries({ queryKey: ['v3'] });
        return 'connected' as const;
      } catch (error) {
        if (error instanceof HostV3Error && (error.code === 'p2p_unavailable' || error.status === 404)) {
          p2pHold.current.set(id, Date.now() + P2P_UNAVAILABLE_HOLD_MS);
          return 'unavailable' as const;
        }
        return 'failed' as const;
      } finally {
        connectingP2P.current = false;
      }
    },
    [ensureLoaded, createPeer, transport, tunnelTransport, queryClient, leaveP2PAfterTrouble],
  );

  // The overlay lives only while it is the best route: gone when the Mac leaves the relay/tunnel (a direct
  // address answered) or another Mac becomes active. A quiet close — the switch was announced already.
  useEffect(() => {
    if (p2p && (p2p.id !== book.activeId || (!connection?.relay && record?.lastRoute !== 'tailcat'))) {
      p2p.route.close();
      setP2P(null);
    }
  }, [p2p, book.activeId, connection, record?.lastRoute]);

  // The active Mac moved to another address or switched between direct and relay (same
  // certificate): what was cached came from the old way in.
  const lastConnection = useRef<HostConnectionV3 | null>(null);
  useEffect(() => {
    const previous = lastConnection.current;
    lastConnection.current = connection;
    if (
      previous &&
      connection &&
      previous.fingerprint === connection.fingerprint &&
      (previous.host !== connection.host ||
        previous.port !== connection.port ||
        Boolean(previous.relay) !== Boolean(connection.relay))
    ) {
      void queryClient.invalidateQueries({ queryKey: ['v3'] });
    }
  }, [connection, queryClient]);

  const hosts = useMemo(() => sortedHosts(book), [book]);
  const status: HostV3Status = !loaded ? 'loading' : book.activeId ? 'paired' : 'unpaired';
  const currentRoute: RouteLabel | null = useMemo(() => {
    if (!record) return null;
    if (p2pRoute) return { route: 'p2p' };
    return routeOf(record);
  }, [record, p2pRoute]);
  const value = useMemo<HostV3ContextValue>(
    () => ({ status, connection, client, hosts, activeId: book.activeId, pinnedAvailable: transport !== null, pair, switchTo, remove, probe, signal, p2pActive: p2pRoute !== undefined, route: currentRoute, connectP2P, markConnected, noteNet }),
    [status, connection, client, hosts, book.activeId, transport, pair, switchTo, remove, probe, signal, p2pRoute, currentRoute, connectP2P, markConnected, noteNet],
  );
  return <HostV3Context.Provider value={value}>{children}</HostV3Context.Provider>;
}

export function useHostV3(): HostV3ContextValue {
  const context = useContext(HostV3Context);
  if (!context) throw new Error('useHostV3 must be used inside HostV3Provider');
  return context;
}
