// [INPUT]: workspace id, instance and a file path the Host listed; the Host's read-only preview of that file.
// [OUTPUT]: One file: text/Markdown as numbered monospace rows (horizontal scroll), an image as a picture, a sentence for
//           binary / too-large / cut files; "Attach to chat" turns the file into an `@path` draft in a chosen agent's Chat.
// [POS]: Leaf of the read-only Files view. Nothing is written to the Mac; attaching only opens an agent's Chat with the
//        mention as its draft — the user reviews and sends (the Share to Solco pattern).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Paperclip } from 'lucide-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Image, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spinner, Text, XStack, YStack } from 'tamagui';

import { AgentGroups } from '@/components/agent-groups';
import { IconButton } from '@/components/icon-button';
import { attachText, baseName, codeLines, filesFailureMessage, previewNotice } from '@/features/host/files-model';
import { paneRoute, summarize, type FlatPane } from '@/features/host/pane-model';
import { useFileContent, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { colors, monoFont } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const FONT = 12;
const CHAR = FONT * 0.61;
const GUTTER = 44;

export default function FileViewScreen() {
  const router = useRouter();
  const now = useNow();
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; path: string }>();
  const workspaceId = first(params.workspaceId);
  const path = first(params.path);
  const { bootstrap, instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const file = useFileContent(instance, workspaceId, path);
  const tree = useTreeV3(instance);
  const { width: screen } = useWindowDimensions();
  const [picking, setPicking] = useState(false);

  const chatServed = bootstrap.data?.capabilities.chat === true;
  const lines = useMemo(() => (file.data?.content != null ? codeLines(file.data.content) : []), [file.data]);
  const width = useMemo(() => Math.max(screen, GUTTER + lines.reduce((max, line) => Math.max(max, line.length), 0) * CHAR + 24), [lines, screen]);
  const notice = file.data ? previewNotice(file.data) : null;
  const summary = summarize(tree.data?.workspaces ?? []);

  // The Chat route carries the mention as its draft; the user reviews and sends.
  const attachTo = (pane: FlatPane['pane']) => {
    if (!instance) return;
    const route = paneRoute(pane, instance, chatServed);
    router.push(route.pathname === '/chat/[paneId]' ? { ...route, params: { ...route.params, draft: attachText(path) } } : route);
  };

  const canAttach = chatServed && file.data != null;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: baseName(path),
          headerBackTitle: 'Files',
          headerRight: () => (canAttach ? <IconButton as={Paperclip} tone="muted" label="Attach to chat" onPress={() => setPicking((open) => !open)} /> : null),
        }}
      />
      <SafeAreaView style={{ flex: 1, backgroundColor: picking ? colors.canvas : colors.terminal }} edges={['bottom']}>
        {file.isLoading ? (
          <YStack flex={1} alignItems="center" justifyContent="center"><Spinner color={colors.accent} size="large" /></YStack>
        ) : file.error && file.data === undefined ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6">
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{filesFailureMessage(file.error)}</Text>
          </YStack>
        ) : picking ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}>
            <Text color={colors.textMuted} fontSize={13} paddingTop="$3">Attach {baseName(path)} to which agent? Its Chat opens with the mention as the draft.</Text>
            {instance ? <AgentGroups summary={summary} instance={instance} now={now} onOpen={attachTo} /> : null}
            {summary.needsYou.length + summary.working.length + summary.idle.length === 0 ? (
              <Text color={colors.textSubtle} fontSize={13} paddingTop="$4">No agent is running.</Text>
            ) : null}
          </ScrollView>
        ) : (
          <>
            {notice ? <Text color={colors.attention} fontSize={12.5} paddingHorizontal="$3.5" paddingVertical="$2.5">{notice}</Text> : null}
            {file.data?.flavor === 'image' && file.data.dataUrl && !file.data.dataUrl.startsWith('data:image/svg+xml') ? (
              <Image source={{ uri: file.data.dataUrl }} resizeMode="contain" style={{ flex: 1 }} accessibilityLabel={baseName(path)} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator>
                <FlatList
                  data={lines}
                  keyExtractor={(_, index) => String(index)}
                  initialNumToRender={50}
                  windowSize={9}
                  style={{ width }}
                  renderItem={({ item, index }) => (
                    <XStack width={width}>
                      <Text width={GUTTER} textAlign="right" paddingRight={8} color={colors.textSubtle} fontSize={FONT - 1} fontFamily={monoFont.android}>{index + 1}</Text>
                      <Text color={colors.text} fontSize={FONT} fontFamily={monoFont.android}>{item}</Text>
                    </XStack>
                  )}
                />
              </ScrollView>
            )}
          </>
        )}
      </SafeAreaView>
    </>
  );
}
