// [INPUT]: an instance + workspace id (+ title, dir) and the Host's read-only listing of that folder level.
// [OUTPUT]: FilesView — one folder level: folders first, a file shows its size; a folder row opens the Files screen one
//           level down, a file row opens its preview. Pull to refresh; "empty" and failures are states, not crashes.
// [POS]: The read-only Files body shared by the Files tab (the project's root) and the pushed Files screen (deeper
//        levels). It never writes, renames or deletes; links are shown but not followed; nothing here moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ChevronRight, File, Folder, Link2 } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { pullRefresh } from '@/components/pull-refresh';
import { CardRow } from '@/components/section';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';
import type { FileEntry } from '@/contracts/host-v3';
import { filesFailureMessage, openable, sizeLabel } from '@/features/host/files-model';
import { useFilesList } from '@/features/host/queries-v3';
import { colors, row, spacing } from '@/theme/tokens';

function EntryRow({ entry, onPress }: { entry: FileEntry; onPress: () => void }) {
  const dir = entry.kind === 'dir';
  const live = openable(entry);
  return (
    <Tap role="button" accessibilityLabel={entry.name} onPress={live ? onPress : undefined}>
      <XStack alignItems="center" gap={row.gap} paddingHorizontal={row.padX} minHeight={48} opacity={live ? 1 : 0.55}>
        <Icon as={dir ? Folder : entry.kind === 'symlink' ? Link2 : File} size="md" tone={dir ? 'accent' : 'muted'} />
        <Text flex={1} color={colors.text} fontSize={14.5} fontWeight={dir ? '650' : '500'} numberOfLines={1}>{entry.name}</Text>
        {dir ? <Icon as={ChevronRight} size="sm" tone="subtle" /> : <Text color={colors.textSubtle} fontSize={12}>{entry.kind === 'symlink' ? 'link' : sizeLabel(entry.size)}</Text>}
      </XStack>
    </Tap>
  );
}

export function FilesView({ instance, workspaceId, title, dir }: { instance: string | null; workspaceId: string; title: string; dir: string }) {
  const router = useRouter();
  const list = useFilesList(instance, workspaceId, dir);
  const entries = list.data?.entries ?? [];
  const base = { workspaceId, instance: instance ?? '', title };

  const open = (entry: FileEntry) =>
    router.push(entry.kind === 'dir' ? { pathname: '/files/[workspaceId]', params: { ...base, dir: entry.path } } : { pathname: '/files/view', params: { ...base, path: entry.path } });

  return (
    <>
    {list.isLoading ? (
      <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={6} /></YStack>
    ) : (
      <FlatList
        style={{ flex: 1 }}
        data={entries}
        keyExtractor={(entry) => entry.path}
        initialNumToRender={20}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, flexGrow: 1 }}
        refreshControl={pullRefresh(list.isRefetching, () => void list.refetch())}
        renderItem={({ item, index }) => (
          <CardRow first={index === 0} last={index === entries.length - 1}>
            <EntryRow entry={item} onPress={() => open(item)} />
          </CardRow>
        )}
        ListHeaderComponent={dir ? <Text color={colors.textSubtle} fontSize={12} paddingBottom="$2" numberOfLines={1}>{dir}/</Text> : null}
        ListFooterComponent={list.data?.truncated ? <Text color={colors.textSubtle} fontSize={12} paddingHorizontal={row.padX} paddingTop="$2">Showing the first {entries.length} entries.</Text> : null}
        ListEmptyComponent={
          list.error ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this folder</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{filesFailureMessage(list.error)}</Text>
            </YStack>
          ) : list.data ? (
            <YStack flex={1} alignItems="center" justifyContent="center" padding="$6">
              <Text color={colors.textMuted} fontSize={13}>This folder is empty.</Text>
            </YStack>
          ) : null
        }
      />
    )}
    </>
  );
}
