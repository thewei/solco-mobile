// [INPUT]: a route param `id` (the Group), its feed from the Mac (GET /api/v3/personal-agent/groups/{id}, re-read every 2 s while
//          open), this phone's tree (to find the pane of an Agent that waits on a dialog) and the person's typing.
// [OUTPUT]: GroupScreen — a real group chat: stacked-avatar header, multi-author bubbles (the person on the right, each Assistant
//           with its own avatar and name), exact-@ chips and an @ picker, Reply with a quote, a delivery mark per woken Assistant,
//           the core's own receipts as quiet lines, live task cards, and a status line for Agents that are starting or waiting on
//           a dialog (with Open Terminal).
// [POS]: Second client of the desktop group page. The Mac's Go core owns the conversation: who spoke, who was woken, what a
//        delivery did. The phone sends only the person's own words (`mentions` = members whose exact `@Name` is in the text, so
//        a message with no @ wakes nobody) and can never speak for an Assistant. A failed send keeps the draft and says why; the
//        same draft retried replays the first receipt (one requestId per draft). Selection and scroll are client-local.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ArrowUp, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input, Text, XStack, YStack } from 'tamagui';

import { Avatar, AvatarStack } from '@/components/avatar';
import { IconButton } from '@/components/icon-button';
import { Icon } from '@/components/icon';
import { KeyboardInset } from '@/components/keyboard-inset';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';
import type { GroupMember } from '@/contracts/host-v3';
import {
  agentNotes,
  applyMention,
  chatRows,
  deliveryMark,
  factLine,
  mentionChoices,
  resolveMentions,
  splitMentions,
  taskStateLabel,
  type ChatRow,
} from '@/features/host/group-model';
import { flattenPanes } from '@/features/host/pane-model';
import { personalAgentMessage } from '@/features/host/personal-agent-model';
import { useBootstrapV3, useGroupFeed, useGroupPost, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { colors, radii, spacing } from '@/theme/tokens';

const NEAR_BOTTOM = 120;

function Body({ text, members, mine }: { text: string; members: readonly GroupMember[]; mine: boolean }) {
  return (
    <Text color={mine ? '#FFFFFF' : colors.text} fontSize={15} lineHeight={21} selectable>
      {splitMentions(text, members).map((part, i) =>
        part.mention ? (
          <Text key={i} fontWeight="700" color={mine ? '#FFFFFF' : colors.accent} textDecorationLine={mine ? 'underline' : 'none'}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

function Quote({ author, text }: { author: string; text: string }) {
  return (
    <XStack gap={8} marginBottom={4}>
      <YStack width={2} borderRadius={1} backgroundColor={colors.borderStrong} />
      <YStack flex={1}>
        <Text color={colors.textMuted} fontSize={11.5} fontWeight="700" numberOfLines={1}>{author}</Text>
        <Text color={colors.textMuted} fontSize={12.5} numberOfLines={2}>{text}</Text>
      </YStack>
    </XStack>
  );
}

function Row({
  row,
  members,
  nameOf,
  onReply,
  onOpenAssistant,
}: {
  row: ChatRow;
  members: readonly GroupMember[];
  nameOf: (id: string) => string;
  onReply: () => void;
  onOpenAssistant: (id: string) => void;
}) {
  const { message, quoted, task, deliveries, continued } = row;
  if (message.kind === 'fact') {
    const line = factLine(message.fact, nameOf);
    return line ? (
      <Text color={colors.textSubtle} fontSize={12} textAlign="center" paddingVertical={6} paddingHorizontal={spacing.screen}>{line}</Text>
    ) : null;
  }
  const mine = message.authorKind === 'user';
  const author = mine ? 'You' : nameOf(message.authorId ?? '') || 'Assistant';
  const quoteAuthor = quoted ? (quoted.authorKind === 'user' ? 'You' : nameOf(quoted.authorId ?? '') || 'Assistant') : '';
  if (message.kind === 'task' && task) {
    return (
      <XStack paddingHorizontal={spacing.screen} paddingTop={continued ? 2 : 10} gap={8} alignItems="flex-start">
        {continued ? <YStack width={32} /> : <Avatar id={message.authorId ?? ''} name={author} size={32} />}
        <Tap
          flex={1}
          role="button"
          accessibilityLabel={`Open ${author}`}
          onPress={() => onOpenAssistant(task.assistantId)}
          backgroundColor={colors.surface}
          borderColor={task.needsYou ? colors.attention : colors.border}
          borderWidth={1}
          borderRadius={radii.md}
          padding={spacing.card}
          gap={4}>
          <Text color={colors.textMuted} fontSize={11.5} fontWeight="700">{author} · Task</Text>
          <Text color={colors.text} fontSize={14.5} fontWeight="700" numberOfLines={2}>{task.title}</Text>
          <Text color={task.state === 'failed' ? colors.danger : task.needsYou ? colors.attention : colors.textMuted} fontSize={12.5}>
            {task.needsYou ? 'Needs you' : taskStateLabel(task.state)}
          </Text>
        </Tap>
      </XStack>
    );
  }
  return (
    <XStack paddingHorizontal={spacing.screen} paddingTop={continued ? 2 : 10} gap={8} justifyContent={mine ? 'flex-end' : 'flex-start'} alignItems="flex-start">
      {mine ? null : continued ? <YStack width={32} /> : <Avatar id={message.authorId ?? ''} name={author} size={32} />}
      <YStack maxWidth="82%" alignItems={mine ? 'flex-end' : 'flex-start'} gap={3}>
        {!mine && !continued ? <Text color={colors.textMuted} fontSize={11.5} fontWeight="700">{author}</Text> : null}
        <YStack
          backgroundColor={mine ? colors.accent : colors.surfaceRaised}
          borderRadius={radii.lg}
          paddingHorizontal={12}
          paddingVertical={8}>
          {quoted ? <Quote author={quoteAuthor} text={quoted.body} /> : null}
          <Body text={message.body} members={members} mine={mine} />
        </YStack>
        {mine && deliveries.length > 0 ? (
          <Text color={colors.textSubtle} fontSize={11}>
            {deliveries.map((d) => `${deliveryMark(d.state)} ${nameOf(d.assistantId)}`).join('  ')}
          </Text>
        ) : null}
        {mine ? null : (
          <Tap role="button" accessibilityLabel={`Reply to ${author}`} onPress={onReply} hitSlop={8}>
            <Text color={colors.textSubtle} fontSize={11.5}>Reply</Text>
          </Tap>
        )}
      </YStack>
    </XStack>
  );
}

export default function GroupScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgentGroups === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const feed = useGroupFeed(id ?? '', served);
  const post = useGroupPost(id ?? '');
  const { instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Members chosen from the picker — what tells two members of one name apart.
  const [picks, setPicks] = useState<GroupMember[]>([]);
  const [pickError, setPickError] = useState('');
  const list = useRef<FlatList<ChatRow>>(null);
  const nearBottom = useRef(true);

  const group = feed.data?.group;
  const members = useMemo(() => group?.members ?? [], [group]);
  const nameOf = useMemo(() => (who: string) => members.find((m) => m.assistantId === who)?.name ?? '', [members]);
  const rows = useMemo(() => (feed.data ? chatRows(feed.data) : []), [feed.data]);
  const notes = agentNotes(feed.data?.agents ?? []);
  const choices = mentionChoices(draft, members);
  const replying = replyTo ? rows.find((r) => r.message.id === replyTo)?.message : undefined;

  const last = rows.length > 0 ? rows[rows.length - 1]?.message.seq : 0;
  useEffect(() => {
    if (nearBottom.current) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [last]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM;
  };

  const send = () => {
    const body = draft.trim();
    if (body === '' || post.isPending) return;
    const { ids, ambiguous } = resolveMentions(body, members, picks);
    if (ambiguous.length > 0) {
      setPickError(`More than one member is called ${ambiguous[0]} — pick which one from the list after typing @.`);
      return;
    }
    setPickError('');
    post.mutate(
      { body, mentions: ids, replyTo: replyTo ?? undefined },
      {
        onSuccess: () => {
          setDraft('');
          setPicks([]);
          setReplyTo(null);
          nearBottom.current = true;
        },
      },
    );
  };

  const openTerminal = (paneId?: string) => {
    const pane = paneId ? flattenPanes(tree.data?.workspaces ?? []).find((p) => p.pane.paneId === paneId)?.pane : undefined;
    if (pane && instance) router.push({ pathname: '/terminal/[terminalId]', params: { terminalId: pane.terminalId, instance, title: group?.title ?? 'Agent' } });
  };

  const openAssistant = (assistantId: string) => router.push({ pathname: '/assistants/[id]', params: { id: assistantId } });

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom']}>
        <XStack alignItems="center" gap={10} paddingHorizontal={8} paddingVertical={6} borderBottomWidth={1} borderBottomColor={colors.border}>
          <IconButton as={ArrowLeft} tone="muted" label="Back" onPress={() => router.back()} />
          {group ? <AvatarStack members={members} size={34} /> : null}
          <YStack flex={1}>
            <Text color={colors.text} fontSize={15.5} fontWeight="700" numberOfLines={1}>{group?.title ?? 'Group'}</Text>
            {group ? <Text color={colors.textMuted} fontSize={12} numberOfLines={1}>{members.map((m) => m.name).join(', ')}</Text> : null}
          </YStack>
        </XStack>
        <KeyboardInset>
          {!served && !bootstrap.isLoading ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Groups are not available</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then pull to refresh.</Text>
            </YStack>
          ) : feed.isLoading || bootstrap.isLoading ? (
            <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={4} /></YStack>
          ) : !feed.data ? (
            <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read this group</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(feed.error)}</Text>
            </YStack>
          ) : (
            <>
              <FlatList
                ref={list}
                style={{ flex: 1 }}
                data={rows}
                keyExtractor={(row) => row.message.id}
                onScroll={onScroll}
                scrollEventThrottle={64}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingVertical: 10 }}
                ListEmptyComponent={
                  <Text color={colors.textMuted} fontSize={13} textAlign="center" padding={spacing.screen} lineHeight={19}>
                    Say something. Type @ to ask a member — only the ones you @ are woken.
                  </Text>
                }
                renderItem={({ item }) => (
                  <Row row={item} members={members} nameOf={nameOf} onReply={() => setReplyTo(item.message.id)} onOpenAssistant={openAssistant} />
                )}
              />
              {notes.length > 0 ? (
                <YStack paddingHorizontal={spacing.screen} paddingVertical={6} gap={4} borderTopWidth={1} borderTopColor={colors.border}>
                  {notes.map((note) => (
                    <XStack key={note.assistantId} alignItems="center" justifyContent="space-between" gap={8}>
                      <Text flex={1} color={note.kind === 'blocked' ? colors.attention : colors.textMuted} fontSize={12.5}>
                        {note.kind === 'blocked' ? `${nameOf(note.assistantId)} is waiting for you in its terminal` : `${nameOf(note.assistantId)} is starting…`}
                      </Text>
                      {note.kind === 'blocked' && flattenPanes(tree.data?.workspaces ?? []).some((p) => p.pane.paneId === note.paneId) ? (
                        <Tap role="button" accessibilityLabel="Open Terminal" onPress={() => openTerminal(note.paneId)}>
                          <Text color={colors.accent} fontSize={12.5} fontWeight="700">Open Terminal</Text>
                        </Tap>
                      ) : null}
                    </XStack>
                  ))}
                </YStack>
              ) : null}
              {choices.length > 0 ? (
                <YStack backgroundColor={colors.surface} borderTopWidth={1} borderTopColor={colors.border} paddingVertical={4}>
                  {choices.map((m) => (
                    <Tap key={m.assistantId} role="button" accessibilityLabel={`Mention ${m.name}`} onPress={() => {
                      setDraft((text) => applyMention(text, m));
                      setPicks((all) => [...all, m]);
                    }}>
                      <XStack alignItems="center" gap={10} paddingHorizontal={spacing.screen} paddingVertical={8}>
                        <Avatar id={m.assistantId} name={m.name} size={26} />
                        <Text color={colors.text} fontSize={14.5}>{m.name}</Text>
                      </XStack>
                    </Tap>
                  ))}
                </YStack>
              ) : null}
              {replying ? (
                <XStack alignItems="center" gap={8} paddingHorizontal={spacing.screen} paddingTop={6}>
                  <YStack flex={1}>
                    <Quote author={replying.authorKind === 'user' ? 'You' : nameOf(replying.authorId ?? '') || 'Assistant'} text={replying.body} />
                  </YStack>
                  <IconButton as={X} tone="muted" label="Cancel reply" onPress={() => setReplyTo(null)} />
                </XStack>
              ) : null}
              {pickError !== '' ? (
                <Text color={colors.danger} fontSize={12.5} lineHeight={18} paddingHorizontal={spacing.screen} paddingTop={6}>{pickError}</Text>
              ) : null}
              {post.isError ? (
                <Text color={colors.danger} fontSize={12.5} lineHeight={18} paddingHorizontal={spacing.screen} paddingTop={6}>{personalAgentMessage(post.error)}</Text>
              ) : null}
              {manage ? (
                <XStack alignItems="flex-end" gap={8} paddingHorizontal={spacing.screen} paddingVertical={8}>
                  <Input
                    unstyled
                    flex={1}
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={group ? `Message ${group.title} — @ to ask someone` : 'Message'}
                    placeholderTextColor="$placeholderColor"
                    multiline
                    autoCapitalize="sentences"
                    color={colors.text}
                    fontSize={15}
                    maxHeight={120}
                    paddingHorizontal={14}
                    paddingVertical={10}
                    backgroundColor={colors.surfaceRaised}
                    borderRadius={radii.lg}
                  />
                  <Tap
                    role="button"
                    accessibilityLabel="Send"
                    disabled={draft.trim() === '' || post.isPending}
                    opacity={draft.trim() === '' || post.isPending ? 0.4 : 1}
                    width={40}
                    height={40}
                    borderRadius={20}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={colors.accent}
                    onPress={send}>
                    <Icon as={ArrowUp} size="md" tone="onAccent" />
                  </Tap>
                </XStack>
              ) : (
                <Text color={colors.textMuted} fontSize={12.5} textAlign="center" padding={spacing.screen}>This phone can read the group but not write to it.</Text>
              )}
            </>
          )}
        </KeyboardInset>
      </SafeAreaView>
    </>
  );
}
