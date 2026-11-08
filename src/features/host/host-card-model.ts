// [INPUT]: paired Mac records (lib/host-book) and a reachability reading per Mac.
// [OUTPUT]: card wording for the Mac list — routeLabel / networkLabel / agoLabel / dateLabel /
//           shortFingerprint / probeStateOf / cardStatus / lastConnectedLine.
// [POS]: pure presentation model shared by the Hosts page and the Chats filter's Host submenu;
//        no React, no clock (callers pass `now`), no storage.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { HostV3Error } from '@/lib/host-client-v3';
import { hostRoute, type HostRecordV3, type HostRoute, type PhoneNetwork } from '@/lib/host-book';

export type ProbeState = 'checking' | 'ok' | 'unreachable' | 'unauthorized';
export type CardStatus = 'connected' | 'online' | 'offline' | 'repair' | 'checking';
export type CardTone = 'success' | 'attention' | 'danger' | 'muted';

const ROUTES: Record<HostRoute, string> = { lan: 'LAN', tailscale: 'Tailscale', usb: 'USB', relay: 'Relay', tailcat: 'Tunnel', p2p: 'P2P', other: 'Network' };
const NETWORKS: Record<PhoneNetwork, string> = { wifi: 'Wi-Fi', cellular: 'Cellular', other: 'Other network', unknown: '' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const routeLabel = (route: HostRoute): string => ROUTES[route];
export const networkLabel = (network: PhoneNetwork): string => NETWORKS[network];

export function dateLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function agoLabel(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return dateLabel(then);
}

/** First 8 hex digits, upper-case: enough to tell two Macs apart at a glance. */
export const shortFingerprint = (fingerprint: string): string => fingerprint.slice(0, 8).toUpperCase();

/** "5 min ago · Wi-Fi" — the network is left out when it was never read. */
export function lastConnectedLine(lastConnectedAt: number, network: PhoneNetwork, now: number): string {
  const parts = [agoLabel(lastConnectedAt, now)];
  if (networkLabel(network)) parts.push(networkLabel(network));
  return parts.join(' · ');
}

/** Turns a query's outcome into a probe state; a 401 means the Mac forgot this phone. */
export function probeStateOf(query: { isSuccess: boolean; isError: boolean; error: unknown }): ProbeState {
  if (query.isSuccess) return 'ok';
  if (!query.isError) return 'checking';
  return query.error instanceof HostV3Error && query.error.kind === 'unauthorized' ? 'unauthorized' : 'unreachable';
}

export function cardStatus(isActive: boolean, probe: ProbeState): { status: CardStatus; label: string; tone: CardTone } {
  switch (probe) {
    case 'ok':
      return isActive ? { status: 'connected', label: 'Connected', tone: 'success' } : { status: 'online', label: 'Online', tone: 'success' };
    case 'unreachable':
      return { status: 'offline', label: 'Unreachable', tone: 'danger' };
    case 'unauthorized':
      return { status: 'repair', label: 'Needs re-pairing', tone: 'danger' };
    default:
      return { status: 'checking', label: 'Checking…', tone: 'muted' };
  }
}

export interface RouteChip {
  route: HostRoute;
  label: string;
  /** The route that serves right now (or served last): the card draws it green. */
  best: boolean;
}

/**
 * The routes a paired Mac can be reached by, as chips: each kind of address it was reached on (LAN, Tailscale, USB …),
 * its relay and its built-in tunnel when the card has them. `serving` is the route in use (a live P2P link counts), which
 * the card marks. Latencies are not shown: the connection manager races the routes and keeps only the winner.
 */
export function routeChips(record: Pick<HostRecordV3, 'host' | 'addresses' | 'relay' | 'tailcat' | 'lastRoute'>, serving: HostRoute): RouteChip[] {
  const kinds: HostRoute[] = [];
  const add = (route: HostRoute) => {
    if (!kinds.includes(route)) kinds.push(route);
  };
  for (const address of record.addresses.length > 0 ? record.addresses : [{ host: record.host }]) add(hostRoute(address.host));
  if (record.relay) add('relay');
  if (record.tailcat) add('tailcat');
  if (serving === 'p2p') kinds.unshift('p2p');
  return kinds.map((route) => ({ route, label: routeLabel(route), best: route === serving }));
}
