// [INPUT]: a Host seam (`remoteDesktopSession`, optional ICE servers), a peer factory (lib/rd-native.ts in
//          the app, a fake in tests) and the control-channel frames the Mac sends.
// [OUTPUT]: `RdSession` — one Remote Desktop connection as an observable store (`subscribe` /
//           `getSnapshot`): status requesting → connecting → live → ended | failed, the Mac's session
//           state, stream URL, stats, round-trip time, notices and incoming clipboard text; plus the
//           Sender the gestures/keys drive, already routed to the right data channel.
// [POS]: The connection state machine of the phone's Remote Desktop. It owns the 2 s ping, the
//        silence watchdog (degraded after 5 s, link lost after 10 s with no pong) and the rule that a
//        View-only session never sends input. A link that dies after it was live is not a failure: the
//        session stays `live` with `reconnecting` set, the last picture stays frozen on screen, and new
//        offers are made on a short ladder (the Mac swaps in the new link of the same phone at once) until
//        the first control message returns and the picture resumes — or two minutes pass and it fails.
//        `nudge()` (network changed, app foregrounded) probes a live link or skips the wait. No React and
//        no react-native-webrtc here.
// [PROTOCOL]: 变更时更新此头部
import { HostV3Error } from '@/lib/host-client-v3';
import { RD_PROTOCOL, type P2PIceServer, type RdAnswer, type RdMode, type RdOffer, type RdSessionState, type RdStats, type RdTier } from '@/contracts/host-v3';
import { REFUSAL_COPY } from './quality';
import { ATTEMPT_TIMEOUT_MS, PROBE_MS, SIGNAL_TIMEOUT_MS, RECONNECT_TIER, RECONNECT_WINDOW_MS, RESTORE_AFTER_MS, reconnectDelay } from './reconnect';
import { createSender, parseMacMessage, encode, type Outgoing, type Sender } from './protocol';

export type RdStatus = 'idle' | 'requesting' | 'connecting' | 'live' | 'ended' | 'failed';
export type PeerState = 'connected' | 'disconnected' | 'failed' | 'closed';

export interface PeerEvents {
  onStream(streamURL: string): void;
  onControlOpen(): void;
  onControlClose(): void;
  onPointerOpen(): void;
  onControlText(text: string): void;
  onState(state: PeerState): void;
}
export interface RdPeer {
  /** A complete (non-trickle) offer: receive-only H.264 video plus the `control` and `pointer` channels. */
  createOffer(): Promise<string>;
  accept(answerSdp: string): Promise<void>;
  sendControl(text: string): boolean;
  sendPointer(text: string): boolean;
  close(): void;
}
export type RdPeerFactory = (iceServers: P2PIceServer[], events: PeerEvents) => RdPeer;

export interface RdHost {
  remoteDesktopSession(offer: RdOffer): Promise<RdAnswer>;
}

export interface RdSnapshot {
  status: RdStatus;
  /** What was granted (the Mac may downgrade Full to View). */
  mode: RdMode | null;
  state: RdSessionState | null;
  streamURL: string | null;
  stats: RdStats | null;
  rttMs: number | null;
  /** No pong for a while: the picture may be stale. */
  degraded: boolean;
  /** The link died after it was live: the picture is frozen while new links are tried (status stays `live`). */
  reconnecting: { attempt: number; /** why the previous attempt failed (a code, never text) */ last?: string } | null;
  error: { code: string; message: string } | null;
  /** A one-line transient remark (View only, capture failed …); cleared by the next one or `dismissNotice`. */
  notice: string | null;
  /** Bumped for each text the Mac's clipboard sent; `clipboardIn` is the latest. */
  clipboardIn: { text: string; n: number } | null;
}

export const PING_MS = 2_000;
export const DEGRADED_MS = 5_000;
export const DEAD_MS = 10_000;

const INITIAL: RdSnapshot = { status: 'idle', mode: null, state: null, streamURL: null, stats: null, rttMs: null, degraded: false, reconnecting: null, error: null, notice: null, clipboardIn: null };

/** Messages that still make sense without control (everything else would only earn a `view_only` error). */
const VIEW_SAFE = new Set(['ping', 'display.select', 'quality.set', 'keyframe.request', 'session.end', 'stats.request', 'clipboard.get']);

export interface RdSessionOptions {
  host: RdHost;
  createPeer: RdPeerFactory;
  /** STUN/TURN for off-LAN; absent on the LAN (host candidates suffice). */
  iceServers?: (attempt: number) => Promise<P2PIceServer[]>;
  now?: () => number;
  /** Phase names with codes and elapsed times only (never content); the app routes it to the device log. */
  trace?: (event: string) => void;
}

export class RdSession {
  private snap: RdSnapshot = INITIAL;
  private listeners = new Set<() => void>();
  private peer: RdPeer | null = null;
  private generation = 0;
  private controlOpen = false;
  private pointerOpen = false;
  private ping: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private clipboardN = 0;
  private resume: { mode: RdMode; tier?: RdTier; displayId?: string } | null = null;
  private lostAt = 0;
  private attemptN = 0;
  private attemptStarted = 0;
  /** The Mac answered this attempt's offer (the rest is ICE); a route change then leaves it alone. */
  private attemptAnswered = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingStream: string | null = null;
  private restoreTier: RdTier | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  /** Stable for the object's life; messages sent while not live are dropped. */
  readonly send: Sender;

  constructor(private readonly opts: RdSessionOptions) {
    this.now = opts.now ?? Date.now;
    this.send = createSender((out) => this.route(out), () => this.snap.state?.displayId);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): RdSnapshot => this.snap;

  /** Ask the Mac for a session. Resolves when signalling is done; `status` then follows the link. */
  async start(opts: { mode: RdMode; tier?: RdTier; displayId?: string }): Promise<void> {
    if (this.snap.status === 'requesting' || this.snap.status === 'connecting' || this.snap.status === 'live') return;
    const gen = ++this.generation;
    this.controlOpen = this.pointerOpen = false;
    this.resume = { mode: opts.mode, tier: opts.tier, displayId: opts.displayId };
    this.set({ ...INITIAL, status: 'requesting' });
    try {
      const answer = await this.negotiate(gen, this.resume);
      if (!answer) return;
      this.set({ status: 'connecting', mode: answer.state.mode, state: answer.state });
      await answer.peer.accept(answer.sdp);
    } catch (error) {
      if (gen !== this.generation) return;
      this.fail(error);
    }
  }

  /**
   * The phone's way to the Mac changed (the connection manager moved from the LAN to the relay): an attempt still
   * waiting for the Mac's answer was sent down the old way and is replaced at once. One the Mac answered is left alone.
   */
  routeChanged(): void {
    if (this.snap.status !== 'live' || !this.snap.reconnecting) return;
    this.opts.trace?.('route changed');
    if (!this.attemptAnswered && this.now() - this.attemptStarted > 300) void this.attempt();
    else if (this.retryTimer) void this.attempt();
  }

  /** The phone's network changed or the app came back: probe a live link, or skip the wait of a reconnect. */
  nudge(): void {
    if (this.snap.status !== 'live') return;
    this.opts.trace?.(this.snap.reconnecting ? 'nudge (reconnecting)' : 'nudge (live)');
    if (this.snap.reconnecting) {
      // an attempt that is already moving gets its chance; a stuck or waiting one is replaced now
      if (this.now() - this.attemptStarted > 2_000 || this.retryTimer) void this.attempt();
      return;
    }
    if (!this.controlOpen || this.probeTimer) return;
    const since = this.now();
    this.send.ping(since);
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.lastPong < since && this.snap.status === 'live' && !this.snap.reconnecting) this.lost();
    }, PROBE_MS);
  }

  private async negotiate(gen: number, params: { mode: RdMode; tier?: RdTier; displayId?: string }): Promise<{ peer: RdPeer; sdp: string; state: RdSessionState } | null> {
    const ice = this.opts.iceServers ? await this.opts.iceServers(this.attemptN).catch((): P2PIceServer[] => []) : [];
    if (gen !== this.generation) return null;
    const peer = this.opts.createPeer(ice, this.events(gen));
    this.peer = peer;
    const sdp = await peer.createOffer();
    if (this.snap.reconnecting) this.t(`offer ready ice=${ice.length}`);
    if (gen !== this.generation) return void peer.close(), null;
    const answer = await this.opts.host.remoteDesktopSession({ protocol: RD_PROTOCOL, sdp, mode: params.mode, tier: params.tier, displayId: params.displayId });
    if (gen !== this.generation) return void peer.close(), null;
    if (this.snap.reconnecting) this.t('answer');
    return { peer, sdp: answer.sdp, state: answer.state };
  }

  /** The user leaves: tell the Mac (it releases held input) and close. Also cancels a request in flight. */
  end(): void {
    if (this.snap.status === 'idle' || this.snap.status === 'ended' || this.snap.status === 'failed') return;
    this.send.sessionEnd();
    this.finish('ended', null);
  }

  /** Everything held on the Mac goes up (screen blurred, app backgrounded). */
  releaseAll(): void {
    this.send.releaseAll();
  }

  dismissNotice = (): void => {
    if (this.snap.notice) this.set({ notice: null });
  };

  /** Back to idle so a new `start` begins from a clean snapshot. */
  reset(): void {
    this.finish('idle', null);
  }

  // ---- internals ----

  private events(gen: number): PeerEvents {
    const live = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
      if (gen === this.generation) fn(...a);
    };
    return {
      onStream: live((streamURL) => {
        // while reconnecting the old picture stays until the new link is proven by its first control message
        if (this.snap.reconnecting) this.pendingStream = streamURL;
        else this.set({ streamURL });
      }),
      onControlOpen: live(() => {
        this.controlOpen = true;
        this.lastPong = this.now();
        if (this.snap.reconnecting) {
          this.t('resumed');
          this.clearAttemptTimers();
          this.set({ reconnecting: null, degraded: false, streamURL: this.pendingStream ?? this.snap.streamURL });
          this.pendingStream = null;
          this.scheduleRestore();
        }
        if (this.snap.status === 'connecting' || this.snap.status === 'requesting') this.set({ status: 'live' });
        this.startPing();
        this.send.keyframeRequest();
        this.send.statsRequest(); // the first reading names the path (direct / P2P / relay)
      }),
      onControlClose: live(() => {
        this.controlOpen = false;
        if (this.snap.status === 'live' || this.snap.status === 'connecting') this.lost();
      }),
      onPointerOpen: live(() => {
        this.pointerOpen = true;
      }),
      onControlText: live((text) => this.onMac(text)),
      onState: live((state) => {
        if (state === 'connected') this.set({ degraded: false });
        else if (state === 'disconnected') this.set({ degraded: true });
        else if (this.snap.status === 'live' || this.snap.status === 'connecting') this.lost();
      }),
    };
  }

  private route(out: Outgoing): void {
    if (!this.controlOpen || !this.peer) return;
    if (this.snap.mode !== 'full' && !VIEW_SAFE.has(out.message.type)) return;
    if (out.message.type === 'quality.set') {
      this.restoreTier = null; // the user chose: nothing to restore
      this.clearRestore();
    }
    const text = encode(out.message);
    if (out.channel === 'pointer' && this.pointerOpen) {
      if (this.peer.sendPointer(text)) return;
    }
    this.peer.sendControl(text);
  }

  private onMac(text: string): void {
    const m = parseMacMessage(text);
    if (!m) return;
    switch (m.type) {
      case 'session.state': {
        const { type: _type, ...state } = m;
        void _type;
        this.set({ state, mode: state.mode });
        break;
      }
      case 'pong':
        this.lastPong = this.now();
        this.set({ rttMs: Math.max(0, this.now() - m.t), degraded: false });
        break;
      case 'stats':
        this.set({ stats: m });
        break;
      case 'clipboard.text':
        this.set({ clipboardIn: { text: m.text, n: ++this.clipboardN } });
        break;
      case 'error':
        if (m.code === 'session_ended') this.finish('ended', null);
        else if (m.code === 'view_only') this.set({ notice: 'View only — the Mac did not allow control.' });
        else if (m.code === 'capture_failed') this.set({ notice: 'The Mac could not capture its screen right now.' });
        else this.set({ notice: m.message ?? REFUSAL_COPY[m.code] ?? 'The Mac reported an error.' });
        break;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.ping = setInterval(() => {
      const silent = this.now() - this.lastPong;
      if (silent > DEAD_MS) return this.lost();
      if (silent > DEGRADED_MS && !this.snap.degraded) this.set({ degraded: true });
      this.send.ping(this.now());
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }

  private fail(error: unknown): void {
    let code = 'internal';
    let message = 'The connection failed.';
    if (error instanceof HostV3Error) {
      code = error.code ?? (error.kind === 'transport' ? 'unreachable' : 'internal');
      message = (error.code && REFUSAL_COPY[error.code]) || (error.kind === 'transport' ? 'The Mac did not answer. Check that it is awake and on the same network.' : message);
    } else if (error instanceof Error && error.message === 'connection_lost') {
      code = 'connection_lost';
      message = 'The connection to the Mac was lost.';
    }
    this.finish('failed', { code, message });
  }

  /**
   * The link is gone. Before it was ever live that is a failure; after, the picture is kept frozen and new
   * links are tried (a stopped Mac, a changed network and a sleeping phone all look like this).
   */
  private lost(): void {
    if (this.snap.reconnecting) return; // an attempt's own failure is handled by the attempt
    if (this.snap.status !== 'live' || !this.resume) return this.fail(new Error('connection_lost'));
    this.generation++; // late events from the dead peer are ignored
    this.stopPing();
    this.clearProbe();
    this.controlOpen = this.pointerOpen = false;
    this.dropPeer();
    this.lostAt = this.now();
    this.attemptN = 0;
    this.clearRestore();
    this.restoreTier = this.snap.state?.tier ?? this.resume.tier ?? null;
    this.set({ reconnecting: { attempt: 0 }, degraded: false });
    this.t('lost');
    void this.attempt(0);
  }

  /** One try at a new link; the wait before the next one is the ladder's. */
  private t(event: string): void {
    const at = this.lostAt ? this.now() - this.lostAt : 0;
    this.opts.trace?.(`${event} +${at}ms`);
  }

  private async attempt(wait = 0): Promise<void> {
    const params = this.resume;
    if (!params || this.snap.status !== 'live') return;
    this.clearAttemptTimers();
    if (this.now() - this.lostAt > RECONNECT_WINDOW_MS) return this.fail(new Error('connection_lost'));
    if (wait > 0) {
      this.retryTimer = setTimeout(() => void this.attempt(), wait);
      return;
    }
    const gen = ++this.generation;
    this.dropPeer();
    this.attemptStarted = this.now();
    this.attemptN += 1;
    this.pendingStream = null;
    this.set({ reconnecting: { attempt: this.attemptN, last: this.snap.reconnecting?.last } });
    this.t(`attempt ${this.attemptN}`);
    this.attemptAnswered = false;
    this.armAttemptTimer(gen, SIGNAL_TIMEOUT_MS);
    try {
      // a fresh link starts light so it comes up first; the chosen tier returns once it has held
      const answer = await this.negotiate(gen, { ...params, tier: RECONNECT_TIER });
      if (!answer) return;
      this.attemptAnswered = true;
      this.armAttemptTimer(gen, ATTEMPT_TIMEOUT_MS); // signalling is done: ICE gets the longer allowance
      this.set({ mode: answer.state.mode, state: answer.state });
      await answer.peer.accept(answer.sdp);
    } catch (error) {
      this.attemptFailed(gen, error);
    }
  }

  private armAttemptTimer(gen: number, ms: number): void {
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = setTimeout(() => this.attemptFailed(gen, new Error('connection_lost')), ms);
  }

  private attemptFailed(gen: number, error: unknown): void {
    if (gen !== this.generation || !this.snap.reconnecting) return;
    this.generation++;
    this.clearAttemptTimers();
    this.dropPeer();
    // only the Mac's own refusal code can stop an outage; a relay hiccup, a timeout or a bug is a bad moment
    const code = error instanceof HostV3Error && error.code ? error.code : 'unreachable';
    this.t(`attempt ${this.attemptN} failed ${code}`);
    this.set({ reconnecting: { attempt: this.attemptN, last: code } });
    const delay = reconnectDelay(this.attemptN - 1, code);
    if (delay === null) return this.fail(error); // a refusal is the Mac's answer: stop and say so
    this.retryTimer = setTimeout(() => void this.attempt(), delay);
  }

  private dropPeer(): void {
    const peer = this.peer;
    this.peer = null;
    try {
      peer?.close();
    } catch {
      // already closed
    }
  }

  private clearAttemptTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.retryTimer = this.attemptTimer = null;
  }

  /** Back to the tier the user had, once the light link has held for a few seconds. */
  private scheduleRestore(): void {
    const want = this.restoreTier;
    this.clearRestore();
    if (!want || want === RECONNECT_TIER) return;
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      if (this.snap.status === 'live' && !this.snap.reconnecting && this.snap.state?.tier !== want) this.send.qualitySet(want);
    }, RESTORE_AFTER_MS);
  }

  private clearRestore(): void {
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
  }

  private clearProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }

  private finish(status: RdStatus, error: RdSnapshot['error']): void {
    this.generation++; // late events from the old peer are ignored
    this.stopPing();
    this.clearAttemptTimers();
    this.clearProbe();
    this.clearRestore();
    this.restoreTier = null;
    this.pendingStream = null;
    this.resume = null;
    this.controlOpen = this.pointerOpen = false;
    const peer = this.peer;
    this.peer = null;
    // close after the snapshot is set so listeners see the end state first
    this.set(status === 'idle' ? { ...INITIAL } : { ...INITIAL, status, error, mode: this.snap.mode, state: this.snap.state, clipboardIn: this.snap.clipboardIn });
    try {
      peer?.close();
    } catch {
      // already closed
    }
  }

  private set(patch: Partial<RdSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }
}
