// [INPUT]: an instance + workspace id and the Host's read-only Git status for that Workspace's folder.
// [OUTPUT]: ChangesView — branch (+ ahead/behind) and the working-tree summary over Staged / Changes / Untracked
//           lists; a row opens that file's diff. Pull to refresh; "not a repository" and "clean" are states, not errors.
//           With `capabilities.gitWrite`: a stage/unstage button on each row and a bulk one on each group, Fetch / Pull /
//           Push under the branch line (Pull and Push ask first), and a Commit bar that opens the subject dialog.
// [POS]: The Git body shared by the Changes tab and the pushed Changes screen. Every write is one explicit tap against the
//        Host (which answers the repository as it is afterwards); nothing here discards, resets or resolves anything,
//        and nothing here moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ChevronRight, Minus, Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { GitCommitSheet } from '@/components/git-commit-sheet';
import { Fade } from '@/components/motion';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { CardRow, SectionLabel } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';
import { StatusBadge } from '@/components/status-badge';
import type { GitFile } from '@/contracts/host-v3';
import {
  branchLine,
  commitPlan,
  fileParts,
  gitFailureMessage,
  gitWriteFailureMessage,
  groupFiles,
  groupPaths,
  summaryLine,
  syncActions,
  type SyncAction,
} from '@/features/host/git-model';
import { useGitStatus, useGitWrite, useHostInstance, type GitJob } from '@/features/host/queries-v3';
import { colors, row, spacing } from '@/theme/tokens';

/** Virtualized list: a group label or one file row of a card (see CardRow). */
type Bulk = { title: string; job: GitJob };
type Entry = { key: string; label: string; bulk?: Bulk } | { key: string; file: GitFile; first: boolean; last: boolean; staged: boolean };

function FileRow({ file, onPress, action }: { file: GitFile; onPress: () => void; action?: { label: string; staged: boolean; busy: boolean; onPress: () => void } }) {
  const { name, dir } = fileParts(file.path);
  return (
    <XStack alignItems="center" minHeight={52}>
      <Tap role="button" accessibilityLabel={file.path} onPress={onPress} flex={1}>
        <XStack alignItems="center" gap={row.gap} paddingLeft={row.padX} paddingRight={action ? 4 : row.padX} paddingVertical={row.padY - 4} minHeight={52}>
          <StatusBadge status={file.status} />
          <YStack flex={1}>
            <Text color={colors.text} fontSize={14.5} fontWeight="600" numberOfLines={1}>{name}</Text>
            {dir ? <Text color={colors.textSubtle} fontSize={11.5} numberOfLines={1}>{dir}</Text> : null}
          </YStack>
          {file.binary ? (
            <Text color={colors.textSubtle} fontSize={11.5}>binary</Text>
          ) : (
            <XStack gap="$1.5">
              {file.additions > 0 ? <Text color={colors.success} fontSize={12} fontWeight="650">+{file.additions}</Text> : null}
              {file.deletions > 0 ? <Text color={colors.danger} fontSize={12} fontWeight="650">−{file.deletions}</Text> : null}
            </XStack>
          )}
          {action ? null : <Icon as={ChevronRight} size="sm" tone="subtle" />}
        </XStack>
      </Tap>
      {action ? (
        <Tap
          role="button"
          accessibilityLabel={`${action.label} ${file.path}`}
          disabled={action.busy}
          opacity={action.busy ? 0.4 : 1}
          onPress={action.onPress}
          width={44}
          height={44}
          alignItems="center"
          justifyContent="center">
          <Icon as={action.staged ? Minus : Plus} size="md" tone={action.staged ? 'muted' : 'accent'} />
        </Tap>
      ) : null}
    </XStack>
  );
}

export function ChangesView({ instance, workspaceId }: { instance: string | null; workspaceId: string }) {
  const router = useRouter();
  const status = useGitStatus(instance, workspaceId);
  const { bootstrap } = useHostInstance();
  const canWrite = bootstrap.data?.capabilities.gitWrite === true;
  const write = useGitWrite(instance, workspaceId);
  const busy = write.isPending;
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitKey, setCommitKey] = useState(0);

  const plan = useMemo(() => (status.data ? commitPlan(status.data) : null), [status.data]);
  const actions = useMemo(() => (status.data ? syncActions(status.data) : []), [status.data]);
  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const group of groupFiles(status.data?.files ?? [])) {
      const paths = groupPaths(group);
      const bulk: Bulk | undefined = !canWrite
        ? undefined
        : group.key === 'staged'
          ? { title: 'Unstage all', job: { kind: 'unstage', paths } }
          : { title: 'Stage all', job: { kind: 'stage', paths } };
      out.push({ key: `label:${group.key}`, label: `${group.title} · ${group.files.length}`, bulk });
      group.files.forEach((file, index) =>
        out.push({ key: `${group.key}:${file.path}`, file, first: index === 0, last: index === group.files.length - 1, staged: group.key === 'staged' }),
      );
    }
    return out;
  }, [status.data, canWrite]);

  const open = (file: GitFile) =>
    router.push({ pathname: '/changes/diff', params: { workspaceId, instance: instance ?? '', path: file.path } });

  const run = async (job: GitJob, done: string) => {
    setNotice(null);
    try {
      await write.mutateAsync(job);
      setNotice({ ok: true, text: done });
    } catch (error) {
      setNotice({ ok: false, text: gitWriteFailureMessage(error) });
    }
  };

  const sync = (action: SyncAction) => {
    const go = () => void run({ kind: 'sync', op: action.op, head: status.data?.head }, action.op === 'fetch' ? 'Fetched' : action.op === 'pull' ? 'Pulled' : 'Pushed');
    if (!action.confirm) return go();
    Alert.alert(action.confirm.title, action.confirm.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.confirm.button, onPress: go },
    ]);
  };

  const commit = async (subject: string, body: string) => {
    if (!plan) return;
    setCommitError(null);
    try {
      const result = await write.mutateAsync({
        kind: 'commit',
        request: { subject, body: body || undefined, paths: plan.paths, head: status.data?.head },
      });
      setCommitting(false);
      setCommitKey((k) => k + 1);
      setNotice({ ok: true, text: result.hash ? `Committed ${result.hash}` : 'Committed' });
    } catch (error) {
      setCommitError(gitWriteFailureMessage(error));
    }
  };

  return (
    <>
    {status.isLoading ? (
      <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
    ) : (
      <FlatList
        style={{ flex: 1 }}
        data={entries}
        keyExtractor={(entry) => entry.key}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 32, flexGrow: 1 }}
        refreshControl={pullRefresh(status.isRefetching, () => void status.refetch())}
        renderItem={({ item }) => {
          if ('label' in item) {
            return (
              <XStack alignItems="flex-end" justifyContent="space-between">
                <SectionLabel>{item.label}</SectionLabel>
                {item.bulk ? (
                  <Tap
                    role="button"
                    accessibilityLabel={item.bulk.title}
                    disabled={busy}
                    opacity={busy ? 0.4 : 1}
                    onPress={() => void run(item.bulk!.job, item.bulk!.job.kind === 'stage' ? 'Staged' : 'Unstaged')}
                    paddingHorizontal={row.padX}
                    paddingBottom={6}>
                    <Text color={colors.accent} fontSize={12} fontWeight="650">{item.bulk.title}</Text>
                  </Tap>
                ) : null}
              </XStack>
            );
          }
          return (
            <CardRow first={item.first} last={item.last}>
              <FileRow
                file={item.file}
                onPress={() => open(item.file)}
                action={
                  canWrite
                    ? {
                        label: item.staged ? 'Unstage' : 'Stage',
                        staged: item.staged,
                        busy,
                        onPress: () => void run({ kind: item.staged ? 'unstage' : 'stage', paths: [item.file.path] }, item.staged ? 'Unstaged' : 'Staged'),
                      }
                    : undefined
                }
              />
            </CardRow>
          );
        }}
        ListHeaderComponent={
          status.data?.repo ? (
            <Fade style={{ paddingVertical: 12, gap: 4 }}>
              <Text color={colors.text} fontSize={17} fontWeight="700" numberOfLines={1}>{branchLine(status.data)}</Text>
              <Text color={colors.textMuted} fontSize={13}>{summaryLine(status.data)}</Text>
              {canWrite && actions.length > 0 ? (
                <XStack gap="$2" paddingTop="$2" flexWrap="wrap">
                  {actions.map((action) => (
                    <PillButton key={action.op} label={action.label} tone="soft" compact disabled={busy} onPress={() => sync(action)} />
                  ))}
                </XStack>
              ) : null}
              {notice ? <Text color={notice.ok ? colors.success : colors.danger} fontSize={13} lineHeight={19} paddingTop="$1">{notice.text}</Text> : null}
            </Fade>
          ) : null
        }
        ListFooterComponent={
          status.data?.truncated ? <Text color={colors.textSubtle} fontSize={12} paddingHorizontal={row.padX} paddingTop="$2">Showing the first {status.data.files.length} files.</Text> : null
        }
        ListEmptyComponent={
          status.error ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read changes</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{gitFailureMessage(status.error)}</Text>
            </YStack>
          ) : status.data && !status.data.repo ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Not a Git repository</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>This workspace’s folder has no Git history to compare.</Text>
            </YStack>
          ) : null
        }
      />
    )}
    {canWrite && plan ? (
      <YStack paddingHorizontal={spacing.screen} paddingTop="$2" paddingBottom="$3" borderTopWidth={1} borderTopColor={colors.border} backgroundColor={colors.canvas}>
        <PillButton
          fill
          label={`Commit ${plan.paths.length} staged ${plan.paths.length === 1 ? 'file' : 'files'}`}
          disabled={busy}
          onPress={() => {
            setCommitError(null);
            setCommitting(true);
          }}
        />
      </YStack>
    ) : null}
    <GitCommitSheet
      key={commitKey}
      visible={committing && plan !== null}
      plan={plan}
      busy={busy}
      error={commitError}
      onSubmit={(subject, body) => void commit(subject, body)}
      onClose={() => setCommitting(false)}
    />
    </>
  );
}
