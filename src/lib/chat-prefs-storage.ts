// [INPUT]: expo-file-system (the app's private document folder), imported lazily so the codec stays Node-testable.
// [OUTPUT]: `loadChatPrefs()` / `saveChatPrefs(prefs)` — chat preferences across app restarts.
// [POS]: native twin (`chat-prefs-storage.web.ts` is the browser one). Not SecureStore: it is a preference, not a secret.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { DEFAULT_CHAT_PREFS, parseChatPrefs, serializeChatPrefs, type ChatPrefs } from '@/lib/chat-prefs';

const FILE = 'chat-prefs.json';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, FILE);
}

export async function loadChatPrefs(): Promise<ChatPrefs> {
  try {
    const f = await file();
    return f.exists ? parseChatPrefs(await f.text()) : DEFAULT_CHAT_PREFS;
  } catch {
    return DEFAULT_CHAT_PREFS;
  }
}

export async function saveChatPrefs(prefs: ChatPrefs): Promise<void> {
  try {
    const f = await file();
    if (!f.exists) f.create();
    f.write(serializeChatPrefs(prefs));
  } catch {
    // keep the in-memory choice; the next change retries
  }
}
