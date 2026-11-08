import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const { addLibghosttyNdk } = createRequire(import.meta.url)('./with-libghostty-ndk.js') as {
  addLibghosttyNdk: (contents: string) => string;
};

describe('with-libghostty-ndk', () => {
  const root = "apply plugin: 'expo-root-project'\n";

  it('hands the root ndkVersion to expo-libghostty only', () => {
    const out = addLibghosttyNdk(root);
    expect(out).toContain("sub.name == 'expo-libghostty'");
    expect(out).toContain('sub.android.ndkVersion = rootProject.ext.ndkVersion');
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = addLibghosttyNdk(root);
    expect(addLibghosttyNdk(once)).toBe(once);
  });
});
