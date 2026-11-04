// [INPUT]: workspace id, instance and a changed file's path; the Host's read-only diff of that file.
// [OUTPUT]: One file's unified diff: hunk headers, +/- rows with old/new line numbers, monospace, horizontal
//           scroll for long lines; a sentence for binary / too-large / cut diffs.
// [POS]: Leaf of the read-only Git view. The path is only ever one the Host listed; a file that stopped
//        being changed arrives as `unknown_file` and is worded, not retried.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spinner, Text, XStack, YStack } from 'tamagui';

import { diffNotice, diffRows, fileParts, gitFailureMessage, type DiffRow } from '@/features/host/git-model';
import { useGitDiff, useHostInstance } from '@/features/host/queries-v3';
import { colors, monoFont } from '@/theme/tokens';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const FONT = 12;
/** Monospace advance is ~0.6 em; rows get one explicit width so tints reach the edge of the longest line. */
const CHAR = FONT * 0.61;
const GUTTER = 40;
const MARK = 16;

function Row({ row, width }: { row: DiffRow; width: number }) {
  if (row.type === 'hunk') {
    return (
      <XStack width={width} paddingHorizontal={8} paddingVertical={4} backgroundColor={colors.surfaceRaised}>
        <Text color={colors.textSubtle} fontSize={FONT} fontFamily={monoFont.android}>{row.text}</Text>
      </XStack>
    );
  }
  const background = row.kind === '+' ? colors.diffAdd : row.kind === '-' ? colors.diffDelete : undefined;
  const color = row.kind === '+' ? colors.success : row.kind === '-' ? colors.danger : colors.text;
  const number = row.kind === '-' ? row.old : (row.new ?? row.old);
  return (
    <XStack width={width} backgroundColor={background}>
      <Text width={GUTTER} textAlign="right" paddingRight={6} color={colors.textSubtle} fontSize={FONT - 1} fontFamily={monoFont.android}>{number ?? ''}</Text>
      <Text width={MARK} color={color} fontSize={FONT} fontFamily={monoFont.android}>{row.kind === ' ' ? '' : row.kind}</Text>
      <Text color={row.kind === ' ' ? colors.textMuted : color} fontSize={FONT} fontFamily={monoFont.android}>{row.text}</Text>
    </XStack>
  );
}

export default function DiffScreen() {
  const params = useLocalSearchParams<{ workspaceId: string; instance?: string; path: string }>();
  const workspaceId = first(params.workspaceId);
  const path = first(params.path);
  const { instance: defaultInstance } = useHostInstance();
  const instance = first(params.instance) || defaultInstance;
  const diff = useGitDiff(instance, workspaceId, path);
  const { width: screen } = useWindowDimensions();

  const rows = useMemo(() => (diff.data ? diffRows(diff.data) : []), [diff.data]);
  const width = useMemo(() => {
    const longest = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
    return Math.max(screen, GUTTER + MARK + longest * CHAR + 24);
  }, [rows, screen]);
  const notice = diff.data ? diffNotice(diff.data) : null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: fileParts(path).name, headerBackTitle: 'Changes' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.terminal }} edges={['bottom']}>
        {diff.isLoading ? (
          <YStack flex={1} alignItems="center" justifyContent="center"><Spinner color={colors.accent} size="large" /></YStack>
        ) : diff.error && diff.data === undefined ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6">
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{gitFailureMessage(diff.error)}</Text>
          </YStack>
        ) : (
          <>
            {notice ? <Text color={colors.attention} fontSize={12.5} paddingHorizontal="$3.5" paddingVertical="$2.5">{notice}</Text> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <FlatList
                data={rows}
                keyExtractor={(row) => row.key}
                renderItem={({ item }) => <Row row={item} width={width} />}
                initialNumToRender={40}
                windowSize={9}
                style={{ width }}
              />
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </>
  );
}
