// [INPUT]: the overlay box (size plus the bands to keep out of) and the saved resting place of the floating button.
// [OUTPUT]: `restPoint(pos, box)` → top-left px of the button; `snapPlace(x, y, box)` → the saved place a drop snaps to
//           (nearest side edge, height as a fraction of the screen); `DRAG_BUTTON_SIZE`, `DragBox`.
// [POS]: The pure half of the draggable Touch/Trackpad button (components/remote-desktop/drag-button.tsx).
// [PROTOCOL]: 变更时更新此头部
import type { ModeButtonPos } from './prefs';

export const DRAG_BUTTON_SIZE = 48;
const MARGIN = 8;

export interface DragBox {
  w: number;
  h: number;
  /** Bands the button keeps out of (status bar / dock). */
  top: number;
  bottom: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function restPoint(pos: ModeButtonPos, box: DragBox): { x: number; y: number } {
  return {
    x: pos.side === 'left' ? MARGIN : box.w - DRAG_BUTTON_SIZE - MARGIN,
    y: clamp(pos.y * box.h - DRAG_BUTTON_SIZE / 2, box.top, Math.max(box.top, box.h - DRAG_BUTTON_SIZE - box.bottom)),
  };
}

export function snapPlace(x: number, y: number, box: DragBox): ModeButtonPos {
  const cx = x + DRAG_BUTTON_SIZE / 2;
  const cy = clamp(y, box.top, Math.max(box.top, box.h - DRAG_BUTTON_SIZE - box.bottom)) + DRAG_BUTTON_SIZE / 2;
  return { side: cx < box.w / 2 ? 'left' : 'right', y: clamp(cy / box.h, 0.05, 0.95) };
}
