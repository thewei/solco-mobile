// [INPUT]: react-native-webrtc (autolinked; its config plugin is NOT used — it would add camera,
//          microphone and overlay permissions, and a DataChannel needs none of them).
// [OUTPUT]: getCreatePeer() → the `CreatePeer` lib/p2p-session drives, or null where WebRTC is absent.
// [POS]: With lib/rd-native.ts, the only files that import react-native-webrtc. One RTCPeerConnection per Mac connection with a
//        single ordered, reliable DataChannel "solco"; the offer is returned once ICE gathering is usable —
//        complete, or a short grace after the first reflexive candidate (lib/ice-gather). Non-trickle: the
//        Mac answers with its candidates in the SDP, so signalling is two plain requests over the route
//        that already works. A transient `disconnected` is given a few
//        seconds to recover before the link is declared dead and the phone falls back to the relay.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { waitForUsableOffer } from '@/lib/ice-gather';
import type { CreatePeer, P2PPeer } from '@/lib/p2p-session';

const GATHER_TIMEOUT_MS = 6_000;
const GATHER_SRFLX_GRACE_MS = 1_500;
const DISCONNECT_GRACE_MS = 8_000;

// react-native-webrtc 的 package.json 指向不存在的 types 文件（lib/typescript/index.d.ts 缺失），
// 这里用本地结构类型钉住 DataChannel 用到的面，而不是让模块类型退化成 any。
interface RTCDataChannelLike {
  binaryType: string;
  readyState: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  send: (bytes: Uint8Array) => void;
  close: () => void;
}

interface RTCPeerConnectionLike {
  iceGatheringState: string;
  connectionState: string;
  localDescription: { sdp: string } | null;
  onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  createDataChannel: (label: string, options: { ordered: boolean }) => RTCDataChannelLike;
  createOffer: (options: Record<string, never>) => Promise<{ sdp: string }>;
  setLocalDescription: (description: { type?: string; sdp: string }) => Promise<void>;
  setRemoteDescription: (description: { type?: string; sdp: string }) => Promise<void>;
  close: () => void;
}

type RTCConstructor = new (config: {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}) => RTCPeerConnectionLike;

// 惰性加载：dev client 没重建原生包时 react-native-webrtc 的 JS 侧在 import 时就抛
function loadRTCPeerConnection(): RTCConstructor | undefined {
  try {
    // 该包无可用的类型声明（package.json 指向的 .d.ts 不存在），形状由上方 RTCConstructor 钉住。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webrtc = require('react-native-webrtc') as { RTCPeerConnection?: RTCConstructor };
    return webrtc.RTCPeerConnection;
  } catch {
    return undefined;
  }
}

export function getCreatePeer(): CreatePeer | null {
  const RTCPeerConnection = loadRTCPeerConnection();
  if (RTCPeerConnection === undefined) return null;
  return (iceServers): P2PPeer => {
    const pc = new RTCPeerConnection({
      iceServers: iceServers.map((server) => ({ urls: server.urls, username: server.username, credential: server.credential })),
    });
    let channel: RTCDataChannelLike | null = null;
    return {
      async offer(handlers) {
        const dc = pc.createDataChannel('solco', { ordered: true });
        channel = dc;
        dc.binaryType = 'arraybuffer';
        dc.onopen = () => handlers.onOpen();
        dc.onclose = () => handlers.onClose();
        dc.onmessage = (event: { data?: unknown }) => {
          const data = event.data;
          if (data instanceof ArrayBuffer) handlers.onMessage(new Uint8Array(data));
        };
        let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          clearTimeout(disconnectTimer);
          if (state === 'failed' || state === 'closed') handlers.onClose();
          else if (state === 'disconnected') disconnectTimer = setTimeout(() => handlers.onClose(), DISCONNECT_GRACE_MS);
        };
        const gathered = waitForUsableOffer(pc, { timeoutMs: GATHER_TIMEOUT_MS, graceMs: GATHER_SRFLX_GRACE_MS });
        await pc.setLocalDescription(await pc.createOffer({}));
        await gathered;
        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error('no local description');
        return sdp;
      },
      accept: (sdp) => pc.setRemoteDescription({ type: 'answer', sdp }),
      send: (bytes) => {
        if (!channel || channel.readyState !== 'open') throw new Error('the P2P channel is not open');
        channel.send(bytes);
      },
      close: () => {
        try {
          channel?.close();
        } catch {
          // already closed
        }
        pc.close();
      },
    };
  };
}
