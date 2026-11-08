// [INPUT]: a workspace id (+ instance, title) — reached from a Chat's folder button and the Workspace page's Files row; the Host's `capabilities.filesSearch`.
// [OUTPUT]: Files screen: the app bar (title "Files", the Workspace as subtitle, a Search button when the Host searches, a Refresh button) over the shared
//           FilesTree; Search takes the bar's place with a field (300 ms debounce) and swaps the tree for FilesSearchResults while it holds text.
// [POS]: The one read-only Files entry; the tree opens folders in place and a file pushes `files/view`. The bottom tabs no longer own Files.
//        Search is the Chats-search pattern (back arrow + field; system Back or the arrow closes it and clears the text); the Host ranks, the phone only asks.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { FilesSearchResults } from '@/components/files-search';
import { FilesTree } from '@/components/files-view';
import { Screen } from '@/components/screen';
import { SearchField } from '@/components/search-field';
import { useHostInstance } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useBackHandler } from '@/lib/use-back-handler';
import { useDebounced } from '@/lib/use-debounced';
import { IconRefresh, IconSearch } from '@/theme/glyphs';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default function FilesScreen() {
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; title?: string }>();
  const workspaceId = first(params.workspaceId);
  const title = first(params.title);
  const queryClient = useQueryClient();
  const { connection } = useHostV3();
  const { bootstrap, instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const hostName = connection?.name || bootstrap.data?.hostName || 'The computer';
  const searchServed = bootstrap.data?.capabilities.filesSearch === true;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const typed = query.trim();
  const term = useDebounced(typed);
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };
  useBackHandler(searching, closeSearch);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['v3', 'files', instance, workspaceId] });
  return (
    <Screen
      back={searching ? closeSearch : true}
      title="Files"
      subtitle={title || undefined}
      bar={searching ? <SearchField value={query} onChangeText={setQuery} placeholder="Search files" /> : undefined}
      actions={
        searching
          ? []
          : [...(searchServed ? [{ icon: IconSearch, label: 'Search files', onPress: () => setSearching(true) }] : []), { icon: IconRefresh, label: 'Refresh files', onPress: refresh }]
      }>
      {searching && typed ? (
        <FilesSearchResults instance={instance} workspaceId={workspaceId} title={title} term={term} hostName={hostName} />
      ) : (
        <FilesTree instance={instance} workspaceId={workspaceId} title={title} hostName={hostName} />
      )}
    </Screen>
  );
}
