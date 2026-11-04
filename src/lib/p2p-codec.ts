// [INPUT]: nothing — pure byte/string helpers.
// [OUTPUT]: utf8Encode/utf8Decode, base64Encode/base64Decode, P2P_FRAGMENT, fragmentFrame,
//           createReassembler.
// [POS]: The wire codec of the WebRTC DataChannel to the Mac (solco internal/remotehost/p2p.go): a frame
//        is one JSON text (the relay's hreq/hres/wopen/wmsg vocabulary) sent as binary messages of at
//        most 16 KiB payload, each prefixed with one header byte — 1 = more fragments follow, 0 = last.
//        The channel is ordered and reliable, so the far side only concatenates until it sees a 0.
//        Hand-rolled UTF-8/base64 because Hermes' TextDecoder/atob coverage varies by version.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

/** Payload bytes per DataChannel message; the Go Host's `p2pFragment` must match. */
export const P2P_FRAGMENT = 16 * 1024;
/** Largest reassembled frame accepted (the Go Host's `p2pMaxFrame`). */
export const P2P_MAX_FRAME = 48 * 1024 * 1024;

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    let code: number;
    let extra: number;
    if (b0 < 0x80) {
      code = b0;
      extra = 0;
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      code = b0 & 0x1f;
      extra = 1;
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      code = b0 & 0x0f;
      extra = 2;
    } else if (b0 >= 0xf0 && b0 < 0xf8) {
      code = b0 & 0x07;
      extra = 3;
    } else {
      out += '\ufffd';
      i += 1;
      continue;
    }
    if (i + extra >= bytes.length) {
      out += '\ufffd'; // a multi-byte sequence cut off at the end
      break;
    }
    for (let k = 1; k <= extra; k += 1) code = (code << 6) | (bytes[i + k]! & 0x3f);
    i += extra + 1;
    out += code >= 0x10000 ? String.fromCharCode(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)) : String.fromCharCode(code);
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : B64[c & 63]!;
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64_INDEX[ch];
    if (v === undefined) throw new Error('bad base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (acc >> bits) & 0xff;
      o += 1;
    }
  }
  return out.subarray(0, o);
}

/** One frame's JSON → DataChannel messages (header byte + ≤ `size` payload bytes each). */
export function fragmentFrame(json: string, size = P2P_FRAGMENT): Uint8Array[] {
  const data = utf8Encode(json);
  const messages: Uint8Array[] = [];
  for (let offset = 0; offset < data.length || messages.length === 0; offset += size) {
    const end = Math.min(offset + size, data.length);
    const message = new Uint8Array(1 + end - offset);
    message[0] = end < data.length ? 1 : 0;
    message.set(data.subarray(offset, end), 1);
    messages.push(message);
  }
  return messages;
}

/** Concatenate fragments until a header 0; `onFrame` gets the whole JSON. Overflow throws and resets. */
export function createReassembler(onFrame: (json: string) => void, maxBytes = P2P_MAX_FRAME) {
  let parts: Uint8Array[] = [];
  let total = 0;
  return {
    push(message: Uint8Array): void {
      if (message.length === 0) return;
      const payload = message.subarray(1);
      if (total + payload.length > maxBytes) {
        parts = [];
        total = 0;
        throw new Error('p2p frame too large');
      }
      parts.push(payload);
      total += payload.length;
      if (message[0] !== 0) return;
      const whole = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        whole.set(part, at);
        at += part.length;
      }
      parts = [];
      total = 0;
      onFrame(utf8Decode(whole));
    },
  };
}
