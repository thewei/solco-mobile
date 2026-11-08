// [INPUT]: a label, an optional leading glyph, a tone, a size and a press handler.
// [OUTPUT]: PillButton — the app's one call-to-action (designs/mobile-t3-redesign `.btn`): primary (blue fill), tonal (blue
//           tint), soft (a bordered card, the default), danger; 44 dp tall (`md`), 48 dp for sticky action bars and
//           sheets (`lg`), and a 36 dp `compact` for dense control rows. Shared press feel.
// [POS]: Replaces every hand-built `Button unstyled … borderRadius pill` stack. Shape, padding and colors live here only.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, XStack } from 'tamagui';

import { Icon, type Glyph } from '@/components/icon';
import { Tap } from '@/components/tap';
import { colors, metrics, radii, type as typeScale, themed } from '@/theme/tokens';

type Tone = 'primary' | 'tonal' | 'soft' | 'danger';

const FACE: Record<Tone, { bg: string; border: string; fg: string; icon: 'onAccent' | 'accent' | 'text' | 'danger' }> = themed(() => ({
  primary: { bg: colors.accent, border: 'transparent', fg: colors.onAccent, icon: 'onAccent' },
  tonal: { bg: colors.accentSoft, border: 'transparent', fg: colors.accentText, icon: 'accent' },
  soft: { bg: colors.surface, border: colors.border, fg: colors.text, icon: 'text' },
  danger: { bg: colors.surface, border: colors.border, fg: colors.danger, icon: 'danger' },
}));

const SIZE = {
  compact: { height: 36, radius: 18, padX: 14, text: typeScale.small },
  md: { height: metrics.touch, radius: radii.md, padX: 18, text: typeScale.label },
  lg: { height: 48, radius: 24, padX: 18, text: typeScale.body },
} as const;

export function PillButton({
  label,
  onPress,
  tone = 'primary',
  icon,
  compact = false,
  size = 'md',
  fill = false,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  icon?: Glyph;
  compact?: boolean;
  size?: 'md' | 'lg';
  fill?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const face = FACE[tone];
  const dims = compact ? SIZE.compact : SIZE[size];
  return (
    <Tap
      role="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      opacity={disabled ? 0.45 : 1}
      alignSelf={fill ? 'stretch' : 'auto'}
      onPress={onPress}>
      <XStack
        alignItems="center"
        justifyContent="center"
        gap={8}
        height={dims.height}
        paddingHorizontal={dims.padX}
        borderRadius={dims.radius}
        borderWidth={1}
        borderColor={face.border}
        backgroundColor={face.bg}>
        {icon ? <Icon as={icon} size={compact ? 'sm' : 'md'} tone={face.icon} /> : null}
        <Text color={face.fg} fontSize={dims.text.fontSize} lineHeight={dims.text.lineHeight} fontWeight="500">{label}</Text>
      </XStack>
    </Tap>
  );
}
