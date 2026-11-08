// [INPUT]: expo-file-system (the app's private document folder), imported lazily so the codecs stay Node-testable.
// [OUTPUT]: `loadPrefs()` / `savePrefs(prefs)` — the terminal's font size and theme; `readBlob(name)` / `writeBlob(name, text)` — one small named JSON text (snippets, recent lines).
// [POS]: native twin (`terminal-prefs-storage.web.ts` is the browser one). Not SecureStore: these are preferences and typed lines the user chose to keep, not secrets.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every failure is swallowed (a lost preference must never break the terminal); nothing here is logged.
import { parsePrefs, serializePrefs, type TerminalPrefs } from '@/lib/terminal-prefs';

async function file(name: string) {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, `terminal-${name}.json`);
}

export async function readBlob(name: string): Promise<string | null> {
  try {
    const f = await file(name);
    return f.exists ? await f.text() : null;
  } catch {
    return null;
  }
}

export async function writeBlob(name: string, text: string): Promise<void> {
  try {
    const f = await file(name);
    if (!f.exists) f.create();
    f.write(text);
  } catch {
    // keep the in-memory value; the next change retries
  }
}

export async function loadPrefs(): Promise<TerminalPrefs> {
  return parsePrefs(await readBlob('prefs'));
}

export async function savePrefs(prefs: TerminalPrefs): Promise<void> {
  await writeBlob('prefs', serializePrefs(prefs));
}
