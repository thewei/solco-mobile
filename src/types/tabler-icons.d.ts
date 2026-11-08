// [INPUT]: @tabler/icons-react-native 3.50 — its `exports` map points deep imports (`@tabler/icons-react-native/IconX`) at
//          `dist/icons/IconX.d.ts`, but the typings ship in `dist/icons/icons/`, so TypeScript cannot resolve them.
// [OUTPUT]: one wildcard declaration giving every deep import the package's own `Icon` type.
// [POS]: lets theme/glyphs.ts import single icons (the package root would put all 6,000 into the bundle).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
declare module '@tabler/icons-react-native/*' {
  import type { Icon } from '@tabler/icons-react-native';

  const glyph: Icon;
  export default glyph;
}
