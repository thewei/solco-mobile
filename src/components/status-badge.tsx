// [INPUT]: a Git change status word from the Host (modified, added, untracked, …).
// [OUTPUT]: StatusBadge — the one 22pt letter tile (M/A/D/R/U/!) used by every file row.
// [POS]: Shared Git row marker; tones come from theme tokens, never inline colours.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, YStack } from 'tamagui';

import { statusBadge } from '@/features/host/git-model';
import { colors, radii } from '@/theme/tokens';

const TONES = {
  add: { color: colors.success, background: colors.successSoft },
  change: { color: colors.accent, background: colors.accentSoft },
  delete: { color: colors.danger, background: colors.diffDelete },
  warn: { color: colors.attention, background: colors.attentionSoft },
  muted: { color: colors.textMuted, background: colors.surfaceRaised },
} as const;

export function StatusBadge({ status }: { status: string }) {
  const { letter, tone } = statusBadge(status);
  const { color, background } = TONES[tone];
  return (
    <YStack width={22} height={22} borderRadius={radii.sm / 2} alignItems="center" justifyContent="center" backgroundColor={background}>
      <Text color={color} fontSize={11.5} fontWeight="800">{letter}</Text>
    </YStack>
  );
}
