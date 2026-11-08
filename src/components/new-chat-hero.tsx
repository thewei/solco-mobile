// [INPUT]: the chosen workspace and agent names, the host's name and reachability, an optional "starting" caption and
//          the three picker handlers.
// [OUTPUT]: NewChatHero — the empty New chat page's centre (designs/mobile-t3-redesign `new-chat`): "What should we build in
//           <workspace>?" with the workspace name an underlined button, the host chip ("on <host> ›", a red dot while the
//           host is offline) and the agent chip.
// [POS]: Drawn by `/compose` over the shared Chat page's empty draft (a `box-none` overlay, so only the buttons take touches
//        and the page's composer stays live under it); it fades out while the keyboard is up. The draft puts the agent chip
//        inside the composer; the composer is the web page's, so the chip sits here beside the host chip.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Pressable, View } from 'react-native';
import Animated, { interpolate, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { Text } from 'tamagui';

import { Icon } from '@/components/icon';
import { Chip } from '@/components/launch-pickers';
import { Spin } from '@/components/motion';
import { IconChevronDown, IconChevronRight, IconDeviceLaptop, IconLoader2 } from '@/theme/glyphs';
import { colors, metrics, type as typeScale } from '@/theme/tokens';

const LEAD = ['What', 'should', 'we', 'build', 'in'];

export function NewChatHero({
  workspace,
  host,
  offline = false,
  agent,
  starting,
  bottomGap = 0,
  onWorkspace,
  onHost,
  onAgent,
}: {
  workspace: string;
  host: string;
  offline?: boolean;
  /** The agent's label; omitted when the host offers none. */
  agent?: string;
  /** A caption with a spinner (a terminal is opening). */
  starting?: string | null;
  /** Room kept clear under the centre for the page's composer. */
  bottomGap?: number;
  onWorkspace: () => void;
  onHost: () => void;
  onAgent?: () => void;
}) {
  const keyboard = useAnimatedKeyboard();
  // The keyboard takes the room the hero stands in: it fades out over the first 60 dp of the lift.
  const fade = useAnimatedStyle(() => ({ opacity: interpolate(keyboard.height.get(), [0, 60], [1, 0], 'clamp') }));
  const hostLabel = offline ? `on ${host} (offline)` : `on ${host}`;
  return (
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: bottomGap }, fade]}>
      <View style={{ maxWidth: 270, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {LEAD.map((word) => (
          <Text key={word} color={colors.text} fontSize={typeScale.hero.fontSize} lineHeight={typeScale.hero.lineHeight} marginRight={7}>{word}</Text>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Workspace: ${workspace}`}
          onPress={onWorkspace}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: metrics.touch, marginVertical: -6, paddingVertical: 6 }}>
          <Text
            color={colors.text}
            fontSize={typeScale.hero.fontSize}
            lineHeight={typeScale.hero.lineHeight}
            textDecorationLine="underline"
            textDecorationColor={colors.textMuted}>
            {workspace}
          </Text>
          <Text color={colors.text} fontSize={typeScale.hero.fontSize} lineHeight={typeScale.hero.lineHeight}>?</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <Chip
          label={hostLabel}
          accessibilityLabel={`Host: ${host}${offline ? ' (offline)' : ''}`}
          icon={offline ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} /> : <Icon as={IconDeviceLaptop} size="sm" tone="muted" />}
          trailing={<Icon as={IconChevronRight} size="sm" tone="muted" />}
          onPress={onHost}
        />
        {agent && onAgent ? (
          <Chip label={agent} accessibilityLabel={`Agent: ${agent}`} trailing={<Icon as={IconChevronDown} size="sm" tone="muted" />} onPress={onAgent} />
        ) : null}
      </View>
      {starting ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <Spin>
            <Icon as={IconLoader2} size="sm" tone="muted" />
          </Spin>
          <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight}>{starting}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
