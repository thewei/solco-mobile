// [INPUT]: the paired Host's Assistants overview (GET /api/v3/personal-agent/overview, needs `capabilities.personalAgent`; creating
//          one needs `capabilities.personalAgentManage`) and the events frame `personal-agent.changed` that re-reads it.
// [OUTPUT]: AssistantsScreen — the Chats list (Home's bot button): one row per conversation — an Assistant (round initial avatar,
//           name, its counters in words) opens its chat directly; a Group (stacked avatars, title, members) opens the group chat.
//           A `+` opens one two-item sheet — New Assistant (a form sheet) / New Group (its own screen, only with the Host's
//           Groups capability) — and Needs You shows when approvals wait.
// [POS]: Second client of the desktop Assistants page. The Go core on the Mac owns Assistants, Goals, Tasks, Memory and
//        Approvals; the phone only reads them and sends the few exact writes its Host route offers. Selection is client-local —
//        opening an Assistant here never moves the Mac user's navigation. Nothing here schedules or runs work.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { Inbox, Plus, UserPlus, Users } from 'lucide-react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { Avatar, AvatarStack } from '@/components/avatar';
import { KeyboardInset } from '@/components/keyboard-inset';
import { OptionSheet } from '@/components/option-sheet';
import { Reveal } from '@/components/motion';
import { PillButton } from '@/components/pill-button';
import { pullRefresh } from '@/components/pull-refresh';
import { Card } from '@/components/section';
import { Icon } from '@/components/icon';
import { ListSkeleton } from '@/components/skeletons';
import { Tap } from '@/components/tap';
import { Field } from '@/components/text-field';
import { assistantLine, mixedChats, personalAgentMessage, receiptId, sortAssistants } from '@/features/host/personal-agent-model';
import { useBootstrapV3, usePersonalAgentOverview, usePersonalAgentWrite } from '@/features/host/queries-v3';
import { colors, spacing } from '@/theme/tokens';

export default function AssistantsScreen() {
  const router = useRouter();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgent === true;
  const manage = bootstrap.data?.capabilities.personalAgentManage === true;
  const overview = usePersonalAgentOverview(served);
  const write = usePersonalAgentWrite();
  const groupsServed = bootstrap.data?.capabilities.personalAgentGroups === true;
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const rows = overview.data ? sortAssistants(overview.data.assistants) : [];
  const chats = overview.data ? mixedChats(overview.data.assistants, overview.data.groups) : [];
  const approvals = rows.reduce((sum, row) => sum + row.approvals, 0);

  const create = () =>
    write.mutate(
      { kind: 'create', name: name.trim(), description: description.trim() },
      {
        onSuccess: (receipt) => {
          const id = receiptId(receipt);
          setCreating(false);
          setName('');
          setDescription('');
          if (id) router.push({ pathname: '/assistants/[id]', params: { id } });
        },
      },
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      <KeyboardInset>
        {bootstrap.isLoading || (served && overview.isLoading) ? (
          <YStack flex={1} paddingHorizontal={spacing.screen} paddingTop={spacing.section}><ListSkeleton rows={3} /></YStack>
        ) : !served ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
            <Text color={colors.text} fontSize={16} fontWeight="700">Assistants are not available</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
              Turn on Automations in Solco on your computer and update it, then pull to refresh.
            </Text>
          </YStack>
        ) : (
          <ScrollView
            flex={1}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, flexGrow: 1 }}
            refreshControl={pullRefresh(overview.isRefetching, () => void overview.refetch())}>
            {!overview.data ? (
              <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                <Text color={colors.text} fontSize={16} fontWeight="700">Can’t read Assistants</Text>
                <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>{personalAgentMessage(overview.error)}</Text>
              </YStack>
            ) : (
              <>
                <Text color={colors.textMuted} fontSize={13} lineHeight={19} paddingBottom={12}>
                  Your assistants remember, follow up, and coordinate work.
                </Text>
                <XStack gap={8} paddingBottom={12} flexWrap="wrap">
                  {manage ? <PillButton label="New" icon={Plus} compact onPress={() => setMenu(true)} /> : null}
                  {approvals > 0 ? <PillButton label={`Needs You · ${approvals}`} icon={Inbox} tone="soft" compact onPress={() => router.push('/assistants/approvals')} /> : null}
                </XStack>
                {chats.length === 0 ? (
                  <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
                    <Text color={colors.text} fontSize={16} fontWeight="700">No Assistants yet</Text>
                    <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
                      {manage ? 'Create one to follow a pull request or take a task for you.' : 'Create one on your computer.'}
                    </Text>
                  </YStack>
                ) : (
                  <Card>
                    {chats.map((chat, index) => (
                      <Reveal key={`${chat.kind}:${chat.id}`} index={index}>
                        {chat.kind === 'group' ? (
                          <Tap role="button" accessibilityLabel={`Open ${chat.group.title}`} onPress={() => router.push({ pathname: '/assistants/group/[id]', params: { id: chat.group.id } })}>
                            <XStack alignItems="center" gap={12} padding={spacing.card}>
                              <AvatarStack members={chat.group.members} size={44} />
                              <YStack flex={1} gap={2}>
                                <Text color={colors.text} fontSize={15} fontWeight="700" numberOfLines={1}>{chat.group.title}</Text>
                                <Text color={colors.textMuted} fontSize={12.5} numberOfLines={1}>
                                  {chat.group.members.map((m) => m.name).join(', ')}{chat.group.open > 0 ? ` · ${chat.group.open} on the way` : ''}
                                </Text>
                              </YStack>
                            </XStack>
                          </Tap>
                        ) : (
                          <Tap role="button" accessibilityLabel={`Open ${chat.row.name}`} onPress={() => router.push({ pathname: '/assistants/[id]', params: { id: chat.row.id } })}>
                            <XStack alignItems="center" gap={12} padding={spacing.card}>
                              <Avatar id={chat.row.id} name={chat.row.name} size={44} />
                              <YStack flex={1} gap={2}>
                                <Text color={colors.text} fontSize={15} fontWeight="700" numberOfLines={1}>{chat.row.name}</Text>
                                <Text color={chat.row.needsYou + chat.row.approvals > 0 ? colors.attention : colors.textMuted} fontSize={12.5} numberOfLines={1}>{assistantLine(chat.row)}</Text>
                              </YStack>
                            </XStack>
                          </Tap>
                        )}
                      </Reveal>
                    ))}
                  </Card>
                )}
              </>
            )}
          </ScrollView>
        )}
      </KeyboardInset>
      <OptionSheet visible={menu} title="New" onClose={() => setMenu(false)}>
        <Tap role="button" accessibilityLabel="New Assistant" onPress={() => { setMenu(false); setCreating(true); }}>
          <XStack alignItems="center" gap={12} paddingHorizontal="$4" paddingVertical="$3">
            <Icon as={UserPlus} size="md" tone="text" />
            <Text color={colors.text} fontSize={15}>New Assistant</Text>
          </XStack>
        </Tap>
        {groupsServed ? (
          <Tap role="button" accessibilityLabel="New Group" onPress={() => { setMenu(false); router.push('/assistants/new-group'); }}>
            <XStack alignItems="center" gap={12} paddingHorizontal="$4" paddingVertical="$3">
              <Icon as={Users} size="md" tone="text" />
              <Text color={colors.text} fontSize={15}>New Group</Text>
            </XStack>
          </Tap>
        ) : null}
      </OptionSheet>
      <OptionSheet visible={creating} title="New Assistant" onClose={() => setCreating(false)}>
        <YStack paddingHorizontal="$4" gap={10} paddingBottom="$3">
          <Field value={name} onChange={setName} placeholder="Name (e.g. PR reviewer)" />
          <Field value={description} onChange={setDescription} placeholder="What it is for (optional)" multiline />
          {write.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(write.error)}</Text> : null}
          <XStack gap={8}>
            <PillButton label="Create" compact disabled={write.isPending || name.trim() === ''} onPress={create} />
            <PillButton label="Cancel" tone="soft" compact onPress={() => setCreating(false)} />
          </XStack>
        </YStack>
      </OptionSheet>
    </SafeAreaView>
  );
}
