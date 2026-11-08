// [INPUT]: a workspace id (+ instance, title, and optionally a file path to open); the Host's Git status and per-file diffs.
// [OUTPUT]: Review changes: an Unstaged / Staged switch over the changed files — a letter tile, name over folder, +/− counts and a
//           stage circle per row; tapping a row opens that file's diff under it; a sticky "Commit N staged files" bar opens the message sheet.
// [POS]: The review surface of a Workspace (designs/mobile-t3-redesign `review`); it replaces the old file list + single-diff screens.
//        Staging is one explicit tap per file against the Host (which answers the fresh status); a file edited after staging is
//        honestly in both lists. Without `capabilities.gitWrite` it is read-only: no circles, no commit bar.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { CommitSheet } from '@/components/commit-sheet';
import { DiffCard } from '@/components/diff-card';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { ListSkeleton } from '@/components/skeletons';
import { StatusBadge } from '@/components/status-badge';
import { useToast } from '@/components/toast';
import type { GitFile } from '@/contracts/host-v3';
import { commitPlan, fileParts, gitFailureMessage, gitWriteFailureMessage, reviewLists, summaryLine } from '@/features/host/git-model';
import { useGitStatus, useGitWrite, useHostInstance } from '@/features/host/queries-v3';
import { IconCircle, IconCircleCheck, IconCircleCheckFilled, IconFileDiff, IconGitBranch } from '@/theme/glyphs';
import { colors, metrics, monoFont, type as typeScale } from '@/theme/tokens';

type Tab = 'u' | 's';
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const MONO = Platform.OS === 'ios' ? monoFont.ios : monoFont.android;

function FileRow({ file, open, staged, canStage, busy, onToggle, onStage }: { file: GitFile; open: boolean; staged: boolean; canStage: boolean; busy: boolean; onToggle: () => void; onStage: () => void }) {
  const { name, dir } = fileParts(file.path);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingLeft: 17, paddingRight: 8 }}>
      <StatusBadge status={file.status} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${open ? 'hide' : 'show'} changes`}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'center' }}>
        <Text color={colors.text} fontSize={typeScale.label.fontSize} lineHeight={20} fontWeight="500" numberOfLines={1}>{name}</Text>
        {dir ? <Text color={colors.textMuted} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} numberOfLines={1}>{dir}</Text> : null}
      </Pressable>
      {file.binary ? (
        <Text color={colors.textMuted} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight}>binary</Text>
      ) : (
        <Text fontFamily={MONO} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} color={colors.textMuted}>
          {file.additions > 0 ? <Text fontFamily={MONO} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} color={colors.success}>+{file.additions}</Text> : null}
          {file.additions > 0 && file.deletions > 0 ? ' ' : ''}
          {file.deletions > 0 ? <Text fontFamily={MONO} fontSize={typeScale.caption.fontSize} lineHeight={typeScale.caption.lineHeight} color={colors.danger}>−{file.deletions}</Text> : null}
        </Text>
      )}
      {canStage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${staged ? 'Unstage' : 'Stage'} ${name}`}
          accessibilityState={{ selected: staged, disabled: busy }}
          disabled={busy}
          onPress={onStage}
          style={{ width: metrics.touch, height: metrics.touch, borderRadius: metrics.touch / 2, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}>
          <Icon as={staged ? IconCircleCheckFilled : IconCircle} size="lg" tone={staged ? 'accent' : 'muted'} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; title?: string; path?: string }>();
  const workspaceId = first(params.workspaceId);
  const focusPath = first(params.path);
  const { bootstrap, instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const status = useGitStatus(instance, workspaceId);
  const canWrite = bootstrap.data?.capabilities.gitWrite === true;
  const write = useGitWrite(instance, workspaceId);
  const { toast, show } = useToast();
  const [picked, setPicked] = useState<Tab | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(focusPath ? [`u:${focusPath}`, `s:${focusPath}`] : []));
  const [failure, setFailure] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitKey, setCommitKey] = useState(0);

  const data = status.data;
  const lists = useMemo(() => reviewLists(data?.files ?? []), [data]);
  const plan = useMemo(() => (data ? commitPlan(data) : null), [data]);
  // A file sent here from a Chat link opens on the side it is on (unstaged first).
  const tab: Tab = picked ?? (focusPath && !lists.unstaged.some((f) => f.path === focusPath) && lists.staged.some((f) => f.path === focusPath) ? 's' : 'u');
  const shown = tab === 'u' ? lists.unstaged : lists.staged;
  const empty = data !== undefined && data.repo && data.files.length === 0;
  const inFlight = write.variables && 'paths' in write.variables && write.isPending ? write.variables.paths : [];

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const stage = async (file: GitFile, staged: boolean) => {
    setFailure(null);
    try {
      await write.mutateAsync({ kind: staged ? 'unstage' : 'stage', paths: [file.path] });
    } catch (error) {
      setFailure(gitWriteFailureMessage(error));
    }
  };

  const commit = async (subject: string, body: string) => {
    if (!plan) return;
    setCommitError(null);
    try {
      const result = await write.mutateAsync({ kind: 'commit', request: { subject, body: body || undefined, paths: plan.paths, head: data?.head } });
      setCommitting(false);
      setCommitKey((key) => key + 1);
      show(result.hash ? `Committed ${result.hash}` : 'Committed');
    } catch (error) {
      setCommitError(gitWriteFailureMessage(error));
    }
  };

  const mixed = plan?.alsoUnstaged.length ?? 0;
  const notes = mixed > 0 ? [`${mixed === 1 ? '1 staged file was edited again after staging' : `${mixed} staged files were edited again after staging`} — those edits are committed too.`] : [];
  const stagedCount = lists.staged.length;

  let body: React.ReactNode;
  if (status.isLoading) {
    body = <ListSkeleton rows={4} inset />;
  } else if (status.error && data === undefined) {
    body = <EmptyState icon={IconFileDiff} title="Can’t read changes" text={gitFailureMessage(status.error)} action="Retry" onAction={() => void status.refetch()} />;
  } else if (data && !data.repo) {
    body = <EmptyState icon={IconGitBranch} title="Not a Git repository" text="This workspace’s folder has no Git history to compare." />;
  } else if (empty) {
    body = (
      <EmptyState
        icon={IconCircleCheck}
        title="Nothing to review"
        text="No uncommitted edits."
        action="Back to Git controls"
        onAction={() => router.replace({ pathname: '/changes/[workspaceId]', params: { workspaceId, instance: instance ?? '', title: first(params.title) } })}
      />
    );
  } else {
    body = (
      <>
        <Segmented
          value={tab}
          onChange={setPicked}
          options={[
            { id: 'u', label: `Unstaged ${lists.unstaged.length}` },
            { id: 's', label: `Staged ${stagedCount}` },
          ]}
        />
        {failure ? <Banner tone="bad" text={failure} action="Dismiss" onAction={() => setFailure(null)} /> : null}
        <FlatList
          style={{ flex: 1 }}
          data={shown}
          extraData={[open, inFlight, canWrite]}
          keyExtractor={(file) => `${tab}:${file.path}`}
          initialNumToRender={12}
          windowSize={7}
          refreshControl={pullRefresh(status.isRefetching, () => void status.refetch())}
          contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
          ListEmptyComponent={
            <EmptyState
              top
              icon={IconCircleCheck}
              title={tab === 'u' ? 'Everything is staged' : 'Nothing staged'}
              text={tab === 'u' ? 'Switch to Staged to commit it.' : canWrite ? 'Tap the circle next to a file to stage it.' : 'Nothing is staged on the Mac.'}
            />
          }
          renderItem={({ item }) => {
            const key = `${tab}:${item.path}`;
            return (
              <View>
                <FileRow
                  file={item}
                  open={open.has(key)}
                  staged={tab === 's'}
                  canStage={canWrite}
                  busy={inFlight.includes(item.path)}
                  onToggle={() => toggle(key)}
                  onStage={() => void stage(item, tab === 's')}
                />
                {open.has(key) ? <DiffCard instance={instance} workspaceId={workspaceId} path={item.path} /> : null}
              </View>
            );
          }}
        />
        {canWrite && plan ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.chrome }}>
            <PillButton
              fill
              size="lg"
              label={`Commit ${plan.paths.length} staged ${plan.paths.length === 1 ? 'file' : 'files'}`}
              disabled={write.isPending}
              onPress={() => {
                setCommitError(null);
                setCommitting(true);
              }}
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Screen
      back
      title="Review changes"
      subtitle={data?.repo ? (empty ? 'No changes' : summaryLine(data)) : undefined}
      overlay={
        <CommitSheet
          key={commitKey}
          visible={committing && plan !== null}
          summary={plan ? `${plan.paths.length} ${plan.paths.length === 1 ? 'file' : 'files'} staged` : ''}
          notes={notes}
          busy={write.isPending}
          error={commitError}
          actions={[{ label: 'Commit staged', tone: 'primary', onPress: (subject, text) => void commit(subject, text) }]}
          onClose={() => setCommitting(false)}
        />
      }>
      {body}
      {toast}
    </Screen>
  );
}
