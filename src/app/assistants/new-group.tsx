// [INPUT]: the Mac's Assistants (overview), the person's picks (2–4 active Assistants) and an optional title.
// [OUTPUT]: NewGroupScreen — pick members, optionally name the group, Create → the new real Group's chat.
// [POS]: Needs `capabilities.personalAgentGroups`; without it the screen says so instead of faking a group. Creation is one
//        requestId per draft (a double tap or a retry after a transport failure makes one group); a failure keeps the picks.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { Avatar } from '@/components/avatar';
import { Icon } from '@/components/icon';
import { KeyboardInset } from '@/components/keyboard-inset';
import { PillButton } from '@/components/pill-button';
import { Card } from '@/components/section';
import { Tap } from '@/components/tap';
import { Field } from '@/components/text-field';
import { personalAgentMessage, sortAssistants } from '@/features/host/personal-agent-model';
import { useBootstrapV3, useGroupCreate, usePersonalAgentOverview } from '@/features/host/queries-v3';
import { colors, spacing } from '@/theme/tokens';

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 4;

export default function NewGroupScreen() {
  const router = useRouter();
  const bootstrap = useBootstrapV3();
  const served = bootstrap.data?.capabilities.personalAgentGroups === true && bootstrap.data.capabilities.personalAgentManage === true;
  const overview = usePersonalAgentOverview(bootstrap.data?.capabilities.personalAgent === true);
  const create = useGroupCreate();
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const candidates = sortAssistants(overview.data?.assistants ?? []).filter((a) => a.status === 'active');

  const toggle = (id: string) =>
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length >= MAX_MEMBERS ? now : [...now, id]));

  const submit = () =>
    create.mutate(
      { title: title.trim(), members: picked },
      { onSuccess: (group) => router.replace({ pathname: '/assistants/group/[id]', params: { id: group.id } }) },
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
      <KeyboardInset>
        {!served && !bootstrap.isLoading ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$2" padding="$6">
            <Text color={colors.text} fontSize={16} fontWeight="700">Groups are not available</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
          </YStack>
        ) : (
          <ScrollView flex={1} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32, gap: 12 }}>
            <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
              Pick {MIN_MEMBERS}–{MAX_MEMBERS} Assistants. In the group, only the ones you @ are asked — a message with no @ wakes nobody.
            </Text>
            <Field value={title} onChange={setTitle} placeholder="Group name (optional)" />
            <Card padded={false}>
              {candidates.length === 0 ? (
                <Text color={colors.textMuted} fontSize={13} padding={spacing.card}>Create at least two Assistants first.</Text>
              ) : (
                candidates.map((a) => {
                  const on = picked.includes(a.id);
                  return (
                    <Tap key={a.id} role="checkbox" accessibilityLabel={a.name} accessibilityState={{ checked: on }} onPress={() => toggle(a.id)}>
                      <XStack alignItems="center" gap={12} padding={spacing.card}>
                        <Avatar id={a.id} name={a.name} size={36} />
                        <Text flex={1} color={colors.text} fontSize={15} fontWeight="600" numberOfLines={1}>{a.name}</Text>
                        {on ? <Icon as={Check} size="md" tone="accent" /> : null}
                      </XStack>
                    </Tap>
                  );
                })
              )}
            </Card>
            {create.isError ? <Text color={colors.danger} fontSize={12.5} lineHeight={18}>{personalAgentMessage(create.error)}</Text> : null}
            <PillButton label="Create group" disabled={picked.length < MIN_MEMBERS || create.isPending} onPress={submit} />
          </ScrollView>
        )}
      </KeyboardInset>
    </SafeAreaView>
  );
}
