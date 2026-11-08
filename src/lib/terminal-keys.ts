// [INPUT]: a key-row press (a key id) or a typed IME chunk, plus the sticky Ctrl/Alt state.
// [OUTPUT]: `KEY_ROW` (the one key row's content), `FN_ROW`, `ignoresMods`, `keyInput` / `composeTyped` → a `TerminalInput` for the Host (null = send the typed text as is), `isRepeatKey`.
// [POS]: Pure core of the terminal's single key row (2026-11-07: the library's own row is hidden on Android, this one stays above the keyboard).
//        Herdr's send_keys knows esc/tab/arrows/f-keys/ctrl+x/alt+x but not Home/End/PgUp/PgDn, so those go as the xterm sequences.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { PAGE_DOWN, PAGE_UP } from '@/lib/page-keys';
import type { TerminalInput } from '@/lib/terminal-protocol-v3';

export interface Mods {
  ctrl: boolean;
  alt: boolean;
}

/** `toggle` swaps the row between the main keys and the F-keys; it sends nothing itself. */
export type KeyKind = 'named' | 'literal' | 'symbol' | 'mod' | 'toggle';

export interface KeyDef {
  id: string;
  label: string;
  kind: KeyKind;
}

const ESC = '\u001b';
const LITERAL: Record<string, string> = { home: `${ESC}[H`, end: `${ESC}[F`, pgup: PAGE_UP, pgdn: PAGE_DOWN };
const NO_MODS = new Set(['esc', 'tab', 'ctrl+c']);
const F_KEY = /^f([1-9]|1[0-2])$/;
const REPEAT = new Set(['up', 'down', 'left', 'right', 'pgup', 'pgdn']);

export const KEY_ROW: KeyDef[] = [
  { id: 'esc', label: 'Esc', kind: 'named' },
  { id: 'tab', label: 'Tab', kind: 'named' },
  { id: 'ctrl', label: 'Ctrl', kind: 'mod' },
  { id: 'alt', label: 'Alt', kind: 'mod' },
  { id: 'ctrl+c', label: '^C', kind: 'named' },
  { id: 'left', label: '←', kind: 'named' },
  { id: 'down', label: '↓', kind: 'named' },
  { id: 'up', label: '↑', kind: 'named' },
  { id: 'right', label: '→', kind: 'named' },
  { id: 'home', label: 'Home', kind: 'literal' },
  { id: 'end', label: 'End', kind: 'literal' },
  { id: 'pgup', label: 'PgUp', kind: 'literal' },
  { id: 'pgdn', label: 'PgDn', kind: 'literal' },
  { id: 'fn', label: 'Fn', kind: 'toggle' },
  ...['|', '/', '~', '-', '_', '\\', '`'].map((ch): KeyDef => ({ id: ch, label: ch, kind: 'symbol' })),
];

/** The F-key page of the row (htop F10, mc, nano ...): F1-F12 behind a way back to the main keys. */
export const FN_ROW: KeyDef[] = [
  { id: 'fn', label: '‹ Keys', kind: 'toggle' },
  ...Array.from({ length: 12 }, (_, i): KeyDef => ({ id: `f${i + 1}`, label: `F${i + 1}`, kind: 'named' })),
];

/** Keys that neither use nor spend the sticky Ctrl/Alt (they stay armed for the next real key). */
export function ignoresMods(id: string): boolean {
  return NO_MODS.has(id) || id in LITERAL || F_KEY.test(id);
}

/** Held arrows and paging keys repeat; everything else fires once. */
export function isRepeatKey(id: string): boolean {
  return REPEAT.has(id);
}

/** What a key-row press sends. Sticky Ctrl wins over Alt for named keys (Herdr has no ctrl+alt+x); Alt prefixes ESC on symbols. */
export function keyInput(id: string, mods: Mods): TerminalInput {
  const literal = LITERAL[id];
  if (literal !== undefined) return { text: literal };
  if (id.length === 1 && !/[a-z]/i.test(id)) return { text: mods.alt ? ESC + id : id };
  if (NO_MODS.has(id) || F_KEY.test(id)) return { keys: [id] };
  if (mods.ctrl) return { keys: [`ctrl+${id}`] };
  if (mods.alt) return { keys: [`alt+${id}`] };
  return { keys: [id] };
}

/**
 * A chunk typed on the keyboard while Ctrl/Alt is armed becomes the chord. Only single characters compose (an IME
 * commit such as a CJK phrase is never a chord); null = nothing armed or not composable, send the text unchanged.
 */
export function composeTyped(data: string, mods: Mods): TerminalInput | null {
  if ((!mods.ctrl && !mods.alt) || [...data].length !== 1) return null;
  const lower = data.toLowerCase();
  if (mods.ctrl) {
    if (!mods.alt && lower >= 'a' && lower <= 'z') return { keys: [`ctrl+${lower}`] };
    const code = data === ' ' ? 0x40 : data === '/' ? 0x5f : data.toUpperCase().charCodeAt(0);
    if (code < 0x40 || code > 0x5f) return null;
    const control = String.fromCharCode(code - 0x40);
    return { text: mods.alt ? ESC + control : control };
  }
  return { text: ESC + data };
}
