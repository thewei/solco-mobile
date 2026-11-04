// [INPUT]: the route's automation name, GET /api/v3/automations/{name} (needs `capabilities.automationsManage`), the Mac's tree
//          (to find a run's pane) and a clock.
// [OUTPUT]: AutomationDetailScreen — state and schedule, the actions the state allows (Approve a draft; Run Now, Pause / Resume,
//           Edit, Delete behind a confirm), the plugin's own facts, rationale and prompt, and the newest runs with an Open
//           button where the run's pane still exists on the Mac. Opening it marks the newest unread run seen.
// [POS]: The phone's counterpart of the desktop's detail drawer. Every action is one Host call that answers the fresh list;
//        a refusal's sentence is the plugin's own. A run carries no error text — its pane says why it failed.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Pause, Pencil, Play, Trash2 } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';

import type { AutomationDetail, AutomationOp } from '@/contracts/host-v3';
import { automationActionMessage, automationAgentName, openablePane, runRowLine } from '@/features/host/automations-model';
import { paneRoute } from '@/features/host/pane-model';
import { useAutomationDetail, useAutomationWrite, useBootstrapV3, useHostAutomations, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { formatInMs } from '@/features/host/quota-model';
import { useNow } from '@/lib/use-now';
import { colors, spacing } from '@/theme/tokens';

function Fact({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <XStack gap={12} alignItems="flex-start">
      <Text width={92} color={colors.textSubtle} fontSize={12.5}>{label}</Text>
      <Text flex={1} color={colors.text} fontSize={13}>{value}</Text>
    </XStack>
  );
}

function facts(detail: AutomationDetail, now: number): { label: string; value: string | undefined }[] {
  return [
    { label: 'Schedule', value: detail.schedule || detail.cron },
    { label: 'Next run', value: detail.state === 'active' && detail.nextRunMs ? `in ${formatInMs(detail.nextRunMs - now)}` : undefined },
    { label: 'Agent', value: automationAgentName(detail.agent) || undefined },
    { label: 'Model', value: detail.model },
    { label: 'Repository', value: detail.repo },
    { label: 'Starts in', value: detail.workspace === 'root' ? 'Repository root' : detail.workspace ? 'Fresh worktree' : undefined },
    { label: 'Run as', value: detail.headless ? 'Headless' : 'Interactive' },
    { label: 'On overlap', value: detail.onOverlap === 'queue' ? 'Queue the next run' : 'Skip the next run' },
    { label: 'Timeout', value: detail.timeoutMinutes ? `${detail.timeoutMinutes} min` : undefined },
    { label: 'Catch-up', value: detail.catchUpMinutes ? `${detail.catchUpMinutes} min` : undefined },
    { label: 'Cleanup', value: detail.cleanupTtlHours ? `after ${detail.cleanupTtlHours} h` : undefined },
  ];
}

const STATE_WORD = { draft: 'Draft — off until approved', paused: 'Paused', active: 'Active' } as const;

export default function AutomationDetailScreen() {
  const router = useRouter();
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const now = useNow();
  const bootstrap = useBootstrapV3();
  const manage = bootstrap.data?.capabilities.automationsManage === true;
  const detail = useAutomationDetail(name, manage);
  const list = useHostAutomations(manage); // the scheduler line; shares the cache the writes refresh
  const write = useAutomationWrite();
  const { bootstrap: instanceBootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const chatServed = instanceBootstrap.data?.capabilities.chat === true;

  // Looking at the automation is what "seen" means; only the newest run, once per opening.
  const seenFor = useRef<string | null>(null);
  const newestUnread = detail.data?.runs.find((run) => run.unread)?.id;
  useEffect(() => {
    if (!manage || !newestUnread || seenFor.current === newestUnread) return;
    seenFor.current = newestUnread;
    write.mutate({ kind: 'seen', target: { runId: newestUnread } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one mark per newest unread run
  }, [manage, newestUnread]);

  const act = (op: AutomationOp) => write.mutate({ kind: 'op', name, op }, { onSuccess: () => { if (op === 'delete') router.back(); } });
  const confirmDelete = () =>
    Alert.alert(`Delete ${name}?`, 'The automation and its schedule are removed from your computer. Past runs stay in their panes.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => act('delete') },
    ]);

  const data = detail.data;
  const busy = write.isPending;
  const schedulerDown = list.data && !list.data.scheduler && data?.state === 'active';

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        {!manage ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text color={colors.text} fontSize={16} fontWeight="700">Not available</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center">Update Solco on your computer to manage automations from here.</Text>
          </YStack>
        ) : detail.isLoading ? (
          <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
        ) : !data ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this automation</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center">{automationActionMessage(detail.error)}</Text>
          </YStack>
        ) : (
          <ScrollView
            flex={1}
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32 }}
            refreshControl={pullRefresh(detail.isRefetching, () => void detail.refetch())}>
            <Text color={data.state === 'draft' ? colors.attention : colors.textMuted} fontSize={13} fontWeight="600">{STATE_WORD[data.state]}</Text>
            {schedulerDown ? (
              <YStack gap={8} paddingTop={8}>
                <Text color={colors.attention} fontSize={12.5} lineHeight={18}>The scheduler is not running, so this will not fire on schedule.</Text>
                <PillButton label="Start Scheduler" tone="soft" compact disabled={busy} onPress={() => write.mutate({ kind: 'scheduler' })} />
              </YStack>
            ) : null}

            <XStack gap={8} paddingTop={12} flexWrap="wrap">
              {data.state === 'draft' ? <PillButton label="Approve" icon={Check} compact disabled={busy} onPress={() => act('approve')} /> : null}
              {data.state !== 'draft' ? <PillButton label="Run Now" icon={Play} compact disabled={busy} onPress={() => act('run')} /> : null}
              {data.state === 'active' ? <PillButton label="Pause" icon={Pause} tone="soft" compact disabled={busy} onPress={() => act('pause')} /> : null}
              {data.state === 'paused' ? <PillButton label="Resume" icon={Play} tone="soft" compact disabled={busy} onPress={() => act('resume')} /> : null}
              <PillButton label="Edit" icon={Pencil} tone="soft" compact disabled={busy} onPress={() => router.push({ pathname: '/automations/edit', params: { name } })} />
              <PillButton label="Delete" icon={Trash2} tone="danger" compact disabled={busy} onPress={confirmDelete} />
            </XStack>
            {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18} paddingTop={10}>{automationActionMessage(write.error)}</Text> : null}
            {write.isSuccess && write.variables?.kind === 'op' && write.variables.op === 'run' ? (
              <Text color={colors.textMuted} fontSize={12.5} paddingTop={10}>Started on your computer.</Text>
            ) : null}

            <SectionLabel inset={false}>Details</SectionLabel>
            <Card padded gap={8}>
              {facts(data, now).map((fact) => <Fact key={fact.label} label={fact.label} value={fact.value} />)}
            </Card>

            {data.rationale ? (
              <>
                <SectionLabel inset={false}>Rationale</SectionLabel>
                <Card padded><Text color={colors.text} fontSize={13.5} lineHeight={20} selectable>{data.rationale}</Text></Card>
              </>
            ) : null}
            {data.prompt ? (
              <>
                <SectionLabel inset={false}>Prompt</SectionLabel>
                <Card padded><Text color={colors.text} fontSize={13.5} lineHeight={20} selectable>{data.prompt}</Text></Card>
              </>
            ) : null}

            <SectionLabel inset={false}>Runs</SectionLabel>
            {data.runs.length === 0 ? (
              <Text color={colors.textSubtle} fontSize={13}>{data.state === 'draft' ? 'Nothing runs until you approve it.' : 'No runs yet.'}</Text>
            ) : (
              <Card padded gap={12}>
                {data.runs.map((run) => {
                  const pane = instance ? openablePane(run, tree.data?.workspaces ?? []) : null;
                  return (
                    <XStack key={run.id} alignItems="center" gap={10}>
                      <YStack width={8} height={8} borderRadius={4} backgroundColor={run.status === 'failed' ? colors.danger : run.status === 'running' ? colors.accent : run.unread ? colors.success : colors.textSubtle} />
                      <Text flex={1} color={run.status === 'failed' ? colors.danger : colors.text} fontSize={13}>{runRowLine(run, now)}</Text>
                      {pane && instance ? <PillButton label="Open" tone="soft" compact onPress={() => router.push(paneRoute(pane, instance, chatServed))} /> : null}
                    </XStack>
                  );
                })}
              </Card>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}
