// [INPUT]: no runtime input; token values are the approved Solco Mobile visual vocabulary (designs/mobile-t3-redesign,
//          decided 2026-11-07: T3 Code's palette in both appearances, DM Sans, Tabler icons; `THEMES` in its `src/kit.mjs` is the value source).
// [OUTPUT]: colors, spacing, typography, radii, metrics and status mappings consumed by presentation.
// [POS]: single app-shell theme authority (the roles and radii it shares with the desktop come from tokens.generated.ts, written by solco's design/gen.mjs); Hosted Herdr TUI colors are not defined here. The semantic names are older than
//        the palette: `canvas` is the screen (the content card), `surface` the card, `surfaceRaised` the grouped fill.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import { rolesDark, rolesLight, touchShape } from './tokens.generated';

export type Scheme = 'light' | 'dark';

/** The phone-only colors (the shared roles come from tokens.generated.ts); light values measured from T3 Code's light theme (kit.mjs `THEMES.light`). */
function palette(r: typeof rolesDark | typeof rolesLight, own: Own) {
  return {
    /** The header band (status bar + app bar) the rounded content card sits on. */
    chrome: r.chrome,
    /** The screen: page background and the content card. */
    canvas: r.canvas,
    /** Cards and inputs on the screen. */
    surface: r.surface,
    /** Grouped lists, hero cards, chips. */
    surfaceRaised: r.grouped,
    surfacePressed: own.surfacePressed,
    /** Bottom navigation bar and its pill indicator. */
    nav: own.nav,
    navIndicator: own.navIndicator,
    /** Popover menus and bottom sheets. */
    menu: r.raised,
    /** The user's chat bubble and the pressed state of a plain row. */
    user: r.user,
    rowPressed: own.rowPressed,
    composer: own.composer,
    composerBorder: own.composerBorder,
    border: r.line,
    borderStrong: r.lineStrong,
    text: r.text,
    textMuted: r.muted,
    /** The quietest text; 4.5:1 on the screen and the card. Never lighter (the chevron gray is below that). */
    textSubtle: own.textSubtle,
    /** Row chevrons and other glyphs that carry no text (graphics need 3:1). */
    chevron: own.chevron,
    /** Fills, borders, switch tracks: graphics-grade, not text-grade. */
    accent: r.accent,
    /** Accent text and icons. */
    accentText: r.accentText,
    /** The tonal fill behind accent text and the selected chip. */
    accentSoft: r.accentSoft,
    /** A disabled primary fill (the send button before there is text). */
    accentDim: own.accentDim,
    onAccent: r.onAccent,
    attention: r.warn,
    attentionSoft: r.warnSoft,
    success: r.ok,
    successSoft: r.okSoft,
    danger: r.danger,
    dangerSoft: r.dangerSoft,
    /** diff row backgrounds: added / removed lines */
    diffAdd: own.diffAdd,
    diffDelete: own.diffDelete,
    terminal: own.terminal,
    scrim: r.scrim,
    /** Loading skeleton pulse. */
    skeleton: own.skeleton,
    skeletonHigh: own.skeletonHigh,
    /** The search hit inside a title. */
    highlight: own.highlight,
    /** The selected segment of a segmented control (one step above the grouped fill it sits in). */
    segmentSelected: own.segmentSelected,
    /** Source code tones (the file viewer; comments use `textMuted`). */
    syntaxKeyword: own.syntaxKeyword,
    syntaxString: own.syntaxString,
    syntaxName: own.syntaxName,
    /** Line numbers and +/- signs inside a diff row, one step brighter (dark) / darker (light) than the muted text so they read on the add / delete tints. */
    diffGutter: own.diffGutter,
    /** The translucent pill/button face drawn over a live picture (Remote Desktop): the scheme's surface at ~90 %. */
    glass: own.glass,
    /** The usage meter: its track and its fill while the window is under the warning level. */
    meterTrack: own.meterTrack,
    meterFill: own.meterFill,
    /** The toast: an inverted chip (light on the dark screen, dark on the light one). Its action is tuned to read on the chip. */
    toast: own.toast,
    onToast: own.onToast,
    toastAction: own.toastAction,
  };
}

type Own = Record<
  | 'surfacePressed' | 'nav' | 'navIndicator' | 'rowPressed' | 'composer' | 'composerBorder' | 'textSubtle' | 'chevron' | 'accentDim'
  | 'diffAdd' | 'diffDelete' | 'terminal' | 'skeleton' | 'skeletonHigh' | 'highlight' | 'segmentSelected' | 'syntaxKeyword'
  | 'syntaxString' | 'syntaxName' | 'diffGutter' | 'glass' | 'meterTrack' | 'meterFill' | 'toast' | 'onToast' | 'toastAction',
  string
>;

export type ColorSet = ReturnType<typeof palette>;

export const palettes: Record<Scheme, ColorSet> = {
  dark: palette(rolesDark, {
    surfacePressed: '#222222',
    nav: '#151515',
    navIndicator: '#363636',
    rowPressed: '#141414',
    composer: 'rgba(26, 27, 27, 0.9)',
    composerBorder: 'rgba(60, 60, 60, 0.6)',
    textSubtle: '#808080',
    chevron: '#6B6B6B',
    accentDim: 'rgba(52, 107, 241, 0.28)',
    diffAdd: '#0F2A1D',
    diffDelete: '#301214',
    terminal: '#0A0A0A',
    skeleton: '#161616',
    skeletonHigh: '#202020',
    highlight: 'rgba(52, 107, 241, 0.18)',
    segmentSelected: '#2A2B2B',
    syntaxKeyword: '#C586C0',
    syntaxString: '#8FC27D',
    syntaxName: '#7AA2F7',
    diffGutter: '#B5B5B5',
    glass: 'rgba(17, 17, 17, 0.88)',
    meterTrack: '#262626',
    meterFill: '#4A4A4A',
    toast: '#F5F5F5',
    onToast: '#0A0A0A',
    toastAction: '#1B4ED8',
  }),
  light: palette(rolesLight, {
    surfacePressed: '#f0f0f3',
    nav: '#eaeaea',
    navIndicator: '#c1c1c1',
    rowPressed: '#f4f4f5',
    composer: 'rgba(244, 244, 245, 0.94)',
    composerBorder: 'rgba(228, 228, 231, 0.9)',
    textSubtle: '#72727b',
    chevron: '#85858f',
    accentDim: 'rgba(27, 78, 216, 0.22)',
    diffAdd: '#e6f4ec',
    diffDelete: '#fcebec',
    terminal: '#fcfcfc',
    skeleton: '#ececef',
    skeletonHigh: '#f6f6f8',
    highlight: 'rgba(27, 78, 216, 0.14)',
    segmentSelected: '#ffffff',
    syntaxKeyword: '#9333ea',
    syntaxString: '#15803d',
    syntaxName: '#1d4ed8',
    diffGutter: '#52525b',
    glass: 'rgba(252, 252, 252, 0.92)',
    meterTrack: '#e4e4e7',
    meterFill: '#9a9aa3',
    toast: '#27272a',
    onToast: '#fcfcfc',
    toastAction: '#8fb0ff',
  }),
};

let active: Scheme = 'dark';

/** The appearance every `colors` read answers for. The root layout sets it before it renders a frame (see `state/appearance`). */
export function setActiveScheme(scheme: Scheme): void {
  active = scheme;
}

export function activeScheme(): Scheme {
  return active;
}

/**
 * The live palette. Same names and same call sites as the dark-only era: each property reads the active scheme at the
 * moment it is used, so a value must be read inside a component or a function, never frozen into a module-level
 * constant (use `themed` for a lookup table). The root layout remounts the tree when the scheme changes.
 */
export const colors: ColorSet = Object.defineProperties(
  {},
  Object.fromEntries(
    (Object.keys(palettes.dark) as (keyof ColorSet)[]).map((key) => [key, { enumerable: true, get: () => palettes[active][key] }]),
  ),
) as ColorSet;

/** A table of colors that stays correct across a scheme change: `factory` runs again on every read. */
export function themed<T extends object>(factory: () => T): T {
  return new Proxy({} as T, {
    get: (_, key) => (factory() as Record<PropertyKey, unknown>)[key],
    has: (_, key) => key in factory(),
    ownKeys: () => Reflect.ownKeys(factory()),
    getOwnPropertyDescriptor: (_, key) => {
      const value = (factory() as Record<PropertyKey, unknown>)[key];
      return key in factory() ? { enumerable: true, configurable: true, value } : undefined;
    },
  });
}

export const radii = {
  /** Workspace badge, inline code. */
  xs: 5,
  /** Popover menu corner. */
  menu: 6,
  /** Skeleton bars, the usage meter, the dashed "show more" button. */
  block: 7,
  /** Code blocks, key caps, small controls. */
  sm: touchShape.control,
  /** The diff card. */
  diff: 14,
  /** The extended FAB, banners, text areas in sheets. */
  control: 16,
  /** Buttons and thread rows. */
  md: touchShape.row,
  /** Chat bubbles, dock cards, the search field. */
  bubble: touchShape.bubble,
  /** The toast chip. */
  toast: 26,
  /** Grouped lists, hero cards, the composer and the content card's top corners. */
  lg: touchShape.composer,
  pill: touchShape.pill,
} as const;

export const spacing = {
  /** The gutter of every list and card on the screen. */
  screen: 17.5,
  /** Above the first Section of a scrolling page. */
  firstSection: 12,
  section: 22,
  card: 14,
  compact: 8,
} as const;

/** One icon voice (Tabler): round-capped lines at a constant width, filled variants for the active state. */
export const icons = {
  stroke: 2,
  /** The pin dot of a thread row. */
  dot: 11,
  /** Beside 13 dp text: status glyph, host laptop. */
  xs: 13,
  /** The route chips of a host card. */
  route: 14,
  /** Chevrons, the copy button. */
  sm: 16,
  /** The search field's clear button, file-diff rows. */
  inline: 18,
  /** Menu rows, the banner glyph, list-row trailing marks. */
  md: 20,
  /** App-bar buttons, bottom-bar tabs, list-row leading glyphs. */
  lg: 24,
  /** The glyph of an empty state's round tile. */
  hero: 30,
} as const;

/** The type scale (size / line height in dp): every text role of the redesign, one row each. */
export const type = {
  micro: { fontSize: 11, lineHeight: 14 },
  caption: { fontSize: 12, lineHeight: 16 },
  small: { fontSize: 13, lineHeight: 17 },
  label: { fontSize: 14, lineHeight: 19 },
  body: { fontSize: 16, lineHeight: 23 },
  title: { fontSize: 18, lineHeight: 23 },
  appbar: { fontSize: 21, lineHeight: 28 },
  hero: { fontSize: 26, lineHeight: 32 },
  display: { fontSize: 30, lineHeight: 36 },
} as const;

/** Chrome metrics of the redesign: the touch floor, the app bar, the bottom bar and the extended FAB. */
export const metrics = {
  /** Minimum touch box (dp). */
  touch: 44,
  /** Round icon button in the app bar. */
  barButton: 48,
  appBar: { height: 56, paddingBottom: 7 },
  nav: { height: 80, pill: { width: 56, height: 32 } },
  fab: { height: 56, bottom: 16, right: 16 },
  menu: { width: 250, row: 48 },
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

/**
 * DM Sans, one family name per weight: React Native on Android picks a custom font by family name, never by
 * `fontWeight`. `tamagui.config.ts` maps every weight a screen asks for onto these three; `fonts.ts` loads them.
 * DM Sans has no CJK glyphs, so Chinese text falls back to the system font.
 */
export const fontFamilies = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
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
export const statusColors: Record<string, { color: string; background: string }> = themed(() => ({
  blocked: { color: colors.attention, background: colors.attentionSoft },
  working: { color: colors.accentText, background: colors.accentSoft },
  done: { color: colors.success, background: colors.successSoft },
  idle: { color: colors.textMuted, background: colors.surfaceRaised },
  unknown: { color: colors.textMuted, background: colors.surfaceRaised },
}));
