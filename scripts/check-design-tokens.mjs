// [INPUT]: the Solco repo's design/gen.mjs (the one writer of the design language).
// [OUTPUT]: exit 0 when src/theme/tokens.generated.ts and icons.generated.ts match solco's design/tokens.json + icons.json.
// [POS]: dev-infrastructure only — the read-only drift check; regenerate with `node design/gen.mjs` in the solco repo (SOLCO_MOBILE points it here when this checkout is not the sibling).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Usage: pnpm check:tokens   (SOLCO_REPO overrides ../solco)
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const repo = resolve(process.env.SOLCO_REPO ?? join(import.meta.dirname, '..', '..', 'solco'));
try {
  execFileSync('node', [join(repo, 'design', 'gen.mjs'), '--check'], {
    stdio: 'inherit',
    env: { ...process.env, SOLCO_MOBILE: resolve(import.meta.dirname, '..') },
  });
} catch {
  process.exit(1);
}
