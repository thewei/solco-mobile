// [INPUT]: the local Expo module `SolcoForegroundService` (modules/solco-foreground-service).
// [OUTPUT]: getForegroundService() — the process-wide ForegroundService, or null where no native
//           module exists.
// [POS]: The only file that touches the native binding. Android ships first; iOS and Web return
//        null, so background keep-alive degrades to "not held" and callers skip it entirely.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { requireOptionalNativeModule } from 'expo';

import {
  createForegroundService,
  type ForegroundService,
  type NativeForegroundService,
} from '@/lib/foreground-service';

let cached: ForegroundService | null | undefined;

export function getForegroundService(): ForegroundService | null {
  if (cached === undefined) {
    const native = requireOptionalNativeModule<NativeForegroundService>('SolcoForegroundService');
    cached = native ? createForegroundService(native) : null;
  }
  return cached;
}
