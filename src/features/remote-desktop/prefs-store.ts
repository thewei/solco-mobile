// [INPUT]: prefs.ts codec, expo-file-system (the app's private document folder, imported lazily).
// [OUTPUT]: `useRdPrefs` (zustand) with `hydrateRdPrefs()`, `setClipboardSync`, `togglePin`, `rename`, `touchDevice`, `setModeButton`.
// [POS]: Client-local Remote Desktop preferences, persisted across restarts (`rd-prefs.json`). A change made
//        before the stored file is read wins over it, like the Home composer's pick; every IO failure is
//        swallowed (a lost preference must never break a session) and nothing here is logged.
// [PROTOCOL]: 变更时更新此头部
import { create } from 'zustand';

import type { Shortcut } from './keys';
import { DEFAULT_PREFS, parseRdPrefs, serializeRdPrefs, togglePinned, type ModeButtonPos, type RdPrefs } from './prefs';

const FILE = 'rd-prefs.json';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, FILE);
}

interface State extends RdPrefs {
  setClipboardSync(on: boolean): void;
  togglePin(s: Shortcut): void;
  rename(id: string, name: string): void;
  touchDevice(id: string): void;
  setModeButton(pos: ModeButtonPos): void;
}

let touched = false;

function persist(get: () => State): void {
  const { quickKeys, clipboardSync, aliases, lastOpened, modeButton } = get();
  void (async () => {
    try {
      const f = await file();
      if (!f.exists) f.create();
      f.write(serializeRdPrefs({ quickKeys, clipboardSync, aliases, lastOpened, modeButton }));
    } catch {
      // keep the in-memory value; the next change retries
    }
  })();
}

export const useRdPrefs = create<State>((set, get) => {
  const change = (patch: (s: State) => Partial<RdPrefs>) => {
    touched = true;
    set((s) => patch(s));
    persist(get);
  };
  return {
    ...DEFAULT_PREFS,
    setClipboardSync: (on) => change(() => ({ clipboardSync: on })),
    togglePin: (shortcut) => change((s) => ({ quickKeys: togglePinned(s.quickKeys, shortcut) })),
    rename: (id, name) =>
      change((s) => {
        const aliases = { ...s.aliases };
        if (name.trim()) aliases[id] = name.trim();
        else delete aliases[id];
        return { aliases };
      }),
    touchDevice: (id) => change((s) => ({ lastOpened: { ...s.lastOpened, [id]: Date.now() } })),
    setModeButton: (modeButton) => change(() => ({ modeButton })),
  };
});

/** Read the stored preferences into the store (once per screen mount is fine; a late read never overrides a change). */
export async function hydrateRdPrefs(): Promise<void> {
  try {
    const f = await file();
    const stored = f.exists ? parseRdPrefs(await f.text()) : DEFAULT_PREFS;
    if (!touched) useRdPrefs.setState(stored);
  } catch {
    // defaults stay
  }
}
