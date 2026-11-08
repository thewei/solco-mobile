import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const { withIosTarget, IOS_TARGET } = createRequire(import.meta.url)('./with-libghostty-ios-target.js') as {
  withIosTarget: (properties: Record<string, string>) => Record<string, string>;
  IOS_TARGET: string;
};

describe('with-libghostty-ios-target', () => {
  it('raises the Podfile deployment target to what the expo-libghostty podspec requires', () => {
    expect(IOS_TARGET).toBe('16.4');
    expect(withIosTarget({ 'expo.jsEngine': 'hermes' })).toEqual({
      'expo.jsEngine': 'hermes',
      'ios.deploymentTarget': '16.4',
    });
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = withIosTarget({});
    expect(withIosTarget(once)).toEqual(once);
  });
});
