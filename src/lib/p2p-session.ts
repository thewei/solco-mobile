// [INPUT]: the signalling calls of a HostClientV3 on an already-working route (ice, session) and an
//          injected `createPeer` (lib/p2p-native binds react-native-webrtc; tests pass a fake).
// [OUTPUT]: openP2PRoute → an open P2PRoute (+ `close`, `onClose`), or a typed failure.
// [POS]: One attempt to upgrade a relayed Mac to a WebRTC DataChannel: fetch the Mac's ICE servers,
//        create the "solco" channel and gather a complete offer, POST it, apply the answer, wait for the
//        channel to open, then hand the P2PTunnel to the host client as a route. Signalling rides the
//        route that already works (the relay), so it is authenticated by the device token and needs no
//        new service; any failure leaves that route untouched.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { P2PIceServer, P2PSessionAnswer } from '@/contracts/host-v3';
import type { P2PRoute } from '@/lib/host-client-v3';
import { P2PTunnel } from '@/lib/p2p-tunnel';

export const P2P_OPEN_TIMEOUT_MS = 12_000;

export interface P2PPeerHandlers {
  onOpen(): void;
  onMessage(bytes: Uint8Array): void;
  onClose(): void;
}

/** What the native WebRTC layer must provide for one connection to the Mac. */
export interface P2PPeer {
  /** Create the ordered, reliable "solco" channel, gather every ICE candidate and return the offer SDP. */
  offer(handlers: P2PPeerHandlers): Promise<string>;
  accept(answerSdp: string): Promise<void>;
  send(bytes: Uint8Array): void;
  close(): void;
}

export type CreatePeer = (iceServers: P2PIceServer[]) => P2PPeer;

export interface P2PSignalling {
  p2pIce(): Promise<P2PIceServer[]>;
  p2pSession(sdp: string): Promise<P2PSessionAnswer>;
}

export interface OpenP2PRoute extends P2PRoute {
  /** Tear the connection down; the close callback does not fire for a caller-initiated close. */
  close(): void;
  /** Called once when the channel ends on its own (network change, the Mac revoked the device or went away). */
  onClose(listener: () => void): void;
}

export class P2PUnavailableError extends Error {
  constructor(message = 'P2P is not available on this Mac') {
    super(message);
    this.name = 'P2PUnavailableError';
  }
}

export async function openP2PRoute(
  signalling: P2PSignalling,
  createPeer: CreatePeer,
  openTimeoutMs = P2P_OPEN_TIMEOUT_MS,
): Promise<OpenP2PRoute> {
  const iceServers = await signalling.p2pIce();
  const peer = createPeer(iceServers);
  let tunnel: P2PTunnel | null = null;
  let userClosed = false;
  let ended = false;
  const listeners: (() => void)[] = [];
  const finish = (error?: Error) => {
    if (ended) return;
    ended = true;
    tunnel?.fail(error);
    peer.close();
    if (!userClosed) for (const listener of listeners) listener();
  };

  let opened!: () => void;
  const open = new Promise<void>((resolve) => (opened = resolve));
  try {
    tunnel = new P2PTunnel((bytes) => peer.send(bytes));
    const sdp = await peer.offer({
      onOpen: () => opened(),
      onMessage: (bytes) => tunnel?.receive(bytes),
      onClose: () => finish(new Error('the P2P link closed')),
    });
    const answer = await signalling.p2pSession(sdp);
    await peer.accept(answer.sdp);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('P2P did not connect in time')), openTimeoutMs);
    });
    try {
      await Promise.race([open, timeout]);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    userClosed = true; // an attempt that never opened has nobody to tell
    finish();
    throw error;
  }
  const live = tunnel;
  return {
    request: (init) => live.request(init),
    openSocket: (url, handlers) => live.openSocket(url, handlers),
    close() {
      userClosed = true;
      finish(new Error('the P2P link was closed'));
    },
    onClose(listener) {
      if (ended && !userClosed) queueMicrotask(listener);
      else listeners.push(listener);
    },
  };
}
