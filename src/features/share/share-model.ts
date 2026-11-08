// [INPUT]: what the system share sheet handed the app (text and/or a web URL, plus the sender's subject).
// [OUTPUT]: sharedPrompt — the one text the phone offers to an agent; MAX_SHARED_CHARS.
// [POS]: Pure model behind "Share to Solco" (Android text/links). The shared text becomes a draft the user reviews
//        and sends; nothing leaves the phone from here and nothing is sent automatically. No IO, no state.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

/** The slice of expo-share-intent's `ShareIntent` this model reads (kept structural so the model needs no native module). */
export interface SharedContent {
  text?: string | null;
  webUrl?: string | null;
  meta?: { title?: string } | null;
}

/** 16 000 characters is at most 64 000 UTF-8 bytes — the Host's own chat text limit. */
export const MAX_SHARED_CHARS = 16_000;

/**
 * "Title\nlink" for a page shared from a browser, the bare text for a selection, null when nothing usable
 * arrived. A link already inside the text is not repeated, and a title the text already carries is dropped.
 */
export function sharedPrompt(content: SharedContent): string | null {
  const text = content.text?.trim() ?? '';
  const url = content.webUrl?.trim() ?? '';
  const body = text && url && !text.includes(url) ? `${text}\n${url}` : text || url;
  if (!body) return null;
  const title = content.meta?.title?.trim() ?? '';
  const withTitle = title && !body.includes(title) ? `${title}\n${body}` : body;
  return withTitle.length > MAX_SHARED_CHARS ? withTitle.slice(0, MAX_SHARED_CHARS) : withTitle;
}
