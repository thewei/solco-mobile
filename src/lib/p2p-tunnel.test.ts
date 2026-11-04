import { afterEach, describe, expect, it, vi } from 'vitest';

import { base64Decode, base64Encode, createReassembler, fragmentFrame, utf8Decode, utf8Encode } from '@/lib/p2p-codec';
import { P2PTunnel, tunnelPath } from '@/lib/p2p-tunnel';

type Frame = Record<string, any>;

/** The Mac's end: reassembles what the phone sends, answers through the tunnel. */
function fakeMac() {
  const seen: Frame[] = [];
  let respond: (frame: Frame, reply: (f: Frame) => void) => void = () => undefined;
  const tunnel: P2PTunnel = new P2PTunnel((bytes) => macIn.push(bytes));
  const reply = (frame: Frame) => {
    for (const m of fragmentFrame(JSON.stringify(frame))) tunnel.receive(m);
  };
  const macIn = createReassembler((json) => {
    const frame = JSON.parse(json) as Frame;
    seen.push(frame);
    respond(frame, reply);
  });
  return { tunnel, seen, reply, onFrame: (fn: typeof respond) => (respond = fn) };
}

afterEach(() => vi.useRealTimers());

describe('tunnelPath', () => {
  it('keeps path and query, drops the origin', () => {
    expect(tunnelPath('https://host.p2p/api/v3/tree?instance=a')).toBe('/api/v3/tree?instance=a');
    expect(tunnelPath('wss://host.p2p/api/v3/events?token=t')).toBe('/api/v3/events?token=t');
    expect(tunnelPath('https://host.p2p')).toBe('/');
    expect(tunnelPath('/already/a/path')).toBe('/already/a/path');
  });
});

describe('P2PTunnel.request', () => {
  it('sends hreq with lower-cased headers and a base64 body, and assembles the answer', async () => {
    const mac = fakeMac();
    mac.onFrame((f, reply) => {
      if (f.t !== 'hreq') return;
      reply({ t: 'hres', id: f.id, status: 200, headers: {} });
      const body = utf8Encode('{"ok":"中文"}');
      reply({ t: 'hchunk', id: f.id, b: base64Encode(body.subarray(0, 4)) });
      reply({ t: 'hchunk', id: f.id, b: base64Encode(body.subarray(4)) });
      reply({ t: 'hend', id: f.id });
    });
    const response = await mac.tunnel.request({
      url: 'https://host.p2p/api/v3/bootstrap',
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{"a":"é"}',
    });
    expect(response).toEqual({ status: 200, headers: {}, body: '{"ok":"中文"}' });
    const sent = mac.seen[0]!;
    expect(sent).toMatchObject({ t: 'hreq', method: 'POST', path: '/api/v3/bootstrap', headers: { authorization: 'Bearer t', 'content-type': 'application/json' } });
    expect(utf8Decode(base64Decode(sent.b))).toBe('{"a":"é"}');
  });

  it('a request larger than one fragment arrives whole', async () => {
    const mac = fakeMac();
    mac.onFrame((f, reply) => {
      reply({ t: 'hres', id: f.id, status: 200, headers: {} });
      reply({ t: 'hend', id: f.id });
    });
    const big = 'x'.repeat(100_000);
    await mac.tunnel.request({ url: 'https://h/up', method: 'POST', body: big });
    expect(utf8Decode(base64Decode(mac.seen[0]!.b))).toBe(big);
  });

  it('herr rejects; a timeout cancels the request on the Mac', async () => {
    const failing = fakeMac();
    failing.onFrame((f, reply) => reply({ t: 'herr', id: f.id, message: 'upstream failed' }));
    await expect(failing.tunnel.request({ url: 'https://h/x' })).rejects.toThrow('upstream failed');

    vi.useFakeTimers();
    const silent = fakeMac();
    const pending = silent.tunnel.request({ url: 'https://h/x', timeoutMs: 500 });
    const assertion = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
    expect(silent.seen.map((f) => f.t)).toEqual(['hreq', 'hcancel']);
  });

  it('fail() rejects what is in flight and every later call', async () => {
    const mac = fakeMac();
    const inflight = mac.tunnel.request({ url: 'https://h/x' });
    mac.tunnel.fail(new Error('channel closed'));
    await expect(inflight).rejects.toThrow('channel closed');
    await expect(mac.tunnel.request({ url: 'https://h/y' })).rejects.toThrow('channel closed');
    expect(mac.tunnel.isFailed).toBe(true);
  });
});

describe('P2PTunnel.openSocket', () => {
  it('queues messages until wopened, then relays text and binary both ways', () => {
    const mac = fakeMac();
    const events: string[] = [];
    const socket = mac.tunnel.openSocket('wss://host.p2p/api/v3/events?token=t', {
      onOpen: () => events.push('open'),
      onText: (t) => events.push(`text:${t}`),
      onBinary: (b) => events.push(`bin:${Array.from(b).join(',')}`),
      onClose: (e) => events.push(`close:${e.code}`),
    });
    expect(mac.seen[0]).toMatchObject({ t: 'wopen', path: '/api/v3/events?token=t' });
    const id = mac.seen[0]!.id;
    socket.sendText('early'); // before wopened: held back
    expect(mac.seen).toHaveLength(1);
    mac.reply({ t: 'wopened', id });
    expect(mac.seen[1]).toMatchObject({ t: 'wmsg', id, s: 'early' });
    mac.reply({ t: 'wmsg', id, s: '{"hello":1}' });
    mac.reply({ t: 'wmsg', id, b: base64Encode(Uint8Array.from([1, 2, 3])) });
    socket.sendBinary(Uint8Array.from([9]));
    expect(mac.seen[2]).toMatchObject({ t: 'wmsg', id, b: base64Encode(Uint8Array.from([9])) });
    mac.reply({ t: 'wclose', id, code: 4404, reason: 'gone' });
    expect(events).toEqual(['open', 'text:{"hello":1}', 'bin:1,2,3', 'close:4404']);
  });

  it('an empty text message is still a message', () => {
    const mac = fakeMac();
    const texts: string[] = [];
    mac.tunnel.openSocket('wss://h/s', { onText: (t) => texts.push(t) });
    const id = mac.seen[0]!.id;
    mac.reply({ t: 'wopened', id });
    mac.reply({ t: 'wmsg', id, s: '' });
    expect(texts).toEqual(['']);
  });

  it('werr ends the socket with an error then 1006; the client close sends wclose and goes quiet', () => {
    const mac = fakeMac();
    const events: string[] = [];
    mac.tunnel.openSocket('wss://h/s', { onError: () => events.push('error'), onClose: (e) => events.push(`close:${e.code}`) });
    mac.reply({ t: 'werr', id: mac.seen[0]!.id, message: 'could not open' });
    expect(events).toEqual(['error', 'close:1006']);

    const quiet = fakeMac();
    const got: string[] = [];
    const socket = quiet.tunnel.openSocket('wss://h/s', { onClose: () => got.push('close') });
    const id = quiet.seen[0]!.id;
    quiet.reply({ t: 'wopened', id });
    socket.close(1000, 'bye');
    expect(quiet.seen.at(-1)).toMatchObject({ t: 'wclose', id, code: 1000, reason: 'bye' });
    quiet.reply({ t: 'wclose', id });
    expect(got).toEqual([]);
  });

  it('fail() ends open sockets abnormally', () => {
    const mac = fakeMac();
    const events: string[] = [];
    mac.tunnel.openSocket('wss://h/s', { onError: () => events.push('error'), onClose: (e) => events.push(`close:${e.code}`) });
    mac.tunnel.fail();
    expect(events).toEqual(['error', 'close:1006']);
  });
});
