// [INPUT]: the Host's read-only Quota DTOs (Quota, QuotaProvider, QuotaWindow) and a clock.
// [OUTPUT]: quotaProviderName, levelOf, paceOf, usedLeftLine, windowCaption, providerHeadline,
//           providerIsUsable, quotaSummary, formatInMs, ageOf.
// [POS]: Pure presentation model behind the phone's Quota screen; no IO, no state. The Host owns
//        every quota fact — this only words, orders and derives them (bar tone, pace) the same way
//        the desktop page does (80% warns, 95% is critical; pace needs 15% of the window gone).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { Quota, QuotaProvider, QuotaWindow } from '@/contracts/host-v3';

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

/** The window's reading, the desktop's Used | Left: a count when the plan is counted, else a share. */
export function usedLeftLine(window: QuotaWindow): string {
  const pct = `${Math.round(window.usedPct)}%`;
  if (window.max !== undefined && window.max > 0) {
    const used = window.used ?? 0;
    const format = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
    return `${pct} · ${format(used)} of ${format(window.max)}${window.unit ? ` ${window.unit}` : ''}`;
  }
  if (window.amount) return `${pct} · ${window.amount}`;
  const left = Math.max(0, 100 - window.usedPct);
  return `${pct} used · ${Math.round(left)}% left`;
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
      return `Sign-in was refused${provider.detail ? ` — ${provider.detail}` : ''}`;
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

/** A provider whose readings are worth drawing (a failed source keeps its old value, but says why). */
export function providerIsUsable(provider: QuotaProvider): boolean {
  return provider.state !== 'disabled' && provider.state !== 'idle' && provider.windows.length > 0;
}

export interface QuotaSummary {
  /** The window closest to its limit across the enabled providers, null when nothing is read yet. */
  tightest: { provider: QuotaProvider; window: QuotaWindow } | null;
  /** The soonest reset among the windows that carry one, epoch ms. */
  nextResetMs: number | null;
  /** "2 of 3 sources live" health of the enabled providers. */
  sources: { live: number; enabled: number };
}

/** The page's summary row, computed from what the Host answered. */
export function quotaSummary(quota: Quota): QuotaSummary {
  const enabled = quota.providers.filter((p) => p.state !== 'disabled');
  const usable = enabled.filter(providerIsUsable);
  let tightest: QuotaSummary['tightest'] = null;
  let nextResetMs: number | null = null;
  for (const provider of usable) {
    for (const window of provider.windows) {
      if (!tightest || window.usedPct > tightest.window.usedPct) tightest = { provider, window };
      if (window.resetsAtMs && (nextResetMs === null || window.resetsAtMs < nextResetMs)) nextResetMs = window.resetsAtMs;
    }
  }
  return {
    tightest,
    nextResetMs,
    sources: { live: usable.filter((p) => p.state === 'live').length, enabled: enabled.length },
  };
}
