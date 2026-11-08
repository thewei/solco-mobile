// [INPUT]: a row count, whether a shelf label bar (and its hairline) leads and how wide it is, whether the rows carry the page gutter.
// [OUTPUT]: ListSkeleton — pulsing thread-shaped rows (a 20 dp tile, a title bar, a shorter caption bar) standing in for a
//           list that is still loading.
// [POS]: Replaces the centered spinners so the page keeps its shape while the Mac answers (designs/mobile-t3-redesign
//        `skRows`). Pages that draw full-width rows (Chats, Sessions, Files) pass `inset` for the 17.5 dp gutter; pages
//        that already pad their container leave it off.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { View } from 'react-native';

import { Fade, Skeleton } from '@/components/motion';
import { colors, radii, spacing } from '@/theme/tokens';

export function ListSkeleton({ rows = 3, shelf = false, shelfWidth = 64, inset = false }: { rows?: number; shelf?: boolean; shelfWidth?: number; inset?: boolean }) {
  const gutter = inset ? spacing.screen : 0;
  return (
    <Fade>
      <View accessibilityRole="progressbar" accessibilityLabel="Loading">
        {shelf ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8.75, marginTop: 14, marginBottom: 5, paddingHorizontal: gutter }}>
            <Skeleton width={shelfWidth} height={14} />
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>
        ) : null}
        {Array.from({ length: rows }, (_, index) => (
          <View key={index} style={{ flexDirection: 'row', gap: 7, paddingVertical: 12, paddingHorizontal: gutter }}>
            <Skeleton width={20} height={20} radius={radii.block} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width={`${72 - (index % 3) * 14}%`} height={16} />
              <Skeleton width={`${34 + (index % 2) * 12}%`} height={12} />
            </View>
          </View>
        ))}
      </View>
    </Fade>
  );
}
