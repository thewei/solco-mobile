// [INPUT]: expo-file-system (the app's private document folder), imported lazily so nothing here needs a native module at test time.
// [OUTPUT]: `loadLastAssistant()` / `saveLastAssistant(id)` — which Assistant's chat the phone opened last, across app restarts.
// [POS]: native twin (`last-assistant-storage.web.ts` is the browser one). A preference, not a secret — an opaque Assistant id the
//        Assistants entry screen uses to open that chat directly. Not SecureStore, never a credential.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every failure is swallowed ('' = none; a lost preference only shows the list); nothing here is logged.
const FILE = 'last-assistant.txt';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, FILE);
}

export async function loadLastAssistant(): Promise<string> {
  try {
    const f = await file();
    return f.exists ? (await f.text()).trim().slice(0, 64) : '';
  } catch {
    return '';
  }
}

export async function saveLastAssistant(id: string): Promise<void> {
  try {
    const f = await file();
    if (!f.exists) f.create();
    f.write(id.slice(0, 64));
  } catch {
    // keep going; the next open retries
  }
}
