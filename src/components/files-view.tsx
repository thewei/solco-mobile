// [INPUT]: an instance + workspace id and the Host's read-only listing of the Workspace folder, one folder at a time.
// [OUTPUT]: FilesTree — the Workspace's file tree: folders first, a chevron that turns as a folder opens in place (its children load
//           on first open and indent 16 dp per level), files with a filled glyph that open the file viewer; pull to refresh;
//           the loading / empty / error states of designs/mobile-t3-redesign. Links are shown dimmed, never followed.
// [POS]: The read-only Files body of `/files/[workspaceId]`. It never writes, renames or deletes, and nothing here moves the Mac's focus.
//        The Host hides ignored files (the desktop's own ignore rules), so "Show ignored files" is not offered; searching is FilesSearchResults.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Fade, Skeleton } from '@/components/motion';
import { pullRefresh } from '@/components/pull-refresh';
import type { FileEntry } from '@/contracts/host-v3';
import { filesFailureMessage, openable } from '@/features/host/files-model';
import { useFilesList } from '@/features/host/queries-v3';
import { IconChevronRight, IconFileFilled, IconFolder, IconLink } from '@/theme/glyphs';
import { colors, type as typeScale } from '@/theme/tokens';

/** Row indent: 12 dp, plus 16 dp per level. */
const indent = (depth: number) => 12 + depth * 16;

function TreeRow({ entry, depth, open, onPress }: { entry: FileEntry; depth: number; open: boolean; onPress: () => void }) {
  const dir = entry.kind === 'dir';
  const live = openable(entry);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entry.name}
      accessibilityState={dir ? { expanded: open } : undefined}
      disabled={!live}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingLeft: indent(depth), paddingRight: 17, opacity: live ? 1 : 0.55, backgroundColor: pressed ? colors.rowPressed : 'transparent' })}>
      <View style={{ width: 16, alignItems: 'center', transform: [{ rotate: open ? '90deg' : '0deg' }] }}>{dir ? <Icon as={IconChevronRight} size="sm" tone="muted" stroke={2.4} /> : null}</View>
      <View style={{ width: 20, alignItems: 'center' }}>
        <Icon as={dir ? IconFolder : entry.kind === 'symlink' ? IconLink : IconFileFilled} size="md" tone="muted" />
      </View>
      <Text flex={1} minWidth={0} color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight} numberOfLines={1}>{entry.name}</Text>
    </Pressable>
  );
}

function RowsSkeleton({ rows, depth }: { rows: number; depth: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading files" style={{ paddingTop: depth === 0 ? 8 : 0 }}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingLeft: indent(depth) + 17 - 12, paddingRight: 17 }}>
          <Skeleton width={20} height={20} />
          <Skeleton height={16} width={`${30 + ((index * 13) % 40)}%`} />
        </View>
      ))}
    </View>
  );
}

/** One folder's children; mounts only while the folder is open, so closed folders cost nothing. */
function Level({ instance, workspaceId, dir, depth, openDirs, toggle, openFile }: { instance: string | null; workspaceId: string; dir: string; depth: number; openDirs: ReadonlySet<string>; toggle: (path: string) => void; openFile: (path: string) => void }) {
  const list = useFilesList(instance, workspaceId, dir);
  if (list.isLoading) return <RowsSkeleton rows={depth === 0 ? 12 : 2} depth={depth} />;
  if (list.error && !list.data) {
    return <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingVertical={10} paddingLeft={indent(depth) + 20} paddingRight={17}>{filesFailureMessage(list.error)}</Text>;
  }
  const entries = list.data?.entries ?? [];
  return (
    <>
      {entries.map((entry) => {
        const isDir = entry.kind === 'dir';
        const open = isDir && openDirs.has(entry.path);
        return (
          <Fragment key={entry.path}>
            <TreeRow entry={entry} depth={depth} open={open} onPress={() => (isDir ? toggle(entry.path) : openFile(entry.path))} />
            {open ? <Level instance={instance} workspaceId={workspaceId} dir={entry.path} depth={depth + 1} openDirs={openDirs} toggle={toggle} openFile={openFile} /> : null}
          </Fragment>
        );
      })}
      {list.data?.truncated ? (
        <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingVertical={8} paddingLeft={indent(depth) + 20} paddingRight={17}>{`Showing the first ${entries.length} entries.`}</Text>
      ) : null}
    </>
  );
}

export function FilesTree({ instance, workspaceId, title, hostName }: { instance: string | null; workspaceId: string; title: string; hostName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const root = useFilesList(instance, workspaceId, '');
  const [openDirs, setOpenDirs] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) =>
    setOpenDirs((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const openFile = (path: string) => router.push({ pathname: '/files/view', params: { workspaceId, instance: instance ?? '', title, path } });
  const retry = () => void queryClient.invalidateQueries({ queryKey: ['v3', 'files', instance, workspaceId] });

  if (root.isLoading) return <RowsSkeleton rows={12} depth={0} />;
  if (root.error && !root.data) {
    return (
      <View style={{ flex: 1 }}>
        <Banner tone="bad" text={`Can’t read this workspace. ${filesFailureMessage(root.error)} (${hostName})`} action="Retry" onAction={retry} />
        <EmptyState icon={IconFolder} title="Files unavailable" text="Check the host in Settings, then try again." action="Open Hosts" onAction={() => router.push('/connect')} />
      </View>
    );
  }
  if (root.data && root.data.entries.length === 0) {
    return <EmptyState icon={IconFolder} title="Nothing to show" text="This workspace folder is empty, or everything in it is ignored." />;
  }
  return (
    <ScrollView refreshControl={pullRefresh(root.isRefetching, retry)} contentContainerStyle={{ paddingBottom: 24 }}>
      <Fade>
        <Level instance={instance} workspaceId={workspaceId} dir="" depth={0} openDirs={openDirs} toggle={toggle} openFile={openFile} />
      </Fade>
    </ScrollView>
  );
}
