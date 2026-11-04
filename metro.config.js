// [INPUT]: Expo SDK 54 default Metro configuration.
// [OUTPUT]: Metro config with `txt` registered as an asset extension — vendored xterm
//           dists (assets/terminal/*.txt) are required as assets by native-terminal.tsx.
// [POS]: bundler wiring only; no business logic. Metro 0.83 dropped `txt` from defaults.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('txt');

module.exports = config;
