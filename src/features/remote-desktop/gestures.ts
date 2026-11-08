// [INPUT]: the full set of active touches after every native touch event (view-local points), a clock,
//          and an Env that answers the view/content sizes, zoom and mode.
// [OUTPUT]: GestureEngine — turns touches into Mac pointer actions on a GestureSink (move / button /
//           scroll / zoom / cursor / haptic). No React, no timers: the caller feeds `update` and `tick`.
// [POS]: The phone's gesture state machine for Remote Desktop, in two modes.
//        direct   — the finger *is* the pointer: tap = click, double tap = double click, long press = right
//                   click, one-finger drag = left drag — except while zoomed in, where a one-finger drag moves
//                   the picture like a photo viewer (the engine hands over its release velocity for a fling;
//                   Mac drags are then the trackpad mode's hold, or zoom back out).
//        trackpad — the finger moves a virtual cursor (with acceleration): tap = click at the cursor,
//                   double tap = double click, long press = hold the left button (drag lock), move while
//                   held drags, lift releases.
//        both     — two-finger drag scrolls, pinch zooms/pans the view, two-finger tap = right click (held back
//                   for one double-tap window; a second two-finger tap then toggles zoom 1× ⇄ in at the
//                   fingers instead), three fingers abort (any held button is released) and, lifted after a
//                   clear swipe, become a macOS gesture (up Mission Control, down App Exposé, left/right
//                   the next/previous Space). Trackpad mode while zoomed: the picture follows the cursor
//                   when it nears the view's edge.
// [PROTOCOL]: 变更时更新此头部
import type { RdButton } from '@/contracts/host-v3';
import { deltaToNormalized, toNormalized, toNormalizedClamped, toViewPoint, type Pt, type Size, type Viewport } from './geometry';

export type GestureMode = 'direct' | 'trackpad';

export type Swipe3 = 'up' | 'down' | 'left' | 'right';

export interface GestureSink {
  move(p: Pt): void;
  button(button: RdButton, down: boolean, p: Pt, clickCount: number): void;
  /** Mac points; positive dy scrolls the Mac's view down. */
  scroll(dx: number, dy: number): void;
  /** `live` = fingers are driving it (limits resist and spring back); false = a hard clamp (cursor-follow). */
  zoom(focal: Pt, factor: number, pan: Pt, live?: boolean): void;
  /** Double two-finger tap: zoom in at the focal point, or back to 1× when already zoomed. */
  zoomToggle(focal: Pt): void;
  /** A three-finger swipe, for the Mac's own gestures. */
  swipe3(dir: Swipe3): void;
  /** Trackpad cursor (normalised), for drawing it. */
  cursor(p: Pt): void;
  haptic(kind: 'press' | 'right'): void;
}

export interface GestureEnv {
  view(): Size;
  content(): Size;
  viewport(): Viewport;
  mode(): GestureMode;
  /** Mac points one screen pixel of content stands for (scroll distance scale). */
  pointsPerPixel(): number;
}

export const GESTURE = {
  slop: 10,
  tapMs: 300,
  doubleTapMs: 320,
  doubleTapDist: 32,
  longPressMs: 450,
  twoTapMs: 300,
  pinchStart: 10,
  /** A pinch wins while the finger spread moves at least this share of the centroid's travel. */
  pinchBias: 0.6,
  /** Zoom above this and a one-finger drag in direct mode pans the picture. */
  panZoom: 1.01,
  scrollStart: 8,
  /** A three-finger swipe counts past this travel (px) when one axis clearly leads. */
  swipe3Dist: 70,
  swipe3Lead: 1.4,
  /** Trackpad mode, zoomed: the picture follows the cursor once it is this close to the view's edge (share of the short side). */
  followMargin: 0.12,
  trackpadGain: 1.6,
  scrollGain: 1.15,
} as const;

type Phase = 'idle' | 'one' | 'two' | 'cooldown';
type OneMode = 'pending' | 'drag' | 'hold' | 'right' | 'cursor' | 'ignore' | 'panview';
type TwoKind = 'pending' | 'scroll' | 'pinch';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const centroid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class GestureEngine {
  private phase: Phase = 'idle';

  // one finger
  private oneMode: OneMode = 'pending';
  private start: Pt = { x: 0, y: 0 };
  private startT = 0;
  private last: Pt = { x: 0, y: 0 };
  private lastT = 0;
  private pressed = false;
  private lastTap: { t: number; p: Pt } | null = null;
  private pos: Pt = { x: 0.5, y: 0.5 }; // last position the Mac was told about
  private panV: Pt = { x: 0, y: 0 }; // px/ms, smoothed, of a one-finger picture pan
  private fling: Pt | null = null;
  private pendingRight: { t: number; p: Pt | null; c: Pt } | null = null; // a two-finger tap waiting out the double-tap window
  private three: { c0: Pt; cLast: Pt } | null = null;

  // two fingers
  private twoKind: TwoKind = 'pending';
  private c0: Pt = { x: 0, y: 0 };
  private d0 = 0;
  private cLast: Pt = { x: 0, y: 0 };
  private dLast = 0;
  private twoT = 0;
  private remX = 0;
  private remY = 0;

  private cursorPos: Pt = { x: 0.5, y: 0.5 };

  constructor(private readonly env: GestureEnv, private readonly sink: GestureSink) {}

  /** Where the trackpad cursor is (normalised). */
  get cursor(): Pt {
    return this.cursorPos;
  }
  setCursor(p: Pt) {
    this.cursorPos = p;
    this.sink.cursor(p);
  }

  /** After a picture pan lifted: its release velocity (px/ms) once, else null. */
  takeFling(): Pt | null {
    const f = this.fling;
    this.fling = null;
    return f;
  }

  /** True while a button is held down on the Mac by this engine. */
  get holding(): boolean {
    return this.pressed;
  }

  update(touches: readonly Pt[], now: number): void {
    const [a, b, c3] = touches;
    if (this.three && touches.length < 3) this.finishThree();
    if (touches.length >= 3) {
      const c = { x: (a!.x + b!.x + c3!.x) / 3, y: (a!.y + b!.y + c3!.y) / 3 };
      if (this.three) this.three.cLast = c;
      else {
        this.abort();
        this.three = { c0: c, cLast: c };
      }
      return;
    }
    if (!a) return this.lift(now);
    if (!b) {
      if (this.phase === 'idle') return this.beginOne(a, now);
      if (this.phase === 'one') return this.moveOne(a, now);
      if (this.phase === 'two') {
        this.finishTwo(now);
        this.phase = 'cooldown';
      }
      return;
    }
    // two fingers
    if (this.phase === 'idle') return this.beginTwo(a, b, now);
    if (this.phase === 'one') {
      if (this.pressed || this.oneMode === 'right' || this.oneMode === 'cursor' || this.oneMode === 'drag') return; // a gesture already owns the finger
      return this.beginTwo(a, b, now);
    }
    if (this.phase === 'two') this.moveTwo(a, b);
  }

  /** Drive long-press; call every ~50 ms while any finger is down. */
  tick(now: number): void {
    if (this.pendingRight && now - this.pendingRight.t >= GESTURE.doubleTapMs) this.flushRight();
    if (this.phase !== 'one' || this.oneMode !== 'pending') return;
    if (now - this.startT < GESTURE.longPressMs) return;
    if (this.env.mode() === 'direct') {
      const p = toNormalized(this.start, this.env.view(), this.env.content(), this.env.viewport());
      if (!p) {
        this.oneMode = 'ignore';
        return;
      }
      this.sink.move(p);
      this.sink.button('right', true, p, 1);
      this.sink.button('right', false, p, 1);
      this.sink.haptic('right');
      this.oneMode = 'right';
    } else {
      this.sink.button('left', true, this.cursorPos, 1);
      this.pressed = true;
      this.pos = this.cursorPos;
      this.sink.haptic('press');
      this.oneMode = 'hold';
    }
  }

  /** The touch stream was cut (cancel, mode switch, screen left): release anything held and forget the fingers. */
  reset(): void {
    this.pendingRight = null;
    this.three = null;
    this.releaseHeld();
    this.phase = 'idle';
    this.oneMode = 'pending';
    this.lastTap = null;
  }

  /** Three fingers: release anything held and ignore the rest of this touch sequence. */
  private abort(): void {
    this.releaseHeld();
    this.phase = 'cooldown';
    this.lastTap = null;
  }

  // ---- one finger ----

  private beginOne(p: Pt, now: number) {
    this.flushRight();
    this.phase = 'one';
    this.oneMode = 'pending';
    this.start = p;
    this.last = p;
    this.startT = now;
    this.lastT = now;
    this.panV = { x: 0, y: 0 };
    this.fling = null;
    if (this.env.mode() === 'direct' && !toNormalized(p, this.env.view(), this.env.content(), this.env.viewport())) this.oneMode = 'ignore';
  }

  private moveOne(p: Pt, now: number) {
    const direct = this.env.mode() === 'direct';
    const { view, content, viewport } = this.envs();
    const dt = Math.max(1, now - this.lastT);
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    this.last = p;
    this.lastT = now;
    if (this.oneMode === 'ignore' || this.oneMode === 'right') return;

    if (this.oneMode === 'pending') {
      if (dist(p, this.start) <= GESTURE.slop) return;
      this.lastTap = null;
      if (direct && viewport.zoom > GESTURE.panZoom) {
        // Photo-viewer pan: the picture catches up with the slop it has not followed yet, then sticks to the finger.
        this.oneMode = 'panview';
        this.sink.zoom(p, 1, { x: p.x - this.start.x, y: p.y - this.start.y });
        return;
      }
      if (direct) {
        const p0 = toNormalizedClamped(this.start, view, content, viewport);
        this.sink.move(p0);
        this.sink.button('left', true, p0, 1);
        this.pressed = true;
        this.oneMode = 'drag';
      } else {
        this.oneMode = 'cursor';
      }
    }

    if (this.oneMode === 'panview') {
      this.sink.zoom(p, 1, { x: dx, y: dy });
      const k = 0.5; // smooth the velocity over the last few events
      this.panV = { x: this.panV.x * (1 - k) + (dx / dt) * k, y: this.panV.y * (1 - k) + (dy / dt) * k };
      return;
    }
    if (direct) {
      const q = toNormalizedClamped(p, view, content, viewport);
      this.pos = q;
      this.sink.move(q);
      return;
    }
    // trackpad (cursor or hold): relative motion with speed-based acceleration
    const speed = Math.hypot(dx, dy) / dt; // px per ms
    const gain = GESTURE.trackpadGain * (1 + Math.min(2, speed * 0.8));
    const d = deltaToNormalized(dx * gain, dy * gain, view, content, viewport);
    const c = { x: Math.min(1, Math.max(0, this.cursorPos.x + d.x)), y: Math.min(1, Math.max(0, this.cursorPos.y + d.y)) };
    this.cursorPos = c;
    this.pos = c;
    this.sink.cursor(c);
    this.sink.move(c);
    this.followCursor(c);
  }

  /** Zoomed trackpad: keep the cursor inside the view by moving the picture when it nears an edge. */
  private followCursor(c: Pt) {
    const { view, content, viewport } = this.envs();
    if (viewport.zoom <= GESTURE.panZoom) return;
    const s = toViewPoint(c, view, content, viewport);
    const m = Math.min(view.w, view.h) * GESTURE.followMargin;
    const dx = s.x < m ? m - s.x : s.x > view.w - m ? view.w - m - s.x : 0;
    const dy = s.y < m ? m - s.y : s.y > view.h - m ? view.h - m - s.y : 0;
    if (dx !== 0 || dy !== 0) this.sink.zoom(s, 1, { x: dx, y: dy }, false);
  }

  private finishOne(now: number) {
    const direct = this.env.mode() === 'direct';
    if (this.pressed) {
      this.sink.button('left', false, this.pos, 1);
      this.pressed = false;
      return;
    }
    if (this.oneMode === 'panview') {
      // A finger that rested before lifting does not fling.
      if (now - this.lastT < 80 && Math.hypot(this.panV.x, this.panV.y) > 0.15) this.fling = this.panV;
      return;
    }
    if (this.oneMode !== 'pending') return;
    if (now - this.startT > GESTURE.tapMs) return; // a held-still touch that was not a long press: nothing
    const { view, content, viewport } = this.envs();
    const p = direct ? toNormalized(this.start, view, content, viewport) : this.cursorPos;
    if (!p) return;
    const again = this.lastTap && now - this.lastTap.t <= GESTURE.doubleTapMs && dist(this.lastTap.p, this.start) <= GESTURE.doubleTapDist;
    const count = again ? 2 : 1;
    this.lastTap = again ? null : { t: now, p: this.start };
    if (direct) this.sink.move(p);
    this.sink.button('left', true, p, count);
    this.sink.button('left', false, p, count);
  }

  // ---- two fingers ----

  private beginTwo(a: Pt, b: Pt, now: number) {
    // a pending one-finger touch is dropped without a click
    this.phase = 'two';
    this.twoKind = 'pending';
    this.c0 = this.cLast = centroid(a, b);
    this.d0 = this.dLast = dist(a, b);
    this.twoT = now;
    this.remX = 0;
    this.remY = 0;
    this.lastTap = null;
  }

  private moveTwo(a: Pt, b: Pt) {
    const c = centroid(a, b);
    const d = dist(a, b);
    if (this.twoKind === 'pending') {
      const dd = Math.abs(d - this.d0);
      const dc = dist(c, this.c0);
      if (dd > GESTURE.pinchStart && dd >= dc * GESTURE.pinchBias) {
        this.twoKind = 'pinch';
        // Catch up with everything the fingers did while undecided, so the picture is under them from the start.
        if (this.d0 > 0) this.sink.zoom(c, d / this.d0, { x: c.x - this.c0.x, y: c.y - this.c0.y });
      } else if (dc > GESTURE.scrollStart) {
        this.twoKind = 'scroll'; // no jump: the slop distance is not scrolled
      } else return;
      this.cLast = c;
      this.dLast = d;
      return;
    }
    if (this.twoKind === 'pinch') {
      if (this.dLast > 0) this.sink.zoom(c, d / this.dLast, { x: c.x - this.cLast.x, y: c.y - this.cLast.y });
    } else {
      const k = this.env.pointsPerPixel() * GESTURE.scrollGain;
      // Natural direction: the picture follows the fingers, so fingers up = the Mac scrolls down.
      this.remX += -(c.x - this.cLast.x) * k;
      this.remY += -(c.y - this.cLast.y) * k;
      const ix = Math.trunc(this.remX);
      const iy = Math.trunc(this.remY);
      if (ix !== 0 || iy !== 0) {
        this.remX -= ix;
        this.remY -= iy;
        this.sink.scroll(ix, iy);
      }
    }
    this.cLast = c;
    this.dLast = d;
  }

  private finishTwo(now: number) {
    if (this.twoKind !== 'pending' || now - this.twoT > GESTURE.twoTapMs) return;
    // Two-finger tap = right click: under the fingers (direct) or at the cursor (trackpad) — but only
    // after the double-tap window, because a second tap right behind it means "zoom", not "menu".
    const prev = this.pendingRight;
    if (prev && now - prev.t <= GESTURE.doubleTapMs && dist(prev.c, this.c0) <= GESTURE.doubleTapDist * 2) {
      this.pendingRight = null;
      this.sink.zoomToggle(this.c0);
      return;
    }
    this.flushRight();
    const direct = this.env.mode() === 'direct';
    const { view, content, viewport } = this.envs();
    const p = direct ? toNormalized(this.c0, view, content, viewport) : this.cursorPos;
    this.pendingRight = { t: now, p, c: this.c0 };
  }

  /** The held-back right click goes out now (the window passed, or another gesture starts). */
  private flushRight() {
    const r = this.pendingRight;
    this.pendingRight = null;
    if (!r || !r.p) return;
    if (this.env.mode() === 'direct') this.sink.move(r.p);
    this.sink.button('right', true, r.p, 1);
    this.sink.button('right', false, r.p, 1);
    this.sink.haptic('right');
  }

  private finishThree() {
    const t = this.three;
    this.three = null;
    if (!t) return;
    const dx = t.cLast.x - t.c0.x;
    const dy = t.cLast.y - t.c0.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < GESTURE.swipe3Dist) return;
    if (ay >= ax * GESTURE.swipe3Lead) this.sink.swipe3(dy < 0 ? 'up' : 'down');
    else if (ax >= ay * GESTURE.swipe3Lead) this.sink.swipe3(dx < 0 ? 'left' : 'right');
  }

  // ---- shared ----

  private lift(now: number) {
    if (this.phase === 'one') this.finishOne(now);
    else if (this.phase === 'two') this.finishTwo(now);
    this.phase = 'idle';
    this.oneMode = 'pending';
  }

  private releaseHeld() {
    if (this.pressed) {
      this.sink.button('left', false, this.pos, 1);
      this.pressed = false;
    }
  }

  private envs() {
    return { view: this.env.view(), content: this.env.content(), viewport: this.env.viewport() };
  }
}
