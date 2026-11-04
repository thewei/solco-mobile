// [INPUT]: a label, an optional leading glyph, a tone and a press handler.
// [OUTPUT]: PillButton — the app's one rounded call-to-action (primary / soft / danger), with the shared press feel.
// [POS]: Replaces the hand-built `Button unstyled … borderRadius pill` stacks on Home, Connect and the Mac card.
//        Shape, padding and colors live here only.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { LucideIcon } from 'lucide-react-native';
import { Text, XStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { Tap } from '@/components/tap';
import { colors, radii } from '@/theme/tokens';

type Tone = 'primary' | 'soft' | 'danger';

const FACE: Record<Tone, { bg: string; fg: string; icon: 'onAccent' | 'muted' | 'danger' }> = {
  primary: { bg: colors.accent, fg: '#FFFFFF', icon: 'onAccent' },
  soft: { bg: colors.surfaceRaised, fg: colors.text, icon: 'muted' },
  danger: { bg: colors.surfaceRaised, fg: colors.danger, icon: 'danger' },
};

export function PillButton({
  label,
  onPress,
  tone = 'primary',
  icon,
  compact = false,
  fill = false,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  icon?: LucideIcon;
  compact?: boolean;
  fill?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const face = FACE[tone];
  return (
    <Tap
      role="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      opacity={disabled ? 0.5 : 1}
      alignSelf={fill ? 'stretch' : 'auto'}
      onPress={onPress}>
      <XStack
        alignItems="center"
        justifyContent="center"
        gap="$1.5"
        paddingHorizontal={compact ? '$3' : '$4'}
        paddingVertical={compact ? '$2' : '$3'}
        borderRadius={radii.pill}
        backgroundColor={face.bg}>
        {icon ? <Icon as={icon} size={compact ? 'sm' : 'md'} tone={face.icon} /> : null}
        <Text color={face.fg} fontSize={compact ? 12 : 14} fontWeight="650">{label}</Text>
      </XStack>
    </Tap>
  );
}
