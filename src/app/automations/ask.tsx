// [INPUT]: the Mac's draft brief (`draftPrompt` of the Automations list), the Host's launch kinds and the tree.
// [OUTPUT]: AutomationAskScreen — "Let an Agent Draft": the new-session composer prefilled with the desktop's own brief for
//           drafting an automation, the user finishing it with one sentence of what they want.
// [POS]: The desktop's ✦ Let an Agent Draft, handed to a real Agent instead of the clipboard: the session starts on the Mac
//        through the ordinary launch path (nothing is sent without the user's Send) and the agent creates the automation with
//        `--draft`, so it stays off until it is approved on its detail screen. Client-local; never moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, YStack } from 'tamagui';

import { KeyboardInset } from '@/components/keyboard-inset';
import { LaunchComposer } from '@/components/launch-composer';
import { ListSkeleton } from '@/components/skeletons';
import { useHostAutomations, useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { colors } from '@/theme/tokens';

export default function AutomationAskScreen() {
  const { bootstrap, instance } = useHostInstance();
  const list = useHostAutomations(true);
  const tree = useTreeV3(instance);
  const chatServed = bootstrap.data?.capabilities.chat === true;
  const launchKinds = bootstrap.data?.capabilities.launch ? (bootstrap.data.launchKinds ?? []) : [];
  const brief = list.data?.draftPrompt;

  return (
    <>
      <Stack.Screen options={{ title: 'Let an Agent Draft' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        {list.isLoading || bootstrap.isLoading ? (
          <YStack flex={1} padding="$4"><ListSkeleton rows={3} /></YStack>
        ) : !instance || launchKinds.length === 0 || !brief ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text color={colors.text} fontSize={16} fontWeight="700">Not available</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center" lineHeight={19}>
              Your computer can’t start an agent from here right now. Update Solco there, or ask an agent on the computer.
            </Text>
          </YStack>
        ) : (
          <KeyboardInset>
            <YStack flex={1} padding="$4" gap="$2">
              <Text color={colors.textMuted} fontSize={13} lineHeight={19}>
                Describe the automation in one sentence at the end of the message. The agent drafts it; nothing runs until you approve it.
              </Text>
            </YStack>
            <LaunchComposer
              instance={instance}
              kinds={launchKinds}
              workspaces={tree.data?.workspaces ?? []}
              chatServed={chatServed}
              initialPrompt={`${brief}\n\nThe automation I want: `}
              replace
            />
          </KeyboardInset>
        )}
      </SafeAreaView>
    </>
  );
}
