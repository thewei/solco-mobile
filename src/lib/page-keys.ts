// [INPUT]: a vertical drag distance (px), how much of it has already been turned into pages, and the px per page.
// [OUTPUT]: PAGE_UP / PAGE_DOWN (the xterm key sequences Herdr has no named key for) and pagesFromDrag.
// [POS]: Pure core of the terminal's page-scroll rail: dragging down shows older output (PgUp), dragging up newer (PgDn),
//        one page per `step` px, so a full-screen TUI like OMP scrolls its own pages.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
export const PAGE_UP = '\x1b[5~';
export const PAGE_DOWN = '\x1b[6~';

/** `pages` > 0 = PgUp that many times, < 0 = PgDn; `consumed` is the drag distance those pages account for. */
export function pagesFromDrag(dy: number, consumed: number, step: number): { pages: number; consumed: number } {
  const pages = Math.trunc((dy - consumed) / step);
  return { pages, consumed: consumed + pages * step };
}
