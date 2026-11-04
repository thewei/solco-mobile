// [INPUT]: the Solco Go Host's golden files (internal/remotehost/testdata/api-v3).
// [OUTPUT]: byte-identical copies under src/contracts/__fixtures__/v3.
// [POS]: dev-infrastructure only — the one way fixtures enter this repo; never edit them by hand.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Usage: pnpm sync:fixtures   (SOLCO_REPO overrides ../solco)
//        pnpm check:fixtures  (--check: write nothing, exit 1 when the two repos' files differ or one side has an extra file)
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repo = resolve(process.env.SOLCO_REPO ?? join(import.meta.dirname, '..', '..', 'solco'));
const from = join(repo, 'internal', 'remotehost', 'testdata', 'api-v3');
const to = join(import.meta.dirname, '..', 'src', 'contracts', '__fixtures__', 'v3');

const names = await readdir(from).catch(() => {
  console.error(`no Go golden files at ${from} — run \`go test ./internal/remotehost -run Golden -update\` in the solco repo`);
  process.exit(1);
});
if (process.argv.includes('--check')) {
  const have = await readdir(to).catch(() => []);
  const drift = [];
  for (const name of new Set([...names, ...have])) {
    const [a, b] = await Promise.all([readFile(join(from, name)).catch(() => null), readFile(join(to, name)).catch(() => null)]);
    if (!a || !b || !a.equals(b)) drift.push(name);
  }
  if (drift.length > 0) {
    console.error(`fixtures out of sync (${drift.join(', ')}) — run \`pnpm sync:fixtures\``);
    process.exit(1);
  }
  console.log(`fixtures in sync (${names.length} files)`);
  process.exit(0);
}
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
for (const name of names) await copyFile(join(from, name), join(to, name));
console.log(`synced ${names.length} files from ${from}`);
