// [INPUT]: a route param `id` (the Assistant) and the Host's capability bits for Work style, Memory and Behavior.
// [OUTPUT]: SettingsScreen — the one Settings entry of an Assistant: three rows (Work style, Memory, Behavior) that open the screens
//           which already own them. A row appears only when the Host serves its capability.
// [POS]: Replaces three separate pills on the Assistant's page (2026-11-07 subtraction). It holds no state and writes nothing; the
//        screens it opens keep their own revision-fenced writes.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, XStack, YStack } from 'tamagui';

import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Card } from '@/components/section';
import { Tap } from '@/components/tap';
import { useAssistantDetail, useBootstrapV3 } from '@/features/host/queries-v3';
import { IconChevronRight } from '@/theme/glyphs';
import { colors, spacing } from '@/theme/tokens';

type Row = { key: string; title: string; hint: string; open: (id: string) => void };

export default function SettingsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bootstrap = useBootstrapV3();
  const caps = bootstrap.data?.capabilities;
  const detail = useAssistantDetail(id ?? '', caps?.personalAgent === true);
  const rows: Row[] = [
    ...(caps?.personalAgentPersona === true
      ? [{ key: 'style', title: 'Work style', hint: 'Instructions, and the Agent and model it starts with', open: (a: string) => router.push({ pathname: '/assistants/style/[id]', params: { id: a } }) }]
      : []),
    ...(caps?.personalAgentMemory === true
      ? [{ key: 'memory', title: 'Memory', hint: 'The notes you write and the notes it keeps', open: (a: string) => router.push({ pathname: '/assistants/memory/[id]', params: { id: a } }) }]
      : []),
    ...(caps?.personalAgentProactivity === true
      ? [{ key: 'behavior', title: 'Behavior', hint: 'Work on its own, and quiet hours', open: (a: string) => router.push({ pathname: '/assistants/behavior/[id]', params: { id: a } }) }]
      : []),
  ];
  return (
    <Screen back title="Settings" subtitle={detail.data?.assistant.name}>
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView flex={1} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 32 }}>
          {rows.length === 0 ? (
            <YStack alignItems="center" gap="$2" padding="$6">
              <Text color={colors.text} fontSize={16} fontWeight="700">Nothing to set here</Text>
              <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>Update Solco on your computer, then try again.</Text>
            </YStack>
          ) : (
            <Card>
              {rows.map((row) => (
                <Tap key={row.key} role="button" accessibilityLabel={row.title} onPress={() => row.open(id ?? '')}>
                  <XStack alignItems="center" gap={12} padding={spacing.card}>
                    <YStack flex={1} gap={2}>
                      <Text color={colors.text} fontSize={15} fontWeight="700">{row.title}</Text>
                      <Text color={colors.textMuted} fontSize={12.5}>{row.hint}</Text>
                    </YStack>
                    <Icon as={IconChevronRight} size="sm" tone="subtle" />
                  </XStack>
                </Tap>
              ))}
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
