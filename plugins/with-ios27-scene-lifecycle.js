/**
 * [INPUT]: Expo SDK 54's generated Swift AppDelegate and Info.plist.
 * [OUTPUT]: CNG-safe UIScene lifecycle bootstrap and legacy Expo deep-link forwarding.
 * [POS]: Temporary iOS 27 SDK compatibility bridge; remove on Expo SDK 58 migration.
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const MARKER = '// SOLCO_SCENE_LIFECYCLE_V1';
const WINDOW_STARTUP = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const SCENE_DELEGATE = `
${MARKER}
// Expo SDK 54 does not provide ExpoAppSceneDelegate. Keep the scene in the same
// Swift file so the generated Xcode project resolves the class automatically.
class SolcoSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else { return }

    var launchOptions = appDelegate.solcoLaunchOptions ?? [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    } else if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) {
      if let url = activity.webpageURL { launchOptions[.url] = url }
      _ = appDelegate.application(
        UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }

    let sceneWindow = UIWindow(windowScene: windowScene)
    window = sceneWindow
    // Some React Native / Expo modules still resolve UIApplicationDelegate.window.
    appDelegate.window = sceneWindow
    factory.startReactNative(
      withModuleName: "main",
      in: sceneWindow,
      launchOptions: launchOptions.isEmpty ? nil : launchOptions)
  }

  // Forward through ExpoAppDelegate subscribers, not directly to RCTLinkingManager:
  // expo-linking's initialURL registry and the React Native linking event need it.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    _ = appDelegate.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }

  // UIApplicationDelegate's foreground/background callbacks are no longer sent
  // under scenes. Preserve existing Expo subscriber notifications on SDK 54.
  func sceneDidBecomeActive(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationDidBecomeActive?(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationWillResignActive?(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationWillEnterForeground?(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    UIApplication.shared.delegate?.applicationDidEnterBackground?(UIApplication.shared)
  }
}
`;

function patchAppDelegate(contents) {
  if (contents.includes(MARKER)) return contents;
  if (contents.includes('ExpoAppSceneDelegate') || contents.includes('class SceneDelegate')) {
    throw new Error('Solco iOS 27 lifecycle shim must be removed when Expo provides scene support.');
  }
  const property = '  var window: UIWindow?';
  if (contents.split(property).length !== 2 || contents.split(WINDOW_STARTUP).length !== 2 ||
      contents.split('    bindReactNativeFactory(factory)').length !== 2) {
    throw new Error('Expo AppDelegate template changed: refusing unsafe Solco UIScene patch.');
  }
  return contents
    .replace(property, `${property}\n  var solcoLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?`)
    .replace(WINDOW_STARTUP, '    // React Native starts when UIKit connects the first scene.')
    .replace(
      '    bindReactNativeFactory(factory)',
      '    bindReactNativeFactory(factory)\n    solcoLaunchOptions = launchOptions',
    ) + SCENE_DELEGATE;
}

function withSolcoIOS27SceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    const existing = mod.modResults.UIApplicationSceneManifest;
    if (existing) {
      const delegate = existing.UISceneConfigurations?.UIWindowSceneSessionRoleApplication?.[0]?.UISceneDelegateClassName;
      if (delegate !== '$(PRODUCT_MODULE_NAME).SolcoSceneDelegate') {
        throw new Error('Another UIScene manifest exists: remove the obsolete Solco compatibility plugin.');
      }
      return mod; // Non-clean prebuild must be idempotent too.
    }
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SolcoSceneDelegate',
        }],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('Solco UIScene compatibility plugin requires Swift AppDelegate.');
    }
    mod.modResults.contents = patchAppDelegate(mod.modResults.contents);
    return mod;
  });
}

module.exports = withSolcoIOS27SceneLifecycle;
module.exports.patchAppDelegate = patchAppDelegate;
