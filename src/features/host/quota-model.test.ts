import { describe, expect, it } from 'vitest';

import type { Quota, QuotaProvider, QuotaWindow } from '@/contracts/host-v3';
import { ageOf, formatInMs, levelOf, paceOf, providerHeadline, providerIsUsable, quotaProviderName, quotaSummary, usedLeftLine } from '@/features/host/quota-model';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const window = (over: Partial<QuotaWindow> = {}): QuotaWindow => ({ name: '5-hour', usedPct: 40, ...over });

const provider = (over: Partial<QuotaProvider> = {}): QuotaProvider => ({
  id: 'codex',
  state: 'live',
  windows: [],
  ...over,
});

describe('quota model', () => {
  it('tones the bar at the desktop’s own thresholds', () => {
    expect(levelOf(0)).toBe('ok');
    expect(levelOf(79.9)).toBe('ok');
    expect(levelOf(80)).toBe('warn');
    expect(levelOf(94.9)).toBe('warn');
    expect(levelOf(95)).toBe('bad');
  });

  it('extrapolates the pace only once the window has really begun', () => {
    const now = 1_800_000_000_000;
    const spanMs = 5 * HOUR;
    // 30 minutes into a 5-hour window is 10% elapsed — too early to trust the rate.
    expect(paceOf(window({ usedPct: 10, spanMs, resetsAtMs: now + 4.5 * HOUR }), now)).toEqual({ state: 'unknown' });
    // 60% of the window gone (2h of 5h), 30% spent: the pace lasts past the reset.
    const resetsAtMs = now + 2 * HOUR;
    const on = paceOf(window({ usedPct: 30, spanMs, resetsAtMs }), now);
    expect(on.state).toBe('on');
    // 60% of the window gone, 90% spent: it runs out long before the reset.
    const runsOut = paceOf(window({ usedPct: 90, spanMs, resetsAtMs }), now);
    expect(runsOut.state).toBe('runsOut');
    expect(runsOut.runsOutInMs).toBeLessThan(resetsAtMs - now);
    expect(paceOf(window({ usedPct: 100, spanMs, resetsAtMs }), now)).toEqual({ state: 'exceeded' });
    // No span or reset to measure against: honest unknown.
    expect(paceOf(window({ usedPct: 50 }), now)).toEqual({ state: 'unknown' });
    expect(paceOf(window({ usedPct: 0, spanMs, resetsAtMs }), now)).toEqual({ state: 'unknown' });
  });

  it('reads the window as a count, an amount, or a plain share', () => {
    expect(usedLeftLine(window({ usedPct: 62, used: 124, max: 500, unit: 'requests' }))).toBe('62% · 124 of 500 requests');
    expect(usedLeftLine(window({ usedPct: 58, amount: '$11.60 of $20' }))).toBe('58% · $11.60 of $20');
    expect(usedLeftLine(window({ usedPct: 41.4 }))).toBe('41% used · 59% left');
  });

  it('names providers, falling back to the id the Host sent', () => {
    expect(quotaProviderName('claude')).toBe('Claude Code');
    expect(quotaProviderName('zhipu')).toBe('Zhipu GLM');
    expect(quotaProviderName('newagent')).toBe('newagent');
  });

  it('words each source state honestly', () => {
    const now = 1_800_000_000_000;
    expect(providerHeadline(provider({ state: 'disabled' }), now)).toMatch(/Off — enable it in Solco/);
    expect(providerHeadline(provider({ state: 'idle' }), now)).toMatch(/Not read yet/);
    expect(providerHeadline(provider({ state: 'setup' }), now)).toMatch(/Set up in Solco/);
    expect(providerHeadline(provider({ state: 'expired', detail: 'expired token' }), now)).toMatch(/refused — expired token/);
    expect(providerHeadline(provider({ state: 'rate_limited', retryAtMs: now + 15 * MINUTE }), now)).toMatch(/retries after 15m/);
    expect(providerHeadline(provider({ state: 'unavailable' }), now)).toMatch(/unreachable/);
    expect(providerHeadline(provider({ state: 'custom_endpoint' }), now)).toMatch(/no plan quota/);
    expect(providerHeadline(provider({ state: 'live' }), now)).toBeNull();
  });

  it('counts a failed but readable source as usable — its old value still shows', () => {
    expect(providerIsUsable(provider({ state: 'rate_limited', windows: [window()] }))).toBe(true);
    expect(providerIsUsable(provider({ state: 'live', windows: [] }))).toBe(false);
    expect(providerIsUsable(provider({ state: 'disabled', windows: [window()] }))).toBe(false);
  });

  it('summarises the page: tightest window, next reset, source health', () => {
    const now = 1_800_000_000_000;
    const quota: Quota = {
      providers: [
        provider({ id: 'codex', windows: [window({ usedPct: 19, resetsAtMs: now + 3 * HOUR })] }),
        provider({ id: 'claude', state: 'rate_limited', windows: [window({ name: 'Weekly', usedPct: 87, resetsAtMs: now + 2 * HOUR })] }),
        provider({ id: 'cursor', state: 'disabled', windows: [] }),
      ],
    };
    const summary = quotaSummary(quota);
    expect(summary.tightest?.provider.id).toBe('claude');
    expect(summary.tightest?.window.name).toBe('Weekly');
    expect(summary.nextResetMs).toBe(now + 2 * HOUR);
    expect(summary.sources).toEqual({ live: 1, enabled: 2 });
    expect(quotaSummary({ providers: [] }).tightest).toBeNull();
  });

  it('formats durations and ages the way the page reads them', () => {
    expect(formatInMs(2 * HOUR + 14 * MINUTE)).toBe('2h 14m');
    expect(formatInMs(3 * 24 * HOUR + 4 * HOUR)).toBe('3d 4h');
    expect(formatInMs(30_000)).toBe('1m');
    expect(formatInMs(0)).toBe('…');
    const now = 1_800_000_000_000;
    expect(ageOf(now - 30_000, now)).toBe('just now');
    expect(ageOf(now - 12 * MINUTE, now)).toBe('12m ago');
    expect(ageOf(undefined, now)).toBeNull();
  });
});
