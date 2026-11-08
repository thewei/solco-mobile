import { describe, expect, it } from 'vitest';

import { addSnippet, getRecent, MAX_RECENT, MAX_SNIPPETS, parseSnippets, pushRecent, rememberLine, removeSnippet, serializeSnippets } from './terminal-snippets';

describe('terminal snippets', () => {
  it('round-trips and treats unreadable storage as empty', () => {
    const list = addSnippet(addSnippet([], 'git status', 'a'), 'ls -la', 'b');
    expect(list.map((s) => s.text)).toEqual(['ls -la', 'git status']);
    expect(parseSnippets(serializeSnippets(list))).toEqual(list);
    for (const raw of [null, '', 'nope', '{}', '[{"id":"","text":"x"}]', '[{"id":"a"}]']) expect(parseSnippets(raw)).toEqual([]);
  });

  it('saves only single non-blank lines, once each, up to the cap', () => {
    const base = addSnippet([], 'make test', 'a');
    expect(addSnippet(base, '  make test  ', 'b')).toEqual(base);
    expect(addSnippet(base, '   ', 'b')).toEqual(base);
    expect(addSnippet(base, 'one\ntwo', 'b')).toEqual(base);
    let full = base;
    for (let i = 0; i < MAX_SNIPPETS + 5; i++) full = addSnippet(full, `cmd ${i}`, `id${i}`);
    expect(full).toHaveLength(MAX_SNIPPETS);
    expect(removeSnippet(full, full[0]!.id)).toHaveLength(MAX_SNIPPETS - 1);
  });

  it('keeps recent lines newest-first without repeats, capped, in memory only', () => {
    expect(pushRecent(['b', 'a'], 'a')).toEqual(['a', 'b']);
    expect(pushRecent(['a'], '')).toEqual(['a']);
    let list: string[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) list = pushRecent(list, `l${i}`);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe(`l${MAX_RECENT + 2}`);
    rememberLine('hunter2');
    expect(getRecent()[0]).toBe('hunter2');
  });
});
