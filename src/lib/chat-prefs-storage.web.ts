// [INPUT]: the browser's localStorage.
// [OUTPUT]: `loadChatPrefs()` / `saveChatPrefs(prefs)` — same contract as the native module.
// [POS]: Web/PWA twin of `chat-prefs-storage.ts`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { DEFAULT_CHAT_PREFS, parseChatPrefs, serializeChatPrefs, type ChatPrefs } from '@/lib/chat-prefs';

const KEY = 'solco.chat-prefs';

export async function loadChatPrefs(): Promise<ChatPrefs> {
  try {
    return parseChatPrefs(globalThis.localStorage?.getItem(KEY));
  } catch {
    return DEFAULT_CHAT_PREFS;
  }
}

export async function saveChatPrefs(prefs: ChatPrefs): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, serializeChatPrefs(prefs));
  } catch {
    // private mode / quota: nothing to keep
  }
}
