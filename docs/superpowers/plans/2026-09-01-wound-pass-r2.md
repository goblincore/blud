# Wound Pass Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deep wounds expose anatomically-placed bone that stops the carve, and wound interiors shade by depth beneath the original skin (skin → fat → muscle → clot) with torn-fibre texture.

**Architecture:** Bone is an ordinary primitive with a new op (`'bone'` → `primScale.w = 4`), living in the same cluster as the flesh around it, so placement, mirroring, rig binding, posing, severing and gibbing all work unchanged. It folds as a hard `min` after `applyWounds`, gated on `nearWound` — a gate that is an exact identity because bone is always strictly inside flesh. Two shading signals come for free: `mapBody`'s unused `.w` return slot carries `carved` (the pre-wound field = depth beneath original skin), and bone-ness rides `bestIdx`.

**Tech Stack:** TypeScript, WGSL (WebGPU), Vitest, Vite. WebGPU only — the GLSL twin is frozen.

**Spec:** `docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md`

**Base:** `main` at `eea6620` (Blobforge ring-fit merge). Every line number below
was re-verified against that commit after a rebase — the Blobforge merge moved
`pack.ts` and `march.wgsl.ts` by a few lines and added three characters.

---

## Dispatch configuration

Every task file in `~/.claude/dispatch/plans/` uses this frontmatter, with
`depends_on` forming a serial chain (task N depends on task N-1):

```yaml
---
title: "Wound Pass R2 - Task N: <name>"
status: pending
project: /Users/donny/Projects/blud
model: zai/glm-5.3-flash
api_key_env: ZAI_API_KEY
base_url: https://api.z.ai/api/coding/paas/v4
branch: dispatch/2026-09-01-wound-r2-task-N
priority: N
max_runtime: 30m
created: 2026-09-01
depends_on: ["2026-09-01-wound-r2-task-<N-1>"]
allowed_tools: Edit,Write,Bash,Read,Glob,Grep,WebFetch,WebSearch
harness: pi
---
```

Trigger task 1 manually; the rest auto-flow.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lab/sdf-zombie/types.ts` | `PrimDef.op` gains `'bone'` | 1 |
| `src/lab/sdf-zombie/pack.ts` | `W_BONE = 4`, op → `primScale.w` | 1 |
| `src/lab/sdf-zombie/validate.ts` | CPU mirror skips bone; containment check | 1, 2 |
| `src/lab/sdf-zombie/bone-derive.ts` | **new** — auto-derive bone prims from body prims | 3 |
| `src/lab/sdf-zombie/blob-ast.ts` | `BlobDoc.bones` | 4 |
| `src/lab/sdf-zombie/blob-parse.ts` | `bones` block grammar | 4 |
| `src/lab/sdf-zombie/blob-compile.ts` | wire derive + authored override | 4 |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | bone fold, `carved` return, tissue ramp, fibre | 5, 6, 7 |
| `src/lab/sdf-zombie/material.ts` | `boneColor`, `fatColor`, ramp knees, amps | 6 |
| `src/lab/sdf-zombie/webgpu/wound-panel.ts` | **new** — tuning panel with one key table | 8 |
| `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts` | three wound legs | 9 |
| `src/lab/sdf-zombie/characters/{zombie,goblin}.blob` | authored skull + ribcage | 10 |

---

## Task 1: `W_BONE` through the CPU layer

The type, the pack encoding, and the CPU field mirror. No shader, no parser —
this task is entirely unit-testable and everything after it depends on the
encoding being right.

**Files:**
- Modify: `src/lab/sdf-zombie/types.ts` (the `op?:` field, ~line 105)
- Modify: `src/lab/sdf-zombie/pack.ts:9-15` (the `W_*` constants), `pack.ts:143`
- Modify: `src/lab/sdf-zombie/validate.ts:404`, `:439`, `:481`, `:608`, `:659`
- Test: `src/lab/sdf-zombie/pack.test.ts`, `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing pack test**

Append to `src/lab/sdf-zombie/pack.test.ts`:

```ts
describe('bone prims (wound pass r2)', () => {
  it('encodes op bone as primScale.w = 4', () => {
    const bone: Primitive = {
      a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
      scale: [1, 1, 1], blendK: 0, limb: 'legL', cluster: 0, op: 'bone',
    };
    const flesh: Primitive = { ...bone, radius: 0.08, op: undefined };
    const packed = packBody({
      prims: [flesh, bone],
      clusters: [{ limb: 'legL', start: 0, count: 2, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_ADD);
    expect(packed.primScale[PRIM_STRIDE + 3]).toBe(W_BONE);
  });

  it('dead outranks bone, exactly as it outranks carve', () => {
    const bone: Primitive = {
      a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
      scale: [1, 1, 1], blendK: 0, limb: 'legL', cluster: 0,
      op: 'bone', dead: true,
    };
    const packed = packBody({
      prims: [bone],
      clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_DEAD);
  });
});
```

Add `W_BONE` to the existing `pack` import at the top of the file, alongside
`W_ADD` / `W_DEAD` / `PRIM_STRIDE`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/pack.test.ts -t "bone prims"`
Expected: FAIL — `W_BONE` is not exported.

- [ ] **Step 3: Add the constant and the encoding**

In `src/lab/sdf-zombie/pack.ts`, after the `W_GROOVE` declaration (line 15):

```ts
/** Bone: a second material inside the flesh. Skipped by the additive fold and
 *  by the carve pass; folded as a hard `min` AFTER applyWounds, so it is only
 *  ever visible where a carve has eaten down to it. See
 *  docs/superpowers/specs/2026-09-01-wound-pass-r2-design.md §1. */
export const W_BONE = 4;
```

Then at `pack.ts:140`, extend the role ladder. `dead` stays at the top for the
reason the existing comment gives:

```ts
const w = p.dead ? W_DEAD
  : p.op === 'groove' ? W_GROOVE
  : p.op === 'bone' ? W_BONE
  : isCarve ? W_CARVE : W_ADD;
```

In `src/lab/sdf-zombie/types.ts`, widen the `op` union (~line 105):

```ts
  op?: 'add' | 'sub' | 'groove' | 'bone';
```

and extend that field's doc comment with a sentence:

```
   * 'bone' is a second material strictly INSIDE the flesh: skipped by both the
   * additive fold and the carve pass, folded as a hard min after wounds are
   * carved, so it appears only where a wound has reached it.
```

- [ ] **Step 4: Run the pack test — it should pass**

Run: `npx vitest run src/lab/sdf-zombie/pack.test.ts -t "bone prims"`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing CPU-mirror test**

Append to `src/lab/sdf-zombie/validate.test.ts`:

```ts
describe('bone prims are invisible to the CPU field (wound pass r2)', () => {
  // sdBody backs click-to-shoot. It mirrors mapBody + applyCarves and does NOT
  // apply wounds, and bone is always strictly inside flesh — so adding bone
  // prims must not move the CPU field by even a float. If it does, shots land
  // where nothing is drawn.
  const flesh: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.09,
    scale: [1, 1, 1], blendK: 0.01, limb: 'legL', cluster: 0,
  };
  const bone: Primitive = { ...flesh, radius: 0.03, op: 'bone' };

  const withoutBone = {
    prims: [flesh],
    clusters: [{ limb: 'legL', start: 0, count: 1, alive: true }],
  } as unknown as Body;
  const withBone = {
    prims: [flesh, bone],
    clusters: [{ limb: 'legL', start: 0, count: 2, alive: true }],
  } as unknown as Body;

  const probes: Vec3[] = [
    [0, 0.2, 0], [0.05, 0.2, 0], [0.12, 0.2, 0], [0, 0.5, 0],
    [0.3, 0.2, 0], [0, 0.2, 0.08], [-0.06, 0.1, 0.02],
  ];

  it('sdBody is bit-identical with and without bone prims', () => {
    for (const p of probes) {
      expect(sdBody(p, withBone)).toBe(sdBody(p, withoutBone));
    }
  });

  it('never reports a bone prim as the nearest additive primitive', () => {
    for (const p of probes) {
      expect(nearestAdditive(p, withBone)).not.toBe(1);
    }
  });
});
```

Import `nearestAdditive` and `Vec3` alongside the existing imports if they
aren't already there.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t "invisible to the CPU field"`
Expected: FAIL — bone currently folds as additive, so `sdBody` differs and
`nearestAdditive` can return index 1.

- [ ] **Step 7: Skip bone in every CPU loop**

In `src/lab/sdf-zombie/validate.ts`, five loops filter on op. Bone must be
skipped in all of them. At lines 404, 439, 481, 608 and 659, extend the
existing guard. For example line 404 becomes:

```ts
      if (prim.op === 'sub' || prim.op === 'groove' || prim.op === 'bone' || prim.dead) continue;
```

and line 481 (and the identically-shaped guards at 608 and 659) become:

```ts
      if (prim.op === 'sub' || prim.op === 'bone' || prim.dead) continue;
```

The carve pass at 414-418 needs no change — it dispatches on `'sub'` and
`'groove'` explicitly, so `'bone'` already falls through both branches. Add a
comment there recording that this is deliberate rather than an oversight:

```ts
      // 'bone' matches neither branch on purpose: it is not a carve, and the
      // CPU field never shows it (see the bit-identical test in validate.test.ts).
```

- [ ] **Step 8: Run the CPU-mirror test — it should pass**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t "invisible to the CPU field"`
Expected: PASS (2 tests)

- [ ] **Step 9: Run the whole suite for regressions**

Run: `npm test`
Expected: PASS, no failures. If a snapshot of prim counts or `primScale`
changes, that is a real regression — bone prims do not exist yet in any
character, so nothing should move.

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/types.ts src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/pack.test.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "bone: W_BONE=4 through the type, pack and CPU-mirror layer

Bone is an ordinary prim with op 'bone'. The CPU field must not see it at
all: sdBody backs click-to-shoot, and bone is always strictly inside
flesh, so a body with bone prims must produce a bit-identical field.
Tested rather than assumed."
```

---

## Task 2: Bone containment validator

The `nearWound` gate in the shader is only an *identity* if bone never
protrudes through flesh. If an authored bone pokes out, the identity breaks
only OUTSIDE the gate, and the fragment pops in and out as the gate flips —
the same discontinuity class as the black crack seams. This validator is what
keeps the gate honest, so it lands before any shader work.

**Files:**
- Modify: `src/lab/sdf-zombie/validate.ts` (add `checkBoneContainment`, call it from the existing validator)
- Test: `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/validate.test.ts`:

```ts
describe('bone containment (wound pass r2)', () => {
  const flesh: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.09,
    scale: [1, 1, 1], blendK: 0.01, limb: 'legL', cluster: 0,
  };
  const mk = (boneRadius: number) => ({
    prims: [flesh, { ...flesh, radius: boneRadius, op: 'bone' as const }],
    clusters: [{ limb: 'legL', start: 0, count: 2, alive: true }],
  } as unknown as Body);

  it('accepts a bone comfortably inside its flesh', () => {
    expect(checkBoneContainment(mk(0.03))).toEqual([]);
  });

  it('rejects a bone fatter than the flesh around it', () => {
    const errs = checkBoneContainment(mk(0.12));
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/bone/i);
    expect(errs[0]).toMatch(/prim 1/);
  });

  it('rejects a bone that only breaches on one side', () => {
    // Same radius as a passing bone, but shoved sideways until it breaks the
    // skin. Radius alone is not the test — position matters.
    const offset = { ...flesh, radius: 0.03, op: 'bone' as const,
      a: [0.075, 0, 0] as Vec3, b: [0.075, 0.4, 0] as Vec3 };
    const body = {
      prims: [flesh, offset],
      clusters: [{ limb: 'legL', start: 0, count: 2, alive: true }],
    } as unknown as Body;
    expect(checkBoneContainment(body).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t "bone containment"`
Expected: FAIL — `checkBoneContainment` is not defined.

- [ ] **Step 3: Implement the validator**

Add to `src/lab/sdf-zombie/validate.ts`:

```ts
/** How far inside the flesh a bone surface must sit, in metres. Generous
 *  enough that a rig pose or a jiggle cannot push a compliant bone through
 *  the skin, tight enough that a real femur still fits inside a thigh. */
export const BONE_CONTAINMENT_MARGIN = 0.004;

/**
 * Every bone primitive must sit strictly inside the flesh field.
 *
 * The shader gates its bone fold on `nearWound`, which is only sound because
 * `min(flesh, bone) === flesh` wherever the flesh is intact. A protruding bone
 * breaks that identity ONLY outside the gate, so the fragment would appear and
 * disappear as the gate flips — the discontinuity class that produced the black
 * crack seams inside wound cavities. Catching it at build time is much cheaper
 * than recognising it on screen.
 *
 * Samples each bone prim's own surface rather than its bounding box: a capsule
 * shoved sideways can keep its radius and still breach, so radius alone is not
 * the test.
 */
export function checkBoneContainment(body: Body): string[] {
  const errs: string[] = [];
  // A fixed low-discrepancy-ish sphere sampling. 26 directions — the 6 axes,
  // 12 edge midpoints and 8 corners of a cube, normalised — is enough to catch
  // a breach without making validation quadratic in prim count.
  const dirs: Vec3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x === 0 && y === 0 && z === 0) continue;
    const l = Math.hypot(x, y, z);
    dirs.push([x / l, y / l, z / l]);
  }

  body.prims.forEach((prim, i) => {
    if (prim.op !== 'bone' || prim.dead) return;
    // Both endpoints, because a capsule can breach at either cap.
    for (const end of [prim.a, prim.b]) {
      for (const d of dirs) {
        const p: Vec3 = [
          end[0] + d[0] * prim.radius,
          end[1] + d[1] * prim.radius,
          end[2] + d[2] * prim.radius,
        ];
        // sdBody skips bone prims entirely (Task 1), so this is the FLESH
        // field — exactly the surface the bone must stay inside.
        if (sdBody(p, body) > -BONE_CONTAINMENT_MARGIN) {
          errs.push(
            `bone prim ${i} (${prim.limb}) breaches the flesh surface at ` +
            `[${p.map(v => v.toFixed(3)).join(', ')}] — bone must sit at least ` +
            `${BONE_CONTAINMENT_MARGIN}m inside the flesh, or the shader's ` +
            `nearWound gate stops being an identity and the bone pops`);
          return;
        }
      }
    }
  });
  return errs;
}
```

- [ ] **Step 4: Run the test — it should pass**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t "bone containment"`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire it into the main validator**

Find the function in `validate.ts` that accumulates errors including the
`primitive count ... exceeds shader ceiling` message at line 450. Add, next to
those ceiling checks:

```ts
  errs.push(...checkBoneContainment(body));
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. No character has bone prims yet, so the new check is a no-op
on every existing body.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "bone: containment validator — the nearWound gate depends on it

min(flesh, bone) === flesh is what makes gating the bone fold on nearWound
exact rather than approximate. A protruding bone breaks that identity only
OUTSIDE the gate, so the fragment would pop as the gate flips. Caught at
build time instead."
```

---

## Task 3: Auto-derive bone prims

A pure function: body prims in, bone prims out. No parser, no shader, no I/O —
so it is fully unit-testable, which is why it comes before the grammar.

**Files:**
- Create: `src/lab/sdf-zombie/bone-derive.ts`
- Test: `src/lab/sdf-zombie/bone-derive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/bone-derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveBones, DEFAULT_BONE_RATIO } from './bone-derive';
import type { PrimDef } from './types';

const thigh: PrimDef = {
  kind: 'bar', bone: 'thigh', at: 0.05, to: 0.95, radius: 0.082,
  scale: [1, 1, 1], blendK: 0.0175, limb: 'leg', mirror: true,
} as unknown as PrimDef;

const nose: PrimDef = {
  kind: 'blob', bone: 'skull', at: 0.5, radius: 0.012,
  scale: [1, 1, 1], blendK: 0.005, limb: 'head',
} as unknown as PrimDef;

const cranium: PrimDef = {
  kind: 'blob', bone: 'skull', at: 0.55, radius: 0.118,
  scale: [1, 1, 1], blendK: 0.01, limb: 'head',
} as unknown as PrimDef;

describe('deriveBones', () => {
  it('emits one bone twin per eligible prim, at ratio x radius', () => {
    const out = deriveBones([thigh], DEFAULT_BONE_RATIO);
    expect(out).toHaveLength(1);
    expect(out[0]!.op).toBe('bone');
    expect(out[0]!.radius).toBeCloseTo(0.082 * DEFAULT_BONE_RATIO, 6);
  });

  it('keeps the source placement so the bone rides the same rig point', () => {
    const [b] = deriveBones([thigh], DEFAULT_BONE_RATIO);
    expect(b!.bone).toBe('thigh');
    expect(b!.at).toBe(0.05);
    expect(b!.to).toBe(0.95);
    expect(b!.limb).toBe('leg');
    expect(b!.mirror).toBe(true);
  });

  it('drops the source shaping — a bone is not a squashed blob', () => {
    const wide = { ...thigh, scale: [1.3, 1, 0.7] as const } as unknown as PrimDef;
    const [b] = deriveBones([wide], DEFAULT_BONE_RATIO);
    expect(b!.scale).toEqual([1, 1, 1]);
  });

  it('skips detail prims below half the fattest radius on the same bone', () => {
    // The nose is 0.012 against the cranium's 0.118 on the same skull bone,
    // so it is detail, not mass. A nose must not grow a bone of its own.
    const out = deriveBones([cranium, nose], DEFAULT_BONE_RATIO);
    expect(out).toHaveLength(1);
    expect(out[0]!.radius).toBeCloseTo(0.118 * DEFAULT_BONE_RATIO, 6);
  });

  it('skips carves, grooves and existing bone prims', () => {
    const carve = { ...thigh, op: 'sub' as const };
    const groove = { ...thigh, op: 'groove' as const };
    const bone = { ...thigh, op: 'bone' as const };
    expect(deriveBones([carve, groove, bone], DEFAULT_BONE_RATIO)).toEqual([]);
  });

  it('emits nothing at ratio 0, so a character can opt out', () => {
    expect(deriveBones([thigh], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/bone-derive.test.ts`
Expected: FAIL — cannot resolve `./bone-derive`.

- [ ] **Step 3: Implement it**

Create `src/lab/sdf-zombie/bone-derive.ts`:

```ts
// src/lab/sdf-zombie/bone-derive.ts
import type { PrimDef } from './types';

/**
 * Bone radius as a fraction of the flesh prim it sits inside.
 *
 * Deliberately conservative. Too fat and every pellet scratch reaches bone,
 * which stops it meaning anything; the spec records that as an explicit
 * on-screen judgement call rather than a number this file can settle.
 */
export const DEFAULT_BONE_RATIO = 0.38;

/**
 * A prim is STRUCTURAL MASS (and so grows a bone) when its radius is at least
 * this fraction of the fattest additive prim on the same bone. Relative rather
 * than absolute so it means the same thing on a mouse and on an ogre.
 */
const MASS_FRACTION = 0.5;

/**
 * Auto-derives bone primitives from a body's flesh primitives.
 *
 * A femur genuinely IS a thinner capsule inside the thigh capsule on the same
 * bone, so this is the correct answer for limbs rather than a fallback. The
 * torso and skull are the two places players actually shoot and both want an
 * authored shape instead — the `bones` block overrides per cluster (Task 4).
 *
 * Shaping is dropped on purpose: `wide`/`tall`/`deep` describe a fleshy mass,
 * and inheriting them would give a ribcage-shaped femur.
 */
export function deriveBones(prims: PrimDef[], ratio: number): PrimDef[] {
  if (ratio <= 0) return [];

  // Fattest additive prim per bone — the mass yardstick everything on that
  // bone is measured against.
  const fattest = new Map<string, number>();
  for (const p of prims) {
    if (p.op === 'sub' || p.op === 'groove' || p.op === 'bone') continue;
    if (!p.bone) continue;
    fattest.set(p.bone, Math.max(fattest.get(p.bone) ?? 0, p.radius));
  }

  const out: PrimDef[] = [];
  for (const p of prims) {
    if (p.op === 'sub' || p.op === 'groove' || p.op === 'bone') continue;
    if (!p.bone) continue;
    // Shell prims are cloth, not mass — a coat does not have a bone in it.
    if (p.shell) continue;
    const mass = fattest.get(p.bone) ?? 0;
    if (p.radius < mass * MASS_FRACTION) continue;

    out.push({
      ...p,
      op: 'bone',
      radius: p.radius * ratio,
      // A tapered flesh prim keeps its taper, scaled — a femur narrows where
      // the thigh does. Absent stays absent.
      radiusB: p.radiusB === undefined ? undefined : p.radiusB * ratio,
      scale: [1, 1, 1],
      // Hard-edged: bone meeting bone should crease, not smear.
      blendK: 0,
      // Colour and gloss belong to the flesh prim that carried them (a shoe, a
      // lens). Bone has its own material and must not inherit them.
      color: undefined,
      gloss: undefined,
      // Never the cluster's structural core — that is the flesh's job, and a
      // bone winning the fuse probe would change severing behaviour.
      core: false,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — it should pass**

Run: `npx vitest run src/lab/sdf-zombie/bone-derive.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/bone-derive.ts src/lab/sdf-zombie/bone-derive.test.ts
git commit -m "bone: auto-derive bone prims from flesh mass

A femur is a thinner capsule inside the thigh capsule on the same bone, so
deriving limbs is correct rather than a fallback. Detail prims are filtered
by radius RELATIVE to the fattest prim on their own bone, so the rule holds
for a mouse and an ogre alike and a nose never grows a bone."
```

---

## Task 4a / 4b: bone storage, then the `bones` grammar

> **Task 4 was split and redesigned on 2026-09-01 after it timed out.** The
> original put bone in `body.prims` with `op: 'bone'` and claimed severing and
> every other consumer needed no changes. That was wrong: ~20 modules walk
> `body.prims` and filter on `op`, and three broke — `occluder-hull` inflated
> the shadow hull, the chunk path rendered bone as visible flesh, and
> `severDistal`'s POSITIONAL slice dragged a limb's bones into a distal chunk.
> Cluster membership was never enough; position in the run mattered.
>
> Bone now lives in its own `body.bones` array and never enters `body.prims`,
> so the ~16 consumers that must exclude it are correct by construction. The
> four that need it — rig-bind, pack, sever, validate — integrate it explicitly.
> See the spec's revised storage section.
>
> Live task files:
> `~/.claude/dispatch/plans/2026-09-01-wound-r2-task-4a.md` (storage + the
> containment-validator scale fix) and `-4b.md` (the grammar). Task 5 now
> depends on 4b, and its `applyBones` scans the contiguous range
> `[counts.x, counts.x + woundCfg2.w)` rather than filtering prims by material.

## Task 5: The bone fold in the shader

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (`APPLY_CARVES`, `MAP_BODY`, new `APPLY_BONES`, the module comment at line 62)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Fix the latent groove misclassification FIRST**

This is a live bug the moment `W_BONE = 4` exists. In `APPLY_CARVES`
(`march.wgsl.ts`, ~line 534) the groove test is unbounded:

```wgsl
      let isGroove = S.w > 2.5;
```

`W_BONE` is 4, so every bone prim would be treated as a groove and cut a
channel across the body. Change it to a bounded test:

```wgsl
      // BOUNDED on both sides: W_BONE (4) is greater than the groove code (3),
      // so an open-ended `> 2.5` would carve every bone prim into the flesh as
      // a groove. Bone is folded separately, after wounds — see applyBones.
      let isGroove = S.w > 2.5 && S.w < 3.5;
```

`foldGroup`'s additive filter (`if (S.w > 0.5) { continue; }`, ~line 824)
already excludes bone correctly and needs no change.

- [ ] **Step 2: Write the failing shader-source tests**

Append to `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`:

```ts
describe('bone fold (wound pass r2)', () => {
  it('bounds the groove test so W_BONE is not read as a groove', () => {
    expect(APPLY_CARVES).toContain('S.w > 2.5 && S.w < 3.5');
  });

  it('folds bone as a hard min, never a smooth min', () => {
    expect(APPLY_BONES).toContain('min(');
    expect(APPLY_BONES).not.toContain('smin(');
  });

  it('gates the bone loop on nearWound so undamaged bodies pay nothing', () => {
    expect(MAP_BODY).toMatch(/nearWound\s*>\s*0\.5/);
  });

  it('returns the pre-wound field in .w for the tissue-depth ramp', () => {
    // Both return sites — the noiseAmp early-out and the full path — must
    // carry `carved`, or the ramp reads 0 on whichever path is taken.
    const returns = MAP_BODY.match(/return vec4<f32>\([^)]*\)/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
    for (const r of returns) expect(r).toContain('carved');
  });

  it('lets a bone prim win bestIdx so shading can identify it', () => {
    expect(APPLY_BONES).toContain('gFoldBestIdx');
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "bone fold"`
Expected: FAIL — `APPLY_BONES` is not exported.

- [ ] **Step 4: Write `APPLY_BONES`**

Add to `march.wgsl.ts`, immediately after `APPLY_WOUNDS`:

```ts
// Folds bone into the field, AFTER wounds have been carved.
//
// A hard `min`, never `smin`: meat meeting bone should crease, because they
// are different materials. A smooth-min here produces a fillet of half-bone
// half-meat that reads as neither.
//
// Bone prims are authored strictly inside the flesh (enforced by
// checkBoneContainment in validate.ts), so `min(flesh, bone) === flesh`
// wherever the flesh is intact. That is what lets MAP_BODY gate this whole
// call on nearWound and have the gate be an EXACT IDENTITY rather than a
// tolerance — undamaged bodies skip it and are bit-identical either way. If
// the containment validator is ever weakened, this gate stops being sound and
// bone fragments will pop in and out as the gate flips.
//
// Winning the min also claims gFoldBestIdx, which is how shading knows this
// pixel is bone: it reads the dominant prim's primScale.w and compares to 4.
// foldGroup skips bone entirely, so nothing else can have claimed it.
export const APPLY_BONES = /* wgsl */ `fn applyBones(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32) -> f32 {
  var d = dIn;
  let primCount = i32(counts.x);
  for (var i = 0; i < ${'${MAX_PRIMS}'}; i = i + 1) {
    if (i >= primCount) { break; }
    let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE} + band), 0);
    if (S.w < 3.5 || S.w > 4.5) { continue; }
    let sd = sdPrim(p, i, data, -1.0, 0.0, vec3<f32>(0.0, 0.0, 0.0), band);
    if (sd < d) { d = sd; gFoldBestIdx = f32(i); }
  }
  return d;
}`;
```

Note the `${MAX_PRIMS}` interpolation must be a real template interpolation in
the source file (the escaping shown above is only to display it here) — write
it exactly as the neighbouring constants in this file interpolate `ROW_*`.

- [ ] **Step 5: Call it from `MAP_BODY` and return `carved`**

In `MAP_BODY` (`march.wgsl.ts:954-980`), replace the tail of the function.
The current code is:

```wgsl
  let carved = applyCarves(d, p, data, counts);
  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2);
  let dmg = dmgRes.x;
  let nearWound = dmgRes.y;
```

Add the gated bone fold immediately after, and thread `carved` into both
return statements:

```wgsl
  let carved = applyCarves(d, p, data, counts);
  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2);
  var dmg = dmgRes.x;
  let nearWound = dmgRes.y;
  // Bone, gated on nearWound (see APPLY_BONES). Outside a wound this call is
  // provably a no-op, so skipping it is exact, not an approximation.
  if (nearWound > 0.5) { dmg = applyBones(dmg, p, data, counts, 0); }
```

Then both `return vec4<f32>(...)` statements carry `carved` in `.w`:

```wgsl
  if (noiseAmp <= 0.0) { return vec4<f32>(dmg, f32(bestIdx), nearWound, carved); }
```

and

```wgsl
  return vec4<f32>(dmg + fbm(anchor * 3.0) * noiseAmp, f32(bestIdx), nearWound, carved);
```

Also update `bestIdx`'s definition so a bone win survives: `let bestIdx =
i32(gFoldBestIdx);` currently reads the global BEFORE `applyBones` runs. Move
that line to AFTER the bone fold so a bone that won the min is reported.

Finally, fix the stale ceiling comment at `march.wgsl.ts:62`:

```
// they fit in two more rows and the whole per-body payload stays one upload.
```

change `MAX_WOUNDS (16) is comfortably under MAX_PRIMS (48)` to
`MAX_PRIMS (128)`.

- [ ] **Step 6: Run the shader tests — they should pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "bone fold"`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Verify in the browser that nothing regressed**

Start the lab and confirm an undamaged zombie renders exactly as before — this
is the empirical half of the gate-identity argument.

```bash
npm run blob:shot -- zombie /tmp/wound-r2/undamaged
```

Then the wounded case, using the existing repro loop:

```bash
BLOB_PROBE='(window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2/wounded
```

Open both PNGs and confirm: the undamaged body is unchanged, and the wounded
body now shows pale bone at the floor of the deepest craters. Report both
images in the task report.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "bone: fold bone into the field after wounds, gated on nearWound

Hard min, not smin — meat meeting bone should crease. The gate is an exact
identity because bone is contained inside flesh, so undamaged bodies are
bit-identical and pay nothing.

Also fixes a latent bug that W_BONE=4 would have triggered: applyCarves
tested isGroove as an unbounded S.w > 2.5, which would have carved every
bone prim into the body as a groove."
```

---

## Task 6: Tissue-depth ramp

**Files:**
- Modify: `src/lab/sdf-zombie/material.ts` (new material fields)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (the shading block at ~1673)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (upload the new uniforms)
- Test: `src/lab/sdf-zombie/material.test.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Add the material fields with a failing test**

Append to `src/lab/sdf-zombie/material.test.ts`:

```ts
describe('wound tissue material (wound pass r2)', () => {
  it('every preset carries bone and fat colours and ramp knees', () => {
    for (const [name, preset] of Object.entries(FLESH_PRESETS)) {
      expect(preset.boneColor, name).toHaveLength(3);
      expect(preset.fatColor, name).toHaveLength(3);
      expect(preset.fatDepth, name).toBeGreaterThan(0);
      expect(preset.muscleDepth, name).toBeGreaterThan(preset.fatDepth);
    }
  });

  it('ships the depth ramp on and the fibre on', () => {
    expect(FLESH_PRESETS.zombie!.woundDepthAmp).toBe(1);
    expect(FLESH_PRESETS.zombie!.woundFibreAmp).toBeGreaterThan(0);
  });
});
```

Use whatever the preset map's real export name and key set are — read
`material.ts:55-90` and match it rather than assuming `zombie` exists.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/material.test.ts -t "wound tissue material"`
Expected: FAIL — `boneColor` is undefined.

- [ ] **Step 3: Add the fields**

In `src/lab/sdf-zombie/material.ts`, add to the `FleshMaterial` interface:

```ts
  /** Bone albedo, linear RGB. Blood-stained toward `deepColor` at its junction
   *  with flesh in the shader, so it never reads as a clean white decal.
   *
   *  The default is the project's OWN established bone colour, not a fresh
   *  guess: `bonewalker.blob` paints its proud spine and rib bars `color=dbc0a0`
   *  (sRGB 219,192,160 -> linear 0.71, 0.53, 0.35), chosen against a reference
   *  mesh whose bone texels measure sRGB 175,140,119. A brighter bone-white
   *  reads as plastic next to that and would make the two kinds of bone in this
   *  game disagree. */
  boneColor: Vec3;
  /** Subcutaneous fat, linear RGB. The load-bearing ramp stop: it is what makes
   *  a crater read as OPENED rather than merely stained. */
  fatColor: Vec3;
  /** Depth beneath the original skin at which dermis becomes fat, metres. */
  fatDepth: number;
  /** Depth at which fat becomes muscle, metres. */
  muscleDepth: number;
  /** 0 disables the tissue ramp and shades bit-for-bit as before it existed. */
  woundDepthAmp: number;
  /** 0 disables the torn-fibre mottle inside wounds. */
  woundFibreAmp: number;
```

Add values to every preset. For the human-ish presets:

```ts
    boneColor: [0.71, 0.53, 0.35], fatColor: [0.83, 0.72, 0.42],
    fatDepth: 0.004, muscleDepth: 0.014,
    woundDepthAmp: 1, woundFibreAmp: 0.6,
```

Scale `fatDepth`/`muscleDepth` by the character's stature for non-human
presets — a mouse gets roughly a third of these, a large creature more.

- [ ] **Step 4: Run the material test — it should pass**

Run: `npx vitest run src/lab/sdf-zombie/material.test.ts -t "wound tissue material"`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing shader test**

Append to `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`:

```ts
describe('tissue ramp (wound pass r2)', () => {
  it('composes INSIDE the radial mask so it cannot edge on healthy skin', () => {
    // The whole halo-safety argument: at wm = 0 the ramp must be unable to
    // change the albedo. That means exactly one mix against wm, with the ramp
    // supplying its second argument — never a separate mask of its own.
    expect(SHADE_BODY).toContain('mix(baseColor, tissue, wm)');
  });

  it('does not introduce a second wound mask', () => {
    const masks = SHADE_BODY.match(/woundMask\(/g) ?? [];
    expect(masks).toHaveLength(1);
  });

  it('is amplitude-guarded so 0 shades as before', () => {
    expect(SHADE_BODY).toMatch(/woundDepthAmp/);
  });
});
```

Use the real exported name of the fragment/shading source in this file in place
of `SHADE_BODY` — read the module's exports and match.

- [ ] **Step 6: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "tissue ramp"`
Expected: FAIL.

- [ ] **Step 7: Implement the ramp**

Add a ramp function next to `WOUND_MASK` in `march.wgsl.ts`:

```ts
// Tissue colour by depth beneath the ORIGINAL skin — the signal `carved`
// carries in mapBody's .w.
//
// Keyed to the crater WALL rather than to the impact point, which is the
// difference that makes an oblique hit and a pair of overlapping craters read
// correctly: the radial mask rings the entry wound, this follows the surface
// that was actually opened.
//
// The fat band is the load-bearing stop. It is the cue that says "opened"
// rather than "stained", and a single base->deep lerp has no way to express it.
export const TISSUE_RAMP = /* wgsl */ `fn tissueRamp(depth: f32, baseColor: vec3<f32>, fatColor: vec3<f32>, deepColor: vec3<f32>, fatDepth: f32, muscleDepth: f32) -> vec3<f32> {
  let dermis = mix(baseColor, deepColor, 0.5);
  let clot = deepColor * 0.45;
  let toFat = smoothstep(0.0, fatDepth, depth);
  let toMuscle = smoothstep(fatDepth, muscleDepth, depth);
  let toClot = smoothstep(muscleDepth, muscleDepth * 2.5, depth);
  var c = mix(dermis, fatColor, toFat);
  c = mix(c, deepColor, toMuscle);
  return mix(c, clot, toClot);
}`;
```

In the shading block at `march.wgsl.ts:1673`, replace:

```wgsl
  var albedo = mix(baseColor, deepColor, wm);
```

with:

```wgsl
  // Tissue depth rides mapBody's .w (the PRE-wound field). The ramp chooses
  // WHICH colour the wounded end of the lerp reaches for; `wm` remains the
  // sole authority on WHETHER this pixel is wounded. That composition is what
  // makes the ramp halo-safe by construction: at wm = 0 nothing it computes
  // can reach the albedo, so it has no edge to disagree with the mask's.
  //
  // Do NOT refactor this into a second mask. The 2026-08-23 crater pass split
  // one mask into three and cost two days to the resulting halo; the note above
  // WOUND_MASK is the record.
  let tissueDepth = max(0.0, -hitField.w) * surfCfg3.x;
  let tissue = select(deepColor,
    tissueRamp(tissueDepth, baseColor, fatColor, deepColor, surfCfg3.y, surfCfg3.z),
    surfCfg3.x > 0.0);
  var albedo = mix(baseColor, tissue, wm);
```

where `hitField` is the `vec4` the march kept from its accepting sample (the
`dres` value at `march.wgsl.ts:1509` — thread it through to the shading
function if it is not already in scope), and `surfCfg3` is a new uniform
`vec4(woundDepthAmp, fatDepth, muscleDepth, woundFibreAmp)`.

- [ ] **Step 8: Upload the new uniform**

In `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, find where `surfCfg2` is written
and add `surfCfg3` beside it, packing
`[woundDepthAmp, fatDepth, muscleDepth, woundFibreAmp]` from the material.
Follow the existing uniform exactly — same declaration site, same binding
struct, same update path.

- [ ] **Step 9: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Verify on screen**

```bash
BLOB_PROBE='(window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2/ramp
```

Confirm craters now show a pale band at the lip grading to dark red at the
floor, and that undamaged skin is unchanged. Then verify the off-state:

```bash
BLOB_PROBE='(window.__sdfGame.setWoundTuning({woundDepthAmp:0}),window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2/ramp-off
```

`ramp-off` must match a pre-Task-6 capture. Report all three images.

- [ ] **Step 11: Commit**

```bash
git add -A src/lab/sdf-zombie
git commit -m "wounds: tissue-depth ramp — skin, fat, muscle, clot

Colour keyed to depth beneath the ORIGINAL skin (mapBody's previously
unused .w), so it follows the crater wall instead of ringing the impact
point. Oblique and overlapping hits read correctly for the first time.

Composed INSIDE the existing radial mask rather than beside it: at wm = 0
the ramp cannot reach the albedo, so it is halo-safe by construction and
the owner-tuned 1.6x mask is untouched."
```

---

## Task 7: Torn-fibre texture, wet, and bone material

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (shading block, ~1673-1730 and the `wet` line at ~1921)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('wound fibre and bone material (wound pass r2)', () => {
  it('confines the fibre mottle to the wound interior', () => {
    // Multiplied by wm, NOT by switching goreStrength on — that would repaint
    // whole standing bodies as torn meat.
    expect(SHADE_BODY).toMatch(/woundFibre[\s\S]{0,200}\*\s*wm/);
  });

  it('stains bone toward deepColor where it meets flesh', () => {
    expect(SHADE_BODY).toContain('boneColor');
    expect(SHADE_BODY).toMatch(/boneStain|dmg - dBone|fleshGap/);
  });

  it('identifies bone by the dominant prim material, not a radius guess', () => {
    expect(SHADE_BODY).toMatch(/isBone/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "wound fibre and bone material"`
Expected: FAIL.

- [ ] **Step 3: Add the fibre**

After the `albedo = mix(baseColor, tissue, wm)` line from Task 6:

```wgsl
  // Torn fibre. The gore mottle already exists but is dead on standing bodies
  // (goreStrength is 0 there). Rather than switching that on globally — which
  // would repaint whole undamaged bodies as torn meat — it enters multiplied
  // by wm, so it exists only inside a wound, reusing the same rest-space
  // anchor so chunks and wounds agree about where the fibre is.
  if (surfCfg3.w > 0.0 && wm > 0.0) {
    let fibre = clamp(fbm(anchor * 6.0) * 0.5 + 0.5, 0.0, 1.0);
    albedo = mix(albedo, albedo * mix(0.7, 1.25, fibre), wm * surfCfg3.w);
  }
```

- [ ] **Step 4: Add the bone material**

Immediately after the fibre block:

```wgsl
  // Bone. The dominant prim carries the material code, so this is an identity
  // read rather than a guess from depth or radius: only applyBones can have
  // claimed bestIdx for a bone prim, because foldGroup skips them entirely.
  let hitMat = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SCALE}), 0).w;
  let isBone = hitMat > 3.5 && hitMat < 4.5;
  if (isBone) {
    // Stained toward the meat at the junction. A clean plate popping out of red
    // flesh reads as a decal; blood in the transition is what seats it.
    let stain = 1.0 - smoothstep(0.0, 0.012, tissueDepth - surfCfg3.z);
    albedo = mix(boneColor, deepColor * 0.8, clamp(stain, 0.0, 1.0) * 0.55);
  }
```

- [ ] **Step 5: Retune `wet` for the lip**

At `march.wgsl.ts:1921` the wet line is currently:

```wgsl
  let wet = mix(surfCfg2.x * mix(1.0, 1.6, max(wm, gore)) * (1.0 - cm), 1.0, gloss);
```

Peak wetness at the fat/muscle boundary and dry off into the deep, and make
bone matte:

```wgsl
  // Wetness peaks at the fat/muscle boundary — the lip glistens, the floor
  // does not — instead of wetting the whole crater uniformly. Bone is matte.
  let lip = 1.0 - smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
  let wetWound = max(wm * lip, gore);
  let wet = mix(surfCfg2.x * mix(1.0, 1.6, wetWound) * (1.0 - cm) * select(1.0, 0.25, isBone), 1.0, gloss);
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Verify on screen, in BOTH lights**

The lab's flat light and the dungeon flashlight are not interchangeable — the
beam is now the only reason you see anything, so a wound that reads in one may
vanish in the other.

```bash
BLOB_PROBE='(window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2/fibre
scripts/dungeon-look.sh
```

Report both. Confirm bone reads as bone under the beam and is not a white
blowout.

- [ ] **Step 8: Commit**

```bash
git add -A src/lab/sdf-zombie
git commit -m "wounds: torn fibre, lip-weighted wetness, stained bone material

Fibre is the existing gore mottle multiplied by wm, so it lives only inside
a wound — switching goreStrength on globally would have repainted whole
standing bodies as torn meat.

Bone is identified from the dominant prim's material code, which only
applyBones can set, so it is an identity read rather than a depth guess."
```

---

## Task 8: Tuning panel

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/wound-panel.ts`
- Test: `src/lab/sdf-zombie/webgpu/wound-panel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/wound-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { WOUND_KEYS, copyText, defaultsFrom } from './wound-panel';

describe('wound panel', () => {
  // The bug this test exists to make impossible: a panel whose COPY button
  // emits keys the setter ignores. It has happened twice in this project
  // (setBeam, and the goo panel). One table drives both sides, so they cannot
  // drift.
  it('emits only keys the setter consumes', () => {
    const text = copyText(defaultsFrom(WOUND_KEYS));
    const emitted = [...text.matchAll(/(\w+)\s*:/g)].map(m => m[1]!);
    const known = new Set(WOUND_KEYS.map(k => k.key));
    for (const k of emitted) expect(known.has(k), `emitted unknown key ${k}`).toBe(true);
  });

  it('emits every key, so a COPY is a complete tuning', () => {
    const text = copyText(defaultsFrom(WOUND_KEYS));
    for (const { key } of WOUND_KEYS) expect(text).toContain(key);
  });

  it('emits a runnable setWoundTuning call', () => {
    expect(copyText(defaultsFrom(WOUND_KEYS))).toContain('__sdfGame.setWoundTuning(');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/wound-panel.test.ts`
Expected: FAIL — cannot resolve `./wound-panel`.

- [ ] **Step 3: Implement the key table and COPY**

Create `src/lab/sdf-zombie/webgpu/wound-panel.ts`:

```ts
// src/lab/sdf-zombie/webgpu/wound-panel.ts
//
// ONE key table drives the sliders, the setter and the COPY text. That is not
// tidiness: a panel emitting keys the setter ignores has shipped twice in this
// project (the beam panel's setBeam keys, and the goo panel before it), and
// both times the symptom was a tuning that looked applied and was not. Deriving
// all three from this array makes the drift impossible rather than unlikely.

export interface WoundKey {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export const WOUND_KEYS: WoundKey[] = [
  { key: 'woundDepthAmp', label: 'depth ramp', min: 0, max: 1, step: 0.01, value: 1 },
  { key: 'fatDepth', label: 'fat knee (m)', min: 0, max: 0.03, step: 0.0005, value: 0.004 },
  { key: 'muscleDepth', label: 'muscle knee (m)', min: 0, max: 0.06, step: 0.0005, value: 0.014 },
  { key: 'woundFibreAmp', label: 'fibre', min: 0, max: 2, step: 0.01, value: 0.6 },
  { key: 'boneRatio', label: 'bone ratio', min: 0, max: 1, step: 0.01, value: 0.38 },
];

export function defaultsFrom(keys: WoundKey[]): Record<string, number> {
  return Object.fromEntries(keys.map(k => [k.key, k.value]));
}

/** The exact console call that reproduces the current panel state. */
export function copyText(values: Record<string, number>): string {
  const body = WOUND_KEYS
    .map(k => `  ${k.key}: ${values[k.key] ?? k.value}`)
    .join(',\n');
  return `__sdfGame.setWoundTuning({\n${body}\n});`;
}
```

- [ ] **Step 4: Run the test — it should pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/wound-panel.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Build the DOM panel and the seam**

Add the slider UI in the same file, following `goo-panel.ts`'s structure
exactly (same mount point, same styling, same presets/COPY button layout).
Render one slider per `WOUND_KEYS` entry rather than hand-writing five.

Then add `setWoundTuning` to the game seam beside `setGooTuning`, accepting the
same key names. Read `goo-panel.ts` and the `__sdfGame` seam definition and
mirror both.

- [ ] **Step 6: Verify the panel drives the shader**

Load `sdf-game.html`, stamp wounds, move the `fatDepth` slider, and confirm the
pale band widens. Press COPY, paste the result into the console, and confirm
the values round-trip with no "unknown key" warnings.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/wound-panel.ts src/lab/sdf-zombie/webgpu/wound-panel.test.ts
git commit -m "wounds: tuning panel with a single key table

Sliders, setter and COPY all derive from one array. A panel emitting keys
the setter ignores has shipped twice here; this makes that drift impossible
rather than merely unlikely, and the test asserts it."
```

---

## Task 9: Bench legs

Three alternating legs **inside one run**, per spec §4 gate 7.

**This task reports a number; it does not block.** (Owner call, 2026-09-01.)
The bench carries 5–11% within-run spread at its best and the bone fold may
cost less than that, so an unresolved delta is an acceptable, honest outcome —
record it and move on. What protects the work instead is the amplitude guards:
`woundDepthAmp 0` / `woundFibreAmp 0` / `boneRatio 0` each restore the previous
shading bit-for-bit, so an unmeasured cost is recoverable by a knob.

Within-run alternating legs are still the right shape when the bench IS run,
because cross-run comparison additionally drifts ~45% on machine state.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('wound bench legs (wound pass r2)', () => {
  it('exposes three wound legs', () => {
    expect(WOUND_SCENARIOS).toEqual(['wounds-off', 'wounds-no-bone', 'wounds-bone']);
  });

  it('pins the same wound count and body count on every leg', () => {
    // The lighting runs carried 8 bodies through the fire segment in one run
    // and 5 in another, which alone can move the result more than the effect
    // being measured. A cost leg must fix the workload.
    const legs = WOUND_SCENARIOS.map(n => scenarioByName(n));
    const counts = new Set(legs.map(l => `${l.woundCount}/${l.bodyCount}`));
    expect(counts.size).toBe(1);
  });

  it('differs only in what is enabled, not in what happens', () => {
    const [off, noBone, bone] = WOUND_SCENARIOS.map(n => scenarioByName(n));
    expect(off!.steps).toEqual(noBone!.steps);
    expect(noBone!.steps).toEqual(bone!.steps);
    expect(off!.woundDepthAmp).toBe(0);
    expect(noBone!.woundDepthAmp).toBe(1);
    expect(noBone!.boneRatio).toBe(0);
    expect(bone!.boneRatio).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts -t "wound bench legs"`
Expected: FAIL — `WOUND_SCENARIOS` is not exported.

- [ ] **Step 3: Implement**

In `game-bench-scenario.ts`, mirror the `DUNGEON_SCENARIOS` / `scenarioByName`
structure exactly (lines 164-193). Add a `WoundLeg` interface carrying
`woundCount`, `bodyCount`, `woundDepthAmp` and `boneRatio`, and a
`WOUND_SCENARIOS` tuple with a `scenarioByName` branch per leg. Every leg
shares one fixed scenario built from the same `buildFirefight` options with a
pinned body count, so the only difference between legs is which feature is on.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Extend the bench runner and run it**

Teach `scripts/dungeon-bench.mjs` to accept a leg set (defaulting to the
dungeon legs, so the existing invocation is unchanged), then:

```bash
BENCH_OUT=/tmp/wound-r2-bench BENCH_LEGS=wounds LAB_VITE_PORT=5281 LAB_CDP_PORT=9281 scripts/dungeon-bench.sh
```

- [ ] **Step 6: Report the delta honestly, and do not block on it**

Read the generated `bench.md`. Report `wounds-bone` vs `wounds-no-bone`.

**If the delta is smaller than the per-leg spread reported in the same file,
write UNRESOLVED — do not report it as a number**, and continue to Task 10
regardless. Reporting a sub-noise delta as a measurement is the mistake still
recorded against the goo fire-segment delta; stalling the work waiting for the
noise to clear would be a second, larger one.

- [ ] **Step 7: Commit**

```bash
git add -A src/lab/sdf-zombie/webgpu scripts
git commit -m "bench: wound legs measured inside one run, not against a baseline

wounds-off / wounds-no-bone / wounds-bone alternate in one process on one
machine state, with a pinned wound and body census. Cross-run comparison
drifts ~45% on machine state alone and would swamp the bone fold's cost."
```

---

## Task 10: Author the skull and ribcage

Auto-derive is correct for limbs and wrong for the two places players actually
shoot: a scaled torso blob is not a ribcage, and a scaled face ellipsoid is not
a cranium.

**Do not touch `bonewalker.blob`.** It already expresses bone a different and
deliberate way: additive `color=dbc0a0` bars deliberately `offset` to sit
*proud* of the flesh, so its spine ridge and ribs read as exposed bone at all
times. That is painted, always-visible bone; `op: 'bone'` is hidden bone
revealed by a wound. The two coexist without conflict — the containment
validator only inspects `op: 'bone'` prims, so bonewalker's proud bars are
never flagged — and it will additionally get auto-derived interior bone, which
is correct: a wound in its meat should still find something underneath.

**Files:**
- Modify: `src/lab/sdf-zombie/characters/zombie.blob`, `src/lab/sdf-zombie/characters/goblin.blob`
- Modify: `src/lab/sdf-zombie/characters/zombie-blob.test.ts` (bone filter, step 2)

- [ ] **Step 1: Add a `bones` block to `zombie.blob`**

Append after the `body` block, before `face`:

```
bones
  ratio 0.38

  # Cranium — a dome, not a scaled face ellipsoid. Sits inside the head mass
  # the face block emits, so a slug to the skull exposes bone instead of
  # hollowing the head.
  blob bone on skull at=0.55 r=0.072 wide=0.88 tall=0.95 deep=0.86

  # Ribcage — a broad shallow plate, wide across and thin front-to-back. The
  # auto-derived twin of the torso blobs would be a fat cylinder, which reads
  # as a spine-sized bone in the middle of the chest.
  bar bone on spine from=0.20 to=0.92 r=0.052 wide=1.45 deep=0.55
```

- [ ] **Step 2: Let the .blob-vs-TS parity test ignore bone**

`zombie.blob` now has content the hand-written `makeZombie()` does not, so the
prim-for-prim parity test must compare flesh only. In
`src/lab/sdf-zombie/characters/zombie-blob.test.ts`, filter both sides:

```ts
const flesh = (b: { prims: Primitive[] }) => b.prims.filter(p => p.op !== 'bone');
```

and use `flesh(fromBlob())` / `flesh(fromTs())` in the count and
placement assertions. Add a comment saying why:

```ts
// Bone is authored only in the .blob (a `bones` block); the legacy TS body is
// the reference for FLESH. Comparing bone prims would assert that the TS body
// has content it was never meant to have.
```

Auto-derived bone needs no filter — `buildBody` derives it on both paths
identically — but the filter covers both cases and is the honest statement of
what this test is for.

- [ ] **Step 3: Validate containment**

Run: `npm test`
Expected: PASS. If `checkBoneContainment` fails, the authored bone is breaking
the skin — **shrink the bone**, do not weaken the validator. The error names
the prim and the breach point.

- [ ] **Step 4: Look at it**

```bash
BLOB_PROBE='(window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2/zombie-authored
```

Confirm the cranium reads as a dome inside a head wound and the ribcage as a
plate inside a chest wound.

- [ ] **Step 5: Repeat for `goblin.blob`**

Same two shapes, scaled to the goblin's proportions. Read its `skeleton` block
for the actual bone names and lengths — do not assume they match the zombie's.
Validate and capture the same way.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/characters/
git commit -m "bone: authored cranium and ribcage for zombie and goblin

Auto-derive is right for limbs — a femur IS a thinner capsule inside the
thigh on the same bone — and wrong for the two places players actually
shoot. A scaled torso blob is not a ribcage."
```

---

## Task 11: Visual gates and the owner pass

**Files:** none modified — this task produces evidence.

- [ ] **Step 1: Undamaged-body pixel diff**

The empirical half of the gate-identity argument, separate from the algebraic
one.

```bash
git stash list  # confirm clean
npm run blob:shot -- zombie /tmp/wound-r2/gate-undamaged
git stash push -u -m "wound-r2-gate"   # then check out main into a temp worktree instead if preferred
```

Safer, and avoiding the shared stash stack: capture from `main` in a separate
worktree.

```bash
git worktree add /tmp/wound-r2-main main
cd /tmp/wound-r2-main && npm ci && npm run blob:shot -- zombie /tmp/wound-r2/gate-main
```

Compare `gate-undamaged` against `gate-main`. They must be pixel-identical.
Report the comparison, and if they differ, report the diff rather than
explaining it away — a difference here means the `nearWound` gate is not the
identity the design claims.

- [ ] **Step 2: Off-state parity**

```bash
BLOB_PROBE='(window.__sdfGame.setWoundTuning({woundDepthAmp:0,woundFibreAmp:0,boneRatio:0}),window.__sdfLab.stampWounds(5),1)' npm run blob:shot -- zombie /tmp/wound-r2/gate-off
```

Must match a wounded capture from `main`. Report both.

- [ ] **Step 3: Halo regression check**

Turntable at 5 stamped wounds, this branch against `main`. Look specifically
for annuli at mask edges and for crescents that sweep with the camera — this
file has produced that failure twice, so it gets its own check rather than
riding on a general look.

```bash
BLOB_PROBE='(window.__sdfLab.stampWounds(5),1)' npm run blob:turntable -- zombie /tmp/wound-r2/halo
```

Use the project's actual turntable script name — check `package.json` and
`scripts/blob-turntable.mjs`.

- [ ] **Step 4: Dungeon read**

```bash
scripts/dungeon-look.sh
```

The flashlight is the only reason anything is visible, so a wound that reads in
the lab may vanish in the dungeon. Both views are required.

- [ ] **Step 5: Write the dev note**

Create `docs/dev-notes/2026-09-01-wound-r2/notes.md` recording: what shipped,
the bench delta (or UNRESOLVED), every gate's result, the captures, and — most
importantly — anything that did NOT work. Follow the honesty convention of
`docs/dev-notes/2026-08-31-bleeding-wounds/notes.md`: artifacts get catalogued,
not omitted.

- [ ] **Step 6: Update `TASKS.md`**

Add the row for this work with its real state, and link the dev note and spec.

- [ ] **Step 7: Commit and hand to the owner**

```bash
git add docs TASKS.md
git commit -m "wounds r2: gates, captures and dev note"
```

Then present the captures for the owner's judgement pass. The three calls only
they can make: whether bone shows too readily on skinny limbs, whether the
stump protrusion reads as a feature or a bug, and whether the fibre anchor
stretch is worth having.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 material code `W_BONE` | 1 |
| §1 cluster membership | 1 (inherited — bone rides the flesh prim's cluster) |
| §1 hard `min` fold | 5 |
| §1 `nearWound` gate identity | 5, validated by 2, proven empirically by 11 |
| §1 `.w` carries `carved` | 5 |
| §1 bone-ness rides `bestIdx` | 5, consumed in 7 |
| §1 auto-derive + authored override | 3, 4 |
| §1 stump payoff | emergent; judged in 11 |
| §1 budget / stale `MAX_PRIMS` comment | 5 |
| §1 CPU mirror | 1 |
| §2 depth signal + ramp | 6 |
| §2 composition inside `wm` | 6 |
| §2 fibre | 7 |
| §2 wet | 7 |
| §2 bone material + stain | 7 |
| §2 amplitude guard | 6, gated in 11 |
| §3 `bones` grammar | 4 |
| §3 material knobs | 6 |
| §3 containment validation | 2 |
| §3 panel + one key table | 8 |
| §3 seams | 8 |
| §4 gate 1 (bench baseline) | done before planning |
| §4 gate 2 (off-state parity) | 11 |
| §4 gate 3 (containment) | 2 |
| §4 gate 4 (CPU/GPU agreement) | 1 |
| §4 gate 5 (undamaged pixel diff) | 11 |
| §4 gate 6 (halo check) | 11 |
| §4 gate 7 (bench legs — measurement, not blocking) | 9 |
| §4 risk: `bestIdx` through retract | 5 step 5 moves the read after the fold |

No gaps.

**Deviations from the spec, all discovered by re-checking against `main`:**

1. **Auto-derive runs in `buildBody`, not `blob-compile`** (Task 4 step 5b).
   The `.blob`-vs-TS parity tests compare prims by index, so deriving in the
   compiler would break them — and, more importantly, TS-authored bodies would
   have had no bone at all. Deriving one layer up fixes both.
2. **`boneColor` defaults to the project's existing bone colour** (`dbc0a0`,
   linear `[0.71, 0.53, 0.35]`) rather than the brighter value the spec
   suggested, so the two kinds of bone in this game agree with each other.
3. **Ten characters, not seven** — `bonewalker`, `dragon` and `schoolgirl-alt`
   landed in the Blobforge merge. `bonewalker` is explicitly out of scope for
   authoring (Task 10).

**Grammar note against the spec:** §3's example wrote `blob bone on skull`,
putting `bone` in the limb-word slot. The real grammar validates that slot via
`limbArg`, so the plan uses a real limb word (`blob head on skull`) and lets
the `bones` block itself supply `op: 'bone'`. Same capability, and it reuses
`parseBodyLine` unchanged instead of forking the grammar.

**Type consistency:** `op: 'bone'` (types.ts) → `W_BONE` (pack.ts) → `S.w == 4`
(WGSL) is one chain. `woundDepthAmp` / `fatDepth` / `muscleDepth` /
`woundFibreAmp` / `boneRatio` use identical spellings in `material.ts`,
`WOUND_KEYS`, `setWoundTuning` and the bench legs. `surfCfg3` is
`(woundDepthAmp, fatDepth, muscleDepth, woundFibreAmp)` at every reference.
`checkBoneContainment` and `BONE_CONTAINMENT_MARGIN` are named identically in
Task 2 and Task 10. `deriveBones(prims, ratio)` and `DEFAULT_BONE_RATIO` match
across Tasks 3, 4 and the panel default.
