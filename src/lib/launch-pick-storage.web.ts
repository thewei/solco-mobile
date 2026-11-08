// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadLaunchPick()` / `saveLaunchPick(pick)` — same contract as the native module.
// [POS]: Web/PWA twin of `launch-pick-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { NO_LAUNCH_PICK, parseLaunchPick, serializeLaunchPick, type LaunchPick } from '@/lib/launch-pick';

const KEY = 'solco.launchPick';

export async function loadLaunchPick(): Promise<LaunchPick> {
  try {
    return parseLaunchPick(globalThis.localStorage?.getItem(KEY));
  } catch {
    return NO_LAUNCH_PICK;
  }
}

export async function saveLaunchPick(pick: LaunchPick): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, serializeLaunchPick(pick));
  } catch {
    // private mode / quota: keep the in-memory pick
  }
}
