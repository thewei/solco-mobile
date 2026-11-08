import { describe, expect, it } from 'vitest';

import { PAGE_DOWN, PAGE_UP, pagesFromDrag } from './page-keys';

describe('page keys', () => {
  it('uses the xterm PgUp / PgDn sequences', () => {
    expect(PAGE_UP).toBe('\u001b[5~');
    expect(PAGE_DOWN).toBe('\u001b[6~');
  });

  it('turns a drag into whole pages once, never twice', () => {
    expect(pagesFromDrag(50, 0, 72)).toEqual({ pages: 0, consumed: 0 });
    expect(pagesFromDrag(80, 0, 72)).toEqual({ pages: 1, consumed: 72 });
    expect(pagesFromDrag(100, 72, 72)).toEqual({ pages: 0, consumed: 72 });
    expect(pagesFromDrag(150, 72, 72)).toEqual({ pages: 1, consumed: 144 });
  });

  it('drags up are PgDn and reversing the drag pages back', () => {
    expect(pagesFromDrag(-150, 0, 72)).toEqual({ pages: -2, consumed: -144 });
    expect(pagesFromDrag(0, 144, 72)).toEqual({ pages: -2, consumed: 0 });
  });
});
