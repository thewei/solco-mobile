// [INPUT]: a route param `id` (the Assistant) and its proactivity rules from the Mac.
// [OUTPUT]: BehaviorScreen — whether the Assistant may carry on by itself (one switch) and its quiet hours; reminder spacing and the daily budget keep the Mac's values.
// [POS]: Needs `capabilities.personalAgentProactivity`; saving needs `personalAgentManage`. Mirrors the desktop's Behavior tab. The core
//        enforces every rule (quiet hours and the budget defer, never lose, work; routines you approved are not affected); this
//        form only checks what it sends, and the save is one revision-fenced write — a stale one changes nothing and the Mac's rules are re-read.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { KeyboardInset } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Field } from '@/components/text-field';
import type { Proactivity } from '@/contracts/host-v3';
import { draftOf, inputOf, isDirty, quietLine } from '@/features/host/memory-model';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { useAssistantDetail, useAssistantProactivity, useBootstrapV3, useProactivityWrite } from '@/features/host/queries-v3';
import { colors, spacing } from '@/theme/tokens';

function Note({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'bad' }) {
  return <Text color={tone === 'bad' ? colors.danger : colors.textMuted} fontSize={12.5} lineHeight={18}>{children}</Text>;
}

export default function BehaviorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgentProactivity === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const rules = useAssistantProactivity(id ?? '', served);
  const detail = useAssistantDetail(id ?? '', served);
  const write = useProactivityWrite(id ?? '');
  const data = rules.data;
  return (
    <Screen back title="Behavior" subtitle={detail.data?.assistant.name}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <KeyboardInset>
          {!served && !bootstrap.isLoading ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Behavior is not available</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
            </YStack>
          ) : !data ? (
            rules.isError ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read these rules</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(rules.error)}</Text>
              </YStack>
            ) : (
              <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
            )
          ) : (
            <ScrollView
              flex={1}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 32, gap: 10 }}
              refreshControl={pullRefresh(rules.isRefetching, () => void rules.refetch())}>
              {write.error ? <Note tone="bad">{personalAgentMessage(write.error)}</Note> : null}
              <Form key={data.revision} rules={data} editable={manage} busy={write.isPending} save={write.mutate} />
            </ScrollView>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </Screen>
  );
}

function Form({ rules, editable, busy, save }: { rules: Proactivity; editable: boolean; busy: boolean; save: ReturnType<typeof useProactivityWrite>['mutate'] }) {
  const [draft, setDraft] = useState(() => draftOf(rules));
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const built = inputOf(draft, rules, zone);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const on = draft.level !== 'respond';
  return (
    <>
      <SectionLabel inset={false}>Work on its own</SectionLabel>
      <Card padded gap={10}>
        <Note>Moves approved goals forward and reminds you when one stalls. Off, it acts only when you ask.</Note>
        <XStack>
          <PillButton label={on ? 'On' : 'Off'} compact tone={on ? 'primary' : 'soft'} disabled={!editable} onPress={() => set({ level: on ? 'respond' : rules.level === 'respond' ? 'follow_up' : rules.level })} />
        </XStack>
      </Card>
      <SectionLabel inset={false}>Quiet hours</SectionLabel>
      <Card padded gap={10}>
        <Note>{quietLine(rules)}</Note>
        <XStack>
          <PillButton label={draft.quiet ? 'On' : 'Off'} compact tone={draft.quiet ? 'primary' : 'soft'} disabled={!editable} onPress={() => set({ quiet: !draft.quiet })} />
        </XStack>
        {draft.quiet ? (
          <XStack gap={8}>
            <YStack flex={1}><Field value={draft.start} onChange={(v) => set({ start: v.trim() })} placeholder="From 22:00" /></YStack>
            <YStack flex={1}><Field value={draft.end} onChange={(v) => set({ end: v.trim() })} placeholder="To 08:00" /></YStack>
          </XStack>
        ) : null}
      </Card>
      {!built.ok ? <Note tone="bad">{built.error}</Note> : null}
      {editable ? (
        <XStack>
          <PillButton label="Save" disabled={busy || !built.ok || !isDirty(built.input, rules)} onPress={() => built.ok && save({ input: built.input, revision: rules.revision })} />
        </XStack>
      ) : null}
    </>
  );
}
