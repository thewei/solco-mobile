// [INPUT]: an optional route param `name` (edit that automation; absent = a new one), the automation's detail, the Mac's list
//          (agent choices under the plugin's own ids) and the tree (known folders).
// [OUTPUT]: AutomationEditScreen — the New / Edit form: name (new only), schedule (presets or the five cron fields), repository
//           (typed, or one of the folders the Mac already knows), agent, model, run-as, starts-in, overlap, timeouts, rationale
//           and prompt. Save sends one write; a new automation is always a draft that is approved on its detail.
// [POS]: The phone's counterpart of the desktop's New / Edit sheet. Only presence and shape are checked here (`formProblem`);
//        cron, repository, model and every limit are judged by the plugin, whose refusal sentence is shown as it came.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { KeyboardInset } from '@/components/keyboard-inset';
import { Chip } from '@/components/launch-pickers';
import { PillButton } from '@/components/pill-button';
import { Screen } from '@/components/screen';
import { Field } from '@/components/text-field';
import { ListSkeleton } from '@/components/skeletons';

import {
  automationActionMessage,
  CRON_PRESETS,
  emptyForm,
  fieldsOfForm,
  formFromDetail,
  formProblem,
  type AutomationForm,
} from '@/features/host/automations-model';
import { folderName, knownFolders } from '@/features/host/launch-model';
import { useAutomationDetail, useAutomationWrite, useBootstrapV3, useHostAutomations, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { colors, spacing } from '@/theme/tokens';

function Label({ children }: { children: string }) {
  return <Text color={colors.textSubtle} fontSize={12} fontWeight="700" letterSpacing={0.6} paddingTop={16} paddingBottom={6}>{children.toUpperCase()}</Text>;
}

export default function AutomationEditScreen() {
  const router = useRouter();
  const { name: editing } = useLocalSearchParams<{ name?: string }>();
  const isNew = !editing;
  const bootstrap = useBootstrapV3();
  const manage = bootstrap.data?.capabilities.automationsManage === true;
  const detail = useAutomationDetail(editing ?? '', manage && !isNew);
  const list = useHostAutomations(manage);
  const write = useAutomationWrite();
  const { instance } = useHostInstance();
  const tree = useTreeV3(instance);

  const agents = useMemo(() => list.data?.agents ?? [], [list.data]);
  const [form, setForm] = useState<AutomationForm>(() => emptyForm());
  const [custom, setCustom] = useState(false);
  const [tried, setTried] = useState(false);
  const loaded = useRef(false);
  const [ready, setReady] = useState(false);

  // A new form starts on the first agent the Mac offers; an edit starts from the automation as the plugin holds it — once.
  useEffect(() => {
    if (loaded.current) return;
    if (isNew) {
      if (agents.length === 0) return;
      loaded.current = true;
      setForm((f) => ({ ...f, agent: agents[0]!.id }));
      setReady(true);
    } else if (detail.data) {
      loaded.current = true;
      const next = formFromDetail(detail.data);
      setForm(next);
      setCustom(!CRON_PRESETS.some((p) => p.cron !== '' && p.cron === next.cron));
      setReady(true);
    }
  }, [isNew, agents, detail.data]);

  const set = <K extends keyof AutomationForm>(key: K, value: AutomationForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const folders = useMemo(() => knownFolders(tree.data?.workspaces ?? []).slice(0, 8), [tree.data]);
  const problem = formProblem(form, isNew);
  const busy = write.isPending;

  const save = () => {
    setTried(true);
    if (problem) return;
    const name = isNew ? form.name.trim() : editing!;
    const fields = fieldsOfForm(form);
    write.mutate(
      isNew ? { kind: 'create', name, fields } : { kind: 'save', name, fields },
      { onSuccess: () => (isNew ? router.replace({ pathname: '/automations/[name]', params: { name } }) : router.back()) },
    );
  };

  // A new form with no agents on offer is still shown (it says so); an edit waits for the plugin's own values.
  const waiting = !ready && (isNew ? list.isLoading : detail.isLoading || detail.data !== undefined);

  return (
    <Screen back title={isNew ? 'New automation' : 'Edit automation'}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        {!manage ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text color={colors.text} fontSize={16} fontWeight="700">Not available</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center">Update Solco on your computer to manage automations from here.</Text>
          </YStack>
        ) : waiting ? (
          <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
        ) : !isNew && !detail.data ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this automation</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center">{automationActionMessage(detail.error)}</Text>
          </YStack>
        ) : (
          <KeyboardInset>
            <ScrollView flex={1} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {isNew ? (
                <>
                  <Label>Name</Label>
                  <Field value={form.name} onChange={(t) => set('name', t)} placeholder="nightly-ci-triage" />
                </>
              ) : null}

              <Label>Schedule</Label>
              <XStack gap={8} flexWrap="wrap">
                {CRON_PRESETS.map((preset) => {
                  const isCustom = preset.cron === '';
                  const active = isCustom ? custom : !custom && form.cron === preset.cron;
                  return (
                    <Chip
                      key={preset.label}
                      label={preset.label}
                      active={active}
                      onPress={() => {
                        setCustom(isCustom);
                        if (!isCustom) set('cron', preset.cron);
                      }}
                    />
                  );
                })}
              </XStack>
              {custom ? (
                <YStack paddingTop={8}>
                  <Field value={form.cron} onChange={(t) => set('cron', t)} placeholder="m h dom mon dow — 0 9 * * 1-5" mono />
                </YStack>
              ) : null}

              <Label>Repository</Label>
              <Field value={form.repo} onChange={(t) => set('repo', t)} placeholder="/Users/me/work/api" mono />
              {folders.length > 0 ? (
                <XStack gap={8} flexWrap="wrap" paddingTop={8}>
                  {folders.map((folder) => <Chip key={folder} label={folderName(folder)} active={form.repo === folder} onPress={() => set('repo', folder)} />)}
                </XStack>
              ) : null}

              <Label>Agent</Label>
              {agents.length === 0 && !form.agent ? (
                <Text color={colors.textSubtle} fontSize={13}>Your computer offers no agent to run this.</Text>
              ) : (
                <XStack gap={8} flexWrap="wrap">
                  {(agents.some((a) => a.id === form.agent) || !form.agent ? agents : [{ id: form.agent, label: form.agent }, ...agents]).map((agent) => (
                    <Chip key={agent.id} label={agent.label} active={form.agent === agent.id} onPress={() => set('agent', agent.id)} />
                  ))}
                </XStack>
              )}
              <YStack paddingTop={8}>
                <Field value={form.model} onChange={(t) => set('model', t)} placeholder="Model (optional)" mono />
              </YStack>

              <Label>Each run</Label>
              <XStack gap={8} flexWrap="wrap">
                <Chip label="Fresh worktree" active={form.workspace === 'worktree'} onPress={() => set('workspace', 'worktree')} />
                <Chip label="Repository root" active={form.workspace === 'root'} onPress={() => set('workspace', 'root')} />
              </XStack>
              <XStack gap={8} flexWrap="wrap" paddingTop={8}>
                <Chip label="Interactive" active={!form.headless} onPress={() => set('headless', false)} />
                <Chip label="Headless" active={form.headless} onPress={() => set('headless', true)} />
              </XStack>
              <XStack gap={8} flexWrap="wrap" paddingTop={8}>
                <Chip label="Skip overlapping run" active={form.onOverlap !== 'queue'} onPress={() => set('onOverlap', 'skip')} />
                <Chip label="Queue it" active={form.onOverlap === 'queue'} onPress={() => set('onOverlap', 'queue')} />
              </XStack>

              <Label>Limits (optional)</Label>
              <XStack gap={8}>
                <YStack flex={1} gap={4}>
                  <Text color={colors.textSubtle} fontSize={11.5}>Timeout, min</Text>
                  <Field value={form.timeoutMinutes} onChange={(t) => set('timeoutMinutes', t)} placeholder="60" keyboardType="number-pad" />
                </YStack>
                <YStack flex={1} gap={4}>
                  <Text color={colors.textSubtle} fontSize={11.5}>Catch-up, min</Text>
                  <Field value={form.catchUpMinutes} onChange={(t) => set('catchUpMinutes', t)} placeholder="0" keyboardType="number-pad" />
                </YStack>
                <YStack flex={1} gap={4}>
                  <Text color={colors.textSubtle} fontSize={11.5}>Cleanup, hours</Text>
                  <Field value={form.cleanupTtlHours} onChange={(t) => set('cleanupTtlHours', t)} placeholder="0" keyboardType="number-pad" />
                </YStack>
              </XStack>

              <Label>Rationale (optional)</Label>
              <Field value={form.rationale} onChange={(t) => set('rationale', t)} placeholder="Goal, inputs, guardrails, cost" multiline />

              <Label>Prompt</Label>
              <Field value={form.prompt} onChange={(t) => set('prompt', t)} placeholder="What the agent should do on every run" multiline />

              {tried && problem ? <Text color={colors.danger} fontSize={12.5} paddingTop={12}>{problem}</Text> : null}
              {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18} paddingTop={12}>{automationActionMessage(write.error)}</Text> : null}
              {isNew ? <Text color={colors.textSubtle} fontSize={12} lineHeight={17} paddingTop={12}>It starts as a draft and does nothing until you approve it.</Text> : null}
            </ScrollView>
            <XStack paddingHorizontal={spacing.screen} paddingVertical={10} gap={8} justifyContent="flex-end">
              <PillButton label="Cancel" tone="soft" onPress={() => router.back()} disabled={busy} />
              <PillButton label={busy ? 'Saving…' : isNew ? 'Create draft' : 'Save'} onPress={save} disabled={busy} />
            </XStack>
          </KeyboardInset>
        )}
      </SafeAreaView>
    </Screen>
  );
}
