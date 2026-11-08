// [INPUT]: an Assistant's page from the Mac (pending approvals, the core's settled `results`), this phone's tree, the capability flags and a clock.
// [OUTPUT]: AssistantDock — above the chat page of an Assistant's window: the approvals waiting for a yes (Approve / Deny, the card's own
//           `actionHash`) and the result cards of tasks that just settled (Finished / Failed / Ready for review: title, state, Open pane,
//           Details, ✕). At most two rows, the rest is "N more" on the Assistant's page. Nothing when there is nothing.
// [POS]: The phone's twin of the desktop chat strip. Cards are the core's own projection of committed task state (`results`, shared with the desktop), not from the
//        Coordinator's words, so a result is never an Agent paraphrase; a pane opens only when the run's own Herdr session and pane
//        id are in this phone's tree (never by title). Dismissing only moves a client-local watermark (`state/results-store`).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, XStack, YStack } from 'tamagui';

import { ApprovalCard } from '@/components/approval-card';
import { Icon } from '@/components/icon';
import { PillButton } from '@/components/pill-button';
import { Card } from '@/components/section';
import { Tap } from '@/components/tap';
import type { AssistantDetail, TreePane, TreeWorkspace } from '@/contracts/host-v3';
import { agoShort } from '@/features/host/pane-model';
import { openableResult, personalAgentMessage, resultCards } from '@/features/host/personal-agent-model';
import { usePersonalAgentWrite } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { useResultsStore } from '@/state/results-store';
import { IconX } from '@/theme/glyphs';
import { colors, spacing } from '@/theme/tokens';

const SHOWN = 2;

export function AssistantDock({
  detail,
  instance,
  workspaces,
  canDecide,
  onOpenPane,
  onDetails,
}: {
  detail: AssistantDetail | undefined;
  instance: string;
  workspaces: readonly TreeWorkspace[];
  canDecide: boolean;
  onOpenPane: (pane: TreePane) => void;
  onDetails: () => void;
}) {
  const now = useNow();
  const write = usePersonalAgentWrite();
  const seenAt = useResultsStore((state) => state.seen[detail?.assistant.id ?? ''] ?? 0);
  const dismiss = useResultsStore((state) => state.dismiss);
  if (!detail) return null;
  const pending = canDecide ? detail.approvals.filter((a) => a.state === 'pending') : [];
  const cards = resultCards(detail.results, seenAt, 8);
  const total = pending.length + cards.length;
  if (total === 0) return null;
  const approvals = pending.slice(0, SHOWN);
  const results = cards.slice(0, Math.max(0, SHOWN - approvals.length));
  const hidden = total - approvals.length - results.length;
  return (
    <YStack paddingHorizontal={spacing.screen} paddingBottom={8} gap={8}>
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          now={now}
          heading="Approval needed"
          busy={write.isPending}
          canDecide
          onDecide={(approve) => write.mutate({ kind: 'decide', id: approval.id, actionHash: approval.actionHash, approve })}
        />
      ))}
      {results.map((card) => {
        const pane = instance ? openableResult(card.result, workspaces, instance) : null;
        return (
          <Card key={card.result.taskId} padded gap={6}>
            <XStack alignItems="center" gap={8}>
              <Text flex={1} color={colors.text} fontSize={14} fontWeight="700" numberOfLines={1}>{card.result.title}</Text>
              <Tap role="button" accessibilityLabel="Dismiss" onPress={() => dismiss(detail.assistant.id, card.result.at)} width={44} height={44} alignItems="center" justifyContent="center">
                <Icon as={IconX} size="md" tone="muted" />
              </Tap>
            </XStack>
            <Text color={card.failed ? colors.danger : colors.textMuted} fontSize={12.5}>
              {card.label} · {agoShort(card.result.at, now)} ago
            </Text>
            <XStack gap={8}>
              {pane ? <PillButton label="Open pane" tone="soft" compact onPress={() => onOpenPane(pane)} /> : null}
              <PillButton label="Details" tone="soft" compact onPress={onDetails} />
            </XStack>
          </Card>
        );
      })}
      {hidden > 0 ? (
        <Tap accessibilityLabel={`${hidden} more`} onPress={onDetails}>
          <Text color={colors.textSubtle} fontSize={12.5}>{`${hidden} more on the Assistant's page`}</Text>
        </Tap>
      ) : null}
      {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(write.error)}</Text> : null}
    </YStack>
  );
}
