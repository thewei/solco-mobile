import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFS, MAX_PINNED, displayName, parseRdPrefs, serializeRdPrefs, shortcutId, sortDevices, togglePinned } from './prefs';

const copy = { label: '⌘C', mods: ['Meta'], code: 'KeyC' } as const;

describe('rd prefs', () => {
  it('round-trips and survives damage', () => {
    const p = { ...DEFAULT_PREFS, quickKeys: [{ ...copy, mods: [...copy.mods] }], clipboardSync: true, aliases: { a: 'Studio' }, lastOpened: { a: 5 } };
    expect(parseRdPrefs(serializeRdPrefs(p))).toEqual(p);
    expect(parseRdPrefs('{nope')).toEqual(DEFAULT_PREFS);
    expect(parseRdPrefs(null)).toEqual(DEFAULT_PREFS);
  });
  it('drops malformed entries', () => {
    const p = parseRdPrefs(JSON.stringify({ quickKeys: [{ label: 1 }, { label: 'x', code: 'KeyX', mods: ['Hyper'] }, copy], aliases: { a: ' ', b: 'Home' }, lastOpened: { a: 'x', b: 3 } }));
    expect(p.quickKeys.map(shortcutId)).toEqual(['Meta+KeyC']);
    expect(p.aliases).toEqual({ b: 'Home' });
    expect(p.lastOpened).toEqual({ b: 3 });
  });
  it('keeps the floating button where it was left, and repairs a bad position', () => {
    const p = { ...DEFAULT_PREFS, modeButton: { side: 'left' as const, y: 0.7 } };
    expect(parseRdPrefs(serializeRdPrefs(p)).modeButton).toEqual({ side: 'left', y: 0.7 });
    expect(parseRdPrefs(JSON.stringify({ modeButton: { side: 'top', y: 9 } })).modeButton).toEqual({ side: 'right', y: 0.95 });
    expect(parseRdPrefs(JSON.stringify({ modeButton: 'x' })).modeButton).toEqual(DEFAULT_PREFS.modeButton);
  });
  it('toggles a pin and caps the list', () => {
    const one = togglePinned([], { ...copy, mods: ['Meta'] });
    expect(one).toHaveLength(1);
    expect(togglePinned(one, { ...copy, mods: ['Meta'] })).toEqual([]);
    let full = [] as ReturnType<typeof togglePinned>;
    for (let i = 0; i < MAX_PINNED + 3; i++) full = togglePinned(full, { label: `F${i}`, mods: [], code: `F${i}` });
    expect(full).toHaveLength(MAX_PINNED);
  });
  it('names and sorts devices', () => {
    const prefs = { ...DEFAULT_PREFS, aliases: { b: 'Studio' }, lastOpened: { c: 9, a: 2 } };
    expect(displayName(prefs, 'b', 'MacBook')).toBe('Studio');
    expect(displayName(prefs, 'x', 'MacBook')).toBe('MacBook');
    expect(sortDevices([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], prefs).map((d) => d.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});
