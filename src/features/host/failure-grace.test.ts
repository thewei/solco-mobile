import { describe, expect, it } from 'vitest';

import { blocksScreen } from '@/features/host/failure-grace';
import { HostV3Error } from '@/lib/host-client-v3';

const timeout = new HostV3Error('transport', 'failed after 8000 ms');
const revoked = new HostV3Error('unauthorized', 'revoked');

describe('blocksScreen', () => {
  it('never blocks without a failure', () => {
    expect(blocksScreen({ failure: null, hasData: true, graceElapsed: true })).toBe(false);
  });

  it('keeps the last answer on screen while the way in is repaired', () => {
    expect(blocksScreen({ failure: timeout, hasData: true, graceElapsed: false })).toBe(false);
  });

  it('shows the exact error when nothing was ever read', () => {
    expect(blocksScreen({ failure: timeout, hasData: false, graceElapsed: false })).toBe(true);
  });

  it('shows the exact error once the outage outlasts the grace period', () => {
    expect(blocksScreen({ failure: timeout, hasData: true, graceElapsed: true })).toBe(true);
  });

  it('does not wait for a failure that is not about the way in', () => {
    expect(blocksScreen({ failure: revoked, hasData: true, graceElapsed: false })).toBe(true);
  });
});
