// [INPUT]: raw PTY byte chunks from the Host-owned shared Herdr TUI stream (same handle
//           protocol as web-terminal: write/resize/focus/getGeometry/toLive) plus the
//           viewport scroll state (atBottom) the caller needs for a jump-to-live control.
// [OUTPUT]: Android/iOS VT rendering via an embedded xterm.js WebView — the mature-owner
//           Phase 1 of audit A04. Input arrives as xterm onData (raw bytes, Host has a
//           compat path); resizes are reported so the caller resizes the shared session.
//           The glue adds touch panning (xterm 6.0.0 ships no touch scrolling upstream)
//           and reports viewport scroll position.
// [POS]: native terminal renderer for the explicit global TUI route; no Host calls,
//        no Conversation semantics. Vendored xterm assets: assets/terminal/*.txt.
// [PROTOCOL]: 变更时更新此头部，然后检查 ../CLAUDE.md
import { Asset } from 'expo-asset';
import type { ComponentType, Ref } from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import WebViewJsx, { type WebViewMessageEvent } from 'react-native-webview';

import { colors, monoFont } from '@/theme/tokens';

// react-native-webview 的类声明 `WebView<P = undefined>` 在 JSX 下把 props 推导成 never；
// 这里用最小结构类型钉死我们实际用到的属性面。
interface WebViewNativeProps {
  ref?: Ref<{ injectJavaScript: (script: string) => void } | null>;
  source: { html: string } | undefined;
  originWhitelist: string[];
  scrollEnabled: boolean;
  overScrollMode: 'never';
  setBuiltInZoomControls: boolean;
  setDisplayZoomControls: boolean;
  keyboardDisplayRequiresUserAction: boolean;
  onMessage: (event: WebViewMessageEvent) => void;
  onError: () => void;
  style: { backgroundColor: string };
}
const WebView = WebViewJsx as unknown as ComponentType<WebViewNativeProps>;

export interface NativeTerminalHandle {
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  focus: () => void;
  blur: () => void;
  toLive: () => void;
  getGeometry: () => { cols: number; rows: number } | null;
}

interface NativeTerminalProps {
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onScrollBottom?: (atBottom: boolean) => void;
  style?: { width?: number | string; height?: number | string; flex?: number };
}

// ---- vendored asset loading (inlined into the WebView HTML; offline-safe) ----

const ASSET_MODULES = {
  // vendored xterm dists; Metro treats .txt as assets (safe to require, not bundle)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  js: require('../../assets/terminal/xterm.js.txt'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  css: require('../../assets/terminal/xterm.css.txt'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fit: require('../../assets/terminal/addon-fit.js.txt'),
} as const;

let htmlPromise: Promise<string> | null = null;
function loadTerminalHtml(): Promise<string> {
  htmlPromise ??= buildTerminalHtml();
  return htmlPromise;
}

async function buildTerminalHtml(): Promise<string> {
  const texts = await Promise.all(
    Object.entries(ASSET_MODULES).map(async ([name, module]) => {
      const asset = Asset.fromModule(module);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) throw new Error('terminal asset has no local URI');
      const response = await fetch(uri);
      const text = await response.text();
      console.log(`[tui-webview] asset ${name}: ${text.length} chars from ${uri.slice(0, 60)}`);
      return text;
    }),
  );
  const [xtermJs = '', xtermCss = '', fitJs = ''] = texts;
  return buildHtml(xtermJs, xtermCss, fitJs);
}

function buildHtml(xtermJs: string, xtermCss: string, fitJs: string): string {
  const glue = `
(function () {
  window.onerror = function (m) { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'glue-error', message: String(m) })); } catch (e) {} };
  try {
  var send = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  var term = new Terminal({
    cursorBlink: true,
    fontSize: 10,
    fontFamily: '${monoFont.web}, monospace',
    theme: {
      background: '${colors.terminal}',
      foreground: '${colors.text}',
      cursor: '${colors.accent}',
      selectionBackground: 'rgba(124,140,255,0.30)',
    },
    scrollback: 2000,
    // Android IMEs drive the textarea with keyCode 229 / isComposing keydowns;
    // letting xterm treat them as keys produced duplicated and split characters.
    // Block those, and let xterm's composition helper deliver the FINAL text once.
    customKeyEventHandler: function (e) {
      if (e.type === 'keydown' && (e.isComposing || e.keyCode === 229)) return false;
      return true;
    },
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  var el = document.getElementById('term');
  term.open(el);
  term.onData(function (d) { send({ type: 'data', data: d }); });
  // Touch panning: xterm 6.0.0 has no touch scrolling (upstream #5489; the fix has not
  // shipped in any npm release), so the glue translates vertical drags itself. Main
  // buffer → scrollLines (swipe down = toward older output); alternate buffer (full-screen
  // TUIs) → Up/Down arrows, matching desktop wheel semantics. touchstart stays passive so
  // a plain tap still focuses the textarea and raises the keyboard; preventDefault only
  // fires after a real drag.
  var touchY = null;
  el.addEventListener('touchstart', function (e) {
    touchY = e.touches.length === 1 ? e.touches[0].clientY : null;
  }, { passive: true, capture: true });
  el.addEventListener('touchmove', function (e) {
    if (touchY === null || e.touches.length !== 1) return;
    var dy = e.touches[0].clientY - touchY;
    var h = el.clientHeight && term.rows ? el.clientHeight / term.rows : 12;
    if (Math.abs(dy) < h * 0.5) return;
    touchY = e.touches[0].clientY;
    var lines = Math.round(dy / h);
    if (term.buffer.active.type === 'alternate') {
      var up = dy < 0;
      var seq = term.modes.applicationCursorKeysMode ? (up ? '\\x1bOA' : '\\x1bOB') : (up ? '\\x1b[A' : '\\x1b[B');
      var data = '';
      for (var i = 0; i < Math.abs(lines); i++) data += seq;
      send({ type: 'data', data: data });
    } else {
      term.scrollLines(-lines);
    }
    e.preventDefault();
  }, { passive: false, capture: true });
  el.addEventListener('touchend', function () { touchY = null; }, { capture: true });
  el.addEventListener('touchcancel', function () { touchY = null; }, { capture: true });
  term.onScroll(function () {
    var b = term.buffer.active;
    send({ type: 'scroll', atBottom: b.ydisp >= b.baseY });
  });
  var fitNow = function () {
    try { fit.fit(); } catch (e) { /* not laid out yet */ }
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitNow).observe(el);
  window.addEventListener('resize', fitNow);
  fitNow();

  window.__solco = {
    writeB64: function (b64) {
      var bin = atob(b64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      term.write(u8);
    },
    resize: function (c, r) { term.resize(c, r); },
    focus: function () { term.focus(); },
    blur: function () { term.blur(); },
    toLive: function () { term.scrollToBottom(); },
  };
  send({ type: 'ready', cols: term.cols, rows: term.rows });
  } catch (e) { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'glue-error', message: String(e) })); } catch (e2) {} }
})();`;
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>html,body{margin:0;padding:0;height:100%;background:${colors.terminal};overflow:hidden}#term{height:100%}</style>
<style>${xtermCss}</style>
</head><body><div id="term"></div>
<script>${xtermJs}</script>
<script>${fitJs}</script>
<script>${glue}</script>
</body></html>`;
}

// ---- base64 encode (RN has no btoa under Hermes) ----

const injectStats = { sent: 0, dropped: 0, failed: 0 };
const flushStats = { sent: 0 };

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += b1 === undefined ? B64_ALPHABET[(b0 & 3) << 4] : B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 63];
  }
  return out;
}

const NativeTerminal = forwardRef<NativeTerminalHandle, NativeTerminalProps>(
  function NativeTerminal({ onInput, onResize, onScrollBottom }, forwardedRef) {
    const webviewRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
    const geometryRef = useRef<{ cols: number; rows: number } | null>(null);
    const readyRef = useRef(false);
    const pendingRef = useRef<Uint8Array[]>([]);
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let active = true;
      void loadTerminalHtml().then(
        (value) => {
          if (!active) return;
          console.log(`[tui-webview] html built: ${value.length} chars`);
          setHtml(value);
        },
        (cause: unknown) => {
          if (!active) return;
          const detail = cause instanceof Error ? cause.message : 'terminal assets failed to load';
          console.log(`[tui-webview] html FAILED: ${detail}`);
          setError(detail);
        },
      );
      return () => {
        active = false;
      };
    }, []);

    const inject = useCallback((script: string) => {
      const webview = webviewRef.current;
      if (!webview) {
        injectStats.dropped += 1;
        if (injectStats.dropped === 1) console.log('[tui-webview] inject dropped: no webview ref');
        return;
      }
      injectStats.sent += 1;
      try {
        webview.injectJavaScript(`${script}; true;`);
      } catch (cause) {
        injectStats.failed += 1;
        console.log(`[tui-webview] inject failed: ${String(cause)}`);
      }
    }, []);

    const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushWrites = useCallback(() => {
      const batch = pendingRef.current;
      pendingRef.current = [];
      flushRef.current = null;
      if (batch.length === 0) return;
      // Encode ONCE over the concatenated bytes. Joining per-frame base64
      // strings is unsafe: each chunk's '=' padding terminates a strict atob.
      let total = 0;
      for (const chunk of batch) total += chunk.length;
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of batch) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const encoded = encodeBase64(merged);
      if (flushStats.sent === 0) {
        console.log(`[tui-webview] first flush: chunks=${batch.length} bytes=${total} head=${encoded.slice(0, 48)}`);
      }
      flushStats.sent += 1;
      inject(`window.__solco.writeB64(${JSON.stringify(encoded)});`);
    }, [inject]);

    const queueWrite = useCallback(
      (data: string | Uint8Array) => {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        pendingRef.current.push(bytes);
        flushRef.current ??= setTimeout(flushWrites, 25);
      },
      [flushWrites],
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        write: (data) => {
          if (readyRef.current) queueWrite(data);
          else pendingRef.current.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
        },
        resize: (cols, rows) => {
          inject(`window.__solco.resize(${cols}, ${rows});`);
          geometryRef.current = { cols, rows };
        },
        focus: () => inject('window.__solco.focus();'),
        blur: () => inject('window.__solco.blur();'),
        toLive: () => inject('window.__solco.toLive();'),
        getGeometry: () => geometryRef.current,
      }),
      [inject, queueWrite],
    );

    const onMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let message: { type: string; data?: string; cols?: number; rows?: number; atBottom?: boolean; message?: string };
        try {
          message = JSON.parse(event.nativeEvent.data);
        } catch {
          return;
        }
        if (message.type === 'data') {
          onInput?.(message.data ?? '');
          return;
        }
        if (message.type === 'scroll') {
          onScrollBottom?.(message.atBottom === true);
          return;
        }
        if (message.type === 'glue-error') {
          console.log(`[tui-webview] glue error: ${message.message ?? 'unknown'}`);
          return;
        }
        if (message.type === 'resize' && message.cols && message.rows) {
          geometryRef.current = { cols: message.cols, rows: message.rows };
          onResize?.(message.cols, message.rows);
          return;
        }
        if (message.type === 'ready') {
          readyRef.current = true;
          console.log(
            `[tui-webview] ready ${message.cols}x${message.rows} inject sent=${injectStats.sent} dropped=${injectStats.dropped}`,
          );
          if (message.cols && message.rows) {
            geometryRef.current = { cols: message.cols, rows: message.rows };
            onResize?.(message.cols, message.rows);
          }
          flushWrites();
        }
      },
      [flushWrites, onInput, onResize, onScrollBottom],
    );

    const source = useMemo(() => (html ? { html } : undefined), [html]);

    if (error) {
      // 保持与渲染器契约一致：把初始化失败写给调用方排查（A04 spike 期间可见）。
      console.log(`[tui-webview] render null on error: ${error}`);
      return null;
    }

    return source ? (
      <WebView
        ref={(instance) => {
          webviewRef.current = instance;
        }}
        source={source}
        originWhitelist={['*']}
        scrollEnabled={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        keyboardDisplayRequiresUserAction={false}
        onMessage={onMessage}
        onError={() => setError('the terminal view crashed; reopen the TUI')}
        style={{ backgroundColor: colors.terminal }}
      />
    ) : null;
  },
);

export default NativeTerminal;
