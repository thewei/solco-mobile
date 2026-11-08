// [INPUT]: expo-file-system (the app's private document folder), imported lazily so the codec stays Node-testable.
// [OUTPUT]: `loadAppearance()` / `saveAppearance(appearance)` — the person's System / Light / Dark choice across app restarts.
// [POS]: native twin (`appearance-storage.web.ts` is the browser one). Not SecureStore: it is a preference, not a secret.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every failure is swallowed (a lost preference falls back to System, never breaks start-up); nothing here is logged.
import { DEFAULT_APPEARANCE, parseAppearance, serializeAppearance, type Appearance } from '@/lib/appearance';

const FILE = 'appearance.json';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, FILE);
}

export async function loadAppearance(): Promise<Appearance> {
  try {
    const f = await file();
    return f.exists ? parseAppearance(await f.text()) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export async function saveAppearance(appearance: Appearance): Promise<void> {
  try {
    const f = await file();
    if (!f.exists) f.create();
    f.write(serializeAppearance(appearance));
  } catch {
    // keep the in-memory choice; the next change retries
  }
}
