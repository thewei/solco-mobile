// [INPUT]: the paired Host's Feedback endpoints (GET /api/v3/feedback, POST …/asks/{id}/answer|end; needs `capabilities.feedback`)
//          and the optional `thread` / `ask` params of a notification tap.
// [OUTPUT]: Feedback — a stack screen (Settings → Agents → Feedback, the Chats banner, or a tap on an Agent-question
//           notification) that is the desktop's own Feedback page: Agents' questions grouped into threads per project and
//           Agent, the answer form last in a thread's timeline.
// [POS]: Third client of the desktop Feedback inbox (2026-11-09 design). The Mac's broker owns every thread and Ask; this
//        screen embeds the shared page (the same bundle as Chat, `route: 'feedback'`) and `features/feedback/controller`
//        answers its `feedback.*` calls from the Host. No Mac path and no conversation reaches the phone: "Open project"
//        is a Mac action and is not drawn.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatPageView } from '@/components/chat/chat-page-view';
import { EmptyState } from '@/components/empty-state';
import { KeyboardInset } from '@/components/keyboard-inset';
import { Fade } from '@/components/motion';
import { Screen } from '@/components/screen';
import { ListSkeleton } from '@/components/skeletons';
import { createFeedbackController } from '@/features/feedback/controller';
import { useBootstrapV3 } from '@/features/host/queries-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { IconInbox } from '@/theme/glyphs';
import { activeScheme, colors } from '@/theme/tokens';

export default function FeedbackScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { client } = useHostV3();
  const bootstrap = useBootstrapV3();
  const params = useLocalSearchParams<{ thread?: string; ask?: string }>();
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const served = bootstrap.data?.capabilities.feedback === true;
  const manageable = bootstrap.data?.capabilities.feedbackManage === true;
  // A landing is a link's thread + ask. Only a new link changes the params (moving inside the page never does), so a
  // link tapped while this screen is already open (a warm start from a Feishu message) re-seats it, nothing else does.
  const landingKey = params.thread ? `${params.thread}:${params.ask ?? ''}` : '';
  const landing = useMemo(() => (params.thread ? { thread: params.thread, ask: params.ask ?? '' } : undefined), [params.thread, params.ask]);
  const ready = readyFor === landingKey;

  const controller = useMemo(() => {
    if (!client) return null;
    return createFeedbackController(
      {
        snapshot: (thread, query) => client.feedback(thread || undefined, query || undefined),
        answer: async (askId, request) => {
          await client.feedbackAnswer(askId, request);
          void queryClient.invalidateQueries({ queryKey: ['v3', 'feedback'] });
        },
        end: async (askId) => {
          await client.feedbackEnd(askId);
          void queryClient.invalidateQueries({ queryKey: ['v3', 'feedback'] });
        },
        manage: manageable
          ? {
              deleteThreads: async (ids) => {
                const deleted = await client.feedbackDelete(ids);
                void queryClient.invalidateQueries({ queryKey: ['v3', 'feedback'] });
                return deleted;
              },
              cleanup: async (days, dryRun) => {
                const count = await client.feedbackCleanup(days, dryRun);
                if (!dryRun) void queryClient.invalidateQueries({ queryKey: ['v3', 'feedback'] });
                return count;
              },
              setRetention: (days) => client.feedbackRetention(days),
            }
          : undefined,
      },
      activeScheme,
      landing,
    );
  }, [client, queryClient, landing, manageable]);

  let body: React.ReactNode;
  if (bootstrap.data && !served) {
    body = <EmptyState icon={IconInbox} title="No Feedback on this Mac" text="Update Solco on the computer to receive Agent questions here." action="Back" onAction={() => router.back()} />;
  } else if (!controller || !bootstrap.data) {
    body = <ListSkeleton />;
  } else {
    body = (
      <View key={landingKey} style={{ flex: 1 }}>
        <Fade style={StyleSheet.absoluteFill}>
          <ChatPageView route="feedback" state={null} conversationId="feedback" onCall={controller.call} onReady={() => setReadyFor(landingKey)} />
        </Fade>
        {!ready ? (
          <Fade style={StyleSheet.absoluteFill}>
            <View accessibilityRole="progressbar" accessibilityLabel="Loading feedback" pointerEvents="none" style={{ flex: 1, backgroundColor: colors.canvas }}>
              <ListSkeleton />
            </View>
          </Fade>
        ) : null}
      </View>
    );
  }

  return (
    <Screen back title="Feedback">
      {/* Edge-to-edge Android never resizes the window: the answer field would sit under the keyboard (Chat does the same). */}
      <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.canvas }}>
        <KeyboardInset>{body}</KeyboardInset>
      </SafeAreaView>
    </Screen>
  );
}
