// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadResultsSeen()` / `saveResultsSeen(seen)` — same contract as the native module.
// [POS]: Web/PWA twin of `results-seen-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { parseResultsSeen, serializeResultsSeen, type ResultsSeen } from '@/lib/results-seen';

const KEY = 'solco.resultsSeen';

export async function loadResultsSeen(): Promise<ResultsSeen> {
  try {
    return parseResultsSeen(globalThis.localStorage?.getItem(KEY));
  } catch {
    return {};
  }
}

export async function saveResultsSeen(seen: ResultsSeen): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, serializeResultsSeen(seen));
  } catch {
    // private mode / quota: nothing to keep
  }
}
