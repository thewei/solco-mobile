// [INPUT]: the stored JSON text of the Remote Desktop preferences (or null).
// [OUTPUT]: `RdPrefs`, `parseRdPrefs`, `serializeRdPrefs`, `shortcutId`, `togglePinned`, `displayName`, `sortDevices`.
// [POS]: The pure half of the phone's Remote Desktop preferences — pinned quick keys, the clipboard auto-sync
//        switch, device nicknames, last-opened times and where the floating mode button rests. Preferences, not secrets: the store file lives beside the
//        Home composer's last pick (prefs-store.ts). A damaged or foreign file degrades to the defaults.
// [PROTOCOL]: 变更时更新此头部
import type { Modifier, Shortcut } from './keys';

export const MAX_PINNED = 12;
const MODIFIERS: readonly string[] = ['Control', 'Alt', 'Shift', 'Meta'];

export interface RdPrefs {
  /** Shortcuts the user pinned; they sit one tap away above the dock. */
  quickKeys: Shortcut[];
  /** Phone ↔ Mac text clipboard follows along while a Control session is open. */
  clipboardSync: boolean;
  /** Device nickname by paired Host id (the Mac's own name stays the default). */
  aliases: Record<string, string>;
  /** Epoch ms a device was last opened; the list shows recent ones first. */
  lastOpened: Record<string, number>;
  /** Where the floating Touch/Trackpad button rests: the screen edge it snapped to and its height (0–1 of the screen). */
  modeButton: ModeButtonPos;
}

export interface ModeButtonPos {
  side: 'left' | 'right';
  y: number;
}

export const DEFAULT_MODE_BUTTON: ModeButtonPos = { side: 'right', y: 0.42 };
export const DEFAULT_PREFS: RdPrefs = { quickKeys: [], clipboardSync: false, aliases: {}, lastOpened: {}, modeButton: DEFAULT_MODE_BUTTON };

function parseModeButton(v: unknown): ModeButtonPos {
  if (typeof v !== 'object' || v === null) return DEFAULT_MODE_BUTTON;
  const m = v as Record<string, unknown>;
  const y = typeof m.y === 'number' && Number.isFinite(m.y) ? Math.min(0.95, Math.max(0.05, m.y)) : DEFAULT_MODE_BUTTON.y;
  return { side: m.side === 'left' ? 'left' : 'right', y };
}

export function shortcutId(s: Pick<Shortcut, 'mods' | 'code'>): string {
  return [...s.mods, s.code].join('+');
}

function isShortcut(v: unknown): v is Shortcut {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return typeof s.label === 'string' && typeof s.code === 'string' && Array.isArray(s.mods) && s.mods.every((m) => typeof m === 'string' && MODIFIERS.includes(m));
}

function stringMap(v: unknown, keep: (x: unknown) => boolean): Record<string, never> {
  const out: Record<string, unknown> = {};
  if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) if (keep(x)) out[k] = x;
  return out as Record<string, never>;
}

export function parseRdPrefs(text: string | null): RdPrefs {
  if (!text) return DEFAULT_PREFS;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const quick = Array.isArray(raw.quickKeys) ? raw.quickKeys.filter(isShortcut).slice(0, MAX_PINNED) : [];
    return {
      quickKeys: quick.map((s) => ({ label: s.label, mods: [...s.mods] as Modifier[], code: s.code })),
      clipboardSync: raw.clipboardSync === true,
      aliases: stringMap(raw.aliases, (x) => typeof x === 'string' && x.trim() !== ''),
      lastOpened: stringMap(raw.lastOpened, (x) => typeof x === 'number' && Number.isFinite(x)),
      modeButton: parseModeButton(raw.modeButton),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function serializeRdPrefs(p: RdPrefs): string {
  return JSON.stringify(p);
}

/** Pin the shortcut, or unpin it when it is already pinned. A full list refuses a new pin (returns the same list). */
export function togglePinned(list: Shortcut[], s: Shortcut): Shortcut[] {
  const id = shortcutId(s);
  if (list.some((x) => shortcutId(x) === id)) return list.filter((x) => shortcutId(x) !== id);
  return list.length >= MAX_PINNED ? list : [...list, s];
}

export function displayName(prefs: RdPrefs, id: string, fallback: string): string {
  return prefs.aliases[id]?.trim() || fallback;
}

/** Recently opened devices first; the rest keep their given order. */
export function sortDevices<T extends { id: string }>(devices: readonly T[], prefs: RdPrefs): T[] {
  return devices
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (prefs.lastOpened[b.d.id] ?? 0) - (prefs.lastOpened[a.d.id] ?? 0) || a.i - b.i)
    .map((x) => x.d);
}
