// [INPUT]: a file's path and its text (the Host's `text` preview).
// [OUTPUT]: languageOf (the highlight.js language an extension means, or null), highlightLines (the text as lines of colored
//           segments), and the plain fallback when a file is too large or its language unknown.
// [POS]: Pure model behind the phone's file viewer syntax colors (designs/mobile-t3-redesign `File`: keywords, strings, comments and
//        names in four tones). highlight.js is the same engine the desktop Chat page's code blocks use (rehype-highlight); only the
//        core and the languages a phone is likely to open are registered. Highlighting is skipped past `HIGHLIGHT_MAX_CHARS` — a long
//        file stays plain rather than stalling the phone's JS thread.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = { bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, kotlin, markdown, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);

export type Tone = 'plain' | 'keyword' | 'string' | 'comment' | 'name';
export interface Segment {
  text: string;
  tone: Tone;
}

/** Past this many characters a file is shown plain: highlight.js is synchronous and the phone's JS thread is shared. */
export const HIGHLIGHT_MAX_CHARS = 120_000;

const BY_EXTENSION: Record<string, string> = {
  go: 'go', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rs: 'rust', swift: 'swift', kt: 'kotlin', kts: 'kotlin', java: 'java', sh: 'bash', bash: 'bash', zsh: 'bash', json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', css: 'css', scss: 'scss', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', plist: 'xml', md: 'markdown', markdown: 'markdown',
  sql: 'sql', rb: 'ruby', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', toml: 'ini', ini: 'ini', diff: 'diff', patch: 'diff',
};

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (name === 'dockerfile' || name === 'makefile') return null;
  const dot = name.lastIndexOf('.');
  return dot < 0 ? null : (BY_EXTENSION[name.slice(dot + 1)] ?? null);
}

/** highlight.js class → tone: the draft's four colors. Anything else keeps the text color. */
const TONES: [RegExp, Tone][] = [
  [/\bhljs-(comment|quote|meta|doctag)\b/, 'comment'],
  [/\bhljs-(string|regexp|char|symbol|bullet|addition|template-tag|template-variable)\b/, 'string'],
  [/\bhljs-(keyword|built_in|type|literal|number|selector-tag|section|deletion)\b/, 'keyword'],
  [/\bhljs-(title|name|attr|attribute|selector-class|selector-id|function)\b/, 'name'],
];

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
const unescape = (text: string) => text.replace(/&(lt|gt|amp|quot|#x27|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** The code as lines of segments; one plain segment per line when the language is unknown or the text too long. */
export function highlightLines(code: string, language: string | null): Segment[][] {
  const lines = code.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const plain = () => lines.map((line) => [{ text: line, tone: 'plain' as const }]);
  if (!language || code.length > HIGHLIGHT_MAX_CHARS) return plain();
  let html: string;
  try {
    html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return plain();
  }
  const out: Segment[][] = [[]];
  const stack: Tone[] = [];
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    if (match[1] !== undefined) {
      const hit = TONES.find(([pattern]) => pattern.test(match[1]!));
      stack.push(hit ? hit[1] : (stack[stack.length - 1] ?? 'plain'));
    } else if (match[2] === undefined) {
      stack.pop();
    } else {
      const tone = stack[stack.length - 1] ?? 'plain';
      const pieces = unescape(match[2]).split('\n');
      pieces.forEach((piece, index) => {
        if (index > 0) out.push([]);
        if (piece) out[out.length - 1]!.push({ text: piece, tone });
      });
    }
  }
  // A trailing newline leaves one empty line behind, like codeLines.
  if (out.length > 1 && out[out.length - 1]!.length === 0) out.pop();
  return out.map((line) => (line.length === 0 ? [{ text: '', tone: 'plain' as const }] : line));
}
