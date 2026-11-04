// [INPUT]: nothing — Web has no react-native-webrtc.
// [OUTPUT]: the same two exports as rd-native.ts, inert: no peer factory, no video surface.
// [POS]: Web/PWA twin of rd-native.ts (the lib/p2p-native.web.ts pattern): Remote Desktop's screen shows "this build has no WebRTC support".
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { StyleProp, ViewStyle } from 'react-native';

import type { RdPeerFactory } from '@/features/remote-desktop/session';

export function getRdPeerFactory(): RdPeerFactory | null {
  return null;
}

export function RdVideo(_props: { streamURL: string; style?: StyleProp<ViewStyle> }) {
  return null;
}
