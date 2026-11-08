// [PROTOCOL]: 路由切换提示本地态（不持久化）。
// Position: 只存“刚发生了什么”的一行文案与当前路由快照，不含地址以外的连接信息、凭据或位置；
// Provider 在路由真的变化时 post，RouteNotice 组件读取并自动淡出。同一句话 30 s 内只提示一次。
import { create } from 'zustand';

import { NOTICE_DEDUPE_MS } from '@/lib/route-optimizer';

export interface RouteNoticeState {
  /** The line on screen, or null. `seq` changes on every post so the same text can re-arm the timer. */
  notice: { text: string; seq: number } | null;
  lastText: string | null;
  lastAt: number;
  post: (text: string, now?: number) => void;
  dismiss: () => void;
}

let seq = 0;

export const useRouteNotice = create<RouteNoticeState>((set, get) => ({
  notice: null,
  lastText: null,
  lastAt: 0,
  post: (text, now = Date.now()) => {
    const state = get();
    if (state.lastText === text && now - state.lastAt < NOTICE_DEDUPE_MS) return;
    seq += 1;
    set({ notice: { text, seq }, lastText: text, lastAt: now });
  },
  dismiss: () => set({ notice: null }),
}));
