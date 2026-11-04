// [INPUT]: the paired Mac book in SecureStore (read here, in the headless JS context, with no React tree)
//          and the pinned transport.
// [OUTPUT]: loadWidgetState() — a WidgetState: unpaired (no Mac), offline (the Mac did not answer in time),
//           or ready (counts + urgent rows from one bootstrap + one tree read).
// [POS]: The widget's only network path. It reuses the app's own HostClientV3, so the certificate pin, the
//        relay route and the bearer token stay where they always were (no token copy in native code, no
//        second client). One short read per widget update; no socket, no retry loop, nothing persisted.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { createHostClientV3 } from '@/lib/host-client-v3';
import { activeRecord, readHostBookV3, toConnection } from '@/lib/host-book';
import { getPinnedTransport } from '@/lib/pinned-transport-native';
import { withTimeout } from '@/lib/route-optimizer';
import { buildWidgetData, type WidgetState } from '@/features/widget/widget-model';

/** Each of the two reads gets this long; the headless task itself is cut at 30 s by the library. */
const READ_TIMEOUT_MS = 10_000;

export async function loadWidgetState(now: number = Date.now()): Promise<WidgetState> {
  let record;
  try {
    record = activeRecord(await readHostBookV3(now));
  } catch {
    return { kind: 'unpaired' };
  }
  if (!record) return { kind: 'unpaired' };

  const connection = toConnection(record);
  const transport = getPinnedTransport();
  // Same rule as the provider: a direct connection needs the native pin, a relay does not.
  if (!transport && !connection.relay) return { kind: 'offline' };
  const client = createHostClientV3(transport, connection);
  try {
    const bootstrap = await withTimeout(client.bootstrap(), READ_TIMEOUT_MS);
    const instance = bootstrap.instances[0]?.id;
    if (!instance) return { kind: 'ready', data: { needsYou: 0, working: 0, idle: 0, rows: [] }, at: now };
    const tree = await withTimeout(client.tree(instance), READ_TIMEOUT_MS);
    return { kind: 'ready', data: buildWidgetData(tree.workspaces, instance, bootstrap.capabilities.chat === true), at: now };
  } catch {
    return { kind: 'offline' };
  }
}
