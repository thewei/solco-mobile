// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadPrefs()` / `savePrefs(prefs)` / `readBlob(name)` / `writeBlob(name, text)` — same contract as the native module.
// [POS]: Web/PWA twin of `terminal-prefs-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { parsePrefs, serializePrefs, type TerminalPrefs } from '@/lib/terminal-prefs';

const key = (name: string) => `solco.terminal${name.charAt(0).toUpperCase()}${name.slice(1)}`;

export async function readBlob(name: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key(name)) ?? null;
  } catch {
    return null;
  }
}

export async function writeBlob(name: string, text: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key(name), text);
  } catch {
    // private mode / quota: keep the in-memory value
  }
}

export async function loadPrefs(): Promise<TerminalPrefs> {
  return parsePrefs(await readBlob('prefs'));
}

export async function savePrefs(prefs: TerminalPrefs): Promise<void> {
  await writeBlob('prefs', serializePrefs(prefs));
}
