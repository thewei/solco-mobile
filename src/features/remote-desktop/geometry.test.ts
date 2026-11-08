import { describe, expect, it } from 'vitest';

import { toViewPoint, clampViewport, settleViewport, containRect, deltaToNormalized, IDENTITY_VIEWPORT, MAX_ZOOM, toNormalized, toNormalizedClamped, zoomAt } from './geometry';

const view = { w: 800, h: 400 };
const content = { w: 1600, h: 1000 }; // 16:10 on a wide view → pillarboxed

describe('geometry', () => {
  it('letterboxes with contain', () => {
    expect(containRect(view, content)).toEqual({ x: 80, y: 0, w: 640, h: 400 });
    expect(containRect({ w: 400, h: 800 }, content)).toEqual({ x: 0, y: (800 - 250) / 2, w: 400, h: 250 });
  });

  it('maps view points into 0…1 and refuses the bars', () => {
    expect(toNormalized({ x: 400, y: 200 }, view, content)).toEqual({ x: 0.5, y: 0.5 });
    expect(toNormalized({ x: 50, y: 200 }, view, content)).toBeNull();
    expect(toNormalizedClamped({ x: 50, y: 500 }, view, content)).toEqual({ x: 0, y: 1 });
  });

  it('accounts for zoom and pan', () => {
    // 2× around the centre: the view centre still maps to the content centre
    expect(toNormalized({ x: 400, y: 200 }, view, content, { zoom: 2, panX: 0, panY: 0 })).toEqual({ x: 0.5, y: 0.5 });
    // panned right by 100 px → what was left of centre is now under the centre
    const p = toNormalized({ x: 400, y: 200 }, view, content, { zoom: 2, panX: 100, panY: 0 });
    expect(p!.x).toBeCloseTo(0.5 - 50 / 640, 6);
  });

  it('turns a pixel delta into a normalised one, shrunk by zoom', () => {
    expect(deltaToNormalized(64, 40, view, content)).toEqual({ x: 0.1, y: 0.1 });
    expect(deltaToNormalized(64, 40, view, content, { zoom: 2, panX: 0, panY: 0 })).toEqual({ x: 0.05, y: 0.05 });
  });

  it('clamps the pan so the picture keeps covering the view', () => {
    expect(clampViewport({ zoom: 2, panX: 9999, panY: -9999 }, view)).toEqual({ zoom: 2, panX: 400, panY: -200 });
    expect(clampViewport({ zoom: 0.5, panX: 30, panY: 30 }, view)).toEqual(IDENTITY_VIEWPORT);
    expect(clampViewport({ zoom: 99, panX: 0, panY: 0 }, view).zoom).toBe(MAX_ZOOM);
  });

  it('zooms about a focal point without moving the content under it', () => {
    const focal = { x: 600, y: 100 };
    const before = toNormalized(focal, view, content)!;
    const vp = zoomAt(IDENTITY_VIEWPORT, view, focal, 2);
    expect(vp.zoom).toBe(2);
    const after = toNormalized(focal, view, content, vp)!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('elastic zoom resists past its limits and settles back inside them', () => {
    const focal = { x: 400, y: 200 };
    // zooming out at 1×: it gives a little (resisting), never below the elastic floor
    let vp = zoomAt(IDENTITY_VIEWPORT, view, focal, 0.5, undefined, true);
    expect(vp.zoom).toBeGreaterThan(0.8);
    expect(vp.zoom).toBeLessThan(1);
    for (let i = 0; i < 20; i++) vp = zoomAt(vp, view, focal, 0.8, undefined, true);
    expect(vp.zoom).toBeGreaterThanOrEqual(0.8);
    expect(settleViewport(vp, view)).toEqual(IDENTITY_VIEWPORT);
    // a release a hair above 1× snaps to exactly 1×
    expect(settleViewport({ zoom: 1.04, panX: 5, panY: -5 }, view)).toEqual(IDENTITY_VIEWPORT);
    // a release past the maximum settles at the maximum
    const big = zoomAt({ zoom: MAX_ZOOM, panX: 0, panY: 0 }, view, focal, 1.5, undefined, true);
    expect(big.zoom).toBeGreaterThan(MAX_ZOOM);
    expect(settleViewport(big, view).zoom).toBe(MAX_ZOOM);
  });

  it('elastic pan stretches past the edge by a fraction of the travel and is capped', () => {
    const start = { zoom: 2, panX: 400, panY: 0 }; // already at the right edge (bound 400)
    const pushed = zoomAt(start, view, { x: 400, y: 200 }, 1, { x: 100, y: 0 }, true);
    expect(pushed.panX).toBeGreaterThan(400);
    expect(pushed.panX).toBeLessThan(400 + 100);
    let vp = start;
    for (let i = 0; i < 50; i++) vp = zoomAt(vp, view, { x: 400, y: 200 }, 1, { x: 100, y: 0 }, true);
    expect(vp.panX).toBeLessThanOrEqual(400 + view.w * 0.15 + 1e-6);
    // coming back moves freely
    const back = zoomAt(vp, view, { x: 400, y: 200 }, 1, { x: -30, y: 0 }, true);
    expect(back.panX).toBeCloseTo(vp.panX - 30, 6);
    expect(settleViewport(vp, view).panX).toBe(400);
  });

  it('toViewPoint inverts toNormalized, zoomed or not', () => {
    for (const vp of [IDENTITY_VIEWPORT, { zoom: 3, panX: 120, panY: -40 }]) {
      const n = { x: 0.37, y: 0.61 };
      const back = toNormalized(toViewPoint(n, view, content, vp), view, content, vp)!;
      expect(back.x).toBeCloseTo(n.x, 6);
      expect(back.y).toBeCloseTo(n.y, 6);
    }
  });
});
