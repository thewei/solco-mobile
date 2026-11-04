// [INPUT]: the paired Host's tree (via the shared queries), the selected instance, the live query state and the
//          session-local list choice (state/drawer-store).
// [OUTPUT]: SessionsDrawer — the Home drawer: one head block, the instance switcher (it names where the phone
//           is looking and opens ONE sheet to switch computer / Herdr session / device), a two-way switch like the
//           desktop sidebar's — Agents (agent panes under a faint Workspace label, blocked, working, then the rest
//           by last worked, with the Mac's titles, the last-worked age and the one status slot; the switch carries
//           the needs-you count) and Workspaces (one tile row per Workspace — letter, name, pane tally, its most
//           urgent status — folding open into every pane, Terminals included) — and one bottom block, the
//           HostSwitcher (active Mac status + Connection settings).
// [POS]: Option C of designs/mobile-shell: a push-style sidebar that mirrors the desktop one.
//        Selecting a row opens that pane (Chat or terminal) and closes the drawer; client-local
//        only — it never moves the Mac's focus. Sessions and Quota are tabs of the bottom bar, not rows here.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { HostSwitcher } from '@/components/host-switcher';
import { InstanceSwitcher } from '@/components/instance-switcher';
import { Chevron, Reveal } from '@/components/motion';
import { StatusSlot } from '@/components/status-slot';
import { Tap } from '@/components/tap';
import type { TreePane, TreeWorkspace } from '@/contracts/host-v3';
import { agoShort, comparePanes, paneRoute, paneTitle, summarize } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { useDrawerStore, type DrawerView } from '@/state/drawer-store';
import { colors, radii, row, spacing, tile } from '@/theme/tokens';

/** The desktop sidebar's two-way switch: the needs-you count rides on Agents. */
function ViewSwitch({ view, onChange, needsYou }: { view: DrawerView; onChange: (view: DrawerView) => void; needsYou: number }) {
  const segment = (id: DrawerView, label: string, badge?: number) => {
    const active = view === id;
    return (
      <Tap key={id} flex={1} role="tab" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={() => onChange(id)}>
        <XStack alignItems="center" justifyContent="center" gap="$1.5" height={32} borderRadius={radii.pill - 2} backgroundColor={active ? colors.surfacePressed : 'transparent'}>
          <Text color={active ? colors.text : colors.textMuted} fontSize={13} fontWeight="650">{label}</Text>
          {badge ? (
            <XStack minWidth={18} height={18} paddingHorizontal={5} borderRadius={9} alignItems="center" justifyContent="center" backgroundColor={colors.attention}>
              <Text color={colors.canvas} fontSize={11} fontWeight="800">{badge}</Text>
            </XStack>
          ) : null}
        </XStack>
      </Tap>
    );
  };
  return (
    <XStack role="tablist" marginHorizontal={spacing.screen} marginTop={12} marginBottom={4} padding={3} borderRadius={radii.pill} borderWidth={1} borderColor={colors.border} backgroundColor={colors.surface}>
      {segment('agents', 'Agents', needsYou)}
      {segment('workspaces', 'Workspaces')}
    </XStack>
  );
}

/** The provider is named only when the title (the Mac's own) does not already say it. */
function paneCaption(pane: TreePane): string {
  const leaf = pane.cwd?.split('/').filter(Boolean).pop();
  const provider = pane.agent ? (paneTitle(pane).toLowerCase().includes(pane.agent.provider.toLowerCase()) ? '' : pane.agent.provider) : 'Terminal';
  return [provider, leaf].filter(Boolean).join(' · ');
}

function PaneRow({ pane, now, indent = 0, onOpen }: { pane: TreePane; now: number; indent?: number; onOpen: (pane: TreePane) => void }) {
  return (
    <Tap role="button" accessibilityLabel={`Open ${paneTitle(pane)}`} onPress={() => onOpen(pane)}>
      <XStack alignItems="center" gap={row.gap} paddingLeft={spacing.screen + indent} paddingRight={spacing.screen} paddingVertical={10} minHeight={48}>
        <YStack flex={1}>
          <Text color={colors.text} fontSize={14} fontWeight="600" numberOfLines={1}>{paneTitle(pane)}</Text>
          <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{paneCaption(pane)}</Text>
        </YStack>
        {pane.agent?.lastActiveMs ? <Text color={colors.textSubtle} fontSize={12}>{agoShort(pane.agent.lastActiveMs, now)}</Text> : null}
        <StatusSlot status={pane.agent?.status} />
      </XStack>
    </Tap>
  );
}

const panesOf = (workspace: TreeWorkspace): TreePane[] => workspace.tabs.flatMap((tab) => tab.panes).sort(comparePanes);

/** One tile row per Workspace; it folds open into its panes (the single Workspace starts open). */
function WorkspaceRow({ workspace, now, single, onOpen }: { workspace: TreeWorkspace; now: number; single: boolean; onOpen: (pane: TreePane) => void }) {
  const [folded, setFolded] = useState<boolean | null>(null);
  const open = folded ?? single;
  const panes = panesOf(workspace);
  // comparePanes puts blocked first, then working, so the first agent pane carries the Workspace's most urgent state.
  const status = panes.find((pane) => pane.agent)?.agent?.status;
  const initial = (workspace.label.trim()[0] ?? '?').toUpperCase();
  return (
    <YStack>
      <Tap role="button" accessibilityLabel={`${workspace.label}, ${panes.length} ${panes.length === 1 ? 'pane' : 'panes'}`} accessibilityState={{ expanded: open }} onPress={() => setFolded(!open)}>
        <XStack alignItems="center" gap={row.gap} paddingHorizontal={spacing.screen} paddingVertical={8} minHeight={52}>
          <YStack width={tile.size} height={tile.size} borderRadius={tile.radius} alignItems="center" justifyContent="center" backgroundColor={colors.surfaceRaised}>
            <Text color={colors.text} fontSize={14} fontWeight="700">{initial}</Text>
          </YStack>
          <YStack flex={1}>
            <Text color={colors.text} fontSize={14} fontWeight="650" numberOfLines={1}>{workspace.label}</Text>
            <Text color={colors.textSubtle} fontSize={12}>{panes.length} {panes.length === 1 ? 'pane' : 'panes'}</Text>
          </YStack>
          <Chevron open={open} />
          <StatusSlot status={status} />
        </XStack>
      </Tap>
      {open ? (
        <Reveal>
          {panes.map((pane) => (
            <PaneRow key={pane.paneId} pane={pane} now={now} indent={tile.size + row.gap} onOpen={onOpen} />
          ))}
        </Reveal>
      ) : null}
    </YStack>
  );
}

export function SessionsDrawer({ navigation }: { navigation: { closeDrawer: () => void } }) {
  const router = useRouter();
  const now = useNow();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const view = useDrawerStore((state) => state.view);
  const setView = useDrawerStore((state) => state.setView);
  const workspaces = tree.data?.workspaces ?? [];
  const summary = summarize(workspaces);
  const instances = bootstrap.data?.instances ?? [];
  const chatServed = bootstrap.data?.capabilities.chat === true;
  const reachable = !bootstrap.isError && !tree.isError;
  const withAgents = workspaces.filter((workspace) => workspace.tabs.some((tab) => tab.panes.some((pane) => pane.agent)));

  const open = (pane: TreePane) => {
    if (!instance) return;
    navigation.closeDrawer();
    router.push(paneRoute(pane, instance, chatServed));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      {instance ? <InstanceSwitcher instances={instances} current={instance} closeDrawer={navigation.closeDrawer} /> : null}
      <ViewSwitch view={view} onChange={setView} needsYou={summary.needsYou.length} />
      <ScrollView flex={1} contentContainerStyle={{ paddingBottom: spacing.screen }}>
        {view === 'agents'
          ? withAgents.map((workspace) => (
              <YStack key={workspace.id} paddingTop={12}>
                <Text color={colors.textSubtle} fontSize={12} fontWeight="600" paddingHorizontal={spacing.screen} paddingBottom={4} numberOfLines={1}>
                  {workspace.label}
                </Text>
                {panesOf(workspace).filter((pane) => pane.agent).map((pane) => (
                  <PaneRow key={pane.paneId} pane={pane} now={now} onOpen={open} />
                ))}
              </YStack>
            ))
          : workspaces.map((workspace) => (
              <WorkspaceRow key={workspace.id} workspace={workspace} now={now} single={workspaces.length === 1} onOpen={open} />
            ))}
        {(view === 'agents' ? withAgents.length === 0 : workspaces.length === 0) && !tree.isLoading ? (
          <Text color={colors.textSubtle} fontSize={13} textAlign="center" padding={spacing.screen}>
            {view === 'agents' ? 'No agents running.' : 'No workspaces yet.'}
          </Text>
        ) : null}
      </ScrollView>
      <HostSwitcher closeDrawer={navigation.closeDrawer} reachable={reachable} />
    </SafeAreaView>
  );
}
