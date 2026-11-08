import { describe, expect, it } from 'vitest';

import { CHAT_PAGE_HTML } from '@/generated/chat-page';

import { deliverScript, draftSeed, errorMessage, eventMessage, MYGO_SHIM, parsePageCall, resultMessage, withShim } from './protocol';

describe('parsePageCall', () => {
  it('accepts a well-formed call', () => {
    expect(parsePageCall('{"k":"call","id":3,"method":"chat.Send","args":["hi"]}')).toEqual({ id: 3, method: 'chat.Send', args: ['hi'] });
  });
  it.each(['', 'nope', '[]', '{"k":"call"}', '{"k":"call","id":"1","method":"x","args":[]}', '{"k":"call","id":1,"method":"x"}', '{"k":"event","id":1,"method":"x","args":[]}'])(
    'drops %j',
    (raw) => expect(parsePageCall(raw)).toBeNull(),
  );
});

describe('deliverScript', () => {
  it('survives quotes, newlines and line separators in the payload', () => {
    const payload = { text: 'a"b\n\u2028c\\d</script>' };
    const script = deliverScript(eventMessage('chat:updated', payload));
    const literal = script.slice('window.__solcoDeliver('.length, script.indexOf(');true;'));
    expect(JSON.parse(JSON.parse(literal))).toEqual({ k: 'event', name: 'chat:updated', payload });
  });
});

describe('the shim', () => {
  // Run the real shim in a stub window: calls post out, results and events come back in.
  function boot() {
    const sent: string[] = [];
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const win: Record<string, unknown> = {
      ReactNativeWebView: { postMessage: (s: string) => sent.push(s) },
      addEventListener: (type: string, f: (e: unknown) => void) => (listeners[type] ??= []).push(f),
    };
    new Function('window', MYGO_SHIM)(win);
    return { win, sent, mygo: win.mygo as { call(m: string, ...a: unknown[]): Promise<unknown>; on(n: string, f: (x: unknown) => void): () => void }, deliver: win.__solcoDeliver as (m: unknown) => void };
  }

  it('posts a call and resolves with its result', async () => {
    const { mygo, sent, deliver } = boot();
    const pending = mygo.call('chat.Send', 'hi');
    const call = parsePageCall(sent[0] ?? '');
    expect(call).toEqual({ id: 1, method: 'chat.Send', args: ['hi'] });
    deliver(JSON.stringify(resultMessage(call!.id, { ok: 1 })));
    await expect(pending).resolves.toEqual({ ok: 1 });
  });

  it('rejects with a CallError carrying the sentence', async () => {
    const { mygo, deliver } = boot();
    const pending = mygo.call('chat.Send', 'x');
    deliver(errorMessage(1, 'The agent is working.'));
    await expect(pending).rejects.toMatchObject({ name: 'CallError', message: 'The agent is working.' });
  });

  it('delivers events to every listener until it unsubscribes', () => {
    const { mygo, deliver } = boot();
    const got: unknown[] = [];
    const off = mygo.on('chat:updated', (x) => got.push(x));
    deliver(eventMessage('chat:updated', 1));
    off();
    deliver(eventMessage('chat:updated', 2));
    expect(got).toEqual([1]);
  });

  it('ignores a malformed delivery', () => {
    const { deliver } = boot();
    expect(() => deliver('not json')).not.toThrow();
    expect(() => deliver(null)).not.toThrow();
  });
});

describe('withShim', () => {
  it('puts the shim ahead of every other script of the real page', () => {
    const html = withShim(CHAT_PAGE_HTML);
    const shim = html.indexOf(MYGO_SHIM);
    expect(shim).toBeGreaterThan(0);
    expect(html.indexOf('<script', html.indexOf('<head>'))).toBe(shim - '<script>'.length);
    expect(html.indexOf('type="module"')).toBeGreaterThan(shim);
  });
  it('still carries one when there is no head', () => {
    expect(withShim('<p>x</p>', 'S')).toBe('<script>S</script><p>x</p>');
  });
});

describe('draftSeed', () => {
  it('is empty without a draft', () => expect(draftSeed('p', '')).toBe(''));
  it('writes the draft under the page’s own key unless one is already there', () => {
    const store = new Map<string, string>();
    const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    new Function('localStorage', draftSeed('w1:p1', 'say "hi"\n'))(localStorage);
    expect(store.get('solco:chat-draft:w1:p1')).toBe('say "hi"\n');
    new Function('localStorage', draftSeed('w1:p1', 'other'))(localStorage);
    expect(store.get('solco:chat-draft:w1:p1')).toBe('say "hi"\n');
  });
});

describe('the generated page', () => {
  it('is the file the sync script wrote (not hand-edited)', async () => {
    const { createHash } = await import('node:crypto');
    const { CHAT_PAGE_SHA256 } = await import('@/generated/chat-page');
    expect(createHash('sha256').update(CHAT_PAGE_HTML).digest('hex')).toBe(CHAT_PAGE_SHA256);
  });
});
