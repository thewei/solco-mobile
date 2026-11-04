// [INPUT]: a Sender (protocol.ts) and the user's taps on the special-key panel.
// [OUTPUT]: the keyboard's three pages (letters, symbols & navigation, shortcuts: W3C `code` names the Mac's
//           keymap knows), shortcut presets and `KeyComposer` — one-shot / locked modifiers around a key tap,
//           with the chord returned so a held key can repeat it.
// [POS]: Keyboard semantics of Remote Desktop. The compose bar's characters travel as `text.insert`
//        (Unicode, IME, dictation); the full on-screen keyboard (components/remote-desktop/virtual-keyboard)
//        sends physical keys through here, so it can do what a phone keyboard cannot: ⌘/⌃/⌥ chords, several
//        modifiers at once, F-keys, held repeats.
// [PROTOCOL]: 变更时更新此头部
import type { Sender } from './protocol';

export type Modifier = 'Control' | 'Alt' | 'Shift' | 'Meta';
export const MODIFIER_CODE: Record<Modifier, string> = { Control: 'ControlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft' };
export const MODIFIER_ORDER: readonly Modifier[] = ['Meta', 'Control', 'Alt', 'Shift'];
/** Mac glyph per modifier (the panel is for a Mac). */
export const MODIFIER_LABEL: Record<Modifier, string> = { Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' };

export interface KeyDef {
  code: string;
  label: string;
}

export const NAV_KEYS: readonly KeyDef[] = [
  { code: 'Escape', label: 'Esc' },
  { code: 'Tab', label: 'Tab' },
  { code: 'Backspace', label: '⌫' },
  { code: 'Delete', label: 'Del' },
  { code: 'Enter', label: '⏎' },
  { code: 'Space', label: 'Space' },
  { code: 'ArrowLeft', label: '←' },
  { code: 'ArrowUp', label: '↑' },
  { code: 'ArrowDown', label: '↓' },
  { code: 'ArrowRight', label: '→' },
  { code: 'Home', label: 'Home' },
  { code: 'End', label: 'End' },
  { code: 'PageUp', label: 'PgUp' },
  { code: 'PageDown', label: 'PgDn' },
];
export const FUNCTION_KEYS: readonly KeyDef[] = Array.from({ length: 12 }, (_, i) => ({ code: `F${i + 1}`, label: `F${i + 1}` }));

/** One cap of the on-screen keyboard. `shift` is the glyph shown (not sent) while Shift is latched. */
export interface KbKey {
  /** W3C code sent to the Mac; empty for a modifier. */
  code: string;
  label: string;
  shift?: string;
  /** Flex weight of the cap in its row (default 1). */
  w?: number;
  mod?: Modifier;
  /** Held down, the key repeats (Backspace, arrows, letters — as on a real keyboard). */
  repeat?: boolean;
}

const letter = (c: string): KbKey => ({ code: `Key${c.toUpperCase()}`, label: c, shift: c.toUpperCase(), repeat: true });
const digit = (d: string, shift: string): KbKey => ({ code: `Digit${d}`, label: d, shift, repeat: true });
const sym = (code: string, label: string, shift: string): KbKey => ({ code, label, shift, repeat: true });
const key = (code: string, label: string, w = 1): KbKey => ({ code, label, w, repeat: true });
const mod = (m: Modifier, w = 1): KbKey => ({ code: '', label: MODIFIER_LABEL[m], mod: m, w });

/**
 * Page 1: numbers, letters, esc/⇥/⇧/⏎/⌫ and the three punctuation keys typing needs most. Every row spans 11.5
 * units so the caps share one width; the shared bottom row (KB_BOTTOM) sits under every page.
 */
export const KB_MAIN: readonly (readonly KbKey[])[] = [
  [digit('1', '!'), digit('2', '@'), digit('3', '#'), digit('4', '$'), digit('5', '%'), digit('6', '^'), digit('7', '&'), digit('8', '*'), digit('9', '('), digit('0', ')'), key('Backspace', '⌫', 1.5)],
  [key('Tab', '⇥', 1.5), ...'qwertyuiop'.split('').map(letter)],
  [key('Escape', 'esc'), ...'asdfghjkl'.split('').map(letter), key('Enter', '⏎', 1.5)],
  [mod('Shift', 1.5), ...'zxcvbnm'.split('').map(letter), sym('Comma', ',', '<'), sym('Period', '.', '>'), sym('Slash', '/', '?')],
];

/** Page 2: F1–F12, the rest of the punctuation, the navigation block and the keys that edit. */
export const KB_SYMBOLS: readonly (readonly KbKey[])[] = [
  Array.from({ length: 12 }, (_, i) => key(`F${i + 1}`, `F${i + 1}`)),
  [sym('Backquote', '`', '~'), sym('Minus', '-', '_'), sym('Equal', '=', '+'), sym('BracketLeft', '[', '{'), sym('BracketRight', ']', '}'), sym('Backslash', '\\', '|'), sym('Semicolon', ';', ':'), sym('Quote', "'", '"')],
  [key('Home', 'Home'), key('End', 'End'), key('PageUp', 'PgUp'), key('PageDown', 'PgDn'), key('Delete', '⌦'), key('CapsLock', '⇪')],
  [mod('Shift', 1.5), key('Tab', '⇥'), key('Escape', 'esc'), key('Enter', '⏎', 1.5), key('Backspace', '⌫', 1.5)],
];

/** The bottom row, fixed under every page (the page key is appended by the keyboard): modifiers, space, arrows. */
export const KB_BOTTOM: readonly KbKey[] = [
  mod('Control', 1.1), mod('Alt', 1.1), mod('Meta', 1.1), key('Space', 'space', 3.2),
  key('ArrowLeft', '←'), key('ArrowDown', '↓'), key('ArrowUp', '↑'), key('ArrowRight', '→'),
];

export interface Shortcut {
  label: string;
  mods: readonly Modifier[];
  code: string;
}
/** The dock's two window buttons: macOS's own Mission Control (⌃↑) and Show Desktop (F11) bindings. */
export const MISSION_CONTROL: Shortcut = { label: 'Mission Control', mods: ['Control'], code: 'ArrowUp' };
export const SHOW_DESKTOP: Shortcut = { label: 'Show Desktop', mods: [], code: 'F11' };

/** macOS's own bindings behind the three-finger swipes: App Exposé (⌃↓) and the neighbouring Spaces (⌃←/⌃→). */
export const APP_EXPOSE: Shortcut = { label: 'App Exposé', mods: ['Control'], code: 'ArrowDown' };
export const SPACE_LEFT: Shortcut = { label: 'Previous Space', mods: ['Control'], code: 'ArrowLeft' };
export const SPACE_RIGHT: Shortcut = { label: 'Next Space', mods: ['Control'], code: 'ArrowRight' };

/** The shortcuts a phone user reaches for most; anything else is a modifier latch + a key. */
export const SHORTCUTS: readonly Shortcut[] = [
  { label: '⌘C', mods: ['Meta'], code: 'KeyC' },
  { label: '⌘V', mods: ['Meta'], code: 'KeyV' },
  { label: '⌘X', mods: ['Meta'], code: 'KeyX' },
  { label: '⌘A', mods: ['Meta'], code: 'KeyA' },
  { label: '⌘Z', mods: ['Meta'], code: 'KeyZ' },
  { label: '⇧⌘Z', mods: ['Meta', 'Shift'], code: 'KeyZ' },
  { label: '⌘S', mods: ['Meta'], code: 'KeyS' },
  { label: '⌘F', mods: ['Meta'], code: 'KeyF' },
  { label: '⌘T', mods: ['Meta'], code: 'KeyT' },
  { label: '⌘W', mods: ['Meta'], code: 'KeyW' },
  { label: '⌘Tab', mods: ['Meta'], code: 'Tab' },
  { label: '⌘Space', mods: ['Meta'], code: 'Space' },
  { label: '⌃C', mods: ['Control'], code: 'KeyC' },
  MISSION_CONTROL,
  SHOW_DESKTOP,
  APP_EXPOSE,
  SPACE_LEFT,
  SPACE_RIGHT,
  { label: '⌘Q', mods: ['Meta'], code: 'KeyQ' },
  { label: '⌘H', mods: ['Meta'], code: 'KeyH' },
  { label: '⌘N', mods: ['Meta'], code: 'KeyN' },
  { label: '⌘R', mods: ['Meta'], code: 'KeyR' },
  { label: '⌘`', mods: ['Meta'], code: 'Backquote' },
  { label: '⌘,', mods: ['Meta'], code: 'Comma' },
  { label: '⇧⌘3', mods: ['Meta', 'Shift'], code: 'Digit3' },
  { label: '⇧⌘4', mods: ['Meta', 'Shift'], code: 'Digit4' },
  { label: '⌥⌘Esc', mods: ['Meta', 'Alt'], code: 'Escape' },
  { label: '⌃⌘Q', mods: ['Control', 'Meta'], code: 'KeyQ' },
];

type Latch = 'off' | 'once' | 'locked';

/**
 * Modifier latching like a phone's on-screen Shift: tap = applies to the next key only, tap again =
 * locked until tapped once more. A modifier is only *held* on the Mac for the instant of the key tap,
 * so a dropped link can never leave one stuck.
 */
export class KeyComposer {
  private state: Record<Modifier, Latch> = { Control: 'off', Alt: 'off', Shift: 'off', Meta: 'off' };
  private listeners = new Set<() => void>();

  constructor(private readonly send: Sender) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  latch(mod: Modifier): Latch {
    return this.state[mod];
  }

  /** off → once → locked → off */
  cycle(mod: Modifier): void {
    const cur = this.state[mod];
    this.state[mod] = cur === 'off' ? 'once' : cur === 'once' ? 'locked' : 'off';
    this.changed();
  }

  clear(): void {
    for (const m of MODIFIER_ORDER) this.state[m] = 'off';
    this.changed();
  }

  /** Tap `code` with whatever is latched; one-shot latches are spent. Returns the chord's modifiers. */
  press(code: string): readonly Modifier[] {
    const mods = MODIFIER_ORDER.filter((m) => this.state[m] !== 'off');
    this.chord(mods, code);
    for (const m of MODIFIER_ORDER) if (this.state[m] === 'once') this.state[m] = 'off';
    this.changed();
    return mods;
  }

  /** A held key's next repeat: the same chord the first press used (its one-shot latches are already spent). */
  repeat(mods: readonly Modifier[], code: string): void {
    this.chord(mods, code);
  }

  /** A fixed shortcut, ignoring (and preserving) the latches. */
  shortcut(s: Shortcut): void {
    this.chord(s.mods, s.code);
  }

  private chord(mods: readonly Modifier[], code: string): void {
    for (const m of mods) this.send.key(MODIFIER_CODE[m], true);
    this.send.tapKey(code);
    for (const m of [...mods].reverse()) this.send.key(MODIFIER_CODE[m], false);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }
}
