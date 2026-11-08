// [PROTOCOL]: 会话本地态——客户端当前选的 Herdr session（instance，不持久化）+ Home composer 上次的 Agent/Terminal 选择（持久化，跨重启）。
// Position: 不移动 Mac 导航；凭据/连接配置不入 Zustand（那是 SecureStore / host-connection-v3 边界）。选择偏好只落 launch-pick-storage（App 私有文件 / localStorage），不含任何凭据。
import { create } from 'zustand';

import { loadLaunchPick, saveLaunchPick } from '@/lib/launch-pick-storage';

interface SessionState {
  /** 当前 Herdr session（instance id）；null = Host 列出的第一个。 */
  instanceId: string | null;
  selectInstance: (instanceId: string | null) => void;
  /** Home composer's last pick; survives leaving Home for a Chat and an app restart. The composer re-validates it against the Host's kinds. */
  launchAgent: string | null;
  launchTerminal: boolean;
  setLaunchPick: (pick: { agent?: string | null; terminal?: boolean }) => void;
}

// A pick made before the stored one has been read wins over it.
let touched = false;

export const useSessionStore = create<SessionState>((set, get) => ({
  instanceId: null,
  selectInstance: (instanceId) => set({ instanceId }),
  launchAgent: null,
  launchTerminal: false,
  setLaunchPick: (pick) => {
    touched = true;
    set((state) => ({
      launchAgent: pick.agent === undefined ? state.launchAgent : pick.agent,
      launchTerminal: pick.terminal ?? state.launchTerminal,
    }));
    const { launchAgent, launchTerminal } = get();
    void saveLaunchPick({ agent: launchAgent, terminal: launchTerminal });
  },
}));

/** Read the stored pick into the store (once, at app start). */
export async function hydrateLaunchPick(): Promise<void> {
  const stored = await loadLaunchPick();
  if (touched) return;
  useSessionStore.setState({ launchAgent: stored.agent, launchTerminal: stored.terminal });
}

/** Test seam: forget "the user already picked". */
export function resetLaunchPickHydration(): void {
  touched = false;
}
