// [INPUT]: visibility, what will be committed (a summary line and notes), a busy flag, a refusal sentence, one or two actions that take the message, and a close handler.
// [OUTPUT]: CommitSheet — a bottom sheet with one multiline "Commit message" box (first line = subject, the rest the body) and its
//           action buttons; they stay off until there is a subject of at most 200 characters.
// [POS]: The explicit confirmation of every commit (designs/mobile-t3-redesign `csheet`; Git controls offers Commit and Commit & push,
//        Review commits what is staged). Nothing is committed until a button is pressed with a subject. It is drawn in the screen's
//        own window through `Screen.overlay` and lifted by KeyboardDock — a Modal's keyboard hooks are unreliable on edge-to-edge
//        Android (the old centred dialog was pinned to the top for that reason). The parent remounts it (key) after a commit: a
//        committed message is gone, a refused one stays so it is not retyped.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'tamagui';

import { KeyboardDock } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { SUBJECT_MAX, splitMessage } from '@/features/host/git-model';
import { useBackHandler } from '@/lib/use-back-handler';
import { colors, fontFamilies, radii, type as typeScale } from '@/theme/tokens';

export interface CommitAction {
  label: string;
  tone: 'primary' | 'tonal';
  onPress: (subject: string, body: string) => void;
}

export function CommitSheet({
  visible,
  summary,
  notes = [],
  busy,
  error,
  actions,
  onClose,
}: {
  visible: boolean;
  summary: string;
  notes?: string[];
  busy: boolean;
  error: string | null;
  actions: CommitAction[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [focused, setFocused] = useState(false);
  const { subject, body, tooLong } = splitMessage(message);
  const ready = subject.length > 0 && !tooLong && !busy;
  useBackHandler(visible && !busy, onClose);
  if (!visible) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={StyleSheet.absoluteFill}>
        <Pressable accessibilityLabel="Close" onPress={busy ? undefined : onClose} style={{ flex: 1, backgroundColor: colors.scrim }} />
      </Animated.View>
      <KeyboardDock>
        <Animated.View
          entering={SlideInDown.duration(220)}
          exiting={SlideOutDown.duration(160)}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 8, paddingHorizontal: 8, paddingBottom: insets.bottom + 16, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, backgroundColor: colors.menu }}>
          <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, marginTop: 4, marginBottom: 12, backgroundColor: colors.textMuted, opacity: 0.4 }} />
          <Text accessibilityRole="header" color={colors.text} fontSize={typeScale.title.fontSize} lineHeight={typeScale.title.lineHeight} fontWeight="500" paddingHorizontal={16} paddingBottom={4}>Commit</Text>
          <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={16} paddingBottom={12}>{busy ? 'Committing…' : summary}</Text>
          <TextInput
            autoFocus
            multiline
            accessibilityLabel="Commit message"
            editable={!busy}
            value={message}
            onChangeText={setMessage}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Commit message"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="sentences"
            textAlignVertical="top"
            style={{
              minHeight: 96,
              maxHeight: 160,
              marginTop: 4,
              marginHorizontal: 8,
              marginBottom: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: radii.control,
              borderWidth: 1,
              borderColor: focused ? colors.accent : colors.border,
              backgroundColor: colors.surface,
              color: colors.text,
              fontFamily: fontFamilies.regular,
              fontSize: typeScale.body.fontSize,
              lineHeight: typeScale.body.lineHeight,
            }}
          />
          {tooLong ? <Text color={colors.danger} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={16} paddingBottom={8}>The first line is limited to {SUBJECT_MAX} characters.</Text> : null}
          {notes.map((note) => (
            <Text key={note} color={colors.attention} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={16} paddingBottom={8}>{note}</Text>
          ))}
          {error ? <Text color={colors.danger} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={16} paddingBottom={8}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 8 }}>
            {actions.map((action) => (
              <View key={action.label} style={{ flex: 1 }}>
                <PillButton fill size="lg" tone={action.tone} label={action.label} disabled={!ready} onPress={() => action.onPress(subject, body)} />
              </View>
            ))}
          </View>
        </Animated.View>
      </KeyboardDock>
    </View>
  );
}
