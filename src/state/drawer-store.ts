// [PROTOCOL]: 客户端本地的侧栏视图选择（Agents / Workspaces），仅本次 App 会话内记住，不持久化。
// Position: 只决定 Home 侧栏显示哪张列表；不移动 Mac 导航，不含凭据。
import { create } from 'zustand';

export type DrawerView = 'agents' | 'workspaces';

interface DrawerState {
  view: DrawerView;
  setView: (view: DrawerView) => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  view: 'agents',
  setView: (view) => set({ view }),
}));
