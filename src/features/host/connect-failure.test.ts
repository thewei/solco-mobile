import { describe, expect, it } from 'vitest';

import { HostV3Error } from '@/lib/host-client-v3';
import { classifyFailure, connectionLine, describeConnectFailure, isConnectivityFailure } from '@/features/host/connect-failure';

const transport = (message: string) => new HostV3Error('transport', message);
const ctx = (host: string, network: 'wifi' | 'cellular' | 'other' | 'unknown' = 'wifi') => ({ host, port: 7788, network });

describe('isConnectivityFailure', () => {
  it('is the way in failing, never what was asked', () => {
    expect(isConnectivityFailure(transport('something odd'))).toBe(true); // any transport failure
    expect(isConnectivityFailure(new HostV3Error('http', 'boom'))).toBe(false);
    expect(isConnectivityFailure(new HostV3Error('unauthorized', 'x'))).toBe(false);
    expect(isConnectivityFailure(new HostV3Error('pin', 'x'))).toBe(false);
    expect(isConnectivityFailure(new Error('connect failed: ECONNREFUSED'))).toBe(true);
    expect(isConnectivityFailure(new Error('validation failed'))).toBe(false);
  });
});

describe('a pairing code the Mac refused', () => {
  const refused = new HostV3Error('unauthorized', 'x', { status: 401, code: 'pairing_refused' });
  it('is not a revoked phone: the code is single-use and lasts six minutes', () => {
    expect(classifyFailure(refused)).toBe('pairing_refused');
    expect(isConnectivityFailure(refused)).toBe(false);
    const view = describeConnectFailure(refused, ctx('192.168.0.59'));
    expect(view.title).toBe('The computer refused this pairing code');
    expect(view.hint).toMatch(/Pair a Phone/);
    expect(connectionLine({ failure: refused, live: false, route: 'lan' }).text).toBe('Needs re-pairing');
  });
});

describe('a Mac that is not behind the relay', () => {
  const offline = new HostV3Error('http', 'x', { status: 502, code: 'relay_offline' });
  it('is a failure of the way in, with a reason of its own', () => {
    expect(isConnectivityFailure(offline)).toBe(true);
    expect(isConnectivityFailure(new HostV3Error('http', 'x', { status: 502, code: 'backend_unavailable' }))).toBe(false);
    expect(classifyFailure(offline)).toBe('mac_offline');
    const view = describeConnectFailure(offline, ctx('192.168.0.59'));
    expect(view.title).toBe('The computer is offline');
    expect(view.hint).toMatch(/Remote Access/);
  });
});

describe('connectionLine', () => {
  it('names the route while live, Reconnecting while not, and the reason when a read failed', () => {
    expect(connectionLine({ failure: null, live: true, route: 'lan' })).toEqual({ text: 'LAN', tone: 'muted' });
    expect(connectionLine({ failure: null, live: true, route: 'p2p' }).text).toBe('P2P');
    expect(connectionLine({ failure: null, live: false, route: 'relay' })).toEqual({ text: 'Reconnecting…', tone: 'muted' });
    expect(connectionLine({ failure: new HostV3Error('http', 'x', { status: 502, code: 'relay_offline' }), live: true, route: 'relay' })).toEqual({ text: 'Computer offline', tone: 'attention' });
    expect(connectionLine({ failure: new HostV3Error('unauthorized', 'x'), live: false, route: 'lan' }).text).toBe('Needs re-pairing');
    expect(connectionLine({ failure: new HostV3Error('pin', 'x'), live: false, route: 'lan' }).text).toBe('Different computer');
    expect(connectionLine({ failure: transport('after 10000ms'), live: false, route: 'lan' }).text).toBe('Can’t reach');
  });
});

describe('connect failure', () => {
  it('classifies the native transport text and the typed kinds', () => {
    expect(classifyFailure(transport('failed to connect to /192.168.0.59 (port 7788) from /10.0.0.203 (port 60188) after 10000ms'))).toBe('timeout');
    expect(classifyFailure(transport('failed to connect to /192.168.0.59 (port 7788): connect failed: ECONNREFUSED (Connection refused)'))).toBe('refused');
    expect(classifyFailure(transport('connect failed: ENETUNREACH (Network is unreachable)'))).toBe('unreachable');
    expect(classifyFailure(transport('Unable to resolve host "mac.local"'))).toBe('dns');
    expect(classifyFailure(new HostV3Error('pin', 'x'))).toBe('pin');
    expect(classifyFailure(new HostV3Error('unauthorized', 'x'))).toBe('unauthorized');
    expect(classifyFailure(new HostV3Error('http', 'boom'))).toBe('other');
    expect(classifyFailure(transport('something odd'))).toBe('other');
  });

  it('names the address, route and phone network, and says what to check for a timeout', () => {
    const view = describeConnectFailure(transport('... after 10000ms'), ctx('192.168.0.59', 'wifi'));
    expect(view.title).toBe('No answer from the computer');
    expect(view.detail).toBe('192.168.0.59:7788 · LAN · phone on Wi-Fi');
    expect(view.hint).toMatch(/same Wi-Fi/);
    expect(view.hint).toMatch(/VPN/);
  });

  it('points a local address on mobile data at the Wi-Fi, a Tailscale one at Tailscale, USB at adb', () => {
    expect(describeConnectFailure(transport('after 10000ms'), ctx('192.168.0.59', 'cellular')).hint).toMatch(/mobile data/);
    expect(describeConnectFailure(transport('after 10000ms'), ctx('100.101.102.1')).hint).toMatch(/Tailscale/);
    expect(describeConnectFailure(transport('after 10000ms'), ctx('127.0.0.1')).hint).toBe('Reconnect the USB cable and run: adb reverse tcp:7788 tcp:7788');
  });

  it('tells a refused port (Host off) from a revoked phone from a changed Mac', () => {
    expect(describeConnectFailure(transport('ECONNREFUSED'), ctx('192.168.0.59')).hint).toMatch(/Remote Access/);
    expect(describeConnectFailure(new HostV3Error('unauthorized', 'x'), ctx('192.168.0.59')).title).toBe('The computer no longer knows this phone');
    expect(describeConnectFailure(new HostV3Error('pin', 'x'), ctx('192.168.0.59')).title).toBe('This is a different computer');
  });

  it('falls back to the raw message and an unknown network', () => {
    const view = describeConnectFailure(transport('odd failure'), ctx('mac.example.com', 'unknown'));
    expect(view.title).toBe('Couldn’t connect');
    expect(view.hint).toBe('odd failure');
    expect(view.detail).toBe('mac.example.com:7788 · Network · phone on an unknown network');
  });
});
