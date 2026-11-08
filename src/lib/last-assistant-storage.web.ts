// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadLastAssistant()` / `saveLastAssistant(id)` — same contract as the native module.
// [POS]: Web/PWA twin of `last-assistant-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
const KEY = 'solco.lastAssistant';

export async function loadLastAssistant(): Promise<string> {
  try {
    return (globalThis.localStorage?.getItem(KEY) ?? '').slice(0, 64);
  } catch {
    return '';
  }
}

export async function saveLastAssistant(id: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, id.slice(0, 64));
  } catch {
    // private mode / quota: nothing to keep
  }
}
