import { describe, expect, it } from 'vitest';

import type { HostConnectionV3 } from '@/lib/host-connection-v3';
import {
  activateHost,
  activeRecord,
  adoptAddress,
  bookFromLegacy,
  emptyBook,
  fallbackAddresses,
  hostId,
  hostRoute,
  MAX_ADDRESSES,
  MAX_HOSTS,
  mergeAdvertised,
  pairHost,
  parseBook,
  recordRoute,
  removeHost,
  setTailcat,
  sortedHosts,
  toConnection,
  touchConnected,
} from '@/lib/host-book';

const fp = (n: number) => n.toString(16).padStart(64, '0');
const conn = (n: number, over: Partial<HostConnectionV3> = {}): HostConnectionV3 => ({
  host: `192.168.0.${n}`,
  port: 7788,
  fingerprint: fp(n),
  token: `token-${n}`,
  deviceId: `device-${n}`,
  name: `Mac ${n}`,
  ...over,
});
const at = (now: number, network: 'wifi' | 'cellular' | 'other' | 'unknown' = 'wifi') => ({ now, network });

describe('host book', () => {
  it('pairs a Mac as a new active card with its first address', () => {
    const book = pairHost(emptyBook(), conn(1), at(1000));
    expect(book.activeId).toBe(fp(1));
    expect(book.hosts).toHaveLength(1);
    expect(book.hosts[0]).toMatchObject({ pairedAt: 1000, lastConnectedAt: 1000, network: 'wifi', addresses: [{ host: '192.168.0.1', port: 7788, lastUsedAt: 1000 }] });
  });

  it('merges the same Mac paired over a new address into one card and keeps the old address', () => {
    let book = pairHost(emptyBook(), conn(1), at(1000));
    book = pairHost(book, conn(1, { host: '100.101.102.1', token: 'fresh', deviceId: 'device-9' }), at(5000, 'cellular'));
    expect(book.hosts).toHaveLength(1);
    const record = book.hosts[0]!;
    expect(record).toMatchObject({ host: '100.101.102.1', token: 'fresh', deviceId: 'device-9', pairedAt: 1000, lastConnectedAt: 5000, network: 'cellular', name: 'Mac 1' });
    expect(record.addresses.map((a) => a.host)).toEqual(['100.101.102.1', '192.168.0.1']);
  });

  it('keeps the stored name when the new link carries none, and caps the address history', () => {
    let book = pairHost(emptyBook(), conn(1), at(1));
    for (let i = 0; i < MAX_ADDRESSES + 3; i++) book = pairHost(book, conn(1, { host: `10.0.0.${i + 1}`, name: undefined }), at(10 + i));
    expect(book.hosts[0]!.name).toBe('Mac 1');
    expect(book.hosts[0]!.addresses).toHaveLength(MAX_ADDRESSES);
    expect(book.hosts[0]!.addresses[0]!.host).toBe(`10.0.0.${MAX_ADDRESSES + 3}`);
  });

  it('switches the active Mac only to one that exists', () => {
    let book = pairHost(pairHost(emptyBook(), conn(1), at(1)), conn(2), at(2));
    expect(book.activeId).toBe(fp(2));
    book = activateHost(book, fp(1));
    expect(activeRecord(book)?.name).toBe('Mac 1');
    expect(activateHost(book, 'nope')).toBe(book);
  });

  it('touchConnected stamps time and network and moves the answering address first', () => {
    let book = pairHost(emptyBook(), conn(1), at(1));
    book = pairHost(book, conn(1, { host: '100.101.102.1' }), at(2));
    book = touchConnected(book, fp(1), at(9, 'wifi'));
    expect(book.hosts[0]).toMatchObject({ lastConnectedAt: 9, network: 'wifi' });
    expect(book.hosts[0]!.addresses[0]).toEqual({ host: '100.101.102.1', port: 7788, lastUsedAt: 9 });
    expect(touchConnected(book, 'nope', at(10))).toBe(book);
  });

  it('removing the active Mac leaves nothing active and never switches silently', () => {
    const book = pairHost(pairHost(emptyBook(), conn(1), at(1)), conn(2), at(2));
    const next = removeHost(book, fp(2));
    expect(next.activeId).toBeNull();
    expect(next.hosts.map(hostId)).toEqual([fp(1)]);
    expect(removeHost(book, fp(1)).activeId).toBe(fp(2));
    expect(removeHost(removeHost(next, fp(2)), fp(2)).hosts).toHaveLength(1); // idempotent
  });

  it('lists the active Mac first, then the most recently reached', () => {
    let book = emptyBook();
    book = pairHost(book, conn(1), at(100));
    book = pairHost(book, conn(2), at(300));
    book = pairHost(book, conn(3), at(200));
    book = activateHost(book, fp(1));
    expect(sortedHosts(book).map((h) => h.name)).toEqual(['Mac 1', 'Mac 2', 'Mac 3']);
  });

  it('evicts the Mac least recently reached over the cap, never the one just paired', () => {
    let book = emptyBook();
    for (let i = 1; i <= MAX_HOSTS; i++) book = pairHost(book, conn(i), at(i * 10));
    book = pairHost(book, conn(99), at(5));
    expect(book.hosts).toHaveLength(MAX_HOSTS);
    expect(book.hosts.some((h) => hostId(h) === fp(99))).toBe(true);
    expect(book.hosts.some((h) => hostId(h) === fp(1))).toBe(false);
  });

  it('round-trips through JSON; damage degrades to less, never a crash', () => {
    const book = pairHost(pairHost(emptyBook(), conn(1), at(1)), conn(2), at(2));
    expect(parseBook(JSON.stringify(book))).toEqual(book);
    expect(parseBook(null)).toEqual(emptyBook());
    expect(parseBook('not json')).toEqual(emptyBook());
    const damaged = { ...book, hosts: [{ ...book.hosts[0], fingerprint: 'zz' }, book.hosts[1], 7] };
    const parsed = parseBook(JSON.stringify(damaged));
    expect(parsed.hosts).toHaveLength(1);
    expect(parsed.activeId).toBeNull(); // the active one was the damaged record
    expect(parseBook(JSON.stringify({ ...book, activeId: 'ghost' })).activeId).toBeNull();
  });

  it('carries an older single connection over as the one active card', () => {
    const book = bookFromLegacy(conn(1), 777);
    expect(book.activeId).toBe(fp(1));
    expect(book.hosts[0]).toMatchObject({ pairedAt: 777, lastConnectedAt: 777, network: 'unknown' });
  });

  it('hands the client only the connection fields', () => {
    const record = pairHost(emptyBook(), conn(1), at(1)).hosts[0]!;
    expect(toConnection(record)).toEqual(conn(1));
  });

  it('judges the route from the address alone', () => {
    expect(hostRoute('127.0.0.1')).toBe('usb');
    expect(hostRoute('localhost')).toBe('usb');
    expect(hostRoute('192.168.0.59')).toBe('lan');
    expect(hostRoute('10.0.0.7')).toBe('lan');
    expect(hostRoute('172.20.1.1')).toBe('lan');
    expect(hostRoute('172.32.1.1')).toBe('other');
    expect(hostRoute('100.101.102.1')).toBe('tailscale');
    expect(hostRoute('100.128.0.1')).toBe('other');
    expect(hostRoute('fd7a:115c:a1e0::1')).toBe('tailscale');
    expect(hostRoute('mac.example.com')).toBe('other');
  });
});

describe('address recovery', () => {
  const base = { fingerprint: 'f'.repeat(64), token: 't'.repeat(40), deviceId: 'dev', port: 7788 };
  const ctx = { now: 5000, network: 'wifi' as const };

  it('lists earlier addresses newest first, without the current one', () => {
    let book = pairHost(emptyBook(), { ...base, host: '192.168.64.3' }, { now: 1000, network: 'wifi' });
    book = pairHost(book, { ...base, host: '192.168.0.59' }, { now: 2000, network: 'wifi' });
    book = pairHost(book, { ...base, host: '100.101.102.1' }, { now: 3000, network: 'wifi' });
    const record = book.hosts[0]!;
    expect(fallbackAddresses(record).map((a) => a.host)).toEqual(['192.168.0.59', '192.168.64.3']);
  });

  it('adopting an earlier address makes it current and keeps the token and card', () => {
    let book = pairHost(emptyBook(), { ...base, host: '192.168.0.59' }, { now: 1000, network: 'wifi' });
    book = pairHost(book, { ...base, host: '100.101.102.1' }, { now: 2000, network: 'wifi' });
    const next = adoptAddress(book, hostId(base), { host: '192.168.0.59', port: 7788 }, ctx);
    const record = next.hosts[0]!;
    expect(next.hosts).toHaveLength(1);
    expect([record.host, record.port, record.token]).toEqual(['192.168.0.59', 7788, base.token]);
    expect(record.addresses.map((a) => a.host)).toEqual(['192.168.0.59', '100.101.102.1']);
    expect(record.lastConnectedAt).toBe(5000);
    expect(adoptAddress(book, 'missing', { host: 'x', port: 1 }, ctx)).toBe(book);
  });

  it('mergeAdvertised files the Mac-reported addresses so the next race can reach a changed one', () => {
    let book = pairHost(emptyBook(), { ...base, host: '192.168.0.59' }, { now: 1000, network: 'wifi' });
    book = pairHost(book, { ...base, host: '10.8.0.1' }, { now: 2000, network: 'wifi' }); // the Mac has since moved; 10.8.0.1 no longer serves
    const next = mergeAdvertised(book, hostId(base), [{ host: '192.168.1.10', port: 7788 }]);
    const record = next.hosts[0]!;
    expect(record.addresses.map((a) => [a.host, a.lastUsedAt])).toEqual([
      ['10.8.0.1', 2000],
      ['192.168.1.10', 0], // advertised, never answered yet — kept ahead of old answers
      ['192.168.0.59', 1000],
    ]);
    // A later probe on the fresh address promotes it; merging never does.
    expect(record.host).toBe('10.8.0.1');
    expect(mergeAdvertised(next, hostId(base), [{ host: '192.168.1.10', port: 7788 }, { host: '192.168.0.59', port: 7788 }])).toBe(next);
    expect(mergeAdvertised(book, 'missing', [{ host: 'x', port: 1 }])).toBe(book);
    expect(mergeAdvertised(book, hostId(base), [])).toBe(book);
  });

  it('mergeAdvertised never evicts the current address and drops the stalest history at the cap', () => {
    let book = pairHost(emptyBook(), { ...base, host: '192.168.0.59' }, { now: 1000, network: 'wifi' });
    for (let i = 0; i < MAX_ADDRESSES - 1; i++) book = pairHost(book, { ...base, host: `10.0.0.${i + 1}` }, { now: 2000 + i, network: 'wifi' });
    const next = mergeAdvertised(book, hostId(base), [
      { host: '192.168.1.10', port: 7788 },
      { host: '192.168.1.11', port: 7788 },
    ]);
    const record = next.hosts[0]!;
    expect(record.addresses).toHaveLength(MAX_ADDRESSES);
    expect(record.addresses[0]).toMatchObject({ host: record.host }); // the current one survives the cap
    expect(record.addresses.some((a) => a.host === '192.168.1.10')).toBe(true);
  });

});
describe('relay registration', () => {
  const RELAY = { url: 'https://relay.example.com', secret: 'relsecret0123456789abcdef' };
  const withRelay = (n: number, over: Partial<HostConnectionV3> = {}): HostConnectionV3 => conn(n, { ...over, relay: RELAY });

  it('pairs through the relay: the relay is stored with the card but never an address, and starts as the route', () => {
    const book = pairHost(emptyBook(), withRelay(1), at(1000));
    const record = book.hosts[0]!;
    expect(record.relay).toEqual(RELAY);
    expect(record.lastRoute).toBe('relay');
    expect(record.addresses).toEqual([{ host: '192.168.0.1', port: 7788, lastUsedAt: 1000 }]);
    expect(record.addresses.some((a) => JSON.stringify(a).includes(RELAY.secret))).toBe(false);
    expect(toConnection(record)).toMatchObject({ host: '192.168.0.1', relay: RELAY });
  });

  it('re-pairing keeps the registered relay and updates it when the new link carries one', () => {
    let book = pairHost(emptyBook(), withRelay(1), at(1));
    const updated = { url: 'https://relay2.example.com', secret: 'relsecret_FEDCBA9876543210' };
    book = pairHost(book, conn(1, { relay: updated }), at(2));
    expect(book.hosts[0]!.relay).toEqual(updated);
    book = pairHost(book, conn(1, { host: '100.101.102.1', name: undefined }), at(3));
    expect(book.hosts[0]!.relay).toEqual(updated); // a direct re-pair keeps the registration
  });

  it('the relay consumes no address slot', () => {
    let book = pairHost(emptyBook(), withRelay(1), at(1));
    for (let i = 0; i < MAX_ADDRESSES; i++) book = pairHost(book, conn(1, { host: `10.0.0.${i + 1}` }), at(10 + i));
    expect(book.hosts[0]!.addresses).toHaveLength(MAX_ADDRESSES);
    expect(book.hosts[0]!.relay).toEqual(RELAY);
  });

  it('a relay win records the route without touching addresses; a later direct answer clears it', () => {
    let book = pairHost(emptyBook(), withRelay(1), at(1));
    const before = book.hosts[0]!.addresses;
    book = touchConnected(book, fp(1), { now: 5000, network: 'cellular', route: 'relay' });
    expect(book.hosts[0]).toMatchObject({ lastRoute: 'relay', lastConnectedAt: 5000, network: 'cellular' });
    expect(book.hosts[0]!.addresses).toEqual(before);
    expect(toConnection(book.hosts[0]!)).toMatchObject({ relay: RELAY });
    book = adoptAddress(book, fp(1), { host: '192.168.0.1', port: 7788 }, { now: 6000, network: 'wifi' });
    expect(book.hosts[0]!.lastRoute).toBeUndefined();
    expect(toConnection(book.hosts[0]!).relay).toBeUndefined(); // direct serving, relay still registered
    expect(book.hosts[0]!.relay).toEqual(RELAY);
  });

  it('removing the Mac removes its relay with the card; storage round-trips relay and route', () => {
    const book = pairHost(emptyBook(), withRelay(1), at(1));
    expect(removeHost(book, fp(1)).hosts).toHaveLength(0);
    expect(parseBook(JSON.stringify(book))).toEqual(book);
  });

  it('judges the card route: relay while lastRoute says so, else from the address', () => {
    const record = pairHost(emptyBook(), withRelay(1), at(1)).hosts[0]!;
    expect(recordRoute(record)).toBe('relay');
    expect(recordRoute({ host: '100.101.102.1', lastRoute: undefined })).toBe('tailscale');
  });
});

describe('tailcat tunnel (tc)', () => {
  const TC = 'tcpGFwWCB27eTym2U3yqUtdjZHe-qb_AxeWLR2moPLGw77mUniZWFrWCB71vij';
  const ctx = { now: 1_000, network: 'wifi' as const };

  it('pairing keeps the tunnel address and the connection always carries it', () => {
    const book = pairHost(emptyBook(), conn(1, { tailcat: TC }), ctx);
    const record = book.hosts[0]!;
    expect(record.tailcat).toBe(TC);
    expect(toConnection(record).tailcat).toBe(TC);
    // The tunnel is an endpoint like the relay: it never becomes an address.
    expect(record.addresses).toHaveLength(1);
  });

  it('a tunnel answer stamps lastRoute tailcat, a direct answer clears it', () => {
    let book = pairHost(emptyBook(), conn(1, { tailcat: TC }), ctx);
    const id = hostId(book.hosts[0]!);
    book = touchConnected(book, id, { ...ctx, now: 2_000, route: 'tailcat' });
    expect(book.hosts[0]!.lastRoute).toBe('tailcat');
    expect(recordRoute(book.hosts[0]!)).toBe('tailcat');
    expect(toConnection(book.hosts[0]!).tailcat).toBe(TC);
    // The tunnel answer never enters the address history; a direct one does and clears the stamp.
    book = adoptAddress(book, id, { host: book.hosts[0]!.host, port: book.hosts[0]!.port }, { ...ctx, now: 3_000 });
    expect(book.hosts[0]!.lastRoute).toBeUndefined();
    expect(recordRoute(book.hosts[0]!)).toBe('lan');
    expect(toConnection(book.hosts[0]!).tailcat).toBe(TC);
  });

  it('a stored book with a tunnel record parses back unchanged', () => {
    const book = pairHost(emptyBook(), conn(1, { tailcat: TC }), ctx);
    expect(parseBook(JSON.stringify(book))).toEqual(book);
  });

  it('a pair that went through the tunnel starts on it; a later direct pair does not force it back', () => {
    let book = pairHost(emptyBook(), conn(1, { tailcat: TC }), { ...ctx, route: 'tailcat' });
    expect(book.hosts[0]!.lastRoute).toBe('tailcat');
    book = pairHost(book, conn(1, { tailcat: TC }), ctx);
    expect(book.hosts[0]!.lastRoute).toBe('tailcat');
  });

  it('setTailcat gives a legacy-paired Mac its tunnel address and touches nothing else', () => {
    const book = pairHost(emptyBook(), conn(1), ctx);
    const id = hostId(book.hosts[0]!);
    const next = setTailcat(book, id, TC);
    expect(next.hosts[0]!.tailcat).toBe(TC);
    expect(next.hosts[0]!.lastRoute).toBeUndefined();
    expect(setTailcat(next, id, TC)).toBe(next);
    expect(setTailcat(book, 'nope', TC)).toBe(book);
  });
});
