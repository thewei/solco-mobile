// [INPUT]: the paired Host's read-only session catalog (GET /api/v3/sessions?q=, needs `capabilities.sessions`),
//          POST /sessions/{id}/continue (needs `capabilities.sessionContinue`), the Trash (`capabilities.sessionTrash`), the shared tree (to resolve a
//          running pane's terminal) and a clock.
// [OUTPUT]: Sessions — a search box over the Mac's session history and the list under it: sessions an Agent is
//           running right now first (status pill, tap = open that pane's Chat), the rest as plain history rows.
// [POS]: The Sessions tab of the bottom bar (Agents · Changes · Files · Sessions) and the second client of the desktop Sessions page. Search runs on the Mac; "running" is the
//        desktop's exact-identity match, so this badge and the desktop pill never disagree. There is no
//        transcript on the phone. A row no Agent runs carries Continue: the Mac resumes it with the same Agent
//        in a new tab (the desktop's own engine) and the phone opens that pane's Chat; the tap is the confirmation.
//        Holding a row no Agent runs offers Move to Trash (the row’s ⋯ button does the same; "Select several" picks many rows for one move) (the desktop's own Sessions Trash, with Undo); the Trash view lists
//        what is in it with Put Back. Permanent deletion is not offered here — it stays on the Mac.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, FlatList } from 'react-native';
import { Input, Spinner, Text, XStack, YStack } from 'tamagui';

import { Check, Ellipsis } from 'lucide-react-native';

import { Icon } from '@/components/icon';
import { Fade } from '@/components/motion';
import { ProjectHeader } from '@/components/project-header';
import { pullRefresh } from '@/components/pull-refresh';
import { CardRow, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';

import type { SessionRow, TrashEntry } from '@/contracts/host-v3';
import { flattenPanes, paneRoute } from '@/features/host/pane-model';
import { launchRoute } from '@/features/host/launch-model';
import { useHostInstance, useHostSessions, useHostSessionTrash, useTreeV3 } from '@/features/host/queries-v3';
import { continueFailureMessage, runningLabel, runningTone, sessionCaption, splitSessions, trashCaption, trashFailureMessage } from '@/features/host/sessions-model';
import { HostV3Error } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useAfterTransition } from '@/lib/use-after-transition';
import { useNow } from '@/lib/use-now';
import { colors, radii, row as rowMetrics, spacing } from '@/theme/tokens';

const SEARCH_DELAY_MS = 300;
const TONES = { accent: colors.accent, attention: colors.attention, success: colors.success, muted: colors.textMuted } as const;

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function Pill({ state }: { state: string }) {
  const tone = TONES[runningTone(state)];
  return (
    <XStack paddingHorizontal="$2" paddingVertical="$0.5" borderRadius={radii.pill} borderWidth={1} borderColor={tone}>
      <Text color={tone} fontSize={11.5} fontWeight="600">{runningLabel(state)}</Text>
    </XStack>
  );
}

function ContinueButton({ title, busy, disabled, onPress }: { title: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Tap role="button" disabled={disabled} accessibilityLabel={`Continue ${title}`} onPress={onPress} opacity={disabled && !busy ? 0.5 : 1}>
      <XStack minWidth={84} minHeight={32} alignItems="center" justifyContent="center" paddingHorizontal="$3" borderRadius={radii.pill} borderWidth={1} borderColor={colors.border}>
        {busy ? <Spinner color={colors.accent} size="small" /> : <Text color={colors.text} fontSize={12.5} fontWeight="600">Continue</Text>}
      </XStack>
    </Tap>
  );
}

/** `picked` is undefined outside selection mode; inside it a running row (never movable) is dimmed and has no box. */
function Row({ row, now, onOpen, onHold, action, picked }: { row: SessionRow; now: number; onOpen?: () => void; onHold?: () => void; action?: ReactNode; picked?: boolean }) {
  const content = (
    <XStack alignItems="center" gap={rowMetrics.gap} paddingHorizontal={rowMetrics.padX} paddingVertical={rowMetrics.padY} minHeight={rowMetrics.minHeight} opacity={picked !== undefined && row.running ? 0.5 : 1}>
      {picked !== undefined && !row.running ? (
        <YStack width={22} height={22} borderRadius={11} alignItems="center" justifyContent="center" borderWidth={1} borderColor={picked ? colors.accent : colors.border} backgroundColor={picked ? colors.accent : 'transparent'}>
          {picked ? <Icon as={Check} size="sm" tone="onAccent" /> : null}
        </YStack>
      ) : null}
      <YStack flex={1}>
        <Text color={colors.text} fontSize={14} fontWeight="600" numberOfLines={1}>{row.title}</Text>
        <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{sessionCaption(row, now)}</Text>
      </YStack>
      {row.running ? <Pill state={row.running.state} /> : action}
      {!row.running && onHold ? (
        <Tap width={32} height={32} borderRadius={16} alignItems="center" justifyContent="center" role="button" accessibilityLabel={`More actions for ${row.title}`} onPress={onHold}>
          <Icon as={Ellipsis} size="sm" tone="muted" />
        </Tap>
      ) : null}
    </XStack>
  );
  if (!onOpen && !onHold) return content;
  return (
    <Tap
      role="button"
      accessibilityLabel={picked !== undefined ? `${picked ? 'Deselect' : 'Select'} ${row.title}` : onOpen ? `Open ${row.title}` : row.title}
      accessibilityHint={onHold ? 'Hold for actions' : undefined}
      onPress={onOpen}
      onLongPress={onHold}>
      {content}
    </Tap>
  );
}

function TrashRow({ entry, now, busy, disabled, onPutBack }: { entry: TrashEntry; now: number; busy: boolean; disabled: boolean; onPutBack: () => void }) {
  return (
    <XStack alignItems="center" gap={rowMetrics.gap} paddingHorizontal={rowMetrics.padX} paddingVertical={rowMetrics.padY} minHeight={rowMetrics.minHeight}>
      <YStack flex={1}>
        <Text color={colors.text} fontSize={14} fontWeight="600" numberOfLines={1}>{entry.title}</Text>
        <Text color={colors.textSubtle} fontSize={12} numberOfLines={1}>{trashCaption(entry, now)}</Text>
      </YStack>
      <Tap role="button" disabled={disabled} accessibilityLabel={`Put back ${entry.title}`} onPress={onPutBack} opacity={disabled && !busy ? 0.5 : 1}>
        <XStack minWidth={84} minHeight={32} alignItems="center" justifyContent="center" paddingHorizontal="$3" borderRadius={radii.pill} borderWidth={1} borderColor={colors.border}>
          {busy ? <Spinner color={colors.accent} size="small" /> : <Text color={colors.text} fontSize={12.5} fontWeight="600">Put back</Text>}
        </XStack>
      </Tap>
    </XStack>
  );
}

/** The list is virtualized: a header label or one row of a card (see CardRow), flattened in display order. */
type Entry = { key: string; label: string } | { key: string; row: SessionRow; first: boolean; last: boolean; running: boolean };

function entriesOf(running: SessionRow[], rest: SessionRow[], restLabel: string): Entry[] {
  const out: Entry[] = [];
  const group = (label: string, rows: SessionRow[], isRunning: boolean) => {
    if (rows.length === 0) return;
    out.push({ key: `label:${label}`, label });
    rows.forEach((row, index) => out.push({ key: row.id, row, first: index === 0, last: index === rows.length - 1, running: isRunning }));
  };
  group('Running now', running, true);
  group(restLabel, rest, false);
  return out;
}

export default function SessionsScreen() {
  const router = useRouter();
  const settled = useAfterTransition();
  const now = useNow();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const chatServed = bootstrap.data?.capabilities.chat === true;
  const [search, setSearch] = useState('');
  const sessions = useHostSessions(true, useDebounced(search, SEARCH_DELAY_MS));
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const continueServed = bootstrap.data?.capabilities.sessionContinue === true && instance !== null;
  const [continuing, setContinuing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The Trash entry the last move created: the notice's Undo puts exactly it back.
  const [undoEntries, setUndoEntries] = useState<string[]>([]);
  // Selection mode (several rows to the Trash at once): null = off, else the picked session ids.
  const [picked, setPicked] = useState<string[] | null>(null);
  const trashServed = bootstrap.data?.capabilities.sessionTrash === true;
  const [view, setView] = useState<'history' | 'trash'>('history');
  const inTrash = view === 'trash' && trashServed;
  const trash = useHostSessionTrash(inTrash);
  const [working, setWorking] = useState<string | null>(null);

  const failure = sessions.error instanceof HostV3Error ? sessions.error : sessions.error ? new HostV3Error('transport', String(sessions.error)) : null;
  const { running, rest } = useMemo(() => splitSessions(sessions.data?.sessions ?? []), [sessions.data]);
  const entries = useMemo(() => entriesOf(running, rest, search.trim() ? 'Matches' : 'History'), [running, rest, search]);

  // A running row opens its pane's Chat: the tree (when it is the same Herdr session) supplies the
  // terminal for the header's Terminal button; without it the Chat still opens, minus that button.
  const open = (row: SessionRow) => {
    const target = row.running;
    if (!target || !chatServed) return;
    const pane = tree.data?.instance === target.instance
      ? flattenPanes(tree.data.workspaces).find((item) => item.pane.paneId === target.paneId)?.pane
      : undefined;
    router.push(
      pane
        ? paneRoute(pane, target.instance, true)
        : { pathname: '/chat/[paneId]', params: { paneId: target.paneId, instance: target.instance, title: row.title } },
    );
  };

  // Continue is one Mac-side transaction (up to ~150 s): one at a time, the tap is the confirmation, and
  // the answer is the pane to open (an already running session is located, never started twice).
  const resume = async (row: SessionRow) => {
    if (!client || !instance || continuing) return;
    setContinuing(row.id);
    setNotice(null);
    try {
      const reply = await client.continueSession(instance, row.id);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
      void queryClient.invalidateQueries({ queryKey: ['v3', 'sessions'] });
      router.push(launchRoute(reply, instance, row.title, chatServed));
    } catch (failure) {
      setNotice(continueFailureMessage(failure));
    } finally {
      setContinuing(null);
    }
  };

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['v3', 'sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['v3', 'sessions-trash'] });
  };

  // Move to Trash and Put back are the two reversible steps; the Mac applies its own refusals (a session an
  // Agent runs, or one written a moment ago, never moves) and the phone only words them. Several rows go one
  // by one (the Host has one endpoint per session); what could not move is named, the rest still moves.
  const moveToTrash = async (rows: SessionRow[]) => {
    if (!client || working || rows.length === 0) return;
    setNotice(null);
    setUndoEntries([]);
    const moved: string[] = [];
    let refused: unknown = null;
    let refusedCount = 0;
    try {
      for (const row of rows) {
        setWorking(row.id);
        try {
          moved.push((await client.trashSession(row.id)).entry);
        } catch (failure) {
          refused ??= failure;
          refusedCount += 1;
        }
      }
    } finally {
      setWorking(null);
      setPicked(null);
      refreshLists();
    }
    const what = moved.length === 1 && rows.length === 1 ? `“${rows[0]?.title ?? ''}”` : `${moved.length} sessions`;
    if (moved.length > 0) {
      setUndoEntries(moved);
      setNotice(refusedCount > 0 ? `Moved ${what} to the Trash. ${refusedCount} could not move: ${trashFailureMessage(refused)}` : `Moved ${what} to the Trash.`);
    } else {
      setNotice(trashFailureMessage(refused));
    }
  };

  // The action menu is the confirmation: the move is reversible (Undo, or Put back from the Trash).
  const rowActions = (row: SessionRow) =>
    Alert.alert(row.title, 'Move it to the Trash? You can put it back from the Trash.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Select several', onPress: () => setPicked([row.id]) },
      { text: 'Move to Trash', style: 'destructive', onPress: () => void moveToTrash([row]) },
    ]);

  const confirmPicked = (rows: SessionRow[]) =>
    Alert.alert(`Move ${rows.length} session${rows.length === 1 ? '' : 's'} to the Trash?`, 'You can put them back from the Trash.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move to Trash', style: 'destructive', onPress: () => void moveToTrash(rows) },
    ]);

  const putBack = async (entryIds: string[], label?: string) => {
    if (!client || working || entryIds.length === 0) return;
    setNotice(null);
    setUndoEntries([]);
    let failed: unknown = null;
    let restored = 0;
    try {
      for (const id of entryIds) {
        setWorking(id);
        try {
          await client.restoreSession(id);
          restored += 1;
        } catch (failure) {
          failed ??= failure;
        }
      }
    } finally {
      setWorking(null);
      refreshLists();
    }
    if (failed) setNotice(restored > 0 ? `Put back ${restored}. ${trashFailureMessage(failed)}` : trashFailureMessage(failed));
    else setNotice(label ? `Put back “${label}”.` : entryIds.length > 1 ? `Put back ${entryIds.length} sessions.` : 'Put back.');
  };

  const trashFailure = trash.error instanceof HostV3Error ? trash.error : trash.error ? new HostV3Error('transport', String(trash.error)) : null;

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
        <ProjectHeader instance={instance} workspaces={[]} title="Sessions" />
        <XStack paddingHorizontal={spacing.screen} paddingVertical={10} gap="$2" alignItems="center">
          {inTrash ? (
            <Text flex={1} color={colors.textMuted} fontSize={13} lineHeight={18}>
              Moved to the Trash on the computer. Put a session back to see it in History again.
            </Text>
          ) : (
          <Input
            flex={1}
            minHeight={42}
            unstyled
            value={search}
            onChangeText={setSearch}
            placeholder="Search sessions"
            placeholderTextColor="$placeholderColor"
            color={colors.text}
            fontSize={15}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search sessions"
            backgroundColor={colors.surface}
            borderColor={colors.border}
            borderWidth={1}
            borderRadius={radii.md}
            paddingHorizontal="$3"
          />
          )}
          {trashServed ? (
            <Tap role="button" accessibilityLabel={inTrash ? 'Back to History' : 'Open the Trash'} onPress={() => { setPicked(null); setView(inTrash ? 'history' : 'trash'); }}>
              <XStack minHeight={42} alignItems="center" paddingHorizontal="$3" borderRadius={radii.md} borderWidth={1} borderColor={colors.border} backgroundColor={colors.surface}>
                <Text color={colors.text} fontSize={13} fontWeight="600">{inTrash ? 'History' : 'Trash'}</Text>
              </XStack>
            </Tap>
          ) : null}
        </XStack>
        {notice ? (
          <XStack alignItems="center" gap="$2" paddingHorizontal={spacing.screen} paddingBottom="$2">
            <Text flex={1} color={colors.attention} fontSize={13} lineHeight={18} accessibilityLiveRegion="polite">
              {notice}
            </Text>
            {undoEntries.length > 0 ? (
              <Tap role="button" accessibilityLabel="Undo move to Trash" onPress={() => void putBack(undoEntries)}>
                <Text color={colors.accent} fontSize={13} fontWeight="700">Undo</Text>
              </Tap>
            ) : null}
          </XStack>
        ) : null}
        {inTrash ? (
          trash.isLoading || !settled ? (
            <YStack flex={1} paddingHorizontal={spacing.screen}><ListSkeleton rows={4} /></YStack>
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={trash.data?.entries ?? []}
              keyExtractor={(entry) => entry.id}
              extraData={[now, working]}
              contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 32, flexGrow: 1 }}
              refreshControl={pullRefresh(trash.isRefetching, () => void trash.refetch())}
              renderItem={({ item, index }) => (
                <CardRow first={index === 0} last={index === (trash.data?.entries.length ?? 0) - 1}>
                  <TrashRow entry={item} now={now} busy={working === item.id} disabled={working !== null} onPutBack={() => void putBack([item.id], item.title)} />
                </CardRow>
              )}
              ListEmptyComponent={
                trashFailure ? (
                  <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                    <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read the Trash</Text>
                    <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>The computer did not answer. Pull to try again.</Text>
                  </YStack>
                ) : (
                  <Fade style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.compact, paddingVertical: 60 }}>
                    <Text color={colors.text} fontSize={16} fontWeight="700">The Trash is empty</Text>
                    <Text color={colors.textMuted} fontSize={13} textAlign="center">Hold a session in History to move it here.</Text>
                  </Fade>
                )
              }
            />
          )
        ) : sessions.isLoading || !settled ? (
          <YStack flex={1} paddingHorizontal={spacing.screen}><ListSkeleton rows={5} /></YStack>
        ) : (
          <FlatList
            style={{ flex: 1 }}
            data={entries}
            keyExtractor={(entry) => entry.key}
            extraData={[now, continuing, continueServed, chatServed, trashServed, working, picked]}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 32, flexGrow: 1 }}
            refreshControl={pullRefresh(sessions.isRefetching, () => void sessions.refetch())}
            renderItem={({ item }) => {
              if ('label' in item) return <SectionLabel>{item.label}</SectionLabel>;
              const { row } = item;
              return (
                <CardRow first={item.first} last={item.last}>
                  {item.running ? (
                    <Row row={row} now={now} picked={picked ? false : undefined} onOpen={chatServed && !picked ? () => open(row) : undefined} />
                  ) : picked ? (
                    <Row
                      row={row}
                      now={now}
                      picked={picked.includes(row.id)}
                      onOpen={() => setPicked((cur) => (cur ? (cur.includes(row.id) ? cur.filter((id) => id !== row.id) : [...cur, row.id]) : cur))}
                    />
                  ) : (
                    <Row
                      row={row}
                      now={now}
                      onHold={trashServed && !working ? () => rowActions(row) : undefined}
                      action={
                        continueServed ? (
                          <ContinueButton title={row.title} busy={continuing === row.id} disabled={continuing !== null} onPress={() => void resume(row)} />
                        ) : undefined
                      }
                    />
                  )}
                </CardRow>
              );
            }}
            ListEmptyComponent={
              failure ? (
                <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                  <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read sessions</Text>
                  <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
                    {failure.code === 'sessions_unavailable' ? 'This computer runs an older Solco without the sessions view, or its history could not be read.' : 'The computer did not answer. Pull to try again.'}
                  </Text>
                </YStack>
              ) : (
                <Fade style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.compact, paddingVertical: 60 }}>
                  <Text color={colors.text} fontSize={16} fontWeight="700">
                    {search.trim() ? 'No session matches' : 'No sessions yet'}
                  </Text>
                  {search.trim() ? (
                    <Text color={colors.textMuted} fontSize={13} textAlign="center">Try another search.</Text>
                  ) : null}
                </Fade>
              )
            }
          />
        )}
        {picked && !inTrash ? (
          <XStack alignItems="center" gap="$3" paddingHorizontal={spacing.screen} paddingVertical="$3" borderTopWidth={1} borderColor={colors.border} backgroundColor={colors.surface}>
            <Tap role="button" accessibilityLabel="Cancel selection" onPress={() => setPicked(null)}>
              <Text color={colors.textMuted} fontSize={14} fontWeight="600">Cancel</Text>
            </Tap>
            <Text flex={1} color={colors.textMuted} fontSize={13} textAlign="center">{picked.length} selected</Text>
            <Tap
              role="button"
              disabled={picked.length === 0 || working !== null}
              accessibilityLabel={`Move ${picked.length} to the Trash`}
              onPress={() => confirmPicked(entries.flatMap((entry) => ('row' in entry && picked.includes(entry.row.id) ? [entry.row] : [])))}
              opacity={picked.length === 0 || working !== null ? 0.5 : 1}>
              {working !== null ? <Spinner color={colors.danger} size="small" /> : <Text color={colors.danger} fontSize={14} fontWeight="700">Move to Trash</Text>}
            </Tap>
          </XStack>
        ) : null}
      </SafeAreaView>
    </>
  );
}
