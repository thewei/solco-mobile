// [INPUT]: a value, its change handler and a few shape flags.
// [OUTPUT]: Field — the app's one filled text input (single line or growing multiline, optional monospace).
// [POS]: The forms that write to the Mac (Automations edit, Assistants) share this face; corner, padding and fill live here only.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Platform } from 'react-native';
import { Input } from 'tamagui';

import { colors, fontFamilies, monoFont, radii, type as typeScale } from '@/theme/tokens';

export function Field({
  value,
  onChange,
  placeholder,
  multiline = false,
  mono = false,
  keyboardType,
  autoFocus,
  maxLength,
  onSubmit,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  keyboardType?: 'default' | 'number-pad';
  autoFocus?: boolean;
  maxLength?: number;
  /** The keyboard's Done key: single-line forms that save on submit. */
  onSubmit?: () => void;
}) {
  return (
    <Input
      unstyled
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="$placeholderColor"
      multiline={multiline}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={keyboardType}
      autoFocus={autoFocus}
      maxLength={maxLength}
      returnKeyType={onSubmit ? 'done' : undefined}
      onSubmitEditing={onSubmit}
      color={colors.text}
      fontSize={typeScale.body.fontSize}
      fontFamily={mono ? (Platform.OS === 'ios' ? monoFont.ios : monoFont.android) : fontFamilies.regular}
      minHeight={multiline ? 96 : undefined}
      maxHeight={multiline ? 220 : undefined}
      textAlignVertical={multiline ? 'top' : 'center'}
      paddingHorizontal="$3"
      paddingVertical="$2.5"
      backgroundColor={colors.surface}
      borderRadius={radii.control}
    />
  );
}
