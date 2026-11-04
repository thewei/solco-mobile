// [INPUT]: Vitest runner and the src test modules.
// [OUTPUT]: Node-compatible contract and pure Conversation state test configuration.
// [POS]: Mobile verification boundary; React Native rendering remains a native/dev-build gate.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': join(import.meta.dirname, 'src'),
    },
  },
});
