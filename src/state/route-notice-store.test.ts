import { beforeEach, describe, expect, it } from 'vitest';

import { useRouteNotice } from '@/state/route-notice-store';

describe('route notice store', () => {
  beforeEach(() => useRouteNotice.setState({ notice: null, lastText: null, lastAt: 0 }));

  it('posts a line and dismisses it', () => {
    useRouteNotice.getState().post('Back on LAN', 1000);
    expect(useRouteNotice.getState().notice?.text).toBe('Back on LAN');
    useRouteNotice.getState().dismiss();
    expect(useRouteNotice.getState().notice).toBeNull();
  });

  it('does not repeat the same line within 30 s, but does after', () => {
    const { post, dismiss } = useRouteNotice.getState();
    post('Direct path unavailable — now using the relay', 1000);
    dismiss();
    post('Direct path unavailable — now using the relay', 20_000);
    expect(useRouteNotice.getState().notice).toBeNull();
    post('Direct path unavailable — now using the relay', 40_000);
    expect(useRouteNotice.getState().notice?.text).toContain('relay');
  });

  it('a different line is never swallowed', () => {
    const { post } = useRouteNotice.getState();
    post('a', 1000);
    post('b', 1001);
    expect(useRouteNotice.getState().notice?.text).toBe('b');
  });
});
