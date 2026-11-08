// [PROTOCOL]: 客户端本地的外观选择（跟随系统 / 浅色 / 深色），经 appearance-storage 落在 App 私有文件 / localStorage，跨重启保留。
// Position: 只决定应用画哪一套调色板；根布局据此（加系统方案）算出方案并在换方案时重挂载界面。只存一个枚举，不含任何凭据，不动 Mac 状态。
import { create } from 'zustand';

import { DEFAULT_APPEARANCE, type Appearance } from '@/lib/appearance';
import { loadAppearance, saveAppearance } from '@/lib/appearance-storage';

interface AppearanceState {
  appearance: Appearance;
  /** True once the stored choice was read; the root layout keeps the splash up until then so no frame draws the wrong palette. */
  hydrated: boolean;
  setAppearance: (appearance: Appearance) => void;
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: DEFAULT_APPEARANCE,
  hydrated: false,
  setAppearance: (appearance) => {
    set({ appearance, hydrated: true });
    void saveAppearance(get().appearance);
  },
}));

/** Read the stored choice into the store (once, at app start); a choice made before the read finishes wins. */
export async function hydrateAppearance(): Promise<void> {
  const stored = await loadAppearance();
  useAppearanceStore.setState((state) => ({ appearance: state.hydrated ? state.appearance : stored, hydrated: true }));
}
