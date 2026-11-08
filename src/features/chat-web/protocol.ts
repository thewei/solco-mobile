// [INPUT]: raw strings crossing the WebView boundary (page → phone `call`s) and the page HTML.
// [OUTPUT]: `MYGO_SHIM` (the `globalThis.mygo` runtime the shared Chat page's generated bridge calls into).
//           The shim also paints-gates the page: it hides the document before the page's first paint and
//           reveals it only when the first conversation state arrives (a `chat:updated` event or the result
//           of the page's own `chat.Snapshot`/`chat.LinkSession` call), so the phone never shows the page's
//           empty boot chrome while the WebView warms up — the screen's own loading state covers that time.
// [POS]: the whole wire between the shared Chat page and React Native. The page is the desktop's own bundle, which
//        talks to `mygo-runtime`; this shim is the phone's stand-in for that runtime, so the page needs no change.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: only `call`/`on`/`once` exist (the page uses nothing else of mygo); the page can reach nothing but
//             this bridge; a message that is not a well-formed call is dropped.
export interface PageCall {
  id: number;
  method: string;
  args: unknown[];
}

export type ToPage =
  | { k: 'result'; id: number; ok: true; value: unknown }
  | { k: 'result'; id: number; ok: false; error: string }
  | { k: 'event'; name: string; payload: unknown };

/** Installed before the page's own scripts. Posts to React Native, or to the parent frame on Web. */
export const MYGO_SHIM = `(function(){
var L={},P={},n=0,S=0,shown=false;
function show(){if(shown)return;shown=true;try{document.documentElement.style.visibility='';}catch(e){}}
function post(m){var s=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(s);else window.parent.postMessage(s,'*');}
function deliver(m){
  if(typeof m==='string'){try{m=JSON.parse(m);}catch(e){return;}}
  if(!m||typeof m!=='object')return;
  if(m.k==='result'){if(m.id===S){S=0;show();}var p=P[m.id];if(!p)return;delete P[m.id];if(m.ok)p.resolve(m.value);else{var e=new Error(String(m.error||'failed'));e.name='CallError';p.reject(e);}}
  else if(m.k==='event'){if(m.name==='chat:updated')show();var a=L[m.name];if(a)a.slice().forEach(function(f){try{f(m.payload);}catch(e){}});}
}
window.__solcoDeliver=deliver;
window.addEventListener('message',function(e){if(!window.ReactNativeWebView&&e.source===window.parent)deliver(e.data);});
function on(name,f){(L[name]=L[name]||[]).push(f);return function(){var a=L[name]||[];var i=a.indexOf(f);if(i>=0)a.splice(i,1);};}
window.mygo={
  call:function(method){var args=Array.prototype.slice.call(arguments,1);return new Promise(function(resolve,reject){var id=++n;if(method==='chat.Snapshot'||method==='chat.LinkSession')S=id;P[id]={resolve:resolve,reject:reject};post({k:'call',id:id,method:method,args:args});});},
  on:on,
  once:function(name,f){var off=on(name,function(x){off();f(x);});return off;},
  channel:function(){throw new Error('channels are not available on the phone');},
  locale:'en',dir:'ltr',preferences:{}
};
try{document.documentElement.style.visibility='hidden';}catch(e){}
})();`;

/** A page message is a call only when it has a numeric id, a `chat.`-style method and an args array. */
export function parsePageCall(raw: string): PageCall | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (m.k !== 'call' || typeof m.id !== 'number' || typeof m.method !== 'string' || !Array.isArray(m.args)) return null;
  return { id: m.id, method: m.method, args: m.args };
}

export const resultMessage = (id: number, value: unknown): ToPage => ({ k: 'result', id, ok: true, value });
export const errorMessage = (id: number, error: string): ToPage => ({ k: 'result', id, ok: false, error });
export const eventMessage = (name: string, payload: unknown): ToPage => ({ k: 'event', name, payload });

/** The JS the phone injects to hand one message to the page (native WebView). */
export function deliverScript(message: ToPage): string {
  return `window.__solcoDeliver(${JSON.stringify(JSON.stringify(message))});true;`;
}

/**
 * Seeds the page's own draft store (`solco:chat-draft:<conversationId>`, the key its App reads on load) once,
 * so a launch whose prompt could not be delivered (a first-run trust prompt) lands in the composer.
 */
export function draftSeed(conversationId: string, draft: string): string {
  if (draft === '') return '';
  return `try{var k=${JSON.stringify(`solco:chat-draft:${conversationId}`)};if(!localStorage.getItem(k))localStorage.setItem(k,${JSON.stringify(draft)});}catch(e){}`;
}

/** The page with the shim as its first script. */
export function withShim(html: string, shim: string = MYGO_SHIM): string {
  const head = html.indexOf('<head>');
  if (head < 0) return `<script>${shim}</script>${html}`;
  const at = head + '<head>'.length;
  return `${html.slice(0, at)}<script>${shim}</script>${html.slice(at)}`;
}
