// [INPUT]: Tamagui's YStack and the `quick` spring from the shared config.
// [OUTPUT]: Tap — a pressable surface that gives under the finger (scale + a touch of fade) and springs back.
// [POS]: The one press feel for rows, cards and chips; replaces TouchableOpacity (a bare opacity dip) so every
//        tappable thing answers the same way. Reduced-motion users keep the opacity change (Tamagui's
//        animation driver honours the system setting).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { styled, YStack } from 'tamagui';

import { motion } from '@/theme/tokens';

export const Tap = styled(YStack, {
  transition: 'quick',
  pressStyle: { scale: motion.press, opacity: 0.88 },
});
