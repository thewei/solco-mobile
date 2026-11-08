// [INPUT]: an instance, a workspace id and a changed file's path; the Host's read-only diff of that file.
// [OUTPUT]: DiffCard — one file's unified diff as a bordered card: hunk header rows, then +/- rows with old/new line numbers on the
//           add / delete tints, monospace, sideways scroll for long lines; a sentence for binary / too-large / cut diffs.
// [POS]: The body Review opens under a file row (designs/mobile-t3-redesign `.diff`). Mounted only while its row is open, so the
//        diff is read when asked for, never in advance. A file that stopped being changed arrives as `unknown_file` and is
//        worded, not retried.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useMemo } from 'react';
import { Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text } from 'tamagui';

import { Skeleton } from '@/components/motion';
import { diffNotice, diffRows, gitFailureMessage, type DiffRow } from '@/features/host/git-model';
import { useGitDiff } from '@/features/host/queries-v3';
import { colors, monoFont, radii, type as typeScale } from '@/theme/tokens';

const MONO = Platform.OS === 'ios' ? monoFont.ios : monoFont.android;
const FONT = 12;
/** Monospace advance is ~0.6 em; rows get one explicit width so the tints reach the edge of the longest line. */
const CHAR = FONT * 0.61;
const NUMBER = 34;
const MARK = 14;
/** The card's margin (12 + 12) and border (1 + 1) inside the screen. */
const FRAME = 26;

function Line({ row, width }: { row: DiffRow; width: number }) {
  if (row.type === 'hunk') {
    return (
      <View style={{ width, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: colors.surfaceRaised }}>
        <Text color={colors.textMuted} fontSize={FONT} lineHeight={16} fontFamily={MONO} numberOfLines={1}>{row.text}</Text>
      </View>
    );
  }
  const tint = row.kind === '+' ? colors.diffAdd : row.kind === '-' ? colors.diffDelete : undefined;
  const number = row.kind === '-' ? row.old : (row.new ?? row.old);
  return (
    <View style={{ flexDirection: 'row', width, backgroundColor: tint }}>
      <Text width={NUMBER} paddingRight={6} textAlign="right" color={colors.diffGutter} fontSize={FONT - 1} lineHeight={22} fontFamily={MONO}>{number ?? ''}</Text>
      <Text width={MARK} textAlign="center" color={colors.diffGutter} fontSize={FONT} lineHeight={22} fontFamily={MONO}>{row.kind === ' ' ? '' : row.kind}</Text>
      <Text flexShrink={0} color={colors.text} fontSize={FONT} lineHeight={22} fontFamily={MONO} numberOfLines={1}>{row.text.replace(/\t/g, '    ')}</Text>
    </View>
  );
}

export function DiffCard({ instance, workspaceId, path }: { instance: string | null; workspaceId: string; path: string }) {
  const diff = useGitDiff(instance, workspaceId, path);
  const { width: screen } = useWindowDimensions();
  const rows = useMemo(() => (diff.data ? diffRows(diff.data) : []), [diff.data]);
  const width = useMemo(() => {
    const longest = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
    return Math.max(screen - FRAME, NUMBER + MARK + longest * CHAR + 16);
  }, [rows, screen]);
  const notice = diff.data ? diffNotice(diff.data) : null;

  return (
    <View style={{ marginHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radii.diff, overflow: 'hidden', backgroundColor: colors.surface }}>
      {diff.isLoading ? (
        <View accessibilityRole="progressbar" accessibilityLabel="Loading changes" style={{ gap: 10, padding: 12 }}>
          <Skeleton height={14} width="70%" />
          <Skeleton height={14} width="50%" />
          <Skeleton height={14} width="60%" />
        </View>
      ) : diff.error && diff.data === undefined ? (
        <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} padding={12}>{gitFailureMessage(diff.error)}</Text>
      ) : (
        <>
          {rows.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ width }}>
                {rows.map((row) => (
                  <Line key={row.key} row={row} width={width} />
                ))}
              </View>
            </ScrollView>
          ) : null}
          {notice ? <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} padding={12}>{notice}</Text> : null}
        </>
      )}
    </View>
  );
}
