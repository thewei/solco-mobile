// [INPUT]: one pending Approval from the Mac's core, a clock and the decision handler.
// [OUTPUT]: ApprovalCard — the question about one exact action (its words, expiry) with Approve / Deny.
// [POS]: Shared by the Assistants page and the Needs You inbox. The card shows the action exactly as the core worded it and
//        answers with the card's own `actionHash`, so a decision can only ever apply to what was shown; an expired card
//        cannot be answered (the core would refuse it as stale anyway).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, XStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import { Card } from '@/components/section';
import type { AssistantApproval } from '@/contracts/host-v3';
import { approvalLine } from '@/features/host/personal-agent-model';
import { colors } from '@/theme/tokens';

export function ApprovalCard({
  approval,
  now,
  heading,
  busy,
  canDecide,
  onDecide,
}: {
  approval: AssistantApproval;
  now: number;
  heading?: string;
  busy: boolean;
  canDecide: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const expired = approval.expiresAt > 0 && approval.expiresAt <= now;
  return (
    <Card padded gap={8}>
      {heading ? <Text color={colors.textSubtle} fontSize={12} fontWeight="700">{heading}</Text> : null}
      <Text color={colors.text} fontSize={14.5} lineHeight={21} selectable>{approval.action}</Text>
      <Text color={expired ? colors.danger : colors.textSubtle} fontSize={12.5}>{approvalLine(approval, now)}</Text>
      {canDecide ? (
        <XStack gap={8}>
          <PillButton label="Approve" compact disabled={busy || expired} onPress={() => onDecide(true)} />
          <PillButton label="Deny" tone="soft" compact disabled={busy || expired} onPress={() => onDecide(false)} />
        </XStack>
      ) : null}
    </Card>
  );
}
