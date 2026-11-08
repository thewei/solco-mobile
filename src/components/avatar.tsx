// [INPUT]: a stable id and a display name (an Assistant), or a Group's members.
// [OUTPUT]: Avatar — the round first-letter tile; AvatarStack — up to three overlapping tiles for a Group.
// [POS]: The one identity mark of Assistants on the phone (Chats list, Group chat, New Group). Colour follows the stable id with
//        the desktop's own palette (`features/host/group-model`), so one Assistant looks the same on both clients and a rename
//        never recolours it. Size and shape live here only.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, XStack, YStack } from 'tamagui';

import type { GroupMember } from '@/contracts/host-v3';
import { avatarInitial, avatarTone } from '@/features/host/group-model';
import { colors } from '@/theme/tokens';

export function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <YStack width={size} height={size} borderRadius={size / 2} alignItems="center" justifyContent="center" backgroundColor={avatarTone(id)} flexShrink={0}>
      <Text color={colors.onAccent} fontSize={size * 0.46} fontWeight="700">{avatarInitial(name)}</Text>
    </YStack>
  );
}

const FACES = 3;

export function AvatarStack({ members, size = 40 }: { members: readonly GroupMember[]; size?: number }) {
  const shown = members.slice(0, FACES);
  const face = Math.round(size * 0.7);
  const step = shown.length > 1 ? (size - face) / (shown.length - 1) : 0;
  return (
    <YStack width={size} height={size} flexShrink={0}>
      {shown.map((m, i) => (
        <XStack
          key={m.assistantId}
          position="absolute"
          left={Math.round(i * step)}
          top={Math.round(i * step)}
          borderRadius={face / 2}
          borderWidth={2}
          borderColor={colors.canvas}>
          <Avatar id={m.assistantId} name={m.name} size={face - 4} />
        </XStack>
      ))}
    </YStack>
  );
}
