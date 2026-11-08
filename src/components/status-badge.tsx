// [INPUT]: a Git change status word from the Host (modified, added, untracked, …).
// [OUTPUT]: StatusBadge — the 20 dp letter tile (M/A/D/R/U/!) of a file row: modified/renamed amber, added/untracked green, deleted and conflicted red.
// [POS]: Shared Git row marker (designs/mobile-t3-redesign `.ms`); tones come from theme tokens, never inline colours.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { View } from 'react-native';
import { Text } from 'tamagui';

import { statusBadge } from '@/features/host/git-model';
import { colors, radii, themed } from '@/theme/tokens';

const TONES = themed(() => ({
  add: { color: colors.success, background: colors.successSoft },
  change: { color: colors.attention, background: colors.attentionSoft },
  delete: { color: colors.danger, background: colors.dangerSoft },
  warn: { color: colors.danger, background: colors.dangerSoft },
  muted: { color: colors.textMuted, background: colors.surfaceRaised },
}) as const);

export function StatusBadge({ status }: { status: string }) {
  const { letter, tone } = statusBadge(status);
  const { color, background } = TONES[tone];
  return (
    <View accessibilityLabel={status} style={{ width: 20, height: 20, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: background }}>
      <Text color={color} fontSize={11} lineHeight={13} fontWeight="700">{letter}</Text>
    </View>
  );
}
