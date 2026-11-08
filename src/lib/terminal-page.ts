// [INPUT]: the vendored xterm.js / xterm.css / fit-addon sources (assets/terminal/*.txt, read by the renderer).
// [OUTPUT]: buildTerminalPage — the one self-contained HTML page the native terminal's WebView renders: xterm.js plus the glue
//           (touch panning, scroll reporting, and the `window.__solco` handle: writeB64 / resize / focus / blur / toLive / readText).
// [POS]: Pure, with no React Native import, so vitest can parse the page. The glue is JavaScript written inside a TypeScript template
//        literal — one unescaped `\n` or backtick there breaks the whole page without a build error, and the terminal then never
//        leaves "Connecting…" (terminal-page.test.ts parses every inline script).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { colors, monoFont } from '@/theme/tokens';

export function buildTerminalPage(xtermJs: string, xtermCss: string, fitJs: string): string {
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
      selectionBackground: '${colors.accentSoft}',
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
    readText: function () {
      var b = term.buffer.active, lines = [];
      for (var i = 0; i < b.length; i++) {
        var l = b.getLine(i);
        if (!l) continue;
        var t = l.translateToString(true);
        if (l.isWrapped && lines.length) lines[lines.length - 1] += t; else lines.push(t);
      }
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      send({ type: 'text', text: lines.join('\\n') });
    },
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
