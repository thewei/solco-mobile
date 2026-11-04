// [INPUT]: the active Mac's HostClientV3 (useHostV3) and the native peer factory (lib/rd-native).
// [OUTPUT]: useRemoteDesktop() → { session, snap, supported, start, end } — one RdSession per screen,
//           bound to whichever client is current when `start` runs.
// [POS]: The React edge of the connection state machine. Screens never construct a session or a peer.
//        Off the LAN (the relay, or the P2P link riding it) the STUN/TURN entries the Mac advertises are used —
//        one list for the whole stack, the same one the P2P DataChannel uses — so the video finds a direct
//        hole-punched path (P2P) or a TURN relay; on the LAN/Tailscale none are asked for, so a dead STUN
//        server can never delay a local connection (the Mac does the same, keyed on the offer's candidates).
//        A reconnect always asks (bounded 1.5 s): the route flag lags a Wi-Fi -> cellular switch.
// [PROTOCOL]: 变更时更新此头部
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import type { RdMode, RdTier } from '@/contracts/host-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { getRdPeerFactory } from '@/lib/rd-native';
import { createIceSource } from './ice-source';
import { RdSession } from './session';

export function useRemoteDesktop() {
  const { client, connection, p2pActive } = useHostV3();
  const offLan = Boolean(connection?.relay) || p2pActive;
  const ref = useRef({ client, offLan });
  ref.current = { client, offLan };
  // One cache per screen: primed while the link is healthy, read when it dies (see ice-source.ts).
  const iceSource = useRef(createIceSource({ ask: () => ref.current.client?.p2pIce() ?? null }));

  const [factory] = useState(() => getRdPeerFactory());
  const [session] = useState(
    () =>
      new RdSession({
        host: {
          remoteDesktopSession: (offer) => {
            const c = ref.current.client;
            if (!c) return Promise.reject(new Error('not paired'));
            return c.remoteDesktopSession(offer);
          },
        },
        createPeer: (ice, events) => {
          if (!factory) throw new Error('WebRTC is not available in this build');
          return factory(ice, events);
        },
        trace: (event) => console.info('[rd]', event),
        iceServers: (attempt) => iceSource.current(attempt, ref.current.offLan),
      }),
  );
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // Leaving the screen ends the session; the Mac releases everything it held either way.
  useEffect(() => () => session.end(), [session]);

  // The connection manager moved the Mac to another way in (LAN → relay after a Wi-Fi → cellular switch): an
  // attempt still waiting on the old way is replaced. P2P overlays do not count (they swap `client`, not `connection`).
  const routeKey = connection ? `${connection.relay ? 'relay' : 'direct'}|${connection.host}` : '';
  useEffect(() => session.routeChanged(), [routeKey, session]);

  // The phone's network changed or the app came back: a live link is probed, a reconnect skips its wait.
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const app = AppState.addEventListener('change', (state) => state === 'active' && session.nudge());
    let net: { remove(): void } | undefined;
    let stopped = false;
    void import('expo-network')
      .then((Network) => {
        if (stopped) return;
        net = Network.addNetworkStateListener((state) => state.isConnected !== false && session.nudge());
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      app.remove();
      net?.remove();
    };
  }, [session]);

  const start = useCallback(
    (mode: RdMode, tier?: RdTier, displayId?: string) => session.start({ mode, tier, displayId }),
    [session],
  );
  const end = useCallback(() => session.end(), [session]);
  return { session, snap, supported: factory !== null, start, end };
}
