// [INPUT]: one paired Mac record, its reachability, whether it is the active one, and a press handler.
// [OUTPUT]: HostCard (a grouped card: the Mac's tile, name and live status, then its route chips) and toneColor (status tone → token color).
// [POS]: The Mac card of the Hosts page (designs/mobile-t3-redesign `.hcard`): 28 dp grouped fill, a 40 dp tile, a status dot, and one chip
//        per route the Mac can be reached by — the route serving now is green, every chip dims while the Mac does not answer. A tap opens
//        the page's host sheet (switch / reconnect / forget); the card itself carries no buttons. Wording comes from features/host/host-card-model.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon, type Glyph } from '@/components/icon';
import { cardStatus, routeChips, type CardTone, type ProbeState } from '@/features/host/host-card-model';
import { recordRoute, type HostRecordV3, type HostRoute } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { IconArrowsLeftRight, IconCloud, IconDeviceDesktop, IconNetwork, IconPlugConnected, IconRoute, IconUsb, IconWifi } from '@/theme/glyphs';
import { colors, radii, type as typeScale } from '@/theme/tokens';

export function toneColor(tone: CardTone): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'attention':
      return colors.attention;
    case 'danger':
      return colors.danger;
    default:
      return colors.textSubtle;
  }
}

const ROUTE_GLYPH: Record<HostRoute, Glyph> = {
  lan: IconWifi,
  tailscale: IconNetwork,
  usb: IconUsb,
  relay: IconCloud,
  tailcat: IconRoute,
  p2p: IconArrowsLeftRight,
  other: IconPlugConnected,
};

export function HostCard({ record, active, probe, onPress }: { record: HostRecordV3; active: boolean; probe: ProbeState; onPress: () => void }) {
  const name = record.name || 'Paired computer';
  const { p2pActive } = useHostV3();
  const status = cardStatus(active, probe);
  const dim = probe === 'unreachable' || probe === 'unauthorized';
  const chips = routeChips(record, active && p2pActive ? 'p2p' : recordRoute(record));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${status.label}`}
      onPress={onPress}
      style={({ pressed }) => ({ marginHorizontal: 17.5, marginBottom: 10, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: pressed ? colors.surfacePressed : colors.surfaceRaised })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
          <Icon as={IconDeviceDesktop} size="lg" tone="text" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight} fontWeight="500" numberOfLines={1}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: toneColor(status.tone) }} />
            <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} numberOfLines={1}>{status.label}</Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 14 }}>
        {chips.map((chip) => (
          <View
            key={chip.route}
            style={{ height: 30, paddingHorizontal: 10, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: dim ? 0.55 : 1, backgroundColor: chip.best && !dim ? colors.successSoft : colors.surface }}>
            <Icon as={ROUTE_GLYPH[chip.route]} size="route" tone={chip.best && !dim ? 'success' : 'muted'} />
            <Text color={chip.best && !dim ? colors.success : colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} fontWeight={chip.best && !dim ? '500' : '400'}>{chip.label}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
