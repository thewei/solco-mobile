// [INPUT]: the bootstrap's instances (Herdr sessions and the Mac's saved machines as `kind: 'device'`) and the capabilities.
// [OUTPUT]: isDeviceInstance, selectableInstances, capabilitiesFor (what a device instance can't do is switched off),
//           launchKindsFor, deviceCaption/deviceAction (the Host menu row's words and what a tap does), deviceFailureMessage.
// [POS]: (`remoteDesktop` is the Mac's own screen, not an instance's — it stays on.) Pure model behind the Chats filter's Host submenu (its Devices rows). A device is another computer's Herdr reached through the Mac's SSH
//        bridge: the Mac serves its Agents list, Terminal, peek and Terminal launch only — Chat, Files, Changes (and the
//        Mac-global Sessions, Quota, Voice) would read the Mac's own disk, so they are switched off here and refused by
//        the Host (`instance_remote`). The phone never holds a credential: a device that needs sign-in is signed in on the Mac.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { BootstrapV3 } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';

type Instance = BootstrapV3['instances'][number];
type Capabilities = BootstrapV3['capabilities'];

/** Instance keys of saved machines are `machine/<profile>`; a Herdr session name never has that prefix. */
export function isDeviceInstance(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('machine/');
}

/** What the phone may look at: every Herdr session, and only the devices whose bridge is up. */
export function selectableInstances(instances: readonly Instance[]): Instance[] {
  return instances.filter((item) => item.kind !== 'device' || item.status === 'connected');
}

/** The capabilities as seen from `instance`: on a device only terminal-side features remain. */
export function capabilitiesFor(capabilities: Capabilities, instance: string | null): Capabilities {
  if (!isDeviceInstance(instance)) return capabilities;
  return { terminal: capabilities.terminal, chat: false, launch: capabilities.launch, devices: capabilities.devices, remoteDesktop: capabilities.remoteDesktop, p2p: capabilities.p2p };
}

/** A device can only start a Terminal (in one of its Workspaces); agents run on that computer. */
export function launchKindsFor<K extends { id: string }>(kinds: readonly K[], instance: string | null): K[] {
  return isDeviceInstance(instance) ? kinds.filter((kind) => kind.id === 'terminal') : [...kinds];
}

export function deviceCaption(status: string | undefined): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'online':
      return 'Ready to connect';
    case 'needs_signin':
      return 'Sign in on your Mac';
    case 'unreachable':
      return 'Can’t reach it';
    case 'disabled':
      return 'Turned off on your Mac';
    default:
      return 'Checking…';
  }
}

export type DeviceAction = 'open' | 'connect' | 'none';

/** What a tap does: switch to a connected device, try to connect one that may work, nothing for the rest. */
export function deviceAction(status: string | undefined): DeviceAction {
  switch (status) {
    case 'connected':
      return 'open';
    case 'online':
    case 'unreachable':
    case 'checking':
    case undefined:
      return 'connect';
    default:
      return 'none';
  }
}

export function deviceFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'device_needs_signin':
      return 'It needs you to sign in. Do that on your Mac, then try again.';
    case 'device_unreachable':
      return 'Can’t reach it. Check that it is on and online.';
    case 'device_herdr_down':
      return 'It answered, but Herdr isn’t running there.';
    case 'device_disabled':
      return 'It is turned off on your Mac.';
    case 'unknown_device':
      return 'Your Mac no longer has this machine.';
    case 'devices_unavailable':
      return 'This Mac does not offer devices.';
    default:
  }
  if (error.kind === 'transport') return 'Could not reach your Mac. Try again.';
  return 'Could not connect.';
}
