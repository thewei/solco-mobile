// [INPUT]: v3 tree workspaces, the Host's launchKinds, and what the user picked on Home.
// [OUTPUT]: LaunchTarget, knownFolders, defaultTarget, validFolder, buildLaunchBody, createLaunchAttempts
//           (requestId lifecycle), launchRoute (where a fresh pane opens), launchFailureMessage.
// [POS]: Pure model behind Home's new-session composer; no IO, no state. The Host owns every refusal —
//        this only keeps the phone from sending what it would refuse and words the refusals.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { LAUNCH_TERMINAL, type LaunchRequest, type LaunchResponse, type TreeWorkspace } from '@/contracts/host-v3';
import { HostV3Error, type DraftFolderQuery } from '@/lib/host-client-v3';
import type { PaneRoute } from '@/features/host/pane-model';

/** An existing Workspace (a new Tab in it) or an absolute folder on the Mac (Workspace found or created). */
export type LaunchTarget =
  | { type: 'workspace'; id: string; label: string; cwd: string }
  | { type: 'path'; path: string };

export function targetLabel(target: LaunchTarget): string {
  return target.type === 'workspace' ? target.label : folderName(target.path);
}

export function targetFolder(target: LaunchTarget): string {
  return target.type === 'workspace' ? target.cwd : target.path;
}

export function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/** Workspaces the Host can open a Tab in (those with a directory), in Herdr's order. */
export function workspaceTargets(workspaces: readonly TreeWorkspace[]): LaunchTarget[] {
  return workspaces.flatMap((w) => (w.cwd ? [{ type: 'workspace' as const, id: w.id, label: w.label || folderName(w.cwd), cwd: w.cwd }] : []));
}

/** Directories seen on the Mac (pane cwds) that are not already a Workspace's own folder: path suggestions. */
export function knownFolders(workspaces: readonly TreeWorkspace[]): string[] {
  const own = new Set(workspaces.flatMap((w) => (w.cwd ? [w.cwd] : [])));
  const seen = new Set<string>();
  for (const w of workspaces) for (const tab of w.tabs) for (const pane of tab.panes) {
    if (pane.cwd && !own.has(pane.cwd)) seen.add(pane.cwd);
  }
  return [...seen];
}

export function defaultTarget(workspaces: readonly TreeWorkspace[]): LaunchTarget | null {
  return workspaceTargets(workspaces)[0] ?? null;
}

/** The Host takes absolute, clean directories only (no `..`, no control characters). */
export function validFolder(path: string): boolean {
  const p = path.trim();
  return p.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(p) && !p.split('/').includes('..');
}

export interface LaunchDraft {
  target: LaunchTarget;
  /** `terminal` or one of the Host's agent kinds. */
  kind: string;
  prompt: string;
}

export type LaunchBody = Omit<LaunchRequest, 'requestId'>;

/**
 * An empty prompt starts the agent only (Terminal: just the shell). A Terminal's prompt is its first command and
 * must be one line, so line breaks collapse to spaces. The requestId comes from createLaunchAttempts.
 */
export function buildLaunchBody(draft: LaunchDraft): LaunchBody {
  const prompt = (draft.kind === LAUNCH_TERMINAL ? draft.prompt.replace(/[\u0000-\u001f\u007f]+/g, ' ') : draft.prompt).trim();
  return {
    ...(draft.target.type === 'workspace' ? { workspaceId: draft.target.id } : { path: draft.target.path.trim() }),
    kind: draft.kind,
    ...(prompt ? { prompt } : {}),
  };
}

/** What the Host's pane-less composer endpoints (`/launch/catalog|files`) take to name the folder. */
export function draftFolder(target: LaunchTarget): DraftFolderQuery {
  return target.type === 'workspace' ? { workspaceId: target.id } : { path: target.path.trim() };
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newRequestId(random: () => number = Math.random): string {
  let id = 'req_';
  for (let i = 0; i < 20; i += 1) id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
  return id;
}

/**
 * requestId lifecycle. The Host remembers every id it has answered (a repeat of the same request replays,
 * never relaunches), so: reuse the id only when the same request failed with no answer from the Host
 * (transport) — the Host may have finished it; any other outcome starts afresh. A screen that received the
 * first id before the launch (the pending hand-off) seeds it with the body it was handed, so its first
 * `begin` replays that exact id.
 */
export function createLaunchAttempts(generate: () => string = newRequestId, seed?: { id: string; signature: string }) {
  let pending: { id: string; signature: string } | null = seed ?? null;
  return {
    begin(request: LaunchBody): string {
      const signature = JSON.stringify(request);
      if (!pending || pending.signature !== signature) pending = { id: generate(), signature };
      return pending.id;
    },
    settle(error: unknown | null) {
      if (!(error instanceof HostV3Error) || error.kind !== 'transport') pending = null;
    },
  };
}

/**
 * A fresh agent pane opens its Chat when the Host serves it; anything else (and Terminal) its terminal.
 * When the agent is blocked on its user (promptPending) the prompt never went out, so it travels along as
 * the Chat's draft — the user answers the agent's question, then sends it.
 */
export function launchRoute(reply: LaunchResponse, instance: string, title: string, chatServed: boolean, prompt = ''): PaneRoute {
  const draft = reply.promptPending && prompt.trim() ? { draft: prompt.trim() } : {};
  return reply.agent && chatServed
    ? { pathname: '/chat/[paneId]', params: { paneId: reply.paneId, terminalId: reply.terminalId, instance, title, ...draft } }
    : { pathname: '/terminal/[terminalId]', params: { terminalId: reply.terminalId, instance, title } };
}

export function launchFailureMessage(error: unknown): string {
  if (!(error instanceof HostV3Error)) return 'Something went wrong. Try again.';
  switch (error.code) {
    case 'path_unavailable':
      return 'That folder is not available.';
    case 'unknown_workspace':
      return 'That workspace no longer exists. Pick another.';
    case 'workspace_no_directory':
      return 'That workspace has no folder. Pick a folder instead.';
    case 'instance_remote':
      return 'A device can only start a terminal in one of its workspaces.';
    case 'launch_conflict':
      return 'That request was already used. Send again.';
    case 'launch_uncertain':
      return 'It may have started. Check the session list before trying again.';
    case 'launch_unavailable':
      return 'Starting sessions is not enabled on the computer.';
    case 'launch_failed':
      return error.message && !error.message.startsWith('launch: the Host answered') ? `Could not start it: ${error.message}` : 'Could not start it.';
    default:
  }
  if (error.kind === 'transport') return 'Could not reach the computer. Sending again is safe.';
  return error.message;
}
