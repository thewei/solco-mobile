// [INPUT]: the header title's four strings — the agent's name, its provider, the Workspace label and age.
// [OUTPUT]: ChatHeaderTitle — the two-line identity title the Chat screens share: agent name (Bot glyph in
//           accent) over `provider · Workspace · age` (folder glyph as the accent when a Workspace is named).
// [POS]: Extracted from the Chat screen so the new-session draft (/compose) renders the exact same header
//        voice; a missing meta part drops out of the line, an empty meta renders no second line at all.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Bot, FolderGit2 } from 'lucide-react-native';
import { Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

export function ChatHeaderTitle({ title, provider, workspace, ago }: { title: string; provider: string; workspace: string; ago: string }) {
  const meta = [provider, workspace, ago].filter(Boolean).join(' · ');
  return (
    <YStack flex={1} justifyContent="center" gap={1}>
      <XStack alignItems="center" gap={5}>
        <Icon as={Bot} size="sm" tone="accent" />
        <Text color={colors.text} fontSize={15} fontWeight="700" numberOfLines={1} flexShrink={1}>
          {title}
        </Text>
      </XStack>
      {meta ? (
        <XStack alignItems="center" gap={4}>
          {workspace ? <Icon as={FolderGit2} size="sm" tone="subtle" /> : null}
          <Text color={colors.textSubtle} fontSize={11} numberOfLines={1}>
            {meta}
          </Text>
        </XStack>
      ) : null}
    </YStack>
  );
}
