// [INPUT]: a route param `id` (the Assistant), its page from the Mac (GET /api/v3/personal-agent/assistants/{id}: tasks with
//          runs, approvals), this phone's tree (to find a run's real pane) and a clock.
// [OUTPUT]: AssistantScreen — one Assistant's page (one Settings entry; the Primary also links to Groups): Conversation (open the Coordinator's real Chat pane; while it is not running and the Mac serves `personalAgentCoordinatorChat`, a tap goes to its chat window `/chat/assistant-<id>` instead and `manage=1` keeps this page; on a Mac without it — the resident Host has no catalog — one Start button, no message box: typing happens only in the Chat page) with its sleep rule in a line, Needs You (approvals, finished tasks that ask), Tasks, Done; pause/resume, rename, and under Advanced the Coordinator's Start / Stop / Restart — the only place the lifecycle is exposed. Opening it remembers the Assistant (`last-assistant-storage`) so the Assistants entry can open that chat directly.
// [POS]: Second client of the desktop `/assistants` page. Everything on it belongs to this Assistant only (the core isolates
//        tasks and approvals per Assistant). Each action is one exact write with the revision shown; a refusal
//        (stale above all) changes nothing and the page re-reads the Mac's truth. A run opens its Chat/Terminal only when its own
//        Herdr session and pane id are in this phone's tree — never by title. Settings (Work style, Memory, Behavior) and Groups have their own screens; Goals, Plans, Facts and PR watches are not drawn on the phone (2026-11-07: Chat · Tasks · Routines · Memory), and the core's goal/commitment data stays internal.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { ApprovalCard } from '@/components/approval-card';
import { KeyboardInset } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Field } from '@/components/text-field';
import type { AssistantDetail, AssistantTask, AssistantTaskAction, TreePane } from '@/contracts/host-v3';
import { coordinatorChatId } from '@/features/chat-web/coordinator-history';
import { agoShort, paneRoute } from '@/features/host/pane-model';
import {
  adoptableCoordinatorPane,
  coordinatorStartAgent,
  conversationState,
  openableRun,
  personalAgentMessage,
  taskActions,
  taskBuckets,
  taskStateLabel,
} from '@/features/host/personal-agent-model';
import { useAssistantDetail, useAssistantInbox, useAssistantRuntime, useBootstrapV3, useHostInstance, usePersonalAgentWrite, useTreeV3 } from '@/features/host/queries-v3';
import { saveLastAssistant } from '@/lib/last-assistant-storage';
import { useNow } from '@/lib/use-now';
import { colors, spacing } from '@/theme/tokens';

const TASK_LABEL = { ack: 'Got it', retry: 'Retry', publish: 'Publish' } as const;
const DONE_SHOWN = 10;

function TaskCard({
  task,
  now,
  manage,
  busy,
  onAction,
  onOpen,
  reason,
}: {
  reason?: string;
  task: AssistantTask;
  now: number;
  manage: boolean;
  busy: boolean;
  onAction: (action: AssistantTaskAction) => void;
  onOpen: (() => void) | null;
}) {
  const failed = task.state === 'failed' || task.state === 'uncertain';
  const actions = manage ? taskActions(task) : [];
  return (
    <Card padded gap={6}>
      <Text color={colors.text} fontSize={14.5} fontWeight="700" numberOfLines={2}>{task.title}</Text>
      <Text color={failed ? colors.danger : colors.textMuted} fontSize={12.5}>
        {taskStateLabel(task.state)} · {agoShort(task.updatedAt, now)} ago
      </Text>
      {reason ? <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>{reason}</Text> : null}
      {actions.length > 0 || onOpen ? (
        <XStack gap={8} flexWrap="wrap">
          {onOpen ? <PillButton label="Open" tone="soft" compact onPress={onOpen} /> : null}
          {actions.map((action) => (
            <PillButton key={action} label={TASK_LABEL[action]} tone={action === 'ack' || action === 'publish' ? 'primary' : 'soft'} compact disabled={busy} onPress={() => onAction(action)} />
          ))}
        </XStack>
      ) : null}
    </Card>
  );
}

export default function AssistantScreen() {
  const router = useRouter();
  const { id, manage: manageParam } = useLocalSearchParams<{ id: string; manage?: string }>();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgent === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const canDecide = bootstrap.data?.capabilities.personalAgentApprove === true;
  // One Settings entry for Work style, Memory and Behavior (whichever the Host serves).
  const caps = bootstrap.data?.capabilities;
  const settingsServed = caps?.personalAgentPersona === true || caps?.personalAgentMemory === true || caps?.personalAgentProactivity === true;
  const detail = useAssistantDetail(id ?? '', served);
  const inbox = useAssistantInbox(id ?? '', served);
  const reasons = new Map((inbox.data ?? []).flatMap((item) => (item.taskId ? [[item.taskId, item.detail] as const] : [])));
  const write = usePersonalAgentWrite();
  const { bootstrap: instanceBootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const chatServed = instanceBootstrap.data?.capabilities.chat === true;
  const now = useNow();
  const [advanced, setAdvanced] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [showDone, setShowDone] = useState(false);
  const data: AssistantDetail | undefined = detail.data;
  const busy = write.isPending;
  const runtime = useAssistantRuntime(id ?? '', caps?.personalAgentPersona === true);
  const nap = runtime.data?.profile.idleSleepMin;

  // The Assistants entry opens the chat of the one used last: remember this one (a preference, not a secret).
  useEffect(() => {
    if (id) void saveLastAssistant(id);
  }, [id]);

  // Start / Stop / Restart are plumbing, kept under Advanced. Stop and Restart end a turn in progress, so they ask first.
  const startCoordinator = () => {
    const agent = data ? coordinatorStartAgent(data.agents) : null;
    if (data && agent) write.mutate({ kind: 'coordinator', id: data.assistant.id, agent });
  };
  const confirmStop = (restart: boolean) => {
    if (!data) return;
    Alert.alert(
      restart ? 'Restart the Coordinator?' : 'Stop the Coordinator?',
      restart
        ? 'It stops and starts again on your Mac. A turn in progress is interrupted; the conversation continues.'
        : 'It stops on your Mac and its terminal closes. A turn in progress is interrupted; the conversation stays and sending again starts it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: restart ? 'Restart' : 'Stop',
          style: restart ? 'default' : 'destructive',
          onPress: () => write.mutate({ kind: 'coordinatorStop', id: data.assistant.id }, { onSuccess: restart ? startCoordinator : undefined }),
        },
      ],
    );
  };

  const convo = data ? conversationState(data.coordinator, tree.data?.workspaces ?? [], instance ?? '') : null;
  const startingConvo = convo?.kind === 'starting';
  const refetchDetail = detail.refetch;
  // The Coordinator's launch is the Mac daemon's: look again until it says ready or failed.
  useEffect(() => {
    if (!startingConvo) return;
    const timer = setInterval(() => void refetchDetail(), 3000);
    return () => clearInterval(timer);
  }, [startingConvo, refetchDetail]);

  // A tap on an Assistant is a tap on a contact: once its Coordinator is live the conversation opens at once (`manage=1` keeps this page).
  // …but not before Herdr has named the pane's agent: until then the route would be the Terminal, not the Chat.
  // The Chat carries the Assistant's id (its page stays one tap away) and name (the pane's own title is the launch prompt).
  const conversationRoute = (pane: TreePane, host: string) => {
    const route = paneRoute(pane, host, chatServed);
    return route.pathname === '/chat/[paneId]' ? { ...route, params: { ...route.params, assistant: id, title: data?.assistant.name || route.params.title } } : route;
  };
  const readyPane = data && instance ? adoptableCoordinatorPane(data.coordinator, tree.data?.workspaces ?? [], instance, chatServed) : null;
  const direct = manageParam !== '1' ? readyPane : null;
  const directPane = direct?.paneId ?? '';
  useEffect(() => {
    if (!direct || !instance || !id) return;
    router.replace(conversationRoute(direct, instance));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directPane, instance, chatServed]);

  // …and while it is not running, the same tap opens its chat window: the previous conversation (read-only, from the Mac's
  // catalog) with the composer on — a send starts the Coordinator and carries on in the same page (`/chat/assistant-<id>`).
  const historyServed = caps?.personalAgentCoordinatorChat === true;
  const windowServed = historyServed && chatServed && !!instance;
  const windowOpens = manageParam !== '1' && windowServed && convo?.kind === 'idle';
  const windowRoute = () => ({ pathname: '/chat/[paneId]' as const, params: { paneId: coordinatorChatId(id ?? ''), instance: instance ?? '', title: data?.assistant.name ?? '', assistant: id ?? '' } });
  useEffect(() => {
    if (!windowOpens || !id) return;
    router.replace(windowRoute());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowOpens, instance, id]);

  const buckets = data ? taskBuckets(data.tasks, new Set(reasons.keys())) : null;
  const pending = data?.approvals.filter((a) => a.state === 'pending') ?? [];
  const opener = (task: AssistantTask) => {
    const pane = instance ? openableRun(task.runs, tree.data?.workspaces ?? [], instance) : null;
    return pane && instance ? () => router.push(paneRoute(pane, instance, chatServed)) : null;
  };

  return (
    <Screen back title={data?.assistant.name ?? 'Assistant'} subtitle={'Assistant'}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <KeyboardInset>
          {detail.isLoading ? (
            <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
          ) : !data || !buckets ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this Assistant</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(detail.error)}</Text>
            </YStack>
          ) : (
            <ScrollView
              flex={1}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 32, gap: 10 }}
              refreshControl={pullRefresh(detail.isRefetching, () => void detail.refetch())}>
              {data.assistant.description ? <Text color={colors.textMuted} fontSize={13} lineHeight={19}>{data.assistant.description}</Text> : null}
              {convo ? (
                <Card padded gap={10}>
                  <SectionLabel inset={false}>Conversation</SectionLabel>
                  {convo.kind === 'open' && instance ? (
                    <PillButton label="Open conversation" onPress={() => router.push(conversationRoute(convo.pane, instance))} />
                  ) : convo.kind === 'starting' ? (
                    <Text color={colors.textMuted} fontSize={13} lineHeight={19}>Starting the Coordinator on your Mac…</Text>
                  ) : convo.kind === 'elsewhere' ? (
                    <Text color={colors.textMuted} fontSize={13} lineHeight={19}>Its conversation runs somewhere this phone cannot reach (another Herdr session, or a closed pane). Restart it on your Mac.</Text>
                  ) : convo.kind === 'idle' && windowServed ? (
                    <PillButton label="Open conversation" onPress={() => router.push(windowRoute())} />
                  ) : convo.kind === 'idle' && manage ? (
                    <>
                      <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
                        {convo.failed ? 'The Coordinator could not start. Try again.' : `${data.assistant.name} is not running. Start it on your Mac to talk.`}
                      </Text>
                      <PillButton
                        label="Start conversation"
                        disabled={busy || data.assistant.status !== 'active' || data.agents.length === 0}
                        onPress={startCoordinator}
                      />
                    </>
                  ) : (
                    <Text color={colors.textMuted} fontSize={13} lineHeight={19}>Start its conversation on your Mac.</Text>
                  )}
                  {nap !== undefined ? (
                    <Text color={colors.textSubtle} fontSize={12} lineHeight={17}>
                      {nap === 0 ? 'Stays awake until stopped.' : `Goes to sleep after ${nap === 60 ? 'an hour' : `${nap} minutes`} without activity; a message wakes it.`}
                    </Text>
                  ) : null}
                </Card>
              ) : null}
              {manage ? (
                <XStack gap={8} flexWrap="wrap">
                  <PillButton
                    label={data.assistant.status !== 'active' ? 'Resume' : 'Pause'}
                    tone="soft"
                    compact
                    disabled={busy}
                    onPress={() => write.mutate({ kind: 'pause', id: data.assistant.id, paused: data.assistant.status === 'active', revision: data.assistant.revision })}
                  />
                  <PillButton label="Rename" tone="soft" compact onPress={() => { setName(data.assistant.name); setRenaming((open) => !open); }} />
                  {settingsServed ? (
                    <PillButton label="Settings" tone="soft" compact onPress={() => router.push({ pathname: '/assistants/settings/[id]', params: { id: data.assistant.id } })} />
                  ) : null}
                  {data.assistant.primary === true && bootstrap.data?.capabilities.personalAgentGroups === true ? (
                    <PillButton label="Groups" tone="soft" compact onPress={() => router.push('/assistants/groups')} />
                  ) : null}
                </XStack>
              ) : null}
              {data.assistant.status !== 'active' ? <Text color={colors.attention} fontSize={12.5} lineHeight={18}>Paused — it will not start new work until you resume it.</Text> : null}
              {renaming ? (
                <Card padded gap={10}>
                  <Field value={name} onChange={setName} placeholder="Name" />
                  <XStack gap={8}>
                    <PillButton
                      label="Save"
                      compact
                      disabled={busy || name.trim() === '' || name.trim() === data.assistant.name}
                      onPress={() => write.mutate({ kind: 'rename', id: data.assistant.id, name: name.trim(), revision: data.assistant.revision }, { onSuccess: () => setRenaming(false) })}
                    />
                    <PillButton label="Cancel" tone="soft" compact onPress={() => setRenaming(false)} />
                  </XStack>
                </Card>
              ) : null}
              {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(write.error)}</Text> : null}

              {served ? (
                <XStack gap={8}>
                  <PillButton label="Activity history" tone="soft" compact onPress={() => router.push({ pathname: '/assistants/activity/[id]', params: { id: data.assistant.id } })} />
                </XStack>
              ) : null}

              {pending.length + buckets.needsYou.length > 0 ? <SectionLabel inset={false}>Needs you</SectionLabel> : null}
              {pending.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  now={now}
                  busy={busy}
                  canDecide={canDecide}
                  onDecide={(approve) => write.mutate({ kind: 'decide', id: approval.id, actionHash: approval.actionHash, approve })}
                />
              ))}
              {buckets.needsYou.map((task) => (
                <TaskCard key={task.id} task={task} reason={reasons.get(task.id)} now={now} manage={manage} busy={busy} onOpen={opener(task)} onAction={(action) => write.mutate({ kind: 'task', id: task.id, action, revision: task.revision })} />
              ))}

              {buckets.live.length > 0 ? <SectionLabel inset={false}>Tasks</SectionLabel> : null}
              {buckets.live.map((task) => (
                <TaskCard key={task.id} task={task} reason={reasons.get(task.id)} now={now} manage={manage} busy={busy} onOpen={opener(task)} onAction={(action) => write.mutate({ kind: 'task', id: task.id, action, revision: task.revision })} />
              ))}

              {buckets.done.length > 0 ? (
                <XStack alignItems="center" justifyContent="space-between">
                  <SectionLabel inset={false}>{`Done · ${buckets.done.length}`}</SectionLabel>
                  <PillButton label={showDone ? 'Hide' : 'Show'} tone="soft" compact onPress={() => setShowDone((open) => !open)} />
                </XStack>
              ) : null}
              {showDone
                ? buckets.done.slice(0, DONE_SHOWN).map((task) => (
                    <TaskCard key={task.id} task={task} reason={reasons.get(task.id)} now={now} manage={manage} busy={busy} onOpen={opener(task)} onAction={(action) => write.mutate({ kind: 'task', id: task.id, action, revision: task.revision })} />
                  ))
                : null}

              {pending.length + buckets.needsYou.length + buckets.live.length + buckets.done.length === 0 ? (
                <YStack alignItems="center" gap="$2" padding="$6">
                  <Text color={colors.text} fontSize={16} fontWeight="700">Nothing yet</Text>
                  <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
                    Ask it in the chat, or hand it a task on your computer.
                  </Text>
                </YStack>
              ) : null}

              {manage ? (
                <>
                  <XStack>
                    <PillButton label={advanced ? 'Hide advanced' : 'Advanced'} tone="soft" compact onPress={() => setAdvanced((open) => !open)} />
                  </XStack>
                  {advanced ? (
                    <Card padded gap={10}>
                      <SectionLabel inset={false}>Coordinator</SectionLabel>
                      <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>
                        {`State: ${data.coordinator.state === 'none' ? 'not started' : data.coordinator.state}${data.coordinator.stopReason === 'idle' ? ' (slept when idle)' : ''}. It starts by itself when you send a message and sleeps when quiet; use these only to force it.`}
                      </Text>
                      <XStack gap={8} flexWrap="wrap">
                        {data.coordinator.state === 'none' || data.coordinator.state === 'stopped' || data.coordinator.state === 'failed' ? (
                          <PillButton label="Start" compact disabled={busy || data.assistant.status !== 'active' || data.agents.length === 0} onPress={startCoordinator} />
                        ) : null}
                        {data.coordinator.state === 'starting' || data.coordinator.state === 'ready' ? (
                          <>
                            <PillButton label="Restart" tone="soft" compact disabled={busy || data.coordinator.state === 'starting'} onPress={() => confirmStop(true)} />
                            <PillButton label="Stop" tone="soft" compact disabled={busy} onPress={() => confirmStop(false)} />
                          </>
                        ) : null}
                      </XStack>
                    </Card>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </Screen>
  );
}
