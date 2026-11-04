// [INPUT]: the paired Go Host's tree (events-hinted via BackgroundBridge's shared socket — the drawer shares the same queries) and per-pane peeks.
// [OUTPUT]: Home: a top bar (≡ opens the sessions drawer, ⚙ opens Connection) over the panes that
//           the Mac's own grouping — Needs you, Working, Idle (each most recently worked first) — each
//           with a one-line peek; when nothing needs attention, a quiet greeting that points at the drawer. An agent row opens its Chat (when the Host
//           serves it), any other row its terminal. When the Host advertises `launch`, the new-session
//           composer sits at the bottom (LaunchComposer).
// [POS]: The Agents tab of the bottom bar and the mobile root screen (designs/mobile-projection, nav A). Navigation is client-local and never
//        moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useState } from 'react';
import { Bot, Menu, Monitor, Settings, Zap } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import type { TreeBackground } from '@/contracts/host-v3';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { IconButton } from '@/components/icon-button';
import { LaunchComposer } from '@/components/launch-composer';
import { Fade, Reveal } from '@/components/motion';
import { PaneRow } from '@/components/pane-row';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { useLiveTreeEvents } from '@/features/host/background-bridge';
import { connectionLine, describeConnectFailure } from '@/features/host/connect-failure';
import { blocksScreen, useFailureGrace } from '@/features/host/failure-grace';
import { paneRoute, summarize, type FlatPane } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { hostId, recordRoute } from '@/lib/host-book';
import { useHostV3 } from '@/lib/host-v3-provider';
import { usePhoneNetwork } from '@/lib/use-phone-network';
import { useNow } from '@/lib/use-now';
import { useOpenDrawer } from '@/lib/use-open-drawer';
import { colors, spacing } from '@/theme/tokens';

function Group({ title, items, instance, now, peek = true, onOpen, onOpenBackground }: { title: string; items: FlatPane[]; instance: string; now: number; peek?: boolean; onOpen: (pane: FlatPane['pane']) => void; onOpenBackground: (pane: FlatPane['pane'], item: TreeBackground) => void }) {
  if (items.length === 0) return null;
  return (
    <Reveal layout>
      <SectionLabel>{title}</SectionLabel>
      <Card>
        {items.map(({ pane, workspace }, index) => (
          <YStack key={pane.paneId} borderTopWidth={index === 0 ? 0 : 1} borderTopColor={colors.border}>
            <PaneRow instance={instance} pane={pane} caption={workspace.label} now={now} peek={peek} onPress={() => onOpen(pane)} onOpenBackground={(item) => onOpenBackground(pane, item)} />
          </YStack>
        ))}
      </Card>
    </Reveal>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const openDrawer = useOpenDrawer();
  const { connection, hosts, activeId, p2pActive } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const now = useNow();
  const network = usePhoneNetwork();
  const live = useLiveTreeEvents();
  // Pull-to-refresh owns the visible spinner; event-driven background refetches stay silent.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void tree.refetch().finally(() => setRefreshing(false));
  };

  const title = connection?.name || bootstrap.data?.hostName || 'Solco';
  const active = hosts.find((host) => hostId(host) === activeId);
  const route = p2pActive ? 'p2p' : active ? recordRoute(active) : 'other';
  const error = (bootstrap.error ?? tree.error) as unknown;
  const failure = error ? (error instanceof HostV3Error ? error : new HostV3Error('transport', String(error))) : null;
  // A network change breaks the reads in flight for a moment: the list stays as it was (the status line says
  // "Reconnecting…") and refills when the new route answers; only a lasting or non-network failure takes the screen.
  const hasData = bootstrap.data !== undefined && (instance === null || tree.data !== undefined);
  const graceElapsed = useFailureGrace(failure !== null && hasData);
  const blocked = failure !== null && blocksScreen({ failure, hasData, graceElapsed });
  const line = connectionLine({ failure: blocked ? failure : null, live, route });
  const failureView = blocked && failure && connection ? describeConnectFailure(failure, { host: connection.host, port: connection.port, network }) : null;
  const loading = !blocked && (bootstrap.isLoading || (instance !== null && tree.isLoading));
  const workspaces = tree.data?.workspaces ?? [];
  const summary = summarize(workspaces);
  const chatServed = bootstrap.data?.capabilities.chat === true;
  const launchKinds = bootstrap.data?.capabilities.launch ? (bootstrap.data.launchKinds ?? []) : [];

  const openPane = (pane: FlatPane['pane']) => {
    if (instance) router.push(paneRoute(pane, instance, chatServed));
  };

  // A sub-agent opens its agent's Chat with that sub-agent's drawer up; a service is read-only information.
  const openBackground = (pane: FlatPane['pane'], item: TreeBackground) => {
    if (!instance) return;
    if (item.kind === 'service') {
      Alert.alert(item.title, [item.detail ? `Listening on ${item.detail}` : '', 'Running in this agent’s pane on your Mac. Read-only here.'].filter(Boolean).join('\n'));
      return;
    }
    const route = paneRoute(pane, instance, chatServed);
    router.push(route.pathname === '/chat/[paneId]' ? { ...route, params: { ...route.params, subagent: item.id } } : route);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <XStack alignItems="center" paddingHorizontal="$2" height={52}>
        <IconButton as={Menu} label="Open sessions" onPress={openDrawer} />
        <YStack flex={1} alignItems="center">
          <Text color={colors.textMuted} fontSize={14} fontWeight="600" numberOfLines={1}>{title}</Text>
          <Text color={line.tone === 'attention' ? colors.attention : colors.textSubtle} fontSize={11} numberOfLines={1}>
            {line.text}
          </Text>
        </YStack>
        {bootstrap.data?.capabilities.personalAgent ? <IconButton as={Bot} tone="muted" label="Assistants" onPress={() => router.push('/assistants')} /> : null}
        {bootstrap.data?.capabilities.automations ? <IconButton as={Zap} tone="muted" label="Automations" onPress={() => router.push('/automations')} /> : null}
        {bootstrap.data?.capabilities.remoteDesktop ? <IconButton as={Monitor} tone="muted" label="Remote Desktop" onPress={() => router.push('/desktop')} /> : null}
        <IconButton as={Settings} tone="muted" label="Connection settings" onPress={() => router.push('/connect')} />
      </XStack>

      {blocked ? (
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$6">
          <Text color={colors.text} fontSize={17} fontWeight="700" textAlign="center">{failureView?.title} — {title}</Text>
          <Text color={colors.textSubtle} fontSize={12} textAlign="center">{failureView?.detail}</Text>
          <Text color={colors.textMuted} fontSize={13} lineHeight={19} textAlign="center">{failureView?.hint}</Text>
          <XStack gap="$3">
            <PillButton label="Try again" onPress={() => { void bootstrap.refetch(); void tree.refetch(); }} />
            <PillButton tone="soft" label="Switch computer" onPress={() => router.push('/connect')} />
          </XStack>
        </YStack>
      ) : loading ? (
        <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
      ) : (
        <YStack flex={1}>
        <ScrollView
          flex={1}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: spacing.section, flexGrow: 1 }}
          refreshControl={pullRefresh(refreshing, refresh)}>
          {instance ? (
            <>
              <Group title="Needs you" items={summary.needsYou} instance={instance} now={now} onOpen={openPane} onOpenBackground={openBackground} />
              <Group title="Working" items={summary.working} instance={instance} now={now} onOpen={openPane} onOpenBackground={openBackground} />
              <Group title="Idle" items={summary.idle} instance={instance} now={now} peek={false} onOpen={openPane} onOpenBackground={openBackground} />
            </>
          ) : null}
          {summary.needsYou.length + summary.working.length === 0 ? (
            <Fade style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.compact, paddingVertical: 60 }}>
              <Text color={colors.text} fontSize={20} fontWeight="700">
                {workspaces.length === 0 ? 'No workspaces yet' : 'Nothing needs you'}
              </Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center">
                {workspaces.length === 0 ? 'Open a workspace in Solco.' : 'Open the menu to pick a session.'}
              </Text>
            </Fade>
          ) : null}
        </ScrollView>
        {instance && launchKinds.length > 0 ? (
          <LaunchComposer instance={instance} kinds={launchKinds} workspaces={workspaces} chatServed={chatServed} collapsible />
        ) : null}
        </YStack>
      )}
    </SafeAreaView>
  );
}
