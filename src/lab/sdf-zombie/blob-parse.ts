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
 * Mutable state threaded through the per-section line handlers below.
 * `doc` accumulates the parse result; `known`/`inMirror`/`mirrorOpenedAt`
 * are skeleton-specific bookkeeping that only `parseSkeletonLine` reads or
 * writes today, but live here (rather than as closured locals in
 * `parseBlob`) so a future section handler can share the shape without a
 * second ad-hoc state object.
 */
interface ParseState {
  doc: BlobDoc;
  known: Set<string>;
  inMirror: boolean;
  mirrorOpenedAt: number;
}

/**
 * Handles one line already known to be inside a `skeleton` block:
 * `mirror`/`end`, `root`, or `bone`. Any other keyword is a mistake in the
 * document — most likely a typo — and must be loud about it. Silently
 * skipping it would both drop a bone the author thought they declared AND
 * (since the line isn't pushed to `doc.structure` either) delete the line
 * outright the next time Task 8's emitter round-trips the document.
 */
function parseSkeletonLine(l: BlobLine, s: ParseState): void {
  const [head, ...rest] = l.words;

  if (head === 'mirror') { s.inMirror = true; s.mirrorOpenedAt = l.line; s.doc.structure.push(l); return; }
  if (head === 'end') { s.inMirror = false; s.doc.structure.push(l); return; }

  if (head === 'root') {
    s.doc.structure.push(l);
    s.doc.rootBone = rest[0]!;
    // Surface syntax is `root pelvis at 0.92` — space-separated, not
    // `at=` — so this can't reuse `numArg` directly. It used to anyway, by
    // wrapping word 3 in a fake single-word `BlobLine` and calling
    // `numArg` on that. That broke `wordCol`'s column math (which sums the
    // lengths of the PRECEDING words to find where word 3 starts): with a
    // one-element `words` array there are no preceding words to sum, so
    // every error landed on col = indent + 1 — the "r" of "root" — no
    // matter where "at"'s value actually was. Reading the word directly
    // and using the real `wordCol(l, 3)` fixes that.
    const atWord = l.words[3];
    if (atWord === undefined)
      throw new BlobError('root needs "at <height>"', l.line, wordCol(l, 3));
    const height = Number(atWord);
    if (!Number.isFinite(height))
      throw new BlobError('"at" value is not a number', l.line, wordCol(l, 3));
    s.doc.rootHeight = height;
    s.known.add(s.doc.rootBone);
    return;
  }

  if (head === 'bone') {
    const name = rest[0]!;
    const parent = strArg(l, 'parent');
    if (parent === null) throw new BlobError('bone needs "parent="', l.line, l.indent + 1);
    if (!s.known.has(parent))
      throw new BlobError(`unknown parent "${parent}"`, l.line, l.indent + 1);
    s.doc.bones.push({
      name, parent, dir: dirArg(l),
      pitchDeg: numArg(l, 'pitch', 0), tiltDeg: numArg(l, 'tilt', 0),
      len: numArg(l, 'len'), side: numArg(l, 'side', 0),
      at: strArg(l, 'at') === null ? null : numArg(l, 'at'),
      mirror: s.inMirror, src: l,
    } satisfies BlobBone);
    s.known.add(name);
    return;
  }

  throw new BlobError(`unrecognized "${head}" in skeleton block`, l.line, l.indent + 1);
}

/**
 * `body` and `face` sections don't have a grammar yet — Task 3 adds one to
 * each. Until then, every line inside either section is accepted and
 * silently skipped: not validated, not pushed to `doc.structure`. That's
 * deliberately permissive rather than strict like `parseSkeletonLine`,
 * because there is no real grammar yet to be strict against — treating an
 * unrecognized `body`/`face` line as an error today would stop a document
 * with either section from parsing at all, before Task 3 exists to give it
 * one. Task 3 replaces these stubs with real per-line parsing and gets the
 * same strictness `parseSkeletonLine` already has.
 */
function parseBodyLine(_l: BlobLine, _s: ParseState): void {}
function parseFaceLine(_l: BlobLine, _s: ParseState): void {}

/**
 * Parses a whole document. Throws BlobError on the first problem.
 *
 * Only the `skeleton` block is fully implemented so far (Task 2) — see
 * `parseBodyLine`/`parseFaceLine` above for the current state of the other
 * two.
 */
export function parseBlob(src: string): BlobDoc {
  const lines = tokenize(src);
  const s: ParseState = {
    doc: {
      name: '', height: null, rootBone: '', rootHeight: 0,
      bones: [], parts: [], face: null, faceTrivia: [], structure: [], trailingTrivia: [],
    },
    known: new Set<string>(),
    inMirror: false,
    mirrorOpenedAt: 0,
  };
  let section = '';

  for (const l of lines) {
    const [head, ...rest] = l.words;

    if (head === 'model') { s.doc.name = rest[0] ?? ''; section = 'model'; s.doc.structure.push(l); continue; }
    if (head === 'height' && section === 'model') { s.doc.height = Number(rest[0]); s.doc.structure.push(l); continue; }
    if (head === 'skeleton' || head === 'body' || head === 'face') { section = head; s.doc.structure.push(l); continue; }

    if (section === 'skeleton') { parseSkeletonLine(l, s); continue; }
    if (section === 'body') { parseBodyLine(l, s); continue; }
    if (section === 'face') { parseFaceLine(l, s); continue; }
  }

  if (s.inMirror) throw new BlobError('mirror block is never closed', s.mirrorOpenedAt, 1);
  if (!s.doc.rootBone) throw new BlobError('no "root" bone declared', 1, 1);
  return s.doc;
}
