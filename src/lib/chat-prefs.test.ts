import { describe, expect, it } from 'vitest';

import { DEFAULT_CHAT_PREFS, parseChatPrefs, serializeChatPrefs } from './chat-prefs';

describe('chat-prefs codec', () => {
  it('falls back to default on null/empty/invalid', () => {
    expect(parseChatPrefs(null)).toEqual(DEFAULT_CHAT_PREFS);
    expect(parseChatPrefs('')).toEqual(DEFAULT_CHAT_PREFS);
    expect(parseChatPrefs('not-json')).toEqual(DEFAULT_CHAT_PREFS);
    expect(parseChatPrefs('{}')).toEqual({ chatOutline: false });
  });

  it('parses valid preferences and serializes round-trip', () => {
    const on = parseChatPrefs(JSON.stringify({ chatOutline: true }));
    expect(on.chatOutline).toBe(true);
    expect(JSON.parse(serializeChatPrefs(on))).toEqual({ chatOutline: true });

    const off = parseChatPrefs(JSON.stringify({ chatOutline: false }));
    expect(off.chatOutline).toBe(false);
  });
});
