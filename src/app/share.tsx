// [INPUT]: the shared text waiting in the share store (from the system share sheet, see features/share), the Host's
//          tree (agents), launch kinds and chat capability.
// [OUTPUT]: ShareScreen — the destination picker: the text, the Mac's agents (Needs you / Working / Idle) and a new-session
//           composer prefilled with it.
// [POS]: "Share to Solco" lands here. Choosing a running agent opens its Chat with the text as the draft (the user reviews
//        and sends — nothing is sent for them); the composer starts a new session with it as the first prompt. Client-local
//        navigation; nothing moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, YStack } from 'tamagui';

import { KeyboardInset } from '@/components/keyboard-inset';
import { LaunchComposer } from '@/components/launch-composer';
import { AgentGroups } from '@/components/agent-groups';
import { ListSkeleton } from '@/components/skeletons';
import { paneRoute, summarize, type FlatPane } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useNow } from '@/lib/use-now';
import { useShareStore } from '@/state/share-store';
import { colors, radii } from '@/theme/tokens';

export default function ShareScreen() {
  const router = useRouter();
  const now = useNow();
  const text = useShareStore((state) => state.text);
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const chatServed = bootstrap.data?.capabilities.chat === true;
  const launchKinds = bootstrap.data?.capabilities.launch ? (bootstrap.data.launchKinds ?? []) : [];
  const workspaces = tree.data?.workspaces ?? [];
  const summary = summarize(workspaces);

  // The Chat route already carries the text as its draft; replace this page so Back returns to where the user came from.
  const sendTo = (pane: FlatPane['pane']) => {
    if (!instance || !text) return;
    const route = paneRoute(pane, instance, chatServed);
    router.replace(route.pathname === '/chat/[paneId]' ? { ...route, params: { ...route.params, draft: text } } : route);
    useShareStore.getState().clear(); // the Chat now owns the text as its draft
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Share to Solco', headerBackTitle: 'Back' }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['bottom']}>
        {!text ? (
          <YStack flex={1} alignItems="center" justifyContent="center" padding="$6" gap="$2">
            <Text color={colors.text} fontSize={16} fontWeight="700">Nothing to share</Text>
            <Text color={colors.textMuted} fontSize={13} textAlign="center">Share text or a link to Solco from another app.</Text>
          </YStack>
        ) : (
          <KeyboardInset>
            <ScrollView flex={1} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              <YStack marginTop="$3" padding="$3" backgroundColor={colors.surface} borderColor={colors.border} borderWidth={1} borderRadius={radii.lg}>
                <Text color={colors.text} fontSize={14} lineHeight={20} numberOfLines={6} selectable>{text}</Text>
              </YStack>
              {instance && chatServed ? (
                <>
                  <AgentGroups summary={summary} instance={instance} now={now} onOpen={sendTo} />
                  {summary.needsYou.length + summary.working.length + summary.idle.length === 0 && !tree.isLoading ? (
                    <Text color={colors.textSubtle} fontSize={13} paddingTop="$4">No agent is running. Start one below.</Text>
                  ) : null}
                </>
              ) : null}
              {tree.isLoading || bootstrap.isLoading ? <YStack paddingTop="$4"><ListSkeleton rows={3} /></YStack> : null}
              {launchKinds.length > 0 ? (
                <Text color={colors.textSubtle} fontSize={12} paddingTop="$4">Or start a new session with it:</Text>
              ) : null}
            </ScrollView>
            {instance && launchKinds.length > 0 ? (
              <LaunchComposer instance={instance} kinds={launchKinds} workspaces={workspaces} chatServed={chatServed} initialPrompt={text} replace />
            ) : null}
          </KeyboardInset>
        )}
      </SafeAreaView>
    </>
  );
}
