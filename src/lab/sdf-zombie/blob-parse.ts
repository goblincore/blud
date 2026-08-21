// src/lab/sdf-zombie/blob-parse.ts
import { type BlobBone, type BlobDoc, type BlobLine, BlobError } from './blob-ast';

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

const DIRS = ['up', 'down', 'side', 'fwd'] as const;
type DirName = (typeof DIRS)[number];

function dirArg(l: BlobLine): DirName {
  const hit = l.words.find(w => w.startsWith('dir='));
  if (!hit) throw new BlobError('missing required "dir="', l.line, l.indent + 1);
  const v = hit.slice(4) as DirName;
  if (!DIRS.includes(v))
    throw new BlobError(`dir must be one of ${DIRS.join('|')}, got "${v}"`, l.line, l.indent + 1);
  return v;
}

function strArg(l: BlobLine, key: string): string | null {
  const hit = l.words.find(w => w.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : null;
}

/**
 * Parses a whole document. Throws BlobError on the first problem.
 *
 * Only the `skeleton` block is handled so far (Task 2). `body` and `face`
 * lines are recognized enough to track section/nesting for `structure` (see
 * BlobDoc.structure doc comment — the emitter needs every unowned line, or it
 * silently drops block keywords on round-trip) but their content is parsed
 * by later tasks.
 */
export function parseBlob(src: string): BlobDoc {
  const lines = tokenize(src);
  const doc: BlobDoc = {
    name: '', height: null, rootBone: '', rootHeight: 0,
    bones: [], parts: [], face: null, faceTrivia: [], structure: [], trailingTrivia: [],
  };
  const known = new Set<string>();
  let inMirror = false;
  let mirrorOpenedAt = 0;
  let section = '';

  for (const l of lines) {
    const [head, ...rest] = l.words;

    if (head === 'model') { doc.name = rest[0] ?? ''; section = 'model'; doc.structure.push(l); continue; }
    if (head === 'height' && section === 'model') { doc.height = Number(rest[0]); doc.structure.push(l); continue; }
    if (head === 'skeleton' || head === 'body' || head === 'face') { section = head; doc.structure.push(l); continue; }

    if (section === 'skeleton') {
      if (head === 'mirror') { inMirror = true; mirrorOpenedAt = l.line; doc.structure.push(l); continue; }
      if (head === 'end') { inMirror = false; doc.structure.push(l); continue; }

      if (head === 'root') {
        doc.structure.push(l);
        doc.rootBone = rest[0]!;
        // Surface syntax is `root pelvis at 0.92` — space-separated, not
        // `at=`. Rewrap word 3 as `at=<value>` so `numArg` can parse and
        // report it with its normal column math; do not change the syntax.
        doc.rootHeight = numArg({ ...l, words: [`at=${l.words[3]}`] }, 'at');
        known.add(doc.rootBone);
        continue;
      }

      if (head === 'bone') {
        const name = rest[0]!;
        const parent = strArg(l, 'parent');
        if (parent === null) throw new BlobError('bone needs "parent="', l.line, l.indent + 1);
        if (!known.has(parent))
          throw new BlobError(`unknown parent "${parent}"`, l.line, l.indent + 1);
        doc.bones.push({
          name, parent, dir: dirArg(l),
          pitchDeg: numArg(l, 'pitch', 0), tiltDeg: numArg(l, 'tilt', 0),
          len: numArg(l, 'len'), side: numArg(l, 'side', 0),
          at: strArg(l, 'at') === null ? null : numArg(l, 'at'),
          mirror: inMirror, src: l,
        } satisfies BlobBone);
        known.add(name);
        continue;
      }
    }
  }

  if (inMirror) throw new BlobError('mirror block is never closed', mirrorOpenedAt, 1);
  if (!doc.rootBone) throw new BlobError('no "root" bone declared', 1, 1);
  return doc;
}
