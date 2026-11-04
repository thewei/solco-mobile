// [INPUT]: successful pairings / connections (HostConnectionV3) and expo-secure-store.
// [OUTPUT]: HostBookV3 (the phone's list of paired Macs + which one is active), pure operations on it
//           (pairHost / activateHost / touchConnected / adoptAddress / mergeAdvertised / fallbackAddresses / removeHost / sortedHosts / hostRoute /
//           recordRoute / bookFromLegacy / parseBook) and readHostBookV3 / writeHostBookV3 (which also carries an older single connection over).
// [POS]: The only persistence of paired Macs. A record is one Mac, identified by its certificate
//        fingerprint, so pairing the same Mac again over a new address merges into one card and keeps
//        the old address in its history. A relay endpoint registered at pairing (`relay`) is kept with
//        the card but is an endpoint, never an address: it never enters addresses[] and a relay
//        connect is stamped as lastRoute 'relay', cleared again once a direct address answers.
//        Tokens and fingerprints live here in SecureStore and nowhere else — never Zustand, query
//        cache or logs. The model is pure; the storage twins are lazy so Node tests import it freely.
//        No location is ever read: "where" is the route (LAN / Tailscale / USB / relay, judged from
//        the address plus lastRoute) plus the phone's network type at the last connect.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { z } from 'zod';

import { hostConnectionV3Schema, parseStoredConnection, type HostConnectionV3 } from '@/lib/host-connection-v3';

const KEY = 'solco.host-book.v3';
const LEGACY_KEY = 'solco.host-connection.v3';

export const MAX_HOSTS = 8;
export const MAX_ADDRESSES = 5;

export const PHONE_NETWORKS = ['wifi', 'cellular', 'other', 'unknown'] as const;
export type PhoneNetwork = (typeof PHONE_NETWORKS)[number];
export type HostRoute = 'lan' | 'tailscale' | 'usb' | 'relay' | 'p2p' | 'other';

const addressSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  lastUsedAt: z.number().int().nonnegative(),
});
export type HostAddress = z.infer<typeof addressSchema>;

export const hostRecordSchema = hostConnectionV3Schema.extend({
  /** First pairing of this Mac on this phone; a re-pair keeps it. */
  pairedAt: z.number().int().nonnegative(),
  lastConnectedAt: z.number().int().nonnegative(),
  /** The phone's network when it last reached this Mac. */
  network: z.enum(PHONE_NETWORKS).default('unknown'),
  /** Addresses this Mac was reached on — plus ones the Mac itself advertised (bootstrap `net`) that the phone has not answered yet; newest answered first, the first is the current one. */
  addresses: z.array(addressSchema).max(MAX_ADDRESSES).default([]),
  /** Set while the last successful connect went through the card's relay instead of an address. */
  lastRoute: z.literal('relay').optional(),
});
export type HostRecordV3 = z.infer<typeof hostRecordSchema>;

export interface HostBookV3 {
  activeId: string | null;
  hosts: HostRecordV3[];
}

export interface ConnectContext {
  now: number;
  network: PhoneNetwork;
  /** Present when the Mac answered through its relay rather than on one of its addresses. */
  route?: 'relay';
}

export const emptyBook = (): HostBookV3 => ({ activeId: null, hosts: [] });

/** A Mac is its certificate: the same fingerprint is the same card whatever address it came over. */
export const hostId = (connection: Pick<HostConnectionV3, 'fingerprint'>): string => connection.fingerprint;

/** The part of a record the client needs; the extras never reach the transport. */
export function toConnection(record: HostRecordV3): HostConnectionV3 {
  const { host, port, fingerprint, token, deviceId, name, relay, lastRoute } = record;
  // The relay rides along only while it is the Mac's route; a direct address serving means a
  // direct connection (the client picks its transport purely from `relay`).
  return {
    host,
    port,
    fingerprint,
    token,
    deviceId,
    ...(name ? { name } : {}),
    ...(relay && lastRoute === 'relay' ? { relay } : {}),
  };
}

/** The route a card shows: the relay while the last connect went through it, else the address's. */
export function recordRoute(record: Pick<HostRecordV3, 'host' | 'lastRoute'>): HostRoute {
  return record.lastRoute ?? hostRoute(record.host);
}

/** Storage that no longer parses is an empty book, never a crash; one damaged record is dropped alone. */
export function parseBook(raw: string | null): HostBookV3 {
  if (!raw) return emptyBook();
  try {
    const value = JSON.parse(raw) as { activeId?: unknown; hosts?: unknown };
    const hosts: HostRecordV3[] = [];
    for (const item of Array.isArray(value.hosts) ? value.hosts : []) {
      const parsed = hostRecordSchema.safeParse(item);
      if (parsed.success && !hosts.some((host) => hostId(host) === hostId(parsed.data))) hosts.push(parsed.data);
    }
    const activeId = typeof value.activeId === 'string' && hosts.some((host) => hostId(host) === value.activeId) ? value.activeId : null;
    return { activeId, hosts: hosts.slice(0, MAX_HOSTS) };
  } catch {
    return emptyBook();
  }
}

/** The single connection older builds stored becomes the first (active) card. */
export function bookFromLegacy(connection: HostConnectionV3, now: number): HostBookV3 {
  const record = hostRecordSchema.parse({
    ...connection,
    pairedAt: now,
    lastConnectedAt: now,
    network: 'unknown',
    addresses: [{ host: connection.host, port: connection.port, lastUsedAt: now }],
  });
  return { activeId: hostId(record), hosts: [record] };
}

function withAddress(addresses: HostAddress[], host: string, port: number, now: number): HostAddress[] {
  const rest = addresses.filter((item) => !(item.host === host && item.port === port));
  return [{ host, port, lastUsedAt: now }, ...rest].slice(0, MAX_ADDRESSES);
}

/** Add or merge a freshly paired Mac and make it the active one. */
export function pairHost(book: HostBookV3, connection: HostConnectionV3, context: ConnectContext): HostBookV3 {
  const id = hostId(connection);
  const existing = book.hosts.find((host) => hostId(host) === id);
  const record: HostRecordV3 = existing
    ? {
        ...existing,
        ...connection,
        name: connection.name || existing.name,
        // Re-pairing keeps the registered relay and updates it when the new link carries one.
        relay: connection.relay ?? existing.relay,
        // Pairing through the relay is the first connect: start on that route.
        lastRoute: connection.relay ? 'relay' : existing.lastRoute,
        lastConnectedAt: context.now,
        network: context.network,
        addresses: withAddress(existing.addresses, connection.host, connection.port, context.now),
      }
    : hostRecordSchema.parse({
        ...connection,
        pairedAt: context.now,
        lastConnectedAt: context.now,
        network: context.network,
        lastRoute: connection.relay ? 'relay' : undefined,
        addresses: [{ host: connection.host, port: connection.port, lastUsedAt: context.now }],
      });
  let hosts = existing ? book.hosts.map((host) => (hostId(host) === id ? record : host)) : [record, ...book.hosts];
  if (hosts.length > MAX_HOSTS) {
    // Over the cap: the Mac least recently reached goes, never the one just paired.
    const victim = hosts.filter((host) => hostId(host) !== id).sort((a, b) => a.lastConnectedAt - b.lastConnectedAt)[0];
    hosts = hosts.filter((host) => host !== victim);
  }
  return { activeId: id, hosts };
}

export function activateHost(book: HostBookV3, id: string): HostBookV3 {
  return book.hosts.some((host) => hostId(host) === id) ? { ...book, activeId: id } : book;
}

/** The Mac answered: stamp the time and phone network, and move the answering address to the front. */
export function touchConnected(book: HostBookV3, id: string, context: ConnectContext): HostBookV3 {
  if (!book.hosts.some((host) => hostId(host) === id)) return book;
  return {
    ...book,
    hosts: book.hosts.map((host) =>
      hostId(host) === id
        ? {
            ...host,
            lastConnectedAt: context.now,
            network: context.network,
            // A relay answer touches the card but never the address history: the relay is an
            // endpoint registered at pairing, not one of the Mac's addresses.
            ...(context.route === 'relay'
              ? { lastRoute: 'relay' as const }
              : { addresses: withAddress(host.addresses, host.host, host.port, context.now) }),
          }
        : host,
    ),
  };
}

/** Earlier addresses this Mac answered on, most recently used first, without the current one. */
export function fallbackAddresses(record: HostRecordV3): HostAddress[] {
  return record.addresses
    .filter((item) => !(item.host === record.host && item.port === record.port))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** An earlier address answered while the current one did not: it becomes the Mac's address (same certificate, same token). */
export function adoptAddress(book: HostBookV3, id: string, address: Pick<HostAddress, 'host' | 'port'>, context: ConnectContext): HostBookV3 {
  if (!book.hosts.some((host) => hostId(host) === id)) return book;
  return {
    ...book,
    hosts: book.hosts.map((host) =>
      hostId(host) === id
        ? {
            ...host,
            host: address.host,
            port: address.port,
            lastConnectedAt: context.now,
            network: context.network,
            // A direct address answered: the relay stops being the route (it stays registered).
            lastRoute: undefined,
            addresses: withAddress(host.addresses, address.host, address.port, context.now),
          }
        : host,
    ),
  };
}
/**
 * The Mac's own word on where it serves now (bootstrap `net`, read over a
 * certificate-pinned connection): new addresses join the card's history so the
 * next route race can reach a changed LAN/Tailscale address at once. Addresses
 * that already answered keep their stamp; the current one stays the current one
 * until it stops answering (adoptAddress promotes it then). Same object when
 * nothing is new.
 */
export function mergeAdvertised(book: HostBookV3, id: string, addresses: readonly Pick<HostAddress, 'host' | 'port'>[]): HostBookV3 {
  const index = book.hosts.findIndex((host) => hostId(host) === id);
  if (index < 0 || addresses.length === 0) return book;
  const record = book.hosts[index]!;
  const isCurrent = (address: Pick<HostAddress, 'host' | 'port'>) => address.host === record.host && address.port === record.port;
  const fresh = addresses.filter(
    (address) => !isCurrent(address) && !record.addresses.some((item) => item.host === address.host && item.port === address.port),
  );
  if (fresh.length === 0) return book;
  const merged = [...record.addresses, ...fresh.map((address) => ({ host: address.host, port: address.port, lastUsedAt: 0 }))];
  // Cap order says what the card needs to keep: the current address, then the
  // ones the Mac says are true right now (lastUsedAt 0 = advertised, never
  // answered), then the newest answers. A history full of old answered
  // addresses must not starve the Mac's own new address.
  const current = merged.find(isCurrent)!;
  const rest = merged.filter((address) => !isCurrent(address));
  const trimmed = [
    current,
    ...rest.filter((address) => address.lastUsedAt === 0),
    ...rest.filter((address) => address.lastUsedAt > 0).sort((a, b) => b.lastUsedAt - a.lastUsedAt),
  ].slice(0, MAX_ADDRESSES);
  return {
    ...book,
    hosts: book.hosts.map((host, at) => (at === index ? { ...host, addresses: trimmed } : host)),
  };
}

/** Removing the active Mac leaves nothing active: the user picks, nothing switches silently. */
export function removeHost(book: HostBookV3, id: string): HostBookV3 {
  const hosts = book.hosts.filter((host) => hostId(host) !== id);
  return { activeId: book.activeId === id ? null : book.activeId, hosts };
}

export function activeRecord(book: HostBookV3): HostRecordV3 | null {
  return book.hosts.find((host) => hostId(host) === book.activeId) ?? null;
}

/** Active first, then the most recently reached. */
export function sortedHosts(book: HostBookV3): HostRecordV3[] {
  return [...book.hosts].sort((a, b) => {
    if (hostId(a) === book.activeId) return -1;
    if (hostId(b) === book.activeId) return 1;
    return b.lastConnectedAt - a.lastConnectedAt;
  });
}

/** Where an address lives, judged from the address alone: nothing is probed or located. */
export function hostRoute(host: string): HostRoute {
  const value = host.toLowerCase();
  if (value === 'localhost' || value === '::1' || /^127\./.test(value)) return 'usb';
  if (value.startsWith('fd7a:115c:a1e0:')) return 'tailscale';
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'lan';
  }
  return 'other';
}

// Storage twins. SecureStore is imported lazily so everything above stays importable from Node tests.

/** The stored book; a single connection left by an older build is carried over once. */
export async function readHostBookV3(now: number = Date.now()): Promise<HostBookV3> {
  const SecureStore = await import('expo-secure-store');
  const book = parseBook(await SecureStore.getItemAsync(KEY));
  if (book.hosts.length > 0) return book;
  const legacy = parseStoredConnection(await SecureStore.getItemAsync(LEGACY_KEY));
  if (!legacy) return book;
  const migrated = bookFromLegacy(legacy, now);
  await writeHostBookV3(migrated);
  await SecureStore.deleteItemAsync(LEGACY_KEY);
  return migrated;
}

export async function writeHostBookV3(book: HostBookV3): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(KEY, JSON.stringify(book), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
