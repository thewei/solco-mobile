// [INPUT]: expo-file-system (the app's private document folder), imported lazily so the codec stays Node-testable.
// [OUTPUT]: `loadResultsSeen()` / `saveResultsSeen(seen)` — which task-result cards the person already dismissed, across app restarts.
// [POS]: native twin (`results-seen-storage.web.ts` is the browser one). Not SecureStore: a watermark, not a secret.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: every failure is swallowed (a lost watermark only shows an old card again); nothing here is logged.
import { parseResultsSeen, serializeResultsSeen, type ResultsSeen } from '@/lib/results-seen';

const FILE = 'results-seen.json';

async function file() {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, FILE);
}

export async function loadResultsSeen(): Promise<ResultsSeen> {
  try {
    const f = await file();
    return f.exists ? parseResultsSeen(await f.text()) : {};
  } catch {
    return {};
  }
}

export async function saveResultsSeen(seen: ResultsSeen): Promise<void> {
  try {
    const f = await file();
    if (!f.exists) f.create();
    f.write(serializeResultsSeen(seen));
  } catch {
    // keep the in-memory watermark; the next dismissal retries
  }
}
