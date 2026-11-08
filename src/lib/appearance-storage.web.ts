// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadAppearance()` / `saveAppearance(appearance)` — same contract as the native module.
// [POS]: Web/PWA twin of `appearance-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { DEFAULT_APPEARANCE, parseAppearance, serializeAppearance, type Appearance } from '@/lib/appearance';

const KEY = 'solco.appearance';

export async function loadAppearance(): Promise<Appearance> {
  try {
    return parseAppearance(globalThis.localStorage?.getItem(KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export async function saveAppearance(appearance: Appearance): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, serializeAppearance(appearance));
  } catch {
    // private mode / quota: nothing to keep
  }
}
