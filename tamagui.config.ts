import { config as baseConfig } from '@tamagui/config';
import { createTamagui } from 'tamagui';

const solcoDark = {
  ...baseConfig.themes.dark,
  background: '#08090C',
  backgroundHover: '#0D0F14',
  backgroundPress: '#12151C',
  backgroundFocus: '#12151C',
  backgroundStrong: '#151821',
  color: '#F5F6FA',
  colorHover: '#FFFFFF',
  colorPress: '#FFFFFF',
  colorFocus: '#FFFFFF',
  placeholderColor: '#747A89',
  borderColor: '#242833',
  borderColorHover: '#343A49',
  borderColorFocus: '#7C8CFF',
  borderColorPress: '#50586A',
};

export const tamaguiConfig = createTamagui({
  ...baseConfig,
  themes: {
    ...baseConfig.themes,
    solcoDark,
  },
  settings: {
    ...baseConfig.settings,
    defaultFont: 'body',
  },
});

export type TamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig;
