// [INPUT]: an RdSession's Sender and the key layouts of features/remote-desktop/keys.
// [OUTPUT]: VirtualKeyboard — the Mac's full keyboard on the phone, kept short: three swipeable pages of four
//           rows (main: numbers, letters, esc ⇥ ⇧ ⏎ ⌫ , . /; symbols: F1–F12, punctuation, Home/End/PgUp/PgDn/⌦/⇪;
//           shortcuts: ⌘C … Mission Control, screenshot, Force Quit) over one fixed bottom row (⌃ ⌥ ⌘, space,
//           arrows and the page key). No page dots: the page key names the next page and a swipe works too.
// [POS]: What a phone's own keyboard cannot do: physical keys with several modifiers at once (tap a modifier
//        once = next key, twice = locked, a third time releases), F-keys, held repeats (hold a key, it
//        repeats like a real keyboard) and every chord the Mac knows. Caps are small and 3 px apart so five rows
//        take ~150 px in landscape. Keys fire on release, so a swipe between pages never types; modifiers are
//        only *held* on the Mac for the instant of a chord, so a dropped link can never leave one stuck. The
//        soft keyboard's text, IME and dictation live in the compose bar.
// [PROTOCOL]: 变更时更新此头部
import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text } from 'tamagui';

import { shortcutId } from '@/features/remote-desktop/prefs';
import { hydrateRdPrefs, useRdPrefs } from '@/features/remote-desktop/prefs-store';
import { KB_BOTTOM, KB_MAIN, KB_SYMBOLS, KeyComposer, SHORTCUTS, type KbKey, type Modifier } from '@/features/remote-desktop/keys';
import type { Sender } from '@/features/remote-desktop/protocol';
import { colors } from '@/theme/tokens';

const GAP = 3;
const PAD = 4;
const KEY_RADIUS = 6; // caps are 28–34 px tall: the card radius token would round them into pills
const REPEAT_AFTER_MS = 350;
const REPEAT_EVERY_MS = 45;
/** What the page key says: the page it opens next. */
const NEXT_PAGE = ['#+=', '⌘', 'abc'] as const;

const tick = () => void Haptics.selectionAsync().catch(() => {});

const Cap = memo(function Cap({ k, composer, shifted, latch, height }: { k: KbKey; composer: KeyComposer; shifted: boolean; latch: 'off' | 'once' | 'locked'; height: number }) {
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stop = useCallback(() => {
    clearInterval(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => stop, [stop]);

  const active = latch !== 'off';
  const glyph = shifted && k.shift ? k.shift : k.label;
  const press = () => {
    tick();
    if (k.mod) composer.cycle(k.mod);
    else composer.press(k.code);
  };
  const hold = () => {
    if (k.mod || !k.repeat) return press(); // a long press on a key that does not repeat is still a press
    const mods: readonly Modifier[] = composer.press(k.code);
    tick();
    timer.current = setInterval(() => composer.repeat(mods, k.code), REPEAT_EVERY_MS);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={k.mod ? k.mod : k.label}
      onPress={press}
      onLongPress={hold}
      delayLongPress={REPEAT_AFTER_MS}
      onPressOut={stop}
      style={({ pressed }) => ({
        flex: k.w ?? 1,
        height,
        borderRadius: KEY_RADIUS,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? colors.accentSoft : pressed ? colors.accent : k.mod || !/^[a-z0-9]$/i.test(k.label) ? colors.surfaceRaised : colors.surface,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
      })}>
      {({ pressed }) => (
        <>
          <Text color={pressed ? colors.onAccent : active ? colors.accentText : colors.text} fontSize={k.label.length > 2 ? 11 : height < 34 ? 14 : 16} fontWeight="600">{glyph}</Text>
          {latch === 'locked' ? <View style={{ position: 'absolute', bottom: 2, width: 12, height: 2, borderRadius: 2, backgroundColor: colors.accent }} /> : null}
        </>
      )}
    </Pressable>
  );
});

function KeyRows({ rows, composer, state, height }: { rows: readonly (readonly KbKey[])[]; composer: KeyComposer; state: Record<Modifier, 'off' | 'once' | 'locked'>; height: number }) {
  const shifted = state.Shift !== 'off';
  return (
    <View style={{ gap: GAP, paddingHorizontal: PAD }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: GAP }}>
          {row.map((k) => (
            <Cap key={`${k.code}${k.mod ?? ''}${k.label}`} k={k} composer={composer} shifted={shifted} latch={k.mod ? state[k.mod] : 'off'} height={height} />
          ))}
        </View>
      ))}
    </View>
  );
}

function ShortcutPage({ composer, height }: { composer: KeyComposer; height: number }) {
  const quickKeys = useRdPrefs((p) => p.quickKeys);
  const togglePin = useRdPrefs((p) => p.togglePin);
  const pinned = new Set(quickKeys.map(shortcutId));
  return (
    <ScrollView style={{ height }} contentContainerStyle={{ paddingHorizontal: PAD, gap: 6 }} nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {SHORTCUTS.map((s) => {
          const on = pinned.has(shortcutId(s));
          return (
            <Pressable
              key={shortcutId(s)}
              accessibilityRole="button"
              accessibilityLabel={s.label}
              onPress={() => (tick(), composer.shortcut(s))}
              onLongPress={() => (Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}), togglePin(s))}
              delayLongPress={450}
              style={({ pressed }) => ({ minWidth: 56, height: 28, paddingHorizontal: 9, borderRadius: KEY_RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.accent : on ? colors.accentSoft : colors.surfaceRaised, borderWidth: 1, borderColor: on ? colors.accent : colors.border })}>
              <Text color={on ? colors.accentText : colors.text} fontSize={12} fontWeight="600">{`${on ? '★ ' : ''}${s.label}`}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text color={colors.textMuted} fontSize={10}>Long-press a shortcut to pin it above the dock.</Text>
    </ScrollView>
  );
}

export function VirtualKeyboard({ send }: { send: Sender }) {
  const composer = useMemo(() => new KeyComposer(send), [send]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);
  const { height: screenH } = useWindowDimensions();
  const keyH = screenH < 520 ? 28 : 34;
  const pagesH = keyH * 4 + GAP * 3;

  useEffect(() => composer.subscribe(rerender), [composer]);
  useEffect(() => composer.clear.bind(composer), [composer]);
  useEffect(() => void hydrateRdPrefs(), []);

  const state: Record<Modifier, 'off' | 'once' | 'locked'> = { Control: composer.latch('Control'), Alt: composer.latch('Alt'), Shift: composer.latch('Shift'), Meta: composer.latch('Meta') };
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => width > 0 && setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  const goto = (i: number) => {
    setPage(i);
    scroller.current?.scrollTo({ x: i * width, animated: true });
  };

  return (
    <View onLayout={onLayout} style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4, paddingBottom: 3 }}>
      {width > 0 ? (
        <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" onMomentumScrollEnd={onEnd} scrollEventThrottle={32} bounces={false}>
          <View style={{ width }}>
            <KeyRows rows={KB_MAIN} composer={composer} state={state} height={keyH} />
          </View>
          <View style={{ width }}>
            <KeyRows rows={KB_SYMBOLS} composer={composer} state={state} height={keyH} />
          </View>
          <View style={{ width }}>
            <ShortcutPage composer={composer} height={pagesH} />
          </View>
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', gap: GAP, paddingHorizontal: PAD, paddingTop: GAP }}>
        {KB_BOTTOM.map((k) => (
          <Cap key={`${k.code}${k.mod ?? ''}`} k={k} composer={composer} shifted={false} latch={k.mod ? state[k.mod] : 'off'} height={keyH} />
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel={`${NEXT_PAGE[page]} page`} onPress={() => (tick(), goto((page + 1) % NEXT_PAGE.length))} style={({ pressed }) => ({ flex: 1, height: keyH, borderRadius: KEY_RADIUS, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.accent : colors.accentSoft, borderWidth: 1, borderColor: colors.accent })}>
          <Text color={colors.accentText} fontSize={11} fontWeight="700">{NEXT_PAGE[page]}</Text>
        </Pressable>
      </View>
    </View>
  );
}
