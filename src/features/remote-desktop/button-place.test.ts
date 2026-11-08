import { describe, expect, it } from 'vitest';

import { DRAG_BUTTON_SIZE, restPoint, snapPlace } from './button-place';

const box = { w: 400, h: 800, top: 40, bottom: 40 };

describe('floating button placement', () => {
  it('rests against the saved edge at the saved height', () => {
    expect(restPoint({ side: 'right', y: 0.5 }, box)).toEqual({ x: 400 - DRAG_BUTTON_SIZE - 8, y: 400 - DRAG_BUTTON_SIZE / 2 });
    expect(restPoint({ side: 'left', y: 0.5 }, box).x).toBe(8);
  });
  it('stays out of the status and dock bands', () => {
    expect(restPoint({ side: 'left', y: 0.01 }, box).y).toBe(40);
    expect(restPoint({ side: 'left', y: 0.99 }, box).y).toBe(800 - DRAG_BUTTON_SIZE - 40);
  });
  it('a drop snaps to the nearer edge and reports its height as a fraction', () => {
    expect(snapPlace(60, 376, box)).toEqual({ side: 'left', y: 0.5 });
    expect(snapPlace(300, 376, box)).toEqual({ side: 'right', y: 0.5 });
    expect(snapPlace(100, -500, box).y).toBeCloseTo((40 + DRAG_BUTTON_SIZE / 2) / 800);
  });
  it('a drop is restored where it landed', () => {
    const place = snapPlace(10, 300, box);
    expect(restPoint(place, box).y).toBeCloseTo(300);
  });
});
