import { describe, expect, it } from 'vitest';

import { isRetryable, reconnectDelay } from './reconnect';

describe('reconnectDelay', () => {
  it('walks the ladder and then keeps the longest step', () => {
    const delays = Array.from({ length: 8 }, (_, i) => reconnectDelay(i, 'connection_lost'));
    expect(delays).toEqual([300, 700, 1500, 3000, 5000, 5000, 5000, 5000]);
  });
  it('retries every failure except the Mac refusing this phone', () => {
    for (const code of ['connection_lost', 'unreachable', 'busy', 'internal', 'helper_failed', 'remote_unavailable', 'bad_offer', undefined]) {
      expect(reconnectDelay(0, code)).toBe(300);
      expect(isRetryable(code)).toBe(true);
    }
    for (const code of ['denied', 'remote_disabled', 'permission_required', 'approval_timeout', 'protocol_unsupported', 'display_not_found']) {
      expect(reconnectDelay(0, code)).toBeNull();
      expect(isRetryable(code)).toBe(false);
    }
  });
});
