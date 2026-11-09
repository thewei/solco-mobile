// [INPUT]: stored chat preferences from chat-prefs-storage.
// [OUTPUT]: `useChatPrefsStore` (Zustand) with `chatOutline` and `setChatOutline(on)`; `hydrateChatPrefs()`.
// [POS]: client-local UI preferences for chat view (TOC outline rail).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { create } from 'zustand';

import { DEFAULT_CHAT_PREFS, type ChatPrefs } from '@/lib/chat-prefs';
import { loadChatPrefs, saveChatPrefs } from '@/lib/chat-prefs-storage';

interface ChatPrefsState {
  chatOutline: boolean;
  hydrated: boolean;
  setChatOutline: (chatOutline: boolean) => void;
}

export const useChatPrefsStore = create<ChatPrefsState>((set, get) => ({
  chatOutline: DEFAULT_CHAT_PREFS.chatOutline,
  hydrated: false,
  setChatOutline: (chatOutline) => {
    set({ chatOutline, hydrated: true });
    void saveChatPrefs({ chatOutline: get().chatOutline });
  },
}));

export async function hydrateChatPrefs(): Promise<void> {
  const stored = await loadChatPrefs();
  useChatPrefsStore.setState((state) => ({
    chatOutline: state.hydrated ? state.chatOutline : stored.chatOutline,
    hydrated: true,
  }));
}
