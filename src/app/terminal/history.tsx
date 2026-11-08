// [INPUT]: a terminal id (+ instance, title) and the Host's `GET /terminals/{id}/history` (capability `terminalHistory`).
// [OUTPUT]: A read-only plain-text snapshot of everything the terminal retained (scrollback + screen): newest line at the
//           bottom, local search that filters lines, Copy (what is on screen), Refresh, a jump-to-end pill.
// [POS]: The Terminal page's "history" — the observe stream carries only the live screen, so what scrolled out is read here.
//        Never written back into the renderer and never polled; a pane that keeps printing says so (409 history_busy).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Platform, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Spinner, Text, XStack, YStack } from 'tamagui';

import { PillButton } from '@/components/pill-button';
import { Screen } from '@/components/screen';
import { filterRows, historyFailure, historyRows, rowsText, type HistoryRow } from '@/features/host/terminal-history-model';
import { useHostInstance, useTerminalHistory } from '@/features/host/queries-v3';
import { IconArrowDown, IconCopy, IconRefresh } from '@/theme/glyphs';
import { colors, monoFont, radii } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const FONT = 12;
const GUTTER = 44;
const MONO = Platform.select({ ios: monoFont.ios, default: monoFont.android });

export default function TerminalHistoryScreen() {
  const params = useLocalSearchParams<{ terminalId: string; instance?: string; title?: string }>();
  const terminalId = first(params.terminalId);
  const { instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const history = useTerminalHistory(instance || null, terminalId);
  const listRef = useRef<FlatList<HistoryRow>>(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [away, setAway] = useState(false);

  const rows = useMemo(() => historyRows(history.data?.text ?? ''), [history.data?.text]);
  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  // Newest at the bottom with no scroll arithmetic: the list is inverted over the reversed rows.
  const data = useMemo(() => [...shown].reverse(), [shown]);
  const searching = query.trim() !== '';

  const copy = async () => {
    await Clipboard.setStringAsync(rowsText(shown));
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <Screen
      back
      title="History"
      subtitle={first(params.title) || undefined}
      actions={[
        { icon: IconRefresh, label: 'Refresh history', onPress: () => void history.refetch() },
        { icon: IconCopy, label: searching ? 'Copy matching lines' : 'Copy all history', onPress: () => void copy(), tone: copied ? 'accent' : 'text' },
      ]}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.terminal }} edges={['bottom']}>
        <YStack padding="$2" gap="$1.5" backgroundColor={colors.surface} borderBottomColor={colors.border} borderBottomWidth={1}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search this history"
            placeholderTextColor={colors.textSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            accessibilityLabel="Search history"
            style={{ color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: radii.sm, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 }}
          />
          {history.data ? (
            <Text color={colors.textSubtle} fontSize={11.5}>
              {searching ? `${shown.length} of ${rows.length} lines` : `${rows.length} lines`}
              {history.data.truncated ? ' · the oldest output was left out' : ''}
              {copied ? ' · copied' : ''}
            </Text>
          ) : null}
        </YStack>

        {history.isFetching && history.data === undefined ? (
          <YStack flex={1} alignItems="center" justifyContent="center"><Spinner color={colors.accent} size="large" /></YStack>
        ) : history.error && history.data === undefined ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$3">
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{historyFailure(history.error)}</Text>
            <Button unstyled paddingHorizontal="$4" paddingVertical="$2" borderRadius={radii.pill} backgroundColor={colors.surfaceRaised} onPress={() => void history.refetch()}>
              <Text color={colors.text} fontSize={13} fontWeight="650">Try again</Text>
            </Button>
          </YStack>
        ) : data.length === 0 ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6">
            <Text color={colors.textSubtle} fontSize={13}>{searching ? 'No line matches.' : 'Nothing has been printed yet.'}</Text>
          </YStack>
        ) : (
          <YStack flex={1}>
            <FlatList
              ref={listRef}
              inverted
              data={data}
              keyExtractor={(item) => String(item.n)}
              initialNumToRender={40}
              windowSize={9}
              onScroll={(event) => setAway(event.nativeEvent.contentOffset.y > 240)}
              scrollEventThrottle={64}
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => (
                <XStack paddingRight={10}>
                  <Text width={GUTTER} textAlign="right" paddingRight={8} color={colors.textSubtle} fontSize={FONT - 1} fontFamily={MONO}>{item.n}</Text>
                  <Text flex={1} selectable color={colors.text} fontSize={FONT} fontFamily={MONO}>{item.text || ' '}</Text>
                </XStack>
              )}
            />
            {away ? (
              <View style={{ position: 'absolute', bottom: 12, right: 12 }}>
                <PillButton compact tone="soft" icon={IconArrowDown} label="End" accessibilityLabel="Jump to the newest line" onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: false })} />
              </View>
            ) : null}
          </YStack>
        )}
      </SafeAreaView>
    </Screen>
  );
}
