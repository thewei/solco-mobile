// [INPUT]: the sticky Ctrl/Alt state and a press callback from the terminal screen.
// [OUTPUT]: TerminalKeyRow — the terminal's one horizontally scrollable key row (Esc Tab Ctrl Alt ^C arrows Home End PgUp PgDn, an Fn page with F1-F12, shell symbols and, in a takeover, a Mouse toggle).
// [POS]: Always visible above the composer, keyboard up or down (2026-11-07: the library's own Android row is hidden so there is a single row).
//        A key fires when the finger lifts (a swipe that scrolls the row never types anything: the ScrollView takes the
//        touch and the press is cancelled); a held arrow/paging key fires once after HOLD_MS and then repeats.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { Text } from 'tamagui';

import { FN_ROW, isRepeatKey, KEY_ROW, type KeyDef } from '@/lib/terminal-keys';
import { colors, metrics, type as typeScale } from '@/theme/tokens';

// A held repeat key types its first character this long after the finger lands; a quick tap types it on lift instead.
const HOLD_MS = 140;
const REPEAT_DELAY_MS = 380;
const REPEAT_EVERY_MS = 70;

export function TerminalKeyRow({
  ctrlArmed,
  altArmed,
  onToggleMod,
  onKey,
  mouse,
}: {
  ctrlArmed: boolean;
  altArmed: boolean;
  onToggleMod: (mod: 'ctrl' | 'alt') => void;
  onKey: (id: string) => void;
  /** Takeover only: a ‘Mouse’ key that turns one-finger drags into mouse drags (armed = on). */
  mouse?: { armed: boolean; onToggle: () => void };
}) {
  const [fn, setFn] = useState(false);
  const press = useRef(onKey);
  press.current = onKey;
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const every = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const stop = () => {
    clearTimeout(delay.current);
    clearInterval(every.current);
  };
  useEffect(() => stop, []);

  // Set once a held key has typed its first character, so the lift does not type it again.
  const heldFired = useRef(false);

  const down = (key: KeyDef) => {
    stop();
    heldFired.current = false;
    if (key.kind === 'mod' || key.kind === 'toggle' || !isRepeatKey(key.id)) return;
    delay.current = setTimeout(() => {
      heldFired.current = true;
      press.current(key.id);
      delay.current = setTimeout(() => {
        every.current = setInterval(() => press.current(key.id), REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    }, HOLD_MS);
  };

  const lift = (key: KeyDef) => {
    stop();
    if (key.kind === 'toggle') setFn((on) => !on);
    else if (key.kind === 'mod') onToggleMod(key.id as 'ctrl' | 'alt');
    else if (!heldFired.current) press.current(key.id);
    heldFired.current = false;
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
      {(fn ? FN_ROW : KEY_ROW).map((key) => {
        const armed = (key.id === 'ctrl' && ctrlArmed) || (key.id === 'alt' && altArmed);
        return (
          <Pressable
            key={key.id}
            accessibilityRole="button"
            accessibilityLabel={`Key ${key.id}`}
            accessibilityState={key.kind === 'mod' ? { selected: armed } : undefined}
            onPressIn={() => down(key)}
            onPress={() => lift(key)}
            onPressOut={stop}
            style={({ pressed }) => ({
              minWidth: metrics.touch,
              height: metrics.touch,
              paddingHorizontal: 10,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              backgroundColor: armed ? colors.accentSoft : pressed ? colors.navIndicator : colors.surfaceRaised,
            })}>
            <Text color={armed ? colors.accentText : key.kind === 'toggle' ? colors.textMuted : colors.text} fontSize={typeScale.small.fontSize} lineHeight={18} fontWeight="500">
              {key.label}
            </Text>
          </Pressable>
        );
      })}
      {mouse && !fn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Key mouse"
          accessibilityState={{ selected: mouse.armed }}
          onPress={mouse.onToggle}
          style={({ pressed }) => ({
            minWidth: metrics.touch,
            height: metrics.touch,
            paddingHorizontal: 10,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            backgroundColor: mouse.armed ? colors.accentSoft : pressed ? colors.navIndicator : colors.surfaceRaised,
          })}>
          <Text color={mouse.armed ? colors.accentText : colors.text} fontSize={typeScale.small.fontSize} lineHeight={18} fontWeight="500">
            Mouse
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
