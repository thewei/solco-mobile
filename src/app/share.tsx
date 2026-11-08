// [INPUT]: the shared text waiting in the share store (from the system share sheet, see features/share), the Host's
//          tree (agents), launch kinds and chat capability.
// [OUTPUT]: ShareScreen — the destination picker: the text, the Mac's agents (Needs you / Working / Idle) and a new-session
//           composer prefilled with it.
// [POS]: "Share to Solco" lands here. Choosing a running agent opens its Chat with the text as the draft (the user reviews
//        and sends — nothing is sent for them); the composer starts a new session with it as the first prompt. Client-local
//        navigation; nothing moves the Mac's focus.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, Text, YStack } from 'tamagui';

import { EmptyState } from '@/components/empty-state';
import { KeyboardInset } from '@/components/keyboard-inset';
import { LaunchComposer } from '@/components/launch-composer';
import { AgentGroups } from '@/components/agent-groups';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { paneRoute, summarize, type FlatPane } from '@/features/host/pane-model';
import { useHostInstance, useTreeV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useNow } from '@/lib/use-now';
import { useShareStore } from '@/state/share-store';
import { IconShare } from '@/theme/glyphs';
import { colors, radii, type as typeScale } from '@/theme/tokens';

export default function ShareScreen() {
  const router = useRouter();
  const now = useNow();
  const text = useShareStore((state) => state.text);
  const { connection } = useHostV3();
  const { bootstrap, instance } = useHostInstance();
  const tree = useTreeV3(instance);
  const hostName = connection?.name || bootstrap.data?.hostName || 'This computer';
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
    <Screen back title="Share to Solco">
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        {!text ? (
          <EmptyState icon={IconShare} title="Nothing to share" text="Share text or a link to Solco from another app." />
        ) : (
          <KeyboardInset>
            <ScrollView flex={1} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              <YStack marginTop="$3" padding="$3" backgroundColor={colors.surfaceRaised} borderRadius={radii.lg}>
                <Text color={colors.text} fontSize={typeScale.label.fontSize} lineHeight={20} numberOfLines={6} selectable>{text}</Text>
              </YStack>
              {instance && chatServed ? (
                <>
                  <AgentGroups summary={summary} hostName={hostName} now={now} onOpen={sendTo} />
                  {summary.needsYou.length + summary.working.length + summary.idle.length === 0 && !tree.isLoading ? (
                    <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingTop="$4">No agent is running. Start one below.</Text>
                  ) : null}
                </>
              ) : null}
              {tree.isLoading || bootstrap.isLoading ? <YStack paddingTop="$4"><ListSkeleton rows={3} /></YStack> : null}
              {launchKinds.length > 0 ? (
                <Text color={colors.textMuted} fontSize={typeScale.label.fontSize} lineHeight={typeScale.label.lineHeight} paddingTop="$4">Or start a new session with it:</Text>
              ) : null}
            </ScrollView>
            {instance && launchKinds.length > 0 ? (
              <LaunchComposer instance={instance} kinds={launchKinds} workspaces={workspaces} chatServed={chatServed} initialPrompt={text} replace />
            ) : null}
          </KeyboardInset>
        )}
      </SafeAreaView>
    </Screen>
  );
}
