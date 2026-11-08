// [INPUT]: the stored System / Light / Dark choice (`state/appearance-store`).
// [OUTPUT]: AppearanceScreen — the Settings → Appearance page: three rows, the current choice checked; a tap applies it at once.
// [POS]: The second-level home of the setting, like Notifications: Settings itself only shows the current value. The root layout
//        remounts the screens when the resulting scheme changes (the Host connection stays), so this page redraws in the new look.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { ScrollView } from 'react-native';

import { ListRow, Section } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { APPEARANCE_LABEL, type Appearance } from '@/lib/appearance';
import { useAppearanceStore } from '@/state/appearance-store';

const CHOICES = ['system', 'light', 'dark'] as const satisfies readonly Appearance[];

export default function AppearanceScreen() {
  const appearance = useAppearanceStore((state) => state.appearance);
  const setAppearance = useAppearanceStore((state) => state.setAppearance);
  return (
    <Screen back title="Appearance">
      <ScrollView>
        <Section first>
          {CHOICES.map((choice) => (
            <ListRow key={choice} label={APPEARANCE_LABEL[choice]} chevron={false} checked={appearance === choice} onPress={() => setAppearance(choice)} />
          ))}
        </Section>
      </ScrollView>
    </Screen>
  );
}
