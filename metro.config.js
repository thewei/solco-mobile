// [INPUT]: Expo SDK 54 default Metro configuration.
// [OUTPUT]: the unmodified Expo Metro config.
// [POS]: bundler wiring only; no business logic. (`txt` was an asset extension for the vendored xterm dists, removed with xterm 2026-11-07.)
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
