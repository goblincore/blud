// src/lab/sdf-zombie/blob-parse.ts
import { type BlobBone, type BlobDoc, type BlobLine, type BlobPart, type BlobPartKind, type BlobStance, BlobError } from './blob-ast';

/**
 * A `BlobLine[]` with one extra property: the comment/blank trivia that
 * followed the LAST significant line, if any. `tokenize` hangs trivia off
 * the NEXT significant line as it scans (see below) — trivia after the
 * final significant line has no "next line" to hang off, so it has to be
 * surfaced separately instead of silently falling out of the loop's local
 * state. `parseBlob` copies this into `BlobDoc.trailingTrivia`.
 *
 * Shaped as an array-plus-property, rather than `{ lines, trailing }`,
 * so every existing `tokenize(...)` call site — 25+ tests included — that
 * treats the result as a plain `BlobLine[]` keeps working unchanged.
 */
export interface TokenizedLines extends Array<BlobLine> {
  trailing: string[];
}

/**
 * Splits source into significant lines, hanging comment/blank trivia off the
 * next significant line. Deliberately dumb: no grammar knowledge lives here,
 * so the grammar can change without risking the trivia contract.
 */
export function tokenize(src: string): TokenizedLines {
  const out: BlobLine[] = [];
  let leading: string[] = [];

  src.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      // A trailing blank at end of file is not trivia for anything; the
      // document collects those separately.
      //
      // Pushing `raw`, not `trimmed`, matters for comment lines: zombie.blob
      // indents comments inside `skeleton`/`body`/`face` blocks (e.g. line 9,
      // "  # The upper body hunches..."), and `trimmed` throws that indent
      // away. Blank lines are unaffected either way — a line only reaches
      // this branch as "blank" once it already trims to '', so `raw` and
      // `trimmed` agree for those.
      leading.push(raw);
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
      raw,
    });
    leading = [];
  });

  // Whatever is still sitting in `leading` once the scan ends belongs to no
  // line — it's comment/blank trivia after the last significant line. Before
  // this, that trivia was silently dropped: a `.blob` file ending in a
  // comment lost it on round trip with no error, because nothing downstream
  // ever looked at the loop's final `leading` value.
  return Object.assign(out, { trailing: leading });
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

/**
 * Finds `dir=` by search rather than a fixed word index — unlike `on` in
 * `parseBodyLine` or the limb word in `limbArg`, `dir=` isn't pinned to a
 * particular position in the line, so a bad value's column has to be
 * located the same way `numArg` locates `key=` before reporting a column:
 * `findIndex` first, then `wordCol` on that index. This used to report a
 * bad `dir=` value at `l.indent + 1` (the start of the line) instead —
 * the same "points at the wrong end of the line" bug the `root ... at`
 * column fix addressed for a different keyword; `col` is supposed to
 * always land on the offending token.
 */
function dirArg(l: BlobLine): DirName {
  const idx = l.words.findIndex(w => w.startsWith('dir='));
  if (idx === -1) throw new BlobError('missing required "dir="', l.line, l.indent + 1);
  const v = l.words[idx]!.slice(4) as DirName;
  if (!DIRS.includes(v))
    throw new BlobError(`dir must be one of ${DIRS.join('|')}, got "${v}"`, l.line, wordCol(l, idx));
  return v;
}

function strArg(l: BlobLine, key: string): string | null {
  const hit = l.words.find(w => w.startsWith(`${key}=`));
  return hit ? hit.slice(key.length + 1) : null;
}

/**
 * `color=rrggbb` -> linear RGB. BARE hex — `#` opens a comment in .blob, so
 * `color=#ff8000` reaches the parser as `color=` with nothing after it, and
 * that case gets its own message. Six digits only: a three-digit shorthand or
 * a bare name is a typo here, because every colour in a .blob is measured off
 * a reference and pasted, never typed from memory.
 */
function parseColorArg(l: BlobLine, raw: string | null): readonly [number, number, number] | null {
  if (raw === null) return null;
  if (raw === '' && l.raw.includes('color=#'))
    throw new BlobError('color=: # starts a comment in .blob — write the six hex digits bare, color=rrggbb', l.line, l.indent + 1);
  const m = /^([0-9a-fA-F]{6})$/.exec(raw);
  if (!m) throw new BlobError(`color= needs six hex digits, got "${raw}"`, l.line, l.indent + 1);
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const hex = m[1]!;
  return [0, 2, 4].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
}

/** `gloss=0..1`, and only beside a `color=` — on flesh it would do nothing
 *  and silently doing nothing is how an author loses an hour. */
function parseGlossArg(l: BlobLine, painted: boolean): number | null {
  if (strArg(l, 'gloss') === null) return null;
  const g = numArg(l, 'gloss');
  if (g < 0 || g > 1) throw new BlobError(`gloss= is 0..1, got ${g}`, l.line, l.indent + 1);
  if (!painted) throw new BlobError('gloss= only means something on a coloured primitive; add color=rrggbb', l.line, l.indent + 1);
  return g;
}

const LIMBS = ['head', 'torso', 'arm', 'leg'] as const;
type LimbName = (typeof LIMBS)[number];

/**
 * Validates the limb word at `rest[0]` (i.e. `l.words[1]`) for a `blob`/
 * `bar` part line — `blob torso on spine ...` / `bar leg on thigh ...`.
 * `carve` has no limb word (see `parseBodyLine`) and never calls this.
 *
 * This used to be a bare `rest[0] as BlobPart['limb']` cast in the caller —
 * a lie, since nothing checked the value was actually one of the four limb
 * names. That let a typo (`torzo`) or an outright missing limb word (which
 * shifts `rest[0]` to whatever comes next, typically `"on"`) through
 * silently, producing a `BlobPart` whose `limb` field doesn't match its own
 * type. Same shape as `dirArg` above.
 *
 * `word` is typed `string`, not `string | undefined`: unlike `dir=`, the
 * limb word's position is pinned (it's always `l.words[1]`), and by the
 * time the caller reaches this, it has already confirmed `on <bone>` is
 * present later in the line — which means `l.words` has at least 3
 * entries, so index 1 always exists. A parameter typed `string |
 * undefined` here would document a case that cannot happen at the one call
 * site there is; see the `!` at that call site for where the guarantee is
 * actually established.
 */
function limbArg(l: BlobLine, word: string): LimbName {
  if (!LIMBS.includes(word as LimbName))
    throw new BlobError(`limb must be one of ${LIMBS.join('|')}, got "${word}"`, l.line, wordCol(l, 1));
  return word as LimbName;
}

/**
 * Parses a `<key>=(x,y,z)` argument into a validated 3-tuple, or `null` if the
 * part does not carry it. Shared by `offset=` and `tip=`.
 *
 * Arity and finiteness both used to be unchecked: `off.split(',').map
 * (Number)` was cast straight to `[number, number, number]` via `as unknown
 * as`, so `offset=(1,2)` silently produced a 2-element array wearing a
 * 3-tuple's type (`offset[2]` reads `undefined` at runtime despite the type
 * saying `number`), and `offset=(1,x,3)` silently produced a `NaN`
 * component. Both are exactly the kind of silent data loss this file
 * already refuses to allow elsewhere — and here it's worse, because
 * `offset` is consumed positionally by Task 8's emitter, so a short or
 * `NaN`-laced tuple becomes garbage with no error to trace it back to this
 * line. Checking both up front removes the need for the `as unknown as`
 * cast entirely: once length and finiteness are confirmed, `[x, y, z]` is
 * honestly a `[number, number, number]`.
 */
function parseVec3Arg(
  l: BlobLine, key: string, raw: string | null,
): readonly [number, number, number] | null {
  if (raw === null) return null;
  const idx = l.words.findIndex(w => w.startsWith(`${key}=`));
  const col = wordCol(l, idx);
  const parts = raw.replace(/[()]/g, '').split(',').map(Number);
  if (parts.length !== 3)
    throw new BlobError(`${key} needs exactly 3 components, got ${parts.length}`, l.line, col);
  // Safe to assert: the length check above guarantees indices 0-2 exist.
  const x = parts[0]!, y = parts[1]!, z = parts[2]!;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    throw new BlobError(`${key} has a non-numeric component`, l.line, col);
  return [x, y, z];
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
    // Optional `len=`. The root bone's LENGTH was hardcoded at 0.14 in
    // compileBlob — the zombie's pelvis — so every character inherited it
    // whatever its own height. On a 1.15 m goblin that is proportionally
    // almost twice what it should be. Defaults to 0.14, so zombie.blob and
    // its anchor test are unaffected.
    s.doc.rootLen = numArg(l, 'len', 0.14);
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
 * than validated via `limbArg`. (Carves in this lab are head/face detail
 * cuts; if a body carve ever needs a different limb, `'head'` would need to
 * become a real word in the grammar, not stay guessed here.) `blob`/`bar`
 * DO validate their limb word, via `limbArg` — see its doc comment for why
 * that isn't optional.
 *
 * `into` names the array the parsed part is pushed onto. This is the ONE
 * grammar for both `body` and `bones` part lines — the `bones` block
 * (wound pass r2) reuses it word for word, same limb word, same `on <bone>`,
 * same `mirror` — and the caller decides where the part lands. The bones
 * dispatcher passes `doc.bonesBlock.parts` so an authored bone can never
 * drift into `doc.parts` (and from there into `body.prims`, the design that
 * silently broke shadows, gibs and severing).
 */
function parseBodyLine(l: BlobLine, s: ParseState, into: BlobPart[]): void {
  const [head, ...rest] = l.words;
  const kind = head as BlobPartKind;
  if (kind !== 'blob' && kind !== 'bar' && kind !== 'carve' && kind !== 'groove' && kind !== 'shell')
    throw new BlobError(`unrecognized "${head}" in body block`, l.line, l.indent + 1);

  // `carve on skull ...` has no limb word; `blob torso on spine ...` does.
  const onIdx = l.words.indexOf('on');
  if (onIdx === -1) throw new BlobError(`${kind} needs "on <bone>"`, l.line, l.indent + 1);
  const bone = l.words[onIdx + 1];
  if (bone === undefined) throw new BlobError(`${kind} needs "on <bone>"`, l.line, l.indent + 1);
  if (!s.known.has(bone))
    throw new BlobError(`unknown bone "${bone}"`, l.line, wordCol(l, onIdx + 1));

  // `rest[0]!` is safe here, not merely convenient: the checks above already
  // require `on <bone>` to appear at index >= 1, so `l.words.length >= 3`
  // by this point, which guarantees index 1 (== rest[0]) exists.
  // `carve` is limb-locked to head (see this function's header). `groove`
  // takes a limb word like blob/bar do — a seam on a limb is a legitimate
  // thing to want, and a groove has no reason to inherit carve's restriction.
  const limb: BlobPart['limb'] = kind === 'carve' ? 'head' : limbArg(l, rest[0]!);

  const isBar = kind === 'bar';
  if (isBar && strArg(l, 'to') === null)
    throw new BlobError('bar needs "to="', l.line, l.indent + 1);

  const part: BlobPart = {
    kind,
    limb,
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
    // A bare word, like `hard`/`mirror`/`both`. `chamfer` swaps the fold from
    // the quadratic smooth-min to a flat 45-degree bevel, which keeps a crease
    // where the default gives a fillet.
    chamfer: l.words.includes('chamfer'),
    // `r2=` is the radius at the FAR end. Absent (null) means untapered, which
    // is a different thing from `r2=` equal to `r`: the first takes the plain
    // capsule path in both fields, the second is an author saying "taper, to
    // the same radius". Keeping them distinct means the packed data never
    // depends on a float comparison nobody wrote.
    radiusB: strArg(l, 'r2') === null ? null : numArg(l, 'r2'),
    offset: parseVec3Arg(l, 'offset', strArg(l, 'offset')),
    // `tip=` displaces the FAR end only, so a primitive can point somewhere
    // its bone does not — a nose out of a vertical skull, a tusk out of a jaw.
    tip: parseVec3Arg(l, 'tip', strArg(l, 'tip')),
    // `bend=` displaces the Bezier CONTROL point from the ENDPOINT MIDPOINT,
    // so a horn or a hook is ONE primitive instead of a chain of straight
    // ones whose round bases read as lumps.
    bend: parseVec3Arg(l, 'bend', strArg(l, 'bend')),
    grooveDepth: numArg(l, 'depth', 0),
    grooveWidth: numArg(l, 'width', 0),
    // `shell` — a thin clipped sheet. A shell is a BLOB-like base (at=, with
    // optional tip/bend for a curved strip) whose field is thinned, then
    // clipped against a plane with a rounded rim. It needs thick=, clip=,
    // clipd= and rim=; the required-arg contract is judged here (and again in
    // blob-compile.ts) so a shell missing one fails loudly with the line.
    thickness: numArg(l, 'thick', 0),
    clipNormal: parseVec3Arg(l, 'clip', strArg(l, 'clip')),
    clipOffset: numArg(l, 'clipd', 0),
    rim: numArg(l, 'rim', 0),
    // `color=rrggbb` paints this primitive: wherever it is the nearest prim
    // to the surface the flesh colour is replaced outright. Hex is sRGB, the
    // way a palette line is written and a reference plate is sampled; it is
    // stored linear because that is what the shader mixes in.
    color: parseColorArg(l, strArg(l, 'color')),
    gloss: parseGlossArg(l, strArg(l, 'color') !== null),
    // `core`: the limb's structural mass, for the fuse probe. See clusterCore.
    core: l.words.includes('core'),
    // `organ`: a bones-block line opting into viscera (organs r3). Same bare-
    // word mechanism as `hard`/`mirror`/`both`; compileBlob turns it into
    // `op: 'organ'`, which differs from bone only in material code.
    organ: l.words.includes('organ'),
    src: l,
  } satisfies BlobPart;

  if (kind === 'shell') {
    if (part.thickness <= 0)
      throw new BlobError('shell needs thick= above zero', l.line, l.indent + 1);
    if (part.clipNormal === null)
      throw new BlobError('shell needs clip=(nx,ny,nz)', l.line, l.indent + 1);
    if (strArg(l, 'clipd') === null)
      throw new BlobError('shell needs clipd=<offset>', l.line, l.indent + 1);
    if (strArg(l, 'rim') === null)
      throw new BlobError('shell needs rim=<rounding radius>', l.line, l.indent + 1);
  }

  into.push(part);
}

/**
 * Handles one line inside a `bones` block (wound pass r2): `ratio <r>`, or an
 * authored bone part written in the BODY grammar — `parseBodyLine` does the
 * parsing, this function only decides where the part lands and gates the two
 * kinds that could actually be a bone (`blob`/`bar`). A `carve`/`groove`/
 * `shell` line is rejected here, at the line, rather than at compile where
 * the same words would have to be re-interpreted as something they are not.
 *
 * `ratio` is the derivation fallback for bones the block does not name; it is
 * NOT the radius of anything. Negative or non-numeric throws — a ratio is a
 * fraction of flesh radius, and a nonsense one would either opt the character
 * out of bone silently (negative, after the `v < 0` check were dropped) or
 * NaN its way past every comparison.
 */
function parseBonesLine(l: BlobLine, s: ParseState): void {
  s.doc.bonesBlock ??= { ratio: null, parts: [] };
  const head = l.words[0]!;
  if (head === 'ratio') {
    const v = Number(l.words[1]);
    if (!Number.isFinite(v) || v < 0)
      throw new BlobError('ratio needs a non-negative number', l.line, wordCol(l, 1));
    s.doc.bonesBlock.ratio = v;
    s.doc.bonesTrivia.push(l);
    return;
  }
  if (head !== 'blob' && head !== 'bar')
    throw new BlobError(
      `a bones line must be "blob", "bar" or "ratio", got "${head}"`,
      l.line, l.indent + 1);
  parseBodyLine(l, s, s.doc.bonesBlock.parts);
}

/**
 * Handles one line already known to be inside a `face` block: plain
 * `name value` pairs (`headRadius 0.118`), pushed straight into
 * `doc.face` as a flat number map. `faceTrivia` keeps the source `BlobLine`
 * for each entry — same reason `src` rides along on every `BlobPart` — so
 * Task 8's emitter has the comment/blank trivia to re-attach on round trip.
 */
/**
 * `face` and `sheet` are the same shape — a block of `name value` pairs — so
 * they share a parser. Splitting them into two near-identical functions is how
 * the two drift: one grows a check the other does not.
 */
function parseNamedNumberLine(
  l: BlobLine, s: ParseState, what: 'face' | 'sheet',
): void {
  const [head, ...rest] = l.words;
  // `tokenize` guarantees every emitted `BlobLine` has at least one word —
  // a source line that's pure whitespace or a comment is trivia and never
  // reaches here (see `tokenize`'s blank/`#` branch), so `head` can't
  // actually be `undefined` today. This throws rather than silently
  // returning anyway, for the same reason every other silent-skip in this
  // file has already been replaced with a throw: if that tokenizer
  // invariant is ever loosened, a degenerate face line should fail loudly,
  // not vanish from `doc.face` and `doc.faceTrivia` with no trace.
  if (head === undefined)
    throw new BlobError(`${what} line has no parameter name`, l.line, l.indent + 1);
  // The one string-valued sheet parameter: `image <file>`. A decal sheet is a
  // baked PNG, not a set of numbers, and a filename is not worth a block of
  // its own.
  if (what === 'sheet' && head === 'image') {
    const file = rest[0];
    if (file === undefined || rest.length !== 1)
      throw new BlobError('sheet image expects exactly one filename', l.line, wordCol(l, 1));
    s.doc.sheet ??= {};
    s.doc.sheetImage = file;
    s.doc.sheetTrivia.push(l);
    return;
  }
  const v = Number(rest[0]);
  if (!Number.isFinite(v))
    throw new BlobError(`${what} parameter "${head}" is not a number`, l.line, wordCol(l, 1));
  if (what === 'sheet') {
    s.doc.sheet ??= {};
    s.doc.sheet[head] = v;
  } else {
    s.doc.face ??= {};
    s.doc.face[head] = v;
  }
  (what === 'sheet' ? s.doc.sheetTrivia : s.doc.faceTrivia).push(l);
}

/**
 * Handles one line inside a `palette` block: `name` followed by ONE or THREE
 * numbers (`roughness 0.55`, `base 0.34 0.42 0.22`).
 *
 * Deliberately not folded into `parseNamedNumberLine`, which the `face` and
 * `sheet` blocks share. Those are flat `Record<string, number>` maps and the
 * shared parser exists because the two are the same shape and would otherwise
 * drift. A palette is NOT the same shape — it mixes scalars and RGB triples —
 * so joining them would mean widening `doc.face` and `doc.sheet` to number
 * arrays too, and every face consumer would then have to unwrap a
 * one-element array for no gain.
 *
 * Arity is recorded here but judged by `compilePalette`, which knows which
 * keys are colours. Rejecting anything other than 1 or 3 numbers at this
 * level is still worth doing: it turns a truncated colour into a parse error
 * pointing at the line, rather than a silently accepted two-channel value.
 */
function parsePaletteLine(l: BlobLine, s: ParseState): void {
  const [head, ...rest] = l.words;
  if (head === undefined)
    throw new BlobError('palette line has no parameter name', l.line, l.indent + 1);
  if (rest.length !== 1 && rest.length !== 3)
    throw new BlobError(
      `palette parameter "${head}" takes 1 number or 3 (linear r g b), got ${rest.length}`,
      l.line, wordCol(l, 1));
  const nums = rest.map((w, i) => {
    const v = Number(w);
    if (!Number.isFinite(v))
      throw new BlobError(
        `palette parameter "${head}" is not a number`, l.line, wordCol(l, i + 1));
    return v;
  });
  s.doc.palette ??= {};
  s.doc.palette[head] = nums;
  s.doc.paletteTrivia.push(l);
}

/**
 * Parses a whole document. Throws BlobError on the first problem.
 */
export function parseBlob(src: string): BlobDoc {
  const lines = tokenize(src);
  const s: ParseState = {
    doc: {
      name: '', height: null, stance: null, rootBone: '', rootHeight: 0, rootLen: 0.14,
      bones: [], parts: [], bonesBlock: null, bonesTrivia: [], face: null, faceTrivia: [], sheet: null, sheetImage: null, sheetTrivia: [],
      palette: null, paletteTrivia: [], structure: [], trailingTrivia: [],
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
    if (head === 'stance' && section === 'model') {
      const v = rest[0];
      if (v !== 'humanoid' && v !== 'digitigrade')
        throw new BlobError(
          `stance must be humanoid or digitigrade, got "${v ?? ''}"`, l.line, l.indent + 1);
      s.doc.stance = v as BlobStance;
      s.doc.structure.push(l);
      continue;
    }
    if (head === 'skeleton' || head === 'body' || head === 'bones' || head === 'face' || head === 'sheet' || head === 'palette') { section = head; s.doc.structure.push(l); continue; }

    if (section === 'skeleton') { parseSkeletonLine(l, s); continue; }
    if (section === 'body') { parseBodyLine(l, s, s.doc.parts); continue; }
    if (section === 'bones') { parseBonesLine(l, s); continue; }
    if (section === 'face') { parseNamedNumberLine(l, s, 'face'); continue; }
    if (section === 'sheet') { parseNamedNumberLine(l, s, 'sheet'); continue; }
    if (section === 'palette') { parsePaletteLine(l, s); continue; }
  }

  if (s.inMirror) throw new BlobError('mirror block is never closed', s.mirrorOpenedAt, 1);
  if (!s.doc.rootBone) throw new BlobError('no "root" bone declared', 1, 1);
  s.doc.trailingTrivia = lines.trailing;
  return s.doc;
}
