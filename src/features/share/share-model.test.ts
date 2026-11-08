import { describe, expect, it } from 'vitest';

import { MAX_SHARED_CHARS, sharedPrompt } from './share-model';

describe('sharedPrompt', () => {
  it('offers a selection as is and a bare link as the link', () => {
    expect(sharedPrompt({ text: '  why does this panic?  ' })).toBe('why does this panic?');
    expect(sharedPrompt({ webUrl: 'https://example.com/a' })).toBe('https://example.com/a');
  });

  it('puts the page title ahead of the link, once', () => {
    expect(sharedPrompt({ webUrl: 'https://example.com/a', meta: { title: 'Example A' } })).toBe('Example A\nhttps://example.com/a');
    expect(sharedPrompt({ text: 'Example A https://example.com/a', webUrl: 'https://example.com/a', meta: { title: 'Example A' } })).toBe('Example A https://example.com/a');
  });

  it('does not repeat a link the text already carries and joins one it does not', () => {
    expect(sharedPrompt({ text: 'see https://example.com/a', webUrl: 'https://example.com/a' })).toBe('see https://example.com/a');
    expect(sharedPrompt({ text: 'see this', webUrl: 'https://example.com/a' })).toBe('see this\nhttps://example.com/a');
  });

  it('is null when nothing usable arrived and never exceeds the Host limit', () => {
    expect(sharedPrompt({})).toBeNull();
    expect(sharedPrompt({ text: '   ', webUrl: null, meta: { title: 'Only a title' } })).toBeNull();
    const long = sharedPrompt({ text: 'あ'.repeat(MAX_SHARED_CHARS + 50) });
    expect(long?.length).toBe(MAX_SHARED_CHARS);
    expect(new TextEncoder().encode(long ?? '').length).toBeLessThanOrEqual(64 * 1024);
  });
});
