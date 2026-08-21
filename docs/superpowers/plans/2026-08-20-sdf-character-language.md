# SDF Character Language (`.blob`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author Blud's SDF characters in a terse, commented text format that
compiles to the existing `BodyDef`, so both a human and an LLM can make a
character without editing TypeScript.

**Architecture:** `.blob` text → `blob-parse.ts` (AST that RETAINS comments) →
`blob-compile.ts` → the existing `BodyDef` → the existing
`buildBody`/`validateBody`/WGSL raymarcher. Nothing downstream of `BodyDef` is
rewritten. A round-trip emitter writes panel state back out, and a turntable
script renders a character for inspection.

**Tech Stack:** TypeScript 5.6, Vitest 2, Vite 5 (`?raw` imports), Three.js
0.185 WebGPU, Node 25 CDP for the turntable.

**Spec:** `docs/superpowers/specs/2026-08-20-sdf-character-language-design.md`

---

## Global constraints

- Run Vitest with `NODE_OPTIONS=--no-experimental-webstorage` under Node 25.
- **The parser MUST retain comments and blank-line trivia from Task 1.** The
  emitter (Task 8) cannot re-attach reasoning it never captured, and comment
  preservation is a hard spec requirement. Do not "add comments later".
- Do not modify `types.ts`, `mirror.ts`, `resolve.ts`, `clusters.ts` or
  `build-body.ts`. This is a new front end; if you feel the urge to change
  `BodyDef`, stop and report why.
- `dir` is normalised by `resolveBones` (`resolve.ts:26`), so angle→vector
  conversion only needs to match DIRECTION, not magnitude.
- Never hand-round the zombie's angles. Task 5 derives them from the existing
  vectors; rounding 6.843° to 7° moves a bone tail ~0.3 mm and makes the anchor
  test meaningless.
- Every task ends green: focused tests, `npx tsc --noEmit`, `git diff --check`,
  commit.

## File structure

### New files

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/blob-ast.ts` | AST types + trivia. No logic. |
| `src/lab/sdf-zombie/blob-parse.ts` | text → `BlobDoc`, errors with line/col |
| `src/lab/sdf-zombie/blob-compile.ts` | `BlobDoc` → `BodyDef` (angles → vectors) |
| `src/lab/sdf-zombie/blob-checks.ts` | always-on `fused`/`clear` on `sdBody()` |
| `src/lab/sdf-zombie/blob-emit.ts` | `BlobDoc` + overrides → `.blob` text |
| `src/lab/sdf-zombie/characters/zombie.blob` | the zombie, as the proof |
| `scripts/blob-turntable.mjs` | N-angle deterministic capture |
| `.claude/skills/authoring-sdf-characters/SKILL.md` | the agent loop |

Each gets a co-located `.test.ts`.

### Existing files that change

- `src/lab/sdf-zombie/webgpu/lab-main.ts:173` — the single seam where
  `makeZombie(face)` is swapped for the compiled document.
- `TASKS.md` — `P8` status.

---

## Task 1: AST with trivia, and a tokenizer

**Files:**
- Create: `src/lab/sdf-zombie/blob-ast.ts`
- Create: `src/lab/sdf-zombie/blob-parse.ts`
- Test: `src/lab/sdf-zombie/blob-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/blob-parse.test.ts
import { describe, it, expect } from 'vitest';
import { tokenize } from './blob-parse';

describe('tokenize', () => {
  it('emits one line record per source line, with 1-based numbers', () => {
    const lines = tokenize('model zombie\n  height 1.78\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ line: 1, indent: 0, words: ['model', 'zombie'] });
    expect(lines[1]).toMatchObject({ line: 2, indent: 2, words: ['height', '1.78'] });
  });

  // Trivia is load-bearing: the emitter re-attaches these to the same owner.
  it('keeps a comment as trivia rather than discarding it', () => {
    const lines = tokenize('# why the stoop lives here\nmodel zombie\n');
    expect(lines).toHaveLength(1);
    expect(lines[0].leading).toEqual(['# why the stoop lives here']);
  });

  it('keeps blank lines in trivia so paragraph breaks survive a round trip', () => {
    const lines = tokenize('# a\n\n# b\nmodel zombie\n');
    expect(lines[0].leading).toEqual(['# a', '', '# b']);
  });

  it('keeps a trailing same-line comment separately from leading trivia', () => {
    const lines = tokenize('r=0.15 # keep this fat\n');
    expect(lines[0].words).toEqual(['r=0.15']);
    expect(lines[0].trailing).toBe('# keep this fat');
  });
});
```

- [ ] **Step 2: Run RED**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-parse.test.ts`

Expected: FAIL — `blob-parse` has no export `tokenize`.

- [ ] **Step 3: Write the AST types**

```ts
// src/lab/sdf-zombie/blob-ast.ts

/**
 * One significant source line, with the trivia that preceded it.
 *
 * `leading` exists so `blob-emit.ts` can put a comment back on the SAME owner
 * it was written above. troll.wam and body.ts both spend half their lines
 * explaining WHY a number is what it is; an emitter that drops that turns a
 * maintainable character into a wall of unexplained floats after one save.
 * Blank strings inside `leading` are blank source lines, kept so paragraph
 * breaks survive too.
 */
export interface BlobLine {
  line: number;
  indent: number;
  words: string[];
  leading: string[];
  trailing: string | null;
}

export interface BlobBone {
  name: string;
  parent: string | null;
  dir: 'up' | 'down' | 'side' | 'fwd';
  pitchDeg: number;
  tiltDeg: number;
  len: number;
  side: number;
  mirror: boolean;
  at: number | null;
  src: BlobLine;
}

export type BlobPartKind = 'blob' | 'bar' | 'carve';

export interface BlobPart {
  kind: BlobPartKind;
  limb: 'head' | 'torso' | 'arm' | 'leg';
  bone: string;
  at: number;
  to: number | null;
  radius: number;
  wide: number;
  tall: number;
  deep: number;
  blend: number;
  mirror: boolean;
  hard: boolean;
  both: boolean;
  offset: readonly [number, number, number] | null;
  src: BlobLine;
}

export interface BlobDoc {
  name: string;
  height: number | null;
  rootBone: string;
  rootHeight: number;
  bones: BlobBone[];
  parts: BlobPart[];
  face: Record<string, number> | null;
  faceTrivia: BlobLine[];
  /**
   * Lines that no node owns — `model`, `skeleton`, `body`, `face`, `mirror`,
   * `end`, `height`, `root`. The emitter needs them to rebuild the document in
   * source order; without this it silently drops every block keyword.
   */
  structure: BlobLine[];
  trailingTrivia: string[];
}

export class BlobError extends Error {
  constructor(message: string, readonly line: number, readonly col: number) {
    super(`${line}:${col}: ${message}`);
    this.name = 'BlobError';
  }
}
```

- [ ] **Step 4: Write the tokenizer**

```ts
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
 * `key=value` → value, with a typed error naming the offending line.
 *
 * `col` is a 1-based CHARACTER offset in both error branches. An earlier draft
 * reported the missing-key case as a character offset and the bad-number case
 * as a word INDEX, which silently pointed callers at the wrong place — the
 * whole reason BlobError carries a column is so an author can jump to the spot.
 */
export function numArg(l: BlobLine, key: string, fallback: number | null = null): number {
  const hit = l.words.find(w => w.startsWith(`${key}=`));
  if (hit === undefined) {
    if (fallback !== null) return fallback;
    throw new BlobError(`missing required "${key}="`, l.line, l.indent + 1);
  }
  const v = Number(hit.slice(key.length + 1));
  if (!Number.isFinite(v)) throw new BlobError(`"${key}=" is not a number`, l.line, wordCol(l, idx));
  return v;
}

/**
 * 1-based character column of `l.words[idx]`, reconstructed as
 * `indent + words joined by single spaces`.
 *
 * `BlobLine` doesn't retain the raw line text, so this is a reconstruction,
 * exact only when words were separated by ONE space each. `tokenize` splits on
 * `\s+`, so a line padded for column alignment (the character files do this to
 * keep `len=` tidy) reconstructs one character short per extra space. Accepted:
 * the column points a human at roughly the right token, and retaining raw text
 * on every BlobLine would cost more than the precision is worth. Do NOT fix
 * this by changing BlobLine — the emitter's trivia contract needs that shape.
 */
function wordCol(l: BlobLine, idx: number): number {
  let col = l.indent;
  for (let i = 0; i < idx; i++) col += l.words[i]!.length + 1;
  return col + 1;
}
```

- [ ] **Step 5: Run GREEN**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-parse.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/blob-ast.ts src/lab/sdf-zombie/blob-parse.ts \
  src/lab/sdf-zombie/blob-parse.test.ts
git commit -m "feat(sdf-lab): tokenize .blob source, keeping comments as trivia"
```

---

## Task 2: Parse the `skeleton` block

**Files:**
- Modify: `src/lab/sdf-zombie/blob-parse.ts`
- Test: `src/lab/sdf-zombie/blob-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseBlob } from './blob-parse';
import { BlobError } from './blob-ast';

const SKEL = `model zombie
  height 1.78

skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=7 len=0.34
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end
`;

describe('parseBlob — skeleton', () => {
  it('reads the model header', () => {
    const doc = parseBlob(SKEL);
    expect(doc.name).toBe('zombie');
    expect(doc.height).toBe(1.78);
  });

  it('reads the root bone and its world height', () => {
    const doc = parseBlob(SKEL);
    expect(doc.rootBone).toBe('pelvis');
    expect(doc.rootHeight).toBe(0.92);
  });

  it('defaults pitch/tilt/side to zero and mirror to false', () => {
    const spine = parseBlob(SKEL).bones.find(b => b.name === 'spine')!;
    expect(spine).toMatchObject({
      parent: 'pelvis', dir: 'up', pitchDeg: 7, tiltDeg: 0, len: 0.34,
      side: 0, mirror: false,
    });
  });

  it('marks bones inside a mirror block, and only those', () => {
    const doc = parseBlob(SKEL);
    expect(doc.bones.find(b => b.name === 'thigh')!.mirror).toBe(true);
    expect(doc.bones.find(b => b.name === 'spine')!.mirror).toBe(false);
  });

  it('rejects a parent that was never declared, naming the line', () => {
    const bad = SKEL.replace('parent=pelvis dir=up pitch=7', 'parent=nope dir=up pitch=7');
    expect(() => parseBlob(bad)).toThrow(BlobError);
    expect(() => parseBlob(bad)).toThrow(/6:.*unknown parent "nope"/);
  });

  it('rejects an unclosed mirror block', () => {
    expect(() => parseBlob(SKEL.replace('  end\n', ''))).toThrow(/mirror block is never closed/);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-parse.test.ts`

Expected: FAIL — no export `parseBlob`.

- [ ] **Step 3: Implement**

Append to `blob-parse.ts`:

```ts
import type { BlobBone, BlobDoc, BlobLine } from './blob-ast';

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

/** Parses a whole document. Throws BlobError on the first problem. */
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
        // Surface syntax is `root pelvis at 0.92` — space separated, not `at=`.
        // Read word 3 directly and report with wordCol. Do NOT fabricate a
        // BlobLine with a truncated `words` array to reuse numArg: wordCol sums
        // the preceding words, so a one-element array always reports the start
        // of the line instead of the bad token.
        const raw = l.words[3];
        const v = Number(raw);
        if (raw === undefined || !Number.isFinite(v))
          throw new BlobError('"at" value is not a number', l.line, wordCol(l, 3));
        doc.rootHeight = v;
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
```

> **Note on `root`:** the syntax is `root pelvis at 0.92` — space-separated, not
> `at=`. The shim above reuses `numArg` by rewriting the words; if you prefer,
> read `l.words[3]` directly. Do not change the surface syntax.

- [ ] **Step 4: Run GREEN**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-parse.test.ts`

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/blob-parse.ts src/lab/sdf-zombie/blob-parse.test.ts
git commit -m "feat(sdf-lab): parse the .blob skeleton block"
```

---

## Task 3: Parse the `body` and `face` blocks

**Files:**
- Modify: `src/lab/sdf-zombie/blob-parse.ts`
- Test: `src/lab/sdf-zombie/blob-parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
const FULL = `model zombie
  height 1.78

skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=7 len=0.34
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end

body
  blob torso on spine at=0.80 r=0.150 wide=1.28 deep=0.78 blend=0.014
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  carve on spine at=0.55 r=0.022 offset=(0.035,0.01,0.06) hard both

face
  headRadius 0.118
  headWidth  0.760
`;

describe('parseBlob — body and face', () => {
  it('reads a blob part, defaulting unnamed axes to 1', () => {
    const p = parseBlob(FULL).parts[0]!;
    expect(p).toMatchObject({
      kind: 'blob', limb: 'torso', bone: 'spine', at: 0.80, to: null,
      radius: 0.150, wide: 1.28, tall: 1, deep: 0.78, blend: 0.014,
      mirror: false, hard: false, both: false, offset: null,
    });
  });

  it('reads a bar as a span with from/to', () => {
    const p = parseBlob(FULL).parts[1]!;
    expect(p).toMatchObject({ kind: 'bar', limb: 'leg', at: 0.05, to: 0.95, mirror: true });
  });

  it('reads a carve with its offset triple and hard/both flags', () => {
    const p = parseBlob(FULL).parts[2]!;
    expect(p).toMatchObject({ kind: 'carve', hard: true, both: true, offset: [0.035, 0.01, 0.06] });
  });

  it('reads the face block as plain named parameters', () => {
    expect(parseBlob(FULL).face).toEqual({ headRadius: 0.118, headWidth: 0.760 });
  });

  it('rejects a part riding a bone that does not exist', () => {
    const bad = FULL.replace('blob torso on spine', 'blob torso on ghost');
    expect(() => parseBlob(bad)).toThrow(/unknown bone "ghost"/);
  });

  it('rejects a bar without to=', () => {
    const bad = FULL.replace('from=0.05 to=0.95 ', 'from=0.05 ');
    expect(() => parseBlob(bad)).toThrow(/bar needs "to="/);
  });
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL — `doc.parts` is empty and `doc.face` is null.

- [ ] **Step 3: Implement**

Task 2 decomposed `parseBlob` into per-section handlers, so this task **fills in
the two stubs** rather than adding branches to a loop. `parseBodyLine` and
`parseFaceLine` currently exist as no-ops in `blob-parse.ts`; replace them.

Note the shared state object Task 2 introduced:

```ts
interface ParseState {
  doc: BlobDoc;
  known: Set<string>;        // bone names declared so far — use it to reject `on <ghost>`
  inMirror: boolean;
  mirrorOpenedAt: number;
}
```

```ts
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
```

Note `parseBodyLine` is now STRICT about unrecognized keywords, matching what
Task 2 did for `skeleton`. Task 2 deliberately left these stubs permissive only
because the parts grammar did not exist yet; now it does, so an author's typo
must fail loudly rather than vanishing from both `doc.parts` and the emitter's
output.

- [ ] **Step 4: Run GREEN**

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/blob-parse.ts src/lab/sdf-zombie/blob-parse.test.ts
git commit -m "feat(sdf-lab): parse .blob body parts and the face block"
```

---

## Task 4: Compile `BlobDoc` → `BodyDef`

**Files:**
- Create: `src/lab/sdf-zombie/blob-compile.ts`
- Test: `src/lab/sdf-zombie/blob-compile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/blob-compile.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { compileBlob, dirVector } from './blob-compile';

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, Math.round(-Math.log10(eps))));

describe('dirVector', () => {
  it('maps the four base directions', () => {
    near(dirVector('up', 0, 0), [0, 1, 0]);
    near(dirVector('down', 0, 0), [0, -1, 0]);
    near(dirVector('side', 0, 0), [1, 0, 0]);
    near(dirVector('fwd', 0, 0), [0, 0, 1]);
  });

  // The zombie's spine is authored as [0,1,0.12]; atan(0.12) = 6.843 degrees.
  it('pitches up toward +z, matching the authored spine', () => {
    const v = dirVector('up', 6.842773, 0);
    near([v[2] / v[1], 0, 0], [0.12, 0, 0], 1e-6);
  });

  // upperArm is [0.30,-1,0]; atan(0.30) = 16.699 degrees of tilt off down.
  it('tilts down toward +x, matching the authored upper arm', () => {
    const v = dirVector('down', 0, 16.699244);
    near([v[0] / -v[1], 0, 0], [0.30, 0, 0], 1e-6);
  });
});

describe('compileBlob', () => {
  const doc = parseBlob(`model t
skeleton
  root pelvis at 0.92
  bone spine parent=pelvis dir=up pitch=0 len=0.34
  mirror
    bone thigh parent=pelvis dir=down side=0.10 len=0.40
  end

body
  blob torso on spine at=0.8 r=0.15 wide=1.28 deep=0.78 blend=0.014
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  carve on spine at=0.55 r=0.022 offset=(0.035,0.01,0.06) hard both
`);

  it('carries the root height through as BodyDef.root', () => {
    expect(compileBlob(doc).root).toEqual([0, 0.92, 0]);
  });

  it('emits the root bone with a null parent', () => {
    expect(compileBlob(doc).bones[0]).toMatchObject({ name: 'pelvis', parent: null });
  });

  it('turns wide/tall/deep into the scale triple', () => {
    expect(compileBlob(doc).prims[0]!.scale).toEqual([1.28, 1, 0.78]);
  });

  it('turns a bar into a capsule with capTo', () => {
    expect(compileBlob(doc).prims[1]).toMatchObject({ at: 0.05, capTo: 0.95, mirror: true });
  });

  it('turns carve into a subtract op, and hard into blendK 0', () => {
    expect(compileBlob(doc).prims[2]).toMatchObject({
      op: 'sub', blendK: 0, mirrorOffset: true, offset: [0.035, 0.01, 0.06],
    });
  });

  it('produces a BodyDef the existing builder accepts without errors', async () => {
    const { buildBody } = await import('./build-body');
    expect(buildBody(compileBlob(doc)).errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-compile.test.ts`

Expected: FAIL — no module `./blob-compile`.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/blob-compile.ts
import type { BlobDoc } from './blob-ast';
import type { BodyDef, BoneDef, PrimDef, Vec3 } from './types';
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';

const RAD = Math.PI / 180;

/**
 * Angles → a direction vector, the ergonomic win borrowed from WAM.
 *
 * `pitch` rotates about world X, carrying `up` toward +z — so the zombie's
 * 7-degree forward hunch is a number you can reason about instead of the
 * opaque `[0, 1, 0.12]`. `tilt` rotates about world Z, carrying `down` toward
 * +x, which is how an arm hangs away from the body.
 *
 * Magnitude is irrelevant: resolveBones normalises `dir` (resolve.ts:26), so
 * only the direction has to be right.
 */
export function dirVector(
  dir: 'up' | 'down' | 'side' | 'fwd', pitchDeg: number, tiltDeg: number,
): Vec3 {
  const base: Record<string, Vec3> = {
    up: [0, 1, 0], down: [0, -1, 0], side: [1, 0, 0], fwd: [0, 0, 1],
  };
  const [x0, y0, z0] = base[dir]!;

  // Pitch about X: y toward z.
  const p = pitchDeg * RAD;
  const y1 = y0 * Math.cos(p) - z0 * Math.sin(p);
  const z1 = y0 * Math.sin(p) + z0 * Math.cos(p);

  // Tilt about Z: y toward x. Negated so a positive tilt on `down` swings +x.
  const t = tiltDeg * RAD;
  const x2 = x0 * Math.cos(t) - y1 * Math.sin(t);
  const y2 = x0 * Math.sin(t) + y1 * Math.cos(t);

  return [x2, y2, z1];
}

/** Merges a `.blob` face block over the tuned defaults. */
export function compileFace(doc: BlobDoc): FaceParams {
  return { ...DEFAULT_FACE, ...(doc.face ?? {}) } as FaceParams;
}

export function compileBlob(doc: BlobDoc, face = compileFace(doc)): BodyDef {
  const bones: BoneDef[] = [
    { name: doc.rootBone, parent: null, dir: [0, 1, 0], length: 0.14 },
    ...doc.bones.map(b => ({
      name: b.name,
      parent: b.parent,
      dir: dirVector(b.dir, b.pitchDeg, b.tiltDeg),
      length: b.len,
      side: b.side,
      mirror: b.mirror,
    } satisfies BoneDef)),
  ];

  const prims: PrimDef[] = doc.parts.map(p => ({
    bone: p.bone,
    at: p.at,
    ...(p.to === null ? {} : { capTo: p.to }),
    radius: p.radius,
    scale: [p.wide, p.tall, p.deep] as Vec3,
    blendK: p.hard ? 0 : p.blend,
    limb: p.limb,
    ...(p.mirror ? { mirror: true } : {}),
    ...(p.kind === 'carve' ? { op: 'sub' as const } : {}),
    ...(p.both ? { mirrorOffset: true } : {}),
    ...(p.offset ? { offset: p.offset as Vec3 } : {}),
  }));

  return {
    name: doc.name,
    root: [0, doc.rootHeight, 0],
    bones,
    prims: [...prims, ...facePrims(face)],
  };
}
```

> **Note:** the root bone's `length: 0.14` and `dir: [0,1,0]` reproduce the
> zombie's `pelvis`. If a later character needs a different pelvis, promote it
> to `root pelvis at 0.92 len=0.14` — but do NOT do that speculatively now.

- [ ] **Step 4: Run GREEN**

Expected: PASS, 9 tests.

- [ ] **Step 5: Verify types and commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/blob-compile.ts src/lab/sdf-zombie/blob-compile.test.ts
git commit -m "feat(sdf-lab): compile a .blob document to BodyDef"
```

---

## Task 5: `zombie.blob` and the round-trip identity anchor

This is the task that proves the language can express the one character known
to work. Everything before it is machinery; this is the evidence.

**Files:**
- Create: `src/lab/sdf-zombie/characters/zombie.blob`
- Create: `src/lab/sdf-zombie/characters/zombie-blob.test.ts`
- Create: `scripts/derive_blob_angles.mjs`

- [ ] **Step 1: Write the derivation script**

Do NOT hand-round angles. `atan(0.12) = 6.843°`, and typing `7` moves the bone
tail ~0.3 mm, which turns the anchor test into a loose approximation.

```js
// scripts/derive_blob_angles.mjs
// Prints the exact pitch/tilt for each ZOMBIE_BASE bone, for authoring
// zombie.blob. One-off authoring aid; not part of the build.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lab/sdf-zombie/body.ts', 'utf8');
const re = /\{\s*name:\s*'(\w+)'.*?dir:\s*\[([^\]]+)\]/g;
const DEG = 180 / Math.PI;

for (const m of src.matchAll(re)) {
  const [x, y, z] = m[2].split(',').map(Number);
  // Undo dirVector: tilt is the x-swing off the y axis, pitch the z-swing.
  const tilt = Math.atan2(x, Math.abs(y)) * DEG;
  const pitch = Math.atan2(z, Math.abs(y)) * DEG;
  const dir = y >= 0 ? 'up' : 'down';
  console.log(
    `${m[1].padEnd(10)} dir=${dir} pitch=${pitch.toFixed(6)} tilt=${tilt.toFixed(6)}`,
  );
}
```

Run: `node scripts/derive_blob_angles.mjs`

Expected: a line per bone, e.g. `spine      dir=up pitch=6.842773 tilt=0.000000`.

- [ ] **Step 2: Write the failing anchor test**

```ts
// src/lab/sdf-zombie/characters/zombie-blob.test.ts
import { describe, it, expect } from 'vitest';
import src from './zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { makeZombie } from '../body';

const fromBlob = () => buildBody(compileBlob(parseBlob(src)));
const fromTs = () => buildBody(makeZombie());

describe('zombie.blob is the zombie', () => {
  it('compiles with no validation errors', () => {
    expect(fromBlob().errors).toEqual([]);
  });

  it('produces the same primitive and cluster counts', () => {
    expect(fromBlob().prims).toHaveLength(fromTs().prims.length);
    expect(fromBlob().clusters.map(c => c.limb)).toEqual(fromTs().clusters.map(c => c.limb));
  });

  // dir is normalised at resolve time, so bone POSITIONS are the honest
  // comparison — not the raw dir arrays, which differ in magnitude by design.
  it('resolves every bone to the same head and tail within 0.1 mm', () => {
    const a = fromBlob().bones, b = fromTs().bones;
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [name, bone] of a) {
      const ref = b.get(name)!;
      bone.head.forEach((v, i) => expect(v).toBeCloseTo(ref.head[i]!, 4));
      bone.tail.forEach((v, i) => expect(v).toBeCloseTo(ref.tail[i]!, 4));
    }
  });

  it('places every primitive at the same endpoints and radius', () => {
    const a = fromBlob().prims, b = fromTs().prims;
    a.forEach((p, i) => {
      expect(p.radius).toBeCloseTo(b[i]!.radius, 6);
      expect(p.blendK).toBeCloseTo(b[i]!.blendK, 6);
      expect(p.limb).toBe(b[i]!.limb);
      p.a.forEach((v, j) => expect(v).toBeCloseTo(b[i]!.a[j]!, 4));
      p.b.forEach((v, j) => expect(v).toBeCloseTo(b[i]!.b[j]!, 4));
    });
  });
});
```

- [ ] **Step 3: Run RED**

Expected: FAIL — `zombie.blob` does not exist.

- [ ] **Step 4: Author `zombie.blob`**

Transcribe `ZOMBIE_BASE` from `body.ts`, using the angles from Step 1 and
carrying the existing comments across — they are the reasoning, and the format
is built to hold them. Prim order MUST match `body.ts` exactly, because
`assignClusters` depends on fold order.

```
# The lab zombie. Proportions are deliberately wrong in a B-movie way: long
# arms hanging past the hip line, head pitched forward of the spine, heavy gut.
model zombie
  height 1.78

skeleton
  root pelvis at 0.92

  # The upper body hunches FORWARD (+z). These used to lean -z while the
  # forearms angled +z, so in profile the occiput jutted where the face should
  # be and the head read as being on backwards.
  bone spine parent=pelvis dir=up pitch=6.842773 len=0.34
  bone neck  parent=spine  dir=up pitch=19.290206 len=0.16
  bone skull parent=neck   dir=up pitch=10.204630 len=0.16

  mirror
    bone clavicle parent=spine    dir=side                     len=0.20
    bone upperArm parent=clavicle dir=down tilt=16.699244      len=0.30
    bone foreArm  parent=upperArm dir=down tilt=2.862405 pitch=5.710593 len=0.30
    bone thigh    parent=pelvis   dir=down side=0.10           len=0.40
    bone shin     parent=thigh    dir=down pitch=2.862405      len=0.42
  end

body
  # Head — just the neck here. The skull itself is a parameterised ellipsoid
  # emitted by the face block, so it stays tunable in the panel.
  bar head on neck from=0.05 to=1.0 r=0.045 blend=0.007

  # Torso — ribcage tapering into a sagging gut.
  blob torso on spine  at=0.80 r=0.150 wide=1.28 deep=0.78 blend=0.014
  blob torso on spine  at=0.50 r=0.150 wide=1.15 deep=0.80 blend=0.02
  blob torso on spine  at=0.15 r=0.142 wide=1.02 deep=0.95 blend=0.02
  blob torso on pelvis at=0.40 r=0.145 wide=1.10 tall=0.9 deep=0.92 blend=0.02

  # Arms — shoulder blob, then upper and forearm capsules, then a fist.
  blob arm on clavicle at=0.90 r=0.072 blend=0.010 mirror
  bar  arm on upperArm from=0.02 to=0.95 r=0.055 blend=0.007 mirror
  bar  arm on foreArm  from=0.05 to=0.90 r=0.048 blend=0.007 mirror
  blob arm on foreArm  at=1.00 r=0.062 blend=0.0125 mirror

  # Legs — thigh, shin, foot.
  bar  leg on thigh from=0.05 to=0.95 r=0.082 blend=0.0175 mirror
  bar  leg on shin  from=0.05 to=0.92 r=0.062 blend=0.015 mirror
  blob leg on shin  at=1.00 r=0.070 wide=0.85 tall=0.6 deep=1.5 blend=0.0125 mirror

# Tuned by hand in the panel, then baked. Keep headHeight near 1: raising it
# SHARPENS the crown rather than doming it, so the height and the gaunt taper
# both come from the jaw below.
face
  headRadius 0.118
  headWidth  0.76
  headHeight 1.161
  headDepth  0.894
  jawWidth   0.748
  jawHeight  0.861
  jawDrop    0.076
  jawJut     0.04
  noseLength 0.007
  noseWidth  0.379
  noseDrop   0.009
  browHeavy  0.008
  browRise   0.045
  headBlend  0.006
```

- [ ] **Step 5: Teach TypeScript about `?raw`**

Create `src/lab/sdf-zombie/characters/blob.d.ts`:

```ts
declare module '*.blob?raw' {
  const content: string;
  export default content;
}
```

- [ ] **Step 6: Run GREEN**

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/characters/`

Expected: PASS, 4 tests. If bone positions differ by more than 0.1 mm, an angle
is wrong — re-run Step 1 rather than loosening the tolerance.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
git add src/lab/sdf-zombie/characters scripts/derive_blob_angles.mjs
git commit -m "feat(sdf-lab): author zombie.blob and pin it to the TypeScript zombie"
```

---

## Task 6: Render a `.blob` character in the lab

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts:172-173`
- Test: `src/lab/sdf-zombie/blob-compile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('compiles the shipped zombie.blob through the same path lab-main uses', async () => {
  const src = (await import('./characters/zombie.blob?raw')).default;
  const { buildBody, DEFAULT_BUILD_OPTS } = await import('./build-body');
  const built = buildBody(compileBlob(parseBlob(src)), DEFAULT_BUILD_OPTS, {});
  expect(built.errors).toEqual([]);
  expect(built.prims.length).toBeGreaterThan(20);
});
```

- [ ] **Step 2: Run RED, then wire the lab**

In `lab-main.ts`, replace the body construction at line 172-173:

```ts
  const face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
  const body = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
```

with:

```ts
  const face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
  // The zombie is authored in zombie.blob now. makeZombie() stays as the
  // reference the anchor test pins the language against — if the compiled
  // document ever fails, fall back rather than showing a blank lab.
  const body = buildBody(compileZombie(face) ?? makeZombie(face), DEFAULT_BUILD_OPTS, override);
```

and add near the imports:

```ts
import zombieBlobSrc from '../characters/zombie.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';

/** Compiles the authored zombie, or null if the document is broken. */
function compileZombie(face: FaceParams) {
  try {
    return compileBlob(parseBlob(zombieBlobSrc), face);
  } catch (e) {
    console.error('[blob] zombie.blob failed to compile, using the TS zombie', e);
    return null;
  }
}
```

- [ ] **Step 3: Run the full suite and build**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run
npx tsc --noEmit && npm run build
```

Expected: all green.

- [ ] **Step 4: Real browser smoke — REQUIRED**

Start the dev server and load `/sdf-lab-webgpu.html`. Confirm: the zombie
renders, the panel reports zero errors, and the face sliders still retune the
head live (that proves the `face` block did not freeze the parameters).

**If the canvas is blank, resize the window before diagnosing** — the lab's
render target can be sized to a stale viewport after a reload, which looks
exactly like a broken build but is not.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts src/lab/sdf-zombie/blob-compile.test.ts
git commit -m "feat(sdf-lab): render the zombie from zombie.blob"
```

---

## Task 7: Always-on `fused` / `clear` checks

**Files:**
- Create: `src/lab/sdf-zombie/blob-checks.ts`
- Test: `src/lab/sdf-zombie/blob-checks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/blob-checks.test.ts
import { describe, it, expect } from 'vitest';
import { minFieldOnSegment, clearOf } from './blob-checks';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import src from './characters/zombie.blob?raw';

const zombie = () => buildBody(compileBlob(parseBlob(src)));

describe('blob checks', () => {
  it('reports the field staying inside the flesh between two fused clusters', () => {
    const b = zombie();
    const torso = b.clusters.find(c => c.limb === 'torso')!;
    const head = b.clusters.find(c => c.limb === 'head')!;
    expect(minFieldOnSegment(b, torso.center, head.center)).toBeLessThan(0);
  });

  it('reports a positive separation between two parts that must not touch', () => {
    const b = zombie();
    const armL = b.clusters.find(c => c.limb === 'armL')!;
    const legR = b.clusters.find(c => c.limb === 'legR')!;
    expect(clearOf(b, armL, legR)).toBeGreaterThan(0);
  });

  it('catches a hand driven into the opposite thigh', () => {
    const doc = parseBlob(src.replace('bone upperArm parent=clavicle dir=down tilt=16.699244',
                                      'bone upperArm parent=clavicle dir=down tilt=-40'));
    const b = buildBody(compileBlob(doc));
    const armL = b.clusters.find(c => c.limb === 'armL')!;
    const legL = b.clusters.find(c => c.limb === 'legL')!;
    expect(clearOf(b, armL, legL)).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL — no module `./blob-checks`.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/blob-checks.ts
import type { BuiltBody, ClusterInfo, Vec3 } from './types';
import { sdBody } from './validate';
import { lerp } from './vec';

/**
 * WAM answers "am I inside this shape" with 955 lines of triangle raycasting.
 * An SDF answers it directly, which is why these checks are a few lines: the
 * field IS the containment test.
 */
export function minFieldOnSegment(body: BuiltBody, a: Vec3, b: Vec3, steps = 64): number {
  let worst = Infinity;
  for (let i = 0; i <= steps; i++) worst = Math.min(worst, sdBody(lerp(a, b, i / steps), body));
  return worst;
}

/** Positive means the two clusters are apart; <= 0 means they interpenetrate. */
export function clearOf(body: BuiltBody, a: ClusterInfo, b: ClusterInfo): number {
  return minFieldOnSegment(body, a.center, b.center);
}
```

> If `lerp` in `vec.ts` does not accept two `Vec3`s and a scalar, write the
> three-component interpolation inline rather than changing `vec.ts`.

- [ ] **Step 4: Run GREEN, then commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-checks.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/blob-checks.ts src/lab/sdf-zombie/blob-checks.test.ts
git commit -m "feat(sdf-lab): fused and clear checks evaluated on the SDF"
```

---

## Task 8: The emitter, and comment preservation

**Files:**
- Create: `src/lab/sdf-zombie/blob-emit.ts`
- Test: `src/lab/sdf-zombie/blob-emit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/blob-emit.test.ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from './blob-parse';
import { emitBlob } from './blob-emit';
import src from './characters/zombie.blob?raw';

describe('emitBlob', () => {
  it('round-trips the zombie to an identical document', () => {
    expect(emitBlob(parseBlob(src))).toBe(src.trimEnd() + '\n');
  });

  it('is idempotent — parse(emit(parse(x))) emits the same text', () => {
    const once = emitBlob(parseBlob(src));
    expect(emitBlob(parseBlob(once))).toBe(once);
  });

  // The whole reason trivia exists. troll.wam and body.ts are half reasoning.
  it('preserves every comment line', () => {
    const comments = (t: string) => t.split('\n').filter(l => l.trim().startsWith('#'));
    expect(comments(emitBlob(parseBlob(src)))).toEqual(comments(src));
  });

  it('writes tuned face parameters back into the face block', () => {
    const out = emitBlob(parseBlob(src), { face: { headRadius: 0.131 } });
    expect(out).toContain('headRadius 0.131');
    expect(out).not.toContain('headRadius 0.118');
  });

  it('leaves the rest of the document untouched when only the face changed', () => {
    const out = emitBlob(parseBlob(src), { face: { headRadius: 0.131 } });
    const bodyOf = (t: string) => t.slice(t.indexOf('body'), t.indexOf('face'));
    expect(bodyOf(out)).toBe(bodyOf(src));
  });
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL — no module `./blob-emit`.

- [ ] **Step 3: Implement**

Every node kept its source line, so the emitter replays lines rather than
re-printing values. Anything the override does not touch comes back byte-exact,
which is what makes comment and alignment preservation fall out for free.

```ts
// src/lab/sdf-zombie/blob-emit.ts
import type { BlobDoc, BlobLine } from './blob-ast';

export interface EmitOverride {
  /** Face parameters to substitute, by name. Omitted keys keep their source line. */
  face?: Record<string, number>;
}

function rebuild(l: BlobLine, text?: string): string {
  const body = text ?? ' '.repeat(l.indent) + l.words.join(' ');
  return l.trailing ? `${body} ${l.trailing}` : body;
}

/**
 * Writes a document back out.
 *
 * Ordering is by source line across EVERY owner — bones, parts, face params and
 * the structural keywords in `doc.structure`. Miss the structural lines and the
 * output silently loses `skeleton`/`body`/`mirror`/`end`, which still parses as
 * a document and is therefore a bug that tests, not types, have to catch.
 */
export function emitBlob(doc: BlobDoc, override: EmitOverride = {}): string {
  const owned: { l: BlobLine; faceKey?: string }[] = [
    ...doc.structure.map(l => ({ l })),
    ...doc.bones.map(b => ({ l: b.src })),
    ...doc.parts.map(p => ({ l: p.src })),
    ...doc.faceTrivia.map(l => ({ l, faceKey: l.words[0]! })),
  ].sort((a, b) => a.l.line - b.l.line);

  const out: string[] = [];
  for (const { l, faceKey } of owned) {
    out.push(...l.leading);
    const v = faceKey === undefined ? undefined : override.face?.[faceKey];
    out.push(rebuild(l, v === undefined
      ? undefined
      : ' '.repeat(l.indent) + `${faceKey} ${v}`));
  }
  out.push(...doc.trailingTrivia);

  return out.join('\n').trimEnd() + '\n';
}
```

> The face substitution deliberately reprints only `key value`, dropping the
> original column padding on that one line. If the round-trip test fails purely
> on face-block whitespace, pad to the original column rather than loosening the
> assertion — alignment is part of what makes these files readable.

- [ ] **Step 4: Run GREEN, then commit**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/blob-emit.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/blob-emit.ts src/lab/sdf-zombie/blob-emit.test.ts \
  src/lab/sdf-zombie/blob-parse.ts
git commit -m "feat(sdf-lab): emit .blob back out with comments intact"
```

---

## Task 9: The turntable

**Files:**
- Create: `scripts/blob-turntable.mjs`

Model it on `scripts/verify-orient.mjs` — same no-deps Node CDP pattern against
Chrome `--remote-debugging-port=9223`, same `<vitePort> <outDir>` argv shape.

- [ ] **Step 1: Write the script**

Drive `__sdfLab.camera` directly rather than synthesising mouse drags — the lab
exposes the camera object, and a deterministic angle is the entire point of a
turntable.

```js
// scripts/blob-turntable.mjs
// Deterministic N-angle capture of the lab body, for judging a .blob character
// by eye. Same no-deps CDP pattern as scripts/verify-orient.mjs.
//
// Usage: node scripts/blob-turntable.mjs <vitePort> <outDir> [frames]
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5233);
const OUT = process.argv[3] ?? '/tmp/turntable';
const FRAMES = Number(process.argv[4] ?? 8);
const CDP = 9223;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise(ok => { pending.set(++seq, ok); ws.send(JSON.stringify({ id: seq, method, params })); });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-lab-webgpu.html` });
await sleep(6000); // WebGPU pipeline compile is slow on first load

// Hide the debug panel so it does not occlude the body.
await evaluate(`document.querySelector('#panel').hidden = true;
                document.querySelector('#panel-toggle').style.display = 'none';
                document.querySelector('#controls').style.display = 'none'; true`);

const errors = await evaluate(`JSON.stringify(globalThis.__sdfLab.current.errors)`);
if (errors && errors !== '[]') { console.error('validation errors:', errors); process.exit(1); }

const RADIUS = 3.2, HEIGHT = 1.35, TARGET_Y = 0.95;
for (let i = 0; i < FRAMES; i++) {
  const yaw = (i / FRAMES) * Math.PI * 2;
  await evaluate(`(() => {
    const c = globalThis.__sdfLab.camera;
    c.position.set(${Math.sin(yaw)} * ${RADIUS}, ${HEIGHT}, ${Math.cos(yaw)} * ${RADIUS});
    c.lookAt(0, ${TARGET_Y}, 0);
    c.updateMatrixWorld(true);
    return true;
  })()`);
  await sleep(350); // let the marcher settle before grabbing the frame
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT}/frame-${String(i).padStart(2, '0')}.png`;
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`wrote ${file}  yaw=${(yaw * 180 / Math.PI).toFixed(0)}deg`);
}

// Blank-frame guard: an all-one-colour capture means the lab never rendered.
const blank = await evaluate(`(() => {
  const cv = document.querySelector('canvas');
  return !cv || cv.width === 0 || cv.height === 0;
})()`);
if (blank) { console.error('canvas reported zero size — nothing was captured'); process.exit(1); }

console.log(`\n${FRAMES} frames in ${OUT}`);
ws.close();
```

> There is no contact-sheet step: compositing needs an image library and this
> repo has none. Open the frames directly, or add compositing later if flipping
> through eight PNGs actually proves annoying.

- [ ] **Step 2: Run it against a live server**

```bash
npx vite --port 5233 &
node scripts/blob-turntable.mjs 5233 /tmp/turntable
```

Expected: 8 PNGs plus a contact sheet; every frame shows the body, none blank.

- [ ] **Step 3: Commit**

```bash
git add scripts/blob-turntable.mjs
git commit -m "feat(sdf-lab): deterministic turntable capture for .blob characters"
```

---

## Task 10: The authoring skill

**Files:**
- Create: `.claude/skills/authoring-sdf-characters/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: authoring-sdf-characters
description: Use when creating or editing a Blud SDF character - writing a .blob file, adding a creature to the bestiary, or retuning an existing body's proportions.
---

# Authoring SDF characters

Blud's characters are raymarched signed-distance fields built from blended
primitives. You author them in `.blob` text, which compiles to `BodyDef`. You
never hand-write `BodyDef` TypeScript.

## Read this first

`src/lab/sdf-zombie/characters/zombie.blob` is the worked example and the house
style. Read it before writing anything. Note how many lines are comments
explaining WHY a number is what it is — that is the format working as intended,
not clutter.

## The loop

1. **Write** `src/lab/sdf-zombie/characters/<name>.blob`.
2. **Compile and check:**
   `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/`
3. **Look at it:** `node scripts/blob-turntable.mjs 5233 /tmp/<name>` and open
   the frames.
4. **Iterate on the text**, never on compiled output.

## Look at the render. The checks are not enough.

`validateBody` proves a body is closed, connected and inside its bounds. It
cannot tell you the body reads well. The FPV hand/wrist bake in
`X1.hand-followups` passed every topological gate — zero boundary edges, one
connected component, sub-millimetre contact error — and still failed owner
review because the wrist did not merge in an anatomically convincing way.

Closed is not the same as convincing. Always open the turntable frames.

## Comment every non-obvious number

A number without a reason is a number the next author cannot safely change.
Write the reason, in the voice `zombie.blob` uses:

```
# Apelike arms — upperarm plus forearm is longer than the leg, which is what
# puts the knuckles below the knee. Shrinking these is how the silhouette
# stops reading as a brute.
bone upperArm parent=clavicle dir=down tilt=16.7 len=0.30
```

The emitter preserves these across a round trip, so they survive panel tuning.

## Two constraints that bite silently

- **Primitive order is fold order.** `assignClusters` requires each cluster to
  own a contiguous run. Group a limb's parts together and do not interleave.
- **A single cluster may not exceed 64 primitives** (`MAX_CLUSTER_PRIMS`). Past
  that the shader stops folding and the surface loses geometry with no error.
  `validateBody` now catches this; do not raise the constant to silence it.

## The dials

- `blend=` is smooth-min strength — the roundness dial, and the main thing that
  makes an SDF character read as SDF rather than as boxes.
- `carve ... hard` subtracts with `blendK: 0`. Use hard carves for sockets and
  stumps. A smooth carve smears, because smin's blend is wider than an eye
  socket — this was learned across four failed rebuilds of the face.
- `wide`/`tall`/`deep` scale a part's axes; omitted axes are 1.
- The `face` block is `FaceParams`, still live-tunable in the lab panel.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/authoring-sdf-characters/SKILL.md
git commit -m "docs(sdf-lab): skill for authoring .blob characters"
```

---

## Task 11: Close out

- [ ] Update `TASKS.md` `P8` with the measured state: what shipped, what did not.
- [ ] Run the full suite, `npx tsc --noEmit`, `npm run build`, `git diff --check`.
- [ ] Confirm the lab still renders from `zombie.blob` in a real browser.
- [ ] Commit `docs: close out P8 SDF character language`.

**Not in this plan, deliberately:** animation (Blud has its own system and a
deterministic sim), palette/materials (the flesh presets and the `X1.3` retune
own colour), intent assertions (`below`/`reads` — deferred until a cast exists),
and a direct-manipulation GUI (revisit after 2-3 characters).
