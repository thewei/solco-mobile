// [INPUT]: the Host's read-only Quota DTOs (Quota, QuotaProvider, QuotaWindow) and a clock.
// [OUTPUT]: quotaProviderName, levelOf, paceOf, windowFace, providerHeadline, formatInMs, ageOf.
// [POS]: Pure presentation model behind the phone's Usage screen; no IO, no state. The Host owns
//        every quota fact — this only words, orders and derives them (bar tone, pace, the even-rate tick) the same way
//        the desktop page does (80% warns, 95% is critical; pace needs 15% of the window gone).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { QuotaProvider, QuotaWindow } from '@/contracts/host-v3';

/** The providers the page knows, in the desktop page's order; a new Host id still renders by its id. */
const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  zhipu: 'Zhipu GLM',
  copilot: 'GitHub Copilot',
  antigravity: 'Antigravity',
};

export function quotaProviderName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}

export type QuotaLevel = 'ok' | 'warn' | 'bad';

/** The bar's tone: 80% warns, 95% is critical (the desktop's own thresholds). */
export function levelOf(usedPct: number): QuotaLevel {
  if (usedPct >= 95) return 'bad';
  if (usedPct >= 80) return 'warn';
  return 'ok';
}

export type PaceState = 'unknown' | 'on' | 'runsOut' | 'exceeded';

/**
 * Extrapolates the window's rate so far — the desktop's Pace. Too early in the window (or no
 * span/reset to measure against) stays unknown rather than extrapolating one request into a huge rate.
 */
export function paceOf(window: QuotaWindow, now: number): { state: PaceState; runsOutInMs?: number } {
  if (!window.spanMs || !window.resetsAtMs || window.usedPct <= 0) return { state: 'unknown' };
  if (window.usedPct >= 100) return { state: 'exceeded' };
  const remaining = Math.min(Math.max(window.resetsAtMs - now, 0), window.spanMs);
  const elapsed = 1 - remaining / window.spanMs;
  if (elapsed < 0.15) return { state: 'unknown' };
  const left = (elapsed * window.spanMs * (100 - window.usedPct)) / window.usedPct;
  if (left < window.resetsAtMs - now) return { state: 'runsOut', runsOutInMs: left };
  return { state: 'on' };
}

export interface WindowFace {
  /** The big number: the share left, in whole percent. */
  left: number;
  /** The pace verdict on the card's right; null when there is none to give. */
  verdict: { text: string; tone: 'muted' | 'warn' | 'bad' } | null;
  /** The one line under the number. */
  pace: string;
  /** Where an even rate would be by now (0–100), the meter's tick; null when the window's span or reset is unknown. */
  tickPct: number | null;
  level: QuotaLevel;
  /** The meter's left caption: a count, an amount or "82% used". */
  usedLine: string;
  /** "1h 12m"; null when the Host gives no reset. */
  resetsIn: string | null;
}

const formatCount = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** How much of the window has gone by (0–1), null without a span and a reset to measure against. */
function elapsedOf(window: QuotaWindow, now: number): number | null {
  if (!window.spanMs || !window.resetsAtMs) return null;
  const remaining = Math.min(Math.max(window.resetsAtMs - now, 0), window.spanMs);
  return 1 - remaining / window.spanMs;
}

/** Everything one usage card draws for a window (designs/mobile-t3-redesign `.ucard`), derived like the desktop's Pace. */
export function windowFace(window: QuotaWindow, now: number): WindowFace {
  const used = Math.min(Math.max(window.usedPct, 0), 100);
  const pace = paceOf(window, now);
  const elapsed = elapsedOf(window, now);
  let verdict: WindowFace['verdict'] = null;
  let line: string;
  if (pace.state === 'runsOut') {
    verdict = { text: `Runs out in ${formatInMs(pace.runsOutInMs ?? 0)}`, tone: 'warn' };
    line = 'Burning faster than the window allows';
  } else if (pace.state === 'exceeded') {
    verdict = { text: 'Allowance spent', tone: 'bad' };
    line = 'Nothing left in this window';
  } else if (pace.state === 'on' && elapsed) {
    verdict = { text: 'Under pace', tone: 'muted' };
    line = `+${Math.max(1, Math.round(100 - used / elapsed))}% headroom at this rate`;
  } else if (used <= 0) {
    verdict = { text: 'Under pace', tone: 'muted' };
    line = 'No usage yet in this window';
  } else if (used < 5) {
    verdict = { text: 'Under pace', tone: 'muted' };
    line = 'Barely touched';
  } else {
    line = 'Too early to tell the pace';
  }
  const counted = window.max !== undefined && window.max > 0;
  return {
    left: Math.round(100 - used),
    verdict,
    pace: line,
    tickPct: elapsed !== null && elapsed >= 0.02 ? Math.round(elapsed * 1000) / 10 : null,
    level: levelOf(used),
    usedLine: counted ? `${formatCount(window.used ?? 0)} of ${formatCount(window.max!)}${window.unit ? ` ${window.unit}` : ''}` : window.amount ? window.amount : `${Math.round(used)}% used`,
    resetsIn: window.resetsAtMs ? formatInMs(window.resetsAtMs - now) : null,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2h 14m", "45m", "3d 4h" — a reset countdown; "…" when unknown. */
export function formatInMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '…';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}

/** "12m ago" — how old a reading is; "just now" under a minute. */
export function ageOf(atMs: number | undefined, now: number): string | null {
  if (!atMs) return null;
  const age = now - atMs;
  if (age < MINUTE) return 'just now';
  return `${formatInMs(age)} ago`;
}

/** The one line under the provider's name: what the reader should know about the source itself. */
export function providerHeadline(provider: QuotaProvider, now: number): string | null {
  const stale = provider.state !== 'live' && provider.state !== 'idle' && provider.state !== 'disabled';
  switch (provider.state) {
    case 'disabled':
      return 'Off — enable it in Solco’s Quota settings';
    case 'idle':
      return 'Not read yet';
    case 'setup':
      return 'Set up in Solco to read this one';
    case 'expired':
      return `${quotaProviderName(provider.id)} needs you to sign in again on the Mac. Sign in there, then retry.`;
    case 'rate_limited':
      return provider.retryAtMs
        ? `Rate limited — retries after ${formatInMs(provider.retryAtMs - now)}`
        : 'Rate limited — retries later';
    case 'unavailable':
      return provider.detail || 'Source unreachable right now';
    case 'custom_endpoint':
      return 'Custom endpoint · no plan quota to read';
    default:
      return stale && provider.detail ? provider.detail : null;
  }
}
