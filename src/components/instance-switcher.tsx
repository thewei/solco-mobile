// [INPUT]: the bootstrap's instances (the Mac's Herdr sessions plus, with `capabilities.devices`, its saved
//          machines as `kind: 'device'` entries with a status), the selected instance, the shared bootstrap
//          query (re-read when the sheet opens) and the phone's paired Macs with their reachability (probed only
//          while the sheet is open).
// [OUTPUT]: InstanceSwitcher — the drawer's one head row naming where the phone is looking (a Herdr session of
//           the Mac, or one of its saved devices); a tap opens ONE bottom sheet that switches all three levels:
//           COMPUTERS (the paired Macs; a tap switches), HERDR SESSIONS (of the active Mac) and DEVICES (its saved
//           machines with their status — a tap on a connected one switches, on a ready/unreachable/checking one
//           connects first with a spinner on its row, a refusal is worded under the list and changes nothing; one
//           that needs sign-in or is turned off only says so). Alone, the row is a plain label — nothing to switch.
// [POS]: The drawer's head. Nothing folds open inside the sidebar: the choice floats over it (the same OptionSheet
//        the Project and launch pickers use). A device is chosen the way a Herdr session is: client-local, never
//        moving the Mac's window, and the phone never asks for a credential: "Sign in on your Mac".
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Check, ChevronsUpDown, Layers, Server } from 'lucide-react-native';
import { useState } from 'react';
import { Spinner, Text, XStack, YStack } from 'tamagui';

import { toneColor } from '@/components/host-card';
import { Icon, IconTile } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { Tap } from '@/components/tap';
import type { BootstrapV3 } from '@/contracts/host-v3';
import { deviceAction, deviceCaption, deviceFailureMessage, isDeviceInstance } from '@/features/host/device-model';
import { cardStatus, routeLabel } from '@/features/host/host-card-model';
import { useBootstrapV3, useConnectDevice, useHostProbes } from '@/features/host/queries-v3';
import { hostId, recordRoute } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useSessionStore } from '@/state/session-store';
import { colors, row, spacing, tile } from '@/theme/tokens';

type Instance = BootstrapV3['instances'][number];

function statusTone(status: string | undefined): string {
  switch (status) {
    case 'connected':
    case 'online':
      return colors.success;
    case 'needs_signin':
      return colors.attention;
    case 'unreachable':
      return colors.danger;
    default:
      return colors.textSubtle;
  }
}

function GroupLabel({ children }: { children: string }) {
  return (
    <Text color={colors.textSubtle} fontSize={11} fontWeight="700" letterSpacing={0.6} paddingHorizontal={spacing.screen} paddingTop={10} paddingBottom={2}>
      {children}
    </Text>
  );
}

export function InstanceSwitcher({ instances, current, closeDrawer }: { instances: readonly Instance[]; current: string; closeDrawer: () => void }) {
  const [open, setOpen] = useState(false);
  const bootstrap = useBootstrapV3();
  const connect = useConnectDevice();
  const { hosts, activeId, switchTo } = useHostV3();
  const probes = useHostProbes(open);
  const selectInstance = useSessionStore((state) => state.selectInstance);
  const sessions = instances.filter((item) => item.kind !== 'device');
  const devices = instances.filter((item) => item.kind === 'device');
  const currentDevice = devices.find((item) => item.id === current);
  const onDevice = isDeviceInstance(current);
  const connecting = connect.isPending ? connect.variables : null;
  const foldable = sessions.length + devices.length > 1 || hosts.length > 1;
  const labelled = (hosts.length > 1 ? 1 : 0) + (sessions.length > 1 || devices.length > 0 ? 1 : 0) + (devices.length > 0 ? 1 : 0) > 1;

  const show = () => {
    connect.reset();
    void bootstrap.refetch();
    setOpen(true);
  };

  const pickSession = (id: string) => {
    setOpen(false);
    if (id !== current) selectInstance(id);
  };

  const pickHost = (id: string) => {
    setOpen(false);
    closeDrawer();
    void switchTo(id);
  };

  const chooseDevice = (device: Instance) => {
    const action = deviceAction(device.status);
    if (action === 'open') {
      selectInstance(device.id);
      setOpen(false);
      closeDrawer();
    } else if (action === 'connect') {
      connect.mutate(device.id, { onSuccess: () => { setOpen(false); closeDrawer(); } });
    }
  };

  const head = (
    <XStack alignItems="center" gap={row.gap} paddingHorizontal={spacing.screen} paddingVertical={6}>
      <IconTile as={onDevice ? Server : Layers} />
      <YStack flex={1}>
        <Text color={colors.textSubtle} fontSize={11} fontWeight="600">{onDevice ? 'Device' : 'Herdr session'}</Text>
        <Text color={colors.text} fontSize={15} fontWeight="600" numberOfLines={1}>
          {onDevice ? (currentDevice?.label || currentDevice?.id || current) : current}
        </Text>
      </YStack>
      {foldable ? <Icon as={ChevronsUpDown} size="sm" tone="subtle" /> : null}
    </XStack>
  );

  return (
    <YStack borderBottomWidth={1} borderBottomColor={colors.border}>
      {foldable ? (
        <Tap role="button" accessibilityLabel="Switch computer, session or device" onPress={show}>
          {head}
        </Tap>
      ) : head}
      <OptionSheet visible={open && foldable} title="Switch" onClose={() => setOpen(false)}>
        {hosts.length > 1 ? (
          <>
            {labelled ? <GroupLabel>COMPUTERS</GroupLabel> : null}
            {hosts.map((host) => {
              const id = hostId(host);
              const selected = id === activeId;
              const status = cardStatus(selected, probes[id] ?? 'checking');
              return (
                <Tap key={id} role="button" accessibilityLabel={`${selected ? 'Current computer' : 'Switch to'} ${host.name || 'Paired computer'}`} disabled={selected} onPress={() => pickHost(id)}>
                  <XStack alignItems="center" gap={row.gap} paddingHorizontal={spacing.screen} paddingVertical={10} minHeight={48}>
                    <YStack width={tile.size} alignItems="center">
                      {selected ? <Icon as={Check} size="sm" tone="accent" /> : <YStack width={8} height={8} borderRadius={4} backgroundColor={toneColor(status.tone)} />}
                    </YStack>
                    <YStack flex={1}>
                      <Text color={selected ? colors.text : colors.textMuted} fontSize={14} fontWeight={selected ? '700' : '600'} numberOfLines={1}>{host.name || 'Paired computer'}</Text>
                      <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>
                        {selected ? `${routeLabel(recordRoute(host))} · ${host.host}` : `${status.label} · ${routeLabel(recordRoute(host))} · ${host.host}`}
                      </Text>
                    </YStack>
                  </XStack>
                </Tap>
              );
            })}
          </>
        ) : null}
        {sessions.length > 1 || devices.length > 0 ? (
          <>
            {labelled ? <GroupLabel>{devices.length > 0 ? 'THIS MAC' : 'HERDR SESSIONS'}</GroupLabel> : null}
            {sessions.map((session) => {
              const selected = session.id === current;
              return (
                <Tap key={session.id} role="button" accessibilityLabel={`Switch to Herdr session ${session.id}`} onPress={() => pickSession(session.id)}>
                  <XStack alignItems="center" gap={row.gap} paddingHorizontal={spacing.screen} paddingVertical={10} minHeight={44}>
                    <YStack width={tile.size} alignItems="center">
                      {selected ? <Icon as={Check} size="sm" tone="accent" /> : null}
                    </YStack>
                    <Text flex={1} color={selected ? colors.text : colors.textMuted} fontSize={14} fontWeight={selected ? '700' : '600'} numberOfLines={1}>{session.id}</Text>
                  </XStack>
                </Tap>
              );
            })}
          </>
        ) : null}
        {devices.length > 0 ? (
          <>
            {labelled ? <GroupLabel>DEVICES</GroupLabel> : null}
            {devices.map((device) => {
              const selected = device.id === current;
              const busy = connecting === device.id;
              return (
                <Tap key={device.id} role="button" accessibilityLabel={`${device.label || device.id}, ${deviceCaption(device.status)}`} disabled={connect.isPending} onPress={() => chooseDevice(device)}>
                  <XStack alignItems="center" gap={row.gap} paddingHorizontal={spacing.screen} paddingVertical={10} minHeight={48}>
                    <YStack width={tile.size} alignItems="center">
                      {busy ? <Spinner size="small" color={colors.accent} /> : selected ? <Icon as={Check} size="sm" tone="accent" /> : <YStack width={8} height={8} borderRadius={4} backgroundColor={statusTone(device.status)} />}
                    </YStack>
                    <YStack flex={1}>
                      <Text color={selected ? colors.text : colors.textMuted} fontSize={14} fontWeight={selected ? '700' : '600'} numberOfLines={1}>{device.label || device.id}</Text>
                      <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{busy ? 'Connecting…' : deviceCaption(device.status)}</Text>
                    </YStack>
                  </XStack>
                </Tap>
              );
            })}
          </>
        ) : null}
        {connect.isError ? <Text color={colors.attention} fontSize={12} paddingHorizontal={spacing.screen} paddingTop={4}>{deviceFailureMessage(connect.error)}</Text> : null}
      </OptionSheet>
    </YStack>
  );
}
