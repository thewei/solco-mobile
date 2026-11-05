// [INPUT]: the paired HostClientV3 from useHostV3.
// [OUTPUT]: useHostInstance (bootstrap as seen from the chosen instance + that instance), useConnectDevice (bring a saved machine up and switch to it), useHostProbes, useTreeV3, usePeekV3, useTreeEvents, useChatStream, useGitStatus, useGitDiff, useGitWrite, useFilesList, useFileContent, useHostQuota, useRemoteDesktopInfo, useHostAutomations, useAutomationDetail, useAutomationWrite, usePersonalAgentOverview, useAssistantDetail, useAssistantInbox, useAssistantApprovals, usePersonalAgentWrite, useHostSessions, useHostSessionTrash.
// [POS]: TanStack Query adapters over the Go Host v3. Events are a hint to refetch, never a source
//        of truth: a dropped socket only slows updates, and a 401 forgets that Mac; `useHostProbes` answers "does each paired Mac respond" for the Mac list.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariant: query keys all start with 'v3' so switching or removing a Mac clears them in one call; the tree is
// always refetched from the Host, never patched from an event.
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AssistantCommitmentInput, AssistantGoalAction, AssistantTaskAction, AutomationFields, AutomationOp, Automations, ChatFrame, DeviceConnectResponse, GitCommitRequest, GitSyncOp, GitWriteResult, ProactivityInput, TreeV3 } from '@/contracts/host-v3';
import { type AutomationFrame } from '@/features/host/automation-notice';
import { newRequestId } from '@/features/host/launch-model';
import { createRequestIds } from '@/features/host/personal-agent-model';
import { capabilitiesFor, launchKindsFor, selectableInstances } from '@/features/host/device-model';
import { probeStateOf, type ProbeState } from '@/features/host/host-card-model';
import { hostId } from '@/lib/host-book';
import { HostV3Error } from '@/lib/host-client-v3';
import { useHostV3 } from '@/lib/host-v3-provider';
import { useSessionStore } from '@/state/session-store';

const TREE_FALLBACK_REFETCH_MS = 20_000;
const PEEK_REFETCH_MS = 4_000;
const EVENTS_BACKOFF_BASE_MS = 500;
const EVENTS_BACKOFF_CAP_MS = 15_000;
/** The Host beats every 5 s; two missed beats plus slack, and the socket is called dead. */
const EVENTS_SILENCE_MS = 13_000;
const EVENTS_WATCHDOG_MS = 3_000;
const NO_CONVERSATION_RECHECK_MS = 3_000;
/** A revoked device token (401) drops that Mac's pairing (by id, so a second observer is harmless) and the app returns to the connect screen. */
function useForgetOnUnauthorized(error: unknown) {
  const { remove, activeId } = useHostV3();
  useEffect(() => {
    if (activeId && error instanceof HostV3Error && error.kind === 'unauthorized') void remove(activeId);
  }, [error, activeId, remove]);
}

// The Mac whose answer was last stamped on its card; reset by a failure so a recovery stamps again.
let lastStamped: string | null = null;

export function useBootstrapV3() {
  const { client, activeId, markConnected, noteNet } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'bootstrap'],
    queryFn: () => client!.bootstrap(),
    enabled: client !== null,
    retry: 1,
  });
  useForgetOnUnauthorized(query.error);
  useEffect(() => {
    if (query.isError) lastStamped = null;
    else if (query.isSuccess && activeId) {
      // The Mac's own serving address rides every bootstrap answer; merge it
      // before the stamp so a follow-up route race sees the fresh address.
      noteNet(query.data?.net?.addresses);
      if (lastStamped !== activeId) {
        lastStamped = activeId;
        void markConnected(activeId);
      }
    }
  }, [query.isSuccess, query.isError, query.data, activeId, markConnected, noteNet]);
  return query;
}

/**
 * Whether each paired Mac answers right now, keyed by Mac id: the active one reads the shared
 * bootstrap query, the others are probed once when `enabled` (a visible list) and again when stale.
 */
export function useHostProbes(enabled: boolean): Record<string, ProbeState> {
  const { hosts, activeId, probe } = useHostV3();
  const bootstrap = useBootstrapV3();
  const others = hosts.filter((host) => hostId(host) !== activeId);
  const results = useQueries({
    queries: others.map((host) => ({
      queryKey: ['v3', 'probe', hostId(host), host.host, host.port],
      queryFn: async () => {
        await probe(hostId(host));
        return true;
      },
      enabled,
      retry: false,
      staleTime: 15_000,
      gcTime: 0,
    })),
  });
  const out: Record<string, ProbeState> = {};
  if (activeId) out[activeId] = probeStateOf(bootstrap);
  others.forEach((host, index) => {
    out[hostId(host)] = probeStateOf(results[index]!);
  });
  return out;
}

/**
 * The Herdr session (or bridged device) this phone looks at: the user's pick if it is still on offer, else the first
 * session. The bootstrap it returns carries the capabilities as seen from that instance (a device has no Chat, Files,
 * Changes, …) and the launch kinds it can start.
 */
export function useHostInstance() {
  const query = useBootstrapV3();
  const selected = useSessionStore((state) => state.instanceId);
  const ids = selectableInstances(query.data?.instances ?? []).map((instance) => instance.id);
  const instance = selected && ids.includes(selected) ? selected : (ids[0] ?? null);
  const data = query.data
    ? { ...query.data, capabilities: capabilitiesFor(query.data.capabilities, instance), launchKinds: query.data.launchKinds && launchKindsFor(query.data.launchKinds, instance) }
    : query.data;
  return { bootstrap: { ...query, data } as typeof query, instance };
}

/**
 * Brings one of the Mac's saved machines up. On success the bootstrap is re-read (the device is `connected` now) and
 * the phone switches to it; a refusal leaves the current instance alone and re-reads too, since the status changed.
 */
export function useConnectDevice() {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const selectInstance = useSessionStore((state) => state.selectInstance);
  return useMutation<DeviceConnectResponse, Error, string>({
    mutationFn: (deviceKey) => (client ? client.connectDevice(deviceKey) : Promise.reject(new Error('Not connected'))),
    onSuccess: async (reply) => {
      await queryClient.invalidateQueries({ queryKey: ['v3', 'bootstrap'] });
      selectInstance(reply.instance);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['v3', 'bootstrap'] });
    },
  });
}

export function useTreeV3(instance: string | null) {
  const { client } = useHostV3();
  const query = useQuery<TreeV3>({
    queryKey: ['v3', 'tree', instance],
    queryFn: () => client!.tree(instance!),
    enabled: client !== null && instance !== null,
    refetchInterval: TREE_FALLBACK_REFETCH_MS,
    retry: 1,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export function usePeekV3(instance: string | null, paneId: string, enabled: boolean) {
  const { client } = useHostV3();
  return useQuery({
    queryKey: ['v3', 'peek', instance, paneId],
    queryFn: () => client!.peek(instance!, paneId),
    enabled: client !== null && instance !== null && enabled,
    refetchInterval: PEEK_REFETCH_MS,
    staleTime: 2_000,
    retry: false,
  });
}

/**
 * Keeps one events socket open for the instance and refetches the tree on every change signal.
 * Reconnects with a capped exponential backoff; returns whether the stream is currently live.
 */
export function useTreeEvents(instance: string | null, onAutomation?: (frame: AutomationFrame) => void, onAssistantActivity?: () => void): boolean {
  const { client, signal } = useHostV3();
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  const attempt = useRef(0);
  const onAutomationRef = useRef(onAutomation);
  onAutomationRef.current = onAutomation;
  const onAssistantActivityRef = useRef(onAssistantActivity);
  onAssistantActivityRef.current = onAssistantActivity;

  useEffect(() => {
    if (!client || !instance) return undefined;
    let stopped = false;
    let socket: { close(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Silence detection arms on the first heartbeat of a socket: an older Host sends none and is never judged by it.
    let lastFrame = Date.now();
    let armed = false;
    const watchdog = setInterval(() => {
      if (!armed || Date.now() - lastFrame <= EVENTS_SILENCE_MS) return;
      armed = false; // a dead path (a network switch leaves the old TCP half-open): leave it now, not when the OS gives up
      signal({ t: 'failure' });
      socket?.close();
    }, EVENTS_WATCHDOG_MS);

    const connect = () => {
      lastFrame = Date.now();
      armed = false;
      socket = client.openEvents(instance, {
        onMessage(message) {
          lastFrame = Date.now();
          attempt.current = 0;
          setLive(true);
          signal({ t: 'alive' });
          if (message.t === 'hb') {
            armed = true; // proof of life only: nothing changed, no refetch
            return;
          }
          if (message.t === 'automation') {
            onAutomationRef.current?.(message); // a step of a Mac automation: a notification, not a tree change
            void queryClient.invalidateQueries({ queryKey: ['v3', 'automations'] }); // an open Automations screen follows it
            return;
          }
          if (message.t === 'personal-agent.changed') {
            // A committed Activity fact can change without moving Task/Goal
            // counters. The Host sends only a hint; the client reads facts
            // from its durable cursor and never infers delivery from a frame.
            void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent'] });
            queryClient.setQueryData<number>(['v3', 'assistant-activity-hint'], (n) => (n ?? 0) + 1);
            onAssistantActivityRef.current?.();
            return;
          }
          void queryClient.invalidateQueries({ queryKey: ['v3', 'tree', instance] });
        },
        onClose() {
          setLive(false);
          armed = false;
          if (stopped) return;
          signal({ t: 'failure' });
          attempt.current += 1;
          const delay = Math.min(EVENTS_BACKOFF_BASE_MS * 2 ** (attempt.current - 1), EVENTS_BACKOFF_CAP_MS);
          timer = setTimeout(connect, delay);
        },
      });
    };
    connect();
    return () => {
      stopped = true;
      clearInterval(watchdog);
      if (timer) clearTimeout(timer);
      socket?.close();
      setLive(false);
    };
  }, [client, instance, queryClient, signal]);

  return live;
}

/** Working-tree changes of one Workspace folder; re-read on open and by pull-to-refresh (never polled). */
export function useGitStatus(instance: string | null, workspaceId: string) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'git', instance, workspaceId],
    queryFn: () => client!.gitStatus(instance!, workspaceId),
    enabled: client !== null && instance !== null,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export function useGitDiff(instance: string | null, workspaceId: string, path: string) {
  const { client } = useHostV3();
  return useQuery({
    queryKey: ['v3', 'git', instance, workspaceId, 'diff', path],
    queryFn: () => client!.gitDiff(instance!, workspaceId, path),
    enabled: client !== null && instance !== null,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
}

export type GitJob =
  | { kind: 'stage'; paths: string[] }
  | { kind: 'unstage'; paths: string[] }
  | { kind: 'commit'; request: GitCommitRequest }
  | { kind: 'sync'; op: GitSyncOp; head?: string };

/**
 * One Git write at a time for a Workspace (needs `capabilities.gitWrite`). Every answer carries the repository as it
 * is afterwards, so the status query is set from it (no second read); a refusal re-reads the status, because the
 * usual cause is that the Mac's repository moved. `variables` is the job in flight, for a busy indicator.
 */
export function useGitWrite(instance: string | null, workspaceId: string) {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const statusKey = ['v3', 'git', instance, workspaceId];
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: [...statusKey, 'diff'] });
  };
  return useMutation<GitWriteResult, Error, GitJob>({
    mutationFn: (job) => {
      if (!client || !instance) return Promise.reject(new Error('Not connected'));
      switch (job.kind) {
        case 'stage':
          return client.gitStage(instance, workspaceId, job.paths);
        case 'unstage':
          return client.gitUnstage(instance, workspaceId, job.paths);
        case 'commit':
          return client.gitCommit(instance, workspaceId, job.request);
        case 'sync':
          return client.gitSync(instance, workspaceId, job.op, job.head);
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(statusKey, result.status);
      settle();
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey, exact: true });
      settle();
    },
  });
}

/** One folder of a Workspace (needs `capabilities.files`); re-read on open and by pull-to-refresh, never polled. */
export function useFilesList(instance: string | null, workspaceId: string, dir: string) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'files', instance, workspaceId, dir],
    queryFn: () => client!.filesList(instance!, workspaceId, dir),
    enabled: client !== null && instance !== null,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export function useFileContent(instance: string | null, workspaceId: string, path: string) {
  const { client } = useHostV3();
  return useQuery({
    queryKey: ['v3', 'files', instance, workspaceId, 'content', path],
    queryFn: () => client!.fileContent(instance!, workspaceId, path),
    enabled: client !== null && instance !== null,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
}

/**
 * The Mac's agent quota (needs `capabilities.quota`), read through the Host's own TTL cache — the
 * phone opening this view is the same "read once" trigger as the desktop page. Pull-to-refresh
 * forces past the reuse window (the Host still honours its floor and a vendor rate limit); the
 * answer is never polled.
 */
/** Readiness of the Mac's Remote Desktop (permissions, approval, busy); never polled — the screen refetches when it is shown again. */
export function useRemoteDesktopInfo(enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'remote-desktop'],
    queryFn: () => client!.remoteDesktopInfo(),
    enabled: client !== null && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** The Mac's Automations list (needs `capabilities.automations`), read when the screen opens, on pull-to-refresh and when an `automation` frame arrives; never polled. */
export function useHostAutomations(enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'automations'],
    queryFn: () => client!.automations(),
    enabled: client !== null && enabled,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** One automation in full (needs `capabilities.automationsManage`); refetched on open, on pull and with every `automation` frame. */
export function useAutomationDetail(name: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'automations', 'detail', name],
    queryFn: () => client!.automationDetail(name),
    enabled: client !== null && enabled && name !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export type AutomationJob =
  | { kind: 'create'; name: string; fields: AutomationFields }
  | { kind: 'save'; name: string; fields: AutomationFields }
  | { kind: 'op'; name: string; op: AutomationOp }
  | { kind: 'scheduler' }
  | { kind: 'seen'; target: { runId: string } | { all: true } };

/**
 * Every management write. A write answers with the Mac's fresh list, which replaces the cached one at once; the open detail
 * is refetched. A refusal changes nothing on the phone and surfaces the plugin's own sentence through the mutation error.
 */
export function useAutomationWrite() {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  return useMutation<Automations, Error, AutomationJob>({
    mutationFn: (job) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      switch (job.kind) {
        case 'create':
          return client.createAutomation(job.name, job.fields);
        case 'save':
          return client.saveAutomation(job.name, job.fields);
        case 'op':
          return client.automationOp(job.name, job.op);
        case 'scheduler':
          return client.startAutomationScheduler();
        case 'seen':
          return client.markAutomationSeen(job.target);
      }
    },
    onSuccess: (list) => {
      queryClient.setQueryData(['v3', 'automations'], list);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'automations', 'detail'] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['v3', 'automations'] }); // the Mac's truth, whatever the phone believed
    },
  });
}

/** The Mac's Assistants overview (needs `capabilities.personalAgent`): read when a screen opens, on pull and on every `personal-agent.changed` frame; never polled. */
export function usePersonalAgentOverview(enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'overview'],
    queryFn: () => client!.personalAgentOverview(),
    enabled: client !== null && enabled,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** One Assistant's page (goals, tasks with runs, approvals, memory), isolated per Assistant by the Mac's core. */
export function useAssistantDetail(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'assistant', id],
    queryFn: () => client!.assistantDetail(id),
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** The same Coordinator report outbox the desktop shows. A change hint
 * triggers a fresh read; the phone never guesses if OMP wrote a reply.
 */
export function useAssistantCoordinatorReport(assistantId: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'report', assistantId],
    queryFn: () => client!.assistantCoordinatorReport(assistantId),
    enabled: client !== null && enabled && assistantId !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** Pending approvals across every Assistant — the Needs You inbox. */
export function useAssistantInbox(assistantId: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'inbox', assistantId],
    queryFn: () => client!.assistantInbox(assistantId),
    enabled: client !== null && enabled && assistantId !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export function useAssistantApprovals(enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'approvals'],
    queryFn: () => client!.assistantApprovals(),
    enabled: client !== null && enabled,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export type PersonalAgentJob =
  | { kind: 'create'; name: string; description?: string }
  | { kind: 'rename'; id: string; name: string; revision: number }
  | { kind: 'pause'; id: string; paused: boolean; revision: number }
  | { kind: 'draft'; assistantId: string; title: string; objective?: string; commitments?: AssistantCommitmentInput[] }
  | { kind: 'goal'; id: string; action: AssistantGoalAction; revision: number }
  | { kind: 'task'; id: string; action: AssistantTaskAction; revision: number }
  | { kind: 'coordinator'; id: string; agent: string }
  | { kind: 'decide'; id: string; actionHash: string; approve: boolean };

function jobKey(job: PersonalAgentJob): string {
  return JSON.stringify(job);
}

/**
 * Every Assistants write. Each carries a requestId — kept across a transport failure of the same job, so a retry replays the
 * first receipt instead of doing it twice — and the revision the screen showed. Any outcome refetches the Mac's truth: a
 * refusal (stale_revision above all) changes nothing on the phone, which then shows what the core says.
 */
export function usePersonalAgentWrite() {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const ids = useRef(createRequestIds(newRequestId)).current;
  return useMutation<unknown, Error, PersonalAgentJob>({
    mutationFn: (job) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      const requestId = ids.begin(jobKey(job));
      switch (job.kind) {
        case 'create':
          return client.createAssistant(requestId, job.name, job.description);
        case 'rename':
          return client.renameAssistant(requestId, job.id, job.name, job.revision);
        case 'pause':
          return client.setAssistantPaused(requestId, job.id, job.paused, job.revision);
        case 'draft':
          return client.draftGoal(requestId, { assistantId: job.assistantId, title: job.title, objective: job.objective, commitments: job.commitments });
        case 'goal':
          return client.goalAction(requestId, job.id, job.action, job.revision);
        case 'task':
          return client.taskAction(requestId, job.id, job.action, job.revision);
        case 'coordinator':
          return client.startCoordinator(requestId, job.id, job.agent);
        case 'decide':
          return client.decideApproval(requestId, job.id, job.actionHash, job.approve);
      }
    },
    onSettled: (_data, error) => {
      ids.settle(error);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent'] });
    },
  });
}

/** One Group's conversation. The whole tail is re-read every 2 s while the screen is up: delivery states change on older messages too. */
export function useGroupFeed(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'group', id],
    queryFn: () => client!.groupFeed(id),
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 2_000,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** The person's own words into a Group; the requestId survives a transport failure so a retry replays the first receipt. */
export function useGroupPost(groupId: string) {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const ids = useRef(createRequestIds(newRequestId)).current;
  return useMutation<unknown, Error, { body: string; mentions: string[]; replyTo?: string }>({
    mutationFn: (input) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      const requestId = ids.begin(JSON.stringify([groupId, input]));
      return client.postGroupMessage(groupId, { requestId, body: input.body, mentions: input.mentions.length > 0 ? input.mentions : undefined, replyTo: input.replyTo });
    },
    onSettled: (_data, error) => {
      ids.settle(error);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent', 'group', groupId] });
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent', 'overview'] });
    },
  });
}

export function useGroupCreate() {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const ids = useRef(createRequestIds(newRequestId)).current;
  return useMutation<{ id: string }, Error, { title: string; members: string[] }>({
    mutationFn: (input) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      return client.createGroup(ids.begin(JSON.stringify(input)), input.title, input.members);
    },
    onSettled: (_data, error) => {
      ids.settle(error);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent'] });
    },
  });
}

/** A Goal's plan + ledger. Read-only; `not_found` = the Goal has no plan yet (not an error worth showing). */
export function useGoalPlan(goalId: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'plan', goalId],
    queryFn: () => client!.goalPlan(goalId),
    enabled: client !== null && enabled && goalId !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 10_000,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** The Assistant's routines (scheduled work it drafted). */
export function useAssistantRoutines(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'routines', id],
    queryFn: () => client!.assistantRoutines(id),
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 10_000,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** Notification-only hint for an open Activity history screen. The
 * Activity page still replays by a persisted Host cursor on reconnect.
 */
export function useAssistantActivityHint(): number {
  const query = useQuery({
    queryKey: ['v3', 'assistant-activity-hint'],
    queryFn: () => 0,
    initialData: 0,
    staleTime: Infinity,
  });
  return query.data;
}

/** The Assistant's ledger: what the Mac's core says happened to its Goals, newest first. */
export function useAssistantFacts(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'facts', id],
    queryFn: () => client!.assistantFacts(id, 6),
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 10_000,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** How one Assistant works: instructions, Agent profile (with what really runs) and MCP, read together; all of it is the Mac core's. */
export function useAssistantPersona(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'persona', id],
    queryFn: async () => {
      const [instructions, runtime, mcp] = await Promise.all([client!.assistantInstructions(id), client!.assistantRuntime(id), client!.assistantMcp(id)]);
      return { instructions, runtime, mcp };
    },
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 8_000,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export type PersonaJob =
  | { kind: 'instructions'; body: string; revision: number }
  | { kind: 'restore'; revision: number; expected: number }
  | { kind: 'runtime'; agent: string; model: string; effort: string; revision: number }
  | { kind: 'grant'; serverId: string; granted: boolean }
  | { kind: 'verify' };

/** Every persona write: one requestId per job (kept over a transport failure), then the Mac's truth is re-read whatever happened. */
export function usePersonaWrite(id: string) {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const ids = useRef(createRequestIds(newRequestId)).current;
  return useMutation<unknown, Error, PersonaJob>({
    mutationFn: (job) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      if (job.kind === 'verify') return client.verifyMcp(id);
      const requestId = ids.begin(JSON.stringify([id, job]));
      switch (job.kind) {
        case 'instructions':
          return client.saveInstructions(requestId, id, job.body, job.revision);
        case 'restore':
          return client.restoreInstructions(requestId, id, job.revision, job.expected);
        case 'runtime':
          return client.saveRuntime(requestId, id, { agent: job.agent, model: job.model, effort: job.effort }, job.revision);
        case 'grant':
          return client.grantMcp(requestId, id, job.serverId, job.granted);
      }
    },
    onSettled: (_data, error) => {
      ids.settle(error);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent'] });
    },
  });
}

/** One Assistant's live memory (approved + candidates) with the Mac's tidy-up findings. */
export function useAssistantMemory(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'memory', id],
    queryFn: () => client!.assistantMemory(id),
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    refetchInterval: 8_000,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** The versions of one memory item (newest first); read only while its history is open. */
export function useMemoryHistory(memoryId: string, enabled: boolean, revision: number) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'memory-history', memoryId, revision],
    queryFn: () => client!.memoryHistory(memoryId),
    enabled: client !== null && enabled,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export type MemoryJob =
  | { kind: 'add'; content: string }
  | { kind: 'edit'; id: string; revision: number; content: string }
  | { kind: 'approve' | 'forget'; id: string; revision: number };

/** Every memory write: one requestId per job (kept over a transport failure), then the Mac's truth is re-read whatever happened. */
export function useMemoryWrite(assistantId: string) {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const ids = useRef(createRequestIds(newRequestId)).current;
  return useMutation<unknown, Error, MemoryJob>({
    mutationFn: (job) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      const requestId = ids.begin(JSON.stringify([assistantId, job]));
      if (job.kind === 'add') return client.addMemory(requestId, assistantId, job.content);
      if (job.kind === 'edit') return client.editMemory(requestId, job.id, 'edit', job.revision, job.content);
      return client.editMemory(requestId, job.id, job.kind, job.revision);
    },
    onSettled: (_data, error) => {
      ids.settle(error);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent'] });
    },
  });
}

/** One Assistant's proactivity rules (defaults, revision 0, when never set). */
export function useAssistantProactivity(id: string, enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'personal-agent', 'proactivity', id],
    queryFn: () => client!.assistantProactivity(id),
    enabled: client !== null && enabled && id !== '',
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

export function useProactivityWrite(id: string) {
  const { client } = useHostV3();
  const queryClient = useQueryClient();
  const ids = useRef(createRequestIds(newRequestId)).current;
  return useMutation<unknown, Error, { input: ProactivityInput; revision: number }>({
    mutationFn: (job) => {
      if (!client) return Promise.reject(new Error('Not connected'));
      return client.saveProactivity(ids.begin(JSON.stringify([id, job])), id, job.input, job.revision);
    },
    onSettled: (_data, error) => {
      ids.settle(error);
      void queryClient.invalidateQueries({ queryKey: ['v3', 'personal-agent'] });
    },
  });
}

export function useHostQuota(enabled: boolean) {
  const { client } = useHostV3();
  const force = useRef(false);
  const query = useQuery({
    queryKey: ['v3', 'quota'],
    queryFn: () => {
      const wantsForce = force.current;
      force.current = false;
      return client!.quota(wantsForce);
    },
    enabled: client !== null && enabled,
    staleTime: 15_000,
    gcTime: 60_000,
    retry: false,
  });
  useForgetOnUnauthorized(query.error);
  return {
    ...query,
    /** Pull-to-refresh: the next fetch carries `?refresh=1`. */
    refresh() {
      force.current = true;
      void query.refetch();
    },
  };
}

export type ChatPhase = 'connecting' | 'live' | 'reconnecting' | 'none' | 'gone';

/**
 * Follows one pane's conversation over the chat stream. Every frame is the whole state, so a
 * reconnect needs no replay. 4409 (no readable session yet) and 4404 (pane gone) end the follow;
 * any other close reconnects with a capped backoff.
 */
export function useChatStream(instance: string | null, paneId: string | null) {
  const { client } = useHostV3();
  const [phase, setPhase] = useState<ChatPhase>('connecting');
  const [frame, setFrame] = useState<ChatFrame | null>(null);
  const attempt = useRef(0);
  const olderRef = useRef<() => void>(() => undefined);
  const older = useCallback(() => olderRef.current(), []);

  // Only another conversation starts from nothing.
  useEffect(() => {
    setPhase('connecting');
    setFrame(null);
  }, [instance, paneId]);

  useEffect(() => {
    if (!client || !instance || !paneId) return undefined;
    let stopped = false;
    // Reconnects can overlap a delayed close/probe from the previous socket.
    // Only the newest generation may touch the visible Chat or schedule work.
    let generation = 0;
    let socket: { close(): void; older(): void } | null = null;
    olderRef.current = () => socket?.older();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (callback: () => void, delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; callback(); }, delay);
    };
    // A new client (the route changed under the same conversation) keeps the frame and a live phase on screen:
    // the next frame replaces it whole, so the page never goes back to loading.
    setPhase((current) => (current === 'live' ? current : 'connecting'));

    // A just-launched agent has no session file for a few seconds: show "none" but keep asking, so the
    // conversation appears on its own instead of staying on the empty state until the user backs out.
    const waitForConversation = () => {
      // A new agent may not have written its JSONL yet. Do not keep showing
      // the previous session's transcript while waiting for the next one.
      setFrame(null);
      setPhase('none');
      schedule(connect, NO_CONVERSATION_RECHECK_MS);
    };
    const retry = () => {
      setPhase('reconnecting');
      attempt.current += 1;
      const delay = Math.min(EVENTS_BACKOFF_BASE_MS * 2 ** (attempt.current - 1), EVENTS_BACKOFF_CAP_MS);
      schedule(connect, delay);
    };
    // The Host refuses the upgrade itself (HTTP 409/404) when there is no conversation to follow, and a
    // WebSocket client cannot read that status — so a socket that never delivered a frame asks over GET.
    const probe = (ticket: number) => {
      client.chat(instance, paneId).then(
        () => { if (!stopped && ticket === generation) retry(); },
        (error: unknown) => {
          if (stopped || ticket !== generation) return;
          if (error instanceof HostV3Error && error.kind === 'http' && error.code === 'no_conversation') return waitForConversation();
          if (error instanceof HostV3Error && error.kind === 'http' && error.status === 404) {
            setFrame(null);
            setPhase('gone');
            return;
          }
          retry();
        },
      );
    };
    const connect = () => {
      const ticket = ++generation;
      socket?.close();
      let gotFrame = false;
      socket = client.openChat(instance, paneId, {
        onFrame(next) {
          if (stopped || ticket !== generation) return;
          gotFrame = true;
          attempt.current = 0;
          setPhase('live');
          setFrame(next);
        },
        onClose(event) {
          if (stopped || ticket !== generation) return;
          if (event.noConversation) return waitForConversation();
          if (event.gone) { setFrame(null); setPhase('gone'); return; }
          if (gotFrame) return retry();
          probe(ticket);
        },
      });
    };
    connect();
    return () => {
      stopped = true;
      generation += 1;
      olderRef.current = () => undefined;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [client, instance, paneId]);

  return { phase, frame, older };
}

/**
 * The Mac's session catalog (needs `capabilities.sessions`), searched on the Mac. A short stale time
 * keeps the Running badge honest when the screen is reopened; the tree's own events already move
 * the Home list, this list is read on demand, never polled.
 */
export function useHostSessions(enabled: boolean, search: string) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'sessions', search.trim()],
    queryFn: () => client!.sessions(search),
    enabled: client !== null && enabled,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: false,
    placeholderData: (previous) => previous,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}

/** The Mac's Sessions Trash (needs `capabilities.sessionTrash`), read when its view opens; moves and put-backs invalidate it. */
export function useHostSessionTrash(enabled: boolean) {
  const { client } = useHostV3();
  const query = useQuery({
    queryKey: ['v3', 'sessions-trash'],
    queryFn: () => client!.sessionTrash(),
    enabled: client !== null && enabled,
    staleTime: 5_000,
    gcTime: 60_000,
    retry: false,
    placeholderData: (previous) => previous,
  });
  useForgetOnUnauthorized(query.error);
  return query;
}
