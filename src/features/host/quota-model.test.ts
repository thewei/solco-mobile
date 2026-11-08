import { describe, expect, it } from 'vitest';

import type { QuotaProvider, QuotaWindow } from '@/contracts/host-v3';
import { ageOf, formatInMs, levelOf, paceOf, providerHeadline, quotaProviderName, windowFace } from '@/features/host/quota-model';

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

  it('draws a window as a card: the share left, the verdict, the pace line and the even-rate tick', () => {
    const now = 1_800_000_000_000;
    const spanMs = 5 * HOUR;
    // 61% of a 5 h window gone (resets in 1 h 57 m), 82% spent: it runs out well before the reset.
    const hot = windowFace(window({ usedPct: 82, spanMs, resetsAtMs: now + 1.95 * HOUR }), now);
    expect(hot.left).toBe(18);
    expect(hot.level).toBe('warn');
    expect(hot.verdict).toEqual({ text: expect.stringMatching(/^Runs out in /) as string, tone: 'warn' });
    expect(hot.pace).toBe('Burning faster than the window allows');
    expect(hot.tickPct).toBe(61);
    expect(hot.usedLine).toBe('82% used');
    expect(hot.resetsIn).toBe('1h 57m');

    // 66% elapsed, 59% spent: projected 89%, so about 11% headroom.
    const easy = windowFace(window({ name: 'Weekly', usedPct: 59, spanMs: 7 * 24 * HOUR, resetsAtMs: now + 0.34 * 7 * 24 * HOUR }), now);
    expect(easy.verdict).toEqual({ text: 'Under pace', tone: 'muted' });
    expect(easy.pace).toBe('+11% headroom at this rate');
    expect(easy.tickPct).toBe(66);

    expect(windowFace(window({ usedPct: 100, spanMs, resetsAtMs: now + HOUR }), now).verdict).toEqual({ text: 'Allowance spent', tone: 'bad' });
    expect(windowFace(window({ usedPct: 100, spanMs, resetsAtMs: now + HOUR }), now).left).toBe(0);
  });

  it('words a window the pace cannot be read for, and a counted one', () => {
    const now = 1_800_000_000_000;
    const fresh = windowFace(window({ usedPct: 0 }), now);
    expect(fresh).toMatchObject({ left: 100, pace: 'No usage yet in this window', tickPct: null, resetsIn: null, verdict: { text: 'Under pace' } });
    expect(windowFace(window({ usedPct: 1 }), now).pace).toBe('Barely touched');
    expect(windowFace(window({ usedPct: 30 }), now)).toMatchObject({ pace: 'Too early to tell the pace', verdict: null });
    expect(windowFace(window({ usedPct: 62, used: 124, max: 500, unit: 'requests' }), now).usedLine).toBe('124 of 500 requests');
    expect(windowFace(window({ usedPct: 58, amount: '$11.60 of $20' }), now).usedLine).toBe('$11.60 of $20');
    // A reset already in the past: the whole window has gone by, the countdown says so.
    expect(windowFace(window({ usedPct: 10, spanMs: HOUR, resetsAtMs: now - 5 }), now)).toMatchObject({ tickPct: 100, resetsIn: '…' });
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
    expect(providerHeadline(provider({ id: 'cursor', state: 'expired', detail: 'expired token' }), now)).toBe('Cursor needs you to sign in again on the Mac. Sign in there, then retry.');
    expect(providerHeadline(provider({ state: 'rate_limited', retryAtMs: now + 15 * MINUTE }), now)).toMatch(/retries after 15m/);
    expect(providerHeadline(provider({ state: 'unavailable' }), now)).toMatch(/unreachable/);
    expect(providerHeadline(provider({ state: 'custom_endpoint' }), now)).toMatch(/no plan quota/);
    expect(providerHeadline(provider({ state: 'live' }), now)).toBeNull();
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
