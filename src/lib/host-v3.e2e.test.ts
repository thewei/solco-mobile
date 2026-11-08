// [INPUT]: a live Solco Host with a throw-away Herdr session, served by the Go side:
//   SOLCO_REMOTEHOST_SERVE=/tmp/solco-e2e go test -run ServeRealHerdr ./internal/remotehost/
// [OUTPUT]: end-to-end proof that the mobile codecs speak the real wire: pair → bootstrap →
//           tree → peek → events → terminal stream, with typed input echoing back.
// [POS]: Opt-in (SOLCO_E2E_DIR); skipped in `pnpm test`. Run through scripts/e2e-v3.sh, which
//        sets NODE_TLS_REJECT_UNAUTHORIZED=0 for this one process — the certificate pin itself is
//        checked here with tls.connect, standing in for the native module's pinned client.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tls from 'node:tls';

import { afterAll, describe, expect, it } from 'vitest';

import {
  V3_API_PREFIX,
  V3_BEARER_SUBPROTOCOL,
  bootstrapV3Schema,
  chatCatalogSchema,
  chatFilesSchema,
  launchResponseSchema,
  eventMessageSchema,
  pairResponseSchema,
  peekSchema,
  treeV3Schema,
} from '@/contracts/host-v3';
import { pairRequestBody, pairTargetBaseUrl, parsePairUrl } from '@/lib/pairing-v3';
import {
  ENCODED_PING,
  createFrameAssembler,
  encodeInput,
  terminalStreamPath,
  type TerminalEvent,
} from '@/lib/terminal-protocol-v3';

const dir = process.env.SOLCO_E2E_DIR;

/** The certificate's SHA-256 as the Host advertises it (DER, lowercase hex). */
function peerFingerprint(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
      const der = socket.getPeerCertificate().raw;
      socket.end();
      resolve(createHash('sha256').update(der).digest('hex'));
    });
    socket.on('error', reject);
  });
}

function open(url: string, protocols: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`websocket ${url} failed`));
  });
}

describe.skipIf(!dir)('Go Host v3, end to end', () => {
  // Set by the pairing test; the later ones reuse the same device (a pairing code is single-use).
  let session: { base: string; token: string; instance: string } | null = null;
  const read = (name: string) => readFileSync(join(dir!, name), 'utf8').trim();
  afterAll(() => writeFileSync(join(dir!, 'done'), ''));

  it('pairs, lists, peeks and drives a real terminal', async () => {
    expect(existsSync(join(dir!, 'pair-url.txt'))).toBe(true);
    const target = parsePairUrl(read('pair-url.txt'));
    expect(target).not.toBeNull();
    const instance = read('instance.txt');
    const base = pairTargetBaseUrl(target!);

    // The pin: what the link says is what the socket presents; any other fingerprint must not match.
    expect(await peerFingerprint(target!.host, target!.port)).toBe(target!.fingerprint);

    // pair
    const pairRes = await fetch(`${base}${V3_API_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: pairRequestBody(target!, 'E2E Phone'),
    });
    expect(pairRes.status).toBe(200);
    const { token } = pairResponseSchema.parse(await pairRes.json());
    session = { base, token, instance };
    const auth = { authorization: `Bearer ${token}` };
    const get = (path: string) => fetch(`${base}${V3_API_PREFIX}${path}`, { headers: auth });

    // the code is single-use
    const replay = await fetch(`${base}${V3_API_PREFIX}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: pairRequestBody(target!, 'Second Phone'),
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);

    // unauthenticated is refused
    expect((await fetch(`${base}${V3_API_PREFIX}/bootstrap`)).status).toBe(401);

    // bootstrap
    const bootstrap = bootstrapV3Schema.parse(await (await get('/bootstrap')).json());
    expect(bootstrap.capabilities.terminal).toBe(true);
    expect(bootstrap.instances.map((i) => i.id)).toContain(instance);

    // tree
    const tree = treeV3Schema.parse(await (await get(`/tree?instance=${encodeURIComponent(instance)}`)).json());
    const pane = tree.workspaces[0]?.tabs[0]?.panes[0];
    expect(pane).toBeDefined();

    // peek
    const peekRes = await get(`/panes/${encodeURIComponent(pane!.paneId)}/peek?instance=${encodeURIComponent(instance)}`);
    expect(peekRes.status).toBe(200);
    peekSchema.parse(await peekRes.json());

    // chat: a plain shell pane has no conversation — 409 no_conversation on read/send, 4409 on the stream
    const chatPath = `/panes/${encodeURIComponent(pane!.paneId)}/chat?instance=${encodeURIComponent(instance)}`;
    const chatRes = await get(chatPath);
    expect(chatRes.status).toBe(409);
    expect(await chatRes.json()).toMatchObject({ error: { code: 'no_conversation' } });
    const sendRes = await fetch(`${base}${V3_API_PREFIX}${chatPath.replace('/chat?', '/chat/send?')}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(sendRes.status).toBeGreaterThanOrEqual(400);
    // the stream itself is refused at the upgrade (no socket to close with 4409): a client learns why via GET
    await expect(
      open(`wss://${target!.host}:${target!.port}${V3_API_PREFIX}${chatPath.replace('/chat?', '/chat/stream?')}`, [V3_BEARER_SUBPROTOCOL, token]),
    ).rejects.toThrow(/failed/);

    // events: hello carries the tree revision
    const events = await open(
      `wss://${target!.host}:${target!.port}${V3_API_PREFIX}/events?instance=${encodeURIComponent(instance)}`,
      [V3_BEARER_SUBPROTOCOL, token],
    );
    const hello = await new Promise<unknown>((resolve) => {
      events.onmessage = (m) => resolve(JSON.parse(String(m.data)));
    });
    expect(eventMessageSchema.parse(hello)).toEqual({ t: 'hello', revision: tree.revision });
    events.close();

    // terminal: own grid, full first frame, typed input echoes back
    const ws = await open(
      `wss://${target!.host}:${target!.port}${terminalStreamPath(pane!.terminalId, { cols: 51, rows: 19 }, instance)}`,
      [V3_BEARER_SUBPROTOCOL, token],
    );
    const assembler = createFrameAssembler();
    const seen: TerminalEvent[] = [];
    let screen = '';
    let sent = false;
    const echoed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no echo; screen so far: ${JSON.stringify(screen)}`)), 15_000);
      ws.onmessage = (m) => {
        const event =
          typeof m.data === 'string' ? assembler.text(m.data) : assembler.binary(new Uint8Array(m.data as ArrayBuffer));
        if (!event) return;
        seen.push(event);
        if (event.kind !== 'frame') return;
        screen += new TextDecoder().decode(event.frame.bytes);
        if (!sent && event.frame.full) {
          expect([event.frame.width, event.frame.height]).toEqual([51, 19]);
          sent = true;
          screen = '';
          ws.send(encodeInput({ text: 'echo HELLO_FROM_$((1+1))MOBILE', keys: ['enter'] })!);
          ws.send(ENCODED_PING);
        }
        if (screen.includes('HELLO_FROM_2MOBILE')) {
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onclose = () => reject(new Error('terminal socket closed early'));
    });
    await echoed;
    ws.onclose = null;
    ws.close();
    expect(seen.find((e) => e.kind === 'frame')).toMatchObject({ frame: { full: true } });
  }, 60_000);

  it('launches a Terminal with its first command and serves the pane-less composer reads', async () => {
    expect(session).not.toBeNull();
    const { base, token, instance } = session!;
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const q = encodeURIComponent(instance);

    // the draft's catalog/files are addressed by agent kind + folder; a terminal kind has no catalog
    const catalog = await fetch(`${base}${V3_API_PREFIX}/launch/catalog?instance=${q}&kind=claude-code&path=${encodeURIComponent('/tmp')}`, { headers: auth });
    expect(catalog.status).toBe(200);
    chatCatalogSchema.parse(await catalog.json());
    expect((await fetch(`${base}${V3_API_PREFIX}/launch/catalog?instance=${q}&kind=terminal&path=%2Ftmp`, { headers: auth })).status).toBe(400);
    const files = await fetch(`${base}${V3_API_PREFIX}/launch/files?instance=${q}&token=&path=${encodeURIComponent('/tmp')}`, { headers: auth });
    expect(files.status).toBe(200);
    chatFilesSchema.parse(await files.json());

    // a multi-line "command" never leaves the phone and is refused by the Host
    const refused = await fetch(`${base}${V3_API_PREFIX}/launch?instance=${q}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ requestId: 'req_e2e_multiline', path: '/tmp', kind: 'terminal', prompt: 'echo a\necho b' }),
    });
    expect(refused.status).toBe(400);

    // the first command is typed into the new shell and runs (its effect: a file the test then finds)
    const marker = `/tmp/solco_e2e_first_${Date.now()}`;
    const launched = await fetch(`${base}${V3_API_PREFIX}/launch?instance=${q}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ requestId: 'req_e2e_firstcmd', path: '/tmp', kind: 'terminal', prompt: `touch ${marker}` }),
    });
    expect(launched.status).toBe(200);
    const reply = launchResponseSchema.parse(await launched.json());
    expect(reply.promptPending).toBeUndefined();
    for (let i = 0; i < 40 && !existsSync(marker); i += 1) await new Promise((r) => setTimeout(r, 250));
    expect(existsSync(marker)).toBe(true);
    rmSync(marker, { force: true });
  }, 60_000);
});
