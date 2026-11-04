// [INPUT]: react-native-webrtc (autolinked; see lib/p2p-native.ts for why its config plugin is not used) and
//          the Remote Desktop PeerEvents (features/remote-desktop/session.ts).
// [OUTPUT]: getRdPeerFactory() → the `RdPeerFactory` the session drives, or null where WebRTC is absent;
//           RdVideo → the native video surface for a stream URL (null-render where WebRTC is absent).
// [POS]: With lib/p2p-native.ts, the only files that import react-native-webrtc. One RTCPeerConnection per
//        Remote Desktop session: a receive-only H.264 video transceiver, an ordered/reliable `control`
//        channel and an unordered `pointer` channel (maxRetransmits 0), a complete non-trickle offer
//        (lib/ice-gather), and a few seconds of grace for a transient `disconnected`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { createElement, type ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { RD_CHANNEL_CONTROL, RD_CHANNEL_POINTER } from '@/contracts/host-v3';
import type { PeerEvents, RdPeer, RdPeerFactory } from '@/features/remote-desktop/session';
import { waitForUsableOffer } from '@/lib/ice-gather';

const GATHER_TIMEOUT_MS = 4_000;
const GATHER_SRFLX_GRACE_MS = 1_000;
const DISCONNECT_GRACE_MS = 2_500;

interface ChannelLike {
  readyState: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  send: (text: string) => void;
  close: () => void;
}
interface CodecLike {
  mimeType: string;
}
interface TransceiverLike {
  setCodecPreferences?: (codecs: CodecLike[]) => void;
}
interface StreamLike {
  toURL(): string;
}
interface PeerLike {
  iceGatheringState: string;
  connectionState: string;
  localDescription: { sdp: string } | null;
  onicecandidate: ((event: { candidate: { candidate: string } | null }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((event: { streams: StreamLike[] }) => void) | null;
  addTransceiver: (kind: 'video', init: { direction: 'recvonly' }) => TransceiverLike;
  createDataChannel: (label: string, options: { ordered: boolean; maxRetransmits?: number }) => ChannelLike;
  createOffer: (options: Record<string, never>) => Promise<{ sdp: string }>;
  setLocalDescription: (description: { type?: string; sdp: string }) => Promise<void>;
  setRemoteDescription: (description: { type?: string; sdp: string }) => Promise<void>;
  close: () => void;
}
interface WebRtcModule {
  RTCPeerConnection?: new (config: { iceServers: { urls: string | string[]; username?: string; credential?: string }[] }) => PeerLike;
  RTCRtpReceiver?: { getCapabilities?: (kind: 'video') => { codecs: CodecLike[] } | null };
  RTCView?: ComponentType<{ streamURL?: string; objectFit?: 'contain' | 'cover'; style?: StyleProp<ViewStyle>; zOrder?: number }>;
}

function loadWebRtc(): WebRtcModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-webrtc') as WebRtcModule;
  } catch {
    return undefined;
  }
}

/** H.264 first (what the Mac encodes in hardware), the rest after it so a negotiation can never end up codec-less. */
function preferH264(transceiver: TransceiverLike, webrtc: WebRtcModule): void {
  try {
    const codecs = webrtc.RTCRtpReceiver?.getCapabilities?.('video')?.codecs;
    if (!codecs || !transceiver.setCodecPreferences) return;
    const h264 = codecs.filter((c) => /h264/i.test(c.mimeType));
    if (h264.length === 0) return;
    transceiver.setCodecPreferences([...h264, ...codecs.filter((c) => !/h264/i.test(c.mimeType))]);
  } catch {
    // keep the platform default order
  }
}

export function getRdPeerFactory(): RdPeerFactory | null {
  const webrtc = loadWebRtc();
  const PC = webrtc?.RTCPeerConnection;
  if (!webrtc || !PC) return null;
  return (iceServers, events: PeerEvents): RdPeer => {
    const pc = new PC({ iceServers: iceServers.map((s) => ({ urls: s.urls, username: s.username, credential: s.credential })) });
    let control: ChannelLike | null = null;
    let pointer: ChannelLike | null = null;
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) events.onStream(stream.toURL());
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      clearTimeout(disconnectTimer);
      if (state === 'connected') events.onState('connected');
      else if (state === 'failed' || state === 'closed') events.onState(state);
      else if (state === 'disconnected') {
        events.onState('disconnected');
        disconnectTimer = setTimeout(() => events.onState('failed'), DISCONNECT_GRACE_MS);
      }
    };

    return {
      async createOffer() {
        preferH264(pc.addTransceiver('video', { direction: 'recvonly' }), webrtc);
        const c = pc.createDataChannel(RD_CHANNEL_CONTROL, { ordered: true });
        control = c;
        c.onopen = () => events.onControlOpen();
        c.onclose = () => events.onControlClose();
        c.onmessage = (e) => {
          if (typeof e.data === 'string') events.onControlText(e.data);
        };
        const p = pc.createDataChannel(RD_CHANNEL_POINTER, { ordered: false, maxRetransmits: 0 });
        pointer = p;
        p.onopen = () => events.onPointerOpen();
        const gathered = waitForUsableOffer(pc, { timeoutMs: GATHER_TIMEOUT_MS, graceMs: GATHER_SRFLX_GRACE_MS });
        await pc.setLocalDescription(await pc.createOffer({}));
        await gathered;
        const sdp = pc.localDescription?.sdp;
        if (!sdp) throw new Error('no local description');
        return sdp;
      },
      accept: (sdp) => pc.setRemoteDescription({ type: 'answer', sdp }),
      sendControl(text) {
        if (!control || control.readyState !== 'open') return false;
        control.send(text);
        return true;
      },
      sendPointer(text) {
        if (!pointer || pointer.readyState !== 'open') return false;
        pointer.send(text);
        return true;
      },
      close() {
        clearTimeout(disconnectTimer);
        for (const c of [control, pointer]) {
          try {
            c?.close();
          } catch {
            // already closed
          }
        }
        pc.close();
      },
    };
  };
}

/** The native video surface; `objectFit="contain"` letterboxes exactly as features/remote-desktop/geometry assumes. */
export function RdVideo({ streamURL, style }: { streamURL: string; style?: StyleProp<ViewStyle> }) {
  const View = loadWebRtc()?.RTCView;
  return View ? createElement(View, { streamURL, objectFit: 'contain', style }) : null;
}
