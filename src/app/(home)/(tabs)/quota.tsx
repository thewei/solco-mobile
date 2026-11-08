// [INPUT]: the paired Host's read-only quota page (GET /api/v3/quota, needs `capabilities.quota`) and a clock.
// [OUTPUT]: Usage — the bottom-bar tab's agent-quota page: per provider a header (badge, name, plan) and one card per window (the
//           share left in 30 dp type, the pace verdict and line, a meter with the even-rate tick, "N% used" and "Resets in …"),
//           a banner under a provider whose source needs attention, a footnote saying where and when it was read, a refresh in the
//           bar, and the loading / empty / error states of designs/mobile-t3-redesign.
// [POS]: Read-only second client of the desktop /quota page (the tab keeps its route and capability name `quota`; the screen is
//        called Usage). The Mac decides what may be read (its own switches and consents); the phone has no credential path and
//        changes nothing. Pull to refresh and the bar's Refresh force a read past the Host's reuse window.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../../CLAUDE.md
import { ScrollView, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Meter } from '@/components/meter';
import { Fade, Skeleton } from '@/components/motion';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { ProviderBadge } from '@/components/thread-row';
import { useToast } from '@/components/toast';
import type { QuotaProvider, QuotaWindow } from '@/contracts/host-v3';
import { ageOf, providerHeadline, quotaProviderName, windowFace } from '@/features/host/quota-model';
import { useHostInstance, useHostQuota } from '@/features/host/queries-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useNow } from '@/lib/use-now';
import { IconChartBar, IconRefresh, IconWifiOff } from '@/theme/glyphs';
import { colors, radii, spacing, type as typeScale, themed } from '@/theme/tokens';

const VERDICT_COLOR = themed(() => ({ muted: colors.textMuted, warn: colors.attention, bad: colors.danger }) as const);

function UsageCard({ window: w, now }: { window: QuotaWindow; now: number }) {
  const face = windowFace(w, now);
  return (
    <View accessible accessibilityLabel={`${w.name}, ${face.left}% left. ${face.pace}`} style={{ marginHorizontal: spacing.screen, marginBottom: 10, paddingTop: 16, paddingHorizontal: 17, paddingBottom: 14, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text flexShrink={1} color={colors.text} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">{w.name}</Text>
        {face.verdict ? <Text color={VERDICT_COLOR[face.verdict.tone]} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{face.verdict.text}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <Text color={colors.text} fontSize={typeScale.display.fontSize} lineHeight={typeScale.display.lineHeight} fontWeight="700" letterSpacing={-0.4}>{`${face.left}%`}</Text>
        <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>left</Text>
      </View>
      <Text marginTop={2} color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight}>{face.pace}</Text>
      <Meter usedPct={w.usedPct} level={face.level} tickPct={face.tickPct} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <Text flexShrink={1} color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{face.usedLine}</Text>
        {face.resetsIn ? (
          <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>
            {'Resets in '}
            <Text color={colors.text} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} fontWeight="500">{face.resetsIn}</Text>
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ProviderHeader({ provider }: { provider: QuotaProvider }) {
  return (
    <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 14, paddingHorizontal: 21, paddingBottom: 8 }}>
      <ProviderBadge provider={provider.id} />
      <Text flex={1} color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight} fontWeight="500" numberOfLines={1}>{quotaProviderName(provider.id)}</Text>
      {provider.plan ? <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{provider.plan}</Text> : null}
    </View>
  );
}

function Note({ children }: { children: string }) {
  // The design's `.note` has a 4 px top margin that CSS folds into the 10 / 12 / 4 px bottom margin of whatever precedes it (card, note,
  // banner); React Native does not fold margins, so the top margin is left out rather than added on top.
  return <Text marginBottom={12} marginHorizontal={21} color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight}>{children}</Text>;
}

function UsageSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading usage">
      {[0, 1].map((index) => (
        <View key={index}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 14, paddingHorizontal: 21, paddingBottom: 8 }}>
            <Skeleton width={20} height={20} />
            <Skeleton width={110} height={16} />
          </View>
          <View style={{ marginHorizontal: spacing.screen, marginBottom: 10, paddingTop: 16, paddingHorizontal: 17, paddingBottom: 14, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised }}>
            <Skeleton width="40%" height={14} />
            <View style={{ marginTop: 10 }}><Skeleton width="46%" height={34} /></View>
            <View style={{ marginTop: 14 }}><Skeleton height={28} /></View>
            <View style={{ marginTop: 14 }}><Skeleton width="60%" height={14} /></View>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function UsageScreen() {
  const { connection } = useHostV3();
  const { bootstrap } = useHostInstance();
  const quota = useHostQuota(true);
  const now = useNow();
  const { toast, show } = useToast();
  const hostName = connection?.name || bootstrap.data?.hostName || 'your computer';

  // A failed refresh keeps the last readings on screen (with a banner); only a read that never succeeded is an error view.
  const failure = quota.error instanceof HostV3Error ? quota.error : quota.error ? new HostV3Error('transport', String(quota.error)) : null;
  const providers = quota.data?.providers ?? [];
  const drawn = providers.filter((provider) => provider.state !== 'disabled' && provider.state !== 'idle');
  const quiet = providers.filter((provider) => provider.state === 'disabled' || provider.state === 'idle');
  const newest = drawn.reduce((at, provider) => Math.max(at, provider.atMs ?? 0), 0);
  const refresh = () => void quota.refresh().then((result) => show(result.isError ? 'Couldn’t refresh usage' : 'Usage refreshed'));

  let body: React.ReactNode;
  if (quota.isLoading) {
    body = <UsageSkeleton />;
  } else if (failure && quota.data === undefined) {
    body = (
      <EmptyState
        icon={IconWifiOff}
        title="Can’t read usage"
        text={failure.code === 'quota_unavailable' ? 'This computer runs an older Solco without the usage view.' : `${hostName} did not answer. Check the connection and try again.`}
        action="Try again"
        onAction={() => void quota.refresh()}
      />
    );
  } else if (drawn.length === 0) {
    body = <EmptyState flush icon={IconChartBar} title="No readings yet" text={`Sign in to Claude Code, Codex or Cursor on ${hostName} and usage will appear here.`} />;
  } else {
    body = (
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} refreshControl={pullRefresh(quota.isRefetching, () => void quota.refresh())}>
        <Fade>
          {failure ? <Banner text={`Can’t reach ${hostName}. Showing the last readings.`} action="Retry" onAction={() => void quota.refresh()} /> : null}
          {drawn.map((provider) => {
            const headline = providerHeadline(provider, now);
            const live = provider.state === 'live';
            const windows = [...provider.windows.filter((w) => !w.minor), ...provider.windows.filter((w) => w.minor)];
            return (
              <View key={provider.id}>
                <ProviderHeader provider={provider} />
                {windows.map((w, index) => (
                  <UsageCard key={`${w.name}:${index}`} window={w} now={now} />
                ))}
                {provider.notes?.map((note) => <Note key={note}>{note}</Note>)}
                {headline && !live ? <Banner text={headline} action={provider.state === 'expired' ? 'Retry' : undefined} onAction={() => void quota.refresh()} /> : null}
                {!live && provider.atMs ? <Note>{`Last reading ${ageOf(provider.atMs, now)}`}</Note> : null}
              </View>
            );
          })}
          <Note>{newest > 0 ? `Read from ${hostName} · updated ${ageOf(newest, now)}` : `Read from ${hostName}`}</Note>
          {quiet.length > 0 ? <Note>{`${quiet.map((provider) => quotaProviderName(provider.id)).join(', ')} ${quiet.length === 1 ? 'is' : 'are'} off or not read yet on ${hostName}.`}</Note> : null}
        </Fade>
      </ScrollView>
    );
  }

  return (
    <Screen title="Usage" actions={[{ icon: IconRefresh, label: 'Refresh usage', pressed: quota.isRefetching, onPress: refresh }]}>
      {body}
      {toast}
    </Screen>
  );
}
