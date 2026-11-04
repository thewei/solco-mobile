import { describe, expect, it } from 'vitest';

import {
  PinMismatchError,
  PinnedTransportError,
  base64ToBytes,
  bytesToBase64,
  createPinnedTransport,
  type NativePinnedTransport,
  type SocketEvent,
} from '@/lib/pinned-transport';

const FP = 'a1cc1d2af9c5a03eefb30bfcc11c5bae5554e2cee2ff007c8cde90e0a096ad57';

function fakeNative() {
  const calls: unknown[][] = [];
  let emit: (event: SocketEvent) => void = () => {};
  let listeners = 0;
  const native: NativePinnedTransport & { next?: () => Promise<never> | Promise<unknown> } = {
    request: async (...args) => {
      calls.push(['request', ...args]);
      if (native.next) return native.next() as never;
      return { status: 200, headers: {}, body: '{}' };
    },
    openSocket: (...args) => void calls.push(['openSocket', ...args]),
    sendText: (...args) => void calls.push(['sendText', ...args]),
    sendBinary: (...args) => void calls.push(['sendBinary', ...args]),
    closeSocket: (...args) => void calls.push(['closeSocket', ...args]),
    addListener: (_event, listener) => {
      listeners += 1;
      emit = listener;
      return { remove() {} };
    },
  };
  return { native, calls, emit: (e: SocketEvent) => emit(e), listeners: () => listeners };
}

describe('base64', () => {
  it('round-trips bytes, including large and non-ASCII ones', () => {
    const small = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(small))).toEqual(small);
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(new TextEncoder().encode('你好'))).toBe('5L2g5aW9');
  });
});

describe('request', () => {
  it('passes positional arguments, a lowercase pin and defaults', async () => {
    const { native, calls } = fakeNative();
    const transport = createPinnedTransport(native);
    await transport.request({ url: 'https://10.0.0.2:7788/api/v3/bootstrap', fingerprint: FP.toUpperCase() });
    expect(calls[0]).toEqual(['request', 'https://10.0.0.2:7788/api/v3/bootstrap', 'GET', {}, null, FP, 15_000]);
  });

  it('refuses non-https and malformed pins without calling native', async () => {
    const { native, calls } = fakeNative();
    const transport = createPinnedTransport(native);
    await expect(transport.request({ url: 'http://10.0.0.2/', fingerprint: FP })).rejects.toMatchObject({ code: 'ERR_INVALID_ARGUMENT' });
    await expect(transport.request({ url: 'https://10.0.0.2/', fingerprint: 'abc' })).rejects.toMatchObject({ code: 'ERR_INVALID_ARGUMENT' });
    expect(calls).toEqual([]);
  });

  it('turns a native pin refusal into PinMismatchError and other failures into one error family', async () => {
    const { native } = fakeNative();
    const transport = createPinnedTransport(native);
    native.next = () => Promise.reject(Object.assign(new Error('x'), { code: 'ERR_PIN_MISMATCH' }));
    const pin = await transport.request({ url: 'https://h/', fingerprint: FP }).catch((e) => e);
    expect(pin).toBeInstanceOf(PinMismatchError);
    expect(pin).toBeInstanceOf(PinnedTransportError);
    native.next = () => Promise.reject(new Error('timeout'));
    const other = await transport.request({ url: 'https://h/', fingerprint: FP }).catch((e) => e);
    expect(other).toBeInstanceOf(PinnedTransportError);
    expect(other).not.toBeInstanceOf(PinMismatchError);
    expect(other).toMatchObject({ code: 'ERR_TRANSPORT', message: 'timeout' });
  });
});

describe('openSocket', () => {
  it('routes events by socket id, decodes binary frames and stops after close', () => {
    const { native, calls, emit } = fakeNative();
    const transport = createPinnedTransport(native);
    const log: string[] = [];
    const socket = transport.openSocket(
      { url: 'wss://h:1/api/v3/events', fingerprint: FP, protocols: ['solco.bearer', 'tok'] },
      {
        onOpen: () => log.push('open'),
        onText: (t) => log.push(`text:${t}`),
        onBinary: (b) => log.push(`binary:${Array.from(b).join(',')}`),
        onClose: (e) => log.push(`close:${e.code}`),
      },
    );
    expect(calls[0]).toEqual(['openSocket', 's1', 'wss://h:1/api/v3/events', ['solco.bearer', 'tok'], FP]);
    emit({ id: 's1', type: 'open' });
    emit({ id: 's1', type: 'text', data: 'hi' });
    emit({ id: 's1', type: 'binary', data: bytesToBase64(new Uint8Array([7, 8])) });
    emit({ id: 'other', type: 'text', data: 'not mine' });
    socket.sendText('a');
    socket.sendBinary(new Uint8Array([1]));
    socket.close(1000, 'bye');
    emit({ id: 's1', type: 'closed', code: 1000, reason: 'bye' });
    socket.sendText('after close');
    emit({ id: 's1', type: 'text', data: 'late' });
    expect(log).toEqual(['open', 'text:hi', 'binary:7,8', 'close:1000']);
    expect(calls.slice(1)).toEqual([
      ['sendText', 's1', 'a'],
      ['sendBinary', 's1', 'AQ=='],
      ['closeSocket', 's1', 1000, 'bye'],
    ]);
  });

  it('reports a failed socket as an error then an abnormal close; a pin refusal is typed', () => {
    const { native, emit } = fakeNative();
    const transport = createPinnedTransport(native);
    const log: unknown[] = [];
    transport.openSocket({ url: 'wss://h/x', fingerprint: FP }, {
      onError: (e) => log.push(e.constructor.name),
      onClose: (e) => log.push(e.code),
    });
    emit({ id: 's1', type: 'failed', message: 'bad cert', pinMismatch: true, status: 0 });
    expect(log).toEqual(['PinMismatchError', 1006]);
  });

  it('shares one native listener and gives each socket its own id', () => {
    const { native, calls, listeners } = fakeNative();
    const transport = createPinnedTransport(native);
    transport.openSocket({ url: 'wss://h/a', fingerprint: FP }, {});
    transport.openSocket({ url: 'wss://h/b', fingerprint: FP }, {});
    expect(listeners()).toBe(1);
    expect(calls.map((c) => c[1])).toEqual(['s1', 's2']);
  });

  it('refuses ws:// and bad pins synchronously', () => {
    const { native, calls } = fakeNative();
    const transport = createPinnedTransport(native);
    expect(() => transport.openSocket({ url: 'ws://h/', fingerprint: FP }, {})).toThrow(PinnedTransportError);
    expect(() => transport.openSocket({ url: 'wss://h/', fingerprint: '' }, {})).toThrow(PinnedTransportError);
    expect(calls).toEqual([]);
  });

  it('a native open failure leaves no routed handlers behind', () => {
    const { native, emit } = fakeNative();
    const transport = createPinnedTransport(native);
    native.openSocket = () => { throw Object.assign(new Error('boom'), { code: 'ERR_INVALID_ARGUMENT' }); };
    const log: string[] = [];
    expect(() => transport.openSocket({ url: 'wss://h/', fingerprint: FP }, { onText: (t) => log.push(t) })).toThrow(/boom/);
    emit({ id: 's1', type: 'text', data: 'x' });
    expect(log).toEqual([]);
  });
});
