/**
 * [INPUT]: Expo SDK 54's generated android/build.gradle (root project).
 * [OUTPUT]: CNG-safe, idempotent block that gives the `:expo-libghostty` module the root project's `ndkVersion`.
 * [POS]: expo-libghostty builds a CMake/JNI library but never sets ndkVersion, so AGP falls back to its own default
 *        NDK (27.0.12077973) instead of the one this app builds with (`rootProject.ext.ndkVersion`) and fails with
 *        CXX1101 when that default is not installed. Remove if the library starts reading the root ndkVersion.
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// SOLCO_LIBGHOSTTY_NDK_V1';
const BLOCK = `
${MARKER}
subprojects { sub ->
  if (sub.name == 'expo-libghostty') {
    sub.plugins.withId('com.android.library') {
      sub.android.ndkVersion = rootProject.ext.ndkVersion
    }
  }
}
`;

function addLibghosttyNdk(contents) {
  return contents.includes(MARKER) ? contents : `${contents.trimEnd()}\n${BLOCK}`;
}

module.exports = (config) =>
  withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = addLibghosttyNdk(mod.modResults.contents);
    return mod;
  });
module.exports.addLibghosttyNdk = addLibghosttyNdk;
