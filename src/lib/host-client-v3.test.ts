import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostV3Error, createHostClientV3, pairWithHost, routeAnswered } from '@/lib/host-client-v3';
import { hostConnectionV3Schema, parseStoredConnection, relayBaseUrl, type HostConnectionV3 } from '@/lib/host-connection-v3';
import { parsePairUrl } from '@/lib/pairing-v3';
import {
  PinMismatchError,
  type PinnedRequestOptions,
  type PinnedResponse,
  type PinnedSocketHandlers,
  type PinnedTransport,
} from '@/lib/pinned-transport';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '..', 'contracts', '__fixtures__', 'v3', name), 'utf8');

const FP = 'a1cc1d2af9c5a03eefb30bfcc11c5bae5554e2cee2ff007c8cde90e0a096ad57';
const connection: HostConnectionV3 = { host: '192.168.1.20', port: 7788, fingerprint: FP, token: 'tok_x', deviceId: 'dev_x', name: 'Test Mac' };

function fakeTransport(handler: (options: PinnedRequestOptions) => PinnedResponse | Promise<PinnedResponse>) {
  const requests: PinnedRequestOptions[] = [];
  const sockets: { url: string; protocols: string[]; handlers: PinnedSocketHandlers; sent: string[]; closed: boolean }[] = [];
  const transport: PinnedTransport = {
    async request(options) {
      requests.push(options);
      return handler(options);
    },
    openSocket(options, handlers) {
      const record = { url: options.url, protocols: options.protocols ?? [], handlers, sent: [] as string[], closed: false };
      sockets.push(record);
      return {
        sendText: (t) => void record.sent.push(t),
        sendBinary: () => {},
        close: () => void (record.closed = true),
      };
    },
  };
  return { transport, requests, sockets };
}

const ok = (body: string): PinnedResponse => ({ status: 200, headers: {}, body });

describe('pairWithHost', () => {
  const target = parsePairUrl(fixture('pair-url.txt'))!;

  it('posts the code over the pinned channel and returns the stored connection shape', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('pair.json')));
    const result = await pairWithHost(transport, target, 'My Phone');
    expect(requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/pair', method: 'POST', fingerprint: target.fingerprint });
    expect(JSON.parse(requests[0]!.body!)).toEqual({ code: target.code, deviceName: 'My Phone' });
    expect(hostConnectionV3Schema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ host: '192.168.1.20', port: 7788, fingerprint: target.fingerprint, name: 'Test Mac' });
  });

  it('turns an expired/used code into a typed http error with the Host message', async () => {
    const { transport } = fakeTransport(() => ({ status: 403, headers: {}, body: '{"error":{"code":"bad_code","message":"pairing code is not valid"}}' }));
    const error = await pairWithHost(transport, target, 'P').catch((e) => e);
    expect(error).toBeInstanceOf(HostV3Error);
    expect(error).toMatchObject({ kind: 'http', status: 403, code: 'bad_code', message: 'pairing code is not valid' });
  });

  it('reports a pin mismatch as its own kind', async () => {
    const { transport } = fakeTransport(() => { throw new PinMismatchError(); });
    expect(await pairWithHost(transport, target, 'P').catch((e) => e)).toMatchObject({ kind: 'pin' });
  });

  it('refuses a body that is not the contract', async () => {
    const { transport } = fakeTransport(() => ok('{"token":""}'));
    expect(await pairWithHost(transport, target, 'P').catch((e) => e)).toMatchObject({ kind: 'protocol' });
  });
});

describe('HTTP calls', () => {
  it('sends bearer + pin and parses the golden bodies', async () => {
    const { transport, requests } = fakeTransport((o) => {
      if (o.url.includes('/bootstrap')) return ok(fixture('bootstrap.json'));
      if (o.url.includes('/peek')) return ok(fixture('peek.json'));
      return ok(fixture('tree.json'));
    });
    const client = createHostClientV3(transport, connection);
    expect((await client.bootstrap()).hostName).toBe('Test Mac');
    expect((await client.tree('my session')).instance).toBeTruthy();
    expect((await client.peek('my session', 'p/1')).line).toBeDefined();
    expect(requests.map((r) => r.url)).toEqual([
      'https://192.168.1.20:7788/api/v3/bootstrap',
      'https://192.168.1.20:7788/api/v3/tree?instance=my%20session',
      'https://192.168.1.20:7788/api/v3/panes/p%2F1/peek?instance=my%20session',
    ]);
    for (const r of requests) {
      expect(r.headers).toEqual({ authorization: 'Bearer tok_x' });
      expect(r.fingerprint).toBe(FP);
    }
  });

  it('maps 401 to unauthorized so callers can drop a revoked device', async () => {
    const { transport } = fakeTransport(() => ({ status: 401, headers: {}, body: fixture('error-unauthorized.json') }));
    const error = await createHostClientV3(transport, connection).bootstrap().catch((e) => e);
    expect(error).toMatchObject({ kind: 'unauthorized', status: 401 });
  });

  it('maps unknown instance (404) and non-JSON bodies', async () => {
    const a = fakeTransport(() => ({ status: 404, headers: {}, body: fixture('error-unknown-instance.json') }));
    expect(await createHostClientV3(a.transport, connection).tree('x').catch((e) => e)).toMatchObject({ kind: 'http', status: 404 });
    const b = fakeTransport(() => ok('<html>'));
    expect(await createHostClientV3(b.transport, connection).bootstrap().catch((e) => e)).toMatchObject({ kind: 'protocol' });
  });

  it('wraps transport failures in one error family', async () => {
    const { transport } = fakeTransport(() => { throw new Error('timeout'); });
    expect(await createHostClientV3(transport, connection).bootstrap().catch((e) => e)).toMatchObject({ kind: 'transport', message: 'timeout' });
  });
});

describe('events socket', () => {
  it('authenticates with the subprotocol pair and parses hello/tree.changed, ignoring junk', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    const messages: unknown[] = [];
    createHostClientV3(transport, connection).openEvents('default', { onMessage: (m) => messages.push(m), onClose: () => {} });
    const s = sockets[0]!;
    expect(s.url).toBe('wss://192.168.1.20:7788/api/v3/events?instance=default');
    expect(s.protocols).toEqual(['solco.bearer', 'tok_x']);
    s.handlers.onText?.(fixture('events-hello.json'));
    s.handlers.onText?.(fixture('events-tree-changed.json'));
    s.handlers.onText?.(fixture('events-automation.json'));
    s.handlers.onText?.('not json');
    s.handlers.onText?.('{"t":"other"}');
    expect(messages).toHaveLength(3);
  });
});

describe('chat', () => {
  it('reads the conversation and posts send/stop with the Host\'s body shapes', async () => {
    const { transport, requests } = fakeTransport((o) => ok(o.method === 'POST' ? fixture('chat-send-ok.json') : fixture('chat.json')));
    const client = createHostClientV3(transport, connection);
    expect((await client.chat('my session', 'w1:p1')).turns).toHaveLength(2);
    await client.sendChat('my session', 'w1:p1', { text: 'run the tests', interrupt: true });
    await client.stopChat('my session', 'w1:p1');
    expect(requests.map((r) => `${r.method ?? 'GET'} ${r.url}`)).toEqual([
      'GET https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat?instance=my%20session',
      'POST https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/send?instance=my%20session',
      'POST https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/stop?instance=my%20session',
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ text: 'run the tests', interrupt: true });
    expect(requests[1]!.headers).toMatchObject({ authorization: 'Bearer tok_x', 'content-type': 'application/json' });
    expect(requests[2]!.body).toBeUndefined();
  });

  it('posts a card answer and turns a moved-on card into interaction_gone', async () => {
    const answer = fixture('chat-client-answer.json');
    const { transport, requests } = fakeTransport(() => ok(fixture('chat-send-ok.json')));
    const client = createHostClientV3(transport, connection);
    await client.answerChat('default', 'w1:p1', JSON.parse(answer));
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/answer?instance=default',
      body: JSON.stringify(JSON.parse(answer)),
    });
    const gone = fakeTransport(() => ({ status: 409, headers: {}, body: fixture('error-interaction-gone.json') }));
    const error = await createHostClientV3(gone.transport, connection).answerChat('default', 'w1:p1', { interactionId: 'x', option: 'No' }).catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'interaction_gone' });
  });

  it('reads the catalog of one pane', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('chat-catalog.json')));
    const catalog = await createHostClientV3(transport, connection).chatCatalog('my session', 'w1:p1');
    expect(catalog.skills[0]?.name).toBe('/review');
    expect(requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/catalog?instance=my%20session' });
  });

  it('lists the pane folder for an @ token, encoding it', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('chat-files.json')));
    const files = await createHostClientV3(transport, connection).chatFiles('my session', 'w1:p1', 'src/a b');
    expect(files).toEqual(['README.md', 'src/']);
    expect(requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/files?instance=my%20session&token=src%2Fa%20b' });
  });

  it('opens one sub-agent for the drawer, encoding both ids', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('chat-subagent.json')));
    const view = await createHostClientV3(transport, connection).chatSubagent('my session', 'w1:p1', 'abc/123');
    expect(view.subagent.id).toBe('abc123');
    expect(requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/subagents/abc%2F123?instance=my%20session' });
    const gone = fakeTransport(() => ({ status: 404, headers: {}, body: fixture('error-unknown-subagent.json') }));
    const error = await createHostClientV3(gone.transport, connection).chatSubagent('default', 'w1:p1', 'nope').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 404, code: 'unknown_subagent' });
  });

  it('uploads one attachment and resolves with the saved path', async () => {
    const body = fixture('attach-client-request.json');
    const { transport, requests } = fakeTransport(() => ok(fixture('attach-ok.json')));
    const path = await createHostClientV3(transport, connection).uploadAttachment('default', 'w1:p1', JSON.parse(body));
    expect(path).toMatch(/ChatAttachments\/.*\.png$/);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/attachments?instance=default',
      body: JSON.stringify(JSON.parse(body)),
    });
    expect(requests[0]!.timeoutMs).toBeGreaterThanOrEqual(60_000);

    const refused = fakeTransport(() => ({ status: 400, headers: {}, body: fixture('error-attach-bad-request.json') }));
    const error = await createHostClientV3(refused.transport, connection).uploadAttachment('default', 'w1:p1', JSON.parse(body)).catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 400, code: 'bad_request' });
  });

  it('withdraws the queued follow-up and relays the refusal', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('queue-cancel-ok.json')));
    await createHostClientV3(transport, connection).cancelQueued('my session', 'w1:p1');
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/queue/cancel?instance=my%20session',
    });
    const none = fakeTransport(() => ({ status: 404, headers: {}, body: fixture('error-queue-none.json') }));
    const error = await createHostClientV3(none.transport, connection).cancelQueued('default', 'w1:p1').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 404, code: 'no_queued' });
  });

  it('reads the Feedback inbox, answers and ends an Ask with the Host\'s paths and bodies, and relays a final one', async () => {
    const list = fakeTransport(() => ok(fixture('feedback-thread.json')));
    const client = createHostClientV3(list.transport, connection);
    expect((await client.feedback('t 1')).detail?.asks).toHaveLength(2);
    expect(list.requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/feedback?thread=t%201' });
    await client.feedback();
    expect(list.requests[1]?.url).toBe('https://192.168.1.20:7788/api/v3/feedback');
    const write = fakeTransport(() => ok(fixture('feedback-ack.json')));
    const writer = createHostClientV3(write.transport, connection);
    await writer.feedbackAnswer('a 1', { answers: { q1: { selected: ['SQLite'] } } });
    expect(write.requests[0]).toMatchObject({ method: 'POST', url: 'https://192.168.1.20:7788/api/v3/feedback/asks/a%201/answer', body: '{"answers":{"q1":{"selected":["SQLite"]}}}' });
    await writer.feedbackEnd('a_2');
    expect(write.requests[1]).toMatchObject({ method: 'POST', url: 'https://192.168.1.20:7788/api/v3/feedback/asks/a_2/end' });
    const final = fakeTransport(() => ({ status: 409, headers: {}, body: fixture('error-feedback-final.json') }));
    const error = await createHostClientV3(final.transport, connection).feedbackEnd('a_0').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'feedback_final' });
  });

  it('withdraws one queued item by id, encoding it, and relays the refusal', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('queue-cancel-ok.json')));
    await createHostClientV3(transport, connection).cancelQueuedItem('my session', 'w1:p1', 'req 1');
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/queue/item/req%201/cancel?instance=my%20session',
      body: '{}',
    });
    const gone = fakeTransport(() => ({ status: 409, headers: {}, body: '{"error":{"code":"already_delivered"}}' }));
    const error = await createHostClientV3(gone.transport, connection).cancelQueuedItem('default', 'w1:p1', 'req 1').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'already_delivered' });
  });

  it('rewrites and moves one queued item through its own endpoints', async () => {
    const { transport, requests } = fakeTransport(() => ok(fixture('queue-item-edit-ok.json')));
    const client = createHostClientV3(transport, connection);
    await client.editQueuedItem('default', 'w1:p1', 'req 1', 'then run the tests and lint');
    await client.moveQueuedItem('default', 'w1:p1', 'req 1', 0);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/queue/item/req%201/edit?instance=default',
      body: JSON.stringify({ text: 'then run the tests and lint' }),
    });
    expect(requests[1]).toMatchObject({
      url: 'https://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/queue/item/req%201/move?instance=default',
      body: JSON.stringify({ to: 0 }),
    });
    const refused = fakeTransport(() => ({ status: 409, headers: {}, body: '{"error":{"code":"cannot_move"}}' }));
    const error = await createHostClientV3(refused.transport, connection).moveQueuedItem('default', 'w1:p1', 'req 1', 5).catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'cannot_move' });
  });

  it('reads Git status and one file diff, encoding the path, and relays unknown_file', async () => {
    const status = fakeTransport(() => ok(fixture('git-status.json')));
    const reply = await createHostClientV3(status.transport, connection).gitStatus('default', 'w1');
    expect(reply).toMatchObject({ repo: true, branch: 'main' });
    expect(status.requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/workspaces/w1/git?instance=default' });

    const diff = fakeTransport(() => ok(fixture('git-diff.json')));
    await createHostClientV3(diff.transport, connection).gitDiff('default', 'w1', 'src/a b&c.go');
    expect(diff.requests[0]!.url).toBe('https://192.168.1.20:7788/api/v3/workspaces/w1/git/diff?instance=default&path=src%2Fa%20b%26c.go');

    const gone = fakeTransport(() => ({ status: 404, headers: {}, body: fixture('error-git-unknown-file.json') }));
    const error = await createHostClientV3(gone.transport, connection).gitDiff('default', 'w1', 'gone.go').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 404, code: 'unknown_file' });
  });

  it('searches file names with the query encoded, parses the ranked hits, and relays search_unavailable', async () => {
    const found = fakeTransport(() => ok(fixture('files-search.json')));
    const reply = await createHostClientV3(found.transport, connection).filesSearch('default', 'w1', 'src util&go');
    expect(reply).toMatchObject({ hits: ['src/app.go', 'src/util.go'], total: 2 });
    expect(found.requests[0]).toMatchObject({ url: 'https://192.168.1.20:7788/api/v3/workspaces/w1/files/search?instance=default&q=src%20util%26go' });

    const noEngine = fakeTransport(() => ({ status: 502, headers: {}, body: fixture('error-files-search-unavailable.json') }));
    const error = await createHostClientV3(noEngine.transport, connection).filesSearch('default', 'w1', 'go').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 502, code: 'search_unavailable' });
  });

  it('writes Git through the manage routes with the exact bodies, the long timeout, and relays stable refusal codes', async () => {
    const { transport, requests } = fakeTransport((o) => ok(fixture(o.url.includes('/git/commit') ? 'git-commit-ok.json' : 'git-stage-ok.json')));
    const client = createHostClientV3(transport, connection);
    expect(await client.gitStage('default', 'w1', ['a b.go'])).toMatchObject({ status: { repo: true } });
    await client.gitUnstage('default', 'w1', ['a.go']);
    const commit = JSON.parse(fixture('git-commit-client-request.json'));
    expect(await client.gitCommit('default', 'w1', commit)).toMatchObject({ hash: 'def5678' });
    await client.gitSync('default', 'w1', 'push', 'abc1234');
    await client.gitSync('default', 'w1', 'fetch');
    expect(requests.map((r) => [r.method, r.url.replace('https://192.168.1.20:7788/api/v3', ''), r.body])).toEqual([
      ['POST', '/workspaces/w1/git/stage?instance=default', JSON.stringify({ paths: ['a b.go'] })],
      ['POST', '/workspaces/w1/git/unstage?instance=default', JSON.stringify({ paths: ['a.go'] })],
      ['POST', '/workspaces/w1/git/commit?instance=default', JSON.stringify(commit)],
      ['POST', '/workspaces/w1/git/push?instance=default', JSON.stringify({ head: 'abc1234' })],
      ['POST', '/workspaces/w1/git/fetch?instance=default', '{}'],
    ]);
    expect(requests[0]!.timeoutMs).toBeGreaterThanOrEqual(155_000);

    const refused = fakeTransport(() => ({ status: 409, headers: {}, body: fixture('error-git-rejected.json') }));
    const error = await createHostClientV3(refused.transport, connection).gitSync('default', 'w1', 'pull').catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'git_rejected' });
    await expect(createHostClientV3(refused.transport, connection).gitCommit('default', 'w1', { subject: '', paths: ['a.go'] })).rejects.toThrow();
  });

  it('launches with the long timeout, validates the answer and relays named refusals', async () => {
    const body = fixture('launch-client-request.json');
    const { transport, requests } = fakeTransport(() => ok(fixture('launch-ok.json')));
    const reply = await createHostClientV3(transport, connection).launch('default', JSON.parse(body));
    expect(reply).toMatchObject({ paneId: 'w1:p2', workspaceId: 'w1', agent: false });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://192.168.1.20:7788/api/v3/launch?instance=default',
      body: JSON.stringify(JSON.parse(body)),
    });
    expect(requests[0]!.timeoutMs).toBeGreaterThanOrEqual(155_000);

    const refused = fakeTransport(() => ({ status: 504, headers: {}, body: '{"error":{"code":"launch_uncertain"}}' }));
    const error = await createHostClientV3(refused.transport, connection).launch('default', JSON.parse(body)).catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 504, code: 'launch_uncertain' });

    const never = fakeTransport(() => ok('{}'));
    await expect(createHostClientV3(never.transport, connection).launch('default', { requestId: 'short', kind: 'codex', path: '/x' })).rejects.toThrow();
    expect(never.requests).toHaveLength(0);
  });

  it('turns a Herdr-gated refusal into a typed error with the Host code', async () => {
    const { transport } = fakeTransport(() => ({ status: 409, headers: {}, body: fixture('error-busy.json') }));
    const error = await createHostClientV3(transport, connection).sendChat('d', 'p', { text: 'x' }).catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 409, code: 'busy' });
  });

  it('streams whole-state frames and reports why a close must not reconnect', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    const frames: unknown[] = [];
    const closes: unknown[] = [];
    createHostClientV3(transport, connection).openChat('default', 'w1:p1', { onFrame: (f) => frames.push(f), onClose: (c) => closes.push(c) });
    const s = sockets[0]!;
    expect(s.url).toBe('wss://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/stream?instance=default');
    expect(s.protocols).toEqual(['solco.bearer', 'tok_x']);
    s.handlers.onText?.(fixture('chat-frame.json'));
    s.handlers.onText?.('not json');
    s.handlers.onText?.('{"t":"chat"}');
    expect(frames).toHaveLength(1);
    s.handlers.onClose?.({ code: 4409, reason: 'no_conversation' });
    s.handlers.onClose?.({ code: 4404, reason: 'pane_gone' });
    s.handlers.onClose?.({ code: 1006, reason: 'lost' });
    expect(closes).toEqual([
      { code: 4409, reason: 'no_conversation', gone: false, noConversation: true },
      { code: 4404, reason: 'pane_gone', gone: true, noConversation: false },
      { code: 1006, reason: 'lost', gone: false, noConversation: false },
    ]);
  });

  it('appends limit query param when provided', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    createHostClientV3(transport, connection).openChat('default', 'w1:p1', { onFrame: () => {}, onClose: () => {} }, 15);
    expect(sockets[0]!.url).toBe('wss://192.168.1.20:7788/api/v3/panes/w1%3Ap1/chat/stream?instance=default&limit=15');
  });
});

describe('OMP Chat delta stream recovery', () => {
  it('merges exact suffixes, asks one snapshot after a gap and resumes on a full frame', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    const frames: { seq?: number; state: { turns: { narration?: string }[] } }[] = [];
    createHostClientV3(transport, connection).openChat('default', 'w1:p1', {
      onFrame: (frame) => frames.push(frame), onClose: () => {},
    });
    const ws = sockets[0]!;
    const full = { ...JSON.parse(fixture('chat-frame.json')), seq: 1 };
    ws.handlers.onText?.(JSON.stringify(full));
    const baseTurns = full.state.turns as unknown[];
    const good = {
      t: 'chat_delta', paneId: 'w1:p1', baseSeq: 1, seq: 2,
      start: Math.max(0, baseTurns.length - 3),
      turns: [{ user: false, narration: 'streaming' }],
    };
    ws.handlers.onText?.(JSON.stringify(good));
    expect(frames).toHaveLength(2);
    expect(frames[1]?.seq).toBe(2);
    expect(frames[1]?.state.turns.at(-1)?.narration).toBe('streaming');
    ws.handlers.onText?.(JSON.stringify({ ...good, baseSeq: 4, seq: 5 }));
    ws.handlers.onText?.(JSON.stringify({ ...good, baseSeq: 5, seq: 6 }));
    expect(ws.sent).toEqual(['{"t":"snapshot"}']);
    expect(frames).toHaveLength(2);
    ws.handlers.onText?.(JSON.stringify({ ...full, seq: 7 }));
    ws.handlers.onText?.(JSON.stringify({ ...good, baseSeq: 7, seq: 8 }));
    expect(frames.at(-1)?.seq).toBe(8);
    expect(ws.sent).toHaveLength(1);
  });
});

describe('chat stream paging', () => {
  it('asks this socket for the previous page with the one message the Host reads', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    const chat = createHostClientV3(transport, connection).openChat('default', 'w1:p1', { onFrame: () => {}, onClose: () => {} });
    chat.older();
    expect(sockets[0]!.sent).toEqual(['{"t":"older"}']);
  });
});

describe('terminal session', () => {
  const grid = { cols: 51, rows: 19 };

  it('opens the stream on the pinned socket, assembles frames and encodes input within limits', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    const events: unknown[] = [];
    const closes: unknown[] = [];
    const session = createHostClientV3(transport, connection).openTerminal('default', 't/1', grid, {
      onEvent: (e) => events.push(e),
      onClose: (c) => closes.push(c),
    });
    const s = sockets[0]!;
    expect(s.url).toBe('wss://192.168.1.20:7788/api/v3/terminals/t%2F1/stream?cols=51&rows=19&instance=default');
    s.handlers.onOpen?.();
    s.handlers.onText?.(fixture('terminal-frame-header.json'));
    s.handlers.onBinary?.(new Uint8Array([65]));
    expect(events).toEqual([{ kind: 'frame', frame: { seq: 1, full: true, width: 51, height: 19, bytes: new Uint8Array([65]) } }]);

    expect(session.sendInput({ text: 'ls', keys: ['enter'] })).toBe(true);
    expect(session.sendInput({})).toBe(false);
    expect(session.sendInput({ keys: ['bad key'] })).toBe(false);
    expect(session.resize({ cols: 2, rows: 1 })).toBe(true); // clamped into the Host's range, not refused
    expect(s.sent.map((m) => JSON.parse(m))).toEqual([
      { t: 'input', text: 'ls', keys: ['enter'] },
      { t: 'resize', cols: 10, rows: 3 },
    ]);

    s.handlers.onClose?.({ code: 4404, reason: 'gone' });
    s.handlers.onClose?.({ code: 1006, reason: 'lost' });
    expect(closes).toEqual([
      { code: 4404, reason: 'gone', gone: true },
      { code: 1006, reason: 'lost', gone: false },
    ]);
  });

  it('close() closes the socket', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    const session = createHostClientV3(transport, connection).openTerminal('default', 't', grid, { onEvent: () => {}, onClose: () => {} });
    session.close();
    expect(sockets[0]!.closed).toBe(true);
  });

  it('clamps a measured viewport into the stream path', () => {
    const { transport, sockets } = fakeTransport(() => ok('{}'));
    createHostClientV3(transport, connection).openTerminal('default', 't', { cols: 9999, rows: 1 }, { onEvent: () => {}, onClose: () => {} });
    expect(sockets[0]!.url).toContain('cols=400&rows=3');
  });
});

describe('stored connection', () => {
  it('round-trips and treats corrupt storage as "not paired"', () => {
    expect(parseStoredConnection(JSON.stringify(connection))).toEqual(connection);
    expect(parseStoredConnection(null)).toBeNull();
    expect(parseStoredConnection('not json')).toBeNull();
    expect(parseStoredConnection(JSON.stringify({ ...connection, fingerprint: 'zz' }))).toBeNull();
    expect(parseStoredConnection(JSON.stringify({ ...connection, token: '' }))).toBeNull();
  });
});

describe('relay route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const RELAY = { url: 'https://relay.example.com', secret: 'relay-test-secret-0123456789' };
  const relayConnection: HostConnectionV3 = { ...connection, relay: RELAY };

  function fetchStub(handler: (url: string, init?: RequestInit) => { status: number; body: string }) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const stub = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const out = handler(url, init);
      return { status: out.status, text: async () => out.body };
    });
    vi.stubGlobal('fetch', stub);
    return calls;
  }

  class FakeSocket {
    static instances: FakeSocket[] = [];
    url: string;
    binaryType = '';
    sent: string[] = [];
    closedWith: { code: number; reason: string } | null = null;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      FakeSocket.instances.push(this);
    }
    send(text: string) {
      this.sent.push(text);
    }
    close(code = 1000, reason = '') {
      this.closedWith = { code, reason };
    }
  }

  it('relayBaseUrl is the per-host relay prefix and null without one', () => {
    expect(relayBaseUrl(relayConnection)).toBe(`${RELAY.url}/c/${RELAY.secret}`);
    expect(relayBaseUrl({})).toBeNull();
  });

  it('pairs through <r>/c/<rt>/api/v3/pair with plain fetch and carries the relay into the connection', async () => {
    const target = { ...parsePairUrl(fixture('pair-url.txt'))!, relay: RELAY };
    const calls = fetchStub(() => ({ status: 200, body: fixture('pair.json') }));
    const result = await pairWithHost(null, target, 'My Phone');
    expect(calls[0]!.url).toBe(`${RELAY.url}/c/${RELAY.secret}/api/v3/pair`);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ code: target.code, deviceName: 'My Phone' });
    expect(result).toMatchObject({ host: '192.168.1.20', fingerprint: target.fingerprint, relay: RELAY });
  });

  it('a direct pair without a pinned transport refuses instead of an unpinned fetch', async () => {
    await expect(pairWithHost(null, parsePairUrl(fixture('pair-url.txt'))!, 'P')).rejects.toMatchObject({ kind: 'transport' });
  });

  it('HTTP goes through <r>/c/<secret> with only the bearer header', async () => {
    const calls = fetchStub(() => ({ status: 200, body: fixture('bootstrap.json') }));
    const client = createHostClientV3(null, relayConnection);
    expect((await client.bootstrap()).hostName).toBe('Test Mac');
    expect(calls[0]!.url).toBe(`${RELAY.url}/c/${RELAY.secret}/api/v3/bootstrap`);
    expect(calls[0]!.init?.headers).toEqual({ authorization: 'Bearer tok_x' });
  });

  it('relay failures keep one error family (401 → unauthorized, network → transport)', async () => {
    fetchStub(() => ({ status: 401, body: fixture('error-unauthorized.json') }));
    await expect(createHostClientV3(null, relayConnection).bootstrap()).rejects.toMatchObject({ kind: 'unauthorized' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('off'); }));
    await expect(createHostClientV3(null, relayConnection).bootstrap()).rejects.toMatchObject({ kind: 'transport', message: 'off' });
  });

  it('routeAnswered counts a 401 as a Host that answered, never a pin mismatch, an offline relay or a transport failure', () => {
    expect(routeAnswered(new HostV3Error('unauthorized', 'x', { status: 401 }))).toBe(true);
    expect(routeAnswered(new HostV3Error('pin', 'x'))).toBe(false);
    expect(routeAnswered(new HostV3Error('http', 'x', { status: 502, code: 'relay_offline' }))).toBe(false);
    expect(routeAnswered(new HostV3Error('transport', 'after 10000ms'))).toBe(false);
    expect(routeAnswered(new Error('boom'))).toBe(false);
  });

  it('a relay gateway answer without the Host\'s error body means the Mac is offline; a coded 5xx stays the Host\'s', async () => {
    fetchStub(() => ({ status: 502, body: JSON.stringify({ error: 'Desktop is offline or the connect code is invalid' }) }));
    await expect(createHostClientV3(null, relayConnection).bootstrap()).rejects.toMatchObject({ kind: 'http', status: 502, code: 'relay_offline' });
    fetchStub(() => ({ status: 504, body: '' }));
    await expect(createHostClientV3(null, relayConnection).bootstrap()).rejects.toMatchObject({ code: 'relay_offline' });
    fetchStub(() => ({ status: 502, body: JSON.stringify({ error: { code: 'backend_unavailable' } }) }));
    await expect(createHostClientV3(null, relayConnection).bootstrap()).rejects.toMatchObject({ status: 502, code: 'backend_unavailable' });
  });

  it('event sockets append ?token= (no subprotocol) and speak plain WebSocket', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    const messages: unknown[] = [];
    const client = createHostClientV3(null, relayConnection);
    const stream = client.openEvents('default', { onMessage: (m) => messages.push(m), onClose: () => {} });
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe(`${RELAY.url.replace('https:', 'wss:')}/c/${RELAY.secret}/api/v3/events?instance=default&token=tok_x`);
    socket.onopen?.();
    socket.onmessage?.({ data: fixture('events-hello.json') });
    socket.onmessage?.({ data: 'not json' });
    expect(messages).toHaveLength(1);
    stream.close();
    expect(socket.closedWith).toEqual({ code: 1000, reason: 'client closed' });
  });

  it('terminal stream URLs carry the token after the existing query', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    createHostClientV3(null, relayConnection).openTerminal('t/1', 'term-9', { cols: 80, rows: 24 }, {
      onEvent: () => {},
      onClose: () => {},
    });
    expect(FakeSocket.instances[0]!.url).toBe(
      `${RELAY.url.replace('https:', 'wss:')}/c/${RELAY.secret}/api/v3/terminals/term-9/stream?cols=80&rows=24&instance=t%2F1&token=tok_x`,
    );
  });
});

describe('remote desktop', () => {
  it('reads readiness and trades the offer for the answer, waiting past the Mac’s approval window', async () => {
    const { transport, requests } = fakeTransport((o) => ok(o.method === 'POST' ? fixture('remote-desktop-answer.json') : fixture('remote-desktop-info.json')));
    const client = createHostClientV3(transport, connection);
    expect((await client.remoteDesktopInfo()).state).toBe('ready');
    const offer = JSON.parse(fixture('remote-desktop-offer.json'));
    expect((await client.remoteDesktopSession(offer)).state.mode).toBe('full');
    expect(requests.map((r) => `${r.method ?? 'GET'} ${r.url}`)).toEqual([
      'GET https://192.168.1.20:7788/api/v3/remote-desktop',
      'POST https://192.168.1.20:7788/api/v3/remote-desktop/session',
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual(offer);
    expect(requests[1]!.timeoutMs).toBeGreaterThan(45_000); // the Mac waits up to 45 s for approval
  });

  it('surfaces the Mac’s refusal code', async () => {
    const { transport } = fakeTransport(() => ({ status: 403, headers: {}, body: fixture('error-remote-desktop-denied.json') }));
    const error = await createHostClientV3(transport, connection).remoteDesktopSession(JSON.parse(fixture('remote-desktop-offer.json'))).catch((e) => e);
    expect(error).toMatchObject({ kind: 'http', status: 403, code: 'denied' });
  });
});
