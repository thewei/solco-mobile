// [INPUT]: a route param `id` (the Assistant), its page from the Mac (GET /api/v3/personal-agent/assistants/{id}: goals, tasks with
//          runs, approvals, memory), this phone's tree (to find a run's real pane) and a clock.
// [OUTPUT]: AssistantScreen — one Assistant's page (links to its Work style): Conversation (open the Coordinator's real Chat pane; before it exists, a message box — the first Send starts it on an Agent the Mac offers and submits the held text once the pane is ready), Needs You (approvals, finished tasks that ask), Watching (goals), Running,
//           Done and what it remembers; Watch a PR (a goal draft the person then starts), pause/resume, rename.
// [POS]: Second client of the desktop `/assistants` page. Everything on it belongs to this Assistant only (the core isolates
//        goals, tasks, memory and approvals per Assistant). Each action is one exact write with the revision shown; a refusal
//        (stale above all) changes nothing and the page re-reads the Mac's truth. A run opens its Chat/Terminal only when its own
//        Herdr session and pane id are in this phone's tree — never by title. Memory is read-only here.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { ApprovalCard } from '@/components/approval-card';
import { FactsStrip, GoalPlanBlock, RoutinesList } from '@/components/goal-progress';
import { KeyboardInset } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Field } from '@/components/text-field';
import type { AssistantDetail, AssistantGoal, AssistantTask, AssistantTaskAction, TreePane } from '@/contracts/host-v3';
import { agoShort, paneRoute } from '@/features/host/pane-model';
import {
  conversationState,
  goalActions,
  goalLine,
  openableRun,
  parsePrReference,
  personalAgentMessage,
  prWatchCommitment,
  taskActions,
  taskBuckets,
  taskStateLabel,
} from '@/features/host/personal-agent-model';
import { useAssistantDetail, useAssistantInbox, useBootstrapV3, useHostInstance, usePersonalAgentWrite, useTreeV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useNow } from '@/lib/use-now';
import { colors, spacing } from '@/theme/tokens';

const GOAL_LABEL = { approve: 'Start', pause: 'Pause', resume: 'Resume', cancel: 'Cancel' } as const;
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

function GoalCard({ goal, now, manage, busy, plans, onAction }: { goal: AssistantGoal; now: number; plans: boolean; manage: boolean; busy: boolean; onAction: (action: 'approve' | 'pause' | 'resume' | 'cancel') => void }) {
  const actions = manage ? goalActions(goal.state) : [];
  return (
    <Card padded gap={6}>
      <Text color={colors.text} fontSize={14.5} fontWeight="700" numberOfLines={2}>{goal.title}</Text>
      <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>{goalLine(goal, now)}</Text>
      <GoalPlanBlock goalId={goal.id} served={plans} />
      {actions.length > 0 ? (
        <XStack gap={8} flexWrap="wrap">
          {actions.map((action) => (
            <PillButton key={action} label={GOAL_LABEL[action]} tone={action === 'approve' ? 'primary' : 'soft'} compact disabled={busy} onPress={() => onAction(action)} />
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
  const plans = bootstrap.data?.capabilities.personalAgentPlans === true;
  const routinesServed = bootstrap.data?.capabilities.personalAgentRoutines === true;
  const canDecide = bootstrap.data?.capabilities.personalAgentApprove === true;
  const detail = useAssistantDetail(id ?? '', served);
  const inbox = useAssistantInbox(id ?? '', served);
  const reasons = new Map((inbox.data ?? []).flatMap((item) => (item.taskId ? [[item.taskId, item.detail] as const] : [])));
  const write = usePersonalAgentWrite();
  const { client } = useHostV3();
  const { bootstrap: instanceBootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const chatServed = instanceBootstrap.data?.capabilities.chat === true;
  const now = useNow();
  const [watching, setWatching] = useState(false);
  const [reference, setReference] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [agent, setAgent] = useState('');
  // A one-tap first send: launch the Coordinator, then submit the held text to
  // its actual Herdr pane before opening Chat. An uncertain send is returned
  // as a draft; never auto-retry a command that might already have arrived.
  const [first, setFirst] = useState('');
  const [held, setHeld] = useState('');
  const [uncertainDraft, setUncertainDraft] = useState('');
  const sendingFirst = useRef(false);
  const handoffNavigation = useRef(false);
  const data: AssistantDetail | undefined = detail.data;
  const busy = write.isPending;
  const pr = parsePrReference(reference);

  const watch = () => {
    if (!data || !pr) return;
    write.mutate(
      { kind: 'draft', assistantId: data.assistant.id, title: `Watch ${pr.repo}#${pr.number}`, objective: 'Tell me when it changes', commitments: [prWatchCommitment(pr)] },
      { onSuccess: () => { setWatching(false); setReference(''); } },
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
  const conversationRoute = (pane: TreePane, host: string, draft = '') => {
    const route = paneRoute(pane, host, chatServed);
    return route.pathname === '/chat/[paneId]' ? { ...route, params: { ...route.params, assistant: id, title: data?.assistant.name || route.params.title, ...(draft ? { draft } : {}) } } : route;
  };
  const readyPane = convo?.kind === 'open' && instance && (convo.pane.agent || !chatServed) ? convo.pane : null;
  const direct = manageParam !== '1' ? readyPane : null;
  const directPane = direct?.paneId ?? '';
  const readyPaneId = readyPane?.paneId ?? '';
  useEffect(() => {
    if (!direct || !instance || !id || held || uncertainDraft || sendingFirst.current || handoffNavigation.current) return;
    router.replace(conversationRoute(direct, instance));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directPane, instance, chatServed, held, uncertainDraft]);

  // If Coordinator startup had an ambiguous transport error, retain the
  // original message as a draft instead of auto-sending it on a late start.
  useEffect(() => {
    if (!uncertainDraft || !readyPane || !instance || !chatServed || handoffNavigation.current) return;
    handoffNavigation.current = true;
    router.replace(conversationRoute(readyPane, instance, uncertainDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uncertainDraft, readyPaneId, instance, chatServed]);

  // The first tap is the actual send, not just "start and prefill". Wait for
  // an addressable Agent pane; use the exact same Host Chat API as ChatScreen.
  useEffect(() => {
    if (!held || !readyPaneId || !instance || !client || sendingFirst.current) return;
    if (!chatServed) return; // Do not claim success without a Chat-capable Host.
    sendingFirst.current = true;
    const text = held;
    void client.sendChat(instance, readyPaneId, { text }).then(
      () => {
        handoffNavigation.current = true;
        setHeld('');
        if (readyPane) router.replace(conversationRoute(readyPane, instance));
      },
      () => {
        // A broken connection may have dropped only the acknowledgement.
        // Hand back the text as a draft; never submit it a second time here.
        handoffNavigation.current = true;
        setHeld('');
        if (readyPane) router.replace(conversationRoute(readyPane, instance, text));
        else setFirst(text);
      },
    ).finally(() => { sendingFirst.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, readyPaneId, instance, client, chatServed]);

  // A launch that failed gives the first message back to the box.
  const launchFailed = convo?.kind === 'idle' && convo.failed;
  useEffect(() => {
    if (launchFailed && held) {
      setFirst(held);
      setHeld('');
    }
  }, [launchFailed, held]);

  const buckets = data ? taskBuckets(data.tasks, new Set(reasons.keys())) : null;
  const goals = data?.goals.filter((g) => g.state !== 'completed' && g.state !== 'cancelled') ?? [];
  const pending = data?.approvals.filter((a) => a.state === 'pending') ?? [];
  const opener = (task: AssistantTask) => {
    const pane = instance ? openableRun(task.runs, tree.data?.workspaces ?? [], instance) : null;
    return pane && instance ? () => router.push(paneRoute(pane, instance, chatServed)) : null;
  };

  return (
    <>
      <Stack.Screen options={{ title: data?.assistant.name ?? 'Assistant' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
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
                  ) : convo.kind === 'idle' && manage ? (
                    <>
                      <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
                        {convo.failed ? 'The Coordinator could not start. Your message is kept — pick an Agent and send again.' : `Say what you need. ${data.assistant.name} starts on your Mac when you send.`}
                      </Text>
                      {data.agents.length > 0 ? (
                        <XStack gap={8} flexWrap="wrap">
                          {data.agents.map((kind, index) => (
                            <PillButton
                              key={kind.id}
                              label={kind.label}
                              compact
                              tone={(agent === '' ? index === 0 : agent === kind.id) ? 'primary' : 'soft'}
                              onPress={() => setAgent(kind.id)}
                            />
                          ))}
                        </XStack>
                      ) : null}
                      <Field value={first} onChange={setFirst} multiline placeholder={`Message ${data.assistant.name}`} />
                      <PillButton
                        label="Send"
                        disabled={busy || !chatServed || first.trim() === '' || data.assistant.status !== 'active' || data.agents.length === 0}
                        onPress={() => {
                          const text = first.trim();
                          setHeld(text);
                          setUncertainDraft('');
                          setFirst('');
                          write.mutate(
                            { kind: 'coordinator', id: data.assistant.id, agent: data.agents.some((a) => a.id === agent) ? agent : (data.agents[0]?.id ?? '') },
                            { onError: () => { setFirst(text); setHeld(''); setUncertainDraft(text); } },
                          );
                        }}
                      />
                    </>
                  ) : (
                    <Text color={colors.textMuted} fontSize={13} lineHeight={19}>Start its conversation on your Mac.</Text>
                  )}
                </Card>
              ) : null}
              {manage ? (
                <XStack gap={8} flexWrap="wrap">
                  <PillButton label="Watch a PR" compact disabled={data.assistant.status !== 'active'} onPress={() => setWatching((open) => !open)} />
                  <PillButton
                    label={data.assistant.status !== 'active' ? 'Resume' : 'Pause'}
                    tone="soft"
                    compact
                    disabled={busy}
                    onPress={() => write.mutate({ kind: 'pause', id: data.assistant.id, paused: data.assistant.status === 'active', revision: data.assistant.revision })}
                  />
                  <PillButton label="Rename" tone="soft" compact onPress={() => { setName(data.assistant.name); setRenaming((open) => !open); }} />
                  {bootstrap.data?.capabilities.personalAgentPersona === true ? (
                    <PillButton label="Work style" tone="soft" compact onPress={() => router.push({ pathname: '/assistants/style/[id]', params: { id: data.assistant.id } })} />
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
              {watching ? (
                <Card padded gap={10}>
                  <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
                    Checks the pull request on a timer without a model; only when it changes does one read-only Agent look at it. It starts only after you press Start.
                  </Text>
                  <Field value={reference} onChange={setReference} placeholder="owner/repo#12 or a github.com pull-request URL" />
                  <XStack gap={8}>
                    <PillButton label="Create draft" compact disabled={busy || !pr} onPress={watch} />
                    <PillButton label="Cancel" tone="soft" compact onPress={() => setWatching(false)} />
                  </XStack>
                </Card>
              ) : null}
              {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(write.error)}</Text> : null}

              {plans ? <FactsStrip assistantId={id ?? ''} served={plans} now={now} /> : null}

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

              {goals.length > 0 ? <SectionLabel inset={false}>Watching</SectionLabel> : null}
              {goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} plans={plans} now={now} manage={manage} busy={busy} onAction={(action) => write.mutate({ kind: 'goal', id: goal.id, action, revision: goal.revision })} />
              ))}

              {routinesServed ? <RoutinesList assistantId={id ?? ''} served={routinesServed} now={now} /> : null}

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

              {bootstrap.data?.capabilities.personalAgentMemory === true || bootstrap.data?.capabilities.personalAgentProactivity === true ? (
                <XStack gap={8} flexWrap="wrap">
                  {bootstrap.data?.capabilities.personalAgentMemory === true ? (
                    <PillButton label="Memory" tone="soft" compact onPress={() => router.push({ pathname: '/assistants/memory/[id]', params: { id: data.assistant.id } })} />
                  ) : null}
                  {bootstrap.data?.capabilities.personalAgentProactivity === true ? (
                    <PillButton label="Behavior" tone="soft" compact onPress={() => router.push({ pathname: '/assistants/behavior/[id]', params: { id: data.assistant.id } })} />
                  ) : null}
                </XStack>
              ) : null}
              {data.memory.length > 0 ? <SectionLabel inset={false}>Remembers</SectionLabel> : null}
              {data.memory.length > 0 ? (
                <Card padded gap={10}>
                  {data.memory.map((item) => (
                    <Text key={item.id} color={colors.text} fontSize={13.5} lineHeight={20} selectable>{item.content}</Text>
                  ))}
                </Card>
              ) : null}

              {pending.length + buckets.needsYou.length + goals.length + buckets.live.length + buckets.done.length === 0 ? (
                <YStack alignItems="center" gap="$2" padding="$6">
                  <Text color={colors.text} fontSize={16} fontWeight="700">Nothing yet</Text>
                  <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
                    {manage ? 'Ask it to watch a pull request, or hand it a task on your computer.' : 'Hand it a task on your computer.'}
                  </Text>
                </YStack>
              ) : null}
            </ScrollView>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </>
  );
}
