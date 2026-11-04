// [PROTOCOL]: 契约测试——Go Host 的 /api/v3 黄金文件必须通过 Zod 解析，且解析后与原文逐字等价。
// Position: 双端契约钉死的移动端半边；fixtures 由 `pnpm sync:fixtures` 从
// solco/internal/remotehost/testdata/api-v3 原样拷贝（勿手改）。
// Invariant: 失败 = 线格式漂移，两端必须同批修复；Zod 默认丢弃未知字段，所以用
// `parse(x) toEqual x` 抓「Host 新增了字段而客户端不知道」。
import { describe, expect, it } from 'vitest';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  V3_CLOSE_TERMINAL_GONE,
  V3_LIMITS,
  bootstrapV3Schema,
  CHAT_SEND_REFUSALS,
  FILES_REFUSALS,
  fileContentSchema,
  filesListSchema,
  GIT_REFUSALS,
  DEVICE_REFUSALS,
  DEVICE_STATUSES,
  GIT_WRITE_REFUSALS,
  QUOTA_REFUSALS,
  SESSIONS_REFUSALS,
  SESSION_TRASH_REFUSALS,
  LAUNCH_REFUSALS,
  LAUNCH_TERMINAL,
  gitCommitRequestSchema,
  gitDiffSchema,
  gitStatusSchema,
  deviceConnectResponseSchema,
  gitWriteResultSchema,
  quotaSchema,
  automationsSchema,
  automationDetailSchema,
  automationWriteSchema,
  AUTOMATION_REFUSALS,
  assistantOverviewSchema,
  groupFeedResponseSchema,
  instructionsResponseSchema,
  goalPlanResponseSchema,
  factsResponseSchema,
  assistantActivityPageSchema,
  assistantActivityAckSchema,
  factKinds,
  routinesResponseSchema,
  memoryReviewResponseSchema,
  memoryHistoryResponseSchema,
  memoryItemResponseSchema,
  proactivityResponseSchema,
  mcpResponseSchema,
  runtimeResponseSchema,
  groupMessageRequestSchema,
  groupPostResponseSchema,
  groupsListSchema,
  assistantsListSchema,
  assistantDetailSchema,
  assistantGoalsSchema,
  assistantTaskWithRunsSchema,
  assistantApprovalsSchema,
  assistantCoordinatorReceiptSchema,
  assistantInboxSchema,
  assistantApprovalReceiptSchema,
  assistantDecisionRequestSchema,
  PERSONAL_AGENT_REFUSALS,
  sessionsSchema,
  trashAnswerSchema,
  trashListSchema,
  launchRequestSchema,
  launchResponseSchema,
  continueResponseSchema,
  voiceRequestSchema,
  rdAnswerSchema,
  rdInfoSchema,
  rdMacMessageSchema,
  rdOfferSchema,
  rdPhoneMessageSchema,
  RD_PROTOCOL,
  RD_REFUSALS,
  voiceResponseSchema,
  VOICE_REFUSALS,
  SESSION_CONTINUE_REFUSALS,
  CHAT_ANSWER_REFUSALS,
  chatAckSchema,
  attachReplySchema,
  subagentViewSchema,
  attachRequestSchema,
  chatCatalogSchema,
  chatAnswerRequestSchema,
  chatFilesSchema,
  chatFrameSchema,
  chatSendRequestSchema,
  chatResponseSchema,
  errorBodyV3Schema,
  eventMessageSchema,
  pairResponseSchema,
  peekSchema,
  terminalClientMessageSchema,
  terminalServerMessageSchema,
  treeV3Schema,
} from '@/contracts/host-v3';

const dir = join(import.meta.dirname, '__fixtures__', 'v3');

async function load(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(dir, name), 'utf8'));
}

/** Parse and prove nothing was silently dropped. */
function exact<T>(schema: { parse(x: unknown): T }, value: unknown): T {
  const parsed = schema.parse(value);
  expect(parsed).toEqual(value);
  return parsed;
}

describe('v3 golden files', () => {
  it('pair answer', async () => {
    const pair = exact(pairResponseSchema, await load('pair.json'));
    expect(pair.deviceId.startsWith('dev_')).toBe(true);
  });

  it('bootstrap says what the Host can do', async () => {
    const boot = exact(bootstrapV3Schema, await load('bootstrap.json'));
    expect(boot.capabilities).toEqual({ terminal: true, chat: true });
    expect(boot.instances.map((i) => i.id)).toEqual(['default']);
  });

  it('bootstrap net names the address the Mac serves right now', async () => {
    const boot = exact(bootstrapV3Schema, await load('bootstrap-net.json'));
    expect(boot.net).toEqual({ addresses: [{ host: '192.168.1.10', port: 7788 }] });
  });

  it('tree keeps Herdr order and carries no focus', async () => {
    const tree = exact(treeV3Schema, await load('tree.json'));
    const panes = tree.workspaces[0]?.tabs[0]?.panes ?? [];
    expect(panes.map((p) => p.paneId)).toEqual(['w1:p1', 'w1:p2']);
    expect(panes[0]?.agent).toMatchObject({ provider: 'claude', status: 'working', title: 'Fix the parser', lastActiveMs: 1785546001000 });
    expect(panes[0]?.agent?.background?.map((b) => [b.kind, b.id, b.state])).toEqual([
      ['subagent', 'agent-a1', 'working'],
      ['service', 'svc:w1:p1', 'running'],
    ]);
    expect(panes[1]?.agent).toBeUndefined();
    expect(JSON.stringify(tree)).not.toMatch(/focus/i);
  });

  it('chat read answers with the shared projection', async () => {
    const chat = exact(chatResponseSchema, await load('chat.json'));
    expect(chat.paneId).toBe('w1:p1');
    expect(chat.turns.map((t) => t.user)).toEqual([true, false]);
    expect(chat.turns[0]?.text).toBe('Fix the parser');
  });

  it('chat stream frame carries the whole state', async () => {
    const frame = exact(chatFrameSchema, await load('chat-frame.json'));
    expect(frame.state.turns).toHaveLength(2);
  });

  it('chat send: request, ack and a named refusal', async () => {
    expect(exact(chatSendRequestSchema, await load('chat-client-send.json'))).toEqual({ text: 'run the tests', interrupt: true });
    expect(exact(chatAckSchema, await load('chat-send-ok.json'))).toEqual({ ok: true });
    const busy = exact(errorBodyV3Schema, await load('error-busy.json'));
    expect(CHAT_SEND_REFUSALS).toContain(busy.error.code);
    expect(chatSendRequestSchema.safeParse({ text: '   ' }).success).toBe(false);
  });

  it('a blocked agent carries a card; the answer names it and a stale card is a named refusal', async () => {
    const frame = exact(chatFrameSchema, await load('chat-frame-interaction.json'));
    expect(frame.agentStatus).toBe('blocked');
    expect(frame.interaction).toMatchObject({ kind: 'permission', prompt: 'Do you want to proceed?', options: ['Yes', 'No'] });
    const answer = exact(chatAnswerRequestSchema, await load('chat-client-answer.json'));
    expect(answer).toEqual({ interactionId: frame.interaction?.id, option: 'No' });
    const gone = exact(errorBodyV3Schema, await load('error-interaction-gone.json'));
    expect(CHAT_ANSWER_REFUSALS).toContain(gone.error.code);
  });

  it('launch: a Host with a launcher advertises its kinds, terminal first', async () => {
    const boot = exact(bootstrapV3Schema, await load('bootstrap-launch.json'));
    expect(boot.capabilities.launch).toBe(true);
    expect(boot.launchKinds?.[0]?.id).toBe(LAUNCH_TERMINAL);
    expect(boot.launchKinds?.map((k) => k.id)).toEqual(['terminal', 'claude-code']);
  });

  it('launch: request, answer and a named refusal', async () => {
    const request = exact(launchRequestSchema, await load('launch-client-request.json'));
    expect(request).toMatchObject({ workspaceId: 'w1', kind: 'claude-code', prompt: 'fix the failing test' });
    expect(exact(launchResponseSchema, await load('launch-ok.json')).paneId).toBe('w1:p2');
    expect(exact(launchResponseSchema, await load('launch-prompt-pending.json')).promptPending).toBe(true);
    expect(LAUNCH_REFUSALS).toContain(exact(errorBodyV3Schema, await load('error-launch-bad-request.json')).error.code);
  });

  it('chat catalog: commands, skills, models and the typed model verb', async () => {
    const catalog = exact(chatCatalogSchema, await load('chat-catalog.json'));
    expect(catalog.commands[0]).toMatchObject({ name: '/compact', kind: 'text' });
    expect(catalog.skills[0]).toMatchObject({ name: '/review', kind: 'skill' });
    expect(catalog).toMatchObject({ models: [{ id: 'anthropic/sonnet' }], modelVerb: '/model ', defaultModel: 'sonnet' });
  });

  it('chat files: the `@` completion names', async () => {
    expect(exact(chatFilesSchema, await load('chat-files.json')).files).toEqual(['README.md', 'src/']);
  });

  it('sub-agents: the card in the chat state, the drawer view and the refusal', async () => {
    const chat = exact(chatResponseSchema, await load('chat-with-subagent.json'));
    expect(chat.subagents?.[0]).toMatchObject({ id: 'abc123', type: 'Explore', status: 'done' });
    const view = exact(subagentViewSchema, await load('chat-subagent.json'));
    expect(view.subagent.id).toBe('abc123');
    expect(view.turns.map((t) => t.user)).toEqual([true, false]);
    expect(exact(errorBodyV3Schema, await load('error-unknown-subagent.json')).error.code).toBe('unknown_subagent');
  });

  it('attachments: bootstrap capability, request, answer and a refusal', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-attach.json')).capabilities.attachments).toBe(true);
    const request = exact(attachRequestSchema, await load('attach-client-request.json'));
    expect(request).toMatchObject({ mime: 'image/png', name: 'shot.png' });
    expect(Buffer.from(request.dataBase64, 'base64').toString()).toBe('png');
    expect(exact(attachReplySchema, await load('attach-ok.json')).path).toMatch(/ChatAttachments\/.*\.png$/);
    expect(exact(errorBodyV3Schema, await load('error-attach-bad-request.json')).error.code).toBe('bad_request');
  });

  it('queue: capability, the flagged send, the chip on the chat state and the refusals', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-queue.json')).capabilities.queue).toBe(true);
    expect(exact(chatSendRequestSchema, await load('queue-client-request.json'))).toEqual({ text: 'then run the tests', queue: true });
    expect(exact(chatResponseSchema, await load('chat-queued.json')).queued).toEqual({
      items: [{ id: 'req-q1', text: 'then run the tests', state: 'queued' }],
    });
    expect(exact(errorBodyV3Schema, await load('error-queue-blocked.json')).error.code).toBe('queue_blocked');
    expect(exact(errorBodyV3Schema, await load('error-queue-none.json')).error.code).toBe('no_queued');
  });

  it('git: bootstrap capability, status, diff and a named refusal', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-git.json')).capabilities.git).toBe(true);
    const status = exact(gitStatusSchema, await load('git-status.json'));
    expect(status).toMatchObject({ repo: true, branch: 'main', upstream: { ahead: 1 } });
    expect(status.files[0]).toMatchObject({ path: 'a.go', status: 'modified', unstaged: true, additions: 2, deletions: 1 });
    const diff = exact(gitDiffSchema, await load('git-diff.json'));
    expect(diff.hunks[0]?.lines?.map((l) => l.k)).toEqual([' ', '-', '+']);
    expect(GIT_REFUSALS).toContain(exact(errorBodyV3Schema, await load('error-git-unknown-file.json')).error.code);
  });

  it('devices: saved machines ride in bootstrap.instances with a status; connect answers the instance', async () => {
    const boot = exact(bootstrapV3Schema, await load('bootstrap-devices.json'));
    expect(boot.capabilities.devices).toBe(true);
    expect(boot.instances).toEqual([
      { id: 'default' },
      { id: 'machine/abc', kind: 'device', label: 'omarchy', status: 'connected' },
      { id: 'machine/def', kind: 'device', label: 'build box', status: 'needs_signin' },
    ]);
    expect(boot.instances.every((item) => item.kind !== 'device' || DEVICE_STATUSES.includes(item.status as (typeof DEVICE_STATUSES)[number]))).toBe(true);
    expect(exact(deviceConnectResponseSchema, await load('device-connect.json'))).toEqual({ instance: 'machine/def' });
    expect(DEVICE_REFUSALS).toContain(exact(errorBodyV3Schema, await load('error-device-needs-signin.json')).error.code);
  });

  it('git writes: capability, request bodies, fresh status answers and the named refusals', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-git-write.json')).capabilities).toMatchObject({ git: true, gitWrite: true });
    expect(exact(gitCommitRequestSchema, await load('git-commit-client-request.json'))).toMatchObject({ paths: ['a.go'], head: 'abc1234' });
    const staged = exact(gitWriteResultSchema, await load('git-stage-ok.json'));
    expect(staged.status.files[0]).toMatchObject({ path: 'a.go' });
    expect(staged.hash).toBeUndefined();
    expect(exact(gitWriteResultSchema, await load('git-commit-ok.json')).hash).toBe('def5678');
    expect(exact(gitWriteResultSchema, await load('git-push-ok.json')).status.upstream).toMatchObject({ name: 'origin/main' });
    expect(GIT_WRITE_REFUSALS).toContain(exact(errorBodyV3Schema, await load('error-git-rejected.json')).error.code);
  });

  it('files: bootstrap capability, one folder level, text and binary previews, the path refusal', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-files.json')).capabilities.files).toBe(true);
    const root = exact(filesListSchema, await load('files.json'));
    expect(root.entries.map((e) => [e.kind, e.path])).toEqual([['dir', 'assets'], ['dir', 'src'], ['file', 'README.md']]);
    expect(exact(filesListSchema, await load('files-dir.json')).entries[0]).toMatchObject({ path: 'src/main.go', kind: 'file' });
    expect(exact(fileContentSchema, await load('file-content.json'))).toMatchObject({ flavor: 'markdown', content: '# Solco\n' });
    const binary = exact(fileContentSchema, await load('file-content-binary.json'));
    expect(binary.flavor).toBe('binary');
    expect(binary.content).toBeUndefined();
    expect(FILES_REFUSALS).toContain(exact(errorBodyV3Schema, await load('error-files-bad-request.json')).error.code);
  });

  it('quota: bootstrap capability, every provider with its standing, the older-Host refusal', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-quota.json')).capabilities.quota).toBe(true);
    const quota = exact(quotaSchema, await load('quota.json'));
    const codex = quota.providers.find((p) => p.id === 'codex');
    expect(codex).toMatchObject({ state: 'live', plan: 'Plus' });
    expect(codex?.windows[0]).toMatchObject({ name: '5-hour', usedPct: 0, spanMs: 18_000_000, resetsAtMs: 1785549600000 });
    expect(quota.providers.find((p) => p.id === 'claude')).toMatchObject({ state: 'rate_limited', retryAtMs: 1785546900000 });
    expect(quota.providers.find((p) => p.id === 'cursor')).toMatchObject({ state: 'disabled', windows: [] });
    expect(QUOTA_REFUSALS).toContain(exact(errorBodyV3Schema, await load('error-quota-unavailable.json')).error.code);
  });

  it('sessions: bootstrap capability, running link on a row, search answer, the refusals', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-sessions.json')).capabilities.sessions).toBe(true);
    const sessions = exact(sessionsSchema, await load('sessions.json'));
    expect(sessions.sessions[0]).toMatchObject({ agent: 'claude-code', running: { instance: 'default', paneId: 'w1:p1', state: 'attention' } });
    expect(sessions.sessions[1]?.running).toBeUndefined();
    expect(exact(sessionsSchema, await load('sessions-search.json')).sessions.map((r) => r.title)).toEqual(['Fix the failing tests']);
    for (const name of ['error-sessions-unavailable.json', 'error-sessions-bad-request.json']) {
      expect(SESSIONS_REFUSALS).toContain(exact(errorBodyV3Schema, await load(name)).error.code);
    }
  });

  it('sessions continue: capability, the pane it answers with, and the named refusals', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-sessions-continue.json')).capabilities.sessionContinue).toBe(true);
    expect(exact(bootstrapV3Schema, await load('bootstrap-sessions.json')).capabilities.sessionContinue).toBeUndefined();
    expect(exact(continueResponseSchema, await load('session-continue.json'))).toMatchObject({ paneId: 'w1:p2', alreadyLive: false });
    for (const name of ['error-session-needs-project.json', 'error-session-continue-unavailable.json']) {
      expect(SESSION_CONTINUE_REFUSALS).toContain(exact(errorBodyV3Schema, await load(name)).error.code);
    }
  });

  it('sessions trash: capability, the entries, both answers and the named refusals', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-sessions-trash.json')).capabilities.sessionTrash).toBe(true);
    expect(exact(bootstrapV3Schema, await load('bootstrap-sessions.json')).capabilities.sessionTrash).toBeUndefined();
    const entry = exact(trashAnswerSchema, await load('session-trash.json')).entry;
    expect(exact(trashListSchema, await load('sessions-trash.json')).entries[0]).toMatchObject({ id: entry, agent: 'codex', title: 'Refactor the tab bar' });
    expect(exact(trashAnswerSchema, await load('session-trash-restore.json')).entry).toBe(entry);
    for (const name of ['error-session-in-use.json', 'error-session-exists.json']) {
      expect(SESSION_TRASH_REFUSALS).toContain(exact(errorBodyV3Schema, await load(name)).error.code);
    }
  });

  it('voice: capability, the clip request, the text answer and the named refusals', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-voice.json')).capabilities.voice).toBe(true);
    expect(exact(bootstrapV3Schema, await load('bootstrap-sessions.json')).capabilities.voice).toBeUndefined();
    expect(exact(voiceRequestSchema, await load('voice-client-request.json')).mime).toBe('audio/webm');
    expect(exact(voiceResponseSchema, await load('voice-transcribe.json')).text).toBe('fix the failing test');
    for (const name of ['error-voice-bad-request.json', 'error-voice-transcribe-failed.json', 'error-voice-unavailable.json']) {
      expect(VOICE_REFUSALS).toContain(exact(errorBodyV3Schema, await load(name)).error.code);
    }
  });

  it('remote desktop: capability, readiness, the offer/answer and every named refusal', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-remote-desktop.json')).capabilities.remoteDesktop).toBe(true);
    expect(exact(bootstrapV3Schema, await load('bootstrap-voice.json')).capabilities.remoteDesktop).toBeUndefined();
    expect(exact(rdInfoSchema, await load('remote-desktop-info.json'))).toMatchObject({ protocol: RD_PROTOCOL, state: 'ready', requireApproval: true });
    expect(exact(rdOfferSchema, await load('remote-desktop-offer.json'))).toMatchObject({ protocol: RD_PROTOCOL, mode: 'full', tier: 'standard' });
    const answer = exact(rdAnswerSchema, await load('remote-desktop-answer.json'));
    expect(answer.state).toMatchObject({ mode: 'full', width: 1728, height: 1080, fps: 30 });
    expect(answer.state.displays[0]).toMatchObject({ isMain: true, scale: 2 });
    for (const name of [
      'error-remote-desktop-disabled.json',
      'error-remote-desktop-busy.json',
      'error-remote-desktop-denied.json',
      'error-remote-desktop-approval-timeout.json',
      'error-remote-desktop-permission-required.json',
      'error-remote-desktop-bad-offer.json',
      'error-remote-desktop-protocol-unsupported.json',
      'error-remote-desktop-unavailable.json',
      'error-remote-desktop-helper-failed.json',
    ]) {
      expect(RD_REFUSALS).toContain(exact(errorBodyV3Schema, await load(name)).error.code);
    }
  });

  it('remote desktop control channel: the Mac\'s messages parse and the phone\'s are what the Mac decodes', async () => {
    for (const name of ['session-state', 'session-state-locked', 'clipboard-text', 'error', 'error-message', 'error-unlock-failed', 'pong', 'stats']) {
      exact(rdMacMessageSchema, await load(`remote-desktop-ctl-${name}.json`));
    }
    for (const name of [
      'pointer-move', 'pointer-button', 'pointer-scroll', 'key', 'text-insert', 'clipboard-set', 'clipboard-get',
      'display-select', 'quality-set', 'cursor-set', 'privacy-set', 'unlock-request', 'keyframe', 'ping', 'session-end', 'release-all', 'stats-request',
    ]) {
      exact(rdPhoneMessageSchema, await load(`remote-desktop-ctl-${name}.json`));
    }
  });

  it('launch requests the Host would refuse never leave the phone', () => {
    const base = { requestId: 'req_0123456789', kind: 'codex' };
    expect(launchRequestSchema.safeParse({ ...base, workspaceId: 'w1' }).success).toBe(true);
    expect(launchRequestSchema.safeParse({ ...base, path: '/Users/me/p', prompt: '' }).success).toBe(true);
    expect(launchRequestSchema.safeParse(base).success).toBe(false); // neither target
    expect(launchRequestSchema.safeParse({ ...base, workspaceId: 'w1', path: '/x' }).success).toBe(false); // both
    expect(launchRequestSchema.safeParse({ ...base, workspaceId: 'w1', requestId: 'short' }).success).toBe(false);
    expect(launchRequestSchema.safeParse({ ...base, workspaceId: 'w1', kind: 'terminal', prompt: 'ls -la' }).success).toBe(true); // first command
    expect(launchRequestSchema.safeParse({ ...base, workspaceId: 'w1', kind: 'terminal', prompt: 'ls\nrm x' }).success).toBe(false); // one line only
    expect(launchRequestSchema.safeParse({ ...base, workspaceId: 'w1', prompt: 'x'.repeat(V3_LIMITS.maxLaunchPromptBytes + 1) }).success).toBe(false);
  });

  it('no conversation is a named refusal', async () => {
    expect(exact(errorBodyV3Schema, await load('error-no-conversation.json')).error.code).toBe('no_conversation');
  });

  it('peek line', async () => {
    expect(exact(peekSchema, await load('peek.json'))).toEqual({ paneId: 'w1:p1', line: 'foo bar' });
  });

  it('error bodies are machine codes', async () => {
    for (const [file, code] of [
      ['error-unauthorized.json', 'unauthorized'],
      ['error-unknown-instance.json', 'unknown_instance'],
    ] as const) {
      expect(exact(errorBodyV3Schema, await load(file)).error.code).toBe(code);
    }
  });

  it('events: hello then tree.changed', async () => {
    expect(exact(eventMessageSchema, await load('events-hello.json'))).toEqual({ t: 'hello', revision: 1 });
    expect(exact(eventMessageSchema, await load('events-tree-changed.json'))).toEqual({
      t: 'tree.changed',
      revision: 2,
    });
  });

  it('events: an automation step', async () => {
    expect(exact(eventMessageSchema, await load('events-automation.json'))).toEqual({
      t: 'automation',
      kind: 'failed',
      name: 'nightly-ci-triage',
      runId: 'run-7',
    });
  });

  it('automations: bootstrap capability, list and the closed-gate error', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-automations.json')).capabilities.automations).toBe(true);
    const list = exact(automationsSchema, await load('automations.json'));
    expect(list.scheduler).toBe(true);
    expect(list.automations.map((a) => a.state)).toEqual(['active', 'active', 'draft', 'paused']);
    expect(list.automations[0]).toMatchObject({ name: 'nightly-ci-triage', headless: true, unread: true, lastRun: { id: 'run-7', status: 'failed', durationSec: 31 } });
    expect(exact(errorBodyV3Schema, await load('error-automations-unavailable.json')).error.code).toBe('automations_unavailable');
  });

  it('automations management: capability, detail, write request and a refusal that carries the plugin\'s words', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-automations-manage.json')).capabilities).toMatchObject({ automations: true, automationsManage: true });
    expect(exact(automationsSchema, await load('automations.json')).draftPrompt).toContain('always create it as a draft');
    const detail = exact(automationDetailSchema, await load('automation-detail.json'));
    expect(detail).toMatchObject({ name: 'nightly-ci-triage', state: 'active', cron: '0 3 * * *', workspace: 'worktree', headless: true, timeoutMinutes: 45 });
    expect(detail.prompt).toBeTruthy();
    expect(detail.rationale).toBeTruthy();
    expect(detail.runs[0]).toMatchObject({ id: 'run-7', status: 'failed', paneId: 'p_9', unread: true });
    expect(JSON.stringify(detail.runs)).not.toMatch(/error/i); // a run carries no error text
    const write = exact(automationWriteSchema, await load('automation-write-request.json'));
    expect(write.name).toBe('weekly-recap');
    const refused = exact(errorBodyV3Schema, await load('error-automation-refused.json'));
    expect(refused.error).toEqual({ code: 'automation_refused', message: 'cron: expected 5 fields' });
    expect(AUTOMATION_REFUSALS).toContain(refused.error.code);
  });

  it('assistants: capabilities, event frame and the closed-gate error', async () => {
    expect(exact(bootstrapV3Schema, await load('bootstrap-personal-agent.json')).capabilities).toMatchObject({
      personalAgent: true,
      personalAgentManage: true,
      personalAgentApprove: true,
    });
    expect(exact(eventMessageSchema, await load('events-personal-agent.json'))).toEqual({
      t: 'personal-agent.changed',
      revision: 1,
      assistants: 2,
      needsYou: 3,
    });
    const gone = exact(errorBodyV3Schema, await load('error-personal-agent-unavailable.json'));
    expect(gone.error.code).toBe('personal_agent_unavailable');
    expect(PERSONAL_AGENT_REFUSALS).toContain(gone.error.code);
  });

  it('assistants: a real Group — list, feed with authors/deliveries/agents, the person message', async () => {
    const list = exact(groupsListSchema, await load('personal-agent-groups.json'));
    expect(list.groups[0]?.members.map((m) => m.name)).toEqual(['Ada', 'Bo']);
    const feed = exact(groupFeedResponseSchema, await load('personal-agent-group-feed.json')).feed;
    expect(feed.messages[0]).toMatchObject({ authorKind: 'user', kind: 'text', mentions: ['a_0000000000000009'] });
    expect(feed.deliveries[0]).toMatchObject({ assistantId: 'a_0000000000000009', state: 'queued' });
    expect(feed.agents.map((a) => a.state)).toEqual(['none', 'starting']);
    const request = exact(groupMessageRequestSchema, await load('personal-agent-group-message-request.json'));
    expect(request.mentions).toHaveLength(1);
    const posted = exact(groupPostResponseSchema, await load('personal-agent-group-message.json'));
    expect(posted.result.message.authorKind).toBe('user');
    expect(posted.result.deliveries).toHaveLength(1);
    expect(exact(bootstrapV3Schema, await load('bootstrap-personal-agent.json')).capabilities.personalAgentGroups).toBe(true);
  });

  it('assistants: persona — instructions revisions, runtime profile, MCP four states', async () => {
    const ins = exact(instructionsResponseSchema, await load('personal-agent-instructions.json')).instructions;
    expect(ins.revision).toBe(2);
    expect(ins.history.map((h) => h.source)).toEqual(['user', 'default']);
    expect(exact(instructionsResponseSchema, await load('personal-agent-instructions-saved.json')).instructions.body).toBe('Be brief and precise.');
    const rt = exact(runtimeResponseSchema, await load('personal-agent-runtime.json')).runtime;
    expect(rt.profile).toMatchObject({ agent: 'claude', model: 'sonnet', effort: 'high', effortSupported: true });
    expect(rt.running).toEqual([]);
    exact(runtimeResponseSchema, await load('personal-agent-runtime-saved.json'));
    const mcp = exact(mcpResponseSchema, await load('personal-agent-mcp.json')).mcp;
    expect(mcp.servers.map((s) => s.id)).toEqual(['alpha', 'beta', 'gamma']);
    expect(mcp.servers[0]).toMatchObject({ granted: true, configured: true, verified: '' });
    exact(mcpResponseSchema, await load('personal-agent-mcp-granted.json'));
    const verified = exact(mcpResponseSchema, await load('personal-agent-mcp-verified.json')).mcp;
    expect(verified.servers[0]).toMatchObject({ verified: 'connected', bound: ['coordinator'] });
    expect(verified.bindings[0]).toMatchObject({ strict: true, servers: ['alpha'] });
    expect(JSON.stringify(mcp)).not.toMatch(/SECRET|args|env/);
    expect(exact(bootstrapV3Schema, await load('bootstrap-personal-agent.json')).capabilities.personalAgentPersona).toBe(true);
    for (const f of ['personal-agent-instructions-request.json', 'personal-agent-runtime-request.json', 'personal-agent-mcp-grant-request.json']) {
      expect(await load(f)).toMatchObject({ requestId: expect.any(String) });
    }
  });

  it('assistants: goal plan + ledger — milestones derived from tasks, facts are the core\'s own sentences', async () => {
    const res = exact(goalPlanResponseSchema, await load('personal-agent-plan.json'));
    expect(res.plan).toMatchObject({ planRevision: 1, total: 2, verified: 0, state: 'working' });
    expect(res.plan.milestones.map((m) => m.state)).toEqual(['working', 'pending']);
    expect(res.plan.milestones[1]?.task).toBeUndefined();
    expect(res.facts.map((f) => f.kind)).toEqual(['delegated', 'planned', 'accepted']);
    const feed = exact(factsResponseSchema, await load('personal-agent-facts.json'));
    expect(feed.facts).toHaveLength(3);
    expect(feed.facts.every((f) => factKinds.includes(f.kind as (typeof factKinds)[number]))).toBe(true);
    expect(exact(bootstrapV3Schema, await load('bootstrap-personal-agent.json')).capabilities.personalAgentPlans).toBe(true);
  });

  it('assistants: Activity pages are oldest-first and only an explicit ACK advances a device cursor', async () => {
    const page = exact(assistantActivityPageSchema, await load('personal-agent-activity.json'));
    const ack = exact(assistantActivityAckSchema, await load('personal-agent-activity-ack.json'));
    expect(page).toMatchObject({ ackSeq: 0, nextSeq: 4, hasMore: false });
    expect(page.facts.map((f) => f.seq)).toEqual([...page.facts.map((f) => f.seq)].sort((a, b) => a - b));
    expect(page.facts.every((f) => f.assistantId === 'a_0000000000000001')).toBe(true);
    expect(ack.ackSeq).toBe(page.nextSeq);
  });

  it('assistants: routines — drafted in chat, approved by a person, owner on every row', async () => {
    const res = exact(routinesResponseSchema, await load('personal-agent-routines.json'));
    expect(res.routines).toHaveLength(1);
    expect(res.routines[0]).toMatchObject({ name: 'morning-check', state: 'draft', requestedBy: 'assistant', source: 'chat', headless: true, approvalState: 'pending' });
    expect(JSON.stringify(res)).not.toMatch(/error|token/i);
    expect(exact(bootstrapV3Schema, await load('bootstrap-personal-agent.json')).capabilities.personalAgentRoutines).toBe(true);
  });

  it('assistants: memory workspace and proactivity — items, versions, rules', async () => {
    const review = exact(memoryReviewResponseSchema, await load('personal-agent-memory.json')).review;
    expect(review.max).toBe(500);
    expect(review.items.length).toBeGreaterThan(0);
    expect(review.items.every((m) => m.state === 'approved' || m.state === 'candidate')).toBe(true);
    const versions = exact(memoryHistoryResponseSchema, await load('personal-agent-memory-history.json')).versions;
    expect(versions.map((v) => v.revision)).toEqual([...versions.map((v) => v.revision)].sort((a, b) => b - a));
    expect(versions[versions.length - 1]).toMatchObject({ author: 'user' });
    expect(exact(memoryItemResponseSchema, await load('personal-agent-memory-add.json')).memory).toMatchObject({ state: 'approved', sourceRef: 'user' });
    const rules = exact(proactivityResponseSchema, await load('personal-agent-proactivity.json')).proactivity;
    expect(rules).toMatchObject({ level: 'suggest', quietStart: '22:00', quietEnd: '08:00', tz: 'Asia/Shanghai', dailyBudget: 10 });
    const caps = exact(bootstrapV3Schema, await load('bootstrap-personal-agent.json')).capabilities;
    expect(caps.personalAgentMemory).toBe(true);
    expect(caps.personalAgentProactivity).toBe(true);
  });

  it('assistants: overview, list, one Assistant page, goals, task with runs, approvals', async () => {
    const overview = exact(assistantOverviewSchema, await load('personal-agent-overview.json'));
    expect(overview.needsYou).toBe(1);
    expect(overview.assistants[0]).toMatchObject({ name: 'Ada', approvals: 1, status: 'active' });
    expect(exact(assistantsListSchema, await load('personal-agent-assistants.json')).assistants).toHaveLength(1);
    const page = exact(assistantDetailSchema, await load('personal-agent-assistant.json'));
    expect(page.assistant.id).toBe('a_0000000000000001');
    expect(page.coordinator).toMatchObject({ state: 'ready', herdrSession: 'default', paneId: 'w1:p1' });
    expect(page.agents.map((a) => a.id)).toEqual(['omp']);
    expect(page.goals[0]?.commitments[0]).toMatchObject({ kind: 'pr_watch', state: 'active' });
    expect(page.tasks[0]?.runs[0]).toMatchObject({ herdrSession: 'default', paneId: 'w1:p1' });
    expect(page.approvals[0]?.actionHash).toHaveLength(64);
    expect(page.memory[0]?.content).toBe('Prefers short reports');
    expect(exact(assistantGoalsSchema, await load('personal-agent-goals.json')).goals).toHaveLength(1);
    expect(exact(assistantTaskWithRunsSchema, await load('personal-agent-task.json')).runs).toHaveLength(1);
    expect(exact(assistantApprovalsSchema, await load('personal-agent-approvals.json')).approvals[0]?.state).toBe('pending');
    const inbox = exact(assistantInboxSchema, await load('personal-agent-inbox.json'));
    expect(inbox.items[0]).toMatchObject({ kind: 'stalled', taskId: 't_0000000000000004' });
    expect(inbox.needsYou).toBe(1);
  });

  it('assistants: starting the Coordinator', async () => {
    const request = JSON.parse(JSON.stringify(await load('personal-agent-coordinator-start-request.json'))) as { requestId: string; agent: string };
    expect(request).toEqual({ requestId: '4d9a1f0e-6c1b-4e52-9a58-1b6f3a2c7d10', agent: 'omp' });
    const started = exact(assistantCoordinatorReceiptSchema, await load('personal-agent-coordinator-start.json'));
    expect(started.coordinator).toMatchObject({ state: 'starting', assistantId: 'a_0000000000000001' });
  });

  it('assistants: an exact approval decision and the stale refusal', async () => {
    const request = exact(assistantDecisionRequestSchema, await load('personal-agent-decision-request.json'));
    expect(request.approve).toBe(true);
    expect(exact(assistantApprovalReceiptSchema, await load('personal-agent-decision.json')).approval.id).toBe('p_0000000000000007');
    const stale = exact(errorBodyV3Schema, await load('error-personal-agent-stale.json'));
    expect(stale.error).toEqual({ code: 'stale_revision', message: 'revision is stale' });
    expect(PERSONAL_AGENT_REFUSALS).toContain(stale.error.code);
  });

  it('terminal server messages', async () => {
    expect(exact(terminalServerMessageSchema, await load('terminal-frame-header.json'))).toEqual({
      t: 'frame',
      seq: 1,
      full: true,
      w: 51,
      h: 19,
    });
    expect(exact(terminalServerMessageSchema, await load('terminal-pong.json'))).toEqual({ t: 'pong' });
    expect(exact(terminalServerMessageSchema, await load('terminal-input-error-bad.json'))).toEqual({
      t: 'input.error',
      code: 'bad_input',
    });
    expect(exact(terminalServerMessageSchema, await load('terminal-input-error-refused.json'))).toEqual({
      t: 'input.error',
      code: 'refused',
      message: 'agent is busy',
    });
  });

  it('terminal client messages are what the Host accepts', async () => {
    for (const name of ['terminal-client-input.json', 'terminal-client-resize.json', 'terminal-client-ping.json']) {
      exact(terminalClientMessageSchema, await load(name));
    }
  });

  it('mirrors the limits the Host enforces', () => {
    expect(V3_LIMITS).toMatchObject({ minCols: 10, maxCols: 400, minRows: 3, maxRows: 200, maxTerminalsPerDevice: 2 });
    expect(V3_CLOSE_TERMINAL_GONE).toBe(4404);
  });
});
