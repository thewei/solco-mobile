// [INPUT]: theme/tokens (the T3 dark palette) and the app's own source files.
// [OUTPUT]: guards for the design system: text and status colors meet WCAG AA on the surfaces they are drawn on, and the
//           icon voice has one owner (Tabler through theme/glyphs, never lucide, never the package root).
// [POS]: Pure Node tests; the redesign's accessibility and "one icon set" claims are checked here, not by eye.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { activeScheme, colors, metrics, palettes, setActiveScheme, statusColors, themed } from './tokens';

type Rgb = [number, number, number];

function parse(color: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  if (!rgba) throw new Error(`unparseable color ${color}`);
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

/** The opaque color a translucent fill shows over a surface. */
function over(fill: string, surface: string): Rgb {
  const top = parse(fill);
  const base = parse(surface).rgb;
  return [0, 1, 2].map((i) => Math.round(top.rgb[i]! * top.alpha + base[i]! * (1 - top.alpha))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const solid = (color: string): Rgb => parse(color).rgb;

describe.each(['dark', 'light'] as const)('palette contrast, %s (WCAG AA, 4.5:1 for text, 3:1 for graphics)', (scheme) => {
  const c = palettes[scheme];
  const screens = { canvas: c.canvas, surface: c.surface, grouped: c.surfaceRaised, menu: c.menu, nav: c.nav, user: c.user };

  for (const [name, surface] of Object.entries(screens)) {
    it(`text and the muted text read on ${name}`, () => {
      expect(contrast(solid(c.text), solid(surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(solid(c.textMuted), solid(surface))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('accent text reads on every surface and on the tonal fill it is drawn on', () => {
    for (const surface of Object.values(screens)) {
      expect(contrast(solid(c.accentText), solid(surface))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(solid(c.accentText), over(c.accentSoft, c.canvas))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(c.accentText), over(c.accentSoft, c.surfaceRaised))).toBeGreaterThanOrEqual(4.5);
  });

  it('the quietest text is only used where it reads: the screen and the card, not the grouped fill', () => {
    expect(contrast(solid(c.textSubtle), solid(c.canvas))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(c.textSubtle), solid(c.surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('the accent fill is graphics-grade on the screen and carries white text', () => {
    expect(contrast(solid(c.accent), solid(c.canvas))).toBeGreaterThanOrEqual(3);
    expect(contrast(solid(c.onAccent), solid(c.accent))).toBeGreaterThanOrEqual(4.5);
  });

  it('source colors read on the screen, and the diff gutter reads on both diff tints', () => {
    for (const tone of [c.syntaxKeyword, c.syntaxString, c.syntaxName]) {
      expect(contrast(solid(tone), solid(c.canvas))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(solid(c.diffGutter), solid(c.diffAdd))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(c.diffGutter), solid(c.diffDelete))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(c.text), solid(c.diffAdd))).toBeGreaterThanOrEqual(4.5);
  });

  it('the toast reads: its text and its action on the inverted chip', () => {
    expect(contrast(solid(c.onToast), solid(c.toast))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(c.toastAction), solid(c.toast))).toBeGreaterThanOrEqual(4.5);
  });

  it('chevrons are graphics-grade on the grouped fill', () => {
    expect(contrast(solid(c.chevron), solid(c.surfaceRaised))).toBeGreaterThanOrEqual(3);
  });

  it('every status chip reads: its color on its own tint', () => {
    const chips: [string, string][] = [
      [c.attention, c.attentionSoft],
      [c.success, c.successSoft],
      [c.danger, c.dangerSoft],
    ];
    for (const [fg, bg] of chips) expect(contrast(solid(fg), solid(bg))).toBeGreaterThanOrEqual(4.5);
    setActiveScheme(scheme);
    try {
      for (const { color, background } of Object.values(statusColors)) {
        expect(contrast(solid(color), over(background, c.canvas))).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      setActiveScheme('dark');
    }
  });

  it('status colors read on the plain screen too (a dot-less label)', () => {
    for (const fg of [c.attention, c.success, c.danger]) {
      expect(contrast(solid(fg), solid(c.canvas))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('metrics', () => {
  it('keeps the touch floor at 44 dp and the app bar buttons at 48 dp', () => {
    expect(metrics.touch).toBe(44);
    expect(metrics.barButton).toBe(48);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'generated' && entry !== 'node_modules') walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(path);
  }
  return out;
}

const SRC = join(import.meta.dirname, '..');
const files = walk(SRC).map((path) => ({ rel: relative(SRC, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }));

describe('one icon voice', () => {
  it('has no lucide import left', () => {
    expect(files.filter((f) => /lucide-react-native/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it('imports Tabler glyphs only through theme/glyphs, one file each', () => {
    const offenders = files
      .filter((f) => f.rel !== 'theme/glyphs.ts')
      .filter((f) => /^import\s+(?!type\b)[^;]*from\s+'@tabler\/icons-react-native(\/[^']*)?'/m.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
    const glyphs = files.find((f) => f.rel === 'theme/glyphs.ts')!;
    const exportsLines = glyphs.text.split('\n').filter((l) => l.startsWith('export '));
    expect(exportsLines.length).toBeGreaterThan(0);
    for (const line of exportsLines) {
      expect(line).toMatch(/^export \{ default as (Icon\w+) \} from '@tabler\/icons-react-native\/\1';$/);
    }
  });

  it('keeps the glyph list sorted and free of duplicates', () => {
    const glyphs = files.find((f) => f.rel === 'theme/glyphs.ts')!;
    const names = glyphs.text.split('\n').flatMap((l) => /default as (\w+)/.exec(l)?.[1] ?? []);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
  });
});

describe('accent is a fill, accentText is the text', () => {
  it('no Text is colored with the fill-grade accent', () => {
    const offenders: string[] = [];
    for (const f of files) {
      f.text.split('\n').forEach((line, i) => {
        if (/<Text\b[^>]*\bcolor=\{[^}]*colors\.accent\b(?!Soft|Text|Dim)/.test(line)) offenders.push(`${f.rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('the live palette', () => {
  it('answers for the active scheme and every key exists in both appearances', () => {
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
    try {
      setActiveScheme('light');
      expect(activeScheme()).toBe('light');
      expect(colors.canvas).toBe(palettes.light.canvas);
      expect(colors.canvas).not.toBe(palettes.dark.canvas);
      setActiveScheme('dark');
      expect(colors.canvas).toBe(palettes.dark.canvas);
    } finally {
      setActiveScheme('dark');
    }
  });

  it('a themed table is read again after a scheme change', () => {
    const table = themed(() => ({ text: colors.text }));
    try {
      setActiveScheme('dark');
      const dark = table.text;
      setActiveScheme('light');
      expect(table.text).not.toBe(dark);
      expect(Object.keys(table)).toEqual(['text']);
    } finally {
      setActiveScheme('dark');
    }
  });

  it('light is a real light theme: the screen is brighter than the text', () => {
    expect(luminance(solid(palettes.light.canvas))).toBeGreaterThan(luminance(solid(palettes.light.text)));
    expect(luminance(solid(palettes.dark.canvas))).toBeLessThan(luminance(solid(palettes.dark.text)));
  });
});

describe('colors are read where they are drawn', () => {
  it('no module-level code reads `colors` or `statusColors` (a frozen value would not follow a scheme change; use themed(() => …))', async () => {
    const ts = (await import('typescript')).default;
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === 'theme/tokens.ts' || !/\b(colors|statusColors)\b/.test(f.text)) continue;
      const sf = ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, f.rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const inFunction = (node: import('typescript').Node) => {
        for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p) || ts.isClassLike(p)) return true;
        return false;
      };
      const visit = (node: import('typescript').Node) => {
        if (ts.isIdentifier(node) && (node.text === 'colors' || node.text === 'statusColors') && !ts.isImportSpecifier(node.parent) && !inFunction(node)) {
          offenders.push(`${f.rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });
});

describe('shared design language', () => {
  it('takes its roles and touch radii from the generated table', async () => {
    const { rolesDark, rolesLight, touchShape } = await import('./tokens.generated');
    const { radii } = await import('./tokens');
    expect(palettes.dark.canvas).toBe(rolesDark.canvas);
    expect(palettes.dark.accent).toBe(rolesDark.accent);
    expect(palettes.dark.attention).toBe(rolesDark.warn);
    expect(palettes.light.canvas).toBe(rolesLight.canvas);
    expect(palettes.light.accent).toBe(rolesLight.accent);
    expect(palettes.light.attention).toBe(rolesLight.warn);
    expect(radii.bubble).toBe(touchShape.bubble);
    expect(radii.lg).toBe(touchShape.composer);
  });

  it('keeps every registry glyph resolvable in the installed Tabler package', async () => {
    const { iconRegistry } = await import('./icons.generated');
    const dir = join(__dirname, '..', '..', 'node_modules', '@tabler', 'icons-react-native', 'dist', 'esm', 'icons');
    const pascal = (name: string) => 'Icon' + name.split('-').map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
    const missing = Object.values(iconRegistry)
      .map((i) => i.tabler)
      .filter((name) => !readdirSync(dir).some((f) => f.startsWith(pascal(name) + '.')));
    expect(missing).toEqual([]);
  });
});
