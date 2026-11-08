// [INPUT]: the text, a change handler and a placeholder.
// [OUTPUT]: SearchField — the rounded search box that takes the app bar's place while a list is being searched.
// [POS]: Chats and Sessions search (designs/mobile-t3-redesign `.sf`): 48 dp tall, 24 dp corner, a 1 px border that turns
//        blue while typing, a magnifier, a 44 dp clear button once there is text. The bar's back button leaves search.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { IconSearch, IconX } from '@/theme/glyphs';
import { colors, fontFamilies, metrics, radii, type as typeScale } from '@/theme/tokens';

export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText: (text: string) => void; placeholder: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        height: metrics.barButton,
        marginRight: 4,
        paddingLeft: 14,
        paddingRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: radii.bubble,
        borderWidth: 1,
        borderColor: focused ? colors.accent : colors.border,
        backgroundColor: colors.surface,
      }}>
      <Icon as={IconSearch} size="md" tone="muted" />
      <TextInput
        autoFocus
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, minWidth: 0, minHeight: metrics.touch, padding: 0, color: colors.text, fontFamily: fontFamilies.regular, fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeight }}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          style={{ width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={IconX} size="inline" tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}
