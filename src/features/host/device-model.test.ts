import { describe, expect, it } from 'vitest';

import type { BootstrapV3 } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { capabilitiesFor, deviceAction, deviceCaption, deviceFailureMessage, isDeviceInstance, launchKindsFor, selectableInstances } from '@/features/host/device-model';

const caps: BootstrapV3['capabilities'] = { terminal: true, chat: true, launch: true, git: true, gitWrite: true, files: true, quota: true, sessions: true, sessionContinue: true, voice: true, attachments: true, queue: true, queueEdit: true, devices: true, p2p: true };

describe('devices', () => {
  it('knows a device key from a Herdr session', () => {
    expect(isDeviceInstance('machine/abc')).toBe(true);
    expect(isDeviceInstance('default')).toBe(false);
    expect(isDeviceInstance(null)).toBe(false);
  });

  it('offers only sessions and bridged devices as places to look', () => {
    const list = selectableInstances([
      { id: 'default' },
      { id: 'machine/a', kind: 'device', label: 'a', status: 'connected' },
      { id: 'machine/b', kind: 'device', label: 'b', status: 'online' },
      { id: 'machine/c', kind: 'device', label: 'c', status: 'needs_signin' },
    ]);
    expect(list.map((item) => item.id)).toEqual(['default', 'machine/a']);
  });

  it('switches off everything that reads the Mac’s disk on a device, and nothing on the Mac', () => {
    expect(capabilitiesFor(caps, 'default')).toBe(caps);
    expect(capabilitiesFor(caps, 'machine/a')).toEqual({ terminal: true, chat: false, launch: true, devices: true, p2p: true });
  });

  it('keeps Remote Desktop on a device: it is the Mac’s own screen, not the instance’s', () => {
    expect(capabilitiesFor({ ...caps, remoteDesktop: true }, 'machine/a').remoteDesktop).toBe(true);
  });

  it('starts only a Terminal on a device', () => {
    const kinds = [{ id: 'terminal' }, { id: 'claude-code' }];
    expect(launchKindsFor(kinds, 'machine/a')).toEqual([{ id: 'terminal' }]);
    expect(launchKindsFor(kinds, 'default')).toEqual(kinds);
  });

  it('words each status and decides what a tap does', () => {
    expect(deviceCaption('needs_signin')).toBe('Sign in on your Mac');
    expect(deviceCaption(undefined)).toBe('Checking…');
    expect(deviceAction('connected')).toBe('open');
    expect(deviceAction('online')).toBe('connect');
    expect(deviceAction('unreachable')).toBe('connect');
    expect(deviceAction('needs_signin')).toBe('none');
    expect(deviceAction('disabled')).toBe('none');
  });

  it('words the Host’s refusals', () => {
    const refusal = (code: string) => new HostV3Error('http', 'x', { status: 409, code });
    expect(deviceFailureMessage(refusal('device_needs_signin'))).toContain('sign in');
    expect(deviceFailureMessage(refusal('device_unreachable'))).toContain('Can’t reach');
    expect(deviceFailureMessage(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
