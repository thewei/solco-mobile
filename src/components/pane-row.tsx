// [INPUT]: one tree pane, its instance, and a press handler.
// [OUTPUT]: PaneRow — the Mac's agent title, the provider (only when the title does not already say it),
//           the Workspace, one-line peek, the Mac's last-worked age and the one status slot.
//           The title owns its own line (up to two); provider · Workspace · age share the small line under it.
// [POS]: Home's Needs-you / Working cards. The peek is the Host's read-only last line of the pane.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { ServiceSlot, StatusSlot } from '@/components/status-slot';
import type { TreeBackground, TreePane } from '@/contracts/host-v3';
import { agoShort, backgroundBusy, backgroundStatus, backgroundSummary, paneTitle } from '@/features/host/pane-model';
import { usePeekV3 } from '@/features/host/queries-v3';
import { Tap } from '@/components/tap';
import { colors, row } from '@/theme/tokens';

/** `peek` off = no polling for this row (Idle rows: nothing is happening there to read). */
export function PaneRow({ instance, pane, caption, now, peek: showPeek = true, onPress, onOpenBackground }: { instance: string; pane: TreePane; caption?: string; now: number; peek?: boolean; onPress: () => void; onOpenBackground?: (item: TreeBackground) => void }) {
  const peek = usePeekV3(instance, pane.paneId, showPeek);
  const line = showPeek ? peek.data?.line.trim() : undefined;
  const title = paneTitle(pane);
  const provider = pane.agent && !title.toLowerCase().includes(pane.agent.provider.toLowerCase()) ? pane.agent.provider : '';
  const ago = agoShort(pane.agent?.lastActiveMs, now);
  const meta = [provider, caption, ago].filter(Boolean).join(' · ');
  const background = pane.agent?.background ?? [];
  return (
    <YStack>
    <Tap role="button" accessibilityLabel={`Open ${paneTitle(pane)}`} onPress={onPress}>
      <XStack alignItems="center" gap={row.gap} paddingVertical={row.padY} paddingHorizontal={row.padX} minHeight={row.minHeight}>
        <YStack flex={1} gap="$1">
          <Text color={colors.text} fontSize={15} fontWeight="650" numberOfLines={2}>{title}</Text>
          {meta ? <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{meta}</Text> : null}
          {line ? <Text color={colors.textMuted} fontSize={12} numberOfLines={1} fontFamily="$mono">{line}</Text> : null}
        </YStack>
        <StatusSlot status={pane.agent?.status} />
        <Icon as={ChevronRight} size="sm" tone="subtle" />
      </XStack>
    </Tap>
    {background.length > 0 && onOpenBackground ? <BackgroundList items={background} onOpen={onOpenBackground} /> : null}
    </YStack>
  );
}

/**
 * The agent's sub-agents and the service its pane serves, one folded list (circle = sub-agent, square = service).
 * Starts open while something is working, like the desktop sidebar; the user's own tap wins afterwards.
 */
function BackgroundList({ items, onOpen }: { items: readonly TreeBackground[]; onOpen: (item: TreeBackground) => void }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? backgroundBusy(items);
  return (
    <YStack paddingBottom="$2">
      <Tap role="button" accessibilityLabel={`${open ? 'Fold' : 'Show'} background work`} onPress={() => setChosen(!open)}>
        <XStack alignItems="center" gap="$1" paddingHorizontal={row.padX} paddingVertical="$1">
          <Icon as={open ? ChevronDown : ChevronRight} size="sm" tone="subtle" />
          <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{backgroundSummary(items)}</Text>
        </XStack>
      </Tap>
      {open
        ? items.map((item) => (
            <Tap key={item.id} role="button" accessibilityLabel={`${item.kind === 'service' ? 'Service' : 'Sub-agent'} ${item.title}`} onPress={() => onOpen(item)}>
              <XStack alignItems="center" gap={row.gap} paddingLeft={row.padX + 14} paddingRight={row.padX} paddingVertical="$1.5">
                <YStack flex={1}>
                  <Text color={colors.text} fontSize={13} fontWeight="600" numberOfLines={1}>{item.title}</Text>
                  {item.detail ? <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{item.detail}</Text> : null}
                </YStack>
                {item.kind === 'service' ? <ServiceSlot /> : <StatusSlot status={backgroundStatus(item)} />}
              </XStack>
            </Tap>
          ))
        : null}
    </YStack>
  );
}
