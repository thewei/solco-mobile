// [INPUT]: the Assistants overview's Groups (GET /api/v3/personal-agent/overview) and the Host's Group capability bits.
// [OUTPUT]: GroupsScreen — one row per Group (stacked avatars, title, members) that opens its chat, plus New group and Archived groups.
// [POS]: Groups are not a Chats-list entry (2026-11-07): they are reached from the Primary Assistant's page, or started by telling the
//        Primary. Reads and navigates only; creating and archiving stay in `new-group` and `archived-groups`.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { AvatarStack } from '@/components/avatar';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Card } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { useBootstrapV3, usePersonalAgentOverview } from '@/features/host/queries-v3';
import { IconArchive, IconPlus } from '@/theme/glyphs';
import { colors, spacing } from '@/theme/tokens';

export default function GroupsScreen() {
  const router = useRouter();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgent === true;
  const groupsServed = bootstrap.data?.capabilities.personalAgentGroups === true;
  const archiveServed = bootstrap.data?.capabilities.personalAgentGroupArchive === true;
  const overview = usePersonalAgentOverview(served);
  const groups = overview.data?.groups ?? [];
  return (
    <Screen back title="Groups">
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        {bootstrap.isLoading || (served && overview.isLoading) ? (
          <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
        ) : !overview.data ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
            <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read groups</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(overview.error)}</Text>
          </YStack>
        ) : (
          <ScrollView
            flex={1}
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, gap: 12 }}
            refreshControl={pullRefresh(overview.isRefetching, () => void overview.refetch())}>
            <XStack gap={8} flexWrap="wrap">
              {groupsServed ? <PillButton label="New group" icon={IconPlus} compact onPress={() => router.push('/assistants/new-group')} /> : null}
              {archiveServed ? <PillButton label="Archived groups" icon={IconArchive} tone="soft" compact onPress={() => router.push('/assistants/archived-groups')} /> : null}
            </XStack>
            {groups.length === 0 ? (
              <YStack alignItems="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">No groups yet</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Ask the Primary — “start a group of Ada and Bo” — or create one here.</Text>
              </YStack>
            ) : (
              <Card>
                {groups.map((group) => (
                  <Tap key={group.id} role="button" accessibilityLabel={`Open ${group.title}`} onPress={() => router.push({ pathname: '/assistants/group/[id]', params: { id: group.id } })}>
                    <XStack alignItems="center" gap={12} padding={spacing.card}>
                      <AvatarStack members={group.members} size={44} />
                      <YStack flex={1} gap={2}>
                        <Text color={colors.text} fontSize={15} fontWeight="700" numberOfLines={1}>{group.title}</Text>
                        <Text color={colors.textMuted} fontSize={12.5} numberOfLines={1}>
                          {group.members.map((m) => m.name).join(', ')}{group.open > 0 ? ` · ${group.open} on the way` : ''}
                        </Text>
                      </YStack>
                    </XStack>
                  </Tap>
                ))}
              </Card>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}
