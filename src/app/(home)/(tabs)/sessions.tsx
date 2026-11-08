// [INPUT]: the paired Host's read-only session catalog (GET /api/v3/sessions?q=, needs `capabilities.sessions`),
//          POST /sessions/{id}/continue (needs `capabilities.sessionContinue`), the Trash (`capabilities.sessionTrash`), the shared tree (to resolve a
//          running pane's terminal) and a clock.
// [OUTPUT]: Sessions — the Mac's agent-conversation history as Today / Yesterday / Earlier shelves of two-line rows (agent · project, age on the
//           right; a session an Agent runs wears its status), a search in the bar, a ⋮ menu (Trash with its count, Filter by agent),
//           a row sheet (Open running chat · Continue in a new chat · Move to Trash), the Trash view with Put back, a toast with Undo,
//           and the loading / empty / error states of designs/mobile-t3-redesign.
// [POS]: The Sessions tab of the bottom bar and the second client of the desktop Sessions page. Search runs on the Mac; "running" is the
//        desktop's exact-identity match, so this status and the desktop pill never disagree. There is no transcript on the phone (the draft's
//        "View conversation" is not offered: no Host route serves one). Continue resumes the session with the same Agent in a new tab (the
//        desktop's own engine) and the phone opens that pane's Chat. Move to Trash and Put back are the desktop's Sessions Trash, reversible
//        (Undo); permanent deletion is not offered here — it stays on the Mac. The drawer's chat list is gone: Chats owns it.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../../CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { ListRow, Shelf } from '@/components/list-group';
import { Menu, MenuItem } from '@/components/menu';
import { Fade } from '@/components/motion';
import { OptionSheet } from '@/components/option-sheet';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen, type BarAction } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { ListSkeleton } from '@/components/skeletons';
import { ThreadRow } from '@/components/thread-row';
import { useToast } from '@/components/toast';
import type { SessionRow, TrashEntry } from '@/contracts/host-v3';
import { agoLabel } from '@/features/host/host-card-model';
import { launchRoute } from '@/features/host/launch-model';
import { agoShort, flattenPanes, paneRoute } from '@/features/host/pane-model';
import { useHostInstance, useHostSessions, useHostSessionTrash, useTreeV3 } from '@/features/host/queries-v3';
import {
  continueFailureMessage,
  runningStatus,
  sessionAgentName,
  sessionAgents,
  sessionCaption,
  sessionShelves,
  trashCaption,
  trashFailureMessage,
  type SessionShelfLabel,
} from '@/features/host/sessions-model';
import { HostV3Error } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useBackHandler } from '@/lib/use-back-handler';
import { useDebounced } from '@/lib/use-debounced';
import { useNow } from '@/lib/use-now';
import { IconChevronLeft, IconChevronRight, IconDotsVertical, IconHistory, IconMessage, IconPlayerPlay, IconSearch, IconTrash, IconWifiOff } from '@/theme/glyphs';
import { colors, type as typeScale } from '@/theme/tokens';

/** The list is virtualized: a shelf label or one row, flattened in display order. */
type Entry = { key: string; shelf: SessionShelfLabel } | { key: string; row: SessionRow };

function entriesOf(rows: readonly SessionRow[], now: number): Entry[] {
  return sessionShelves(rows, now).flatMap((shelf) => [{ key: `shelf:${shelf.label}`, shelf: shelf.label }, ...shelf.rows.map((row) => ({ key: row.id, row }))]);
}

function TrashRow({ entry, now, busy, disabled, onPutBack }: { entry: TrashEntry; now: number; busy: boolean; disabled: boolean; onPutBack: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8.75, paddingLeft: 17.5, paddingRight: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight} numberOfLines={1}>{entry.title.trim() || 'Untitled session'}</Text>
        <Text marginTop={3.5} color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} numberOfLines={1}>{trashCaption(entry, now)}</Text>
      </View>
      <PillButton tone="tonal" label={busy ? 'Putting back…' : 'Put back'} accessibilityLabel={`Put back ${entry.title}`} disabled={disabled} onPress={onPutBack} />
    </View>
  );
}

export default function SessionsScreen() {
  const router = useRouter();
  const now = useNow();
  const { connection, client } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const queryClient = useQueryClient();
  const { toast, show } = useToast();
  const caps = bootstrap.data?.capabilities;
  const chatServed = caps?.chat === true;
  const continueServed = caps?.sessionContinue === true && instance !== null;
  const trashServed = caps?.sessionTrash === true;
  const hostName = connection?.name || bootstrap.data?.hostName || 'your computer';

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const sessions = useHostSessions(true, useDebounced(query));
  const [view, setView] = useState<'history' | 'trash'>('history');
  const inTrash = view === 'trash' && trashServed;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<'main' | 'agents'>('main');
  const [agent, setAgent] = useState<string | undefined>(undefined);
  const [chosen, setChosen] = useState<SessionRow | null>(null);
  const [continuing, setContinuing] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const trash = useHostSessionTrash(trashServed && (menuOpen || inTrash));

  const rows = useMemo(() => sessions.data?.sessions ?? [], [sessions.data]);
  const agents = useMemo(() => sessionAgents(rows), [rows]);
  // The choice dies with its last session (the list was searched or refreshed).
  const agentId = agents.some((item) => item.id === agent) ? agent : undefined;
  const shown = useMemo(() => (agentId ? rows.filter((row) => row.agent === agentId) : rows), [rows, agentId]);
  const entries = useMemo(() => entriesOf(shown, now), [shown, now]);
  const trashEntries = trash.data?.entries ?? [];

  const failure = sessions.error instanceof HostV3Error ? sessions.error : sessions.error ? new HostV3Error('transport', String(sessions.error)) : null;
  const searchWords = query.trim();

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };
  useBackHandler(searching || inTrash, () => (inTrash ? setView('history') : closeSearch()));

  // A running row opens its pane's Chat: the tree (when it is the same Herdr session) supplies the
  // terminal for the Chat's menu; without it the Chat still opens, minus that entry.
  const open = (row: SessionRow) => {
    const target = row.running;
    if (!target || !chatServed) return;
    const pane = tree.data?.instance === target.instance ? flattenPanes(tree.data.workspaces).find((item) => item.pane.paneId === target.paneId)?.pane : undefined;
    router.push(pane ? paneRoute(pane, target.instance, true) : { pathname: '/chat/[paneId]', params: { paneId: target.paneId, instance: target.instance, title: row.title } });
  };

  // Continue is one Mac-side transaction (up to ~150 s): one at a time, the tap is the confirmation, and
  // the answer is the pane to open (an already running session is located, never started twice).
  const resume = async (row: SessionRow) => {
    if (!client || !instance || continuing) return;
    setContinuing(row.id);
    try {
      const reply = await client.continueSession(instance, row.id);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
      void queryClient.invalidateQueries({ queryKey: ['v3', 'sessions'] });
      setChosen(null);
      router.push(launchRoute(reply, instance, row.title, chatServed));
    } catch (cause) {
      setChosen(null);
      show(continueFailureMessage(cause));
    } finally {
      setContinuing(null);
    }
  };

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['v3', 'sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['v3', 'sessions-trash'] });
  };

  // Move to Trash and Put back are the two reversible steps; the Mac applies its own refusals (a session an
  // Agent runs, or one written a moment ago, never moves) and the phone only words them.
  const putBack = async (items: { id: string; agent: string }[]) => {
    if (!client || working || items.length === 0) return;
    let failed: unknown = null;
    let restored = 0;
    try {
      for (const item of items) {
        setWorking(item.id);
        try {
          await client.restoreSession(item.id);
          restored += 1;
        } catch (cause) {
          failed ??= cause;
        }
      }
    } finally {
      setWorking(null);
      refreshLists();
    }
    const word = restored === 1 && items.length === 1 ? `Put back in ${sessionAgentName(items[0]!.agent)} history` : `Put back ${restored} sessions`;
    if (failed) show(restored > 0 ? `${word}. ${trashFailureMessage(failed)}` : trashFailureMessage(failed));
    else show(word);
  };

  const moveToTrash = async (row: SessionRow) => {
    if (!client || working) return;
    setWorking(row.id);
    try {
      const { entry } = await client.trashSession(row.id);
      show('Moved to Trash', { label: 'Undo', onPress: () => void putBack([{ id: entry, agent: row.agent }]) });
    } catch (cause) {
      show(trashFailureMessage(cause));
    } finally {
      setWorking(null);
      refreshLists();
    }
  };

  // The sheet is the confirmation: the move is reversible (Undo, or Put back from the Trash).
  const hasActions = (row: SessionRow) => (row.running ? chatServed : continueServed || trashServed);
  const refreshing = sessions.isRefetching;
  const lastListAge = sessions.dataUpdatedAt > 0 ? agoLabel(sessions.dataUpdatedAt, now) : null;

  let body: React.ReactNode;
  if (inTrash) {
    const trashFailed = trash.isError && trash.data === undefined;
    body = trash.isLoading ? (
      <ListSkeleton rows={4} inset />
    ) : trashFailed ? (
      <EmptyState icon={IconWifiOff} title="Can’t read the Trash" text={`${hostName} did not answer.`} action="Try again" onAction={() => void trash.refetch()} top />
    ) : trashEntries.length === 0 ? (
      <EmptyState icon={IconTrash} title="Trash is empty" text="Sessions you move to Trash show up here." top />
    ) : (
      <ScrollView refreshControl={pullRefresh(trash.isRefetching, () => void trash.refetch())} contentContainerStyle={{ paddingBottom: 16 }}>
        {trashEntries.map((entry) => (
          <TrashRow key={entry.id} entry={entry} now={now} busy={working === entry.id} disabled={working !== null} onPutBack={() => void putBack([{ id: entry.id, agent: entry.agent }])} />
        ))}
      </ScrollView>
    );
  } else if (sessions.isLoading) {
    body = <ListSkeleton shelf shelfWidth={56} rows={8} inset />;
  } else if (failure && sessions.data === undefined) {
    body = (
      <EmptyState
        icon={IconWifiOff}
        title="Can’t read sessions"
        text={failure.code === 'sessions_unavailable' ? 'This computer runs an older Solco without the sessions view, or its history could not be read.' : `${hostName} did not answer. Check the connection and try again.`}
        action="Try again"
        onAction={() => void sessions.refetch()}
      />
    );
  } else if (rows.length === 0) {
    body = searchWords ? (
      <EmptyState icon={IconSearch} title="No session matches" text="Try another search." />
    ) : (
      <EmptyState icon={IconHistory} title="No sessions yet" text={`Agent conversations on ${hostName} show up here after they run.`} />
    );
  } else {
    body = (
      <Fade style={{ flex: 1 }}>
        <FlatList
          style={{ flex: 1 }}
          data={entries}
          keyExtractor={(entry) => entry.key}
          extraData={[now, query]}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
          refreshControl={pullRefresh(refreshing, () => void sessions.refetch())}
          ListHeaderComponent={failure ? <Banner text={`Can’t reach ${hostName}.${lastListAge ? ` Showing the list from ${lastListAge}.` : ''}`} action="Retry" onAction={() => void sessions.refetch()} /> : null}
          ListEmptyComponent={<EmptyState icon={IconSearch} title="No session matches" text="Try another agent or search." />}
          renderItem={({ item, index }) => {
            if ('shelf' in item) return <Shelf label={item.shelf} after={index === 0 && failure !== null ? 'banner' : undefined} />;
            const { row } = item;
            const status = row.running ? runningStatus(row.running.state) : undefined;
            return (
              <ThreadRow
                workspace={row.project ?? sessionAgentName(row.agent)}
                title={row.title.trim() || 'Untitled session'}
                caption={sessionCaption(row)}
                status={status}
                time={!status && row.updatedMs ? agoShort(row.updatedMs, now) : undefined}
                quiet={!row.running}
                query={searchWords}
                onPress={() => {
                  if (hasActions(row)) setChosen(row);
                }}
              />
            );
          }}
        />
      </Fade>
    );
  }

  const actions: BarAction[] = [];
  if (!inTrash) {
    if (!searching) actions.push({ icon: IconSearch, label: 'Search sessions', onPress: () => setSearching(true) });
    if (trashServed || agents.length > 0) {
      actions.push({
        icon: IconDotsVertical,
        label: 'More',
        onPress: () => {
          setMenuView('main');
          setMenuOpen(true);
        },
      });
    }
  }

  const trashCount = trash.data ? trash.data.entries.length : undefined;
  const subtitle = inTrash ? `${trashEntries.length} session${trashEntries.length === 1 ? '' : 's'}` : agentId ? sessionAgentName(agentId) : undefined;

  return (
    <Screen
      back={inTrash ? () => setView('history') : searching ? closeSearch : undefined}
      title={inTrash ? 'Trash' : 'Sessions'}
      subtitle={subtitle}
      bar={searching && !inTrash ? <SearchField value={query} onChangeText={setQuery} placeholder="Search sessions" /> : undefined}
      actions={actions}>
      {body}
      {toast}

      <Menu visible={menuOpen} onClose={() => setMenuOpen(false)}>
        {menuView === 'main' ? (
          <>
            {trashServed ? (
              <MenuItem
                label="Trash"
                detail={trashCount === undefined ? undefined : String(trashCount)}
                onPress={() => {
                  setMenuOpen(false);
                  setView('trash');
                }}
              />
            ) : null}
            {agents.length > 0 ? <MenuItem label="Filter by agent" trailing={IconChevronRight} onPress={() => setMenuView('agents')} /> : null}
          </>
        ) : (
          <>
            <MenuItem muted leading={IconChevronLeft} label="Filter by agent" onPress={() => setMenuView('main')} />
            <MenuItem
              label="All agents"
              checked={agentId === undefined}
              onPress={() => {
                setAgent(undefined);
                setMenuOpen(false);
              }}
            />
            {agents.map((item) => (
              <MenuItem
                key={item.id}
                label={item.name}
                checked={agentId === item.id}
                onPress={() => {
                  setAgent(item.id);
                  setMenuOpen(false);
                }}
              />
            ))}
          </>
        )}
      </Menu>

      <OptionSheet visible={chosen !== null} title={chosen?.title.trim() || 'Untitled session'} subtitle={chosen ? sessionCaption(chosen) : undefined} onClose={() => setChosen(null)}>
        {chosen?.running && chatServed ? (
          <ListRow
            icon={IconMessage}
            label="Open running chat"
            chevron={false}
            onPress={() => {
              const row = chosen;
              setChosen(null);
              open(row);
            }}
          />
        ) : null}
        {chosen && !chosen.running && continueServed ? (
          <ListRow
            icon={IconPlayerPlay}
            label="Continue in a new chat"
            description={continuing === chosen.id ? `Starting on ${hostName}…` : undefined}
            chevron={false}
            disabled={continuing !== null}
            onPress={() => void resume(chosen)}
          />
        ) : null}
        {chosen && !chosen.running && trashServed ? (
          <ListRow
            icon={IconTrash}
            label="Move to Trash"
            danger
            chevron={false}
            disabled={continuing !== null || working !== null}
            onPress={() => {
              const row = chosen;
              setChosen(null);
              void moveToTrash(row);
            }}
          />
        ) : null}
      </OptionSheet>
    </Screen>
  );
}
