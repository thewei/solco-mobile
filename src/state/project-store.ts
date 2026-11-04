// [PROTOCOL]: 客户端本地的「当前项目」选择（每个 instance 一个 Workspace id，不持久化）。
// Position: 只决定手机 Changes / Files 标签看哪个 Workspace；不移动 Mac 导航，不含凭据。
import { create } from 'zustand';

interface ProjectState {
  /** Herdr session (instance id) → the Workspace chosen for the scoped tabs. */
  chosen: Record<string, string>;
  choose: (instance: string, workspaceId: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  chosen: {},
  choose: (instance, workspaceId) => set((state) => ({ chosen: { ...state.chosen, [instance]: workspaceId } })),
}));
