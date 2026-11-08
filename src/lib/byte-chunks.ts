// [INPUT]: a list of byte chunks.
// [OUTPUT]: `concatBytes` — one Uint8Array holding the chunks back to back (the same array when there is one chunk).
// [POS]: tiny pure helper for renderers that coalesce frames before one native-bridge call (ghostty-terminal);
//        base64-encode the merged bytes ONCE — joining per-chunk base64 strings is unsafe because each chunk's '='
//        padding ends a strict decoder.
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
