// [INPUT]: the Mac's archived Groups (GET /api/v3/personal-agent/groups/archived, needs `capabilities.personalAgentGroupArchive`).
// [OUTPUT]: ArchivedGroupsScreen — one row per archived Group (stacked avatars, title, members) with Restore and Delete forever.
// [POS]: Second client of the desktop Settings → Archived Assistants list. Archive hides a Group and keeps its log; Restore brings
//        it back; Delete forever removes the conversation for good (confirmed here, and refused by the Mac while an Assistant's
//        terminal for the group is still open). The Mac's refusal is shown in its own words; nothing changes on a refusal.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { AvatarStack } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { pullRefresh } from '@/components/pull-refresh';
import { Card } from '@/components/section';
import { Tap } from '@/components/tap';
import type { Group } from '@/contracts/host-v3';
import { groupLifecycleMessage } from '@/features/host/personal-agent-model';
import { useArchivedGroups, useBootstrapV3, useGroupLifecycle } from '@/features/host/queries-v3';
import { IconRotate, IconTrash } from '@/theme/glyphs';
import { colors, spacing } from '@/theme/tokens';

export default function ArchivedGroupsScreen() {
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgentGroupArchive === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const archived = useArchivedGroups(served);
  const lifecycle = useGroupLifecycle();

  const confirmDelete = (group: Group) =>
    Alert.alert(`Delete ${group.title}?`, 'This permanently removes the group’s messages from your computer. The Assistants themselves are not touched. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete forever', style: 'destructive', onPress: () => lifecycle.mutate({ action: 'delete', id: group.id, revision: group.revision }) },
    ]);

  return (
    <Screen back title="Archived groups">
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        {!served && !bootstrap.isLoading ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
            <Text color={colors.text} fontSize={16} fontWeight="700">Archived groups are not available</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
          </YStack>
        ) : bootstrap.isLoading || archived.isLoading ? (
          <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
        ) : !archived.data ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
            <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read archived groups</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{groupLifecycleMessage(archived.error)}</Text>
          </YStack>
        ) : (
          <ScrollView
            flex={1}
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, flexGrow: 1, gap: 12 }}
            refreshControl={pullRefresh(archived.isRefetching, () => void archived.refetch())}>
            <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
              Archived groups keep their messages and wake nobody. Restore one to use it again, or delete it for good.
            </Text>
            {lifecycle.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{groupLifecycleMessage(lifecycle.error)}</Text> : null}
            {archived.data.length === 0 ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">No archived groups</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Archive a group from its ⋯ menu to see it here.</Text>
              </YStack>
            ) : (
              <Card padded={false}>
                {archived.data.map((group) => (
                  <XStack key={group.id} alignItems="center" gap={12} padding={spacing.card}>
                    <AvatarStack members={group.members} size={40} />
                    <YStack flex={1} gap={2}>
                      <Text color={colors.text} fontSize={15} fontWeight="700" numberOfLines={1}>{group.title}</Text>
                      <Text color={colors.textMuted} fontSize={12.5} numberOfLines={1}>{group.members.map((m) => m.name).join(', ')}</Text>
                    </YStack>
                    {manage ? (
                      <>
                        <Tap role="button" accessibilityLabel={`Restore ${group.title}`} disabled={lifecycle.isPending} opacity={lifecycle.isPending ? 0.4 : 1} width={42} height={42} borderRadius={21} alignItems="center" justifyContent="center"
                          onPress={() => lifecycle.mutate({ action: 'restore', id: group.id, revision: group.revision })}>
                          <Icon as={IconRotate} tone="accent" />
                        </Tap>
                        <Tap role="button" accessibilityLabel={`Delete ${group.title} forever`} disabled={lifecycle.isPending} opacity={lifecycle.isPending ? 0.4 : 1} width={42} height={42} borderRadius={21} alignItems="center" justifyContent="center"
                          onPress={() => confirmDelete(group)}>
                          <Icon as={IconTrash} tone="danger" />
                        </Tap>
                      </>
                    ) : null}
                  </XStack>
                ))}
              </Card>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}
