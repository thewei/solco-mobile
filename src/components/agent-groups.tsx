// [INPUT]: the grouped agents (summarize), the instance and a pick handler.
// [OUTPUT]: AgentGroups — Needs you / Working / Idle cards of PaneRows, no peek.
// [POS]: The "choose an agent" list shared by Share to Solco and Files' Attach to chat. Client-local; picking
//        only navigates — nothing is sent for the user.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, YStack } from 'tamagui';

import { PaneRow } from '@/components/pane-row';
import type { FlatPane } from '@/features/host/pane-model';
import { colors, radii } from '@/theme/tokens';

function Group({ title, items, instance, now, onOpen }: { title: string; items: FlatPane[]; instance: string; now: number; onOpen: (pane: FlatPane['pane']) => void }) {
  if (items.length === 0) return null;
  return (
    <YStack gap="$1">
      <Text color={colors.textMuted} fontSize={12} fontWeight="700" letterSpacing={0.6} paddingHorizontal="$1" paddingTop="$3">
        {title.toUpperCase()}
      </Text>
      <YStack backgroundColor={colors.surface} borderColor={colors.border} borderWidth={1} borderRadius={radii.lg} overflow="hidden">
        {items.map(({ pane, workspace }, index) => (
          <YStack key={pane.paneId} borderTopWidth={index === 0 ? 0 : 1} borderTopColor={colors.border}>
            <PaneRow instance={instance} pane={pane} caption={workspace.label} now={now} peek={false} onPress={() => onOpen(pane)} />
          </YStack>
        ))}
      </YStack>
    </YStack>
  );
}

export function AgentGroups({ summary, instance, now, onOpen }: { summary: { needsYou: FlatPane[]; working: FlatPane[]; idle: FlatPane[] }; instance: string; now: number; onOpen: (pane: FlatPane['pane']) => void }) {
  return (
    <>
      <Group title="Needs you" items={summary.needsYou} instance={instance} now={now} onOpen={onOpen} />
      <Group title="Working" items={summary.working} instance={instance} now={now} onOpen={onOpen} />
      <Group title="Idle" items={summary.idle} instance={instance} now={now} onOpen={onOpen} />
    </>
  );
}
