// [INPUT]: the refreshing flag and the refresh callback of a scroll list.
// [OUTPUT]: pullRefresh(...) — a RefreshControl element dressed in the app's colors (accent arc on a raised round chip).
// [POS]: The one pull-to-refresh face. It is a factory, not a component: React Native clones the `refreshControl`
//        element and hands it the ScrollView as a child, so the element must be a real RefreshControl.
//        Android offers no negative-overscroll offsets to a JS-drawn indicator, so the native control is the
//        animation; iOS shows the accent-tinted system spinner.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { RefreshControl } from 'react-native';

import { colors } from '@/theme/tokens';

export function pullRefresh(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surfaceRaised}
    />
  );
}
