// [INPUT]: the phone's active paired Mac (useHostV3) and the live query state (`reachable` — bootstrap and tree
//          answered).
// [OUTPUT]: HostSwitcher — the drawer's one bottom block: the active Mac (name over an honest status line —
//           "Connected · route · address", or "Can't reach this computer") and a gear straight to Connection
//           settings. Switching to another Mac is not here: it lives in the head's switch sheet.
// [POS]: presentation plus one navigation; the same wording and status model as the Mac cards.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Laptop, Settings } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Text, XStack, YStack } from 'tamagui';

import { toneColor } from '@/components/host-card';
import { Icon, IconTile } from '@/components/icon';
import { Tap } from '@/components/tap';
import { routeLabel } from '@/features/host/host-card-model';
import { hostId, recordRoute } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { colors, row, spacing } from '@/theme/tokens';

export function HostSwitcher({ closeDrawer, reachable }: { closeDrawer: () => void; reachable: boolean }) {
  const router = useRouter();
  const { hosts, activeId, p2pActive } = useHostV3();
  const active = hosts.find((host) => hostId(host) === activeId);
  if (!active) return null;
  const tone = reachable ? 'success' : 'attention';
  const statusLine = reachable
    ? `Connected · ${routeLabel(p2pActive ? 'p2p' : recordRoute(active))} · ${active.host}`
    : 'Can’t reach this computer';

  const openConnection = () => {
    closeDrawer();
    router.push('/connect');
  };

  return (
    <XStack alignItems="center" paddingLeft={spacing.screen} borderTopWidth={1} borderTopColor={colors.border}>
      <XStack flex={1} alignItems="center" gap={row.gap} paddingVertical={row.padY}>
        <IconTile as={Laptop} tone={tone} />
        <YStack flex={1}>
          <Text color={colors.text} fontSize={14} fontWeight="700" numberOfLines={1}>{active.name || 'Paired computer'}</Text>
          <XStack alignItems="center" gap="$1.5">
            <YStack width={7} height={7} borderRadius={4} backgroundColor={toneColor(tone)} />
            <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{statusLine}</Text>
          </XStack>
        </YStack>
      </XStack>
      <Tap role="button" accessibilityLabel="Connection settings" onPress={openConnection} paddingVertical={row.padY} paddingHorizontal="$2.5">
        <Icon as={Settings} size="sm" tone="subtle" />
      </Tap>
    </XStack>
  );
}
