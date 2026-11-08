// [INPUT]: the paired Host's Automations list (GET /api/v3/automations, needs `capabilities.automations`; the management
//          buttons need `capabilities.automationsManage`) and a clock.
// [OUTPUT]: Automations — a stack screen (Home's bolt button, or a tap on an automation notification) listing the Mac's
//           automations, what needs you first: one card per automation with its state, schedule, agent, the newest run in
//           words and when it runs next, under a scheduler-health line. Pull to refresh. With management: New, Let an Agent
//           Draft, Mark all seen, Start Scheduler, and a tap on a card opens its detail.
// [POS]: Second client of the desktop Automations page. The plugin on the Mac owns scheduling, runs, approval and every
//        validation; the phone only asks (create is always a draft, approval is its own button on the detail) and shows the
//        fresh list each answer carries. Against a Host without `automationsManage` the screen stays the read-only list.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { Reveal } from '@/components/motion';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Card } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';

import type { AutomationItem } from '@/contracts/host-v3';
import { automationActionMessage, automationsFailureMessage, automationTone, nextLine, runLine, sortAutomations, stateLine, type AutomationTone } from '@/features/host/automations-model';
import { useAutomationWrite, useBootstrapV3, useHostAutomations } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { IconPlus, IconSparkles } from '@/theme/glyphs';
import { colors, spacing, themed } from '@/theme/tokens';

const TONE_COLORS: Record<AutomationTone, string> = themed(() => ({
  danger: colors.danger,
  attention: colors.attention,
  accent: colors.accent,
  success: colors.success,
  muted: colors.textSubtle,
}));

function AutomationCard({ item, now }: { item: AutomationItem; now: number }) {
  const tone = automationTone(item);
  const next = nextLine(item, now);
  return (
    <Card padded gap={6}>
      <XStack alignItems="center" gap={8}>
        <YStack width={8} height={8} borderRadius={4} backgroundColor={TONE_COLORS[tone]} />
        <Text flex={1} color={colors.text} fontSize={15} fontWeight="700" numberOfLines={1}>{item.name}</Text>
        {item.unread ? <Text color={colors.accentText} fontSize={11} fontWeight="700">NEW</Text> : null}
      </XStack>
      <Text color={colors.textMuted} fontSize={12.5} numberOfLines={1}>{stateLine(item)}</Text>
      <XStack justifyContent="space-between" gap={8}>
        <Text color={tone === 'danger' ? colors.danger : colors.textSubtle} fontSize={12.5}>{runLine(item, now)}</Text>
        {next ? <Text color={colors.textSubtle} fontSize={12.5}>{next}</Text> : null}
      </XStack>
    </Card>
  );
}

export default function AutomationsScreen() {
  const router = useRouter();
  const automations = useHostAutomations(true);
  const bootstrap = useBootstrapV3();
  const write = useAutomationWrite();
  const now = useNow();
  const manage = bootstrap.data?.capabilities.automationsManage === true;
  const items = automations.data ? sortAutomations(automations.data.automations) : [];
  const anyUnread = items.some((item) => item.unread);

  return (
    <Screen back title="Automations">
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        {automations.isLoading ? (
          <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
        ) : (
          <ScrollView
            flex={1}
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, flexGrow: 1 }}
            refreshControl={pullRefresh(automations.isRefetching, () => void automations.refetch())}>
            {!automations.data ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read automations</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{automationsFailureMessage(automations.error)}</Text>
              </YStack>
            ) : (
              <>
                {manage ? (
                  <XStack gap={8} paddingBottom={12} flexWrap="wrap">
                    <PillButton label="New" icon={IconPlus} compact onPress={() => router.push('/automations/edit')} />
                    <PillButton label="Let an Agent Draft" icon={IconSparkles} tone="soft" compact onPress={() => router.push('/automations/ask')} />
                    {anyUnread ? <PillButton label="Mark all seen" tone="soft" compact disabled={write.isPending} onPress={() => write.mutate({ kind: 'seen', target: { all: true } })} /> : null}
                  </XStack>
                ) : null}
                {!automations.data.scheduler && items.some((i) => i.state === 'active') ? (
                  <YStack gap={8} paddingBottom={12}>
                    <Text color={colors.attention} fontSize={12.5} lineHeight={18}>
                      The scheduler is not running on your computer, so nothing fires on schedule.
                    </Text>
                    {manage ? <PillButton label="Start Scheduler" tone="soft" compact disabled={write.isPending} onPress={() => write.mutate({ kind: 'scheduler' })} /> : null}
                  </YStack>
                ) : null}
                {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18} paddingBottom={12}>{automationActionMessage(write.error)}</Text> : null}
                {items.length === 0 ? (
                  <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                    <Text color={colors.text} fontSize={16} fontWeight="700">No automations yet</Text>
                    <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
                      {manage ? 'Create one here, or ask an Agent to draft it for you to approve.' : 'Ask an Agent on your computer to draft one, then approve it there.'}
                    </Text>
                  </YStack>
                ) : (
                  items.map((item, index) => (
                    <Reveal key={item.name} index={index} style={{ paddingBottom: 12 }}>
                      {manage ? (
                        <Tap role="button" accessibilityLabel={`Open ${item.name}`} onPress={() => router.push({ pathname: '/automations/[name]', params: { name: item.name } })}>
                          <AutomationCard item={item} now={now} />
                        </Tap>
                      ) : (
                        <AutomationCard item={item} now={now} />
                      )}
                    </Reveal>
                  ))
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}
