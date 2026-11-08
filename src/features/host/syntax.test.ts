import { describe, expect, it } from 'vitest';

import { highlightLines, HIGHLIGHT_MAX_CHARS, languageOf } from '@/features/host/syntax';

const toneOf = (line: ReturnType<typeof highlightLines>[number], text: string) => line.find((segment) => segment.text === text)?.tone;

describe('syntax colors', () => {
  it('maps an extension to a language and leaves the unknown plain', () => {
    expect(languageOf('internal/remotehost/server.go')).toBe('go');
    expect(languageOf('src/app/Chat.TSX')).toBe('typescript');
    expect(languageOf('Dockerfile')).toBeNull();
    expect(languageOf('notes')).toBeNull();
    expect(languageOf('archive.tar.gz')).toBeNull();
  });

  it('colors keywords, strings, comments and names the way the draft does', () => {
    const lines = highlightLines('package remotehost\n\nimport "context"\n\n// Find it.\nfunc Find() string { return "x" }\n', 'go');
    expect(lines).toHaveLength(6);
    expect(toneOf(lines[0]!, 'package')).toBe('keyword');
    expect(toneOf(lines[2]!, '"context"')).toBe('string');
    expect(toneOf(lines[4]!, '// Find it.')).toBe('comment');
    expect(toneOf(lines[5]!, 'func')).toBe('keyword');
    expect(toneOf(lines[5]!, 'Find')).toBe('name');
    expect(toneOf(lines[5]!, 'string')).toBe('keyword');
    // Segments join back to the original line.
    expect(lines[5]!.map((segment) => segment.text).join('')).toBe('func Find() string { return "x" }');
  });

  it('keeps a multi-line token colored on every line it spans, and unescapes entities', () => {
    const lines = highlightLines('/* a < b\n   && c */\nconst x = 1;\n', 'javascript');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.every((segment) => segment.tone === 'comment')).toBe(true);
    expect(lines[1]!.map((segment) => segment.text).join('')).toBe('   && c */');
    expect(lines[1]!.some((segment) => segment.tone === 'comment')).toBe(true);
    expect(toneOf(lines[2]!, 'const')).toBe('keyword');
  });

  it('shows an unknown language, a huge file and an empty file plain, line for line', () => {
    expect(highlightLines('a\nb\n', null)).toEqual([[{ text: 'a', tone: 'plain' }], [{ text: 'b', tone: 'plain' }]]);
    const huge = `${'x\n'.repeat(HIGHLIGHT_MAX_CHARS)}`;
    expect(highlightLines(huge, 'go').every((line) => line[0]!.tone === 'plain')).toBe(true);
    expect(highlightLines('', 'go')).toEqual([[{ text: '', tone: 'plain' }]]);
    expect(highlightLines('\n\n', 'go').map((line) => line[0]!.text)).toEqual(['', '']);
  });
});
