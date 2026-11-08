// [INPUT]: an RdSession's Sender.
// [OUTPUT]: ComposeBar (Unicode text, IME and keyboard dictation, sent as `text.insert`; ⏎ and ⌫ for the keys
//           text cannot carry).
// [POS]: The phone's text keyboard for the Mac. Characters travel as text, never as physical keys, so Chinese
//        IME, emoji and the soft keyboard's own voice dictation work unchanged. Physical keys, chords and
//        modifiers are the VirtualKeyboard's (virtual-keyboard.tsx).
// [PROTOCOL]: 变更时更新此头部
import { useState } from 'react';
import { TextInput } from 'react-native';
import { XStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { Tap } from '@/components/tap';
import type { Sender } from '@/features/remote-desktop/protocol';
import { IconBackspace, IconCornerDownLeft, IconSend } from '@/theme/glyphs';
import { colors, radii } from '@/theme/tokens';

export function ComposeBar({ send }: { send: Sender }) {
  const [text, setText] = useState('');
  const submit = () => {
    if (text) {
      send.textInsert(text);
      setText('');
    } else {
      send.tapKey('Enter');
    }
  };
  return (
    <XStack alignItems="flex-end" gap="$2" padding="$2" backgroundColor={colors.surface} borderTopWidth={1} borderTopColor={colors.border}>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Type or dictate, then send to the Mac"
        placeholderTextColor={colors.textSubtle}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={submit}
        onKeyPress={(e) => {
          // an empty field has no character to delete — the key goes to the Mac instead
          if (e.nativeEvent.key === 'Backspace' && text === '') send.tapKey('Backspace');
        }}
        style={{ flex: 1, maxHeight: 110, minHeight: 40, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 }}
      />
      <Tap role="button" accessibilityLabel="Backspace" onPress={() => send.tapKey('Backspace')} width={40} height={40} alignItems="center" justifyContent="center">
        <Icon as={IconBackspace} tone="muted" />
      </Tap>
      <Tap role="button" accessibilityLabel="Return" onPress={() => send.tapKey('Enter')} width={40} height={40} alignItems="center" justifyContent="center">
        <Icon as={IconCornerDownLeft} tone="muted" />
      </Tap>
      <Tap role="button" accessibilityLabel="Send text" onPress={submit} width={40} height={40} borderRadius={20} alignItems="center" justifyContent="center" backgroundColor={text ? colors.accent : colors.surfaceRaised}>
        <Icon as={IconSend} tone={text ? 'onAccent' : 'muted'} />
      </Tap>
    </XStack>
  );
}
