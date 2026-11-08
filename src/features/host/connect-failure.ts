// [INPUT]: a failed connect/pair error, the address tried and the phone's network kind.
// [OUTPUT]: classifyFailure (timeout / refused / unreachable / dns / pin / unauthorized / pairing_refused / mac_offline / other),
//           connectionLine (the status line under Home's title) and
//           describeConnectFailure → { title, detail, hint }.
// [POS]: pure wording for "Can't reach": it names what failed, which address and route were tried and
//        what the phone was on, and says the one thing to check. It reads only the error's kind and
//        message (the native transport's Java text), never a token, fingerprint or pairing code.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { HostV3Error, RELAY_OFFLINE_CODE } from '@/lib/host-client-v3';
import { hostRoute, type HostRoute, type PhoneNetwork } from '@/lib/host-book';
import { networkLabel, routeLabel } from '@/features/host/host-card-model';

export type FailureKind = 'timeout' | 'refused' | 'unreachable' | 'dns' | 'pin' | 'unauthorized' | 'pairing_refused' | 'mac_offline' | 'other';

/** The Host's 401 body code for POST /pair: the code is wrong, used or past its six minutes — the phone itself is not revoked. */
const PAIRING_REFUSED_CODE = 'pairing_refused';

export interface FailureContext {
  host: string;
  port: number;
  network: PhoneNetwork;
  /** The Mac has a built-in tunnel, so a LAN address that does not answer is not the whole story. */
  tunnel?: boolean;
}

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof HostV3Error) {
    if (error.code === PAIRING_REFUSED_CODE) return 'pairing_refused';
    if (error.kind === 'unauthorized') return 'unauthorized';
    if (error.kind === 'pin') return 'pin';
    if (error.code === RELAY_OFFLINE_CODE) return 'mac_offline';
    if (error.kind !== 'transport') return 'other';
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/ECONNREFUSED|connection refused/i.test(message)) return 'refused';
  if (/ENETUNREACH|EHOSTUNREACH|network is unreachable|no route to host/i.test(message)) return 'unreachable';
  if (/UnknownHost|unable to resolve|nodename nor servname|ENOTFOUND/i.test(message)) return 'dns';
  if (/after \d+\s?ms|timed? ?out|ETIMEDOUT/i.test(message)) return 'timeout';
  return 'other';
}

/** A failure of the way in (not of what was asked): the connection manager's cue to look for another route. */
export function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof HostV3Error) return error.kind === 'transport' || error.code === RELAY_OFFLINE_CODE;
  const kind = classifyFailure(error);
  return kind === 'timeout' || kind === 'refused' || kind === 'unreachable' || kind === 'dns';
}

export interface ConnectionLine {
  text: string;
  tone: 'muted' | 'attention';
}

/**
 * The small line under Home's title: the route while the events socket is live, `Reconnecting…` while it is
 * not, and when a read failed the reason in two words (the full sentence is the body of the screen).
 */
export function connectionLine(input: { failure: unknown; live: boolean; route: HostRoute }): ConnectionLine {
  if (input.failure) {
    switch (classifyFailure(input.failure)) {
      case 'mac_offline':
        return { text: 'Computer offline', tone: 'attention' };
      case 'unauthorized':
      case 'pairing_refused':
        return { text: 'Needs re-pairing', tone: 'attention' };
      case 'pin':
        return { text: 'Different computer', tone: 'attention' };
      default:
        return { text: 'Can’t reach', tone: 'attention' };
    }
  }
  return { text: input.live ? routeLabel(input.route) : 'Reconnecting…', tone: 'muted' };
}

export interface FailureView {
  title: string;
  /** Address, route and the phone's network at the time. */
  detail: string;
  hint: string;
}

function timeoutHint(context: FailureContext): string {
  if (context.tunnel) {
    return 'The secure tunnel did not answer. Check that the computer is awake with Solco open and Remote Access on — the first connection can take up to 20 seconds. The phone can be on any network.';
  }
  const route = hostRoute(context.host);
  if (route === 'usb') return `Reconnect the USB cable and run: adb reverse tcp:${context.port} tcp:${context.port}`;
  if (route === 'tailscale') return 'Open Tailscale on the phone and the computer and check both show as connected.';
  if (route === 'lan' && context.network === 'cellular') return 'This is a local address but the phone is on mobile data. Join the same Wi-Fi as the computer, or pair again from the computer’s new QR code to connect from anywhere.';
  if (route === 'lan') {
    return 'The phone must be on the same Wi-Fi as the computer — not a guest network and not behind a VPN. If it is, set Remote Access to the computer’s real network card (not a VM bridge) and pair again.';
  }
  return 'Nothing answered in time. Check the address and that the phone can reach it.';
}

export function describeConnectFailure(error: unknown, context: FailureContext): FailureView {
  const kind = classifyFailure(error);
  const network = networkLabel(context.network) || 'an unknown network';
  const detail = `${context.host}:${context.port} · ${routeLabel(hostRoute(context.host))} · phone on ${network}`;
  switch (kind) {
    case 'timeout':
      return { title: 'No answer from the computer', detail, hint: timeoutHint(context) };
    case 'refused':
      return {
        title: 'The computer is reachable but not listening',
        detail,
        hint: 'In Solco open Settings → Remote Access and turn it on (and keep the same port).',
      };
    case 'unreachable':
      return { title: 'No route to the computer', detail, hint: 'The phone has no path to this address. Check Wi-Fi or Tailscale and try again.' };
    case 'dns':
      return { title: 'Unknown address', detail, hint: 'The computer’s name did not resolve. Pair again from its QR code to use its IP address.' };
    case 'pin':
      return { title: 'This is a different computer', detail, hint: 'Its certificate changed since pairing. If you reset Solco’s remote data, pair again from Solco’s Settings.' };
    case 'mac_offline':
      return {
        title: 'The computer is offline',
        detail,
        hint: 'The relay answers but no computer is connected to it. Wake it and check that Solco is running with Remote Access on.',
      };
    case 'pairing_refused':
      return {
        title: 'The computer refused this pairing code',
        detail,
        hint: 'A code works once and for six minutes. Open Settings → Remote Access → Pair a Phone… and use the new code.',
      };
    case 'unauthorized':
      return { title: 'The computer no longer knows this phone', detail, hint: 'It was revoked or reset. Scan its pairing QR code again.' };
    default:
      return { title: 'Couldn’t connect', detail, hint: error instanceof Error && error.message ? error.message : 'Try again.' };
  }
}
