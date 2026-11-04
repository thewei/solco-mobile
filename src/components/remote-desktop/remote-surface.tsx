// [INPUT]: an RdSession, its snapshot, the gesture mode and the zoom/pan viewport (owned by the screen).
// [OUTPUT]: RemoteSurface — the Mac's picture (RdVideo) laid out at zoom × the view, a transparent touch
//           layer feeding the GestureEngine, and the trackpad cursor.
// [POS]: The only component that turns raw touches into Mac input. The video surface is laid out ONCE at the
//        encoded frame's pixel size (so its buffer equals the source: no resampling, sharp when zoomed) and
//        zoom/pan are a transform of that fixed box — the compositor scales the surface, nothing is relaid
//        or reallocated while fingers move (resizing the surface per frame was what made pinch lag). The
//        transform is a Reanimated shared value written straight from the touch handler, so a pinch never
//        waits for a React render (the screen only hears of the viewport in throttled reports).
//        A tap on the black bars around the picture is not a click: it asks the screen to toggle its menus.
//        View-only sessions still pan and zoom; every pointer/scroll sink is dropped.
// [PROTOCOL]: 变更时更新此头部
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PixelRatio, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDecay, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Text } from 'tamagui';

import { GestureEngine, type GestureMode, type Swipe3 } from '@/features/remote-desktop/gestures';
import { containRect, IDENTITY_VIEWPORT, settleViewport, toNormalized, zoomAt, type Size, type Viewport } from '@/features/remote-desktop/geometry';
import type { RdSnapshot, RdSession } from '@/features/remote-desktop/session';
import { RdVideo } from '@/lib/rd-native';
import { colors } from '@/theme/tokens';

const TICK_MS = 50;
/** The screen needs the zoom only for its reset chip, so reports are throttled (and flushed when the fingers lift). */
const REPORT_MS = 120;
const FALLBACK_CONTENT: Size = { w: 16, h: 9 };
/** Per-ms velocity decay of a picture fling (photo-viewer feel). */
const FLING_DECELERATION = 0.997;
/** Zoom a double two-finger tap goes to. */
const DOUBLE_TAP_ZOOM = 2.5;
const SPRING = { damping: 26, stiffness: 260, mass: 1 } as const;
const TAP_MS = 350;
const TAP_SLOP = 12;

export function RemoteSurface({
  session,
  snap,
  gestureMode,
  viewport,
  onViewport,
  onTouchBegan,
  onBackdropTap,
  onSwipe3,
}: {
  session: RdSession;
  snap: RdSnapshot;
  gestureMode: GestureMode;
  viewport: Viewport;
  onViewport: (next: Viewport) => void;
  /** First finger down — the screen hides its toolbars. */
  onTouchBegan: () => void;
  /** A tap on the black bars around the picture — the screen toggles its menus. */
  onBackdropTap: () => void;
  /** Three fingers swiped — the screen sends the matching macOS shortcut. */
  onSwipe3: (dir: Swipe3) => void;
}) {
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  // The viewport the touch handler works on; the `viewport` prop is only its (throttled) echo.
  const vp = useRef<Viewport>(viewport);
  const lastReport = useRef(0);
  const baseSV = useSharedValue(1);
  const zoomSV = useSharedValue(viewport.zoom);
  const panXSV = useSharedValue(viewport.panX);
  const panYSV = useSharedValue(viewport.panY);
  // The trackpad cursor is the normalised point + the picture's letterbox, mapped on the UI thread with the
  // very same zoom/pan the video uses, so it can never lag or drift from the picture (springs included).
  const curNX = useSharedValue(0.5);
  const curNY = useSharedValue(0.5);
  const viewWSV = useSharedValue(0);
  const viewHSV = useSharedValue(0);
  const fitXSV = useSharedValue(0);
  const fitYSV = useSharedValue(0);
  const fitWSV = useSharedValue(1);
  const fitHSV = useSharedValue(1);
  const content: Size = snap.state ? { w: snap.state.width, h: snap.state.height } : FALLBACK_CONTENT;
  const display = snap.state?.displays.find((d) => d.id === snap.state?.displayId);
  // The surface box: the frame's own pixel size in layout units, so its buffer is the source frame. The
  // transform below shrinks it to the letterbox at zoom 1.
  const fit = containRect(view, content);
  const box: Size = snap.state ? { w: snap.state.width / PixelRatio.get(), h: snap.state.height / PixelRatio.get() } : { w: fit.w, h: fit.h };
  const baseScale = box.w > 0 ? fit.w / box.w : 1;
  useEffect(() => {
    baseSV.value = baseScale;
    viewWSV.value = view.w;
    viewHSV.value = view.h;
    fitXSV.value = fit.x;
    fitYSV.value = fit.y;
    fitWSV.value = fit.w;
    fitHSV.value = fit.h;
  }, [baseScale, baseSV, view.w, view.h, fit.x, fit.y, fit.w, fit.h, viewWSV, viewHSV, fitXSV, fitYSV, fitWSV, fitHSV]);
  const swipe = useRef(onSwipe3);
  swipe.current = onSwipe3;

  // The engine reads the latest values through a ref, so it is built once per session.
  const live = useRef({ view, content, gestureMode, control: snap.mode === 'full', macWidth: display?.width ?? 1440 });
  live.current = { view, content, gestureMode, control: snap.mode === 'full', macWidth: display?.width ?? 1440 };
  const report = useRef(onViewport);
  report.current = onViewport;
  const echo = useRef(viewport);
  echo.current = viewport;

  // Zoom/pan: write the shared values now (UI thread paints the next frame), tell the screen a little later.
  function applyViewport(next: Viewport, flush = false) {
    vp.current = next;
    zoomSV.value = next.zoom;
    panXSV.value = next.panX;
    panYSV.value = next.panY;
    const now = Date.now();
    if (flush || now - lastReport.current >= REPORT_MS) {
      lastReport.current = now;
      report.current(next);
    }
  }

  // A fling is animated on the UI thread; the JS working copy catches up when it settles or a finger lands.
  const flinging = useRef(false);
  function syncFromAnimation(flush: boolean) {
    flinging.current = false;
    applyViewport({ zoom: zoomSV.value, panX: panXSV.value, panY: panYSV.value }, flush);
  }
  /** Spring the picture to a resting viewport (limits, snap to 1×, double-tap zoom); the UI thread owns it meanwhile. */
  function animateTo(target: Viewport) {
    flinging.current = true;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(syncFromAnimation, true);
    };
    zoomSV.value = withSpring(target.zoom, SPRING, done);
    panXSV.value = withSpring(target.panX, SPRING);
    panYSV.value = withSpring(target.panY, SPRING);
  }
  function toggleZoom(focal: { x: number; y: number }) {
    const cur = vp.current;
    animateTo(cur.zoom > 1.2 ? IDENTITY_VIEWPORT : zoomAt(cur, live.current.view, focal, DOUBLE_TAP_ZOOM / cur.zoom));
  }
  function startFling(v: { x: number; y: number }) {
    const { view: vw } = live.current;
    const z = vp.current.zoom;
    const maxX = (vw.w * (z - 1)) / 2;
    const maxY = (vw.h * (z - 1)) / 2;
    flinging.current = true;
    const settled = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(syncFromAnimation, true);
    };
    panXSV.value = withDecay({ velocity: v.x * 1000, clamp: [-maxX, maxX], deceleration: FLING_DECELERATION }, settled);
    panYSV.value = withDecay({ velocity: v.y * 1000, clamp: [-maxY, maxY], deceleration: FLING_DECELERATION }, settled);
  }

  // Moving the trackpad cursor writes two numbers; nothing renders.
  function placeCursor() {
    curNX.value = engine.cursor.x;
    curNY.value = engine.cursor.y;
  }

  const engine = useMemo(
    () =>
      new GestureEngine(
        {
          view: () => live.current.view,
          content: () => live.current.content,
          viewport: () => vp.current,
          mode: () => live.current.gestureMode,
          pointsPerPixel: () => {
            const { view: v, content: c, macWidth } = live.current;
            return macWidth / ((containRect(v, c).w || 1) * vp.current.zoom);
          },
        },
        {
          move: (p) => live.current.control && session.send.pointerMove(p),
          button: (b, down, p, count) => live.current.control && session.send.pointerButton(p, b, down, count),
          scroll: (dx, dy) => live.current.control && session.send.pointerScroll(dx, dy),
          zoom: (focal, factor, pan, liveFingers = true) => applyViewport(zoomAt(vp.current, live.current.view, focal, factor, pan, liveFingers)),
          zoomToggle: (focal) => toggleZoom(focal),
          swipe3: (dir) => swipe.current(dir),
          cursor: () => placeCursor(),
          haptic: (kind) => void Haptics.impactAsync(kind === 'right' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the sinks reach everything through refs and shared values
    [session],
  );

  // An outside change (Reset zoom, a display switch) wins over the working copy.
  useEffect(() => {
    const cur = vp.current;
    if (Math.abs(cur.zoom - viewport.zoom) > 1e-3 || Math.abs(cur.panX - viewport.panX) > 0.5 || Math.abs(cur.panY - viewport.panY) > 0.5) {
      applyViewport(viewport, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyViewport only touches refs and shared values
  }, [viewport]);

  useEffect(() => {
    const id = setInterval(() => engine.tick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [engine]);

  // A mode switch or leaving the screen must not leave a button held on the Mac.
  useEffect(() => {
    engine.reset();
    placeCursor();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placeCursor reads refs
  }, [engine, gestureMode]);
  useEffect(
    () => () => {
      engine.reset();
      session.releaseAll();
    },
    [engine, session],
  );

  // A single finger that lands on the black bars is a menu gesture, not input.
  const pad = useRef({ ignore: false, t0: 0, x0: 0, y0: 0, moved: false });
  const touchStart = (e: GestureResponderEvent) => {
    const ts = e.nativeEvent.touches;
    const g = pad.current;
    if (flinging.current) {
      // A finger landing on a drifting picture stops it where it is.
      cancelAnimation(zoomSV);
      cancelAnimation(panXSV);
      cancelAnimation(panYSV);
      syncFromAnimation(false);
    }
    if (ts.length === 1) {
      const { view: v, content: c } = live.current;
      g.ignore = toNormalized({ x: ts[0]!.locationX, y: ts[0]!.locationY }, v, c, vp.current) === null;
      g.t0 = Date.now();
      g.x0 = ts[0]!.locationX;
      g.y0 = ts[0]!.locationY;
      g.moved = false;
    } else if (ts.length >= 2) {
      g.ignore = false;
    }
    if (g.ignore) return;
    onTouchBegan();
    touches(e);
  };
  const touchMove = (e: GestureResponderEvent) => {
    const g = pad.current;
    if (g.ignore) {
      const t = e.nativeEvent.touches[0];
      if (t && Math.hypot(t.locationX - g.x0, t.locationY - g.y0) > TAP_SLOP) g.moved = true;
      return;
    }
    touches(e);
  };
  const touchEnd = (e: GestureResponderEvent) => {
    const g = pad.current;
    if (g.ignore) {
      if (e.nativeEvent.touches.length === 0) {
        g.ignore = false;
        if (!g.moved && Date.now() - g.t0 < TAP_MS) onBackdropTap();
      }
      return;
    }
    touches(e);
  };

  const touches = (e: GestureResponderEvent) => {
    engine.update(e.nativeEvent.touches.map((t) => ({ x: t.locationX, y: t.locationY })), Date.now());
    const cur = vp.current;
    const echoed = echo.current;
    if (e.nativeEvent.touches.length === 0) {
      const fling = engine.takeFling();
      // Past a limit (stretched, or hardly zoomed): spring to rest. Otherwise a quick release keeps gliding.
      const rest = settleViewport(cur, live.current.view);
      if (Math.abs(rest.zoom - cur.zoom) > 1e-3 || Math.abs(rest.panX - cur.panX) > 0.5 || Math.abs(rest.panY - cur.panY) > 0.5) {
        animateTo(rest);
        return;
      }
      if (fling) {
        startFling(fling);
        return;
      }
    }
    if (e.nativeEvent.touches.length === 0 && (cur.zoom !== echoed.zoom || cur.panX !== echoed.panX || cur.panY !== echoed.panY)) {
      lastReport.current = Date.now();
      report.current(cur); // the fingers lifted: the screen gets the final viewport
    }
  };

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panXSV.value }, { translateY: panYSV.value }, { scale: baseSV.value * zoomSV.value }],
  }));
  const cursorStyle = useAnimatedStyle(() => {
    const vw = viewWSV.value;
    const vh = viewHSV.value;
    const ux = fitXSV.value + curNX.value * fitWSV.value;
    const uy = fitYSV.value + curNY.value * fitHSV.value;
    return {
      transform: [
        { translateX: (ux - vw / 2) * zoomSV.value + vw / 2 + panXSV.value - 8 },
        { translateY: (uy - vh / 2) * zoomSV.value + vh / 2 + panYSV.value - 8 },
      ],
    };
  });
  const showCursor = gestureMode === 'trackpad' && snap.mode === 'full';

  return (
    <View
      style={styles.root}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        setView({ w: width, h: height });
      }}
    >
      {snap.streamURL && view.w > 0 ? (
        <Animated.View style={[styles.video, { width: box.w, height: box.h, left: (view.w - box.w) / 2, top: (view.h - box.h) / 2 }, boxStyle]}>
          <RdVideo streamURL={snap.streamURL} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      {!snap.streamURL ? (
        <View style={styles.waiting} pointerEvents="none">
          <ActivityIndicator color={colors.textMuted} />
          <Text color={colors.textMuted} fontSize={13} marginTop="$2">Waiting for the Mac’s screen…</Text>
        </View>
      ) : null}
      {showCursor ? <Animated.View pointerEvents="none" style={[styles.cursor, cursorStyle]} /> : null}
      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
        onTouchCancel={() => (pad.current.ignore = false, engine.reset())}
        accessibilityLabel="Mac screen"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  video: { position: 'absolute' },
  waiting: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  cursor: { position: 'absolute', left: 0, top: 0, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: 'rgba(124,140,255,0.55)' },
});
