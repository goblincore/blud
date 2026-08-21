// src/lab/sdf-zombie/blob-parse.ts
import { type BlobBone, type BlobDoc, type BlobLine, type BlobPart, type BlobPartKind, BlobError } from './blob-ast';

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
 * Handles one line already known to be inside a `body` block: `blob`, `bar`,
 * or `carve`. Like `parseSkeletonLine`, an unrecognized keyword throws
 * rather than vanishing — silently skipping it would drop the part from
 * both `doc.parts` and the emitter's output, which is exactly the kind of
 * silent data loss a typo in a character file must not cause.
 *
 * `blob`/`bar` both name a limb as their second word (`blob torso on
 * spine`); `carve` doesn't — `carve on spine ...` targets a bone directly,
 * with no limb word to read — so its `limb` is hardcoded to `'head'` rather
 * than read from `rest[0]`. (Carves in this lab are head/face detail cuts;
 * if a body carve ever needs a different limb, `'head'` would need to
 * become a real word in the grammar, not stay guessed here.)
 */
function parseBodyLine(l: BlobLine, s: ParseState): void {
  const [head, ...rest] = l.words;
  const kind = head as BlobPartKind;
  if (kind !== 'blob' && kind !== 'bar' && kind !== 'carve')
    throw new BlobError(`unrecognized "${head}" in body block`, l.line, l.indent + 1);

  // `carve on skull ...` has no limb word; `blob torso on spine ...` does.
  const onIdx = l.words.indexOf('on');
  if (onIdx === -1) throw new BlobError(`${kind} needs "on <bone>"`, l.line, l.indent + 1);
  const bone = l.words[onIdx + 1];
  if (bone === undefined) throw new BlobError(`${kind} needs "on <bone>"`, l.line, l.indent + 1);
  if (!s.known.has(bone))
    throw new BlobError(`unknown bone "${bone}"`, l.line, wordCol(l, onIdx + 1));

  const isBar = kind === 'bar';
  if (isBar && strArg(l, 'to') === null)
    throw new BlobError('bar needs "to="', l.line, l.indent + 1);

  const off = strArg(l, 'offset');
  s.doc.parts.push({
    kind,
    limb: kind === 'carve' ? 'head' : (rest[0] as BlobPart['limb']),
    bone,
    at: isBar ? numArg(l, 'from') : numArg(l, 'at'),
    to: isBar ? numArg(l, 'to') : null,
    radius: numArg(l, 'r'),
    wide: numArg(l, 'wide', 1),
    tall: numArg(l, 'tall', 1),
    deep: numArg(l, 'deep', 1),
    blend: numArg(l, 'blend', 0),
    mirror: l.words.includes('mirror'),
    hard: l.words.includes('hard'),
    both: l.words.includes('both'),
    offset: off === null
      ? null
      : (off.replace(/[()]/g, '').split(',').map(Number) as unknown as [number, number, number]),
    src: l,
  } satisfies BlobPart);
}

/**
 * Handles one line already known to be inside a `face` block: plain
 * `name value` pairs (`headRadius 0.118`), pushed straight into
 * `doc.face` as a flat number map. `faceTrivia` keeps the source `BlobLine`
 * for each entry — same reason `src` rides along on every `BlobPart` — so
 * Task 8's emitter has the comment/blank trivia to re-attach on round trip.
 */
function parseFaceLine(l: BlobLine, s: ParseState): void {
  const [head, ...rest] = l.words;
  if (head === undefined) return;
  const v = Number(rest[0]);
  if (!Number.isFinite(v))
    throw new BlobError(`face parameter "${head}" is not a number`, l.line, wordCol(l, 1));
  s.doc.face ??= {};
  s.doc.face[head] = v;
  s.doc.faceTrivia.push(l);
}

/**
 * Parses a whole document. Throws BlobError on the first problem.
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
