// [POS]: Web has no native WebRTC binding in this app: P2P degrades to "not available", never to a fake.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { CreatePeer } from '@/lib/p2p-session';

export function getCreatePeer(): CreatePeer | null {
  return null;
}
