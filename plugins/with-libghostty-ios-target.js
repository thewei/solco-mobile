/**
 * [INPUT]: Expo SDK 54's generated ios/Podfile.properties.json and Xcode project.
 * [OUTPUT]: iOS deployment target raised to 16.4 (Podfile platform and the app target's build setting).
 * [POS]: expo-libghostty's iOS podspec needs iOS 16.4 while SDK 54's default is 15.1. Expo autolinking then drops the
 *        ExpoLibghostty pod WITHOUT a message, yet ExpoModulesProvider.swift still imports it, so the app fails to
 *        compile. Raising the target is a product decision (it drops iOS 15.x–16.3 phones): this plugin exists only on
 *        the terminal-renderer experiment branch. Remove together with expo-libghostty.
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { withPodfileProperties, withXcodeProject } = require('expo/config-plugins');

const IOS_TARGET = '16.4';

function withIosTarget(properties) {
  return { ...properties, 'ios.deploymentTarget': IOS_TARGET };
}

module.exports = (config) => {
  config = withPodfileProperties(config, (mod) => {
    mod.modResults = withIosTarget(mod.modResults);
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    mod.modResults.updateBuildProperty('IPHONEOS_DEPLOYMENT_TARGET', IOS_TARGET);
    return mod;
  });
};
module.exports.withIosTarget = withIosTarget;
module.exports.IOS_TARGET = IOS_TARGET;
