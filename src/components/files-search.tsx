// [INPUT]: an instance + workspace id, the debounced and trimmed search term, and the Host's file-name search (needs `capabilities.filesSearch`).
// [OUTPUT]: FilesSearchResults — the ranked hits as two-line rows (the name over its folder path, the typed words marked in the name), a note
//           under them when more matched than fit or the workspace is too large to search completely, and the loading / no-match / failed
//           faces of designs/mobile-t3-redesign (`files` search, search-loading, search-empty, search-error).
// [POS]: The body of `/files/[workspaceId]` while the bar's search holds text; it takes the tree's place and gives it back when the text is
//        cleared. Read-only like the tree: a row opens the same file viewer, nothing is written, nothing moves the Mac's focus. The Host
//        ranks (names before folders, shorter before longer) and answers only files `files/content` can serve, so a row always opens.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { Skeleton } from '@/components/motion';
import { baseName, markWords, parentDir, searchFailure, searchNote } from '@/features/host/files-model';
import { useFilesSearch } from '@/features/host/queries-v3';
import { IconFileFilled, IconSearch } from '@/theme/glyphs';
import { colors, type as typeScale } from '@/theme/tokens';

function HitRow({ path, term, onPress }: { path: string; term: string; onPress: () => void }) {
  const name = baseName(path);
  const dir = parentDir(path);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={path}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6, paddingHorizontal: 17, backgroundColor: pressed ? colors.rowPressed : 'transparent' })}>
      <View style={{ width: 20, alignItems: 'center' }}>
        <Icon as={IconFileFilled} size="md" tone="muted" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight} numberOfLines={1}>
          {markWords(name, term).map(([run, typed], index) =>
            typed ? (
              <Text key={index} backgroundColor={colors.highlight} color={colors.text} fontSize={typeScale.body.fontSize} lineHeight={typeScale.body.lineHeight}>{run}</Text>
            ) : (
              run
            ),
          )}
        </Text>
        {dir ? <Text color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} numberOfLines={1}>{dir}</Text> : null}
      </View>
    </Pressable>
  );
}

function HitsSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Searching files" style={{ paddingTop: 4 }}>
      {Array.from({ length: 7 }, (_, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 17 }}>
          <Skeleton width={20} height={20} />
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton height={16} width={`${60 - (index % 3) * 12}%`} />
            <Skeleton height={12} width={`${74 - (index % 4) * 10}%`} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function FilesSearchResults({ instance, workspaceId, title, term, hostName }: { instance: string | null; workspaceId: string; title: string; term: string; hostName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = useFilesSearch(instance, workspaceId, term);
  const openFile = (path: string) => router.push({ pathname: '/files/view', params: { workspaceId, instance: instance ?? '', title, path } });

  if (search.error && !search.data) {
    const failure = searchFailure(search.error, hostName);
    return <EmptyState icon={IconSearch} title={failure.title} text={failure.text} action={failure.retry ? 'Try again' : undefined} onAction={() => void queryClient.invalidateQueries({ queryKey: ['v3', 'files', instance, workspaceId, 'search'] })} />;
  }
  // No answer yet: the term has not settled (the first keystrokes) or the first search is on its way.
  if (!search.data) return <HitsSkeleton />;
  if (search.data.hits.length === 0) return <EmptyState icon={IconSearch} title="No files match" text="Try fewer or different words." />;
  const note = searchNote(search.data);
  return (
    <FlatList
      data={search.data.hits}
      keyExtractor={(path) => path}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}
      renderItem={({ item }) => <HitRow path={item} term={term} onPress={() => openFile(item)} />}
      ListFooterComponent={note ? <Text color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} paddingHorizontal={17} paddingTop={8}>{note}</Text> : null}
    />
  );
}
