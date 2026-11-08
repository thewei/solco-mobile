/**
 * [INPUT]: Expo SDK 54 AppDelegate startup shape and the Solco config plugin.
 * [OUTPUT]: Guards against the iOS 27 startup SIGTRAP, black screen, and lost deep links.
 * [POS]: Source-level CNG regression test; iOS 27 device runtime gate remains separate.
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { patchAppDelegate } = require('./with-ios27-scene-lifecycle.js') as {
  patchAppDelegate(contents: string): string;
};

const expo54Template = `
import Expo
import React

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: ReactNativeDelegate())
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('Expo SDK 54 → iOS 27 UIScene adapter', () => {
  it('does not start React Native before a UIWindowScene connects', () => {
    const patched = patchAppDelegate(expo54Template);
    expect(patched).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(patched).toContain('UIWindow(windowScene: windowScene)');
    expect(patched).toContain('appDelegate.window = sceneWindow');
    expect(patched).toContain('let factory = appDelegate.reactNativeFactory');
    expect(patched).toContain('factory.startReactNative(');
    expect(patched).toContain('solcoLaunchOptions = launchOptions');
  });

  it('forwards cold and warm links through ExpoAppDelegate subscribers', () => {
    const patched = patchAppDelegate(expo54Template);
    expect(patched).toContain('connectionOptions.urlContexts.first');
    expect(patched).toContain('connectionOptions.userActivities.first');
    expect(patched).toContain('launchOptions[.url] = context.url');
    expect(patched).toContain('open: context.url, options: [:]');
    expect(patched).toContain('continue: userActivity, restorationHandler:');
    expect(patched).toContain('scene(_ scene: UIScene, openURLContexts');
    expect(patched).not.toMatch(/_ = RCTLinkingManager\\.application/);
  });

  it('is idempotent and refuses unrecognized/upgraded native templates', () => {
    const patched = patchAppDelegate(expo54Template);
    expect(patchAppDelegate(patched)).toBe(patched);
    expect(() => patchAppDelegate('class AppDelegate {}')).toThrow(/template changed/);
    expect(() => patchAppDelegate(expo54Template + '\nExpoAppSceneDelegate')).toThrow(/must be removed/);
  });
});
