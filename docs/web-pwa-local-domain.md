# Solco Mobile Web — Local Domain Runbook (prox / serve-web)

Status: **Operational / verified end-to-end on 2026-08-25**
Baseline: 2026-08-25
Architecture: `web-pwa-architecture.md` (§4 target topology, §6 event semantics)
Web track plan: `web-implementation-plan.md`
Mac-side enablers: solco repo `docs/remote-client-architecture.md` (Host-side topology and transport decisions)

This document is the **operational** half of the Web/PWA track: how the local domain,
TLS proxy, static export, and same-origin API bridge are wired and driven day to day.
The architecture doc owns the why; this runbook owns the how.

## 1. Topology

```text
browser ──HTTPS──▶ Caddy (prox-managed, mkcert cert)
                    solco.dev.local
                        │ reverse_proxy localhost:8090
                        ▼
                 scripts/serve-web.mjs  (:8090)
                   ├─ static: dist/ (pnpm export:web; SPA fallback for /agent/<id>)
                   ├─ /api/* ──────▶ Mac Host Remote API (127.0.0.1:8757, Solco app)
                   └─ WS upgrade ──▶ wss://solco.dev.local/api/v1/events
                                     (subprotocol auth: solco.bearer, <token>)
```

This mirrors the W4 target topology from `web-pwa-architecture.md` §4 — the web bundle
and the API are **same-origin**, so CORS is zero and the manifest is installable over
HTTPS. The serve-web script is the local stand-in for the future Host-served static
bundle; it must never grow business logic.

## 2. The three runtime pieces

| Piece | Owner | Start / stop |
| --- | --- | --- |
| `solco.dev.local` DNS + TLS | prox (Caddy + `/etc/hosts` managed block) | `prox reload`, `prox start` |
| Static + same-origin API bridge | `scripts/serve-web.mjs` (prox task `web`) | `prox run web`, `prox tasks` |
| Mac Host Remote API | Solco macOS app (Settings → Remote) | app launch / Settings toggle |

DNS transport note: `solco.dev.local` rides the **hosts** managed block — no dnsmasq
selector, no `/etc/resolver` registration, and `*.local` is inside the default
system-proxy bypass list. This is a deliberate single-transport choice (see §7
troubleshooting for the `.test` lesson that forced it).

## 3. First-time setup

```sh
# 1. Mac Host: enable Remote Access (Settings → Remote → toggle on).
#    This persists config.json "remote" and starts the loopback API on :8757.
#    Token: Settings → Remote → copy (or read config.json remote.access_token).

# 2. Mobile web bundle:
pnpm export:web          # first run ~7 min (React Compiler + Tamagui)

# 3. prox wiring (repo already carries .prox.yaml):
prox scan
prox generate             # writes hosts block + Caddy cert + Caddyfile
prox install              # only needed when DNS fragments change (sudo); hosts-only
                          # changes are already synced by generate
prox reload               # Caddy picks up the new site block

# 4. Run the web task:
prox run web
```

## 4. Daily operation

```sh
prox run web              # start serve-web daemon (idempotent)
prox tasks                # status
prox reload               # after editing .prox.yaml / regenerating
pnpm export:web && (restart the web task)   # after changing app code
open https://solco.dev.local             # connect screen: URL is pre-filled from
                                             # localStorage; paste the token each session
```

Connect-screen semantics on web (architecture §2): the Host URL persists in
`localStorage`; the **credential is session-memory only** — after a page refresh you
re-enter the token. That is by design, not a bug.

Environment knobs for serve-web: `PORT` (default 8090, must match `.prox.yaml`),
`SOLCO_API_ORIGIN` (default `http://127.0.0.1:8757`).

## 5. Verification checklist (2026-08-25 evidence)

Verified against the real Mac Host with the user's live runtime (17 workspaces / 5 agents):

| Check | Command | Expected |
| --- | --- | --- |
| DNS via hosts path | `python3 -c "import socket; print(socket.getaddrinfo('solco.dev.local', 443))"` | `127.0.0.1` |
| Static + TLS | `curl -sk --noproxy '*' https://solco.dev.local/` | 200, no cert warning in browser |
| Manifest | `curl -sk --noproxy '*' https://solco.dev.local/manifest.json` | 200, `display: standalone` |
| Same-origin API | `curl -sk -H "Authorization: Bearer <token>" .../api/v2/hello` | 200, real host name, semantic API v2 |
| WS upgrade | curl with `--http1.1` + Upgrade headers + `Sec-WebSocket-Protocol: solco.bearer, <token>` | `101`, subprotocol echoed |
| Browser flow | connect (wrong token → error; real token → board) → workspace/project switch → agent detail → Terminal output | real projections render |

Browser-side PWA signals: `isSecureContext === true`, manifest linked with 2 icons,
`'serviceWorker' in navigator` true (SW itself intentionally not shipped).

## 6. Troubleshooting

- **A retired `*.test` domain answered "No Such Record" while `dig @127.0.0.1 -p 5353` worked.**
  mDNSResponder on this machine accepted the `/etc/resolver/<name>.test`
  registration (resolver #22 present in `scutil --dns`) but never answered queries
  through it; a full mDNSResponder restart was not sufficient either. Root cause not
  fully isolated. **Resolution: use the hosts transport** (`solco.dev.local`, this
  runbook). Do not re-add the dnsmasq selector for this domain without first
  reproducing and fixing the resolver behavior. The stale `/etc/resolver/shardlane.test`
  file left by that experiment is inert (nothing serves that name anymore) and can be
  removed with `sudo rm /etc/resolver/shardlane.test`.
- **WS probe returns HTTP 400 instead of 101.** The TLS front negotiated HTTP/2, which
  has no Upgrade mechanism. Force `--http1.1` in curl; browsers negotiate 101
  correctly on their own.
- **`000` from curl.** Check the system proxy (Surge/Clash) — prefer `--noproxy '*'`
  for loopback checks; `*.local` is bypassed by default but explicit is cheaper than
  debugging someone else's routing table.
- **502 on `/api/*`.** The Solco app is not running or Remote Access is off —
  serve-web only proxies, it never starts the Mac Host.
- **Phone cannot install the PWA.** Real-device install needs a trusted CA and a
  secure context; the mkcert CA lives on this Mac only. Phone installation is the R8
  Tailscale-HTTPS path (architecture §5), not this loopback topology.

## 7. Change discipline

- `.prox.yaml` is the single source for the domain, port, and tasks. Port changes must
  move in lockstep with serve-web's `PORT` default and the Caddyfile regeneration
  (`prox scan → generate → reload`).
- serve-web may only ever: serve `dist/`, proxy `/api/*`, pass through WS upgrades.
  Any business logic, auth logic, or request rewriting beyond header forwarding
  belongs in the Mac Host, not here.
- Contract changes (wire format) go through `src/contracts/` + the golden fixtures
  from the solco repo (`internal/remotehost/testdata/api-v3`); `pnpm test` must stay
  green in both repos in the same change.

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
