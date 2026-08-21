// src/lab/sdf-zombie/blob-parse.ts
import { type BlobLine, BlobError } from './blob-ast';

/**
 * Splits source into significant lines, hanging comment/blank trivia off the
 * next significant line. Deliberately dumb: no grammar knowledge lives here,
 * so the grammar can change without risking the trivia contract.
 */
export function tokenize(src: string): BlobLine[] {
  const out: BlobLine[] = [];
  let leading: string[] = [];

  src.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      // A trailing blank at end of file is not trivia for anything; the
      // document collects those separately.
      leading.push(trimmed);
      return;
    }

    // A trailing comment belongs to THIS line, not the next one.
    const hash = raw.indexOf('#');
    const code = (hash === -1 ? raw : raw.slice(0, hash)).trimEnd();
    const trailing = hash === -1 ? null : raw.slice(hash).trim();

    out.push({
      line,
      indent: raw.length - raw.trimStart().length,
      words: code.trim().split(/\s+/).filter(Boolean),
      leading,
      trailing,
    });
    leading = [];
  });

  return out;
}

/**
 * 1-based character column of `l.words[idx]`, reconstructed as
 * `indent + words joined by single spaces`.
 *
 * `BlobLine` doesn't retain the raw line text, so this is a reconstruction
 * rather than a measurement, and it is exact only for lines whose words really
 * were separated by ONE space each. `tokenize` splits on `\s+`, so a source
 * line padded for column alignment — which the shipped character files do, to
 * keep `len=` and `blend=` in tidy columns — reconstructs one character short
 * per extra space, and the drift grows across the line.
 *
 * That is accepted: the column exists to point a human at roughly the right
 * token, and being a few characters early on an aligned line still does that.
 * Retaining the raw text on every `BlobLine` to make it exact would cost more
 * than the precision is worth. Do NOT "fix" this by changing `BlobLine` — the
 * emitter's trivia contract depends on that shape.
 */
function wordCol(l: BlobLine, idx: number): number {
  let col = l.indent;
  for (let i = 0; i < idx; i++) col += l.words[i]!.length + 1; // +1 for the separating space
  return col + 1; // 1-based
}

/**
 * `key=value` → value, with a typed error naming the offending line.
 *
 * `BlobError.col` is always a 1-based CHARACTER offset into the source
 * line — never a word index. Keep it that way in both throw sites below;
 * an editor integration (or the author, reading the message) uses `col` to
 * jump to the exact spot, and a word index silently points at the wrong
 * character on any line with a key that isn't the first word.
 */
export function numArg(l: BlobLine, key: string, fallback: number | null = null): number {
  const idx = l.words.findIndex(w => w.startsWith(`${key}=`));
  if (idx === -1) {
    if (fallback !== null) return fallback;
    throw new BlobError(`missing required "${key}="`, l.line, l.indent + 1);
  }
  const hit = l.words[idx]!;
  const v = Number(hit.slice(key.length + 1));
  if (!Number.isFinite(v))
    throw new BlobError(`"${key}=" is not a number`, l.line, wordCol(l, idx));
  return v;
}
