// [INPUT]: a sentence, an optional action label + handler, and a tone (warning by default, `bad` for an error).
// [OUTPUT]: Banner — the tinted strip above a list or form that says something is off ("Can't reach …") and offers the retry.
// [POS]: The one inline notice of the redesign (designs/mobile-t3-redesign `.banner`): 16 dp corner, 8 / 12 margin, a
//        20 dp warning glyph, and an outlined 44 dp action in the strip's own color. Colors come from the status tokens.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon } from '@/components/icon';
import { IconAlertTriangle } from '@/theme/glyphs';
import { colors, metrics, radii, type as typeScale, themed } from '@/theme/tokens';

const TONES = themed(() => ({
  warn: { bg: colors.attentionSoft, fg: colors.attention, icon: 'attention' },
  bad: { bg: colors.dangerSoft, fg: colors.danger, icon: 'danger' },
}) as const);

export function Banner({ text, action, onAction, tone = 'warn' }: { text: string; action?: string; onAction?: () => void; tone?: keyof typeof TONES }) {
  const face = TONES[tone];
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginHorizontal: 12, marginBottom: 4, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, borderRadius: radii.control, backgroundColor: face.bg }}>
      <Icon as={IconAlertTriangle} size="md" tone={face.icon} />
      <Text flex={1} minWidth={0} color={face.fg} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{text}</Text>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          style={({ pressed }) => ({ height: metrics.touch, paddingHorizontal: 18, borderRadius: radii.md, borderWidth: 1, borderColor: face.fg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Text color={face.fg} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
