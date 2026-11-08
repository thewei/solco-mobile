// [INPUT]: a thread's title, its Workspace, a status or a time, where it runs (host + agent), and a press handler.
// [OUTPUT]: ThreadRow (a two-line `card` row for an active chat — host + agent, or a plain caption — a one-line `slim` row for a settled one), WorkspaceBadge
//           and ProviderBadge (the 20 dp two-letter tiles), StatusLabel (the bold status word with its glyph) and ProviderMark
//           (the agent's two letters).
// [POS]: The one row of every thread list (designs/mobile-t3-redesign `.trow`): Chats, Sessions, the Workspace page.
//        Replaces pane-row's flat rows. Geometry (7 dp inset, 20 dp corner, 8.75 / 10.5 padding), the badge colors
//        and the status vocabulary live here; screens only choose card or slim.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, View } from 'react-native';
import { Text } from 'tamagui';

import { Icon, type Glyph, type IconTone } from '@/components/icon';
import { Spin } from '@/components/motion';
import { providerMark, threadMatch, workspaceMark } from '@/features/host/thread-model';
import { IconAlertCircle, IconCircle, IconCircleCheck, IconDeviceLaptop, IconLoader2, IconPointFilled } from '@/theme/glyphs';
import { activeScheme, colors, radii, type as typeScale, themed } from '@/theme/tokens';

export type ThreadStatus = 'needs' | 'working' | 'running' | 'ready' | 'open';

const STATUS: Record<ThreadStatus, { text: string; glyph: Glyph; tone: IconTone; color: string; spin?: boolean }> = themed(() => ({
  needs: { text: 'Needs you', glyph: IconAlertCircle, tone: 'attention', color: colors.attention },
  working: { text: 'Working', glyph: IconLoader2, tone: 'accent', color: colors.accentText, spin: true },
  running: { text: 'Running', glyph: IconLoader2, tone: 'accent', color: colors.accentText, spin: true },
  ready: { text: 'Ready', glyph: IconCircleCheck, tone: 'success', color: colors.success },
  open: { text: 'Open', glyph: IconCircle, tone: 'muted', color: colors.textMuted },
}));

/** The bold status word with its 13 dp glyph (a spinner while the agent works); `extra` is the age (`4m`). */
export function StatusLabel({ status, extra }: { status: ThreadStatus; extra?: string }) {
  const face = STATUS[status];
  const glyph = <Icon as={face.glyph} size="xs" tone={face.tone} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {face.spin ? <Spin>{glyph}</Spin> : glyph}
      <Text color={face.color} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} fontWeight="700">
        {extra ? `${face.text} ${extra}` : face.text}
      </Text>
    </View>
  );
}

/** A 20 dp tile of two letters on a hue (dark: 17 % lightness fill, 74 % text; light: 90 % fill, 30 % text). */
function MarkBadge({ letters, hue, muted }: { letters: string; hue: number; muted: boolean }) {
  const dark = activeScheme() === 'dark';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 20, height: 20, marginTop: muted ? 0 : 1.5, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? `hsl(${hue}, 38%, 17%)` : `hsl(${hue}, 70%, 90%)`, opacity: muted ? 0.4 : 1 }}>
      <Text color={dark ? `hsl(${hue}, 80%, 74%)` : `hsl(${hue}, 55%, 30%)`} fontSize={9} lineHeight={9} fontWeight="700" letterSpacing={0.2}>{letters}</Text>
    </View>
  );
}

/** The Workspace's two letters on a tile whose hue is the Workspace's own. */
export function WorkspaceBadge({ name, muted = false }: { name: string; muted?: boolean }) {
  const { letters, hue } = workspaceMark(name);
  return <MarkBadge letters={letters} hue={hue} muted={muted} />;
}

/** The agent's two letters on a tile (the Usage page's provider header): the same marks as the thread rows' provider chip. */
export function ProviderBadge({ provider }: { provider: string }) {
  return <MarkBadge letters={providerMark(provider)} hue={workspaceMark(provider).hue} muted={false} />;
}

/** A 20 dp tile with a glyph instead of letters (the Primary Assistant). */
export function GlyphBadge({ glyph }: { glyph: Glyph }) {
  return (
    <View style={{ width: 20, height: 20, marginTop: 1.5, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised }}>
      <Icon as={glyph} size="xs" tone="text" />
    </View>
  );
}

export function ProviderMark({ provider }: { provider: string }) {
  return (
    <View accessibilityLabel={provider} style={{ minWidth: 18, height: 16, paddingHorizontal: 3, borderRadius: radii.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised }}>
      <Text color={colors.textMuted} fontSize={9} lineHeight={16} fontWeight="700" letterSpacing={0.2}>{providerMark(provider)}</Text>
    </View>
  );
}

function Title({ title, query, slim, quiet }: { title: string; query?: string; slim: boolean; quiet: boolean }) {
  const hit = query ? threadMatch(title, query) : null;
  return (
    <Text
      flex={1}
      minWidth={0}
      color={slim ? colors.textMuted : colors.text}
      fontSize={typeScale.body.fontSize}
      lineHeight={24}
      fontWeight={slim || quiet ? '400' : '500'}
      numberOfLines={slim ? 1 : 2}>
      {hit ? (
        <>
          {hit[0]}
          <Text backgroundColor={colors.highlight} color={slim ? colors.textMuted : colors.text} fontSize={typeScale.body.fontSize} lineHeight={24} fontWeight={slim || quiet ? '400' : '500'}>{hit[1]}</Text>
          {hit[2]}
        </>
      ) : (
        title
      )}
    </Text>
  );
}

export function ThreadRow({
  title,
  workspace,
  badge,
  status,
  statusExtra,
  time,
  host,
  provider,
  caption,
  pinned = false,
  slim = false,
  quiet = false,
  query,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  /** The Workspace's name: its badge letters and hue. */
  workspace?: string;
  /** A custom lead tile instead of the Workspace badge. */
  badge?: React.ReactNode;
  status?: ThreadStatus;
  /** The age that rides on a status (`4m` in `Working 4m`). */
  statusExtra?: string;
  /** The time on the right of a settled row (`2d`). */
  time?: string;
  /** Second line of a card: the machine it runs on … */
  host?: string;
  /** … and the agent's mark on its right. */
  provider?: string;
  /** Or a plain second line (Sessions: `Claude Code · solco`). */
  caption?: string;
  pinned?: boolean;
  slim?: boolean;
  /** Regular weight (a settled card). */
  quiet?: boolean;
  /** The search words to mark inside the title. */
  query?: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const lead = badge ?? (workspace ? <WorkspaceBadge name={workspace} muted={slim} /> : null);
  const trail = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: slim ? 0 : 24 }}>
      {pinned ? <Icon as={IconPointFilled} size="dot" tone="muted" /> : null}
      {status ? <StatusLabel status={status} extra={statusExtra} /> : time ? <Text color={colors.textMuted} fontSize={slim ? typeScale.label.fontSize : typeScale.small.fontSize} lineHeight={slim ? typeScale.label.lineHeight : typeScale.small.lineHeight}>{time}</Text> : null}
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: 7,
        minHeight: 48,
        justifyContent: 'center',
        paddingVertical: slim ? 6 : 8.75,
        paddingHorizontal: 10.5,
        borderRadius: radii.md,
        backgroundColor: pressed ? colors.rowPressed : 'transparent',
      })}>
      <View style={{ flexDirection: 'row', alignItems: slim ? 'center' : 'flex-start', gap: slim ? 8 : 7 }}>
        {lead}
        <Title title={title} query={query} slim={slim} quiet={quiet} />
        {trail}
      </View>
      {!slim && caption ? (
        <Text marginTop={3.5} paddingLeft={27} color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} numberOfLines={1}>{caption}</Text>
      ) : null}
      {!slim && (host || provider) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3.5, paddingLeft: 27 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {host ? <Icon as={IconDeviceLaptop} size="xs" tone="muted" /> : null}
            {host ? <Text flexShrink={1} color={colors.textMuted} fontSize={typeScale.small.fontSize} lineHeight={typeScale.small.lineHeight} numberOfLines={1}>{host}</Text> : null}
          </View>
          {provider ? <ProviderMark provider={provider} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}
