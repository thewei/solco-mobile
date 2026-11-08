// [INPUT]: a successful pairing (host, port, pinned fingerprint, device token, optional relay
//          endpoint) and expo-secure-store.
// [OUTPUT]: HostConnectionV3 (schema + type), relayEndpointSchema/HostRelay, hostConnectionBaseUrl,
//           relayBaseUrl, parseStoredConnection.
// [POS]: the shape of one Go Host v3 connection (what the client needs), plus the relay endpoint a
//        pairing link may have registered (route=relay serves `<relay>/c/<secret>`; absent = direct
//        LAN/Tailscale only). Persistence of the paired Macs lives in host-book.ts;
//        parseStoredConnection only reads the single connection older builds stored, for the
//        one-time migration.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { z } from 'zod';

import { pairTargetBaseUrl } from '@/lib/pairing-v3';

/** The `<r>`/`<rt>` pair a pairing link may carry: relay base URL and this phone's relay secret. */
export const relayEndpointSchema = z.object({
  url: z.string().url().startsWith('https://'),
  secret: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
});
export type HostRelay = z.infer<typeof relayEndpointSchema>;

export const hostConnectionV3Schema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  token: z.string().min(1),
  deviceId: z.string().min(1),
  /** Display name of the Mac, as the pairing link carried it. */
  name: z.string().max(80).optional(),
  /**
   * Self-hosted relay endpoint (`r`/`rt` of the pairing link), registered when the phone paired
   * through it. Present only when the relay is this Mac's current route (see host-book's
   * lastRoute); the relay never sees the secret, only its hash.
   */
  relay: relayEndpointSchema.optional(),
  /**
   * The Mac's built-in Tailcat tunnel address (`tc` of the pairing link). Present whenever the Mac
   * serves the tunnel; the route choice (direct vs tunnel) stays the connection manager's.
   */
  tailcat: z.string().regex(/^[A-Za-z0-9_.:\-]{16,600}$/).optional(),
});
export type HostConnectionV3 = z.infer<typeof hostConnectionV3Schema>;

/** The relay's per-host HTTP prefix; null when this Mac has no relay (a direct-only Mac). */
export function relayBaseUrl(record: Pick<HostConnectionV3, 'relay'>): string | null {
  return record.relay ? `${record.relay.url}/c/${record.relay.secret}` : null;
}

/** True when the connection can fall back to the Mac's built-in tunnel. */
export function hasTailcat(record: Pick<HostConnectionV3, 'tailcat'>): boolean {
  return typeof record.tailcat === 'string';
}

export function hostConnectionBaseUrl(connection: Pick<HostConnectionV3, 'host' | 'port'>): string {
  return pairTargetBaseUrl(connection);
}

/** A stored legacy value that no longer parses is treated as "not paired", never as a crash. */
export function parseStoredConnection(raw: string | null): HostConnectionV3 | null {
  if (!raw) return null;
  try {
    const parsed = hostConnectionV3Schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
