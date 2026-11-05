// [INPUT]: the paired HostClientV3 (useHostV3/useHostInstance), the v3 tree query cache, the
//          native keep-alive module (solco-foreground-service via lib/foreground-service-native)
//          and expo-notifications (local notifications only — no FCM, which China vivo lacks).
// [OUTPUT]: BackgroundBridge (the app-wide owner of what must outlive backgrounding) and
//           useLiveTreeEvents.
// [POS]: Single owner, mounted once in the root layout: the one events socket (`useTreeEvents` is
//        mounted here and shared through context, so Home and the bridge never open two), the
//        Android keep-alive foreground service (paired → held in the foreground too; its ongoing
//        notification is the live agent status line "Needs you: N · Working: N · Idle: N"),
//        and desktop-rule attention notifications (attention-delivery.ts: raised in the foreground too, only the
//        pane on screen is skipped) with tap-through to the pane, inline Reply (stopped agent) and
//        inline Approve / Deny (blocked agent whose permission card is unambiguous), and the live redraw of the
//        Android home-screen widget (features/widget), and the automation-step notifications (the
//        Host's `automation` events frame → automation-notice.ts, same channel). Screens stay consumers.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariant: everything here is a no-op on Web and iOS (no native service, no scheduling), and a
// notification is only ever raised for a tree the shared socket actually delivered.
import * as Notifications from 'expo-notifications';
import { useGlobalSearchParams, useRouter, type Href } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import {
  APPROVE_ACTION,
  APPROVE_CATEGORY,
  approvalOf,
  DENY_ACTION,
  parseApproval,
  parseReply,
  REPLY_ACTION,
  ATTENTION_CHANNEL,
  REPLY_CATEGORY,
  type AttentionEvent,
} from '@/features/host/attention';
import { createAttentionDelivery } from '@/features/host/attention-delivery';
import { automationNotice, type AutomationFrame } from '@/features/host/automation-notice';
import { createAssistantActivityNoticePump } from '@/features/host/assistant-activity-notice';
import { assistantPushRoute, assistantPushHostId } from '@/features/host/system-push-route';
import { newRequestId } from '@/features/host/launch-model';
import { keepAliveStatus } from '@/features/host/keep-alive-status';
import { paneRoute, summarize } from '@/features/host/pane-model';
import { useBootstrapV3, useHostInstance, useTreeEvents, useTreeV3 } from '@/features/host/queries-v3';
import { getForegroundService } from '@/lib/foreground-service-native';
import { expoProjectId } from '@/lib/expo-push-config';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useConnectionHealth } from '@/features/host/use-connection-health';
import { pushWidgetUpdate } from '@/features/widget/widget-sync';

const LiveEventsContext = createContext<boolean>(false);

/** A permission card is read a few times: the agent turns `blocked` a moment before its screen prompt is structured. */
const APPROVAL_READS = 3;
const APPROVAL_READ_GAP_MS = 1_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function BackgroundBridge({ children }: PropsWithChildren) {
  const router = useRouter();
  const { client, connection, hosts, activeId, status: hostStatus, switchTo } = useHostV3();
  const hostBootstrap = useBootstrapV3();
  useConnectionHealth(); // network/app/request signals → the ConnectionManager (fastest route, dead sockets rebuilt)
  const { instance, bootstrap } = useHostInstance();
  const tree = useTreeV3(instance);
  // A Mac automation's step (draft / started / done / failed) arrives as one events frame and becomes one
  // notification under the desktop's identity; a refused one (permission off) must never break the socket.
  const onAutomation = useCallback((frame: AutomationFrame) => {
    if (Platform.OS === 'web') return;
    const { identifier, title, body, data } = automationNotice(frame);
    void Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, data },
      trigger: { channelId: ATTENTION_CHANNEL },
    }).catch(() => undefined);
  }, []);
  const pollAssistantNotices = useRef<(() => void) | null>(null);
  const onAssistantActivity = useCallback(() => pollAssistantNotices.current?.(), []);
  const live = useTreeEvents(instance, onAutomation, onAssistantActivity);
  const clientRef = useRef(client);
  clientRef.current = client;

  // One heads-up channel for attention notifications: a silent LOW one sat unseen in the shade, and
  // "an agent needs you" is worth a banner. Android channels are immutable once created, so recreate
  // it on every cold start to pick up config changes. The runtime permission (Android 13+) is asked
  // here, once, instead of only from the Connect screen's card nobody opens.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      // Foreground delivery: without a handler the OS shows nothing while the app is open.
      Notifications.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
      await Notifications.deleteNotificationChannelAsync(ATTENTION_CHANNEL).catch(() => undefined);
      await Notifications.setNotificationChannelAsync(ATTENTION_CHANNEL, {
        name: 'Agent activity',
        importance: Notifications.AndroidImportance.HIGH,
      });
      const permission = await Notifications.getPermissionsAsync().catch(() => undefined);
      if (permission && !permission.granted && permission.canAskAgain) await Notifications.requestPermissionsAsync().catch(() => undefined);
      // Inline Reply for a stopped agent: typed in the shade, delivered without opening the app.
      await Notifications.setNotificationCategoryAsync(REPLY_CATEGORY, [
        {
          identifier: REPLY_ACTION,
          buttonTitle: 'Reply',
          textInput: { submitButtonTitle: 'Send', placeholder: 'Message the agent' },
          options: { opensAppToForeground: false },
        },
      ]).catch(() => undefined);
      // Inline Approve / Deny for a blocked agent's permission card: the answer is the card's own row
      // (never one that saves the choice), sent for that card id so a moved-on prompt is refused.
      await Notifications.setNotificationCategoryAsync(APPROVE_CATEGORY, [
        { identifier: APPROVE_ACTION, buttonTitle: 'Approve', options: { opensAppToForeground: false } },
        { identifier: DENY_ACTION, buttonTitle: 'Deny', options: { opensAppToForeground: false, isDestructive: true } },
      ]).catch(() => undefined);
    })();
  }, []);

  // Android already keeps this one events socket and JS alive when paired.
  // Use its change hint plus a bounded fallback poll to hand committed Solco
  // facts to the OS, even when the Activity screen is not open. No push
  // provider and no second Agent runtime. Notice ACKs are device-scoped and
  // independent of the person's Activity History "Mark seen" cursor.
  const canNotifyAssistant = hostBootstrap.data?.capabilities.personalAgent === true
    && hostBootstrap.data?.capabilities.personalAgentManage === true
    && hostBootstrap.data?.capabilities.personalAgentActivityNotices === true;
  useEffect(() => {
    if (Platform.OS !== 'android' || !client || !canNotifyAssistant) return undefined;
    let current = true;
    const pump = createAssistantActivityNoticePump({
      overview: () => client.personalAgentOverview(),
      unread: (id) => client.assistantNotificationActivity(id),
      mayNotify: async (id) => !(await client.assistantProactivity(id)).quietNow,
      ack: (requestId, id, seq) => client.ackAssistantNotification(requestId, id, seq),
      nextRequestId: newRequestId,
      isCurrent: () => current,
      schedule: async ({ identifier, title, body, data }) => {
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted || !current) throw new Error('Assistant Activity notifications are unavailable');
        await Notifications.scheduleNotificationAsync({
          identifier,
          content: { title, body, data },
          trigger: { channelId: ATTENTION_CHANNEL },
        });
      },
    });
    const poll = () => { void pump.poll(); };
    pollAssistantNotices.current = poll;
    poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      current = false;
      pollAssistantNotices.current = null;
      clearInterval(timer);
    };
  }, [client, canNotifyAssistant]);

  // Reconcile an *already opted-in* Expo push token on app resume and FCM
  // rotation. This is NOT registration: the Host's /refresh endpoint refuses
  // when the owner disabled remote push, even across a concurrent race.
  // The phone keeps its local notice pump independently for GMS-less ROMs.
  const canSystemPush = hostBootstrap.data?.capabilities.assistantSystemPush === true;
  useEffect(() => {
    const projectId = expoProjectId();
    if (Platform.OS !== 'android' || !client || !canSystemPush || !projectId) return undefined;
    let current = true;
    let updating = false;
    const renew = (deviceToken?: Notifications.DevicePushToken) => {
      if (updating || !current) return;
      updating = true;
      void (async () => {
        try {
          const status = await client.systemPushStatus();
          if (!current || !status.enabled) return;
          const permission = await Notifications.getPermissionsAsync();
          if (!current || !permission.granted) return;
          // The native rotation listener already gives the new FCM token.
          // Passing it explicitly avoids recursively calling
          // getDevicePushTokenAsync from inside that same listener.
          const token = await Notifications.getExpoPushTokenAsync({
            projectId, ...(deviceToken ? { devicePushToken: deviceToken } : {}),
          });
          if (current) await client.refreshSystemPushToken(token.data);
        } catch {
          // Older host, unavailable Google Play Services, offline Mac, and
          // explicit opt-out are not fatal. The next foreground resumes.
        } finally {
          updating = false;
        }
      })();
    };
    renew();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') renew();
    });
    const rotated = Notifications.addPushTokenListener((deviceToken) => renew(deviceToken));
    return () => {
      current = false;
      rotated.remove();
      appState.remove();
    };
  }, [client, canSystemPush]);

  // The ongoing notification is the agent status line (Needs you / Working / Idle), re-posted as the tree moves.
  const summary = useMemo(() => (tree.data ? summarize(tree.data.workspaces) : null), [tree.data]);
  const hostName = connection?.name || bootstrap.data?.hostName;
  const reachable = !tree.isError && !bootstrap.isError;
  const status = useMemo(
    () =>
      keepAliveStatus({
        name: hostName,
        counts: summary ? { needsYou: summary.needsYou.length, working: summary.working.length, idle: summary.idle.length } : null,
        reachable,
      }),
    [summary, hostName, reachable],
  );
  const statusRef = useRef(status);
  statusRef.current = status;

  // Keep-alive: hold the process (and with it the pinned sockets) for as long as the phone is paired —
  // in the foreground too, so the status line is always in the shade. A start refused from the
  // background is swallowed by the seam and retried on the next app-state change.
  // The effect depends on whether there is a client, not on which: a route switch (relay ⇄ P2P ⇄ direct)
  // rebuilds the client and must not bounce the service (stop + start).
  const hasClient = client !== null;
  useEffect(() => {
    const service = getForegroundService();
    if (!service || !hasClient) return undefined;
    service.start(statusRef.current);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') service.start(statusRef.current); // a start refused in the background lands now
    });
    return () => {
      sub.remove();
      service.stop();
    };
  }, [hasClient]);

  useEffect(() => {
    getForegroundService()?.update(status);
  }, [status]);

  // The Host's desktop notification rules, verbatim (features/host/attention.ts): exactly three
  // transitions notify and first observation / same-status echoes never do. Foreground and background
  // are one path (features/host/attention-delivery.ts) — the only suppression is the pane on screen.
  // A posted notification replaces itself under the desktop's stable identity; when the agent resumes
  // working or its pane vanishes, the stale one withdraws.
  const chatServed = bootstrap.data?.capabilities.chat === true;
  const viewed = useGlobalSearchParams<{ paneId?: string; terminalId?: string }>();
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;
  const delivery = useMemo(
    () =>
      createAttentionDelivery({
        schedule: async ({ identifier, title, body, data, categoryIdentifier }) => {
          await Notifications.scheduleNotificationAsync({
            identifier,
            content: { title, body, data, ...(categoryIdentifier ? { categoryIdentifier } : {}) },
            // `{ channelId }` alone is the 0.32 way to deliver immediately on that channel.
            trigger: { channelId: ATTENTION_CHANNEL },
          });
        },
        dismiss: (identifier) => Notifications.dismissNotificationAsync(identifier).catch(() => undefined),
      }),
    [],
  );
  useEffect(() => {
    if (Platform.OS === 'web' || instance === null) return undefined;
    const workspaces = tree.data?.workspaces;
    if (!workspaces) return undefined;
    pushWidgetUpdate(workspaces, instance, chatServed); // the home-screen widget follows the same tree, live
    void (async () => {
      const viewing = AppState.currentState === 'active' ? viewedRef.current : undefined;
      const posted = await delivery
        .apply({ workspaces, instance, chatServed, viewing })
        .catch(() => [] as AttentionEvent[]); // a refused notification (permission off) must never break the tree
      for (const event of posted) {
        const route = paneRoute(event.pane.pane, instance, chatServed);
        // The plain notification is out at once; a permission card found behind it upgrades it in place.
        if (event.kind === 'needs-attention' && chatServed) {
          void (async () => {
            for (let read = 0; read < APPROVAL_READS; read += 1) {
              if (read > 0) await sleep(APPROVAL_READ_GAP_MS);
              if (!delivery.has(event.identity)) return; // withdrawn meanwhile
              const chat = await clientRef.current?.chat(instance, event.pane.pane.paneId).catch(() => undefined);
              if (!chat || (chat.agentStatus !== undefined && chat.agentStatus !== 'blocked')) return;
              const approval = approvalOf(chat.interaction);
              if (!approval) continue;
              await Notifications.scheduleNotificationAsync({
                identifier: event.identity,
                content: {
                  title: event.title,
                  body: chat.interaction?.prompt ? chat.interaction.prompt.slice(0, 160) : event.body,
                  data: { route: JSON.stringify(route), instance, paneId: event.pane.pane.paneId, approval },
                  categoryIdentifier: APPROVE_CATEGORY,
                },
                trigger: { channelId: ATTENTION_CHANNEL },
              });
              return;
            }
          })();
        }
      }
    })();
    return undefined;
  }, [tree.data, instance, chatServed, delivery]);

  // Tap-through: the notification carries its own pane route; a malformed payload is dropped.
  // An inline Approve / Deny goes to the same card answer as the open Chat (Herdr-gated, refused when the card moved on);
  // an inline Reply goes to the same Chat send as the in-app composer (Herdr-gated: a busy or
  // not-ready agent refuses) and never opens the app; a refusal is told in a notification of its own.
  const handledPushes = useRef(new Set<string>());
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const handlePushRoute = (response: Notifications.NotificationResponse): boolean => {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
      const data = response.notification.request.content.data;
      const route = assistantPushRoute(data);
      if (!route) return false;
      const hasMac = data?.hostId !== undefined;
      const mac = hasMac ? assistantPushHostId(data) : null;
      // A remote push from a removed/unknown Mac cannot navigate in the
      // currently selected Mac, even if Assistant IDs happen to collide.
      if (hasMac && !mac) return true;
      // A cold-start response may arrive before SecureStore has hydrated
      // the paired Host book; do not navigate before the root route is ready.
      // Keep it cached and reconsider once the paired state is known.
      if (hostStatus === 'loading') return true;
      const matching = mac ? hosts.find((host) => host.fingerprint.slice(0, 16).toLowerCase() === mac) : null;
      if (hostStatus !== 'paired' || (mac && !matching)) {
        void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        return true;
      }
      const key = response.notification.request.identifier + ':' + response.notification.date;
      if (handledPushes.current.has(key)) return true;
      handledPushes.current.add(key);
      if (handledPushes.current.size > 128) handledPushes.current.clear();
      void (async () => {
        try {
          if (matching && matching.fingerprint !== activeId) await switchTo(matching.fingerprint);
          router.push(route);
          // Never replay a prior push on the next cold launch after the user
          // already opened it, and never perform a notification action here.
          await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
        } catch {
          handledPushes.current.delete(key);
        }
      })();
      return true;
    };
    // Android may start the process by tapping FCM while no React listener
    // existed. Replaying only a validated navigation (never inline actions)
    // makes a true background OS push open the correct Activity page.
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) handlePushRoute(last);
    }).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (handlePushRoute(response)) return;
      const content = response.notification.request.content;
      const userText = 'userText' in response ? (response.userText as string | undefined) : undefined;
      const reply = parseReply(response.actionIdentifier, userText, content.data);
      const approval = parseApproval(response.actionIdentifier, content.data);
      if (approval) {
        void (async () => {
          try {
            if (!client) throw new Error('Not connected.');
            await client.answerChat(approval.instance, approval.paneId, approval.request);
            await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => undefined);
          } catch {
            await Notifications.scheduleNotificationAsync({
              content: { title: 'Answer not delivered', body: 'The prompt may have moved on. Open the chat.', data: { route: content.data?.route } },
              trigger: { channelId: ATTENTION_CHANNEL },
            });
          }
        })();
        return;
      }
      if (reply) {
        void (async () => {
          try {
            if (!client) throw new Error('Not connected.');
            await client.sendChat(reply.instance, reply.paneId, { text: reply.text });
            await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => undefined);
          } catch {
            await Notifications.scheduleNotificationAsync({
              content: { title: 'Reply not delivered', body: 'Open the chat to send it again.', data: content.data },
              trigger: { channelId: ATTENTION_CHANNEL },
            });
          }
        })();
        return;
      }
      const raw = response.notification.request.content.data?.route;
      if (typeof raw !== 'string') return;
      try {
        router.push(JSON.parse(raw) as Href);
      } catch {
        // Never a crash on tap.
      }
    });
    return () => sub.remove();
  }, [router, client, hosts, activeId, hostStatus, switchTo]);

  return <LiveEventsContext.Provider value={live}>{children}</LiveEventsContext.Provider>;
}

/** Whether the shared events socket is currently live; Home's connection pill reads this. */
export function useLiveTreeEvents(): boolean {
  return useContext(LiveEventsContext);
}
