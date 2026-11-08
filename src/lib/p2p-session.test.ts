import { describe, expect, it, vi } from 'vitest';

import { createReassembler, fragmentFrame } from '@/lib/p2p-codec';
import { openP2PRoute, type P2PPeer, type P2PPeerHandlers, type P2PSignalling } from '@/lib/p2p-session';

/** A peer whose "network" is a callback pair into a fake Mac. */
function fakePeer(options: { open?: boolean } = {}) {
  let handlers!: P2PPeerHandlers;
  const sent: string[] = [];
  const mac = createReassembler((json) => {
    sent.push(json);
    const frame = JSON.parse(json) as { t: string; id: string };
    if (frame.t === 'hreq') {
      for (const f of [{ t: 'hres', id: frame.id, status: 200, headers: {} }, { t: 'hend', id: frame.id }]) {
        for (const m of fragmentFrame(JSON.stringify(f))) handlers.onMessage(m);
      }
    }
  });
  const peer: P2PPeer & { handlers(): P2PPeerHandlers; closed: boolean; accepted?: string } = {
    closed: false,
    handlers: () => handlers,
    async offer(h) {
      handlers = h;
      if (options.open !== false) queueMicrotask(() => h.onOpen());
      return 'v=0 offer';
    },
    async accept(sdp) {
      peer.accepted = sdp;
    },
    send: (bytes) => mac.push(bytes),
    close: () => {
      peer.closed = true;
    },
  };
  return { peer, sent };
}

const signalling = (over: Partial<P2PSignalling> = {}): P2PSignalling => ({
  p2pIce: async () => [{ urls: ['stun:stun.example.test:3478'] }],
  p2pSession: async () => ({ sessionId: 's1', sdp: 'v=0 answer' }),
  ...over,
});

describe('openP2PRoute', () => {
  it('walks ice → offer → session → accept → open, then serves requests through the tunnel', async () => {
    const { peer, sent } = fakePeer();
    const createPeer = vi.fn(() => peer);
    const sig = signalling();
    const route = await openP2PRoute(sig, createPeer, 1000);
    expect(createPeer).toHaveBeenCalledWith([{ urls: ['stun:stun.example.test:3478'] }]);
    expect(peer.accepted).toBe('v=0 answer');
    const response = await route.request({ url: 'https://host.p2p/api/v3/bootstrap' });
    expect(response.status).toBe(200);
    expect(JSON.parse(sent[0]!)).toMatchObject({ t: 'hreq', path: '/api/v3/bootstrap' });
  });

  it('posts the gathered offer exactly as the peer produced it', async () => {
    const { peer } = fakePeer();
    const p2pSession = vi.fn(async () => ({ sessionId: 's', sdp: 'ans' }));
    await openP2PRoute(signalling({ p2pSession }), () => peer, 1000);
    expect(p2pSession).toHaveBeenCalledWith('v=0 offer');
  });

  it('a channel that never opens fails in time and closes the peer', async () => {
    const { peer } = fakePeer({ open: false });
    await expect(openP2PRoute(signalling(), () => peer, 30)).rejects.toThrow('did not connect in time');
    expect(peer.closed).toBe(true);
  });

  it('unavailable signalling (Mac without P2P) fails before any peer exists', async () => {
    const createPeer = vi.fn();
    await expect(
      openP2PRoute(signalling({ p2pIce: async () => Promise.reject(new Error('p2p_unavailable')) }), createPeer as never, 1000),
    ).rejects.toThrow('p2p_unavailable');
    expect(createPeer).not.toHaveBeenCalled();
  });

  it('a refused session closes the half-built peer', async () => {
    const { peer } = fakePeer();
    await expect(openP2PRoute(signalling({ p2pSession: async () => Promise.reject(new Error('502')) }), () => peer, 1000)).rejects.toThrow('502');
    expect(peer.closed).toBe(true);
  });

  it('a channel that ends on its own fails requests and tells the owner once; a caller close stays quiet', async () => {
    const { peer } = fakePeer();
    const route = await openP2PRoute(signalling(), () => peer, 1000);
    const closed = vi.fn();
    route.onClose(closed);
    peer.handlers().onClose();
    peer.handlers().onClose();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(peer.closed).toBe(true);
    await expect(route.request({ url: 'https://host.p2p/x' })).rejects.toThrow();

    const second = fakePeer();
    const quiet = await openP2PRoute(signalling(), () => second.peer, 1000);
    const heard = vi.fn();
    quiet.onClose(heard);
    quiet.close();
    expect(heard).not.toHaveBeenCalled();
    expect(second.peer.closed).toBe(true);
  });
});
