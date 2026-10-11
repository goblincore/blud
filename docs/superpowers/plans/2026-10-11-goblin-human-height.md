# The Goblin at Human Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the goblin 1.70 m tall (a uniform 1.3077 scale-up of the approved 1.30 m goblin), body, armour kit, gait and held gun together, with its look unchanged.

**Architecture:** A new `scale` line in a `.blob`'s `model` block is applied once, at the end of `compileBlob`, by a pure, typed `scaleBodyDef` (every length multiplied, directions and fractions left alone). Everything downstream sees metres at the new size. The WAM kit follows by changing its `height` and rebuilding; the gait and grip constants are retuned by the numbers in the [spec](../specs/2026-10-11-goblin-human-height-design.md); the goblin's metre pins are re-derived from the scale.

**Tech Stack:** TypeScript, Vitest, `.blob` and WAM (`~/Projects/2026/wam`), the lab turntable (`npm run blob:shot`).

**Spec:** [`docs/superpowers/specs/2026-10-11-goblin-human-height-design.md`](../specs/2026-10-11-goblin-human-height-design.md). **Branch:** `claude/goblin-human-height` (already created from `origin/main`).

**House rules (from `CLAUDE.md`):** do not run the full test suite. Use `npm run typecheck`, `npm run test:changed`, and `npx vitest run <path>`. CI runs everything on every push. Commit messages end with the attribution line the session gives.

## File structure

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/body-scale.ts` | **new**: `scaleBodyDef` and the typed unit tables |
| `src/lab/sdf-zombie/body-scale.test.ts` | **new** |
| `src/lab/sdf-zombie/blob-ast.ts` | `BlobDoc.scale: number \| null` |
| `src/lab/sdf-zombie/blob-parse.ts` | parse `scale` in the `model` block |
| `src/lab/sdf-zombie/blob-compile.ts` | `compileBlob` returns `scaleBodyDef(def, doc.scale ?? 1)` |
| `src/lab/sdf-zombie/blob-parse.test.ts`, `blob-compile.test.ts` | new cases |
| `src/lab/sdf-zombie/characters/goblin.blob` | `height 1.70`, `scale 1.3077`, header note |
| `src/lab/sdf-zombie/characters/goblin-kit.wam` | `height 1.70`; header note |
| `public/assets/lab/goblin-kit.gltf` | rebuilt |
| `src/lab/sdf-zombie/motion-profile.ts`, `gait.ts` | the goblin's cadence, speeds and grip |
| `src/lab/sdf-zombie/characters/goblin-blob.test.ts`, `goblin-kit.test.ts`, `src/lab/sdf-zombie/goblin-gait.test.ts`, `goblin-held-gun.test.ts` (and any other goblin test that fails) | metre pins derived from the scale |
| `docs/dev-notes/2026-10-11-goblin-human-height/NOTES.md` + sheet | **new** |
| `TASKS.md`, `docs/tasks/characters.md`, the spec's status line | updated |

---

### Task 1: `scaleBodyDef`, the pure scaler

**Files:**
- Create: `src/lab/sdf-zombie/body-scale.ts`
- Create: `src/lab/sdf-zombie/body-scale.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/body-scale.test.ts
import { describe, it, expect } from 'vitest';
import { scaleBodyDef } from './body-scale';
import type { BodyDef, PrimDef } from './types';

// EVERY PrimDef key populated: `Required<PrimDef>` makes this fail to compile when a field is added to PrimDef, which is the
// prompt to decide (in body-scale.ts) whether the new field is a length.
const FULL_PRIM: Required<PrimDef> = {
  bone: 'spine', src: 7, at: 0.5, capTo: 0.9, radius: 0.10, radiusB: 0.05, scale: [1, 2, 3], blendK: 0.02,
  blendProfile: 'chamfer', bend: [0.01, 0.02, 0.03], limb: 'torso', mirror: true, side: 'l', op: 'add',
  grooveDepth: 0.004, grooveWidth: 0.005, offset: [0.1, 0.2, 0.3], tip: [0.4, 0.5, 0.6], mirrorOffset: true,
  color: [0.1, 0.2, 0.3], gloss: 0.5, metal: true, glow: 0.3, core: true, rigid: true, when: 'dead',
  shell: { thickness: 0.002, clipNormal: [0, 1, 0], clipOffset: 0.03, rim: 0.004, warpAmp: 0.01, warpFreq: [20, 0, 40] },
  box: { round: 0.25 }, strand: { count: 5, wave: 0.2, cycles: 2, fat: 0.5 },
};

const DEF: BodyDef = {
  name: 'test', root: [0, 0.6, 0],
  bones: [
    { name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.1 },
    { name: 'clavicle', parent: 'pelvis', dir: [1, 0, 0], length: 0.04, lengthR: 0.05, side: 0.036, mirror: true },
  ],
  prims: [FULL_PRIM],
  bonePrims: [{ ...FULL_PRIM, op: 'bone' }],
  boneRatio: 0.38,
};

const K = 2;

describe('scaleBodyDef', () => {
  it('is the identity at k = 1 (the same object, so nothing else pays for it)', () => {
    expect(scaleBodyDef(DEF, 1)).toBe(DEF);
  });

  it('rejects a scale that is not a positive finite number', () => {
    for (const k of [0, -1, NaN, Infinity]) expect(() => scaleBodyDef(DEF, k)).toThrow(/positive/);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify(DEF);
    scaleBodyDef(DEF, K);
    expect(JSON.stringify(DEF)).toBe(before);
  });

  it('scales the root and the bone lengths, lengthR and side; leaves directions, names and flags', () => {
    const out = scaleBodyDef(DEF, K);
    expect(out.root).toEqual([0, 1.2, 0]);
    expect(out.bones[0]).toEqual({ name: 'pelvis', parent: null, dir: [0, 1, 0], length: 0.2 });
    expect(out.bones[1]).toEqual({ name: 'clavicle', parent: 'pelvis', dir: [1, 0, 0], length: 0.08, lengthR: 0.1, side: 0.072, mirror: true });
    expect(out.boneRatio).toBe(0.38);
  });

  it('scales every length on a prim, in body prims and in bone prims alike', () => {
    const out = scaleBodyDef(DEF, K);
    for (const p of [out.prims[0]!, out.bonePrims![0]!]) {
      expect(p.radius).toBeCloseTo(0.2, 12);
      expect(p.radiusB).toBeCloseTo(0.1, 12);
      expect(p.blendK).toBeCloseTo(0.04, 12);
      expect(p.grooveDepth).toBeCloseTo(0.008, 12);
      expect(p.grooveWidth).toBeCloseTo(0.01, 12);
      expect(p.offset).toEqual([0.2, 0.4, 0.6]);
      expect(p.tip).toEqual([0.8, 1.0, 1.2]);
      expect(p.bend).toEqual([0.02, 0.04, 0.06]);
    }
  });

  it('scales the shell lengths and DIVIDES its wrinkle frequency (radians per metre)', () => {
    const s = scaleBodyDef(DEF, K).prims[0]!.shell!;
    expect(s.thickness).toBeCloseTo(0.004, 12);
    expect(s.clipOffset).toBeCloseTo(0.06, 12);
    expect(s.rim).toBeCloseTo(0.008, 12);
    expect(s.warpAmp).toBeCloseTo(0.02, 12);
    expect(s.warpFreq).toEqual([10, 0, 20]);
    expect(s.clipNormal).toEqual([0, 1, 0]);
  });

  it('leaves every fraction, ratio, direction, colour and flag alone', () => {
    const p = scaleBodyDef(DEF, K).prims[0]!;
    expect(p.at).toBe(0.5);
    expect(p.capTo).toBe(0.9);
    expect(p.scale).toEqual([1, 2, 3]);
    expect(p.box).toEqual({ round: 0.25 });
    expect(p.strand).toEqual({ count: 5, wave: 0.2, cycles: 2, fat: 0.5 });
    expect(p.color).toEqual([0.1, 0.2, 0.3]);
    expect(p.bone).toBe('spine');
    expect(p.side).toBe('l');
    expect(p.limb).toBe('torso');
    expect(p.when).toBe('dead');
  });

  it('keeps an absent optional field absent (no NaN, no undefined key)', () => {
    const bare: BodyDef = { name: 'b', root: [0, 1, 0], bones: [], prims: [{ bone: 'x', at: 0, radius: 0.1, scale: [1, 1, 1], blendK: 0.01, limb: 'torso' }] };
    const p = scaleBodyDef(bare, K).prims[0]!;
    expect(Object.keys(p).sort()).toEqual(['at', 'blendK', 'bone', 'limb', 'radius', 'scale']);
    expect(p.radius).toBeCloseTo(0.2, 12);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/body-scale.test.ts`
Expected: FAIL (`Cannot find module './body-scale'`).

- [ ] **Step 3: Write the implementation**

```ts
// src/lab/sdf-zombie/body-scale.ts
//
// A uniform SCALE for a compiled body (spec docs/superpowers/specs/2026-10-11-goblin-human-height-design.md, section 3). A `.blob`'s
// numbers are absolute metres; `scale k` in its `model` block multiplies every LENGTH once, here, so the character can be resized
// without rewriting a file whose comments quote the old metres. Fractions (`at`, `scale`, `box.round`, strand `fat`), directions,
// colours and flags are not lengths and are left alone.
//
// THE GUARD. Each table below is `satisfies Record<keyof T, Unit>`: adding a field to PrimDef, BoneDef or ShellParams fails the typecheck
// until someone decides here whether it is a length. A silent default would resize the body wrongly in a way no test of today's fields sees.
import type { BodyDef, BoneDef, PrimDef, ShellParams, Vec3 } from './types';

/** `length`: metres, multiplied. `perLength`: radians per metre, divided. `same`: not a length. */
export type FieldUnit = 'length' | 'perLength' | 'same';

export const BONE_UNITS = {
  name: 'same', parent: 'same', dir: 'same', length: 'length', lengthR: 'length', side: 'length', mirror: 'same',
} as const satisfies Record<keyof BoneDef, FieldUnit>;

export const SHELL_UNITS = {
  thickness: 'length', clipNormal: 'same', clipOffset: 'length', rim: 'length', warpAmp: 'length', warpFreq: 'perLength',
} as const satisfies Record<keyof ShellParams, FieldUnit>;

export const PRIM_UNITS = {
  bone: 'same', src: 'same', at: 'same', capTo: 'same',
  radius: 'length', radiusB: 'length', scale: 'same', blendK: 'length', blendProfile: 'same', bend: 'length',
  limb: 'same', mirror: 'same',
  // `side` on a PrimDef is 'l' | 'r' (which half a single-sided prim lives on), not a distance.
  side: 'same',
  op: 'same', grooveDepth: 'length', grooveWidth: 'length', offset: 'length', tip: 'length', mirrorOffset: 'same',
  color: 'same', gloss: 'same', metal: 'same', glow: 'same', core: 'same', rigid: 'same', when: 'same',
  // `shell` is recursed into below (SHELL_UNITS); `box` and `strand` hold fractions and counts only.
  shell: 'same', box: 'same', strand: 'same',
} as const satisfies Record<keyof PrimDef, FieldUnit>;

const mul = (v: number | Vec3, f: number): number | Vec3 =>
  typeof v === 'number' ? v * f : [v[0] * f, v[1] * f, v[2] * f];

function scaleFields<T extends object>(src: T, units: Record<keyof T, FieldUnit>, k: number): T {
  const out: Record<string, unknown> = { ...src };
  for (const key of Object.keys(src) as (keyof T & string)[]) {
    const unit = units[key];
    const v = (src as Record<string, unknown>)[key];
    if (unit === 'same' || v === undefined) continue;
    out[key] = mul(v as number | Vec3, unit === 'length' ? k : 1 / k);
  }
  return out as T;
}

function scalePrim(p: PrimDef, k: number): PrimDef {
  const out = scaleFields(p, PRIM_UNITS, k);
  return p.shell ? { ...out, shell: scaleFields(p.shell, SHELL_UNITS, k) } : out;
}

/** The body at `k` times its authored size: the same object when k is 1, a new one otherwise (the input is never mutated). */
export function scaleBodyDef(def: BodyDef, k: number): BodyDef {
  if (!(k > 0) || !Number.isFinite(k)) throw new Error(`scaleBodyDef: scale must be a positive finite number, got ${k}`);
  if (k === 1) return def;
  return {
    ...def,
    root: mul(def.root, k) as Vec3,
    bones: def.bones.map(b => scaleFields(b, BONE_UNITS, k)),
    prims: def.prims.map(p => scalePrim(p, k)),
    ...(def.bonePrims ? { bonePrims: def.bonePrims.map(p => scalePrim(p, k)) } : {}),
  };
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run src/lab/sdf-zombie/body-scale.test.ts && npm run typecheck`
Expected: PASS, no type errors. (If `LimbBase` rejects `'torso'` in the test's `FULL_PRIM`, use any member of the `LimbBase` union from `types.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/body-scale.ts src/lab/sdf-zombie/body-scale.test.ts
git commit -m "feat(blob): scaleBodyDef, a typed uniform scale for a compiled body"
```

---

### Task 2: the `scale` directive (parse, compile, emit)

**Files:**
- Modify: `src/lab/sdf-zombie/blob-ast.ts` (`BlobDoc`, near `height` at line 181)
- Modify: `src/lab/sdf-zombie/blob-parse.ts` (the `BlobDoc` literal near line 710; the `model` block handling near line 724)
- Modify: `src/lab/sdf-zombie/blob-compile.ts` (`compileBlob`, line 473)
- Test: `src/lab/sdf-zombie/blob-parse.test.ts`, `src/lab/sdf-zombie/blob-compile.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `blob-parse.test.ts` (it already imports `parseBlob` and `BlobError`; add them if the file's import lines differ):

```ts
describe('model scale', () => {
  const MINI = (scaleLine: string) => `model mini
  height 1.00
${scaleLine}
skeleton
  root pelvis at 0.50 len=0.10
  bone spine parent=pelvis dir=up pitch=13 len=0.20

body
  blob torso on spine at=0.50 r=0.05 offset=(0.01,0.02,0.03) blend=0.01
`;

  it('reads a positive scale in the model block', () => {
    expect(parseBlob(MINI('  scale 1.5')).scale).toBe(1.5);
  });

  it('is null when the model declares none', () => {
    expect(parseBlob(MINI('')).scale).toBeNull();
  });

  it.each(['0', '-1', 'abc', ''])('rejects scale "%s" with the line number', bad => {
    expect(() => parseBlob(MINI(`  scale ${bad}`))).toThrow(/scale must be a positive number/);
  });
});
```

Append to `blob-compile.test.ts`:

```ts
describe('compileBlob with a model scale', () => {
  const src = (scale: string) => `model mini
  height 1.00
${scale}
skeleton
  root pelvis at 0.50 len=0.10
  bone spine parent=pelvis dir=up pitch=13 len=0.20

body
  blob torso on spine at=0.50 r=0.05 offset=(0.01,0.02,0.03) blend=0.01
`;

  it('multiplies the lengths by the scale: root, bone lengths, radius, offset, blend', () => {
    const base = compileBlob(parseBlob(src('')));
    const big = compileBlob(parseBlob(src('  scale 2')));
    expect(big.root).toEqual([0, base.root[1] * 2, 0]);
    expect(big.bones.map(b => b.length)).toEqual(base.bones.map(b => b.length * 2));
    expect(big.prims[0]!.radius).toBeCloseTo(base.prims[0]!.radius * 2, 12);
    expect(big.prims[0]!.offset).toEqual([0.02, 0.04, 0.06]);
    expect(big.prims[0]!.blendK).toBeCloseTo(0.02, 12);
    expect(big.prims[0]!.at).toBe(base.prims[0]!.at);
  });

  it('scales the generated face prims with the body', () => {
    const base = compileBlob(parseBlob(src('')));
    const big = compileBlob(parseBlob(src('  scale 2')));
    expect(big.prims.length).toBe(base.prims.length);
    for (let i = 1; i < base.prims.length; i++) expect(big.prims[i]!.radius).toBeCloseTo(base.prims[i]!.radius * 2, 12);
  });

  it('is unchanged without a scale line', () => {
    expect(compileBlob(parseBlob(src('')))).toEqual(compileBlob(parseBlob(src('  scale 1'))));
  });
});
```

(Use whatever imports the compile test already has; it must import `parseBlob`, `compileBlob`.)

Also add to `blob-emit.test.ts`, after the glob tests:

```ts
  it('round-trips a scale line', () => {
    const text = 'model mini\n  height 1.00\n  scale 1.3077\nskeleton\n  root pelvis at 0.50 len=0.10\n\nbody\n';
    expect(emitBlob(parseBlob(text))).toBe(text.trimEnd() + '\n');
  });
```

(Place it inside the existing `describe('emitBlob', ...)`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lab/sdf-zombie/blob-parse.test.ts src/lab/sdf-zombie/blob-compile.test.ts src/lab/sdf-zombie/blob-emit.test.ts -t "scale"`
Expected: FAIL (`scale` is not a field; the `scale` line is currently ignored, so the compile test sees the unscaled body).

- [ ] **Step 3: Implement**

`blob-ast.ts`, in `BlobDoc`, directly under `height: number | null;`:

```ts
  /**
   * Uniform scale applied to every length when the document is COMPILED (body-scale.ts), or null for 1. `height` stays a label; with a
   * scale it reads authored height times scale. Parsed from a `scale <k>` line in the `model` block.
   */
  scale: number | null;
```

`blob-parse.ts`, the `BlobDoc` literal in `parseBlob`: change `name: '', height: null,` to `name: '', height: null, scale: null,`. Then under the `height` line in the loop, add:

```ts
    if (head === 'scale' && section === 'model') {
      const k = Number(rest[0]);
      if (!(k > 0) || !Number.isFinite(k))
        throw new BlobError(`scale must be a positive number, got "${rest[0] ?? ''}"`, l.line, l.indent + 1);
      s.doc.scale = k;
      s.doc.structure.push(l);
      continue;
    }
```

`blob-compile.ts`: add `import { scaleBodyDef } from './body-scale';` and change the tail of `compileBlob` from `return { name: ... }` to build `const def: BodyDef = { ...same object... }; return scaleBodyDef(def, doc.scale ?? 1);` (keep the existing explanatory comment on `bonePrims` where it is).

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/lab/sdf-zombie/blob-parse.test.ts src/lab/sdf-zombie/blob-compile.test.ts src/lab/sdf-zombie/blob-emit.test.ts src/lab/sdf-zombie/body-scale.test.ts && npm run typecheck`
Expected: PASS. `tsc` flags any other file that builds a `BlobDoc` literal (only `blob-parse.ts` did at the time of writing); add `scale: null` there.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/blob-ast.ts src/lab/sdf-zombie/blob-parse.ts src/lab/sdf-zombie/blob-compile.ts src/lab/sdf-zombie/blob-parse.test.ts src/lab/sdf-zombie/blob-compile.test.ts src/lab/sdf-zombie/blob-emit.test.ts
git commit -m "feat(blob): a model scale line, applied once at compile"
```

---

### Task 3: scale the goblin body

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin.blob` (lines 24-26, the `model` block, and a header paragraph)
- Modify: `src/lab/sdf-zombie/characters/goblin-blob.test.ts`

- [ ] **Step 1: Capture the "before" frames and numbers**

Run (writes inside the worktree; the app may already hold ports, see `scripts/blob-shot.sh` for `LAB_VITE_PORT`/`LAB_CDP_PORT`):

```bash
LAB_TMP=.lab-tmp npm run blob:shot -- goblin .lab-tmp/goblin-height/before 8
npm run blob:measure -- goblin 2>&1 | tee .lab-tmp/goblin-height/before-measure.txt | head -40
```

Expected: frames and a measure table. Keep `.lab-tmp/` out of git (it is ignored; confirm with `git status`).

- [ ] **Step 2: Edit the model block**

In `goblin.blob`, replace

```
model goblin
  height 1.30
```

with

```
model goblin
  # 1.70 m = the authored 1.30 m x `scale` 1.3077 (owner, 2026-10-11: the levels are scaled to the human player, so the goblin is near
  # human height). Every number BELOW is still the authored 1.30 m value and every comment quoting a metre figure is in those authored
  # units: the compiler multiplies the lot by `scale` (body-scale.ts). Fine surface detail (palette grain, mottle, the face sheet) is
  # texture-space and does NOT scale, which is what keeps the body grain small.
  height 1.70
  scale 1.3077
```

- [ ] **Step 3: See what fails**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`
Expected: FAIL in the tests that pin a length (the arm-daylight, belly-offset, gut-profile and dip pins read thresholds in metres: 0.030, 0.015, 0.008, 0.015, 0.010 and the `0.235` and `0.11` probe distances). The structural tests (`compiles and validates clean`, palette, stance, grain) must still pass: if `validateBody` reports errors, stop and read them (a containment tolerance that is absolute in metres is the usual cause) before changing anything else.

- [ ] **Step 4: Derive each pin from the scale**

At the top of `goblin-blob.test.ts`, below `const doc = parseBlob(src);`, add:

```ts
// The authored numbers (and every threshold below) are at the goblin's authored 1.30 m; the .blob's `scale` line makes the compiled body bigger (1.70 m).
// A pin that is a LENGTH is the authored figure times K, so tightening or loosening one stays a visible choice.
const K = doc.scale ?? 1;
```

Then, for each failing assertion, apply exactly this rule and nothing looser: a probe distance or threshold that is a length becomes `<authored value> * K` (`0.235` becomes `0.235 * K`, `0.030` becomes `0.030 * K`); a ratio or an angle is untouched. Do not edit a number that does not fail unless it is a length (the same rule: it passes today only because the margin is large). Update the comments' quoted figures only where they would now mislead: add "(authored units; times K in the code)" once near `K`, not on every line.

If a pin still fails after the rule, **the body is not a pure scale of the old one** (something in the compile is not a length, or is a length the table misses): stop, find which field, and fix `body-scale.ts` (with a test) rather than moving a threshold.

- [ ] **Step 5: Run the goblin and scale tests, then the neighbours that use the goblin as a fixture**

Run:

```bash
npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts src/lab/sdf-zombie/characters/goblin-poses.test.ts
npx vitest run $(grep -rlE "goblin" src/lab/sdf-zombie --include='*.test.ts' | grep -vE "goblin-kit|goblin-gait|goblin-held-gun|goblin-blob|goblin-poses" | tr '\n' ' ')
```

Expected: PASS. A failure here is a test using the goblin as a fixture with an absolute metre (silhouette, pack, rig-bind, taper, strand, bend, pose-motion, occluder-hull and the like): apply the Step 4 rule to it, and say in the commit message which ones moved.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin.blob src/lab/sdf-zombie/characters/goblin-blob.test.ts
git add -u src/lab/sdf-zombie
git commit -m "feat(goblin): 1.70 m, the body scaled 1.3077 by the model's scale line"
```

---

### Task 4: the armour kit

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin-kit.wam` (`height` at line 58, the header's UNITS note at lines 22-23)
- Rebuild: `public/assets/lab/goblin-kit.gltf`
- Modify: `src/lab/sdf-zombie/characters/goblin-kit.test.ts`

- [ ] **Step 1: Run the kit's fit test against the scaled body, to see it fail**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts`
Expected: FAIL: the committed kit is still 1.30 m while the body is now 1.70 m, so plates sit inside the flesh and clearances are off. This is the test doing its job.

- [ ] **Step 2: Change the kit's height and say why**

In `goblin-kit.wam`, change `height 1.30` (line 58, in `model goblin-kit`) to `height 1.70`. Replace the header's UNITS bullet (lines 22-23) with:

```
#   * UNITS. WAM lengths are fractions of `height`; .blob's are metres. Every number here is the AUTHORED .blob metre value / 1.30. The
#     .blob now compiles at `scale 1.3077` (1.70 m, 2026-10-11), and this file's `height` is 1.70, so the fractions still land on the same joints.
```

- [ ] **Step 3: Rebuild the kit**

Run: `scripts/build-wam-kit.sh goblin`
Expected: `wrote .../public/assets/lab/goblin-kit.gltf` and the skeleton reminder. (WAM lives in `~/Projects/2026/wam`; set `WAM_DIR` if it is elsewhere. If WAM is missing, stop and tell the owner: the kit is a committed binary-ish asset and cannot be hand-edited.)

- [ ] **Step 4: Run the kit test**

Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-kit.test.ts`
Expected: PASS for the containment and clearance pins that are ratios. Any pin in metres (a plate must stand at least N mm off the flesh, a vertex count within a radius) takes the same rule as Task 3: its authored value times `K`, where `K = parseBlob(blobSrc).scale ?? 1` declared once at the top. A plate that now **clips** the flesh (a negative clearance on a ratio pin) means a part of the kit is an absolute metre size and did not follow the height: find it with `grep -nE "[0-9]\s*(m|mm|cm)\b" goblin-kit.wam` and `attach` sizes, express it as a height fraction, rebuild, and note it in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin-kit.wam public/assets/lab/goblin-kit.gltf src/lab/sdf-zombie/characters/goblin-kit.test.ts
git commit -m "feat(goblin): the armour kit rebuilt at height 1.70"
```

---

### Task 5: the gait, the grip and the speeds

**Files:**
- Modify: `src/lab/sdf-zombie/gait.ts` (`GOBLIN_WALK` strideFreq, `GOBLIN_RUN` strideFreq, their doc comments)
- Modify: `src/lab/sdf-zombie/motion-profile.ts` (`GOBLIN_PROFILE`: `runBand`, `cruise`, `prop.gripReach`, comments)
- Modify: `src/lab/sdf-zombie/goblin-gait.test.ts`, `src/lab/sdf-zombie/goblin-held-gun.test.ts`

- [ ] **Step 1: Run both to see what the scale did**

Run: `npx vitest run src/lab/sdf-zombie/goblin-gait.test.ts src/lab/sdf-zombie/goblin-held-gun.test.ts`
Expected: some FAIL (the tests pin the relationships between `cruise`, `runBand`, the curves and the leg length, and the grip against the hand bone). Read each failure: it names what is now out of step. The constants below are the cure; do not edit a test first.

- [ ] **Step 2: Retime the cadence and the speeds**

`gait.ts`: `GOBLIN_WALK.strideFreq` `1.5` to `1.31` and `GOBLIN_RUN.strideFreq` `2.1` to `1.84`. In their comments, replace the speed arithmetic with the new numbers (leg length 0.7323 m; walk 0.888 x 0.7323 x 1.31 / 0.625 = 1.36 m/s; run 0.663 x 0.7323 x 1.84 / 0.281 = 3.18 m/s) and add one sentence: "2026-10-11: the goblin grew 1.3077x; cadence is x0.874 (a pendulum's period goes with the root of its length), eyeballed, tune in the turntable."

`motion-profile.ts`: `runBand: { from: 1.30, to: 2.77 }` to `{ from: 1.48, to: 3.18 }`; `cruise: 1.19` to `1.36`; `gripReach: 0.0396` to `0.0518`; in the doc comment update the three metre figures (hand bone 0.072 m to 0.0942 m, orb `r=0.046` to 0.0602 m, 55% along: 0.0518 m) and the "(0.235 + 0.235 m on a 1.3 m body)" remark to "(0.307 + 0.307 m on a 1.7 m body)".

- [ ] **Step 3: Re-run; fix only tests that pin a length**

Run: `npx vitest run src/lab/sdf-zombie/goblin-gait.test.ts src/lab/sdf-zombie/goblin-held-gun.test.ts src/lab/sdf-zombie/gait.test.ts`
Expected: PASS. If a relationship test still fails, the constants above are not in step with the curves: recompute from the formula in the failing test's own docstring; if a test pins a length (a grip, a foot clearance), apply the Task 3 rule (`authored x K`, with `K` from the blob's scale).

- [ ] **Step 4: Commit**

```bash
git add src/lab/sdf-zombie/gait.ts src/lab/sdf-zombie/motion-profile.ts src/lab/sdf-zombie/goblin-gait.test.ts src/lab/sdf-zombie/goblin-held-gun.test.ts
git commit -m "feat(goblin): cadence, speeds and grip for the 1.70 m goblin"
```

---

### Task 6: look, notes, docs, PR

**Files:**
- Create: `docs/dev-notes/2026-10-11-goblin-human-height/NOTES.md` and `before-after.jpg`
- Modify: `TASKS.md`, `docs/tasks/characters.md` (lines 97-100), the spec's status line

- [ ] **Step 1: The "after" frames and a before-and-after sheet**

```bash
LAB_TMP=.lab-tmp npm run blob:shot -- goblin .lab-tmp/goblin-height/after 8
npm run blob:measure -- goblin 2>&1 | tee .lab-tmp/goblin-height/after-measure.txt | head -40
```

Lay the front, side and back of `before` and `after` out side by side at the **same world scale** (the after is 1.31x taller), with a 1.75 m line for the player's capsule and a zombie (1.8 m, `npm run blob:shot -- zombie`) beside it: any image tool will do (ImageMagick `montage` if present; otherwise a small `sharp` or Pillow script kept in `.lab-tmp`). Save the sheet as `docs/dev-notes/2026-10-11-goblin-human-height/before-after.jpg` (JPEG, under 1 MB). Look at it. Note anything that reads wrong (armour gaps, a head that is now too big or small against the body, hands): these are the owner's calls, not fixes to make here.

- [ ] **Step 2: Gait and poses in motion**

Boot the lab with the goblin (`?character=goblin`, the held-shotgun profile) with the turntable's walk and run captures if `scripts/blob-turntable.mjs` supports them (see its header); otherwise open the lab in the Browser pane through `preview_start` and use the existing gait panel to step the walk and the run and the `type`, `sit`, `recoil` poses. Record in the notes: the walk and run speeds observed, whether the feet slide (a speed that does not match the stride), and the seated pose's hip against the thigh line. If the feet slide, retune `strideFreq` only (the speeds follow from it by the formula in the docstrings), note the final values, and update Task 5's constants and the spec table.

- [ ] **Step 3: The goblin in the Flat's scale**

Optional but cheap: in the lab, place the goblin beside a 1.75 m reference (the lab's player-height marker if there is one) and the zombie, to confirm "human-sized" by eye. Put it in the sheet if useful.

- [ ] **Step 4: Write the notes**

`docs/dev-notes/2026-10-11-goblin-human-height/NOTES.md`: what changed (the `scale` directive, the goblin at 1.70 m, the kit, the cadence), how to resize any character (`scale k` in its `model` block), the before and after sheet, the final gait values, every test pin that moved and by what rule, and the owner's open looks (armour fit, gait feel, proportions). Keep it under two pages.

- [ ] **Step 5: Update the task wiki and the spec**

- `docs/tasks/characters.md` (the "Goblin to human height" item, lines 97-100): tick it `[x]` with the date, link the spec, plan and notes, and say "owner look pending (armour fit, gait)".
- `TASKS.md`: update the line that says "Separate task: the goblin to human height" to say it is built and awaiting the owner's look.
- The spec's status line: "built 2026-10-11, owner look pending".

- [ ] **Step 6: Final checks**

Run: `npm run typecheck && npm run test:changed`
Expected: PASS. Also run the goblin tests by path (Task 3 Step 5's list plus `goblin-kit`, `goblin-gait`, `goblin-held-gun`). Read CI after the push with `gh run list --branch claude/goblin-human-height`.

- [ ] **Step 7: Commit, push, open the PR**

```bash
git add docs TASKS.md
git commit -m "docs(goblin): human height, notes, before and after"
git push -u origin claude/goblin-human-height
gh pr create --title "Goblin at human height (1.70 m)" --body-file <(cat <<'EOF'
The goblin is now 1.70 m (a uniform 1.3077 scale-up of the approved 1.30 m goblin), the body, the armour kit, the cadence and the grip together. Owner-approved design: [spec](docs/superpowers/specs/2026-10-11-goblin-human-height-design.md).

- New `scale <k>` line in a `.blob`'s `model` block, applied once at the end of `compileBlob` by a typed, tested `scaleBodyDef` (adding a field to PrimDef, BoneDef or ShellParams fails the typecheck until it is classified a length or not).
- `goblin.blob`: `scale 1.3077`, `height 1.70`. Palette grain, mottle and the face sheet are texture-space and do not scale, so the body grain stays small.
- `goblin-kit.wam` at `height 1.70` and the kit rebuilt; the gait cadence x0.874 and the speeds and grip re-derived; the goblin's metre pins are the authored value times the scale, never loosened.
- The first-person arms are untouched.

Owner look pending: the armour fit, the gait in motion, and the proportions at the new size ([notes and before-and-after sheet](docs/dev-notes/2026-10-11-goblin-human-height/NOTES.md)).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)
```

Then follow the session's PR rules (`get_status`, `bind_pr` if needed; read CI; do not poll CI yourself).
