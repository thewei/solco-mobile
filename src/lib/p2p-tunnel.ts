// [INPUT]: a `send(bytes)` that writes one DataChannel message, and p2p-codec.
// [OUTPUT]: P2PTunnel → { receive, request, openSocket, fail }; `request`/`openSocket` mirror the
//           shapes the other two routes expose (PinnedResponse / PinnedSocket).
// [POS]: The phone's half of the Mac's tunnel (solco internal/remotehost `tunnel`): it plays the role the
//        relay plays for a relayed phone — it sends hreq/wopen/wmsg/wclose/hcancel frames and reads
//        hres/hchunk/hend/herr and wopened/werr/wmsg/wclose — so one host client serves direct, relay
//        and P2P unchanged. No WebRTC import: the channel is injected, tests drive it with a fake Mac.
//        Every request still carries the device token (Authorization header; WebSocket query), because
//        the Mac's handler guards each one — an open channel is not a credential.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { base64Decode, base64Encode, createReassembler, fragmentFrame, utf8Decode, utf8Encode } from '@/lib/p2p-codec';
import {
  PinnedTransportError,
  type PinnedResponse,
  type PinnedSocket,
  type PinnedSocketHandlers,
} from '@/lib/pinned-transport';

export const P2P_REQUEST_TIMEOUT_MS = 15_000;

export interface P2PRequestInit {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

interface Frame {
  t: string;
  id?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  b?: string;
  s?: string;
  status?: number;
  message?: string;
  code?: number;
  reason?: string;
}

interface PendingRequest {
  status: number;
  chunks: Uint8Array[];
  resolve(response: PinnedResponse): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface OpenSocket {
  handlers: PinnedSocketHandlers;
  opened: boolean;
  queue: Frame[];
}

/** `https://host/api/v3/x?y=1` → `/api/v3/x?y=1`: the Mac's tunnel takes a path, never an origin. */
export function tunnelPath(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(.*)$/i.exec(url);
  const rest = match ? match[1]! : url;
  return rest === '' || rest.startsWith('?') ? `/${rest}` : rest;
}

export class P2PTunnel {
  private nextId = 1;
  private failed: Error | null = null;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly sockets = new Map<string, OpenSocket>();
  private readonly reassembler = createReassembler((json) => this.onFrame(json));

  constructor(private readonly sendMessage: (bytes: Uint8Array) => void) {}

  /** Feed one DataChannel message. */
  receive(message: Uint8Array): void {
    try {
      this.reassembler.push(message);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('p2p receive failed'));
    }
  }

  request(init: P2PRequestInit): Promise<PinnedResponse> {
    if (this.failed) return Promise.reject(this.failed);
    const id = `h${this.nextId++}`;
    return new Promise<PinnedResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        this.write({ t: 'hcancel', id });
        reject(new Error('timed out'));
      }, init.timeoutMs ?? P2P_REQUEST_TIMEOUT_MS);
      this.requests.set(id, { status: 0, chunks: [], resolve, reject, timer });
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(init.headers ?? {})) headers[key.toLowerCase()] = value;
      const frame: Frame = { t: 'hreq', id, method: init.method ?? 'GET', path: tunnelPath(init.url), headers };
      if (init.body !== undefined && init.body !== '') frame.b = base64Encode(utf8Encode(init.body));
      try {
        this.write(frame);
      } catch (error) {
        clearTimeout(timer);
        this.requests.delete(id);
        reject(error instanceof Error ? error : new Error('p2p send failed'));
      }
    });
  }

  openSocket(url: string, handlers: PinnedSocketHandlers): PinnedSocket {
    const id = `w${this.nextId++}`;
    const socket: OpenSocket = { handlers, opened: false, queue: [] };
    let closed = false;
    if (this.failed) {
      queueMicrotask(() => {
        handlers.onError?.(new PinnedTransportError('ERR_SOCKET_FAILED', 'the P2P link is down'));
        handlers.onClose?.({ code: 1006, reason: '' });
      });
    } else {
      this.sockets.set(id, socket);
      this.write({ t: 'wopen', id, path: tunnelPath(url) });
    }
    const send = (frame: Frame) => {
      if (closed || this.failed) return;
      if (socket.opened) this.write(frame);
      else socket.queue.push(frame); // the Mac bridges nothing until wopened: hold messages back
    };
    return {
      sendText: (text) => send({ t: 'wmsg', id, s: text }),
      sendBinary: (bytes) => send({ t: 'wmsg', id, b: base64Encode(bytes) }),
      close: (code, reason) => {
        if (closed) return;
        closed = true;
        this.sockets.delete(id);
        if (!this.failed) this.write({ t: 'wclose', id, code: code ?? 1000, reason: reason ?? '' });
      },
    };
  }

  /** The channel is gone: every request fails, every socket ends abnormally. Idempotent. */
  fail(error: Error = new Error('the P2P link closed')): void {
    if (this.failed) return;
    this.failed = error;
    for (const [id, pending] of this.requests) {
      clearTimeout(pending.timer);
      this.requests.delete(id);
      pending.reject(error);
    }
    for (const [id, socket] of this.sockets) {
      this.sockets.delete(id);
      socket.handlers.onError?.(new PinnedTransportError('ERR_SOCKET_FAILED', error.message));
      socket.handlers.onClose?.({ code: 1006, reason: '' });
    }
  }

  get isFailed(): boolean {
    return this.failed !== null;
  }

  private write(frame: Frame): void {
    for (const message of fragmentFrame(JSON.stringify(frame))) this.sendMessage(message);
  }

  private onFrame(json: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(json) as Frame;
    } catch {
      return;
    }
    const id = frame.id ?? '';
    const pending = this.requests.get(id);
    switch (frame.t) {
      case 'hres':
        if (pending) pending.status = frame.status ?? 0;
        return;
      case 'hchunk':
        if (pending && frame.b) pending.chunks.push(base64Decode(frame.b));
        return;
      case 'hend':
        if (!pending) return;
        clearTimeout(pending.timer);
        this.requests.delete(id);
        pending.resolve({ status: pending.status, headers: {}, body: utf8Decode(concat(pending.chunks)) });
        return;
      case 'herr':
        if (!pending) return;
        clearTimeout(pending.timer);
        this.requests.delete(id);
        pending.reject(new Error(frame.message || 'the computer failed the request'));
        return;
    }
    const socket = this.sockets.get(id);
    if (!socket) return;
    switch (frame.t) {
      case 'wopened':
        socket.opened = true;
        socket.handlers.onOpen?.();
        for (const queued of socket.queue.splice(0)) this.write(queued);
        return;
      case 'wmsg':
        if (frame.s !== undefined) socket.handlers.onText?.(frame.s);
        else if (frame.b) socket.handlers.onBinary?.(base64Decode(frame.b));
        return;
      case 'werr':
        this.sockets.delete(id);
        socket.handlers.onError?.(new PinnedTransportError('ERR_SOCKET_FAILED', frame.message || 'could not open'));
        socket.handlers.onClose?.({ code: 1006, reason: '' });
        return;
      case 'wclose':
        this.sockets.delete(id);
        socket.handlers.onClose?.({ code: frame.code ?? 1000, reason: frame.reason ?? '' });
        return;
    }
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
