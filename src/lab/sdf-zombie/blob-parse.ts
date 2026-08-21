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

/** `key=value` → value, with a typed error naming the offending line. */
export function numArg(l: BlobLine, key: string, fallback: number | null = null): number {
  const hit = l.words.find(w => w.startsWith(`${key}=`));
  if (hit === undefined) {
    if (fallback !== null) return fallback;
    throw new BlobError(`missing required "${key}="`, l.line, l.indent + 1);
  }
  const v = Number(hit.slice(key.length + 1));
  if (!Number.isFinite(v))
    throw new BlobError(`"${key}=" is not a number`, l.line, l.words.indexOf(hit) + 1);
  return v;
}
