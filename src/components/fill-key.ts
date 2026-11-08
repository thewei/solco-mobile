// [INPUT]: whether a rounded View's background is a colour (true) or transparent (false) right now.
// [OUTPUT]: fillKey — the React `key` that makes such a View be created anew when that flips.
// [POS]: One workaround for one Android bug (React Native 0.81): a View whose backgroundColor goes from transparent to a
//        colour in place is drawn with square corners — its borderRadius is lost. A new key re-creates the View with all of
//        its props, so it keeps its radius. Used by every selected/active pill that is a plain View or a `Tap` (the bottom
//        nav indicator, the launch Chip, the Remote Desktop dock and segmented controls); a `Pressable` whose style
//        function does the flip is not affected and needs none. iOS and Web are unaffected and only recreate a leaf.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
export function fillKey(filled: boolean): 'filled' | 'bare' {
  return filled ? 'filled' : 'bare';
}
