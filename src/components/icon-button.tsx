// [INPUT]: a lucide glyph, an accessibility label and a press handler.
// [OUTPUT]: IconButton — the 42 pt round icon target used in top bars.
// [POS]: One hit-target size and press feel for every bar button (Home's menu and settings, Chat's terminal).
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import type { LucideIcon } from 'lucide-react-native';

import { Icon, type IconTone } from '@/components/icon';
import { Tap } from '@/components/tap';

export function IconButton({ as, label, onPress, tone = 'text' }: { as: LucideIcon; label: string; onPress: () => void; tone?: IconTone }) {
  return (
    <Tap width={42} height={42} borderRadius={21} alignItems="center" justifyContent="center" role="button" accessibilityLabel={label} onPress={onPress}>
      <Icon as={as} tone={tone} />
    </Tap>
  );
}
