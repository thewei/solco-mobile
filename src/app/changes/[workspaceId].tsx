// [INPUT]: a workspace id (+ instance, title) — reached from the Chat menu, the Workspace page and Review's empty state; the Host's Git status.
// [OUTPUT]: Git controls: the branch as the bar title with "N files changed · N ahead", then Commit / Push / Pull / Review changes / Fetch
//           rows (each only when it applies); Commit opens the message sheet (Commit, or Commit & push), Push and Pull ask first, a
//           refusal is one banner sentence, a success one toast.
// [POS]: The Git hub of a Workspace (designs/mobile-t3-redesign `git`). Every write is one explicit tap against the Host, which answers the
//        repository as it is afterwards; nothing here discards, resets or resolves anything, and nothing moves the Mac's focus.
//        The writes need `capabilities.gitWrite`; without it only Review (read-only) remains.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import { Banner } from '@/components/banner';
import { CommitSheet, type CommitAction } from '@/components/commit-sheet';
import { EmptyState } from '@/components/empty-state';
import { ListRow, Section } from '@/components/list-group';
import { pullRefresh } from '@/components/pull-refresh';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { useToast } from '@/components/toast';
import { branchName, commitAllPlan, controlsSubtitle, fetchedLine, gitFailureMessage, gitWriteFailureMessage, syncActions, type SyncAction } from '@/features/host/git-model';
import { useGitStatus, useGitWrite, useHostInstance, type GitJob } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { IconArrowDown, IconArrowUp, IconFileDiff, IconGitBranch, IconGitCommit, IconRefresh } from '@/theme/glyphs';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const SYNC_ICON = { push: IconArrowUp, pull: IconArrowDown, fetch: IconRefresh } as const;
const commits = (n: number) => `${n} commit${n === 1 ? '' : 's'}`;

export default function GitControlsScreen() {
  const router = useRouter();
  const now = useNow();
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; title?: string }>();
  const workspaceId = first(params.workspaceId);
  const { bootstrap, instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const status = useGitStatus(instance, workspaceId);
  const canWrite = bootstrap.data?.capabilities.gitWrite === true;
  const write = useGitWrite(instance, workspaceId);
  const busy = write.isPending;
  const { toast, show } = useToast();
  const [failure, setFailure] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitKey, setCommitKey] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const data = status.data;
  const plan = useMemo(() => (data ? commitAllPlan(data) : null), [data]);
  const actions = useMemo(() => (data ? syncActions(data) : []), [data]);
  const fetchAction = actions.find((action) => action.op === 'fetch');
  const toRemote = actions.filter((action) => action.op !== 'fetch');
  const clean = data !== undefined && data.files.length === 0;

  const run = async (job: GitJob) => {
    setFailure(null);
    try {
      return await write.mutateAsync(job);
    } catch (error) {
      setFailure(gitWriteFailureMessage(error));
      return null;
    }
  };

  const sync = (action: SyncAction) => {
    const go = async () => {
      const result = await run({ kind: 'sync', op: action.op, head: data?.head });
      if (!result) return;
      if (action.op === 'fetch') setFetchedAt(Date.now());
      show(
        action.op === 'fetch'
          ? 'Fetched'
          : action.op === 'pull'
            ? `Pulled ${commits(data?.upstream?.behind ?? 0)}`
            : data?.upstream
              ? `Pushed to ${data.upstream.name}`
              : `Published ${data?.branch ?? 'the branch'}`,
      );
    };
    if (!action.confirm) return void go();
    Alert.alert(action.confirm.title, action.confirm.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.confirm.button, onPress: () => void go() },
    ]);
  };

  // Stage what is not staged yet, then commit every listed file; "& push" publishes the new commit right after.
  const commit = async (subject: string, body: string, thenPush: boolean) => {
    if (!plan) return;
    setCommitError(null);
    try {
      let head = data?.head;
      if (plan.toStage.length > 0) head = (await write.mutateAsync({ kind: 'stage', paths: plan.toStage })).status.head;
      const result = await write.mutateAsync({ kind: 'commit', request: { subject, body: body || undefined, paths: plan.paths, head } });
      setCommitting(false);
      setCommitKey((key) => key + 1);
      const done = result.hash ? `Committed ${result.hash}` : 'Committed';
      if (!thenPush) return show(done);
      const pushed = await run({ kind: 'sync', op: 'push', head: result.status.head });
      show(pushed ? `${done} and pushed` : done);
    } catch (error) {
      setCommitError(gitWriteFailureMessage(error));
    }
  };

  const sheetActions: CommitAction[] = [
    { label: 'Commit', tone: 'tonal', onPress: (subject, body) => void commit(subject, body, false) },
    { label: 'Commit & push', tone: 'primary', onPress: (subject, body) => void commit(subject, body, true) },
  ];
  const sheetNotes = plan?.truncated ? [`Only the first ${plan.paths.length} changed files are listed; the rest are not part of this commit.`] : [];

  const review = () => {
    if (clean) return show('Nothing to review');
    router.push({ pathname: '/changes/review', params: { workspaceId, instance: instance ?? '', title: first(params.title) } });
  };

  const pullAction = toRemote.find((action) => action.op === 'pull');
  let body: React.ReactNode;
  if (status.isLoading) {
    body = <ListSkeleton rows={4} inset />;
  } else if (status.error && data === undefined) {
    body = <EmptyState icon={IconGitBranch} title="Can’t read changes" text={gitFailureMessage(status.error)} action="Retry" onAction={() => void status.refetch()} />;
  } else if (data && !data.repo) {
    body = <EmptyState icon={IconGitBranch} title="Not a Git repository" text="This workspace’s folder has no Git history to compare." />;
  } else {
    body = (
      <ScrollView refreshControl={pullRefresh(status.isRefetching, () => void status.refetch())} contentContainerStyle={{ paddingBottom: 24 }}>
        {failure ? <Banner tone="bad" text={failure} action={pullAction && canWrite ? pullAction.label : undefined} onAction={pullAction ? () => sync(pullAction) : undefined} /> : null}
        <Section first={!failure}>
          {canWrite && plan ? (
            <ListRow
              icon={IconGitCommit}
              label={`Commit ${plan.paths.length}${data?.truncated ? '+' : ''} ${plan.paths.length === 1 ? 'change' : 'changes'}`}
              disabled={busy}
              onPress={() => {
                setCommitError(null);
                setCommitting(true);
              }}
            />
          ) : null}
          {canWrite
            ? toRemote.map((action) => (
                <ListRow key={action.op} icon={SYNC_ICON[action.op as 'push' | 'pull']} label={action.label} description={action.description} disabled={busy} chevron={false} onPress={() => sync(action)} />
              ))
            : null}
          <ListRow icon={IconFileDiff} label="Review changes" description={clean ? 'No uncommitted edits' : undefined} chevron={!clean} onPress={review} />
          {canWrite && fetchAction ? (
            <ListRow icon={IconRefresh} label="Fetch" description={fetchedAt === null ? fetchAction.description : fetchedLine(fetchedAt, now)} disabled={busy} chevron={false} onPress={() => sync(fetchAction)} />
          ) : null}
        </Section>
      </ScrollView>
    );
  }

  return (
    <Screen
      back
      title={data?.repo ? branchName(data) : first(params.title) || 'Changes'}
      subtitle={data?.repo ? controlsSubtitle(data) : undefined}
      actions={[{ icon: IconRefresh, label: 'Refresh status', onPress: () => void status.refetch() }]}
      overlay={
        <CommitSheet
          key={commitKey}
          visible={committing && plan !== null}
          summary={plan ? `${plan.paths.length} ${plan.paths.length === 1 ? 'file' : 'files'} · everything will be committed` : ''}
          notes={sheetNotes}
          busy={busy}
          error={commitError}
          actions={sheetActions}
          onClose={() => setCommitting(false)}
        />
      }>
      {body}
      {toast}
    </Screen>
  );
}
