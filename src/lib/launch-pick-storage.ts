// [INPUT]: expo-file-system (the app's private document folder), imported lazily so the codec stays Node-testable.
// [OUTPUT]: `loadLaunchPick()` / `saveLaunchPick(pick)` — the Home composer's last Agent/Terminal choice across app restarts.
// [POS]: native twin (`launch-pick-storage.web.ts` is the browser one). Not SecureStore: it is a preference, not a secret.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every failure is swallowed (a lost preference must never break Home); nothing here is logged.
import { NO_LAUNCH_PICK, parseLaunchPick, serializeLaunchPick, type LaunchPick } from '@/lib/launch-pick';

const FILE = 'launch-pick.json';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, FILE);
}

export async function loadLaunchPick(): Promise<LaunchPick> {
  try {
    const f = await file();
    return f.exists ? parseLaunchPick(await f.text()) : NO_LAUNCH_PICK;
  } catch {
    return NO_LAUNCH_PICK;
  }
}

export async function saveLaunchPick(pick: LaunchPick): Promise<void> {
  try {
    const f = await file();
    if (!f.exists) f.create();
    f.write(serializeLaunchPick(pick));
  } catch {
    // keep the in-memory pick; the next change retries
  }
}
