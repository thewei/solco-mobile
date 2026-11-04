// [INPUT]: a paired Solco Host, Assistant ID, and the per-device Activity ACK watermark
// [OUTPUT]: old-to-new Task/Goal activity, explicit read confirmation, reconnect catch-up
// [POS]: A Solco-authored facts timeline, never a fabricated OMP conversation or background push
// [PROTOCOL]: Update this header on changes, then check CLAUDE.md
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert } from 'react-native';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Card, SectionLabel } from '@/components/section';
import type { Fact } from '@/contracts/host-v3';
import { newRequestId } from '@/features/host/launch-model';
import { mergeActivityFacts, nextActivityCursor } from '@/features/host/activity-model';
import { createRequestIds, personalAgentMessage } from '@/features/host/personal-agent-model';
import { factLabel, factTone } from '@/features/host/progress-model';
import { useAssistantActivityHint, useAssistantCoordinatorReport, useAssistantDetail, useBootstrapV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { colors, spacing } from '@/theme/tokens';

const PAGE_SIZE = 40;
const COLOR = { ok: colors.success, warn: colors.attention, bad: colors.danger, work: colors.accent, muted: colors.textSubtle };

export default function AssistantActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useHostV3();
  const boot = useBootstrapV3();
  const served = boot.data?.capabilities.personalAgent === true;
  const manage = boot.data?.capabilities.personalAgentManage === true;
  const detail = useAssistantDetail(id ?? '', served);
  const reportEnabled = served && boot.data?.capabilities.personalAgentNarrativeReports === true;
  const report = useAssistantCoordinatorReport(id ?? '', reportEnabled);
  const refetchReport = report.refetch;
  const activityHint = useAssistantActivityHint();
  const [facts, setFacts] = useState<Fact[]>([]);
  const [ackSeq, setAckSeq] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState('');
  const after = useRef(0);
  // An old Host's in-flight request must never populate a newly selected
  // Mac/Assistant's screen when the user switches connections.
  const epoch = useRef(0);
  const inFlight = useRef(-1);
  // Reuse one requestId after an uncertain transport failure: the Host may
  // have committed the ACK even though the response never reached this phone.
  const ids = useRef(createRequestIds(newRequestId)).current;
  const reportIds = useRef(createRequestIds(newRequestId)).current;
  const [resolvingReport, setResolvingReport] = useState(false);

  const load = useCallback(async (reset = false) => {
    if (!client || !id) return;
    const token = epoch.current;
    if (inFlight.current === token) return;
    inFlight.current = token;
    try {
      let cursor = after.current;
      if (reset) {
        // First read discovers this paired device's persisted watermark.
        // No read, including this one, advances it.
        const initial = await client.assistantActivity(id, 0, 1);
        if (token !== epoch.current) return;
        cursor = initial.ackSeq;
        setAckSeq(cursor);
        setFacts([]);
      }
      const page = await client.assistantActivity(id, cursor, PAGE_SIZE);
      if (token !== epoch.current) return;
      after.current = nextActivityCursor(cursor, page.nextSeq);
      setHasMore(page.hasMore);
      setFacts((prior) => mergeActivityFacts(reset ? [] : prior, page.facts));
      setError('');
    } catch (e) {
      if (token === epoch.current) setError(personalAgentMessage(e));
    } finally {
      if (token === epoch.current) {
        setLoading(false);
        inFlight.current = -1;
      }
    }
  }, [client, id]);

  useFocusEffect(useCallback(() => {
    epoch.current += 1;
    inFlight.current = -1;
    after.current = 0;
    setFacts([]);
    setAckSeq(0);
    setAcknowledging(false);
    setLoading(true);
    void load(true);
    // Periodically fetch newly committed facts while this screen is mounted;
    // refreshes do not send an ACK or wake an OMP Agent.
    if (reportEnabled) void refetchReport();
    const timer = setInterval(() => {
      void load(false);
      if (reportEnabled) void refetchReport();
    }, 10_000);
    return () => {
      clearInterval(timer);
      epoch.current += 1;
    };
  }, [load, reportEnabled, refetchReport]));

  // The existing Host events socket supplies only a change hint. Fetch
  // durable Activity records; network gaps still recover on focus/poll.
  useEffect(() => {
    if (activityHint > 0) void load(false);
  }, [activityHint, load]);

  const reviewReport = (action: 'skip' | 'retry') => {
    const pending = report.data;
    if (!client || !id || !manage || resolvingReport || pending?.state !== 'uncertain' || pending.throughSeq <= 0) return;
    const target = pending.throughSeq;
    const owner = id;
    Alert.alert(
      action === 'skip' ? 'Report already delivered?' : 'Send the report again?',
      action === 'skip'
        ? 'Check the original OMP Chat first. Marking this handled discards this pending report; all activity facts remain available.'
        : 'Herdr may have already delivered the report to OMP. Sending it again can produce a duplicate. Check the original conversation before confirming.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: action === 'skip' ? 'Mark handled' : 'Retry delivery', style: action === 'retry' ? 'destructive' : 'default', onPress: () => {
          const token = epoch.current;
          const requestId = reportIds.begin(owner + ':' + target + ':' + action);
          setResolvingReport(true);
          void client.resolveAssistantCoordinatorReport(requestId, owner, target, action)
            .then(() => {
              if (token !== epoch.current) return;
              reportIds.settle(null);
              setError('');
              void report.refetch();
            })
            .catch((err) => {
              if (token !== epoch.current) return;
              reportIds.settle(err);
              setError(personalAgentMessage(err));
              void report.refetch();
            })
            .finally(() => { if (token === epoch.current) setResolvingReport(false); });
        } },
      ],
    );
  };

  const markRead = () => {
    if (!client || !id || acknowledging || after.current <= ackSeq) return;
    const target = after.current;
    const token = epoch.current;
    const requestId = ids.begin(id + ':' + String(target));
    setAcknowledging(true);
    void client.ackAssistantActivity(requestId, id, target).then((confirmed) => {
      if (token !== epoch.current) return;
      setAckSeq(confirmed);
      ids.settle(null);
      setError('');
    }).catch((err) => {
      if (token !== epoch.current) return;
      ids.settle(err);
      setError(personalAgentMessage(err));
    }).finally(() => {
      if (token === epoch.current) setAcknowledging(false);
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: detail.data?.assistant.name ? detail.data.assistant.name + ' · Activity' : 'Activity' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        <ScrollView
          flex={1}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 36, gap: 10, flexGrow: 1 }}
          refreshControl={pullRefresh(loading, () => void load(false))}>
          <SectionLabel inset={false}>Solco activity</SectionLabel>
          {report.data?.state === 'uncertain' ? (
            <Card padded gap={8}>
              <Text color={colors.danger} fontSize={14} fontWeight="700">Coordinator report needs review</Text>
              <Text color={colors.textMuted} fontSize={12.5} lineHeight={18}>
                An automatic progress request may already have reached OMP. Open the original Chat to check it; Solco will not retry without your explicit decision.
              </Text>
              <Text color={colors.textSubtle} fontSize={12}>Activity through fact #{report.data.throughSeq}. This is delivery status, not a completed reply.</Text>
              {manage ? (
                <XStack gap={8} flexWrap="wrap">
                  <PillButton compact tone="soft" label="Already delivered · Skip" disabled={resolvingReport} onPress={() => reviewReport('skip')} />
                  <PillButton compact tone="soft" label="Send again…" disabled={resolvingReport} onPress={() => reviewReport('retry')} />
                </XStack>
              ) : <Text color={colors.textMuted} fontSize={12}>This device has read-only access and cannot resolve delivery.</Text>}
            </Card>
          ) : report.data?.state === 'queued' || report.data?.state === 'claimed' ? (
            <Card padded>
              <Text color={colors.textMuted} fontSize={12}>A progress update is {report.data.state === 'claimed' ? 'being submitted' : 'awaiting submission'} to the original OMP Coordinator; its reply is not yet confirmed.</Text>
            </Card>
          ) : null}
          <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
            These are committed task and goal updates from Solco, not replies written by the Coordinator. Updates survive reconnecting; the device marks them seen only when you choose.
          </Text>
          {error ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{error}</Text> : null}
          {loading && facts.length === 0 ? <Text color={colors.textMuted}>Loading activity…</Text> : null}
          {!loading && facts.length === 0 && !error ? (
            <Card padded><Text color={colors.textMuted} fontSize={13}>No unacknowledged activity. Pull to check again.</Text></Card>
          ) : null}
          {facts.map((f) => (
            <Card key={f.id} padded gap={4}>
              <XStack alignItems="center" justifyContent="space-between">
                <Text color={COLOR[factTone(f)]} fontSize={12} fontWeight="700">{factLabel(f)}</Text>
                <Text color={colors.textSubtle} fontSize={11.5}>{new Date(f.createdAt).toLocaleString()}</Text>
              </XStack>
              <Text color={colors.text} fontSize={13.5} lineHeight={20}>{f.text}</Text>
              {f.evidence ? <Text color={colors.textMuted} fontSize={12} numberOfLines={3}>{f.evidence}</Text> : null}
            </Card>
          ))}
          {facts.length > 0 ? (
            <YStack gap={8} paddingTop={4}>
              {hasMore ? <PillButton label="Load more" tone="soft" compact disabled={loading} onPress={() => void load(false)} /> : null}
              {manage ? (
                <PillButton
                  label={after.current <= ackSeq ? 'All shown updates marked seen' : 'Mark shown updates as seen'}
                  compact
                  tone="soft"
                  disabled={acknowledging || after.current <= ackSeq}
                  onPress={markRead}
                />
              ) : (
                <Text color={colors.textMuted} fontSize={12}>This device has read-only access; it cannot confirm updates.</Text>
              )}
            </YStack>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
