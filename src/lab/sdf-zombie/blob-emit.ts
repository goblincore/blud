// src/lab/sdf-zombie/blob-emit.ts
import type { BlobDoc, BlobLine } from './blob-ast';

/**
 * Overrides to substitute into the emitted document. Each named value
 * replaces only its own token, spliced into the ORIGINAL line's raw text —
 * everything else on that line (indent, key, column padding, any trailing
 * comment) survives untouched. Anything not named here keeps its source
 * line byte-for-byte.
 *
 * `face` is the only override today because it's the one the whole format
 * exists to serve: `face.ts` tells the author to hand-copy tuned
 * `FaceParams` back into `DEFAULT_FACE` once they land, and that
 * transcription step is exactly the pain this substitution removes.
 */
export interface EmitOverride {
  /** Face parameters to substitute, by name. Omitted keys keep their source line. */
  face?: Record<string, number>;
}

/** One line paired with the face-parameter key it owns, if any. */
interface Owned {
  l: BlobLine;
  faceKey?: string;
}

/**
 * Splices a new value into a face-parameter line, keeping every other
 * character of the original raw line exactly as it was.
 *
 * This is deliberately NOT `indent + key + ' ' + value`: that reprints the
 * line with a single space between key and value, which destroys the
 * column alignment the shipped character files use to keep every value
 * starting at the same character — see zombie.blob's `face` block, where
 * `jawJut` carries five padding spaces to line its value up under
 * `headRadius`'s one. Overwriting only the value's own character span in
 * the original text leaves that alignment alone for every key except the
 * one actually being tuned, and carries along a same-line trailing comment
 * (if the line ever grows one) for free, since it's just more of the raw
 * text after the spliced span.
 */
function spliceFaceValue(l: BlobLine, oldText: string, newValue: number): string {
  // `oldText` is `l.words[1]` — the exact source substring for this line's
  // value, produced by splitting the SAME `raw` string this searches. It
  // must be found at or after the key, so a miss means `words` and `raw`
  // have drifted out of sync somehow. That should be unreachable given how
  // `tokenize` builds both fields from one `raw` line, but this throws
  // rather than silently splicing at the wrong spot (or emitting the
  // original, unoverridden number) if that invariant is ever broken —
  // matching this file's existing preference for a loud failure over a
  // quietly wrong `.blob` on disk.
  const keyEnd = l.indent + (l.words[0]?.length ?? 0);
  const valueStart = l.raw.indexOf(oldText, keyEnd);
  if (valueStart === -1) {
    throw new Error(
      `blob-emit: face line ${l.line} — could not find "${oldText}" in its own source line ` +
        `("${l.raw}") at or after column ${keyEnd + 1}; refusing to guess where to splice`,
    );
  }
  return l.raw.slice(0, valueStart) + String(newValue) + l.raw.slice(valueStart + oldText.length);
}

/**
 * Writes a document back out as `.blob` source.
 *
 * Every node — `BlobBone`, `BlobPart`, and each face-parameter line — kept
 * its originating `BlobLine` (see `blob-ast.ts`), including that line's
 * exact `raw` text. Emitting is therefore mostly REPLAYING those lines in
 * source order rather than re-printing values from the parsed fields:
 * `raw` already carries the original indent, inter-word column padding,
 * and any trailing comment, so reusing it verbatim is what makes comment
 * and alignment preservation fall out for free instead of needing separate
 * handling for each. `words.join(' ')` was tried and rejected for this —
 * `tokenize` splits on `/\s+/`, which collapses the multi-space padding
 * these character files use to keep `len=`/`blend=` in tidy columns, so
 * rebuilding from `words` alone would silently re-flow every aligned block
 * to single spaces on the very first save.
 *
 * Ordering is by source `line` number across EVERY owner — bones, parts,
 * face lines, and the structural keywords in `doc.structure` (`model`,
 * `skeleton`, `body`, `face`, `mirror`, `end`, `height`, `root`). Miss the
 * structural lines and the output silently loses every block keyword while
 * still parsing as some document afterward — exactly the kind of quiet
 * corruption this file exists to avoid.
 */
export function emitBlob(doc: BlobDoc, override: EmitOverride = {}): string {
  const owned: Owned[] = [
    ...doc.structure.map((l): Owned => ({ l })),
    ...doc.bones.map((b): Owned => ({ l: b.src })),
    ...doc.parts.map((p): Owned => ({ l: p.src })),
    // `faceTrivia` lines are `key value` pairs — `parseFaceLine` throws
    // before pushing one that doesn't have both, so `words[0]` is always
    // present here even though its type is `string | undefined`.
    ...doc.faceTrivia.map((l): Owned => ({ l, faceKey: l.words[0]! })),
  ].sort((a, b) => a.l.line - b.l.line);

  const out: string[] = [];
  for (const { l, faceKey } of owned) {
    out.push(...l.leading);
    const overrideValue = faceKey === undefined ? undefined : override.face?.[faceKey];
    out.push(
      overrideValue === undefined
        // Same guarantee as `faceKey` above: a `faceTrivia` line always has
        // a second word (the value), so `words[1]` is safe to assert here.
        ? l.raw
        : spliceFaceValue(l, l.words[1]!, overrideValue),
    );
  }
  out.push(...doc.trailingTrivia);

  // `trailingTrivia` carries whatever `tokenize` left over after the last
  // significant line — for a file that simply ends with a newline (every
  // shipped `.blob` today) that's a single `''` from splitting on the
  // file's own final `\n`, not a real trailing blank line in the source.
  // `trimEnd()` absorbs that (and any genuine trailing blanks/comments'
  // surrounding blank lines) so the emitted file always ends in exactly one
  // `\n`, regardless of how the source ended — matching every `.blob` file
  // already in the repo and making `emitBlob(parseBlob(x))` stable under a
  // second `parseBlob`/`emitBlob` pass (idempotence).
  return out.join('\n').trimEnd() + '\n';
}
