// [INPUT]: exported `dist/` bundle and local Mac Host base URL.
// [OUTPUT]: same-origin static Web/PWA server with authenticated API/WS proxying.
// [POS]: local Web validation helper; it is not a second API or runtime authority.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Position: prox task（.prox.yaml tasks.web）引用；本地 PWA 验证的唯一入口进程。
// Invariant: /api/* 透传 Mac Host Remote API（含 WebSocket upgrade + 子协议头）；
// 其余路径伺服 dist/ 静态导出并做 Agent/History 动态路由回退（无 Pane Terminal 回退）。
// 同源部署使 CORS 归零（web-pwa-architecture.md §4）；WS 走 Host 的 /api/v2/events
// stream，其事件 payload 可携带 v2 semantic invalidations。
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8090);
const API_ORIGIN = process.env.SOLCO_API_ORIGIN ?? 'http://127.0.0.1:8757';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const distReady = await readFile(join(ROOT, 'index.html'))
  .then(() => true)
  .catch(() => false);
if (!distReady) {
  console.error(`dist/ not found at ${ROOT} — run "pnpm export:web" first`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  // ---- /api/* → Mac Host Remote API（同源反代，浏览器零 CORS）----
  if (req.url?.startsWith('/api/')) {
    const upstream = httpRequest(
      new URL(req.url, API_ORIGIN),
      { method: req.method, headers: { ...req.headers, host: new URL(API_ORIGIN).host } },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(
          JSON.stringify({
            error: { code: 'host_unavailable', message: `api upstream unreachable: ${error.code ?? error.message}`, request_id: 'serve-web' },
          }),
        );
      }
    });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }

  // ---- 静态导出 + 动态路由回退 ----
  try {
    let pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    let candidates = [];
    if (pathname.startsWith('/agent/')) {
      candidates = [join(ROOT, 'agent/[agentId].html')];
    } else if (/^\/history\/[^/]+/.test(pathname)) {
      candidates = [join(ROOT, 'history/[sessionKey].html'), join(ROOT, 'history.html')];
    } else if (extname(pathname) === '.html') {
      candidates = [join(ROOT, pathname), join(ROOT, pathname.replace(/\.html$/, '') + '/index.html')];
    } else if (extname(pathname) === '') {
      candidates = [join(ROOT, pathname + '.html'), join(ROOT, pathname, 'index.html')];
    } else {
      candidates = [join(ROOT, pathname)];
    }

    for (const candidate of candidates) {
      const safe = normalize(candidate);
      if (!safe.startsWith(normalize(ROOT))) continue;
      const body = await readFile(safe).catch(() => null);
      if (body !== null) {
        res.writeHead(200, {
          'content-type': MIME[extname(safe)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(body);
        return;
      }
    }
    const shell = await readFile(join(ROOT, 'index.html')).catch(() => null);
    if (shell) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(shell);
      return;
    }
    res.writeHead(404).end('not found');
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

// ---- WS upgrade 透传（wss → Mac Host 版本化 events；子协议头原样转发）----
server.on('upgrade', (req, socket, head) => {
  const target = new URL(req.url ?? '/', API_ORIGIN);
  if (!target.pathname.startsWith('/api/')) {
    socket.destroy();
    return;
  }
  const upstream = httpRequest({
    protocol: 'http:',
    host: target.hostname,
    port: target.port,
    method: 'GET',
    path: req.url,
    headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
  });
  // WS 代理：透传 101 + 双向管道。
  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upstreamRes.headers)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    upstreamSocket.write(head);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on('response', (response) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n\r\n`);
    response.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});

process.on('uncaughtException', (error) => {
  if (error.code === 'ECONNRESET' || error.code === 'EPIPE') return;
  console.error('uncaughtException:', error);
  process.exit(1);
});

const BIND = process.env.BIND ?? '127.0.0.1';
server.listen(PORT, BIND, () => {
  console.log(`solco mobile web: ${ROOT} + api proxy → ${API_ORIGIN} on http://${BIND}:${PORT}`);
});
