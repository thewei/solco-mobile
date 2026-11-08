// [INPUT]: the three DM Sans weights the redesign uses (@expo-google-fonts/dm-sans, OFL), imported one weight at a time
//          so the other fifteen files never enter the bundle.
// [OUTPUT]: useAppFonts — true once the three families are registered (or loading failed, so the app is not held
//           hostage by a font; text then falls back to the system font).
// [POS]: loaded by the root layout, which keeps the splash screen up until this answers. Family names live in
//        theme/tokens (`fontFamilies`) because tamagui.config.ts maps weights onto them.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { useFonts } from 'expo-font';

import { fontFamilies } from '@/theme/tokens';

const assets = {
  [fontFamilies.regular]: DMSans_400Regular,
  [fontFamilies.medium]: DMSans_500Medium,
  [fontFamilies.bold]: DMSans_700Bold,
};

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(assets);
  return loaded || error !== null;
}
