// [INPUT]: the Mac's pending approvals across every Assistant (GET /api/v3/personal-agent/approvals) and the Assistants overview (names).
// [OUTPUT]: ApprovalsScreen — the Needs You inbox: one card per pending approval, worded by the core, Approve / Deny.
// [POS]: Each decision carries the card's own `actionHash`; the core accepts the first valid decision and answers the second
//        phone (or the Mac) with a stale refusal, which this screen turns into a refresh. The phone decides nothing by itself.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, YStack } from 'tamagui';

import { ApprovalCard } from '@/components/approval-card';
import { pullRefresh } from '@/components/pull-refresh';
import { ListSkeleton } from '@/components/skeletons';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { useAssistantApprovals, useBootstrapV3, usePersonalAgentOverview, usePersonalAgentWrite } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { colors, spacing } from '@/theme/tokens';

export default function ApprovalsScreen() {
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgent === true;
  const canDecide = bootstrap.data?.capabilities.personalAgentApprove === true;
  const approvals = useAssistantApprovals(served);
  const overview = usePersonalAgentOverview(served);
  const write = usePersonalAgentWrite();
  const now = useNow();
  const names = new Map((overview.data?.assistants ?? []).map((row) => [row.id, row.name]));
  const list = approvals.data ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      {approvals.isLoading ? (
        <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={2} /></YStack>
      ) : (
        <ScrollView
          flex={1}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, flexGrow: 1, gap: 12 }}
          refreshControl={pullRefresh(approvals.isRefetching, () => void approvals.refetch())}>
          {!approvals.data ? (
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19} padding="$6">{personalAgentMessage(approvals.error)}</Text>
          ) : list.length === 0 ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Nothing needs you</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Questions from your Assistants about an exact action appear here.</Text>
            </YStack>
          ) : (
            list.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                now={now}
                heading={names.get(approval.assistantId)}
                busy={write.isPending}
                canDecide={canDecide}
                onDecide={(approve) => write.mutate({ kind: 'decide', id: approval.id, actionHash: approval.actionHash, approve })}
              />
            ))
          )}
          {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(write.error)}</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
