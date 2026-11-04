// [INPUT]: useHostV3().signal, AppState, expo-network's change listener, the TanStack query cache (every
//          ['v3', …] query) and the P2P hooks of the provider.
// [OUTPUT]: useConnectionHealth() — mount once; no return value.
// [POS]: The wiring of the ConnectionManager to the phone: the phone's network changed (Wi-Fi switched,
//        cellular took over), the app left or returned, a v3 request failed on the way in, or answered.
//        All of it is a signal — what to do about it (race every route, take the fastest, rebuild the sockets,
//        keep looking for a direct path while on the relay) is the manager's, not this file's. Also keeps the
//        P2P overlay's own retry ladder (15 s → 5 min while on the relay and in the foreground).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { isConnectivityFailure } from '@/features/host/connect-failure';
import { useHostV3 } from '@/lib/host-v3-provider';
import { nextP2PDelayMs } from '@/lib/route-optimizer';

export function useConnectionHealth(): void {
  const { activeId, connection, signal, connectP2P, p2pActive } = useHostV3();
  const queryClient = useQueryClient();
  const onRelay = Boolean(connection?.relay);
  const p2p = useRef(connectP2P);
  p2p.current = connectP2P;

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const sub = AppState.addEventListener('change', (state) => signal({ t: state === 'active' ? 'foreground' : 'background' }));
    let netSub: { remove(): void } | undefined;
    let stopped = false;
    void import('expo-network')
      .then((Network) => {
        if (stopped) return;
        // Going offline is not a cue to race (nothing can answer); coming back on a network is.
        netSub = Network.addNetworkStateListener((state) => {
          if (state.isConnected !== false) signal({ t: 'network' });
        });
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      sub.remove();
      netSub?.remove();
    };
  }, [signal]);

  // Any v3 read answering is proof of life; any failing on the way in is a cue. One place instead of one per screen.
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.query.queryKey[0] !== 'v3') return;
        if (event.action.type === 'success') signal({ t: 'alive' });
        else if (event.action.type === 'error' && isConnectivityFailure(event.action.error)) signal({ t: 'failure' });
      }),
    [queryClient, signal],
  );

  // Reached through the relay with no P2P link yet: try to open one at once (then on its own ladder).
  // direct > P2P > relay, so this runs beside the manager's look for a direct path, never instead of it.
  useEffect(() => {
    if (Platform.OS === 'web' || !activeId || !onRelay || p2pActive) return undefined;
    let stopped = false;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!stopped && AppState.currentState === 'active') timer = setTimeout(() => void attempt(), delay);
    };
    const attempt = async () => {
      if (stopped) return;
      try {
        const result = await p2p.current(activeId);
        if (result === 'connected' || result === 'unavailable') return; // unavailable: held for ten minutes by the provider
        misses = result === 'failed' ? misses + 1 : misses;
        schedule(nextP2PDelayMs(misses));
      } catch {
        misses += 1;
        schedule(nextP2PDelayMs(misses));
      }
    };
    schedule(0); // the relay just answered: open the P2P link beside the race for a direct path, not after a wait
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        misses = 0;
        schedule(1_000);
      } else clearTimeout(timer);
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      appSub.remove();
    };
  }, [activeId, onRelay, p2pActive]);
}
