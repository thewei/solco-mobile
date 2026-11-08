// [INPUT]: the bootstrap's instances (the Mac's Herdr sessions plus, with `capabilities.devices`, its saved machines as
//          `kind: 'device'` entries with a status), the selected instance, the phone's paired Macs with their
//          reachability (probed only while these rows are shown) and a callback for "a choice was made".
// [OUTPUT]: HostChoices — the rows of the Chats filter's Host submenu: COMPUTERS (the paired Macs; a tap switches),
//           HERDR SESSIONS of the active Mac and DEVICES (its saved machines with their status — a tap on a connected
//           one switches, on a ready/unreachable/checking one connects first with "Connecting…" on its row, a refusal is
//           worded under the list and changes nothing; one that needs sign-in or is turned off only says so).
// [POS]: The old drawer head's three-level switch, moved into the menu where the draft's "Host" filter sits. The
//        draft lists a host's chats from every host at once; the phone reads one Mac (and one of its sessions) at a
//        time, so "Host" here means *where the phone is looking*. A choice is client-local, never moves the Mac's
//        window, and the phone never asks for a credential: "Sign in on your Mac".
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useEffect } from 'react';
import { Text } from 'tamagui';

import { MenuHeading, MenuItem } from '@/components/menu';
import { deviceAction, deviceCaption, deviceFailureMessage } from '@/features/host/device-model';
import { cardStatus } from '@/features/host/host-card-model';
import { useBootstrapV3, useConnectDevice, useHostInstance, useHostProbes } from '@/features/host/queries-v3';
import { hostId } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useSessionStore } from '@/state/session-store';
import { colors, type as typeScale } from '@/theme/tokens';

export function HostChoices({ onDone }: { onDone: () => void }) {
  const bootstrap = useBootstrapV3();
  const { instance: current } = useHostInstance();
  const connect = useConnectDevice();
  const { hosts, activeId, switchTo } = useHostV3();
  const probes = useHostProbes(true);
  const selectInstance = useSessionStore((state) => state.selectInstance);
  const instances = bootstrap.data?.instances ?? [];
  const sessions = instances.filter((item) => item.kind !== 'device');
  const devices = instances.filter((item) => item.kind === 'device');
  const connecting = connect.isPending ? connect.variables : null;
  const labelled = (hosts.length > 1 ? 1 : 0) + (sessions.length > 1 || devices.length > 0 ? 1 : 0) + (devices.length > 0 ? 1 : 0) > 1;

  // The statuses of the saved machines are read fresh each time the submenu opens.
  useEffect(() => {
    connect.reset();
    void bootstrap.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);

  return (
    <>
      {labelled && hosts.length > 1 ? <MenuHeading>Computers</MenuHeading> : null}
      {hosts.map((host) => {
        const id = hostId(host);
        const selected = id === activeId;
        return (
          <MenuItem
            key={id}
            label={host.name || 'Paired computer'}
            detail={selected ? undefined : cardStatus(false, probes[id] ?? 'checking').label}
            checked={selected}
            onPress={() => {
              onDone();
              if (!selected) void switchTo(id);
            }}
          />
        );
      })}
      {sessions.length > 1 || devices.length > 0 ? (
        <>
          {labelled ? <MenuHeading>{devices.length > 0 ? 'This Mac' : 'Herdr sessions'}</MenuHeading> : null}
          {sessions.map((session) => (
            <MenuItem
              key={session.id}
              label={session.id}
              checked={session.id === current}
              onPress={() => {
                onDone();
                if (session.id !== current) selectInstance(session.id);
              }}
            />
          ))}
        </>
      ) : null}
      {devices.length > 0 ? (
        <>
          {labelled ? <MenuHeading>Devices</MenuHeading> : null}
          {devices.map((device) => (
            <MenuItem
              key={device.id}
              label={device.label || device.id}
              detail={connecting === device.id ? 'Connecting…' : device.id === current ? undefined : deviceCaption(device.status)}
              checked={device.id === current}
              onPress={() => {
                const action = deviceAction(device.status);
                if (action === 'open') {
                  selectInstance(device.id);
                  onDone();
                } else if (action === 'connect' && !connect.isPending) {
                  connect.mutate(device.id, { onSuccess: onDone });
                }
              }}
            />
          ))}
        </>
      ) : null}
      {connect.isError ? (
        <Text color={colors.attention} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} paddingHorizontal={16} paddingVertical={8}>{deviceFailureMessage(connect.error)}</Text>
      ) : null}
    </>
  );
}
