import { describe, expect, it } from 'vitest';

import { HostV3Error } from '@/lib/host-client-v3';
import { agoLabel, cardStatus, dateLabel, lastConnectedLine, networkLabel, probeStateOf, routeLabel, shortFingerprint } from '@/features/host/host-card-model';

describe('host card model', () => {
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();

  it('words how long ago a Mac was reached', () => {
    expect(agoLabel(now - 5_000, now)).toBe('just now');
    expect(agoLabel(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(agoLabel(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(agoLabel(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(agoLabel(new Date(2026, 8, 1).getTime(), now)).toBe('1 Sep 2026');
    expect(agoLabel(now + 5_000, now)).toBe('just now');
  });

  it('formats dates, routes, networks and the fingerprint tag', () => {
    expect(dateLabel(new Date(2026, 9, 31).getTime())).toBe('31 Oct 2026');
    expect(routeLabel('tailscale')).toBe('Tailscale');
    expect(networkLabel('cellular')).toBe('Cellular');
    expect(shortFingerprint('abcdef0123456789'.padEnd(64, '0'))).toBe('ABCDEF01');
    expect(lastConnectedLine(now - 120_000, 'wifi', now)).toBe('2 min ago · Wi-Fi');
    expect(lastConnectedLine(now - 120_000, 'unknown', now)).toBe('2 min ago');
  });

  it('reads reachability from a query, telling a revoked token from an unreachable Mac', () => {
    expect(probeStateOf({ isSuccess: true, isError: false, error: null })).toBe('ok');
    expect(probeStateOf({ isSuccess: false, isError: false, error: null })).toBe('checking');
    expect(probeStateOf({ isSuccess: false, isError: true, error: new HostV3Error('unauthorized', 'no') })).toBe('unauthorized');
    expect(probeStateOf({ isSuccess: false, isError: true, error: new HostV3Error('transport', 'timeout') })).toBe('unreachable');
  });

  it('names the card status, the active Mac being Connected rather than Online', () => {
    expect(cardStatus(true, 'ok')).toEqual({ status: 'connected', label: 'Connected', tone: 'success' });
    expect(cardStatus(false, 'ok').label).toBe('Online');
    expect(cardStatus(false, 'unreachable').label).toBe('Can’t reach');
    expect(cardStatus(true, 'unauthorized').tone).toBe('danger');
    expect(cardStatus(true, 'checking').status).toBe('checking');
  });
});
