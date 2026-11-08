// [INPUT]: the raw text a storage twin read back (anything, including nothing or garbage), a font size from a pinch or the sheet, a theme name.
// [OUTPUT]: `DEFAULT_FONT_SIZE`, `clampFontSize`, `TERMINAL_THEMES`, `parsePrefs`, `serializePrefs`, `TerminalPrefs`.
// [POS]: pure codec between the terminal page and `terminal-prefs-storage` (native file / web localStorage); UI preferences (font size, color theme), never a credential.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: unreadable input is the defaults (never throws); sizes stay inside the range the phone can still read and the library accepts (4–64 dp); an unknown theme name is the default theme.
import { z } from 'zod';

import { activeScheme, colors } from '@/theme/tokens';

export const DEFAULT_FONT_SIZE = 10;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 24;

/** Terminal colors: background, foreground, cursor, selection and, where the theme needs one, the 16 ANSI colors (else the library's own). */
export interface TerminalTheme {
  label: string;
  background: string;
  foreground: string;
  cursorColor: string;
  selectionBackground: string;
  palette?: readonly string[];
}

const LIGHT_ANSI = [
  '#24292F', '#CF222E', '#116329', '#4D2D00', '#0969DA', '#8250DF', '#1B7C83', '#6E7781',
  '#57606A', '#A40E26', '#1A7F37', '#633C01', '#218BFF', '#A475F9', '#3192AA', '#8C959F',
] as const;

export const TERMINAL_THEMES = {
  // The default follows the app's scheme: each field reads the live palette (spread it into a plain object before handing it to a native view).
  solco: {
    label: 'Solco',
    get background() { return colors.terminal; },
    get foreground() { return colors.text; },
    get cursorColor() { return colors.accent; },
    get selectionBackground() { return activeScheme() === 'dark' ? '#7C8CFF4D' : '#1B4ED833'; },
    // The library's ANSI colors are tuned for a dark ground (its white is near-invisible on paper): light gets GitHub Light's.
    get palette(): readonly string[] | undefined { return activeScheme() === 'dark' ? undefined : LIGHT_ANSI; },
  },
  dracula: { label: 'Dracula', background: '#282A36', foreground: '#F8F8F2', cursorColor: '#F8F8F2', selectionBackground: '#44475AB3' },
  solarized: { label: 'Solarized Dark', background: '#002B36', foreground: '#93A1A1', cursorColor: '#93A1A1', selectionBackground: '#073642B3' },
  tokyo: { label: 'Tokyo Night', background: '#1A1B26', foreground: '#C0CAF5', cursorColor: '#C0CAF5', selectionBackground: '#33467CB3' },
  gruvbox: { label: 'Gruvbox', background: '#282828', foreground: '#EBDBB2', cursorColor: '#EBDBB2', selectionBackground: '#504945B3' },
} as const satisfies Record<string, TerminalTheme>;

/** The theme as a plain object (the Solco theme reads the live palette through getters; a native view gets the values, not the getters). */
export function snapshotTheme(theme: TerminalTheme): { background: string; foreground: string; cursorColor: string; selectionBackground: string; palette?: string[] } {
  const { background, foreground, cursorColor, selectionBackground, palette } = theme;
  return { background, foreground, cursorColor, selectionBackground, ...(palette ? { palette: [...palette] } : {}) };
}

export type TerminalThemeName = keyof typeof TERMINAL_THEMES;
export const DEFAULT_THEME: TerminalThemeName = 'solco';

export interface TerminalPrefs {
  fontSize: number;
  theme: TerminalThemeName;
}

export const DEFAULT_PREFS: TerminalPrefs = { fontSize: DEFAULT_FONT_SIZE, theme: DEFAULT_THEME };

const prefsSchema = z.object({ fontSize: z.number().finite(), theme: z.string().optional() });

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function isThemeName(name: unknown): name is TerminalThemeName {
  return typeof name === 'string' && Object.hasOwn(TERMINAL_THEMES, name);
}

export function parsePrefs(raw: string | null | undefined): TerminalPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const parsed = prefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_PREFS;
    return { fontSize: clampFontSize(parsed.data.fontSize), theme: isThemeName(parsed.data.theme) ? parsed.data.theme : DEFAULT_THEME };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function serializePrefs(prefs: TerminalPrefs): string {
  return JSON.stringify({ fontSize: clampFontSize(prefs.fontSize), theme: isThemeName(prefs.theme) ? prefs.theme : DEFAULT_THEME });
}
