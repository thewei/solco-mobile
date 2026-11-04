// [INPUT]: the window rect of the surface a navigation zooms out of (Home's composer card, the compose page).
// [OUTPUT]: setZoomOrigin / takeZoomOrigin — a one-shot hand-off of that rect to the screen being pushed, which
//           `ZoomIn` (components/motion) reads once on mount to grow the new page out of the tapped surface.
// [POS]: The bridge for the container-transform feel of the Home → New session / Chat push. Route params stay
//        serializable; the rect travels through this slot instead, consumed by the first zooming screen.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
// Invariant: one slot, set immediately before the push and taken once on mount — no screen ever animates from a
//            stale rect, and a screen entered without a hand-off (deep link, back, drawer) zooms from center.

export interface ZoomOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

let slot: ZoomOrigin | null = null;

export function setZoomOrigin(origin: ZoomOrigin | null): void {
  slot = origin;
}

export function takeZoomOrigin(): ZoomOrigin | null {
  const origin = slot;
  slot = null;
  return origin;
}
