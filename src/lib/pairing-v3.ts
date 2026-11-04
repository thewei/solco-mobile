// [INPUT]: a scanned or opened `solco://pair?h=&p=&fp=&c=&n=[&r=&rt=]` link (the Go Host's QR
//          payload; `r`/`rt` are the optional self-hosted relay base URL and relay secret).
// [OUTPUT]: parsePairUrl → a validated PairTarget (host, port, certificate fingerprint, one-time
//           code, display name, optional relay) and the pure builders for the Host's base URL /
//           pair body.
// [POS]: Pairing's only parser. No react-native, no URL class (Hermes' URL is partial), no
//        network, no storage — the code and fingerprint are secrets-in-transit: never logged.
// Invariant: refuse rather than repair — a malformed link must never turn into a connection
// attempt to a different host. The fingerprint is the only trust anchor for the Host's
// self-signed certificate (the pin is what makes LAN HTTPS safe); an optional relay (`r`/`rt`)
// is an endpoint the user registered by physically scanning the Mac's QR — explicit, never a
// fallback.

export interface PairRelay {
  /** Relay base URL (https, no trailing slash), as the link's `r` carried it. */
  url: string;
  /** This phone's relay secret (`rt`); the relay only ever stores its hash. */
  secret: string;
}

export interface PairTarget {
  /** Interface address the Host listens on (IPv4, IPv6 or a DNS name). */
  host: string;
  port: number;
  /** Lowercase hex SHA-256 of the Host certificate's DER. */
  fingerprint: string;
  /** Single-use pairing code (26 base32 characters). */
  code: string;
  /** Mac's display name; may be empty. */
  hostName: string;
  /** Present only when the link carried both `r` and `rt`; a half-specified relay refuses the link. */
  relay?: PairRelay;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-fA-F:.]+$/;
const DNS = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const FINGERPRINT = /^[0-9a-fA-F]{64}$/;
const CODE = /^[A-Z2-7]{26}$/;
const RELAY_URL = /^https:\/\/[^\s?#]+$/;
const RELAY_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const NAME_MAX = 80;

function validHost(host: string): boolean {
  if (IPV4.test(host)) return host.split('.').every((part) => Number(part) <= 255);
  if (host.includes(':')) return IPV6.test(host) && host.length <= 45;
  return host.length <= 253 && DNS.test(host);
}

/** `a=1&b=2%20x&c=y+z` → map; later duplicates are rejected by returning null. */
function parseQuery(query: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      return null;
    }
    if (key in out) return null;
    out[key] = value;
  }
  return out;
}

/** Validates the five link fields (already decoded). Arrays — a repeated key — are refused. */
export function parsePairParams(params: Record<string, string | string[] | undefined>): PairTarget | null {
  const field = (key: string): string | null => {
    const value = params[key];
    if (value === undefined) return '';
    return typeof value === 'string' ? value : null;
  };
  const rawHost = field('h');
  const portText = field('p');
  const fingerprint = field('fp');
  const code = field('c');
  const rawName = field('n');
  if (rawHost === null || portText === null || fingerprint === null || code === null || rawName === null) return null;
  // A half-specified relay (one of r/rt missing) is a damaged link, not a direct pair: refuse.
  const rawRelayUrl = field('r');
  const relaySecret = field('rt');
  if (rawRelayUrl === null || relaySecret === null) return null;
  if (!rawRelayUrl !== !relaySecret) return null;

  const host = rawHost.trim();
  const hostName = rawName.trim();
  if (!validHost(host)) return null;
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  if (!FINGERPRINT.test(fingerprint)) return null;
  if (!CODE.test(code)) return null;
  if (hostName.length > NAME_MAX) return null;
  let relay: PairRelay | undefined;
  if (rawRelayUrl) {
    const url = rawRelayUrl.trim().replace(/\/+$/, '');
    if (!RELAY_URL.test(url) || !RELAY_SECRET.test(relaySecret)) return null;
    relay = { url, secret: relaySecret };
  }

  return { host, port, fingerprint: fingerprint.toLowerCase(), code, hostName, ...(relay ? { relay } : {}) };
}

/** Returns null for anything that is not a complete, well-formed Solco pairing link. */
export function parsePairUrl(input: string): PairTarget | null {
  const match = /^solco:\/\/pair\?([^#]*)(#.*)?$/i.exec(input.trim());
  if (!match) return null;
  const params = parseQuery(match[1] ?? '');
  return params ? parsePairParams(params) : null;
}

/** The /pair route's params for a parsed link — every field, the relay (`r`/`rt`) included, so a scan can never pair direct-only by accident. */
export function pairTargetParams(target: PairTarget): Record<string, string> {
  return {
    h: target.host,
    p: String(target.port),
    fp: target.fingerprint,
    c: target.code,
    n: target.hostName,
    ...(target.relay ? { r: target.relay.url, rt: target.relay.secret } : {}),
  };
}

/** `https://host:port` with IPv6 literals bracketed. The Host serves TLS only. */
export function pairTargetBaseUrl(target: Pick<PairTarget, 'host' | 'port'>): string {
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  return `https://${host}:${target.port}`;
}

/** Body of `POST /api/v3/pair`. */
export function pairRequestBody(target: Pick<PairTarget, 'code'>, deviceName: string): string {
  return JSON.stringify({ code: target.code, deviceName: deviceName.trim().slice(0, NAME_MAX) });
}
