// [INPUT]: the local Expo module `SolcoPinnedTransport` (modules/solco-pinned-transport).
// [OUTPUT]: getPinnedTransport() — the process-wide PinnedTransport, or null where no native pin exists.
// [POS]: The only file that touches the native binding. Android ships first; iOS and Web return null,
//        so callers must degrade explicitly instead of falling back to an unpinned fetch.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { requireOptionalNativeModule } from 'expo';

import {
  createPinnedTransport,
  type NativePinnedTransport,
  type PinnedTransport,
} from '@/lib/pinned-transport';

let cached: PinnedTransport | null | undefined;

export function getPinnedTransport(): PinnedTransport | null {
  if (cached === undefined) {
    const native = requireOptionalNativeModule<NativePinnedTransport>('SolcoPinnedTransport');
    cached = native ? createPinnedTransport(native) : null;
  }
  return cached;
}
