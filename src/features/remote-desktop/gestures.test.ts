import { describe, expect, it } from 'vitest';

import { GESTURE, GestureEngine, type GestureEnv, type GestureMode, type GestureSink } from './gestures';
import { IDENTITY_VIEWPORT } from './geometry';

// A 1000×500 view showing 2000×1000 content exactly (no bars): norm = px / (1000, 500).
function rig(initial: GestureMode = 'direct', zoom = 1) {
  let mode = initial;
  const log: string[] = [];
  const sink: GestureSink = {
    move: (p) => log.push(`move ${p.x.toFixed(2)},${p.y.toFixed(2)}`),
    button: (b, d, p, c) => log.push(`${b} ${d ? 'down' : 'up'} x${c} ${p.x.toFixed(2)},${p.y.toFixed(2)}`),
    scroll: (dx, dy) => log.push(`scroll ${dx},${dy}`),
    zoom: (_f, factor, pan) => log.push(`zoom ${factor.toFixed(2)} pan ${pan.x},${pan.y}`),
    cursor: (p) => log.push(`cursor ${p.x.toFixed(2)},${p.y.toFixed(2)}`),
    haptic: (k) => log.push(`haptic ${k}`),
    zoomToggle: (f) => log.push(`toggle ${f.x},${f.y}`),
    swipe3: (d) => log.push(`swipe3 ${d}`),
  };
  const env: GestureEnv = {
    view: () => ({ w: 1000, h: 500 }),
    content: () => ({ w: 2000, h: 1000 }),
    viewport: () => ({ ...IDENTITY_VIEWPORT, zoom }),
    mode: () => mode,
    pointsPerPixel: () => 1,
  };
  const g = new GestureEngine(env, sink);
  return { g, log, setMode: (m: GestureMode) => (mode = m), take: () => log.splice(0) };
}
const at = (x: number, y: number) => ({ x, y });

describe('trackpad mode, zoomed in', () => {
  it('the picture follows the cursor when it nears the view edge, with a hard clamp', () => {
    const calls: string[] = [];
    const sink: GestureSink = {
      move: () => {}, button: () => {}, scroll: () => {}, cursor: () => {}, haptic: () => {}, zoomToggle: () => {}, swipe3: () => {},
      zoom: (_f, factor, pan, live) => calls.push(`zoom ${factor} ${Math.round(pan.x)},${Math.round(pan.y)} live=${live}`),
    };
    const env: GestureEnv = {
      view: () => ({ w: 1000, h: 500 }), content: () => ({ w: 2000, h: 1000 }),
      viewport: () => ({ ...IDENTITY_VIEWPORT, zoom: 2 }), mode: () => 'trackpad', pointsPerPixel: () => 1,
    };
    const eng = new GestureEngine(env, sink);
    eng.setCursor({ x: 0.5, y: 0.5 });
    eng.update([at(500, 250)], 0);
    eng.update([at(900, 250)], 16); // drags the cursor far to the right of the zoomed picture
    expect(calls.some((c) => c.endsWith('live=false') && Number(c.split(' ')[2]!.split(',')[0]) < 0)).toBe(true);
  });
});

describe('direct mode, zoomed in', () => {
  it('a one-finger drag pans the picture like a photo viewer and never presses a button', () => {
    const { g, take } = rig('direct', 2);
    g.update([at(500, 250)], 0);
    g.update([at(530, 250)], 16); // past the slop: catch up with the 30 px already travelled
    g.update([at(550, 260)], 32);
    g.update([], 40);
    expect(take()).toEqual(['zoom 1.00 pan 30,0', 'zoom 1.00 pan 20,10']);
  });

  it('a quick release hands over a fling, a rested one does not', () => {
    const { g } = rig('direct', 2);
    g.update([at(500, 250)], 0);
    g.update([at(560, 250)], 16);
    g.update([at(620, 250)], 32);
    g.update([], 40);
    const f = g.takeFling();
    expect(f && f.x).toBeGreaterThan(1);
    expect(g.takeFling()).toBeNull();

    g.update([at(500, 250)], 100);
    g.update([at(560, 250)], 116);
    g.update([at(620, 250)], 132);
    g.update([], 400); // fingers rested before lifting
    expect(g.takeFling()).toBeNull();
  });

  it('at zoom 1 a drag is still a Mac drag', () => {
    const { g, take } = rig('direct', 1);
    g.update([at(500, 250)], 0);
    g.update([at(560, 250)], 16);
    g.update([], 40);
    expect(take()[1]).toBe('left down x1 0.50,0.50');
  });
});

describe('direct mode', () => {
  it('tap clicks under the finger', () => {
    const { g, take } = rig();
    g.update([at(500, 250)], 0);
    g.update([], 80);
    expect(take()).toEqual(['move 0.50,0.50', 'left down x1 0.50,0.50', 'left up x1 0.50,0.50']);
  });

  it('a second tap close in time and place is a double click', () => {
    const { g, take } = rig();
    g.update([at(500, 250)], 0);
    g.update([], 60);
    take();
    g.update([at(505, 252)], 200);
    g.update([], 250);
    expect(take()).toEqual(['move 0.51,0.50', 'left down x2 0.51,0.50', 'left up x2 0.51,0.50']);
  });

  it('a late second tap is a fresh single click', () => {
    const { g, take } = rig();
    g.update([at(500, 250)], 0);
    g.update([], 60);
    take();
    g.update([at(500, 250)], 900);
    g.update([], 950);
    expect(take()[1]).toBe('left down x1 0.50,0.50');
  });

  it('long press is a right click, and lifting afterwards does nothing more', () => {
    const { g, take } = rig();
    g.update([at(250, 125)], 0);
    g.tick(GESTURE.longPressMs - 1);
    expect(take()).toEqual([]);
    g.tick(GESTURE.longPressMs + 1);
    expect(take()).toEqual(['move 0.25,0.25', 'right down x1 0.25,0.25', 'right up x1 0.25,0.25', 'haptic right']);
    g.update([], 800);
    expect(take()).toEqual([]);
  });

  it('a drag presses at the start, follows the finger, and releases where it ends', () => {
    const { g, take } = rig();
    g.update([at(100, 100)], 0);
    g.update([at(104, 100)], 10); // inside the slop
    expect(take()).toEqual([]);
    g.update([at(300, 100)], 30);
    g.update([at(600, 300)], 60);
    g.update([], 90);
    expect(take()).toEqual([
      'move 0.10,0.20',
      'left down x1 0.10,0.20',
      'move 0.30,0.20',
      'move 0.60,0.60',
      'left up x1 0.60,0.60',
    ]);
  });

  it('a drag that leaves the picture sticks to the edge', () => {
    const { g, take } = rig();
    g.update([at(900, 100)], 0);
    g.update([at(1200, 100)], 20);
    expect(take().at(-1)).toBe('move 1.00,0.20');
  });

  it('a touch that lingers without a long press is not a tap', () => {
    const { g, take } = rig();
    g.update([at(500, 250)], 0);
    g.update([], GESTURE.tapMs + 50);
    expect(take()).toEqual([]);
  });
});

describe('trackpad mode', () => {
  it('moving drives the cursor relatively and a tap clicks at the cursor', () => {
    const { g, take } = rig('trackpad');
    g.update([at(500, 250)], 0);
    g.update([at(560, 250)], 100);
    const moved = take();
    expect(moved[0]).toMatch(/^cursor 0\.\d+,0\.50$/);
    expect(g.cursor.x).toBeGreaterThan(0.5);
    g.update([], 130);
    expect(take()).toEqual([]); // it moved: no click on lift
    g.update([at(100, 100)], 600);
    g.update([], 650);
    const { x, y } = g.cursor;
    expect(take()).toEqual([`left down x1 ${x.toFixed(2)},${y.toFixed(2)}`, `left up x1 ${x.toFixed(2)},${y.toFixed(2)}`]);
  });

  it('faster motion travels farther than slow motion for the same distance', () => {
    const slow = rig('trackpad');
    slow.g.update([at(500, 250)], 0);
    slow.g.update([at(540, 250)], 400);
    const fast = rig('trackpad');
    fast.g.update([at(500, 250)], 0);
    fast.g.update([at(540, 250)], 20);
    expect(fast.g.cursor.x).toBeGreaterThan(slow.g.cursor.x);
  });

  it('long press holds the button, movement drags, lift releases', () => {
    const { g, take } = rig('trackpad');
    g.update([at(500, 250)], 0);
    g.tick(GESTURE.longPressMs + 5);
    expect(take()).toEqual(['left down x1 0.50,0.50', 'haptic press']);
    expect(g.holding).toBe(true);
    g.update([at(540, 250)], 600);
    g.update([], 700);
    const log = take();
    expect(log.some((l) => l.startsWith('move '))).toBe(true);
    expect(log.at(-1)).toMatch(/^left up x1 /);
    expect(g.holding).toBe(false);
  });

  it('the cursor never leaves the picture', () => {
    const { g } = rig('trackpad');
    g.update([at(0, 0)], 0);
    g.update([at(-4000, -4000)], 10);
    expect(g.cursor).toEqual({ x: 0, y: 0 });
  });
});

describe('two and three fingers', () => {
  it('two-finger drag scrolls naturally (fingers up = Mac scrolls down) and keeps sub-point remainders', () => {
    const { g, take } = rig();
    g.update([at(400, 300), at(500, 300)], 0);
    g.update([at(400, 280), at(500, 280)], 20); // decides: scroll; baseline reset
    g.update([at(400, 250), at(500, 250)], 40);
    g.update([at(400, 200), at(500, 200)], 60);
    const total = take().reduce((sum, l) => sum + Number(l.split(',')[1]), 0);
    expect(total).toBeGreaterThanOrEqual(91); // 80 px * 1.15 = 92, minus <1 point of remainder kept for the next move
    expect(total).toBeLessThanOrEqual(92);
  });

  it('pinch reports zoom factors and the centroid pan', () => {
    const { g, take } = rig();
    g.update([at(400, 250), at(600, 250)], 0);
    g.update([at(350, 250), at(650, 250)], 20); // distance 200 → 300: pinch decided, catching up at once
    g.update([at(300, 250), at(700, 250)], 40);
    expect(take()).toEqual(['zoom 1.50 pan 0,0', 'zoom 1.33 pan 0,0']);
  });

  it('a quick two-finger tap is a right click (under the fingers in direct mode)', () => {
    const { g, take } = rig();
    g.update([at(400, 250), at(500, 250)], 0);
    g.update([], 120);
    expect(take()).toEqual([]); // held back for the double-tap window
    g.tick(120 + GESTURE.doubleTapMs + 1);
    expect(take()).toEqual(['move 0.45,0.50', 'right down x1 0.45,0.50', 'right up x1 0.45,0.50', 'haptic right']);
  });

  it('a second two-finger tap inside the window toggles zoom instead of opening a menu', () => {
    const { g, take } = rig();
    g.update([at(400, 250), at(500, 250)], 0);
    g.update([], 100);
    g.update([at(405, 250), at(505, 250)], 220);
    g.update([], 300);
    g.tick(300 + GESTURE.doubleTapMs + 1);
    expect(take()).toEqual(['toggle 455,250']);
  });

  it('a lone two-finger tap, then another gesture, still sends its right click first', () => {
    const { g, take } = rig();
    g.update([at(400, 250), at(500, 250)], 0);
    g.update([], 100);
    g.update([at(100, 100)], 150); // the next touch flushes the held click
    expect(take().slice(0, 3)).toEqual(['move 0.45,0.50', 'right down x1 0.45,0.50', 'right up x1 0.45,0.50']);
  });

  it('and at the cursor in trackpad mode; lifting one finger then the other clicks once', () => {
    const { g, take } = rig('trackpad');
    g.update([at(400, 250), at(500, 250)], 0);
    g.update([at(400, 250)], 100);
    g.update([], 130);
    g.tick(130 + GESTURE.doubleTapMs + 1);
    expect(take()).toEqual(['right down x1 0.50,0.50', 'right up x1 0.50,0.50', 'haptic right']);
  });

  it('a second finger landing during a pending touch cancels its click', () => {
    const { g, take } = rig();
    g.update([at(400, 250)], 0);
    g.update([at(400, 250), at(500, 250)], 30);
    g.update([], 90);
    expect(take().filter((l) => l.startsWith('left'))).toEqual([]);
  });

  it('a second finger during a drag is ignored; three fingers release a held drag', () => {
    const { g, take } = rig();
    g.update([at(100, 100)], 0);
    g.update([at(300, 100)], 20);
    take();
    g.update([at(300, 100), at(600, 100)], 30);
    expect(take()).toEqual([]);
    g.update([at(300, 100), at(600, 100), at(700, 100)], 40);
    expect(take()).toEqual(['left up x1 0.30,0.20']);
    expect(g.holding).toBe(false);
    g.update([], 80);
    expect(take()).toEqual([]);
  });

  it('three fingers swiped clearly become a Mac gesture on lift; a small move is nothing', () => {
    const { g, take } = rig();
    const three = (dx: number, dy: number) => [at(300 + dx, 250 + dy), at(400 + dx, 250 + dy), at(500 + dx, 250 + dy)];
    g.update(three(0, 0), 0);
    g.update(three(10, -150), 50);
    g.update([], 90);
    expect(take()).toEqual(['swipe3 up']);
    g.update(three(0, 0), 200);
    g.update(three(-160, 20), 250);
    g.update([], 300);
    expect(take()).toEqual(['swipe3 left']);
    g.update(three(0, 0), 400);
    g.update(three(20, 15), 450);
    g.update([], 500);
    expect(take()).toEqual([]);
  });

  it('reset releases a held button (screen left / mode switched) and the next touch works at once', () => {
    const { g, take } = rig('trackpad');
    g.update([at(500, 250)], 0);
    g.tick(GESTURE.longPressMs + 5);
    take();
    g.reset();
    expect(take()).toEqual(['left up x1 0.50,0.50']);
    g.update([at(500, 250)], 2000);
    g.update([], 2050);
    expect(take().length).toBe(2); // a fresh tap is not swallowed
  });
});
