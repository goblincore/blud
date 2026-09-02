# Organs and Springy Guts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gut shot opens onto pale pink coiled tubes, and the gut that spills is a springy coil of the same material rather than a rigid dark T.

**Architecture:** Organs are a new op (`W_ORGAN = 5`) in the existing `body.bonePrims` array — same `nearWound` gate, same prim-material identity read, same cost profile as bone, so everything that array already earned applies. The spilled rope becomes a **spring**: one skip-one distance constraint per node encodes a preferred bend, so a coil is explicit rather than hoped for. Both share one pale-pink material, carried to the goo pass through the density target's unused alpha channel.

**Tech Stack:** TypeScript, WGSL (WebGPU), Vitest. WebGPU only.

**Spec:** `docs/superpowers/specs/2026-09-02-organs-and-springy-guts-design.md`

**Base:** `claude/continue-previous-work-91055b`. Line numbers verified against it.

---

## Verification policy

**Tasks 1–5 do NOT open a browser.** Unit tests and `npx tsc --noEmit` only.
Every dispatch timeout on this project has been browser verification after the
code was already written and correct. Visual judgement happens in the reviewing
session, which reads the PNG directly. Task 6 is the only capture task.

**Never pixel-diff captures** — 52–82k pixels of same-build flicker, measured.

**Measure with the counter, not the clock.** `__sdfGame.boneEvals()` reported
1,224,192 bone evaluations in one frame while the timing bench read +0.0%. Report
counter deltas; do not claim frame-time results the bench cannot resolve.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/lab/sdf-zombie/pack.ts` | `W_ORGAN = 5`, op encoding | 1 |
| `src/lab/sdf-zombie/types.ts` | `op: 'organ'` | 1 |
| `src/lab/sdf-zombie/validate.ts` | organs skipped by the CPU field, contained | 1 |
| `src/lab/sdf-zombie/bone-derive.ts` | never derive organs | 1 |
| `src/lab/sdf-zombie/material.ts` | `organColor`, `organAmp` | 2 |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | organ material read + shading | 2 |
| `src/lab/sdf-zombie/characters/zombie.blob` | the authored coil | 3 |
| `src/lab/sdf-zombie/entrails.ts` | skip-one spring constraint | 4 |
| `src/lab/sdf-zombie/webgpu/goo-layer.ts` | gut mask on density `.a`, tint in surface | 5 |
| `src/lab/sdf-zombie/webgpu/wound-panel.ts` | coil/spring/organ knobs | 5 |

---

## Task 1: `W_ORGAN` through the CPU layer

Mirrors the `W_BONE` work exactly. Organs live in `body.bonePrims` beside bones
— the array is "things inside the flesh", not "bones" specifically.

**Files:**
- Modify: `src/lab/sdf-zombie/types.ts` (both `op` unions — `PrimDef.op` AND `Primitive.op`)
- Modify: `src/lab/sdf-zombie/pack.ts:20` (constants), `:219` (the role ladder)
- Modify: `src/lab/sdf-zombie/validate.ts` (the six `.op === 'sub'` filters, and `checkBoneContainment`)
- Modify: `src/lab/sdf-zombie/bone-derive.ts`
- Test: `src/lab/sdf-zombie/pack.test.ts`, `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/pack.test.ts`:

```ts
describe('organ prims (organs r3)', () => {
  const mk = (op: 'bone' | 'organ'): Primitive => ({
    a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.03,
    scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, op,
  });

  it('encodes op organ as primScale.w = 5', () => {
    const packed = packBody({
      prims: [], bonePrims: [mk('organ')],
      clusters: [{ limb: 'torso', start: 0, count: 0, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_ORGAN);
  });

  it('packs organs and bones into the same range, distinguished only by w', () => {
    const packed = packBody({
      prims: [], bonePrims: [mk('bone'), mk('organ')],
      clusters: [{ limb: 'torso', start: 0, count: 0, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.boneCount).toBe(2);
    expect(packed.primScale[3]).toBe(W_BONE);
    expect(packed.primScale[PRIM_STRIDE + 3]).toBe(W_ORGAN);
  });

  it('dead still outranks organ', () => {
    const packed = packBody({
      prims: [], bonePrims: [{ ...mk('organ'), dead: true }],
      clusters: [{ limb: 'torso', start: 0, count: 0, alive: true }],
    } as unknown as BuiltBody);
    expect(packed.primScale[3]).toBe(W_DEAD);
  });
});
```

Append to `src/lab/sdf-zombie/validate.test.ts`:

```ts
describe('organ prims are invisible to the CPU field (organs r3)', () => {
  const flesh: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.09,
    scale: [1, 1, 1], blendK: 0.01, limb: 'torso', cluster: 0,
  };
  const organ: Primitive = { ...flesh, radius: 0.085, op: 'organ' };
  const withOrgan = {
    prims: [flesh], bonePrims: [organ],
    clusters: [{ limb: 'torso', start: 0, count: 1, alive: true }],
  } as unknown as Body;
  const without = {
    prims: [flesh], bonePrims: [],
    clusters: [{ limb: 'torso', start: 0, count: 1, alive: true }],
  } as unknown as Body;

  it('sdBody is bit-identical with and without organs', () => {
    for (const p of [[0, 0.2, 0], [0.05, 0.2, 0], [0.3, 0.2, 0]] as Vec3[]) {
      expect(sdBody(p, withOrgan)).toBe(sdBody(p, without));
    }
  });

  it('containment covers organs, not just bones', () => {
    // Organs must sit inside flesh for exactly the same reason bones do: the
    // shader's nearWound gate is only an identity while nothing in this array
    // protrudes. A breaching organ pops as the gate flips.
    const breaching = {
      prims: [flesh], bonePrims: [{ ...flesh, radius: 0.12, op: 'organ' as const }],
      clusters: [{ limb: 'torso', start: 0, count: 1, alive: true }],
    } as unknown as Body;
    expect(checkBoneContainment(breaching).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/lab/sdf-zombie/pack.test.ts -t "organ prims"
npx vitest run src/lab/sdf-zombie/validate.test.ts -t "organ prims are invisible"
```
Expected: FAIL — `W_ORGAN` is not exported, `'organ'` is not assignable to `op`.

- [ ] **Step 3: Add the op**

In `pack.ts`, after `W_BONE`:

```ts
/** Organ: soft viscera inside the cavity. Rides the SAME array and the same
 *  nearWound gate as bone — the array is "things inside the flesh", not bones
 *  specifically — and differs only in material, so shading can tell a rib from
 *  a loop of gut by an identity read on this code. */
export const W_ORGAN = 5;
```

and extend the role ladder at `pack.ts:219`, keeping `dead` at the top:

```ts
    const w = p.dead ? W_DEAD
      : p.op === 'groove' ? W_GROOVE
      : p.op === 'bone' ? W_BONE
      : p.op === 'organ' ? W_ORGAN
      : isCarve ? W_CARVE : W_ADD;
```

In `types.ts`, widen **both** unions — `PrimDef.op` and `Primitive.op` are
separate declarations and both are load-bearing:

```ts
  op?: 'add' | 'sub' | 'groove' | 'bone' | 'organ';
```

In `validate.ts`, every filter that currently reads `prim.op === 'bone'` must
also exclude organs. There are six `.op === 'sub'` sites; the ones already
naming `'bone'` are the ones to extend:

```ts
      if (prim.op === 'sub' || prim.op === 'groove' || prim.op === 'bone'
        || prim.op === 'organ' || prim.dead) continue;
```

In `checkBoneContainment`, change the selector from `prim.op !== 'bone'` to
accept both, and update its error text to say "bone/organ":

```ts
    if ((prim.op !== 'bone' && prim.op !== 'organ') || prim.dead) return;
```

In `bone-derive.ts`, add `'organ'` to the skip list in both loops so
auto-derivation never produces or consumes one:

```ts
    if (p.op === 'sub' || p.op === 'groove' || p.op === 'bone' || p.op === 'organ') continue;
```

- [ ] **Step 4: Run the tests, then the suite**

```bash
npx vitest run src/lab/sdf-zombie/pack.test.ts -t "organ prims"
npx vitest run src/lab/sdf-zombie/validate.test.ts -t "organ prims are invisible"
npm test && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A src/lab/sdf-zombie
git commit -m "organs: W_ORGAN=5 through the CPU layer

Organs ride body.bonePrims beside bones — that array is 'things inside the
flesh', not bones specifically — so they inherit the nearWound gate, the
containment validator and the pack path unchanged, and differ only in
material code."
```

---

## Task 2: Organ material in the shader

**Files:**
- Modify: `src/lab/sdf-zombie/material.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts:1891` (the `isBone` block)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (uniform upload)
- Test: `src/lab/sdf-zombie/material.test.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Material fields, with a failing test**

```ts
describe('organ material (organs r3)', () => {
  it('every preset carries an organ colour', () => {
    for (const [name, p] of Object.entries(FLESH_PRESETS)) {
      expect(p.organColor, name).toHaveLength(3);
    }
  });
  it('organ is LIGHTER than deepColor — it must read as pale viscera', () => {
    // The reference is a pale salmon intestine. Darker than the muscle around
    // it and it disappears into the cavity, which is what the viscera TINT
    // already failed at.
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (const [name, p] of Object.entries(FLESH_PRESETS)) {
      expect(lum(p.organColor), name).toBeGreaterThan(lum(p.deepColor));
    }
  });
});
```

Add to `FleshMaterial`:

```ts
  /** Cavity viscera, linear RGB. Pale salmon — MUST be lighter than
   *  `deepColor`, or it vanishes into the muscle around it the way the
   *  viscera tint did. */
  organColor: Vec3;
  /** 0 shades organ prims as plain bone, so the off-state is one knob
   *  rather than a rebuild. */
  organAmp: number;
```

with `organColor: [0.72, 0.32, 0.30], organAmp: 1,` on every preset.

Run: `npx vitest run src/lab/sdf-zombie/material.test.ts -t "organ material"` → PASS.

- [ ] **Step 2: Write the failing shader test**

```ts
describe('organ shading (organs r3)', () => {
  it('reads the organ code from the SAME hitMat load as bone', () => {
    // One texel load serves both; a second load would undo refinement 5.
    expect((SHADE_BODY.match(/textureLoad\(data, vec2<i32>\(hitBest, \d+\), 0\)\.w/g) ?? []))
      .toHaveLength(1);
    expect(SHADE_BODY).toContain('isOrgan');
  });
  it('is amplitude-guarded by organAmp', () => {
    expect(SHADE_BODY).toContain('organAmp');
  });
});
```

- [ ] **Step 3: Extend the material read**

At `march.wgsl.ts:1891`, `isBone` is derived from `hitMat`. Add the organ case
against the **same** load — do not add a second `textureLoad`:

```wgsl
  let isBone = hitMat > 3.5 && hitMat < 4.5;
  // Organs share the load and the gate; only the code differs (organs r3).
  let isOrgan = hitMat > 4.5 && hitMat < 5.5;
```

and after the existing `if (isBone) { ... }` block:

```wgsl
  if (isOrgan) {
    // Pale, wet, and NOT stained toward the meat the way bone is: bone is a
    // dry plate that needs blood to seat it, viscera is already wet and
    // already the same family of colour as the flesh around it. organAmp 0
    // falls through to the bone treatment, which is the off-state.
    albedo = mix(albedo, organColor, organAmp);
  }
```

Wire `wetWound` so organs read wet: extend the existing `wet` line's bone term
so an organ is glossy rather than matte —

```wgsl
  let wet = mix(surfCfg2.x * mix(1.0, 1.6, wetWound) * (1.0 - cm)
    * select(1.0, 0.25, isBone) * select(1.0, 1.8, isOrgan), 1.0, gloss);
```

- [ ] **Step 4: Upload the uniforms**

Add `organColor` (a `vec3` uniform) and `organAmp` to `zombie-gpu.ts`,
**declared and threaded exactly the way `boneColor` already is** — same
declaration site, same binding struct, same update path in `applyMaterial`.
Do not invent a new mechanism.

- [ ] **Step 5: Suite, typecheck, commit**

```bash
npm test && npx tsc --noEmit
git add -A src/lab/sdf-zombie
git commit -m "organs: pale wet organ material off the shared hitMat read

One texel load serves bone and organ; a second would undo gore r3
refinement 5. organAmp 0 falls through to the bone treatment, so the
off-state is one knob."
```

---

## Task 3: Author the coil in `zombie.blob`

**Files:**
- Modify: `src/lab/sdf-zombie/characters/zombie.blob`
- Modify: `src/lab/sdf-zombie/blob-parse.ts` (accept `organ` inside the `bones` block)
- Test: `src/lab/sdf-zombie/characters/zombie-blob.test.ts`

- [ ] **Step 1: Accept `organ` in the grammar**

The `bones` block currently tags every part `op: 'bone'`. Allow a line to opt
into organ instead by a bare `organ` word, the same way `mirror`/`both`/`hard`
are bare words:

```ts
      const op = l.words.includes('organ') ? 'organ' as const : 'bone' as const;
```

applied where the block assigns `op`. Add `'organ'` to the bare-word allowlist
if the parser validates unknown bare words.

- [ ] **Step 2: Write the failing character test**

```ts
describe('zombie.blob authors a gut coil (organs r3)', () => {
  const organs = () => fromBlob().bonePrims.filter(p => p.op === 'organ');

  it('has organ prims, in the torso cluster', () => {
    expect(organs().length).toBeGreaterThanOrEqual(6);
    for (const o of organs()) {
      expect(o.cluster).toBe(CLUSTER_ORDER.indexOf('torso'));
    }
  });

  it('they are TUBES that LOOP — bent, not a straight stack', () => {
    // The whole read is round tubes in visible loops. A stack of straight
    // bars is the failure mode the ribcage already went through.
    const bent = organs().filter(o => o.bend !== undefined);
    expect(bent.length).toBeGreaterThanOrEqual(3);
  });

  it('sits low — a chest shot must still open onto ribs', () => {
    const ys = organs().map(o => (o.a[1] + o.b[1]) / 2);
    const ribs = fromBlob().bonePrims
      .filter(p => p.op === 'bone' && p.cluster === CLUSTER_ORDER.indexOf('torso'))
      .map(p => (p.a[1] + p.b[1]) / 2);
    expect(Math.max(...ys)).toBeLessThan(Math.max(...ribs));
  });

  it('compiles with no validation errors — organs are contained like bone', () => {
    expect(fromBlob().errors).toEqual([]);
  });
});
```

- [ ] **Step 3: Author the coil**

Append inside `zombie.blob`'s `bones` block. Suggestive, not anatomical: loops
of bent tube plus a couple of blob chains for the segmented bulge read. Keep
every prim inside the torso flesh (~0.17 half-width, ~0.12 half-depth) and
**below the ribs**, which start at spine `from=0.28`.

```
  # GUT COIL (organs r3). Suggestive of the classic intestine look, not
  # anatomical — owner: "doesn't need to be anatomically correct, just
  # suggestive". The read is round tubes, visible loops, pale pink, wet.
  #
  # Only drawable since applyBones started reading bend (3dc8373); before
  # that every one of these would have rendered as a straight bar.
  bar torso on pelvis from=0.55 to=0.75 offset=(-0.045,0.010,0.030) tip=(0.090,0.010,0.006) bend=(0.010,0.055,0.030) r=0.024 organ
  bar torso on pelvis from=0.50 to=0.70 offset=(0.048,0.004,0.034) tip=(-0.092,0.014,-0.010) bend=(-0.012,-0.050,0.026) r=0.023 organ
  bar torso on pelvis from=0.72 to=0.92 offset=(-0.040,0.004,0.026) tip=(0.084,-0.008,-0.014) bend=(0.008,0.048,0.032) r=0.022 organ
  bar torso on spine  from=0.06 to=0.20 offset=(0.042,0.000,0.030) tip=(-0.086,-0.010,-0.008) bend=(-0.010,-0.044,0.028) r=0.022 organ
  # Segmented bulges: overlapping blobs at a tight blend read as haustra far
  # more cheaply than grooving a smooth tube.
  blob torso on pelvis at=0.62 offset=(-0.058,0.006,0.038) r=0.026 blend=0.004 organ
  blob torso on pelvis at=0.62 offset=(-0.020,0.014,0.042) r=0.025 blend=0.004 organ
  blob torso on pelvis at=0.62 offset=(0.020,0.010,0.042) r=0.025 blend=0.004 organ
  blob torso on pelvis at=0.62 offset=(0.058,0.002,0.038) r=0.026 blend=0.004 organ
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/lab/sdf-zombie/characters/zombie-blob.test.ts
npm test
```

**If `checkBoneContainment` fails, shrink or move the coil — never raise
`BONE_CONTAINMENT_MARGIN`.** The error names the prim and the breach point.

- [ ] **Step 5: Commit**

```bash
git add -A src/lab/sdf-zombie
git commit -m "organs: a gut coil in the zombie's abdomen

Suggestive, not anatomical. Bent bars for loops plus blob chains for the
segmented bulge read, kept below the ribs so a chest shot still opens onto
ribs and a gut shot opens onto coils."
```

---

## Task 4: The spring

**Files:**
- Modify: `src/lab/sdf-zombie/entrails.ts`
- Test: `src/lab/sdf-zombie/entrails.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('the gut chain is a SPRING (organs r3)', () => {
  it('a chain released straight pulls itself into a coil', () => {
    // The owner's report was "a rigid dark T shape". A chain with only
    // distance constraints has nothing that resists a straight line; the
    // skip-one constraint is what makes a coil the REST shape.
    let c = makeGutChain([0, 2, 0]);
    c = detachGutChain(c);
    for (let i = 0; i < 400; i++) c = stepGutChain(c, 1 / 60);
    const head = c.nodes[0]!.pos, tail = c.nodes[c.nodes.length - 1]!.pos;
    const span = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
    // A coil is markedly SHORTER end-to-end than its own contour length.
    expect(span).toBeLessThan(GUT_TUNING.restLength * 0.7);
  });

  it('coilTightness 1.0 degrades to a plain hanging rope', () => {
    // The graceful-failure lever: if the spring reads comedic, this is the
    // way back to the old behaviour without a revert.
    let c = makeGutChain([0, 2, 0], { coilTightness: 1.0 });
    c = detachGutChain(c);
    for (let i = 0; i < 400; i++) c = stepGutChain(c, 1 / 60);
    const head = c.nodes[0]!.pos, tail = c.nodes[c.nodes.length - 1]!.pos;
    const span = Math.hypot(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]);
    expect(span).toBeGreaterThan(GUT_TUNING.restLength * 0.7);
  });

  it('stays finite and bounded — the two constraint families must not fight', () => {
    // Skip-one pulls nodes together while segments push them apart. Weighted
    // wrongly they oscillate and blow up.
    let c = makeGutChain([0, 2, 0]);
    for (let i = 0; i < 2000; i++) {
      c = pinGutChain(c, [Math.sin(i / 20) * 0.3, 2, 0]);
      c = stepGutChain(c, 1 / 60);
    }
    for (const n of c.nodes) {
      for (const v of n.pos) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v)).toBeLessThan(50);
      }
    }
  });

  it('still freezes once settled', () => {
    let c = detachGutChain(makeGutChain([0, 2, 0]));
    for (let i = 0; i < 1200; i++) c = stepGutChain(c, 1 / 60);
    expect(c.settled).toBe(true);
    const before = c.nodes.map(n => [...n.pos]);
    c = stepGutChain(c, 1 / 60);
    expect(c.nodes.map(n => [...n.pos])).toEqual(before);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/lab/sdf-zombie/entrails.test.ts -t "SPRING"`
Expected: FAIL — `makeGutChain` takes one argument; the coil test fails because
nothing pulls the chain into one.

- [ ] **Step 3: Implement the spring**

Extend `GUT_TUNING`:

```ts
  /** Skip-one target as a fraction of two segments. 1.0 is a straight rope;
   *  lower is a tighter coil. This is the graceful-failure lever — if the
   *  spring reads comedic rather than visceral, 1.0 is the old behaviour. */
  coilTightness: 0.55,
  /** Skip-one correction weight relative to the segment constraints, 0..1.
   *  Kept well under 1 so segments still win and the tube cannot crush
   *  itself — the two families pull against each other by design. */
  springiness: 0.35,
```

Widen the constructor so the tests (and the panel) can override:

```ts
export function makeGutChain(
  anchor: Vec3, opts: { coilTightness?: number; springiness?: number } = {},
): GutChain {
  // ...existing node construction...
  return {
    nodes,
    seg: GUT_TUNING.restLength / (GUT_TUNING.nodes - 1),
    coilTightness: opts.coilTightness ?? GUT_TUNING.coilTightness,
    springiness: opts.springiness ?? GUT_TUNING.springiness,
    attached: true,
    settled: false,
  };
}
```

adding both fields to `GutChain`.

In `stepGutChain`, **after** the existing segment-constraint loop and inside the
same iteration loop, add the skip-one pass:

```ts
    // SKIP-ONE: the spring. Constraining i-1 to i+1 at less than two segments
    // encodes a preferred bend at every node, and a uniform preferred bend is
    // a coil. Without this the chain has nothing resisting a straight line,
    // which is exactly the "rigid T" the owner reported.
    const skipTarget = c.seg * 2 * c.coilTightness;
    for (let i = 1; i < nodes.length - 1; i++) {
      const a = nodes[i - 1]!, b = nodes[i + 1]!;
      const dx = b.pos[0] - a.pos[0], dy = b.pos[1] - a.pos[1], dz = b.pos[2] - a.pos[2];
      const d = Math.hypot(dx, dy, dz) || 1e-9;
      // Weighted BELOW the segment constraints so the tube keeps its length.
      const corr = (d - skipTarget) / d * 0.5 * c.springiness;
      const aFixed = c.attached && i - 1 === 0;
      if (!aFixed) {
        a.pos = [a.pos[0] + dx * corr, a.pos[1] + dy * corr, a.pos[2] + dz * corr];
      }
      b.pos = [b.pos[0] - dx * corr, b.pos[1] - dy * corr, b.pos[2] - dz * corr];
    }
```

**A coil needs an out-of-plane nudge**, or a perfectly symmetric chain collapses
into a flat zigzag. Seed it once in `makeGutChain` by offsetting each node's
`prev` slightly around the axis:

```ts
    // A helix needs a handedness. Without this seed a symmetric chain has no
    // reason to prefer one plane and folds flat instead of coiling.
    const ang = i * 1.1;
    nodes.push({
      pos: [...anchor] as Vec3,
      prev: [anchor[0] - Math.cos(ang) * 0.004, anchor[1], anchor[2] - Math.sin(ang) * 0.004] as Vec3,
    });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/entrails.test.ts`
Expected: PASS (all, including the four pre-existing ones).

If the coil test fails marginally, tune `coilTightness` **down** rather than
loosening the assertion — the assertion is the feature.

- [ ] **Step 5: Commit**

```bash
git add -A src/lab/sdf-zombie
git commit -m "guts: the rope is a spring — skip-one constraints make a coil

A verlet chain with only distance constraints has nothing resisting a
straight line, which is why it read as 'a rigid dark T shape'. One skip-one
constraint per node encodes a preferred bend, and a uniform preferred bend
is a coil — explicit rather than emergent from self-collision, which is
both simpler and controllable. coilTightness 1.0 is the way back to a plain
rope without a revert."
```

---

## Task 5: Pink guts through goo's alpha channel, and the knobs

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/goo-layer.ts`
- Modify: `src/lab/sdf-zombie/webgpu/wound-panel.ts`
- Test: `src/lab/sdf-zombie/webgpu/goo-layer.test.ts`, `wound-panel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('gut tint (organs r3)', () => {
  it('density writes the gut mask into the UNUSED alpha channel', () => {
    // .r is density, .g/.b reconstruct view depth (c.g / max(c.b,1e-4)).
    // .a was written as a constant 1 and never read — that is the free slot.
    expect(GOO_DENSITY_ALPHA_IS_GUT_MASK).toBe(true);
  });
  it('the surface lerps toward the organ colour by the gut fraction', () => {
    expect(GOO_SURFACE_WGSL).toContain('gutFrac');
    // Blood NEAR a rope must stay blood — a disembowelled body bleeds heavily
    // exactly there — so the lerp is per-pixel by ratio, not a global switch.
    expect(GOO_SURFACE_WGSL).toMatch(/gutFrac\s*=\s*c\.a\s*\/\s*max\(c\.r/);
  });
});
```

- [ ] **Step 2: Carry a per-droplet gut mask**

Droplets become instanced quads in `sync()`, which currently sets only
`quads.instanceMatrix`. Add an instanced float attribute:

```ts
  const gutAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPLETS), 1);
  quads.geometry.setAttribute('gutMask', gutAttr);
```

and in `sync()`, alongside the matrix write, `gutAttr.array[n] = d.kind === 'gut' ? 1 : 0;`
with `gutAttr.needsUpdate = true;` beside the existing `instanceMatrix.needsUpdate`.

- [ ] **Step 3: Write it into density alpha**

`densMat.colorNode` currently writes `vec4(fall, fall.mul(viewDepth), fall, 1)`.
Change the alpha term to the gut-weighted density:

```ts
  // ALPHA IS THE GUT MASK (organs r3). It was a constant 1 and never read —
  // .r is density and .g/.b reconstruct view depth, all consumed — so this is
  // the one free channel. Writing `fall * gutMask` makes .a accumulate
  // gut-weighted density, and a/r is then the per-pixel gut fraction.
  //
  // Additive blending with premultipliedAlpha blends RGB as ONE,ONE, so the
  // alpha term does not affect the colour channels. Gate 1 asserts that.
  densMat.colorNode = vec4(fall, fall.mul(viewDepth), fall, fall.mul(gutMaskAttr));
```

reading `gutMask` as an instanced attribute node the same way the material
already reads its other per-instance inputs.

- [ ] **Step 4: Tint in the surface pass**

In `GOO_SURFACE_WGSL`, the base colour is the literal `vec3<f32>(0.62, 0.11, 0.10)`.
Replace it with a per-pixel lerp:

```wgsl
  // Guts take the organ colour; blood stays blood. Per-pixel by ratio rather
  // than a global switch, because a disembowelled body bleeds heavily in
  // exactly the pixels the rope occupies.
  let gutFrac = clamp(c.a / max(c.r, 1e-4), 0.0, 1.0);
  let baseCol = mix(vec3<f32>(0.62, 0.11, 0.10), organColor, gutFrac);
  var lit = baseCol * trans * lambert * keyColor * mix(0.55, 1.0, softEdge);
```

with `organColor` added as a uniform on the goo surface material, defaulting to
the same `[0.72, 0.32, 0.30]` the flesh material uses.

- [ ] **Step 5: Panel knobs**

Add to `wound-panel.ts`'s single `_WOUND_KEYS` table (the existing tests already
assert COPY emits exactly the table's keys, so no per-key test is needed):

```ts
  { key: 'coilTightness', label: 'coil', min: 0.2, max: 1, step: 0.01, value: 0.55 },
  { key: 'springiness', label: 'springiness', min: 0, max: 1, step: 0.01, value: 0.35 },
  { key: 'organAmp', label: 'organ tint', min: 0, max: 1, step: 0.01, value: 1 },
```

`coilTightness` and `springiness` apply to ropes spawned from now on;
`organAmp` is a live uniform write.

- [ ] **Step 6: Suite, typecheck, commit**

```bash
npm test && npx tsc --noEmit
git add -A src/lab/sdf-zombie
git commit -m "guts: pale pink through goo's unused density alpha

.r is density and .g/.b reconstruct view depth; .a was a constant 1 that
nothing read. Gut droplets now write a mask there, and the surface lerps
blood -> organColor by a/r — per pixel, so blood near a rope stays blood."
```

---

## Task 6: Gates and evidence

**The only task that opens a browser.**

- [ ] **Step 1: Off-state parity**

Assert that `organAmp 0` shades organ prims exactly as bone, and that a body
with no organ prims packs bit-for-bit as before. Also assert the goo change is
inert with no gut droplets: with only `drop`/`scrap`/`mist` in the sim, every
`.a` is 0, so `gutFrac` is 0 and `baseCol` is the original literal.

- [ ] **Step 2: Containment across the cast**

`npm test` runs `checkBoneContainment` on every character. Confirm all ten pass
with organs added. **Do not raise the margin.**

- [ ] **Step 3: Counter delta**

```
__sdfGame.boneEvals()
```
before and after, on the same staged wound set. Baseline for reference: 12 slug
wounds across 4 of 10 bodies gave `bonesTotal` 1,224,192, `meanPerPayingRay`
291.8. Organs add ~8 prims to ~17, so expect roughly +45%. **Report the counter,
not a frame time** — the bench cannot resolve this.

- [ ] **Step 4: Combat-range capture**

Stage a slug to the **lower torso** at 2–3 m under the beam, via
`predictSlugHit()` → `stampWoundAt(..., 'slug', actorId)`. Set `spillChance 1`
so the rope is guaranteed rather than rolled.

Report **what you see**: does the cavity read as pale coiled tubes, and does the
rope read as a springy coil of the same material rather than a dark T? Capture
a chest shot too, which must still open onto ribs.

**No pixel diffs.**

- [ ] **Step 5: Dev note and TASKS.md**

Write `docs/dev-notes/2026-09-02-organs-guts/notes.md`: what shipped, the
counter delta, what the captures show, and anything that did NOT work. Update
`TASKS.md`.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 `W_ORGAN = 5` in the bone array | 1 |
| §1 form: bent bars + blob chains, suggestive | 3 |
| §1 `organColor` pale salmon, lighter than deepColor | 2 (asserted by luminance) |
| §1 `organAmp` guard | 2 |
| §1 placement below the ribs, contained | 3 (asserted) |
| §2 gut mask on density `.a` | 5 |
| §2 surface lerp by `a/r`, blood stays blood | 5 |
| §3 skip-one spring constraint | 4 |
| §3 `coilTightness` / `springiness` defaults | 4 |
| §3 no node repulsion | 4 (not built, by omission) |
| §3 gut thickness / goo threshold | 5 (panel) |
| §4 gates 1–5 | 6 |

No gaps. Chest organs, anatomical accuracy, rope collision and organs-as-spilled-objects are spec'd out of scope and correctly have no task.

**Type consistency:** `op: 'organ'` (task 1) → `W_ORGAN` (task 1) → `isOrgan` on
`hitMat` (task 2) is one chain. `organColor` / `organAmp` are spelled identically
in tasks 2, 5 and 6. `coilTightness` / `springiness` match between `GUT_TUNING`,
`GutChain`, `makeGutChain`'s opts and the panel table in tasks 4 and 5.
`GOO_SURFACE_WGSL` and `gutFrac` match between tasks 5's test and its
implementation.

**Known soft spots, flagged rather than hidden:**

1. **The density alpha change is the riskiest edit here.** `densMat` sets
   `premultipliedAlpha: true` and `AdditiveBlending`. The reasoning is that
   additive blending is ONE,ONE for RGB so the alpha term cannot affect colour —
   but that is an argument, not a measurement. Task 6 gate 1 tests it directly:
   with no gut droplets the surface must be unchanged. **If it is not, stop** —
   a second render target is the fallback, not a fudge to the blend state.
2. **Task 4's out-of-plane seed is a guess.** `0.004` per node at 1.1 radians is
   chosen to break symmetry, not derived. If the coil folds flat, raise it
   before touching the constraint weights.
