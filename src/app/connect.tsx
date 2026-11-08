// [INPUT]: the phone's paired Macs (lib/host-book through useHostV3), their reachability (probed while the page is open) and a pasted
//          solco://pair link.
// [OUTPUT]: HostsScreen — the Settings → Hosts page: one card per paired Mac (live status, route chips), the way to pair another by
//           scanning or pasting the link the Mac shows (Settings → Remote Access → Pair a phone), an offline banner when no Mac
//           answers, and the empty state that is also the first screen of an unpaired phone. A card opens a sheet: switch to it,
//           reconnect, or forget it on this phone.
// [POS]: The manual twin of the deep-link route. The Mac stays the authority: the list is only what this phone paired, there is no
//        token field and no transport preference — a link carries the host, the port, the certificate fingerprint and a single-use
//        code. The keep-alive and system-push cards moved to Settings → Notifications (designs/mobile-t3-redesign `hosts`).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { HostCard } from '@/components/host-card';
import { Hint, ListRow, Section } from '@/components/list-group';
import { OptionSheet } from '@/components/option-sheet';
import { PillButton } from '@/components/pill-button';
import { Screen } from '@/components/screen';
import { Field } from '@/components/text-field';
import { describeConnectFailure } from '@/features/host/connect-failure';
import { agoLabel, lastConnectedLine, routeLabel } from '@/features/host/host-card-model';
import { useHostProbes } from '@/features/host/queries-v3';
import { hostId, recordRoute, type HostRecordV3 } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { parsePairUrl } from '@/lib/pairing-v3';
import { readPhoneNetwork } from '@/lib/phone-network';
import { useNow } from '@/lib/use-now';
import { IconDeviceDesktop, IconLink, IconPlayerPlay, IconQrcode, IconRefresh, IconTrash } from '@/theme/glyphs';
import { colors, type as typeScale } from '@/theme/tokens';

const PAIR_HOW = 'On your Mac: Solco → Settings → Remote Access → Pair a phone, then scan the QR code here.';

export default function HostsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hosts, activeId, pair, switchTo, remove, pinnedAvailable } = useHostV3();
  const probes = useHostProbes(true);
  const now = useNow();
  const [chosen, setChosen] = useState<HostRecordV3 | null>(null);
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every Mac was asked and none answered: the phone is offline, not one Mac asleep.
  const offline = hosts.length > 0 && hosts.every((host) => probes[hostId(host)] === 'unreachable');
  const retry = () => void queryClient.invalidateQueries({ queryKey: ['v3'] });

  const submit = async () => {
    const target = parsePairUrl(link);
    if (!target) {
      setError('That is not a Solco pairing link. It starts with solco://pair?…');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pair(target);
      setLink('');
      setPasting(false);
      router.replace('/');
    } catch (cause) {
      const view = describeConnectFailure(cause, { host: target.host, port: target.port, network: await readPhoneNetwork(), tunnel: Boolean(target.tailcat) });
      setError(`${view.title} (${view.detail}). ${view.hint}`);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmForget = (record: HostRecordV3) =>
    Alert.alert(`Forget ${record.name || 'this computer'}?`, 'It stops appearing on this phone. The computer still lists the phone until you revoke it there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => {
          setChosen(null);
          void remove(hostId(record));
        },
      },
    ]);

  const pairRows = pinnedAvailable ? (
    <Section>
      <ListRow icon={IconQrcode} label="Pair a new host" description="Scan the code Solco shows on your Mac" onPress={() => router.push('/scan')} />
      <ListRow icon={IconLink} label="Paste a pairing link" onPress={() => setPasting(true)} />
    </Section>
  ) : (
    <Hint>Pairing requires the Android app.</Hint>
  );

  const chosenId = chosen ? hostId(chosen) : null;
  const chosenActive = chosenId !== null && chosenId === activeId;

  return (
    <Screen back={hosts.length > 0} title="Hosts" subtitle={hosts.length === 0 ? 'None paired' : `${hosts.length} paired`}>
      {hosts.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState
            icon={IconDeviceDesktop}
            title="Pair your first host"
            text={PAIR_HOW}
            action={pinnedAvailable ? 'Scan code' : undefined}
            onAction={() => router.push('/scan')}
          />
          {pinnedAvailable ? (
            <View style={{ paddingTop: 8, paddingBottom: 16 }}>
              <Section>
                <ListRow icon={IconLink} label="Paste a pairing link" onPress={() => setPasting(true)} />
              </Section>
            </View>
          ) : (
            <Hint>Pairing requires the Android app.</Hint>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          {offline ? <Banner tone="bad" text="You’re offline. Chats, files and git need a connection to your Mac." action="Retry" onAction={retry} /> : null}
          <View style={{ height: 8 }} />
          {hosts.map((record) => {
            const id = hostId(record);
            return <HostCard key={id} record={record} active={id === activeId} probe={probes[id] ?? 'checking'} onPress={() => setChosen(record)} />;
          })}
          {pairRows}
        </ScrollView>
      )}

      <OptionSheet
        visible={chosen !== null}
        title={chosen?.name || 'Paired computer'}
        subtitle={chosen ? `${chosen.host}:${chosen.port} · ${routeLabel(recordRoute(chosen))} · reached ${lastConnectedLine(chosen.lastConnectedAt, chosen.network, now)}` : undefined}
        onClose={() => setChosen(null)}>
        {chosen && !chosenActive ? (
          <ListRow
            icon={IconPlayerPlay}
            label="Switch to this host"
            chevron={false}
            onPress={() => {
              const id = hostId(chosen);
              setChosen(null);
              void switchTo(id).then(() => router.replace('/'));
            }}
          />
        ) : null}
        {chosen && chosenActive ? (
          <ListRow
            icon={IconRefresh}
            label="Reconnect"
            chevron={false}
            onPress={() => {
              setChosen(null);
              void queryClient.invalidateQueries({ queryKey: ['v3'] });
              router.replace('/');
            }}
          />
        ) : null}
        {chosen ? <ListRow icon={IconTrash} label="Forget on this phone" danger chevron={false} onPress={() => confirmForget(chosen)} /> : null}
        {chosen ? (
          <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingHorizontal={16} paddingTop={8}>
            {`Paired ${agoLabel(chosen.pairedAt, now)}`}
          </Text>
        ) : null}
      </OptionSheet>

      <OptionSheet visible={pasting} title="Paste a pairing link" subtitle="Solco → Settings → Remote Access → Pair a phone → Copy Link" onClose={() => setPasting(false)}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
          <Field value={link} onChange={setLink} placeholder="solco://pair?h=…" />
          {error ? <Text color={colors.danger} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{error}</Text> : null}
          <PillButton size="lg" fill label={submitting ? 'Pairing…' : hosts.length > 0 ? 'Pair another computer' : 'Pair'} accessibilityLabel="Pair" disabled={submitting || !link.trim()} onPress={() => void submit()} />
        </View>
      </OptionSheet>
    </Screen>
  );
}
