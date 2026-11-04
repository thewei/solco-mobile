#!/usr/bin/env bash
# Infrastructure only: run the mobile v3 codecs against a live Go Host (real TLS + a
# throw-away Herdr session). Needs ../solco (override with SOLCO_REPO) and `herdr` on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
SOLCO_REPO="${SOLCO_REPO:-../solco}"
DIR="$(mktemp -d)"
trap 'touch "$DIR/done"; wait "${HOST_PID:-0}" 2>/dev/null || true; rm -rf "$DIR"' EXIT

(cd "$SOLCO_REPO" && SOLCO_REMOTEHOST_SERVE="$DIR" GOTOOLCHAIN=auto go test -count=1 -run ServeRealHerdr ./internal/remotehost/) &
HOST_PID=$!
for _ in $(seq 1 150); do [ -s "$DIR/pair-url.txt" ] && break; sleep 0.2; done
[ -s "$DIR/pair-url.txt" ] || { echo "host did not come up" >&2; exit 1; }

# NODE_TLS_REJECT_UNAUTHORIZED=0 only for this test process: the self-signed certificate is
# pinned by fingerprint inside the test (a native client pins in its TLS stack instead).
SOLCO_E2E_DIR="$DIR" NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm vitest run src/lib/host-v3.e2e.test.ts
