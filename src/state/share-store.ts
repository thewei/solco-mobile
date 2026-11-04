// [PROTOCOL]: 会话本地态——系统分享进来、尚待用户挑选去向的那一段文本（不持久化，不含凭据）。
// Position: 只在内存；用户离开分享页或已发往某个 Agent 即清空。不移动 Mac 导航。
import { create } from 'zustand';

interface ShareState {
  /** The shared text waiting for a destination; null = nothing pending. */
  text: string | null;
  receive: (text: string) => void;
  clear: () => void;
}

export const useShareStore = create<ShareState>((set) => ({
  text: null,
  receive: (text) => set({ text }),
  clear: () => set({ text: null }),
}));
