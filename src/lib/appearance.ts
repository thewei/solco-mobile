// [INPUT]: the raw text a storage twin read back (anything, including nothing or garbage) and the system's color scheme.
// [OUTPUT]: `Appearance` ('system' | 'light' | 'dark'), `DEFAULT_APPEARANCE`, `APPEARANCE_LABEL`, `parseAppearance`, `serializeAppearance`, `resolveScheme`.
// [POS]: pure codec between `state/appearance-store` and `appearance-storage` (native file / web localStorage), plus the one rule that turns the person's choice and the system scheme into the palette the app draws. A harmless UI preference, never a credential.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
// Invariants: unreadable input is 'system' (never throws); an unknown system scheme (null) draws dark, the app's original look.
import { z } from 'zod';

import type { Scheme } from '@/theme/tokens';

export type Appearance = 'system' | 'light' | 'dark';

export const DEFAULT_APPEARANCE: Appearance = 'system';

/** The words the Settings row and the choice page show. */
export const APPEARANCE_LABEL: Record<Appearance, string> = { system: 'System', light: 'Light', dark: 'Dark' };

const schema = z.object({ appearance: z.enum(['system', 'light', 'dark']) });

export function parseAppearance(raw: string | null | undefined): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.appearance : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function serializeAppearance(appearance: Appearance): string {
  return JSON.stringify({ appearance });
}

export function resolveScheme(appearance: Appearance, system: 'light' | 'dark' | null | undefined): Scheme {
  if (appearance !== 'system') return appearance;
  return system === 'light' ? 'light' : 'dark';
}
