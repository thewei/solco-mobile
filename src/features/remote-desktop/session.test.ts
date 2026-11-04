import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rdAnswerSchema } from '@/contracts/host-v3';
import { HostV3Error } from '@/lib/host-client-v3';
import { PROBE_MS, RESTORE_AFTER_MS, SIGNAL_TIMEOUT_MS } from './reconnect';
import { DEAD_MS, DEGRADED_MS, PING_MS, RdSession, type PeerEvents, type RdPeer } from './session';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'contracts', '__fixtures__', 'v3', name), 'utf8');
const answer = rdAnswerSchema.parse(JSON.parse(fixture('remote-desktop-answer.json')));
const viewAnswer = { ...answer, state: { ...answer.state, mode: 'view' as const } };

class FakePeer implements RdPeer {
  control: string[] = [];
  pointer: string[] = [];
  closed = false;
  accepted: string | null = null;
  constructor(readonly events: PeerEvents) {}
  async createOffer() {
    return 'offer-sdp';
  }
  async accept(sdp: string) {
    this.accepted = sdp;
  }
  sendControl(t: string) {
    this.control.push(t);
    return true;
  }
  sendPointer(t: string) {
    this.pointer.push(t);
    return true;
  }
  close() {
    this.closed = true;
  }
  types(list: string[]) {
    return list.map((t) => (JSON.parse(t) as { type: string }).type);
  }
}

function rig(host?: Partial<{ remoteDesktopSession: (o: unknown) => Promise<typeof answer> }>) {
  let peer!: FakePeer;
  let t = 1_000_000;
  const session = new RdSession({
    host: { remoteDesktopSession: host?.remoteDesktopSession ?? (async () => answer) } as never,
    createPeer: (_ice, events) => (peer = new FakePeer(events)),
    now: () => t,
  });
  const go = async (mode: 'full' | 'view' = 'full') => {
    await session.start({ mode });
    return peer;
  };
  return { session, go, peer: () => peer, advance: (ms: number) => { t += ms; vi.advanceTimersByTime(ms); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('RdSession lifecycle', () => {
  it('requests → connecting with the Mac’s state → live once the control channel opens', async () => {
    const offers: unknown[] = [];
    const r = rig({ remoteDesktopSession: async (o) => (offers.push(o), answer) });
    const seen: string[] = [];
    r.session.subscribe(() => seen.push(r.session.getSnapshot().status));
    const peer = await r.go();
    expect(offers[0]).toMatchObject({ protocol: 1, sdp: 'offer-sdp', mode: 'full' });
    expect(peer.accepted).toBe(answer.sdp);
    expect(r.session.getSnapshot()).toMatchObject({ status: 'connecting', mode: 'full' });
    peer.events.onStream('stream://1');
    peer.events.onControlOpen();
    expect(r.session.getSnapshot()).toMatchObject({ status: 'live', streamURL: 'stream://1' });
    expect(seen).toContain('requesting');
    // asks for a keyframe and a first stats reading (the path name) the moment it can talk
    expect(peer.types(peer.control)).toEqual(['keyframe.request', 'stats.request']);
  });

  it('a refusal becomes a failed snapshot with human copy and closes the peer', async () => {
    const r = rig({ remoteDesktopSession: async () => Promise.reject(new HostV3Error('http', 'denied', { status: 403, code: 'denied' })) });
    const peer = await r.go();
    expect(r.session.getSnapshot()).toMatchObject({ status: 'failed', error: { code: 'denied', message: 'The person at the Mac declined.' } });
    expect(peer.closed).toBe(true);
  });

  it('an unreachable Mac says so', async () => {
    const r = rig({ remoteDesktopSession: async () => Promise.reject(new HostV3Error('transport', 'timeout')) });
    await r.go();
    expect(r.session.getSnapshot().error?.code).toBe('unreachable');
  });

  it('ending tells the Mac, closes, and ignores late peer events', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.control.length = 0;
    r.session.end();
    expect(peer.types(peer.control)).toEqual(['session.end']);
    expect(peer.closed).toBe(true);
    expect(r.session.getSnapshot().status).toBe('ended');
    peer.events.onState('failed');
    expect(r.session.getSnapshot().status).toBe('ended');
  });

  it('cancelling while the Mac is still deciding closes the late peer', async () => {
    let release!: (a: typeof answer) => void;
    const r = rig({ remoteDesktopSession: () => new Promise((res) => (release = res)) });
    const started = r.session.start({ mode: 'full' });
    await Promise.resolve();
    await Promise.resolve();
    r.session.end();
    release(answer);
    await started;
    expect(r.peer().closed).toBe(true);
    expect(r.session.getSnapshot().status).toBe('ended');
  });

  it('a link lost before it was ever live fails; the Mac ending a live one ends it', async () => {
    const a = rig();
    const pa = await a.go();
    pa.events.onState('failed');
    expect(a.session.getSnapshot()).toMatchObject({ status: 'failed', error: { code: 'connection_lost' } });

    const b = rig();
    const pb = await b.go();
    pb.events.onControlOpen();
    pb.events.onControlText(fixture('remote-desktop-ctl-error.json').replace(/"code": "[a-z_]+"/, '"code": "session_ended"'));
    expect(b.session.getSnapshot().status).toBe('ended');
    expect(pb.closed).toBe(true);
  });

  it('can be started again after it ended', async () => {
    const r = rig();
    const p1 = await r.go();
    p1.events.onControlOpen();
    r.session.end();
    const p2 = await r.go();
    expect(p2).not.toBe(p1);
    expect(r.session.getSnapshot().status).toBe('connecting');
  });
});

describe('RdSession control channel', () => {
  it('routes moves to the unreliable channel and everything else to the reliable one', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.events.onPointerOpen();
    peer.control.length = 0;
    r.session.send.pointerMove({ x: 0.2, y: 0.3 });
    r.session.send.pointerButton({ x: 0.2, y: 0.3 }, 'left', true);
    r.session.send.textInsert('你好');
    expect(peer.types(peer.pointer)).toEqual(['pointer.move']);
    expect(peer.types(peer.control)).toEqual(['pointer.button', 'text.insert']);
    expect(JSON.parse(peer.pointer[0]!)).toMatchObject({ displayId: answer.state.displayId });
  });

  it('falls back to the control channel when the pointer channel is not open', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.control.length = 0;
    r.session.send.pointerMove({ x: 0, y: 0 });
    expect(peer.types(peer.control)).toEqual(['pointer.move']);
  });

  it('sends nothing before the channel is open', async () => {
    const r = rig();
    const peer = await r.go();
    r.session.send.tapKey('Enter');
    expect(peer.control).toEqual([]);
  });

  it('a View-only grant never sends input, but still takes quality and display requests', async () => {
    const r = rig({ remoteDesktopSession: async () => viewAnswer });
    const peer = await r.go('full'); // asked for control, granted view
    expect(r.session.getSnapshot().mode).toBe('view');
    peer.events.onControlOpen();
    peer.control.length = 0;
    r.session.send.pointerButton({ x: 0, y: 0 }, 'left', true);
    r.session.send.tapKey('Enter');
    r.session.send.textInsert('x');
    r.session.send.clipboardSet('x');
    r.session.send.qualitySet('high');
    r.session.send.displaySelect('2');
    expect(peer.types(peer.control)).toEqual(['quality.set', 'display.select']);
  });

  it('takes the Mac’s state, stats, clipboard and rtt from the goldens', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.events.onControlText(fixture('remote-desktop-ctl-stats.json'));
    peer.events.onControlText(fixture('remote-desktop-ctl-clipboard-text.json'));
    peer.events.onControlText(fixture('remote-desktop-ctl-session-state.json'));
    peer.events.onControlText('garbage');
    const snap = r.session.getSnapshot();
    expect(snap.stats?.type).toBe('stats');
    expect(snap.clipboardIn).toMatchObject({ n: 1 });
    expect(snap.state?.displays.length).toBeGreaterThan(0);
    peer.events.onControlText(JSON.stringify({ type: 'pong', t: 1_000_000 - 40 }));
    expect(r.session.getSnapshot().rttMs).toBe(40);
  });

  it('shows the Mac’s View-only refusal as a notice', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.events.onControlText(JSON.stringify({ type: 'error', code: 'view_only' }));
    expect(r.session.getSnapshot().notice).toMatch(/View only/);
    r.session.dismissNotice();
    expect(r.session.getSnapshot().notice).toBeNull();
  });
});

describe('RdSession watchdog', () => {
  it('pings every 2 s; silence degrades at 5 s and fails at 10 s; a pong heals', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.control.length = 0;
    r.advance(PING_MS);
    expect(peer.types(peer.control)).toEqual(['ping']);
    r.advance(PING_MS * 2); // 6 s silent
    expect(r.session.getSnapshot().degraded).toBe(true);
    expect(DEGRADED_MS).toBeLessThan(6_000);
    peer.events.onControlText(JSON.stringify({ type: 'pong', t: 1 }));
    expect(r.session.getSnapshot().degraded).toBe(false);
    for (let i = 0; i < DEAD_MS / PING_MS + 1; i++) r.advance(PING_MS);
    expect(r.session.getSnapshot()).toMatchObject({ status: 'live', reconnecting: { attempt: 1 } });
    expect(peer.closed).toBe(true);
  });

  it('a transient `disconnected` marks degraded and `connected` clears it', async () => {
    const r = rig();
    const peer = await r.go();
    peer.events.onControlOpen();
    peer.events.onState('disconnected');
    expect(r.session.getSnapshot().degraded).toBe(true);
    peer.events.onState('connected');
    expect(r.session.getSnapshot().degraded).toBe(false);
  });
});

describe('RdSession seamless reconnect', () => {
  const live = async (r: ReturnType<typeof rig>) => {
    const peer = await r.go();
    peer.events.onStream('stream-1');
    peer.events.onControlOpen();
    return peer;
  };
  const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  it('a lost link keeps the session live and the picture frozen while a new link is made, then resumes', async () => {
    const r = rig();
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    const snap = r.session.getSnapshot();
    expect(snap).toMatchObject({ status: 'live', streamURL: 'stream-1', reconnecting: { attempt: 1 } });
    expect(first.closed).toBe(true);
    const second = r.peer();
    expect(second).not.toBe(first);
    expect(second.accepted).toBe(answer.sdp);
    second.events.onStream('stream-2');
    expect(r.session.getSnapshot().streamURL).toBe('stream-1'); // still the frozen frame until the link is proven
    second.events.onControlOpen();
    expect(r.session.getSnapshot()).toMatchObject({ status: 'live', streamURL: 'stream-2', reconnecting: null, degraded: false });
    expect(second.types(second.control)).toContain('keyframe.request');
    first.events.onState('failed'); // the dead peer's late events are ignored
    expect(r.session.getSnapshot().reconnecting).toBeNull();
  });

  it('reconnects on the lightest tier, then returns to the chosen one once the link has held', async () => {
    const offers: { tier?: string }[] = [];
    const light = { ...answer, state: { ...answer.state, tier: 'smooth' as const } };
    const r = rig({ remoteDesktopSession: async (o) => (offers.push(o as { tier?: string }), offers.length === 1 ? answer : light) });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    expect(offers[1]?.tier).toBe('smooth');
    const second = r.peer();
    second.events.onControlOpen();
    second.control.length = 0;
    r.advance(RESTORE_AFTER_MS - 1);
    expect(second.types(second.control)).not.toContain('quality.set');
    r.advance(1);
    expect(second.control.map((t) => JSON.parse(t) as { type: string; tier?: string }).find((m) => m.type === 'quality.set')).toMatchObject({ tier: answer.state.tier });
  });

  it('a tier the user picks on the light link is not overridden', async () => {
    const light = { ...answer, state: { ...answer.state, tier: 'smooth' as const } };
    let n = 0;
    const r = rig({ remoteDesktopSession: async () => (n++ === 0 ? answer : light) });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    const second = r.peer();
    second.events.onControlOpen();
    r.session.send.qualitySet('smooth');
    second.control.length = 0;
    r.advance(RESTORE_AFTER_MS + 1);
    expect(second.types(second.control)).not.toContain('quality.set');
  });

  it('retries on a ladder when an attempt fails, and a refusal ends it with the Mac\'s words', async () => {
    let calls = 0;
    const r = rig({
      remoteDesktopSession: async () => {
        calls += 1;
        if (calls === 2) throw new HostV3Error('transport', 'offline');
        if (calls === 3) throw new HostV3Error('http', 'no', { status: 403, code: 'denied' });
        return answer;
      },
    });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    expect(calls).toBe(2); // attempt 1 answered (calls 1 was the start), attempt 1 → call 2 fails
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 1 });
    r.advance(500);
    await flush();
    expect(calls).toBe(3);
    expect(r.session.getSnapshot()).toMatchObject({ status: 'failed', error: { code: 'denied' } });
  });

  it('a relay hiccup or a capture restart on the Mac is a bad moment, not the end', async () => {
    let calls = 0;
    const r = rig({
      remoteDesktopSession: async () => {
        calls += 1;
        if (calls === 2) throw new HostV3Error('http', 'bad gateway', { status: 502 });
        if (calls === 3) throw new HostV3Error('http', 'busy starting', { status: 500, code: 'internal' });
        return answer;
      },
    });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 1, last: 'unreachable' });
    r.advance(300);
    await flush();
    expect(r.session.getSnapshot()).toMatchObject({ status: 'live', reconnecting: { attempt: 2, last: 'internal' } });
    r.advance(700);
    await flush();
    r.peer().events.onControlOpen();
    expect(r.session.getSnapshot()).toMatchObject({ status: 'live', reconnecting: null });
  });

  it('gives up after two minutes of trying', async () => {
    const r = rig({ remoteDesktopSession: (() => { let n = 0; return async () => { if (n++ === 0) return answer; throw new HostV3Error('transport', 'offline'); }; })() });
    const first = await live(r);
    first.events.onState('failed');
    for (let i = 0; i < 40; i++) {
      await flush();
      r.advance(8_000);
    }
    await flush();
    expect(r.session.getSnapshot()).toMatchObject({ status: 'failed', error: { code: 'connection_lost' } });
  });

  it('an attempt that never completes is replaced after its timeout', async () => {
    let n = 0;
    const r = rig({ remoteDesktopSession: () => (n++ === 0 ? Promise.resolve(answer) : new Promise(() => {})) });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    const stuck = r.peer();
    r.advance(SIGNAL_TIMEOUT_MS); // the Mac never answers the offer
    await flush();
    expect(stuck.closed).toBe(true);
    r.advance(500);
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 2 });
  });

  it('an offer the Mac has not answered in 5 s is replaced; an answered one gets the longer ICE allowance', async () => {
    let n = 0;
    const r = rig({ remoteDesktopSession: () => (n++ === 0 ? Promise.resolve(answer) : n === 2 ? new Promise(() => {}) : Promise.resolve(answer)) });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 1 });
    r.advance(SIGNAL_TIMEOUT_MS - 1);
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 1 });
    r.advance(1); // no answer: next attempt after the first ladder step
    await flush();
    r.advance(300);
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 2 });
    // attempt 2 was answered: it is not cut at 5 s
    r.advance(SIGNAL_TIMEOUT_MS + 1_000);
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 2 });
  });

  it('a route change replaces an attempt still waiting on the old way, never one the Mac answered', async () => {
    let n = 0;
    const r = rig({ remoteDesktopSession: () => (n++ === 0 ? Promise.resolve(answer) : n === 2 ? new Promise(() => {}) : Promise.resolve(answer)) });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    r.session.routeChanged(); // too fresh: it was just sent
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 1 });
    r.advance(400);
    r.session.routeChanged(); // sent down the dead LAN: replaced now
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 2 });
    expect(r.peer().accepted).toBe(answer.sdp);
    r.advance(400);
    r.session.routeChanged(); // answered, ICE under way: left alone
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 2 });
  });

  it('a network change probes a live link: an answer keeps it, silence starts the reconnect', async () => {
    const r = rig();
    const peer = await live(r);
    peer.control.length = 0;
    r.session.nudge();
    expect(peer.types(peer.control)).toEqual(['ping']);
    peer.events.onControlText(JSON.stringify({ type: 'pong', t: 1 }));
    r.advance(PROBE_MS);
    expect(r.session.getSnapshot().reconnecting).toBeNull();

    r.session.nudge();
    r.advance(PROBE_MS);
    await flush();
    expect(r.session.getSnapshot().reconnecting).toMatchObject({ attempt: 1 });
  });

  it('a nudge while waiting skips the wait; ending stops everything', async () => {
    let n = 0;
    const r = rig({ remoteDesktopSession: async () => { if (n++ === 0) return answer; throw new HostV3Error('transport', 'offline'); } });
    const first = await live(r);
    first.events.onState('failed');
    await flush();
    expect(n).toBe(2);
    r.session.nudge(); // the 0.5 s wait is skipped
    await flush();
    expect(n).toBe(3);
    r.session.end();
    expect(r.session.getSnapshot().status).toBe('ended');
    r.advance(60_000);
    await flush();
    expect(n).toBe(3);
  });
});
