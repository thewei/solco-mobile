// [INPUT]: a live RdSession and its snapshot.
// [OUTPUT]: RemoteLive — the full-bleed session screen: the Mac's picture, an auto-hiding top row (End, link
//           line, landscape) and bottom dock (Windows = Mission Control, Desktop, Type, Keys, More), a
//           floating touch/trackpad button, the key panel and compose bar docked above the soft keyboard,
//           an options sheet (pointer mode, Mac pointer, quality, displays, landscape, clipboard, stats) and
//           transient notices.
// [POS]: Everything a connected user sees. It owns screen-level state only (viewport, gesture mode,
//        which panels are open); all Mac-facing behaviour lives in features/remote-desktop. Layout follows
//        the apps people already know for this job (a persistent window/desktop/keyboard dock, a mode
//        button that stays under the thumb) and the platform's own switches and sheets.
// [PROTOCOL]: 变更时更新此头部
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard as SoftKeyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, XStack, YStack } from 'tamagui';

import { fillKey } from '@/components/fill-key';
import { Icon, type Glyph } from '@/components/icon';
import { KeyboardDock } from '@/components/keyboard-inset';
import { DragButton } from '@/components/remote-desktop/drag-button';
import { OptionSheet } from '@/components/option-sheet';
import { ActionRow, ChoiceRow, Group, SegmentedRow, ToggleRow } from '@/components/remote-desktop/remote-controls';
import { ComposeBar } from '@/components/remote-desktop/remote-keyboard';
import { VirtualKeyboard } from '@/components/remote-desktop/virtual-keyboard';
import { RemoteSurface } from '@/components/remote-desktop/remote-surface';
import { Tap } from '@/components/tap';
import type { RdTier } from '@/contracts/host-v3';
import type { GestureMode, Swipe3 } from '@/features/remote-desktop/gestures';
import { IDENTITY_VIEWPORT, type Viewport } from '@/features/remote-desktop/geometry';
import { APP_EXPOSE, KeyComposer, MISSION_CONTROL, SHOW_DESKTOP, SPACE_LEFT, SPACE_RIGHT, type Shortcut } from '@/features/remote-desktop/keys';
import { hydrateRdPrefs, useRdPrefs } from '@/features/remote-desktop/prefs-store';
import { TIER_LABEL } from '@/features/remote-desktop/quality';
import type { RdSession, RdSnapshot } from '@/features/remote-desktop/session';
import { useClipboardSync } from '@/features/remote-desktop/use-clipboard-sync';
import { IconAdjustmentsHorizontal, IconArrowsMaximize, IconArrowsMinimize, IconChevronDown, IconCommand, IconDeviceDesktop, IconHandStop, IconKeyboard, IconLayoutGrid, IconPointer, IconX } from '@/theme/glyphs';
import { colors, radii } from '@/theme/tokens';

const HIDE_AFTER_MS = 4_000;
const TOAST_MS = 1_800;

/** Three-finger swipes, as a Mac trackpad does them (natural direction: the content follows the fingers). */
const SWIPE3_KEY: Record<Swipe3, Shortcut> = { up: MISSION_CONTROL, down: APP_EXPOSE, left: SPACE_RIGHT, right: SPACE_LEFT };

const MODES = [
  { value: 'direct', title: 'Touch' },
  { value: 'trackpad', title: 'Trackpad' },
] as const;
const TIERS = (['smooth', 'standard', 'high'] as RdTier[]).map((t) => ({ value: t, title: TIER_LABEL[t].title }));

/** ICE's selected candidate type, as the user knows the path: same network, hole-punched, or through a TURN relay. */
function pathLabel(type: string | undefined): string | null {
  switch (type) {
    case 'host':
      return 'Direct';
    case 'srflx':
    case 'prflx':
      return 'P2P';
    case 'relay':
      return 'Relay';
    default:
      return null;
  }
}

function Pill({ children, shrink = false }: { children: React.ReactNode; shrink?: boolean }) {
  return (
    <XStack alignItems="center" gap="$1" paddingHorizontal="$2" paddingVertical="$1.5" borderRadius={radii.pill} backgroundColor={colors.glass} flexShrink={shrink ? 1 : 0} minWidth={0}>
      {children}
    </XStack>
  );
}

function RoundButton({ as, label, onPress, active = false }: { as: Glyph; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Tap key={fillKey(active)} role="button" accessibilityLabel={label} onPress={onPress} width={40} height={40} borderRadius={20} alignItems="center" justifyContent="center" backgroundColor={active ? colors.accentSoft : 'transparent'}>
      <Icon as={as} tone={active ? 'accent' : 'text'} />
    </Tap>
  );
}

function DockItem({ as, label, onPress, active = false }: { as: Glyph; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Tap key={fillKey(active)} role="button" accessibilityLabel={label} onPress={onPress} width={60} height={52} borderRadius={radii.md} alignItems="center" justifyContent="center" gap={3} backgroundColor={active ? colors.accentSoft : 'transparent'}>
      <Icon as={as} tone={active ? 'accent' : 'text'} />
      <Text color={active ? colors.accentText : colors.textMuted} fontSize={10} fontWeight="600">{label}</Text>
    </Tap>
  );
}

/** Why the last reconnect attempt failed, in the words a person can act on. */
const RECONNECT_REASON: Record<string, string> = {
  unreachable: 'waiting for a route to the Mac',
  busy: 'the Mac is closing the old session',
  internal: 'the Mac is restarting capture',
  helper_failed: 'the Mac is restarting capture',
};

export function RemoteLive({ session, snap, onEnd }: { session: RdSession; snap: RdSnapshot; onEnd: () => void }) {
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState<Viewport>(IDENTITY_VIEWPORT);
  const [gestureMode, setGestureMode] = useState<GestureMode>('direct');
  const [bars, setBars] = useState(true);
  const [keys, setKeys] = useState(false);
  const [compose, setCompose] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const full = snap.mode === 'full';
  const shortcuts = useMemo(() => new KeyComposer(session.send), [session]);
  const quickKeys = useRdPrefs((p) => p.quickKeys);
  const modeButton = useRdPrefs((p) => p.modeButton);
  const setModeButton = useRdPrefs((p) => p.setModeButton);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const clipboardSync = useRdPrefs((p) => p.clipboardSync);
  const setClipboardSync = useRdPrefs((p) => p.setClipboardSync);
  useEffect(() => void hydrateRdPrefs(), []);

  const wake = useCallback(() => {
    setBars(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBars(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(hideTimer.current);
  }, [wake]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const locked = snap.state?.locked === true;
  useEffect(() => {
    if (locked) wake(); // the lock banner lives in the menus: bring them up when the Mac locks
  }, [locked, wake]);

  const say = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => {
    void activateKeepAwakeAsync('remote-desktop');
    return () => void deactivateKeepAwake('remote-desktop');
  }, []);

  useEffect(() => {
    void (landscape ? ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE) : ScreenOrientation.unlockAsync()).catch(() => {});
  }, [landscape]);
  useEffect(() => () => void ScreenOrientation.unlockAsync().catch(() => {}), []);

  // A copied Mac clipboard lands on the phone only after the user asked for it.
  const awaitingClipboard = useRef(false);
  useEffect(() => {
    if (!snap.clipboardIn || !awaitingClipboard.current) return;
    awaitingClipboard.current = false;
    void Clipboard.setStringAsync(snap.clipboardIn.text);
  }, [snap.clipboardIn]);

  useClipboardSync(session, snap, full && clipboardSync, (dir) => say(dir === 'toMac' ? 'Clipboard sent to Mac' : 'Mac clipboard copied'));

  // Auto-dismiss notices.
  useEffect(() => {
    if (!snap.notice) return;
    const id = setTimeout(session.dismissNotice, 3_500);
    return () => clearTimeout(id);
  }, [snap.notice, session]);

  const toggleMode = useCallback(() => {
    setGestureMode((m) => {
      const next: GestureMode = m === 'direct' ? 'trackpad' : 'direct';
      say(next === 'direct' ? 'Touch mode' : 'Trackpad mode');
      return next;
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [say]);

  const displays = snap.state?.displays ?? [];
  const macPointer = snap.state?.cursor ?? true;
  const line = [pathLabel(snap.stats?.pathType), snap.rttMs != null ? `${snap.rttMs} ms` : null, full ? null : 'View only'].filter(Boolean).join(' · ');
  const panels = full && (keys || compose);
  // The panels sit over the bottom of the screen: the picture shrinks into what is left instead of hiding behind them.
  const [panelH, setPanelH] = useState(0);
  const [softKb, setSoftKb] = useState(0);
  useEffect(() => {
    const show = SoftKeyboard.addListener('keyboardDidShow', (e) => setSoftKb(e.endCoordinates.height));
    const hide = SoftKeyboard.addListener('keyboardDidHide', () => setSoftKb(0));
    return () => (show.remove(), hide.remove());
  }, []);
  const reserve = panels ? panelH + Math.max(0, softKb - insets.bottom) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar hidden style="light" />
      <View style={{ flex: 1, marginBottom: reserve }}>
      <RemoteSurface
        session={session}
        snap={snap}
        gestureMode={gestureMode}
        viewport={viewport}
        onViewport={setViewport}
        onTouchBegan={() => {
          setBars(false);
          clearTimeout(hideTimer.current);
        }}
        onSwipe3={(dir) => {
          shortcuts.shortcut(SWIPE3_KEY[dir]);
          say(SWIPE3_KEY[dir].label);
        }}
        onBackdropTap={() => {
          if (bars) {
            setBars(false);
            clearTimeout(hideTimer.current);
          } else wake();
        }}
      />
      </View>

      {snap.degraded && !snap.reconnecting ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 64, alignSelf: 'center' }}>
          <Pill><Text color={colors.attention} fontSize={12} fontWeight="600" paddingHorizontal="$2">Connection unstable…</Text></Pill>
        </View>
      ) : null}

      {showStats && snap.stats ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 64, left: 12, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: radii.sm }}>
          <Text color="#fff" fontSize={11} fontFamily="$mono">{`${Math.round(snap.stats.bitrateKbps)} kbps · ${Math.round(snap.stats.fps)} fps\ndropped ${snap.stats.framesDropped} · keyframes ${snap.stats.keyframesSent}${snap.stats.pathType ? `\npath ${snap.stats.pathType}` : ''}`}</Text>
        </View>
      ) : null}

      {viewport.zoom > 1.01 ? (
        <View style={{ position: 'absolute', right: 12, bottom: insets.bottom + (panels ? 12 : 84) }}>
          <Tap role="button" accessibilityLabel="Reset zoom" onPress={() => setViewport(IDENTITY_VIEWPORT)} paddingHorizontal="$3" paddingVertical="$2" borderRadius={radii.pill} backgroundColor={colors.glass}>
            <Text color={colors.text} fontSize={12} fontWeight="600">{`${viewport.zoom.toFixed(1)}× · Reset`}</Text>
          </Tap>
        </View>
      ) : null}

      {toast || snap.notice ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: insets.bottom + 92, alignSelf: 'center', maxWidth: '86%' }}>
          <Pill><Text color={colors.text} fontSize={13} paddingHorizontal="$2.5" paddingVertical="$1">{toast ?? snap.notice}</Text></Pill>
        </View>
      ) : null}

      {full ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {box ? (
            <DragButton
              box={{ ...box, top: insets.top + 8, bottom: insets.bottom + 8 }}
              pos={modeButton}
              onRest={setModeButton}
              onPress={toggleMode}
              label={gestureMode === 'direct' ? 'Touch mode' : 'Trackpad mode'}
              dim={!bars}>
              <Icon as={gestureMode === 'direct' ? IconHandStop : IconPointer} tone="accent" />
            </DragButton>
          ) : null}
        </View>
      ) : null}

      {snap.reconnecting ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'flex-start', paddingTop: insets.top + 72 }]}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.38)' }]} />
          <Pill>
            <ActivityIndicator color={colors.textMuted} style={{ marginLeft: 10 }} />
            <YStack paddingHorizontal="$2" flexShrink={1}>
              <Text color={colors.text} fontSize={13} fontWeight="600">Reconnecting to your Mac…</Text>
              {snap.reconnecting.attempt > 1 ? <Text color={colors.textMuted} fontSize={11}>{`Attempt ${snap.reconnecting.attempt} · ${RECONNECT_REASON[snap.reconnecting.last ?? ''] ?? 'retrying'}`}</Text> : null}
            </YStack>
            <Tap role="button" accessibilityLabel="Cancel reconnecting" onPress={onEnd} height={32} paddingHorizontal="$3" borderRadius={radii.pill} alignItems="center" justifyContent="center" backgroundColor={colors.surfaceRaised}>
              <Text color={colors.text} fontSize={13} fontWeight="600">End</Text>
            </Tap>
          </Pill>
        </View>
      ) : null}

      {bars ? (
        <>
          <View style={{ position: 'absolute', top: insets.top + 8, left: 10, right: 10 }} pointerEvents="box-none">
            <XStack justifyContent="space-between" alignItems="center" gap="$2" pointerEvents="box-none">
              <Pill shrink>
                <RoundButton as={IconX} label="End session" onPress={onEnd} />
                <Text color={colors.textMuted} fontSize={12} paddingRight="$2.5" numberOfLines={1} flexShrink={1}>{line}</Text>
              </Pill>
              <Pill>
                <RoundButton as={landscape ? IconArrowsMinimize : IconArrowsMaximize} label={landscape ? 'Portrait' : 'Landscape'} onPress={() => (setLandscape((v) => !v), wake())} />
              </Pill>
            </XStack>
          </View>
          {snap.state?.locked ? (
            <View style={{ position: 'absolute', top: insets.top + 64, left: 10, right: 10, alignItems: 'center' }} pointerEvents="box-none">
              <Pill>
                <Text color={colors.text} fontSize={13} fontWeight="600" paddingHorizontal="$2">The Mac is locked</Text>
                {full && snap.state.canUnlock ? (
                  <Tap role="button" accessibilityLabel="Unlock the Mac" onPress={() => (session.send.unlockRequest(), say('Unlocking the Mac…'), wake())} height={32} paddingHorizontal="$3" borderRadius={radii.pill} alignItems="center" justifyContent="center" backgroundColor={colors.accent}>
                    <Text color={colors.onAccent} fontSize={13} fontWeight="650">Unlock</Text>
                  </Tap>
                ) : null}
              </Pill>
            </View>
          ) : null}
          {panels ? null : (
            <View style={{ position: 'absolute', bottom: insets.bottom + 10, left: 0, right: 0, alignItems: 'center', gap: 8 }} pointerEvents="box-none">
              {full && quickKeys.length > 0 ? (
                <View style={{ maxWidth: '94%', borderRadius: radii.pill, backgroundColor: colors.glass }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 6 }} keyboardShouldPersistTaps="always">
                    {quickKeys.map((q) => (
                      <Tap key={`${q.mods.join('+')}+${q.code}`} role="button" accessibilityLabel={q.label} onPress={() => (shortcuts.shortcut(q), wake())} minWidth={44} height={34} paddingHorizontal="$2.5" borderRadius={radii.pill} alignItems="center" justifyContent="center" backgroundColor={colors.surfaceRaised}>
                        <Text color={colors.text} fontSize={13} fontWeight="600">{q.label}</Text>
                      </Tap>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              <Pill>
                {full ? (
                  <>
                    <DockItem as={IconLayoutGrid} label="Windows" onPress={() => (shortcuts.shortcut(MISSION_CONTROL), wake())} />
                    <DockItem as={IconDeviceDesktop} label="Desktop" onPress={() => (shortcuts.shortcut(SHOW_DESKTOP), wake())} />
                    <DockItem as={IconKeyboard} label="Type" onPress={() => setCompose(true)} />
                    <DockItem as={IconCommand} label="Keys" onPress={() => setKeys(true)} />
                  </>
                ) : null}
                <DockItem as={IconAdjustmentsHorizontal} label="More" onPress={() => setSheet(true)} />
              </Pill>
            </View>
          )}
        </>
      ) : (
        <>
          <Pressable accessibilityLabel="Show toolbar" onPress={wake} style={{ position: 'absolute', top: 0, left: '30%', right: '30%', height: insets.top + 26, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 }}>
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} />
          </Pressable>
          <Pressable accessibilityLabel="Show dock" onPress={wake} style={{ position: 'absolute', bottom: 0, left: '30%', right: '30%', height: insets.bottom + 26, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 }}>
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} />
          </Pressable>
        </>
      )}

      {panels ? (
        <KeyboardDock>
          <View style={{ flex: 1 }} pointerEvents="box-none" />
          <YStack paddingBottom={insets.bottom} backgroundColor={colors.surface} onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}>
            <XStack justifyContent="flex-end" paddingHorizontal="$2" paddingTop="$1">
              <Tap role="button" accessibilityLabel="Hide keyboard panels" onPress={() => (setKeys(false), setCompose(false))} width={40} height={32} alignItems="center" justifyContent="center">
                <Icon as={IconChevronDown} tone="muted" />
              </Tap>
            </XStack>
            {keys ? <VirtualKeyboard send={session.send} /> : null}
            {compose ? <ComposeBar send={session.send} /> : null}
          </YStack>
        </KeyboardDock>
      ) : null}

      <OptionSheet visible={sheet} title="Remote Desktop" onClose={() => setSheet(false)}>
        {full ? (
          <Group title="Pointer">
            <SegmentedRow label="Mode" options={MODES} value={gestureMode} onChange={(m) => setGestureMode(m)} />
            <ToggleRow title="Show Mac pointer" value={macPointer} onValueChange={(v) => session.send.cursorSet(v)} />
          </Group>
        ) : null}
        {full ? (
          <Group title="Mac screen" footer="Goes black on the Mac while you are connected.">
            <ToggleRow title="Black out the Mac's screen" value={snap.state?.blackout === true} onValueChange={(v) => session.send.privacySet(v)} />
          </Group>
        ) : null}
        <Group title="Quality" footer={snap.state ? TIER_LABEL[snap.state.tier].hint : undefined}>
          <SegmentedRow label="Resolution" options={TIERS} value={snap.state?.tier ?? 'standard'} onChange={(t) => session.send.qualitySet(t)} />
        </Group>
        {displays.length > 1 ? (
          <Group title="Display">
            {displays.map((d) => (
              <ChoiceRow
                key={d.id}
                title={d.name || `Display ${d.id}`}
                hint={`${d.pixelWidth}×${d.pixelHeight}${d.isMain ? ' · main' : ''}`}
                selected={snap.state?.displayId === d.id}
                onPress={() => (setViewport(IDENTITY_VIEWPORT), session.send.displaySelect(d.id), setSheet(false))}
              />
            ))}
          </Group>
        ) : null}
        <Group title="View">
          <ToggleRow title="Landscape" value={landscape} onValueChange={setLandscape} />
          <ToggleRow title="Connection stats" value={showStats} onValueChange={(v) => (setShowStats(v), v && session.send.statsRequest())} />
          {viewport.zoom > 1.01 ? <ActionRow title="Reset zoom" onPress={() => (setViewport(IDENTITY_VIEWPORT), setSheet(false))} /> : null}
        </Group>
        <Group title="Clipboard (text)" footer={full ? undefined : 'Clipboard sync needs Control.'}>
          {full ? (
            <>
              <ToggleRow title="Sync automatically" value={clipboardSync} onValueChange={setClipboardSync} />
              <ActionRow
                title="Send phone clipboard to Mac"
                onPress={() => {
                  setSheet(false);
                  void Clipboard.getStringAsync().then((t) => t && session.send.clipboardSet(t));
                }}
              />
              <ActionRow
                title="Copy Mac clipboard to phone"
                onPress={() => {
                  awaitingClipboard.current = true;
                  session.send.clipboardGet();
                  setSheet(false);
                }}
              />
            </>
          ) : null}
        </Group>
      </OptionSheet>
    </View>
  );
}
