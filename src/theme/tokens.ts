// [INPUT]: no runtime input; token values are the approved Solco Mobile visual vocabulary.
// [OUTPUT]: colors, spacing, typography, radii, and status mappings consumed by presentation.
// [POS]: single app-shell theme authority; Hosted Herdr TUI colors are not defined here.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

export const colors = {
  canvas: '#08090C',
  surface: '#111318',
  surfaceRaised: '#171A21',
  surfacePressed: '#1D212A',
  border: '#252A35',
  borderStrong: '#353C4B',
  text: '#F5F6FA',
  textMuted: '#969CAA',
  textSubtle: '#676D7B',
  accent: '#7C8CFF',
  accentSoft: '#232944',
  attention: '#F4B35F',
  attentionSoft: '#2D241A',
  success: '#5FD38D',
  successSoft: '#17271F',
  danger: '#FF7474',
  /** diff row backgrounds: added / removed lines */
  diffAdd: '#12261A',
  diffDelete: '#2A1517',
  terminal: '#0C0E12',
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  pill: 999,
} as const;

export const spacing = {
  screen: 18,
  section: 22,
  card: 14,
  compact: 8,
} as const;

/** One icon voice (iOS-like): thin round-capped lines at a constant pixel width, whatever the size. */
export const icons = {
  stroke: 1.5,
  sm: 16,
  md: 20,
  lg: 24,
} as const;

/** The rounded tile behind a key entry icon (settings-row style) and the shared list-row metrics. */
export const tile = {
  size: 34,
  radius: 10,
} as const;

export const row = {
  minHeight: 56,
  padX: 16,
  padY: 12,
  gap: 12,
} as const;

/** Press and entrance feel shared by every tappable surface (Tamagui `quick` spring + Reanimated layout). */
export const motion = {
  press: 0.97,
  enterMs: 220,
  exitMs: 140,
  stagger: 28,
  maxAnimated: 6,
} as const;

/** Platform-appropriate monospace font stack for terminal/code surfaces. */
export const monoFont = {
  web: 'ui-monospace, Menlo, Consolas, monospace',
  ios: 'Menlo',
  android: 'monospace',
} as const;

/** Pad/desktop breakpoint (CSS px). Below → phone layout; at or above → wide layout. */
export const breakpoints = {
  wide: 600,
} as const;

/** Agent status → color/background — single source consumed by AgentCard, AgentHeader, and control actions. */
export const statusColors: Record<string, { color: string; background: string }> = {
  blocked: { color: colors.attention, background: colors.attentionSoft },
  working: { color: colors.accent, background: colors.accentSoft },
  done: { color: colors.success, background: colors.successSoft },
  idle: { color: colors.textMuted, background: colors.surfaceRaised },
  unknown: { color: colors.textMuted, background: colors.surfaceRaised },
};
