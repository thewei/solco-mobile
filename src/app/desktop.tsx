// [INPUT]: the phone's book of paired Macs and a reachability reading per Mac.
// [OUTPUT]: The Remote Desktop device list — every paired computer with its online/offline state, route and
//           address; online ones open the session lobby (`/desktop-session`), offline ones explain themselves
//           and can be re-checked, Edit forgets a computer, + pairs another.
// [POS]: Entry of Remote Desktop (Home's monitor button). Pure presentation over `useHostV3` + `useHostProbes`:
//        the book itself stays the one registry (lib/host-book), the Mac stays the authority, and choosing a
//        computer is the same `switchTo` the Connection settings use. Probes re-check every 10 s while open.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, ChevronRight, Monitor, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { toneColor } from '@/components/host-card';
import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { Reveal } from '@/components/motion';
import { OptionSheet } from '@/components/option-sheet';
import { PillButton } from '@/components/pill-button';
import { Tap } from '@/components/tap';
import { cardStatus, routeLabel, type ProbeState } from '@/features/host/host-card-model';
import { useHostProbes } from '@/features/host/queries-v3';
import { displayName, sortDevices } from '@/features/remote-desktop/prefs';
import { hydrateRdPrefs, useRdPrefs } from '@/features/remote-desktop/prefs-store';
import { hostId, recordRoute, type HostRecordV3 } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { colors, radii } from '@/theme/tokens';

const RECHECK_MS = 10_000;

function DeviceRow({ record, name, active, probe, editing, busy, onOpen, onRename, onForget }: { record: HostRecordV3; name: string; active: boolean; probe: ProbeState; editing: boolean; busy: boolean; onOpen: () => void; onRename: () => void; onForget: () => void }) {
  const status = cardStatus(active, probe);
  const online = probe === 'ok';
  return (
    <XStack alignItems="center" gap="$3" padding="$3" borderRadius={radii.lg} backgroundColor={colors.surface} borderWidth={1} borderColor={active && online ? colors.accent : colors.border} opacity={online || editing ? 1 : 0.72}>
      <Tap flex={1} flexDirection="row" alignItems="center" gap="$3" role="button" accessibilityLabel={`${name}, ${status.label}`} onPress={onOpen} disabled={editing}>
        <YStack width={52} height={52} borderRadius={radii.md} alignItems="center" justifyContent="center" backgroundColor={online ? colors.accentSoft : colors.surfaceRaised}>
          <Icon as={Monitor} size="lg" tone={online ? 'accent' : 'subtle'} />
        </YStack>
        <YStack flex={1} gap={3}>
          <Text color={colors.text} fontSize={16} fontWeight="700" numberOfLines={1}>{name}</Text>
          <XStack alignItems="center" gap="$1.5">
            <YStack width={8} height={8} borderRadius={4} backgroundColor={toneColor(status.tone)} />
            <Text color={toneColor(status.tone)} fontSize={12} fontWeight="650">{status.label}</Text>
            <Text color={colors.textSubtle} fontSize={12} numberOfLines={1} flexShrink={1}>{`· ${routeLabel(recordRoute(record))} · ${record.host}`}</Text>
          </XStack>
        </YStack>
        {busy ? <ActivityIndicator color={colors.textMuted} /> : !editing && online ? <Icon as={ChevronRight} tone="subtle" /> : null}
      </Tap>
      {editing ? (
        <>
          <Tap role="button" accessibilityLabel={`Rename ${name}`} onPress={onRename} width={40} height={40} borderRadius={20} alignItems="center" justifyContent="center">
            <Icon as={Pencil} tone="muted" />
          </Tap>
          <Tap role="button" accessibilityLabel={`Forget ${name}`} onPress={onForget} width={40} height={40} borderRadius={20} alignItems="center" justifyContent="center">
            <Icon as={Trash2} tone="danger" />
          </Tap>
        </>
      ) : null}
    </XStack>
  );
}

export default function DesktopDevicesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hosts, activeId, switchTo, remove } = useHostV3();
  const probes = useHostProbes(true);
  const [editing, setEditing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const prefs = useRdPrefs();
  const [renaming, setRenaming] = useState<{ id: string; fallback: string; draft: string } | null>(null);
  useEffect(() => void hydrateRdPrefs(), []);

  // Re-check reachability while this list is on screen.
  useFocusEffect(
    useCallback(() => {
      const recheck = () => void queryClient.invalidateQueries({ queryKey: ['v3', 'probe'] });
      recheck();
      const id = setInterval(recheck, RECHECK_MS);
      return () => clearInterval(id);
    }, [queryClient]),
  );

  const rows = useMemo(() => {
    const rank = (r: HostRecordV3) => (probes[hostId(r)] === 'ok' ? 0 : probes[hostId(r)] === 'checking' || probes[hostId(r)] == null ? 1 : 2);
    // Online first; inside each group the recently opened computer leads.
    const groups = [0, 1, 2].map((r) => sortDevices(hosts.filter((h) => rank(h) === r).map((h) => ({ id: hostId(h), h })), prefs).map((x) => x.h));
    return groups.flat();
  }, [hosts, probes, prefs]);
  const onlineCount = rows.filter((r) => probes[hostId(r)] === 'ok').length;

  const open = async (record: HostRecordV3) => {
    const id = hostId(record);
    const probe = probes[id] ?? 'checking';
    const name = displayName(prefs, id, record.name || 'this computer');
    if (probe === 'unauthorized') {
      Alert.alert('Needs re-pairing', `${name} no longer knows this phone. Scan its QR code again in Connection settings.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pair again', onPress: () => router.push('/connect') },
      ]);
      return;
    }
    if (probe !== 'ok') {
      Alert.alert('Can’t reach this computer', `Make sure ${name} is awake, Solco is running and both are on the same network (or Tailscale).`, [
        { text: 'OK', style: 'cancel' },
        { text: 'Check again', onPress: () => void queryClient.invalidateQueries({ queryKey: ['v3', 'probe'] }) },
      ]);
      return;
    }
    setOpening(id);
    try {
      if (id !== activeId) await switchTo(id);
      prefs.touchDevice(id);
      router.push('/desktop-session');
    } finally {
      setOpening(null);
    }
  };

  const forget = (record: HostRecordV3) =>
    Alert.alert(`Forget ${displayName(prefs, hostId(record), record.name || 'this computer')}?`, 'It disappears from this phone; pair it again to bring it back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: () => void remove(hostId(record)) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom']}>
      <XStack alignItems="center" paddingHorizontal="$2" height={52}>
        <IconButton as={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text flex={1} color={colors.text} fontSize={17} fontWeight="700" marginLeft="$1">Remote Desktop</Text>
        {hosts.length > 0 ? (
          <Tap role="button" accessibilityLabel={editing ? 'Done' : 'Edit'} onPress={() => setEditing((v) => !v)} paddingHorizontal="$3" height={42} justifyContent="center">
            <Text color={colors.accent} fontSize={15} fontWeight="600">{editing ? 'Done' : 'Edit'}</Text>
          </Tap>
        ) : null}
        <IconButton as={Plus} label="Add a computer" onPress={() => router.push('/connect')} />
      </XStack>

      {hosts.length === 0 ? (
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$6">
          <YStack width={72} height={72} borderRadius={radii.lg} alignItems="center" justifyContent="center" backgroundColor={colors.surfaceRaised}>
            <Icon as={Monitor} size="lg" tone="subtle" />
          </YStack>
          <Text color={colors.text} fontSize={17} fontWeight="700">No computers yet</Text>
          <Text color={colors.textMuted} fontSize={13} lineHeight={19} textAlign="center">Pair your Mac once with its QR code, then it shows up here to control from anywhere.</Text>
          <PillButton label="Add a computer" onPress={() => router.push('/connect')} />
        </YStack>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text color={colors.textSubtle} fontSize={12}>{`${onlineCount} of ${hosts.length} online`}</Text>
          {rows.map((record) => {
            const id = hostId(record);
            return (
              <Reveal key={id}>
                <DeviceRow record={record} name={displayName(prefs, id, record.name || 'Paired computer')} active={id === activeId} probe={probes[id] ?? 'checking'} editing={editing} busy={opening === id} onOpen={() => void open(record)} onRename={() => setRenaming({ id, fallback: record.name || '', draft: prefs.aliases[id] ?? '' })} onForget={() => forget(record)} />
              </Reveal>
            );
          })}
        </ScrollView>
      )}
      <OptionSheet visible={renaming !== null} title="Rename computer" onClose={() => setRenaming(null)}>
        <YStack gap="$3" padding="$3">
          <TextInput
            value={renaming?.draft ?? ''}
            onChangeText={(draft) => setRenaming((r) => (r ? { ...r, draft } : r))}
            placeholder={renaming?.fallback || 'Name'}
            placeholderTextColor={colors.textSubtle}
            autoFocus
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={() => renaming && (prefs.rename(renaming.id, renaming.draft), setRenaming(null))}
            style={{ color: colors.text, fontSize: 16, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
          />
          <PillButton label="Save" onPress={() => renaming && (prefs.rename(renaming.id, renaming.draft), setRenaming(null))} />
          <Text color={colors.textSubtle} fontSize={12}>Only on this phone. Leave it empty to use the Mac’s own name.</Text>
        </YStack>
      </OptionSheet>
    </SafeAreaView>
  );
}
