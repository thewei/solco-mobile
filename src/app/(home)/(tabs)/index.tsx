// [INPUT]: the paired Go Host's tree (events-hinted through BackgroundBridge's shared socket), the Assistants overview (the Primary
//          row) and the client-local search words and Workspace filter.
// [OUTPUT]: Chats — the home tab: the bar (wordmark, search, filter) over the list in three groups: the pinned Primary Assistant and
//           what needs you (two-line card rows), `Working` (cards) and `Earlier` (one-line rows, six first; a chat that never ran a turn leads it, marked `New`), with the search
//           hit marked in the title, the Host / Workspace filter, the extended "New chat" FAB, and the loading / empty / offline /
//           no-match states of designs/mobile-t3-redesign. An agent row opens its Chat (when the Host serves it), any other its terminal.
// [POS]: The Chats tab of the bottom bar and the mobile root screen. Navigation is client-local and never moves the Mac's focus.
//        The old Home's connection line, peek previews, sub-agent fold and inline composer are gone: the FAB opens the New chat
//        screen, the Chat's own drawer lists sub-agents, and a lasting failure is the banner above the last list.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { ChatsFilterMenu } from '@/components/chats-filter-menu';
import { EmptyState } from '@/components/empty-state';
import { Fab, useFabCollapse } from '@/components/fab';
import { Fade } from '@/components/motion';
import { MoreButton, Shelf } from '@/components/list-group';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { ListSkeleton } from '@/components/skeletons';
import { GlyphBadge, ThreadRow } from '@/components/thread-row';
import { describeConnectFailure } from '@/features/host/connect-failure';
import { blocksScreen, useFailureGrace } from '@/features/host/failure-grace';
import { agoLabel } from '@/features/host/host-card-model';
import { agentAge, agoShort, flattenPanes, paneRoute, paneTitle, reportsAges, type FlatPane } from '@/features/host/pane-model';
import { useHostFeedback, useHostInstance, usePersonalAgentOverview, useTreeV3 } from '@/features/host/queries-v3';
import { threadMatch, threadSections } from '@/features/host/thread-model';
import { HostV3Error } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useBackHandler } from '@/lib/use-back-handler';
import { usePhoneNetwork } from '@/lib/use-phone-network';
import { useNow } from '@/lib/use-now';
import { IconEdit, IconFilter, IconInbox, IconFilterFilled, IconMessageCircle, IconSearch, IconSparkles, IconWifiOff } from '@/theme/glyphs';
import { colors, type as typeScale } from '@/theme/tokens';

/** How many settled chats the `Earlier` shelf shows before "Show more", and how many each tap adds. */
const EARLIER_PAGE = 6;
const EARLIER_STEP = 20;
/** The list keeps this much clear under its last row so the FAB never covers it. */
const FAB_TAIL = 96;

function Wordmark() {
  return (
    <View style={{ flex: 1, minWidth: 0, paddingLeft: 17, paddingRight: 8 }}>
      <Text color={colors.text} fontSize={typeScale.appbar.fontSize} lineHeight={typeScale.appbar.lineHeight} fontWeight="700" letterSpacing={-0.2} numberOfLines={1}>
        Solco
        <Text color={colors.textMuted} fontSize={typeScale.appbar.fontSize} lineHeight={typeScale.appbar.lineHeight} fontWeight="400" letterSpacing={0}>{' Mobile'}</Text>
      </Text>
    </View>
  );
}

export default function ChatsScreen() {
  const router = useRouter();
  const { connection } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const now = useNow();
  const network = usePhoneNetwork();
  const fab = useFabCollapse();
  const caps = bootstrap.data?.capabilities;
  const overview = usePersonalAgentOverview(caps?.personalAgent === true);
  // The one Feedback line of Chats: only while an Agent's question waits for an answer (zero resident space otherwise).
  const feedbackWaiting = useHostFeedback(caps?.feedback === true).data?.waiting ?? 0;

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [chosenWorkspace, setWorkspaceId] = useState<string | undefined>(undefined);
  const [earlierShown, setEarlierShown] = useState(EARLIER_PAGE);
  // Pull-to-refresh owns the visible spinner; event-driven background refetches stay silent.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void Promise.all([bootstrap.refetch(), tree.refetch()]).finally(() => setRefreshing(false));
  };

  const hostName = connection?.name || bootstrap.data?.hostName || 'Solco';
  const error = (bootstrap.error ?? tree.error) as unknown;
  const failure = error ? (error instanceof HostV3Error ? error : new HostV3Error('transport', String(error))) : null;
  // A network change breaks the reads in flight for a moment: the list stays as it was and refills when the new route
  // answers; only a lasting or non-network failure draws the banner (or, with nothing to show, the whole screen).
  const hasData = bootstrap.data !== undefined && (instance === null || tree.data !== undefined);
  const graceElapsed = useFailureGrace(failure !== null && hasData);
  const blocked = failure !== null && blocksScreen({ failure, hasData, graceElapsed });
  const loading = !blocked && (bootstrap.isLoading || (instance !== null && tree.isLoading));
  const failureView = blocked && failure && connection ? describeConnectFailure(failure, { host: connection.host, port: connection.port, network, tunnel: Boolean(connection.tailcat) }) : null;
  const retry = () => {
    void bootstrap.refetch();
    void tree.refetch();
  };

  const workspaces = useMemo(() => tree.data?.workspaces ?? [], [tree.data]);
  // The choice dies with its Workspace (another computer or session was picked).
  const workspaceId = workspaces.some((workspace) => workspace.id === chosenWorkspace) ? chosenWorkspace : undefined;
  const panes = useMemo(() => flattenPanes(workspaces), [workspaces]);
  const agesKnown = useMemo(() => reportsAges(panes), [panes]);
  const sections = useMemo(() => threadSections(panes, { workspaceId, query }), [panes, workspaceId, query]);
  const chatServed = caps?.chat === true;
  const launchKinds = caps?.launch ? (bootstrap.data?.launchKinds ?? []) : [];
  const filtered = workspaceId !== undefined || query.trim() !== '';

  // The Primary Assistant is pinned first (Assistants live in their own page since 2026-11-07); a workspace filter hides it, a search keeps it when its name matches.
  const primary = overview.data?.assistants.find((row) => row.primary === true);
  const showPrimary = primary !== undefined && workspaceId === undefined && (query.trim() === '' || threadMatch(primary.name, query) !== null);
  const asking = primary ? primary.needsYou + primary.approvals : 0;

  const open = (pane: FlatPane['pane']) => {
    if (instance) router.push(paneRoute(pane, instance, chatServed));
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };
  useBackHandler(searching, closeSearch);

  const topCount = (showPrimary ? 1 : 0) + sections.needsYou.length;
  const total = topCount + sections.working.length + sections.earlier.length;
  const empty = !loading && !blocked && panes.every((item) => !item.pane.agent) && primary === undefined;
  const earlier = filtered ? sections.earlier : sections.earlier.slice(0, earlierShown);
  const hidden = sections.earlier.length - earlier.length;

  const card = (item: FlatPane, status: 'needs' | 'working') => (
    <ThreadRow
      key={item.pane.paneId}
      workspace={item.workspace.label}
      title={paneTitle(item.pane)}
      status={status}
      statusExtra={status === 'working' ? agoShort(item.pane.agent?.lastActiveMs, now) : undefined}
      host={hostName}
      provider={item.pane.agent?.provider}
      query={query}
      onPress={() => open(item.pane)}
    />
  );

  const filter = { icon: workspaceId === undefined ? IconFilter : IconFilterFilled, label: 'Filter chats', onPress: () => setFilterOpen(true) };

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={{ flex: 1 }}>
        <ListSkeleton shelf rows={8} inset />
      </View>
    );
  } else if (blocked && !hasData) {
    body = <EmptyState icon={IconWifiOff} title={failureView?.title ?? 'Can’t reach your computer'} text={failureView ? `${failureView.hint} (${failureView.detail})` : 'Check the connection and try again.'} action="Try again" onAction={retry} />;
  } else if (empty) {
    body = (
      <EmptyState
        flush
        icon={IconMessageCircle}
        title="No chats yet"
        text={`Start an agent from here, or run one in any workspace on ${hostName}.`}
        action={instance && launchKinds.length > 0 ? 'New chat' : undefined}
        onAction={() => router.push('/compose')}
      />
    );
  } else {
    body = (
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: launchKinds.length > 0 ? FAB_TAIL : 24 }}
        scrollEventThrottle={16}
        onScroll={fab.onScroll}
        refreshControl={pullRefresh(refreshing, refresh)}>
        {feedbackWaiting > 0 && !blocked ? (
          <Banner icon={IconInbox} text={feedbackWaiting === 1 ? 'An Agent is waiting for your reply.' : `${feedbackWaiting} Agent questions are waiting for you.`} action="Answer" onAction={() => router.push('/feedback')} />
        ) : null}
        {blocked ? <Banner text={`Can’t reach ${hostName}. Showing the last list from ${agoLabel(tree.dataUpdatedAt, now)}.`} action="Retry" onAction={retry} /> : null}
        {total === 0 ? (
          <EmptyState flush icon={IconSearch} title="No chats match" text="Try another word, or clear the workspace filter." />
        ) : (
          <Fade>
            {topCount > 0 ? (
              <View>
                {showPrimary && primary ? (
                  <ThreadRow
                    badge={<GlyphBadge glyph={IconSparkles} />}
                    title={primary.name}
                    status={asking > 0 ? 'needs' : undefined}
                    time={asking > 0 ? undefined : agoShort(primary.updatedAt, now)}
                    pinned
                    host={hostName}
                    query={query}
                    onPress={() => router.push({ pathname: '/assistants/[id]', params: { id: primary.id } })}
                  />
                ) : null}
                {sections.needsYou.map((item) => card(item, 'needs'))}
              </View>
            ) : null}
            {sections.working.length > 0 ? (
              <View>
                <Shelf label="Working" after={blocked && topCount === 0 ? 'banner' : undefined} />
                {sections.working.map((item) => card(item, 'working'))}
              </View>
            ) : null}
            {earlier.length > 0 ? (
              <View>
                <Shelf label="Earlier" after={blocked && topCount === 0 && sections.working.length === 0 ? 'banner' : undefined} />
                {earlier.map((item) => (
                  <ThreadRow
                    key={item.pane.paneId}
                    slim
                    workspace={item.workspace.label}
                    title={paneTitle(item.pane)}
                    time={agentAge(item.pane, now, agesKnown)}
                    query={query}
                    onPress={() => open(item.pane)}
                  />
                ))}
                {hidden > 0 ? <MoreButton label={`Show more (${hidden} older hidden)`} onPress={() => setEarlierShown((count) => count + EARLIER_STEP)} /> : null}
              </View>
            ) : null}
          </Fade>
        )}
      </ScrollView>
    );
  }

  return (
    <Screen
      back={searching ? closeSearch : undefined}
      bar={searching ? <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" /> : <Wordmark />}
      actions={searching ? [filter] : [{ icon: IconSearch, label: 'Search chats', onPress: () => setSearching(true) }, filter]}>
      {body}
      {instance && launchKinds.length > 0 && !loading && !empty && !(blocked && !hasData) ? (
        <Fab label="New chat" icon={IconEdit} collapsed={fab.collapsed} onPress={() => router.push('/compose')} />
      ) : null}
      <ChatsFilterMenu visible={filterOpen} onClose={() => setFilterOpen(false)} workspaces={workspaces} workspaceId={workspaceId} onWorkspace={setWorkspaceId} />
    </Screen>
  );
}
