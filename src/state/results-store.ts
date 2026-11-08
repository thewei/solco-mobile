// [PROTOCOL]: 客户端本地的「任务结果卡片已读水位」，每个 Assistant 一个时间戳，经 results-seen-storage 落在 App 私有文件 / localStorage，跨重启保留。
// Position: 只决定 Assistant 聊天窗口里哪些已结束任务的结果卡片不再显示；只存 Assistant id 与时间戳，不含任务内容、凭据，不动 Mac 状态。
import { create } from 'zustand';

import { loadResultsSeen, saveResultsSeen } from '@/lib/results-seen-storage';

interface ResultsState {
  /** Assistant id → the newest result time the person dismissed; cards at or before it stay hidden. */
  seen: Record<string, number>;
  dismiss: (assistantId: string, at: number) => void;
}

export const useResultsStore = create<ResultsState>((set, get) => ({
  seen: {},
  dismiss: (assistantId, at) => {
    set((state) => ({ seen: { ...state.seen, [assistantId]: Math.max(state.seen[assistantId] ?? 0, at) } }));
    void saveResultsSeen(get().seen);
  },
}));

/** Read the stored watermarks into the store (once, at app start); a dismissal made before the read finishes is kept (newest wins). */
export async function hydrateResultsSeen(): Promise<void> {
  const stored = await loadResultsSeen();
  useResultsStore.setState((state) => {
    const seen = { ...state.seen };
    for (const [id, at] of Object.entries(stored)) seen[id] = Math.max(seen[id] ?? 0, at);
    return { seen };
  });
}
