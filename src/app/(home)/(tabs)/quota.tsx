// [INPUT]: the paired Host's read-only quota page (GET /api/v3/quota, needs `capabilities.quota`) and a clock.
// [OUTPUT]: Quota — the bottom-bar tab's agent-quota page: the shared ProjectHeader (fixed title) over a
//           summary row (tightest limit, next reset, source health), one card per enabled provider
//           (windows with level-toned bars, used/left, reset countdown, pace warning) and compact rows
//           for the providers that are off or have nothing to read. Pull to refresh forces past the
//           Host's reuse window.
// [POS]: Read-only second client of the desktop /quota page. The Mac decides what may be read
//        (its own switches and consents); the phone has no credential path and changes nothing.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { ProjectHeader } from '@/components/project-header';
import { Fade, ProgressBar, Reveal } from '@/components/motion';
import { pullRefresh } from '@/components/pull-refresh';
import { Card, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';

import type { QuotaProvider, QuotaWindow } from '@/contracts/host-v3';
import { formatInMs, levelOf, paceOf, providerHeadline, providerIsUsable, quotaProviderName, quotaSummary, usedLeftLine } from '@/features/host/quota-model';
import { useHostInstance, useHostQuota } from '@/features/host/queries-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { useNow } from '@/lib/use-now';
import { colors, row, spacing } from '@/theme/tokens';

const LEVEL_COLORS = { ok: colors.accent, warn: colors.attention, bad: colors.danger } as const;

function WindowRow({ window: w, now }: { window: QuotaWindow; now: number }) {
  const tone = LEVEL_COLORS[levelOf(w.usedPct)];
  const pace = paceOf(w, now);
  const resetsIn = w.resetsAtMs ? formatInMs(w.resetsAtMs - now) : null;
  return (
    <YStack gap="$1.5">
      <XStack justifyContent="space-between">
        <Text color={colors.text} fontSize={13} fontWeight="600">{w.name}</Text>
        <Text color={colors.textMuted} fontSize={12}>{usedLeftLine(w)}</Text>
      </XStack>
      <ProgressBar pct={w.usedPct} color={tone} />
      <XStack justifyContent="space-between">
        <Text fontSize={11.5} color={pace.state === 'runsOut' ? colors.attention : colors.textSubtle}>
          {pace.state === 'runsOut' ? `At this pace it runs out in ${formatInMs(pace.runsOutInMs ?? 0)}` : pace.state === 'exceeded' ? 'Allowance spent' : '\u00A0'}
        </Text>
        {resetsIn ? <Text color={colors.textSubtle} fontSize={11.5}>resets in {resetsIn}</Text> : null}
      </XStack>
    </YStack>
  );
}

function ProviderCard({ provider, now }: { provider: QuotaProvider; now: number }) {
  const headline = providerHeadline(provider, now);
  return (
    <Card padded gap={12}>
      <XStack justifyContent="space-between" alignItems="center">
        <Text color={colors.text} fontSize={15} fontWeight="700">{quotaProviderName(provider.id)}</Text>
        {provider.plan ? <Text color={colors.textMuted} fontSize={12}>{provider.plan}</Text> : null}
      </XStack>
      {provider.windows.filter((w) => !w.minor).map((w) => (
        <WindowRow key={`${provider.id}:${w.name}`} window={w} now={now} />
      ))}
      {provider.windows.filter((w) => w.minor).map((w) => (
        <XStack key={`${provider.id}:${w.name}`} justifyContent="space-between">
          <Text color={colors.textMuted} fontSize={12}>{w.name}</Text>
          <Text color={colors.textSubtle} fontSize={12}>{usedLeftLine(w)}</Text>
        </XStack>
      ))}
      {provider.notes?.map((note) => (
        <Text key={note} color={colors.textSubtle} fontSize={12}>{note}</Text>
      ))}
      {headline ? <Text color={provider.state === 'live' ? colors.textSubtle : colors.attention} fontSize={12.5} lineHeight={18}>{headline}</Text> : null}
    </Card>
  );
}

/** A provider with nothing to draw: one honest line. */
function ProviderLine({ provider, now }: { provider: QuotaProvider; now: number }) {
  return (

    <XStack justifyContent="space-between" gap={row.gap} paddingHorizontal={row.padX} paddingVertical="$1.5">
      <Text color={colors.textMuted} fontSize={13}>{quotaProviderName(provider.id)}</Text>
      <Text flex={1} textAlign="right" color={colors.textSubtle} fontSize={12}>{providerHeadline(provider, now) ?? provider.state}</Text>
    </XStack>
  );
}
export default function QuotaScreen() {
  const { instance } = useHostInstance();
  const quota = useHostQuota(true);
  const now = useNow();

  // A failed refresh keeps the last readings on screen; only a read that never succeeded is an error view.
  const failure = quota.data ? null : quota.error instanceof HostV3Error ? quota.error : quota.error ? new HostV3Error('transport', String(quota.error)) : null;
  const usable = (quota.data?.providers ?? []).filter(providerIsUsable);
  const rest = (quota.data?.providers ?? []).filter((p) => !providerIsUsable(p));
  const summary = quota.data ? quotaSummary(quota.data) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <ProjectHeader instance={instance} workspaces={[]} title="Quota" />
      {quota.isLoading ? (
        <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
      ) : (
        <ScrollView
          flex={1}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 32, flexGrow: 1 }}
          refreshControl={pullRefresh(quota.isRefetching, () => quota.refresh())}>
          {failure ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read quota</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
                {failure.code === 'quota_unavailable' ? 'This computer runs an older Solco without the quota view.' : 'The computer did not answer. Pull to try again.'}
              </Text>
            </YStack>
          ) : (
            <>
              {summary && (summary.tightest || summary.sources.enabled > 0) ? (
                <Fade style={{ paddingVertical: 12, gap: 4 }}>
                  {summary.tightest ? (
                    <Text color={colors.text} fontSize={17} fontWeight="700">
                      Tightest: {quotaProviderName(summary.tightest.provider.id)} · {summary.tightest.window.name} · {Math.round(summary.tightest.window.usedPct)}%
                    </Text>
                  ) : (
                    <Text color={colors.text} fontSize={17} fontWeight="700">No readings yet</Text>
                  )}
                  <Text color={colors.textMuted} fontSize={13}>
                    {summary.nextResetMs ? `Next reset in ${formatInMs(summary.nextResetMs - now)} · ` : ''}
                    {summary.sources.live} of {summary.sources.enabled} sources live
                  </Text>
                </Fade>
              ) : null}
              {usable.map((provider, index) => (
                <Reveal key={provider.id} index={index} style={{ paddingBottom: 12 }}>
                  <ProviderCard provider={provider} now={now} />
                </Reveal>
              ))}
              {rest.length > 0 ? (
                <YStack paddingTop="$1" gap="$0.5">
                  <SectionLabel>Not shown on your computer</SectionLabel>
                  {rest.map((provider) => (
                    <ProviderLine key={provider.id} provider={provider} now={now} />
                  ))}
                </YStack>
              ) : null}
              {usable.length === 0 && rest.length > 0 ? (
                <Text color={colors.textMuted} fontSize={13} paddingHorizontal={row.padX} paddingTop="$2" lineHeight={19}>
                  Turn a source on in Solco (Sessions › Quota) and it shows here.
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
