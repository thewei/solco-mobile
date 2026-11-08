import { describe, expect, it } from 'vitest';

import { buildTerminalPage } from './terminal-page';

const scriptsOf = (html: string) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');

describe('buildTerminalPage', () => {
  it('ships three inline scripts and every one of them parses', () => {
    const scripts = scriptsOf(buildTerminalPage('var xterm = 1;', '.xterm{}', 'var fit = 1;'));
    expect(scripts).toHaveLength(3);
    // `new Function` only parses the body; a stray newline inside a string literal (an unescaped `\n` in the template) throws here.
    for (const body of scripts) expect(() => new Function(body)).not.toThrow();
  });

  it('offers the handle the renderer injects calls into', () => {
    const glue = scriptsOf(buildTerminalPage('', '', ''))[2] ?? '';
    for (const name of ['writeB64', 'resize', 'focus', 'blur', 'toLive', 'readText']) expect(glue).toContain(`${name}:`);
  });
});
