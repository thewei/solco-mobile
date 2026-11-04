// [INPUT]: a Goal id (plan + its ledger) or an Assistant id (its latest facts), both read-only from the Mac (`personalAgentPlans`).
// [OUTPUT]: RoutinesList — the Assistant's scheduled work (drafts wait for the person's approval card above; enabled ones show next/last run);
//           GoalPlanBlock — the plan under a Goal card: criteria, the milestone list with the core's derived state, the next action;
//           FactsStrip — the latest ledger lines, labelled "Solco" because they are the system's record, not the Assistant talking.
// [POS]: U3's phone surface. Never decides or invents progress (progress-model words only) and hides itself when the Host or the
//        Goal has no plan.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Text, XStack, YStack } from 'tamagui';

import { Card, SectionLabel } from '@/components/section';
import type { Fact, Routine } from '@/contracts/host-v3';
import { agoShort } from '@/features/host/pane-model';
import { factLabel, factTone, milestoneLabel, milestoneTone, planLine, routineLabel, routineLine, routineTone, type Tone } from '@/features/host/progress-model';
import { useAssistantFacts, useAssistantRoutines, useGoalPlan } from '@/features/host/queries-v3';
import { colors } from '@/theme/tokens';

const TONE: Record<Tone, string> = { ok: colors.success, warn: colors.attention, bad: colors.danger, work: colors.accent, muted: colors.textSubtle };

function Chip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Text color={TONE[tone]} fontSize={11.5} fontWeight="700">
      {label}
    </Text>
  );
}

export function GoalPlanBlock({ goalId, served }: { goalId: string; served: boolean }) {
  const { data: res } = useGoalPlan(goalId, served);
  if (!res) return null;
  const { plan } = res;
  return (
    <YStack gap={6} paddingTop={4}>
      <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>{planLine(plan)}</Text>
      {plan.successCriteria ? <Text color={colors.text} fontSize={13} lineHeight={19}>{`Done when: ${plan.successCriteria}`}</Text> : null}
      {plan.milestones.map((m) => (
        <XStack key={m.id} gap={8} alignItems="flex-start" justifyContent="space-between">
          <Text color={colors.text} fontSize={13} lineHeight={19} flex={1} numberOfLines={2}>{m.title}</Text>
          <Chip label={milestoneLabel(m)} tone={milestoneTone(m)} />
        </XStack>
      ))}
      {plan.nextAction ? <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>{`Next: ${plan.nextAction}`}</Text> : null}
    </YStack>
  );
}

export function FactsStrip({ assistantId, served, now }: { assistantId: string; served: boolean; now: number }) {
  const { data: facts } = useAssistantFacts(assistantId, served);
  if (!facts || facts.length === 0) return null;
  return (
    <Card padded gap={8}>
      <Text color={colors.textSubtle} fontSize={11.5} fontWeight="700" letterSpacing={0.4}>SOLCO RECORD</Text>
      {facts.map((f: Fact) => (
        <XStack key={f.id} gap={8} alignItems="flex-start">
          <YStack width={78}>
            <Chip label={factLabel(f)} tone={factTone(f)} />
          </YStack>
          <Text color={colors.text} fontSize={13} lineHeight={19} flex={1} numberOfLines={3}>{f.text}</Text>
          <Text color={colors.textSubtle} fontSize={11.5}>{agoShort(f.createdAt, now)}</Text>
        </XStack>
      ))}
    </Card>
  );
}

export function RoutinesList({ assistantId, served, now }: { assistantId: string; served: boolean; now: number }) {
  const { data: routines } = useAssistantRoutines(assistantId, served);
  const shown = (routines ?? []).filter((r: Routine) => r.state !== 'cancelled');
  if (shown.length === 0) return null;
  return (
    <>
      <SectionLabel inset={false}>Routines</SectionLabel>
      {shown.map((r: Routine) => (
        <Card key={r.name} padded gap={6}>
          <XStack gap={8} alignItems="flex-start" justifyContent="space-between">
            <Text color={colors.text} fontSize={14.5} fontWeight="700" flex={1} numberOfLines={2}>{r.name}</Text>
            <Chip label={routineLabel(r)} tone={routineTone(r)} />
          </XStack>
          {r.rationale ? <Text color={colors.text} fontSize={13} lineHeight={19} numberOfLines={3}>{r.rationale}</Text> : null}
          <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>{routineLine(r)}</Text>
          {r.state === 'active' && !r.paused && r.next ? <Text color={colors.textMuted} fontSize={12.5}>{`Next run ${new Date(r.next).toLocaleString()}`}</Text> : null}
          {r.lastState && r.lastAt ? <Text color={colors.textMuted} fontSize={12.5}>{`Last run ${r.lastState} · ${agoShort(r.lastAt, now)}`}</Text> : null}
        </Card>
      ))}
    </>
  );
}
