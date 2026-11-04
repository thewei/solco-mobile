// [INPUT]: the view's size, the video content's pixel size and the user's zoom/pan.
// [OUTPUT]: letterbox rect, screen↔content mapping to 0…1 coordinates, viewport clamp/zoom helpers.
// [POS]: Pure maths shared by the gesture engine and the surface (no React, no RN), so every mapping is unit-tested.
// [PROTOCOL]: 变更时更新此头部
export interface Size {
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Rect extends Pt, Size {}

/** zoom ≥ 1 scales around the view centre; pan is a view-pixel offset applied after scaling. */
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}
export const IDENTITY_VIEWPORT: Viewport = { zoom: 1, panX: 0, panY: 0 };
export const MAX_ZOOM = 5;
/** While fingers are down the picture may stretch past its limits, with resistance, and springs back on release. */
export const MIN_ELASTIC_ZOOM = 0.8;
export const MAX_ELASTIC_ZOOM = MAX_ZOOM * 1.2;
/** Share of a finger's travel that still moves the picture once it is past a limit. */
export const RESISTANCE = 0.35;
/** Overshoot of the pan past an edge never exceeds this share of the view. */
export const MAX_OVERSCROLL = 0.15;
/** A release below this zoom snaps back to 1× (like a photo viewer). */
export const SNAP_ZOOM = 1.06;

/** Where `content` is drawn inside `view` with `objectFit: contain` (zoom 1). */
export function containRect(view: Size, content: Size): Rect {
  if (view.w <= 0 || view.h <= 0 || content.w <= 0 || content.h <= 0) return { x: 0, y: 0, w: Math.max(view.w, 0), h: Math.max(view.h, 0) };
  const k = Math.min(view.w / content.w, view.h / content.h);
  const w = content.w * k;
  const h = content.h * k;
  return { x: (view.w - w) / 2, y: (view.h - h) / 2, w, h };
}

/** Screen (view-local) → un-zoomed view coordinates. */
export function unzoom(p: Pt, view: Size, vp: Viewport): Pt {
  const cx = view.w / 2;
  const cy = view.h / 2;
  return { x: (p.x - cx - vp.panX) / vp.zoom + cx, y: (p.y - cy - vp.panY) / vp.zoom + cy };
}

/** View point → normalised content coordinates, or null when it falls on the letterbox bars. */
export function toNormalized(p: Pt, view: Size, content: Size, vp: Viewport = IDENTITY_VIEWPORT): Pt | null {
  const r = containRect(view, content);
  const u = unzoom(p, view, vp);
  const x = (u.x - r.x) / r.w;
  const y = (u.y - r.y) / r.h;
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  return { x, y };
}

/** Like toNormalized but clamps onto the content edge (a drag that leaves the picture keeps going to the edge). */
export function toNormalizedClamped(p: Pt, view: Size, content: Size, vp: Viewport = IDENTITY_VIEWPORT): Pt {
  const r = containRect(view, content);
  const u = unzoom(p, view, vp);
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x: c((u.x - r.x) / (r.w || 1)), y: c((u.y - r.y) / (r.h || 1)) };
}

/** A screen-pixel delta → a normalised delta (what trackpad mode feeds the cursor). */
export function deltaToNormalized(dx: number, dy: number, view: Size, content: Size, vp: Viewport = IDENTITY_VIEWPORT): Pt {
  const r = containRect(view, content);
  return { x: dx / vp.zoom / (r.w || 1), y: dy / vp.zoom / (r.h || 1) };
}

/** Keep the zoomed picture covering the view: pan may not drag an edge past the view's. */
export function clampViewport(vp: Viewport, view: Size): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, vp.zoom));
  const maxX = (view.w * (zoom - 1)) / 2;
  const maxY = (view.h * (zoom - 1)) / 2;
  return { zoom, panX: Math.min(maxX, Math.max(-maxX, vp.panX)), panY: Math.min(maxY, Math.max(-maxY, vp.panY)) };
}

/** Zoom by `factor` keeping the content under `focal` (a view point) fixed, then move by `pan`. */
export function zoomAt(vp: Viewport, view: Size, focal: Pt, factor: number, pan: Pt = { x: 0, y: 0 }, elastic = false): Viewport {
  if (elastic) return zoomAtElastic(vp, view, focal, factor, pan);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, vp.zoom * factor));
  const k = zoom / vp.zoom;
  const cx = view.w / 2;
  const cy = view.h / 2;
  // screen = (u - c) * zoom + c + pan  ⇒ keep u fixed at `focal`.
  const panX = focal.x - cx - (focal.x - cx - vp.panX) * k + pan.x;
  const panY = focal.y - cy - (focal.y - cy - vp.panY) * k + pan.y;
  return clampViewport({ zoom, panX, panY }, view);
}

/** One axis of the rubber band: the overshoot grows with resistance going out and shrinks freely coming back. */
function elasticAxis(prev: number, raw: number, bound: number, limit: number): number {
  if (Math.abs(raw) <= bound) return raw;
  const sign = raw < 0 ? -1 : 1;
  const over = Math.abs(raw) - bound;
  const prevOver = Math.sign(prev) === sign ? Math.max(0, Math.abs(prev) - bound) : 0;
  const shown = over > prevOver ? prevOver + (over - prevOver) * RESISTANCE : over;
  return sign * (bound + Math.min(limit, shown));
}

/** zoomAt for live fingers: limits resist instead of stopping dead; `settleViewport` is where it ends up. */
function zoomAtElastic(vp: Viewport, view: Size, focal: Pt, factor: number, pan: Pt): Viewport {
  const out = (vp.zoom <= 1 && factor < 1) || (vp.zoom >= MAX_ZOOM && factor > 1);
  const f = out ? 1 + (factor - 1) * RESISTANCE : factor;
  const zoom = Math.min(MAX_ELASTIC_ZOOM, Math.max(MIN_ELASTIC_ZOOM, vp.zoom * f));
  const k = zoom / vp.zoom;
  const cx = view.w / 2;
  const cy = view.h / 2;
  const rawX = focal.x - cx - (focal.x - cx - vp.panX) * k + pan.x;
  const rawY = focal.y - cy - (focal.y - cy - vp.panY) * k + pan.y;
  const real = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const boundX = (view.w * (real - 1)) / 2;
  const boundY = (view.h * (real - 1)) / 2;
  return {
    zoom,
    panX: elasticAxis(vp.panX, rawX, boundX, view.w * MAX_OVERSCROLL),
    panY: elasticAxis(vp.panY, rawY, boundY, view.h * MAX_OVERSCROLL),
  };
}

/** Where a released picture comes to rest: inside its limits, and exactly 1× when it was nearly there. */
export function settleViewport(vp: Viewport, view: Size): Viewport {
  return vp.zoom < SNAP_ZOOM ? IDENTITY_VIEWPORT : clampViewport(vp, view);
}

/** Normalised content coordinates → view-local screen point (the inverse of toNormalized), for drawing the trackpad cursor. */
export function toViewPoint(n: Pt, view: Size, content: Size, vp: Viewport = IDENTITY_VIEWPORT): Pt {
  const r = containRect(view, content);
  const ux = r.x + n.x * r.w;
  const uy = r.y + n.y * r.h;
  const cx = view.w / 2;
  const cy = view.h / 2;
  return { x: (ux - cx) * vp.zoom + cx + vp.panX, y: (uy - cy) * vp.zoom + cy + vp.panY };
}
