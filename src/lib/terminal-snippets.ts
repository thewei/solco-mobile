// [INPUT]: the raw text a storage twin read back (anything), a line the user typed or chose to keep, an id.
// [OUTPUT]: `Snippet`, `parseSnippets`, `serializeSnippets`, `addSnippet`, `removeSnippet`, `pushRecent`, and the in-memory `recentLines` store (`getRecent`, `rememberLine`).
// [POS]: pure core of the terminal composer's snippets (lines the user saved on purpose, kept on the phone) and recent lines.
// Invariants: recent lines live in memory only — a line typed into the composer may be a password at a prompt, so none is ever written to disk;
//             only an explicit Save puts text into the persisted snippets; unreadable storage is an empty list; single lines only.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { z } from 'zod';

export const MAX_SNIPPETS = 50;
export const MAX_RECENT = 30;
export const MAX_LINE_LENGTH = 1000;

export interface Snippet {
  id: string;
  text: string;
}

const snippetsSchema = z.array(z.object({ id: z.string().min(1), text: z.string().min(1).max(MAX_LINE_LENGTH) }));

const isLine = (text: string) => text.trim() !== '' && text.length <= MAX_LINE_LENGTH && !/[\r\n]/.test(text);

export function parseSnippets(raw: string | null | undefined): Snippet[] {
  if (!raw) return [];
  try {
    const parsed = snippetsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.filter((s) => isLine(s.text)).slice(0, MAX_SNIPPETS) : [];
  } catch {
    return [];
  }
}

export function serializeSnippets(list: readonly Snippet[]): string {
  return JSON.stringify(list.slice(0, MAX_SNIPPETS));
}

/** Newest first; a line already saved is not saved twice; a blank or multi-line text is ignored. */
export function addSnippet(list: readonly Snippet[], text: string, id: string): Snippet[] {
  const line = text.trim();
  if (!isLine(line) || list.some((s) => s.text === line)) return [...list];
  return [{ id, text: line }, ...list].slice(0, MAX_SNIPPETS);
}

export function removeSnippet(list: readonly Snippet[], id: string): Snippet[] {
  return list.filter((s) => s.id !== id);
}

/** Newest first, de-duplicated, capped; a blank or multi-line text is ignored. */
export function pushRecent(list: readonly string[], text: string): string[] {
  const line = text.trim();
  if (!isLine(line)) return [...list];
  return [line, ...list.filter((l) => l !== line)].slice(0, MAX_RECENT);
}

let recent: string[] = [];
export const getRecent = (): readonly string[] => recent;
export function rememberLine(text: string): void {
  recent = pushRecent(recent, text);
}
