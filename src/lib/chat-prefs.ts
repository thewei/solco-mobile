// [INPUT]: stored JSON string from chat-prefs-storage.
// [OUTPUT]: `parseChatPrefs(raw)` / `serializeChatPrefs(prefs)` / `DEFAULT_CHAT_PREFS`.
// [POS]: pure codec for chat-related preferences (TOC outline rail). Harmless UI preference, never a credential.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { z } from 'zod';

export interface ChatPrefs {
  chatOutline: boolean;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = {
  chatOutline: false,
};

const ChatPrefsSchema = z.object({
  chatOutline: z.boolean().catch(false),
});

export function parseChatPrefs(raw: string | null | undefined): ChatPrefs {
  if (!raw) return DEFAULT_CHAT_PREFS;
  try {
    const parsed = JSON.parse(raw);
    const result = ChatPrefsSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_CHAT_PREFS;
  } catch {
    return DEFAULT_CHAT_PREFS;
  }
}

export function serializeChatPrefs(prefs: ChatPrefs): string {
  return JSON.stringify(prefs);
}
