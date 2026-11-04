// [INPUT]: one paired Mac record, its reachability, and the user's switch / reconnect / forget intents.
// [OUTPUT]: HostCard (the full Mac card of Connection settings) and toneColor (status tone → token color).
// [POS]: presentation only. Shows name, live status, address:port, route (LAN/Tailscale/USB), the
//        certificate tag, last-connected time with the phone's network then, first-paired date and any
//        earlier addresses. Tapping a non-active card switches to it; the trash forgets it on this phone
//        only after a confirmation. Wording comes from features/host/host-card-model.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { RefreshCw, Trash2 } from 'lucide-react-native';
import { Alert } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import { Card } from '@/components/section';
import { Tap } from '@/components/tap';

import { agoLabel, cardStatus, dateLabel, lastConnectedLine, routeLabel, shortFingerprint, type CardTone, type ProbeState } from '@/features/host/host-card-model';
import { recordRoute, type HostRecordV3 } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { colors, radii } from '@/theme/tokens';

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

function Tag({ label }: { label: string }) {
  return (
    <YStack paddingHorizontal="$2" paddingVertical={2} borderRadius={radii.pill} backgroundColor={colors.surfaceRaised}>
      <Text color={colors.textMuted} fontSize={11} fontWeight="650">{label}</Text>
    </YStack>
  );
}

interface HostCardProps {
  record: HostRecordV3;
  active: boolean;
  probe: ProbeState;
  now: number;
  onSwitch(): void;
  onReconnect(): void;
  onRemove(): void;
}

export function HostCard({ record, active, probe, now, onSwitch, onReconnect, onRemove }: HostCardProps) {
  const name = record.name || 'Paired computer';
  const { p2pActive } = useHostV3();
  const status = cardStatus(active, probe);
  const earlier = record.addresses.filter((item) => !(item.host === record.host && item.port === record.port));

  const confirmRemove = () =>
    Alert.alert(
      `Forget ${name}?`,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: onRemove },
      ],
    );

  return (
    <Card active={active} padded>
      <Tap
        disabled={active}
        role="button"
        accessibilityLabel={active ? `${name}, current computer` : `Switch to ${name}`}
        onPress={onSwitch}>
        <YStack gap="$1.5">
          <XStack alignItems="center" gap="$2">
            <YStack width={9} height={9} borderRadius={5} backgroundColor={toneColor(status.tone)} />
            <Text flex={1} color={colors.text} fontSize={16} fontWeight="700" numberOfLines={1}>{name}</Text>
            <Text color={toneColor(status.tone)} fontSize={12} fontWeight="650">{status.label}</Text>
          </XStack>
          <XStack alignItems="center" gap="$2" flexWrap="wrap">
            <Text color={colors.textMuted} fontSize={12}>{record.host}:{record.port}</Text>
            <Tag label={routeLabel(active && p2pActive ? 'p2p' : recordRoute(record))} />
            <Tag label={`#${shortFingerprint(record.fingerprint)}`} />
          </XStack>
          <Text color={colors.textMuted} fontSize={12}>Last connected {lastConnectedLine(record.lastConnectedAt, record.network, now)}</Text>
          <Text color={colors.textSubtle} fontSize={11}>
            Paired {dateLabel(record.pairedAt)}
            {earlier.length > 0 ? ` · Earlier: ${earlier.map((item) => `${item.host}:${item.port} (${agoLabel(item.lastUsedAt, now)})`).join(', ')}` : ''}
          </Text>
          {probe === 'unauthorized' ? (
            <Text color={colors.danger} fontSize={12} lineHeight={17}>No longer paired. Scan its QR code to pair again.</Text>
          ) : null}
        </YStack>
      </Tap>
      <XStack gap="$2" justifyContent="flex-end">
        {active ? <PillButton compact tone="soft" icon={RefreshCw} label="Reconnect" accessibilityLabel={`Reconnect to ${name}`} onPress={onReconnect} /> : null}
        <PillButton compact tone="danger" icon={Trash2} label="Forget" accessibilityLabel={`Forget ${name}`} onPress={confirmRemove} />
      </XStack>
    </Card>
  );
}
