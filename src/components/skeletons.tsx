// [INPUT]: a row count.
// [OUTPUT]: ListSkeleton — a Card of pulsing title/caption rows standing in for a list that is still loading.
// [POS]: Replaces the centered spinners on Home, Sessions and Quota so the page keeps its shape while the Mac answers.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { XStack, YStack } from 'tamagui';

import { Fade, Skeleton } from '@/components/motion';
import { Card } from '@/components/section';
import { colors, row } from '@/theme/tokens';

const TITLES = ['62%', '48%', '70%', '55%', '66%'] as const;

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Fade>
      <Card>
        {Array.from({ length: rows }, (_, index) => (
          <XStack
            key={index}
            alignItems="center"
            gap={row.gap}
            minHeight={row.minHeight}
            paddingHorizontal={row.padX}
            paddingVertical={row.padY}
            borderTopWidth={index === 0 ? 0 : 1}
            borderTopColor={colors.border}>
            <YStack flex={1} gap={8}>
              <Skeleton width={TITLES[index % TITLES.length]} height={14} />
              <Skeleton width="35%" height={11} />
            </YStack>
            <Skeleton width={16} height={16} radius={8} />
          </XStack>
        ))}
      </Card>
    </Fade>
  );
}
