// [INPUT]: workspace id, instance and a file path the Host listed; the Host's read-only preview of that file.
// [OUTPUT]: One file: text as numbered monospace rows with syntax colors (horizontal scroll, or wrapped), Markdown as the same text,
//           an image as a picture, "This file can't be previewed" for binary / too-large files; the bar's ⋮ menu copies the path or the
//           contents, wraps lines, and attaches the file to an agent's Chat as an `@path` draft.
// [POS]: Leaf of the read-only Files view. Nothing is written to the Mac; attaching only opens an agent's Chat with the
//        mention as its draft — the user reviews and sends (the Share to Solco pattern).
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Image, Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from 'tamagui';

import { Banner } from '@/components/banner';
import { EmptyState } from '@/components/empty-state';
import { Menu, MenuItem } from '@/components/menu';
import { Skeleton } from '@/components/motion';
import { OptionSheet } from '@/components/option-sheet';
import { Screen } from '@/components/screen';
import { ThreadRow } from '@/components/thread-row';
import { useToast } from '@/components/toast';
import { attachText, baseName, filesFailureMessage, parentDir, previewNotice } from '@/features/host/files-model';
import { agentAge, comparePanes, flattenPanes, paneRoute, paneTitle, reportsAges, type FlatPane } from '@/features/host/pane-model';
import { useFileContent, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { highlightLines, languageOf, type Tone } from '@/features/host/syntax';
import { useNow } from '@/lib/use-now';
import { IconDotsVertical, IconFile } from '@/theme/glyphs';
import { colors, monoFont, themed } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const FONT = 12;
const CHAR = FONT * 0.61;
const GUTTER = 46;
const MONO = Platform.OS === 'ios' ? monoFont.ios : monoFont.android;
const TONE: Record<Tone, string> = themed(() => ({ plain: colors.text, keyword: colors.syntaxKeyword, string: colors.syntaxString, comment: colors.textMuted, name: colors.syntaxName }));
const SKELETON_WIDTHS = [60, 40, 72, 52, 80, 36, 66, 48, 74, 58, 44, 70, 38, 62] as const;

export default function FileViewScreen() {
  const router = useRouter();
  const now = useNow();
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; path: string; title?: string }>();
  const workspaceId = first(params.workspaceId);
  const path = first(params.path);
  const { bootstrap, instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const file = useFileContent(instance, workspaceId, path);
  const tree = useTreeV3(instance);
  const { width: screen } = useWindowDimensions();
  const { toast, show } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const chatServed = bootstrap.data?.capabilities.chat === true;
  const data = file.data;
  const isText = data !== undefined && data.content != null && data.flavor !== 'image' && data.flavor !== 'binary';
  const lines = useMemo(
    () => (isText && data?.content != null ? highlightLines(data.content, languageOf(path)).map((line) => line.map((segment) => ({ ...segment, text: segment.text.replace(/\t/g, '    ') }))) : []),
    [isText, data, path],
  );
  const longest = useMemo(() => lines.reduce((max, line) => Math.max(max, line.reduce((n, segment) => n + segment.text.length, 0)), 0), [lines]);
  const width = wrap ? screen : Math.max(screen, GUTTER + longest * CHAR + 24);
  const notice = data ? previewNotice(data) : null;
  const unavailable = data !== undefined && (data.flavor === 'binary' || (data.flavor === 'image' && (data.tooLarge === true || !data.dataUrl || data.dataUrl.startsWith('data:image/svg+xml'))));
  const picture = data?.flavor === 'image' && data.dataUrl && !unavailable ? data.dataUrl : null;

  const agents = useMemo(
    () => flattenPanes(tree.data?.workspaces ?? []).filter((item) => item.pane.agent).sort((a, b) => comparePanes(a.pane, b.pane)),
    [tree.data],
  );
  const agesKnown = reportsAges(agents);
  // The Chat route carries the mention as its draft; the user reviews and sends.
  const attachTo = (pane: FlatPane['pane']) => {
    if (!instance) return;
    setAttaching(false);
    const route = paneRoute(pane, instance, chatServed);
    router.push(route.pathname === '/chat/[paneId]' ? { ...route, params: { ...route.params, draft: attachText(path) } } : route);
  };

  const copy = async (text: string, done: string) => {
    setMenuOpen(false);
    await Clipboard.setStringAsync(text);
    show(done);
  };

  let body: React.ReactNode;
  if (file.isLoading) {
    body = (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading file" style={{ gap: 10, paddingVertical: 12, paddingHorizontal: 16 }}>
        {SKELETON_WIDTHS.map((w, index) => (
          <Skeleton key={index} height={14} width={`${w}%`} />
        ))}
      </View>
    );
  } else if (file.error && data === undefined) {
    body = <EmptyState icon={IconFile} title="Can’t open this file" text={filesFailureMessage(file.error)} />;
  } else if (unavailable) {
    body = <EmptyState icon={IconFile} title="This file can’t be previewed" text={data?.flavor === 'image' && !data.tooLarge && notice ? notice : 'It is binary or larger than the phone preview limit. Open it on the Mac.'} />;
  } else if (picture) {
    body = <Image source={{ uri: picture }} resizeMode="contain" style={{ flex: 1 }} accessibilityLabel={baseName(path)} />;
  } else {
    const list = (
      <FlatList
        data={lines}
        keyExtractor={(_, index) => String(index)}
        initialNumToRender={50}
        windowSize={9}
        style={{ width }}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 24 }}
        renderItem={({ item, index }) => (
          <View style={{ flexDirection: 'row', width }}>
            <Text width={GUTTER} paddingRight={7} textAlign="right" color={colors.textMuted} fontSize={FONT - 1} lineHeight={22} fontFamily={MONO}>{index + 1}</Text>
            <Text flexShrink={wrap ? 1 : 0} paddingRight={16} color={colors.text} fontSize={FONT} lineHeight={22} fontFamily={MONO}>
              {item.map((segment, at) => (segment.tone === 'plain' ? segment.text : <Text key={at} color={TONE[segment.tone]} fontSize={FONT} lineHeight={22} fontFamily={MONO}>{segment.text}</Text>))}
            </Text>
          </View>
        )}
      />
    );
    body = (
      <View style={{ flex: 1 }}>
        {notice ? <Banner text={notice} /> : null}
        {wrap ? list : <ScrollView horizontal showsHorizontalScrollIndicator>{list}</ScrollView>}
      </View>
    );
  }

  return (
    <Screen
      back
      title={baseName(path)}
      subtitle={parentDir(path) || first(params.title) || undefined}
      actions={[{ icon: IconDotsVertical, label: 'More', onPress: () => setMenuOpen(true) }]}>
      {body}
      {toast}
      <Menu visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <MenuItem label="Copy path" onPress={() => void copy(path, 'Path copied')} />
        {isText && data?.content != null ? <MenuItem label="Copy contents" onPress={() => void copy(data.content ?? '', data.truncated ? 'Copied the first 1 MB' : 'Contents copied')} /> : null}
        {isText ? (
          <MenuItem
            label="Wrap lines"
            checked={wrap}
            onPress={() => {
              setWrap((on) => !on);
              setMenuOpen(false);
            }}
          />
        ) : null}
        {chatServed ? (
          <MenuItem
            label="Attach to chat"
            onPress={() => {
              setMenuOpen(false);
              setAttaching(true);
            }}
          />
        ) : null}
      </Menu>
      <OptionSheet visible={attaching} title="Attach to chat" subtitle={`@${baseName(path)}`} onClose={() => setAttaching(false)}>
        {agents.map((item) => (
          <ThreadRow
            key={item.pane.paneId}
            workspace={item.workspace.label}
            title={paneTitle(item.pane)}
            status={item.pane.agent?.status === 'blocked' ? 'needs' : item.pane.agent?.status === 'working' ? 'working' : undefined}
            time={item.pane.agent?.status === 'blocked' || item.pane.agent?.status === 'working' ? undefined : agentAge(item.pane, now, agesKnown)}
            slim={item.pane.agent?.status !== 'blocked' && item.pane.agent?.status !== 'working'}
            onPress={() => attachTo(item.pane)}
          />
        ))}
        {agents.length === 0 ? <Text color={colors.textMuted} fontSize={14} lineHeight={19} paddingHorizontal={16} paddingTop={8}>No agent is running.</Text> : null}
      </OptionSheet>
    </Screen>
  );
}
