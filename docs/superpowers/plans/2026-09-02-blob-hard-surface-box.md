# `box` primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bare word `box` to `.blob` so a primitive can be a rounded box instead of a capsule, unblocking hard-surface (biomechanical) characters.

**Architecture:** `box` is a MODIFIER on `blob`/`bar`, not a new part kind, so it inherits `mirror`/`offset`/`core`/paint/`chamfer` with no new parse path. A box's half-extents are `r × wide/tall/deep` — identical to a capsule's semi-axes — so `blob:rings` keeps working on boxes unchanged. `round=` is a FRACTION of `r` (0..1), inset, so total size stays `r·scale`. The field is one branch at the `base` assignment in `sdPrimitive`, reusing the existing closest-point-on-segment code. No new texture row: the flag is bit 3 of `prof`, and `round` rides in the unread `primBend.w`.

**Tech Stack:** TypeScript, WGSL, vitest.

**Spec:** [`docs/superpowers/specs/2026-09-02-blob-hard-surface-box-design.md`](../specs/2026-09-02-blob-hard-surface-box-design.md)

---

## Read before starting

Three facts this plan depends on, each verified against the code on 2026-09-02:

1. **`primShape.zw` is NOT spare.** `pack.ts` writes the groove's depth/width there and the carve loop reads them as `gr.zw`. The header comment at `march.wgsl.ts` row 10 saying "zw spare" is **stale** — Task 5 corrects it.
2. **`prof` bit 3 (value 8) is free.** It currently reads `chamfer(1) + bent(2) + shell(4)`.
3. **`primBend.w` is genuinely unread.** The shader loads `ROW_PRIM_BEND` as `.xyz` only (lines 561, 839), and only when `prof & 2` — which a box never sets, because `bend=` on a box is rejected at compile time (Task 2).

**`src/lab/sdf-zombie/march.glsl.ts` is deliberately NOT touched by any task.**
It is frozen per owner decision and only `zombie.ts` consumes it; bent and
oriented prims already diverge there, so a box joins a documented list rather
than opening a new one. A box will simply not render on the old WebGL lab path.

**The single highest-risk item is Task 4.** A box's corner reaches further from its segment than a capsule's surface does. There are FOUR outer-bound sites that must account for it. Miss one and geometry is silently culled at some camera angles — which presents as the "perfectly ROUND see-through hole" row in the skill's failure-triage table, and will send you hunting in `webgpu/` for a bug that is actually here.

Run the full suite with `npx vitest run src/lab/sdf-zombie/` — it should be green (1930 tests, 103 files, measured 2026-09-02) before you start.

---

### Task 1: Types and parsing

**Files:**
- Modify: `src/lab/sdf-zombie/blob-ast.ts` (add to `BlobPart`)
- Modify: `src/lab/sdf-zombie/blob-parse.ts:355-408` (the `BlobPart` construction)
- Modify: `src/lab/sdf-zombie/types.ts` (add to `PrimDef` and `Primitive`)
- Test: `src/lab/sdf-zombie/blob-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lab/sdf-zombie/blob-parse.test.ts`:

```ts
describe('box', () => {
  const doc = (body: string) => parseBlob(`name t\nheight 1.0\nskeleton\n  root pelvis\n  bone spine parent=pelvis dir=up len=0.3\nbody\n${body}\n`);

  it('reads the bare word `box` and a round= fraction', () => {
    const d = doc('  bar torso on spine from=0.1 to=0.9 r=0.05 box round=0.10');
    expect(d.parts[0]!.box).toBe(true);
    expect(d.parts[0]!.round).toBeCloseTo(0.10, 6);
  });

  it('defaults round to 0.08 when the word is present without it', () => {
    const d = doc('  bar torso on spine from=0.1 to=0.9 r=0.05 box');
    expect(d.parts[0]!.round).toBeCloseTo(0.08, 6);
  });

  it('leaves box false and round at its default on an ordinary prim', () => {
    const d = doc('  bar torso on spine from=0.1 to=0.9 r=0.05');
    expect(d.parts[0]!.box).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/blob-parse.test.ts -t box`
Expected: FAIL — `d.parts[0].box` is `undefined`, not `false`/`true`.

- [ ] **Step 3: Add the fields to `BlobPart`**

In `src/lab/sdf-zombie/blob-ast.ts`, after the `core` field:

```ts
  /**
   * The bare word `box`: this primitive is a rounded BOX swept along its
   * segment, not a capsule. Half-extents are `radius * wide/tall/deep` — the
   * SAME world semi-axes a capsule gets — so `blob:rings` measures and
   * suggests against a box with no change to the fitter.
   */
  box: boolean;
  /**
   * `round=` — corner radius as a FRACTION of `radius`, 0..1, inset so the
   * total half-extent stays `radius * scale`. A fraction and not metres
   * because `sdPrimitive` evaluates in the SCALE-DIVIDED frame, where an
   * absolute length would come out anisotropically distorted on any part with
   * unequal wide/tall/deep. Ignored unless `box`.
   */
  round: number;
```

- [ ] **Step 4: Parse them**

In `src/lab/sdf-zombie/blob-parse.ts`, inside the `const part: BlobPart = {` literal, immediately after the `core:` line:

```ts
    // `box` — a bare word like `hard`/`mirror`/`chamfer`. Swaps the swept
    // shape from a sphere to a rounded box; see BlobPart.box for why the
    // half-extents deliberately match a capsule's semi-axes.
    box: l.words.includes('box'),
    // Default 0.08, not 0: a dead-sharp corner is almost never what an author
    // means on a first pass, and 0.08 still reads machined. See BlobPart.round
    // for why this is a fraction rather than metres.
    round: numArg(l, 'round', 0.08),
```

- [ ] **Step 5: Add the fields to `PrimDef` and `Primitive`**

In `src/lab/sdf-zombie/types.ts`, add to `PrimDef` (after `shell?: ShellParams;`):

```ts
  /**
   * Present when this primitive is a rounded BOX swept along its segment
   * rather than a capsule. `round` is the corner radius as a fraction of
   * `radius` (0..1), inset — see BoxParams.
   */
  box?: BoxParams;
```

Add the same field to `Primitive` (after its own `shell?: ShellParams;`), with:

```ts
  /** See PrimDef.box. Carried through mirror, resolve and the rig untouched. */
  box?: BoxParams;
```

And define the type beside `ShellParams`:

```ts
/**
 * A rounded box swept along the primitive's segment. Half-extents are
 * `radius * scale` — identical to the capsule's semi-axes, which is what keeps
 * `blob:rings` meaningful on a box. `round` is the corner radius as a FRACTION
 * of `radius`, 0..1, applied INSET:
 *
 *     sdBox(q - closest, vec3(radius * (1 - round))) - radius * round
 *
 * so raising it softens the corner without growing the part. `round: 1` is
 * exactly the capsule; `round: 0.05` reads machined.
 */
export interface BoxParams { round: number }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/blob-parse.test.ts -t box`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/blob-ast.ts src/lab/sdf-zombie/blob-parse.ts src/lab/sdf-zombie/types.ts src/lab/sdf-zombie/blob-parse.test.ts
git commit -m "blob: parse the bare word \`box\` and its round= fraction"
```

---

### Task 2: Compile-time rejections

**Files:**
- Modify: `src/lab/sdf-zombie/blob-compile.ts:237-315`
- Test: `src/lab/sdf-zombie/blob-compile.test.ts`

Five rejections. Each fails loudly with the line, matching how `chamfer`-on-`carve` is handled — never a silently meaningless flag.

- [ ] **Step 1: Write the failing tests**

Add to `src/lab/sdf-zombie/blob-compile.test.ts`:

```ts
describe('box rejections', () => {
  const compile = (line: string) =>
    () => compileBlob(parseBlob(`name t\nheight 1.0\nskeleton\n  root pelvis\n  bone spine parent=pelvis dir=up len=0.3\nbody\n  ${line}\n`));

  it('rejects bend= on a box', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box bend=(0.02,0,0)'))
      .toThrow(/bend= is not supported on a box/);
  });

  it('rejects r2= on a box', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box r2=0.02'))
      .toThrow(/r2= is not supported on a box/);
  });

  it('rejects tip= on a box', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box tip=(0,0,0.05)'))
      .toThrow(/tip= is not supported on a box/);
  });

  it('rejects box on a shell', () => {
    expect(compile('shell torso on spine at=0.5 r=0.05 box thick=0.01 clip=(0,1,0) clipd=0.1 rim=0.004'))
      .toThrow(/box is not supported on a shell/);
  });

  it('rejects round= outside 0..1 rather than clamping', () => {
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box round=1.4'))
      .toThrow(/round= must be between 0 and 1/);
    expect(compile('bar torso on spine from=0.1 to=0.9 r=0.05 box round=-0.1'))
      .toThrow(/round= must be between 0 and 1/);
  });

  it('carries box onto the compiled prim', () => {
    const body = compileBlob(parseBlob(`name t\nheight 1.0\nskeleton\n  root pelvis\n  bone spine parent=pelvis dir=up len=0.3\nbody\n  bar torso on spine from=0.1 to=0.9 r=0.05 box round=0.2\n`));
    expect(body.prims[0]!.box).toEqual({ round: 0.2 });
  });

  it('leaves box absent on an ordinary prim', () => {
    const body = compileBlob(parseBlob(`name t\nheight 1.0\nskeleton\n  root pelvis\n  bone spine parent=pelvis dir=up len=0.3\nbody\n  bar torso on spine from=0.1 to=0.9 r=0.05\n`));
    expect(body.prims[0]!.box).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/blob-compile.test.ts -t "box rejections"`
Expected: FAIL — nothing throws; `box` is not carried.

- [ ] **Step 3: Add the rejections and the carry**

In `src/lab/sdf-zombie/blob-compile.ts`, inside the `doc.parts.map(p => {` callback, after the existing `bend=` rejection and BEFORE the `return {`:

```ts
    // A box is swept along its segment as a rounded BOX, and sdRoundBox has
    // no bent, tapered or tip-displaced form. Each of these would otherwise
    // be silently dropped in the field while the emitter echoed it back, so
    // they fail here with the line rather than becoming a shape the author
    // wrote and never got.
    if (p.box && p.bend !== null)
      throw new BlobError(
        'bend= is not supported on a box — sdRoundBox has no bent form; use a '
        + 'chain of boxes at the inflections, or drop `box`',
        p.src.line, p.src.indent + 1);
    if (p.box && p.radiusB !== null)
      throw new BlobError(
        'r2= is not supported on a box — a box does not taper; use two boxes, '
        + 'or drop `box` for a round cone', p.src.line, p.src.indent + 1);
    // A shell thins a CLOSED base field to a sheet; sdShellWrap takes that
    // base from the capsule path. Boxing the base is a shape nobody has asked
    // for and the spec puts out of scope, so it fails rather than silently
    // producing a boxed sheet nobody designed.
    if (p.box && p.kind === 'shell')
      throw new BlobError(
        'box is not supported on a shell — a shell thins a closed capsule; '
        + 'drop one of the two', p.src.line, p.src.indent + 1);
    if (p.box && p.tip !== null)
      throw new BlobError(
        'tip= is not supported on a box — its far end is the segment end; move '
        + 'the whole prim with offset=', p.src.line, p.src.indent + 1);
    // Deliberately NOT a clamp: above 1 the inset extent goes negative and the
    // field inverts, and a silent clamp would hide a typo in a character file.
    if (p.box && (p.round < 0 || p.round > 1))
      throw new BlobError(
        `round= must be between 0 and 1 (a fraction of r), got ${p.round}`,
        p.src.line, p.src.indent + 1);
```

Then in the returned object literal, after the `shell` spread:

```ts
      ...(p.box ? { box: { round: p.round } } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/blob-compile.test.ts -t "box rejections"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/blob-compile.ts src/lab/sdf-zombie/blob-compile.test.ts
git commit -m "blob: reject bend/r2/tip on a box, and round= outside 0..1"
```

---

### Task 3: The CPU field

**Files:**
- Modify: `src/lab/sdf-zombie/validate.ts:57-110` (`sdPrimitive`)
- Modify: `src/lab/sdf-zombie/resolve.ts:97`
- Test: `src/lab/sdf-zombie/validate.test.ts`

`sdPrimitive` backs click-to-shoot, so it must match the shader exactly. Task 6 asserts that.

- [ ] **Step 1: Write the failing test**

Add to `src/lab/sdf-zombie/validate.test.ts`:

```ts
describe('sdPrimitive box', () => {
  const base = { a: [0, 0, 0], b: [0, 0, 0], scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, radius: 0.1 } as const;
  const boxAt = (round: number) => ({ ...base, box: { round } }) as unknown as Primitive;

  it('round=1 is exactly the capsule', () => {
    const cap = { ...base } as unknown as Primitive;
    for (const p of [[0.2, 0, 0], [0, 0.15, 0.1], [0.05, 0.05, 0.05]] as Vec3[])
      expect(sdPrimitive(p, boxAt(1))).toBeCloseTo(sdPrimitive(p, cap), 6);
  });

  it('reaches r along an axis regardless of round', () => {
    // On an axis the inset exactly cancels: extent (1-round)*r plus rounding
    // round*r is r, so the surface sits at r for every round.
    for (const round of [0, 0.08, 0.5, 1])
      expect(sdPrimitive([0.1, 0, 0], boxAt(round))).toBeCloseTo(0, 6);
  });

  it('a sharp corner sits r*(sqrt3-1) outside the capsule on the diagonal', () => {
    // The far corner of a cube of half-extent r is at r*sqrt(3). At round=0
    // the box surface reaches it, where the capsule stopped at r.
    const k = 0.1 * Math.sqrt(3);
    const corner: Vec3 = [k / Math.sqrt(3), k / Math.sqrt(3), k / Math.sqrt(3)];
    expect(sdPrimitive(corner, boxAt(0))).toBeCloseTo(0, 6);
    expect(sdPrimitive(corner, { ...base } as unknown as Primitive)).toBeCloseTo(0.1 * (Math.sqrt(3) - 1), 6);
  });

  it('leaves a non-box primitive bit-identical', () => {
    const cap = { ...base, radius: 0.07, scale: [1.3, 0.8, 1.1] } as unknown as Primitive;
    expect(sdPrimitive([0.2, 0.1, 0], cap)).toBe(sdPrimitive([0.2, 0.1, 0], { ...cap }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t "sdPrimitive box"`
Expected: FAIL — the box is ignored, so every box case returns the capsule distance.

- [ ] **Step 3: Add `sdRoundBox` and the branch**

In `src/lab/sdf-zombie/validate.ts`, add above `sdPrimitive`:

```ts
/**
 * Rounded box. `e` is the half-extent BEFORE rounding and `r` the corner
 * radius; the caller insets `e` by `r` so the total half-extent is unchanged.
 * Mirrors sdRoundBox in march.wgsl.ts exactly — edit both in the same commit
 * or click-to-shoot drifts from what is drawn.
 */
function sdRoundBox(p: Vec3, e: Vec3, r: number): number {
  const qx = Math.abs(p[0]) - e[0];
  const qy = Math.abs(p[1]) - e[1];
  const qz = Math.abs(p[2]) - e[2];
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
    + Math.min(Math.max(qx, qy, qz), 0) - r;
}
```

In `sdPrimitive`, replace the `let base: number;` block's leading branch so the box is tested FIRST:

```ts
  let base: number;
  // BOX FIRST: bend= and r2= are both rejected on a box at compile time, so a
  // box can never reach the bent or tapered branches below — testing it first
  // states that, and keeps the capsule paths textually untouched.
  if (prim.box) {
    // Half-extents are `radius` in the SCALE-DIVIDED frame, which is
    // `radius * scale` in world — the same semi-axes a capsule gets.
    const e = prim.radius * (1 - prim.box.round);
    base = sdRoundBox(sub(q, closest), [e, e, e], prim.radius * prim.box.round) * minScale;
  } else if (cv !== undefined) {
```

(The remaining `else if` / `else` arms are unchanged — only the first `if (cv !== undefined) {` becomes `} else if (cv !== undefined) {`.)

- [ ] **Step 4: Carry `box` through resolve**

In `src/lab/sdf-zombie/resolve.ts`, beside the existing shell carry at line 97:

```ts
      ...(p.box === undefined ? {} : { box: p.box }),
```

`mirror.ts` needs NO change: a box holds no vector to reflect, so the existing `...rest` spread carries it, unlike `shell`'s `clipNormal`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts -t "sdPrimitive box"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/resolve.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "blob: sdRoundBox in the CPU field, carried through resolve"
```

---

### Task 4: Outer bounds — the culling-risk task

**Files:**
- Modify: `src/lab/sdf-zombie/extent.ts` (add `boxReach`, use at line 20)
- Modify: `src/lab/sdf-zombie/clusters.ts:56`
- Modify: `src/lab/sdf-zombie/pack.ts:307`
- Modify: `src/lab/sdf-zombie/webgpu/shell-hull-outer.ts:153`
- Test: `src/lab/sdf-zombie/extent.test.ts`

A box's corner is further from the segment than a capsule's surface. Exactly: in the scale-divided frame the corner sits at `√3·r·(1−round) + r·round`, so the reach multiplier is `√3(1−round) + round` — exact, and tighter than a blanket √3.

**`occluder-hull.ts` is deliberately NOT in this list.** It builds an INNER hull from inscribed spheres, and a rounded box strictly CONTAINS the capsule of the same semi-axes (they touch on the axes; the box is further out everywhere else). Spheres sized for the capsule remain inside the box, so the existing sizing stays valid and conservative.

- [ ] **Step 1: Write the failing test**

Add to `src/lab/sdf-zombie/extent.test.ts`:

```ts
describe('boxReach', () => {
  it('is 1 for a capsule', () => {
    expect(boxReach(undefined)).toBe(1);
  });

  it('is sqrt(3) for a dead-sharp box and 1 for a fully round one', () => {
    expect(boxReach({ round: 0 })).toBeCloseTo(Math.sqrt(3), 9);
    expect(boxReach({ round: 1 })).toBeCloseTo(1, 9);
  });

  it('interpolates linearly between them', () => {
    expect(boxReach({ round: 0.5 })).toBeCloseTo((Math.sqrt(3) + 1) / 2, 9);
  });
});

it('chunkExtent contains a sharp box corner', () => {
  const p = { a: [0, 0, 0], b: [0, 0, 0], radius: 0.1, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, box: { round: 0 } } as unknown as Primitive;
  // The corner is at 0.1*sqrt(3) ~ 0.1732 from the origin.
  expect(chunkExtent([p], [0, 0, 0])).toBeGreaterThanOrEqual(0.1 * Math.sqrt(3) - 1e-9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/extent.test.ts -t box`
Expected: FAIL — `boxReach` is not exported; `chunkExtent` returns 0.1.

- [ ] **Step 3: Add the shared helper**

In `src/lab/sdf-zombie/extent.ts`, above `chunkExtent`:

```ts
/**
 * How far a primitive's surface reaches from its segment, in units of
 * `radius`. A capsule reaches exactly `radius` in every direction, so 1; a
 * rounded box reaches its CORNER, at `sqrt(3)*r*(1-round) + r*round` in the
 * scale-divided frame.
 *
 * ONE function, used by every outer bound in the codebase (chunkExtent,
 * assignClusters, fitSphere, shell-hull-outer), because four copies of this
 * arithmetic is four chances to miss one — and an outer bound that
 * under-covers a box does not draw a wrong shape, it CULLS, which presents as
 * a round see-through hole and sends you hunting in webgpu/ for a bug that is
 * here. Note this is the opposite risk from occluder-hull.ts, which builds an
 * INNER hull and needs no change: a rounded box strictly contains the capsule
 * of the same semi-axes.
 */
export function boxReach(box: { round: number } | undefined): number {
  if (box === undefined) return 1;
  return Math.sqrt(3) * (1 - box.round) + box.round;
}
```

Then at line 20, change:

```ts
    const rMax = Math.max(p.radius, p.radiusB ?? p.radius);
```

to:

```ts
    const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box);
```

- [ ] **Step 4: Apply the same multiplier at the other three sites**

`src/lab/sdf-zombie/clusters.ts:56` — import `boxReach` from `./extent` and change:

```ts
      const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box);
```

`src/lab/sdf-zombie/pack.ts:307` — import `boxReach` from `./extent` and change the `reach` expression to:

```ts
    const reach = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box) * Math.max(p.scale[0], p.scale[1], p.scale[2])
      + (p.shell ? p.shell.thickness : 0);
```

`src/lab/sdf-zombie/webgpu/shell-hull-outer.ts:153` — import `boxReach` from `../extent` and change:

```ts
      const rMax = Math.max(p.radius, p.radiusB ?? p.radius) * boxReach(p.box);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/extent.test.ts -t box`
Expected: PASS, 4 tests.

Run: `npx vitest run src/lab/sdf-zombie/`
Expected: PASS, no regressions — `boxReach` returns exactly 1 for every existing primitive, so no bound moves.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/extent.ts src/lab/sdf-zombie/clusters.ts src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/webgpu/shell-hull-outer.ts src/lab/sdf-zombie/extent.test.ts
git commit -m "blob: one boxReach helper for all four outer bounds

A box's corner reaches sqrt(3)*r*(1-round) + r*round from its segment, past
where a capsule's surface stops. An outer bound that under-covers it CULLS
rather than drawing a wrong shape. occluder-hull.ts is untouched on purpose:
it is an INNER hull, and a box contains the capsule of the same semi-axes."
```

---

### Task 5: Pack encoding

**Files:**
- Modify: `src/lab/sdf-zombie/pack.ts:158-184`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts:41-45` (the stale header comment)
- Test: `src/lab/sdf-zombie/pack.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lab/sdf-zombie/pack.test.ts`:

```ts
describe('box packing', () => {
  const pack1 = (extra: Record<string, unknown>) => {
    const prim = { a: [0, 0, 0], b: [0, 0.2, 0], radius: 0.05, scale: [1, 1, 1], blendK: 0, limb: 'torso', cluster: 0, ...extra } as unknown as Primitive;
    return packBody({ prims: [prim], clusters: [{ id: 0, start: 0, count: 1 }] } as unknown as BuiltBody);
  };

  it('sets prof bit 3 (value 8) for a box', () => {
    const p = pack1({ box: { round: 0.2 } });
    expect(Math.floor(p.primShape[1]!) & 8).toBe(8);
  });

  it('puts round in primBend.w', () => {
    const p = pack1({ box: { round: 0.2 } });
    expect(p.primBend[3]).toBeCloseTo(0.2, 6);
  });

  it('composes with chamfer without disturbing the low bits', () => {
    const p = pack1({ box: { round: 0.2 }, blendProfile: 'chamfer' });
    expect(Math.floor(p.primShape[1]!)).toBe(9); // 8 | 1
  });

  it('leaves prof and primBend.w untouched on a non-box prim', () => {
    const p = pack1({});
    expect(Math.floor(p.primShape[1]!) & 8).toBe(0);
    expect(p.primBend[3]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/pack.test.ts -t "box packing"`
Expected: FAIL — bit 3 is never set; `primBend[3]` is 0.

- [ ] **Step 3: Encode it**

In `src/lab/sdf-zombie/pack.ts`, change the `prof` line and the `primBend.set` call:

```ts
    // y = fold profile. 0 round, 1 chamfer, 2 round+bent, 3 chamfer+bent;
    // a SHELL adds bit 2 (value 4) so straight=4, bent=6; a BOX adds bit 3
    // (value 8). The shader folds any prof >= 4 as a shell and reads the shell
    // rows; the low bits still mean chamfer/bend for the non-shell range and
    // are ignored on a shell.
    const prof = (p.blendProfile === 'chamfer' ? 1 : 0) + bent + (p.shell ? 4 : 0) + (p.box ? 8 : 0);
    // primBend.w carries a BOX's corner-rounding fraction. Safe to share the
    // row: the shader reads ROW_PRIM_BEND only when prof & 2, and `bend=` on a
    // box is rejected at compile time, so a box never sets that bit and the
    // xyz are never fetched for it. The w component is unread in every other
    // case — the shader loads this row as .xyz.
    primBend.set(p.bend === undefined
      ? [0, 0, 0, p.box ? p.box.round : 0]
      : [...bendCtrl(p.a, p.b, p.bend), 0], o);
```

- [ ] **Step 4: Correct the stale header comment**

In `src/lab/sdf-zombie/webgpu/march.wgsl.ts`, replace the row 10/11 lines of the layout comment:

```
//   row 10 primShape    x = radius at endpoint B (NEGATIVE = untapered),
//                       y = fold profile (0 round, 1 chamfer,
//                       2 round+BENT, 3 chamfer+BENT, +4 SHELL, +8 BOX),
//                       zw = groove depth and width
//   row 11 primBend     xyz = quadratic Bezier control point (world space),
//                       w = a BOX's corner-rounding fraction (see pack.ts;
//                       the two never coexist — bend= on a box is rejected)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/pack.test.ts -t "box packing"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/pack.test.ts
git commit -m "blob: pack the box as prof bit 3, round in primBend.w

Also corrects the row 10 header comment: zw were never spare, pack.ts has
written the groove's depth and width there since the groove landed."
```

---

### Task 6: The GPU field, and CPU/GPU parity

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (add `SD_ROUND_BOX`, branch in `sdPrim`/`sdPrimO`)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`:

```ts
describe('box in the shader', () => {
  it('defines sdRoundBox', () => {
    expect(SD_ROUND_BOX).toContain('fn sdRoundBox');
  });

  it('branches on prof bit 3 before the bent and tapered paths', () => {
    const src = SD_PRIM;
    const box = src.indexOf('& 8');
    const bent = src.indexOf('& 2');
    expect(box).toBeGreaterThan(-1);
    expect(bent).toBeGreaterThan(-1);
    expect(box).toBeLessThan(bent);
  });

  it('reads the rounding fraction from primBend.w', () => {
    expect(SD_PRIM).toContain(`${ROW_PRIM_BEND}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "box in the shader"`
Expected: FAIL — `SD_ROUND_BOX` is not exported.

- [ ] **Step 3: Add the WGSL**

In `src/lab/sdf-zombie/webgpu/march.wgsl.ts`, beside the other `sd*` helpers:

```ts
// Rounded box — the exact CPU mirror of sdRoundBox in validate.ts. `e` is the
// half-extent BEFORE rounding; the caller insets it by `r` so total half-extent
// is unchanged. Edit both in the same commit or click-to-shoot drifts from
// what is drawn.
export const SD_ROUND_BOX = /* wgsl */ `fn sdRoundBox(p: vec3<f32>, e: vec3<f32>, r: f32) -> f32 {
  let q = abs(p) - e;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}`;
```

Register it in the same module list that already assembles `CONE_BEND`, `SMIN` and friends into the shader source.

In `sdPrim` (and `sdPrimO`, which shares the tail), insert the box branch immediately BEFORE the bent branch at the end of the function:

```wgsl
  // BOX before BENT: bend= is rejected on a box at compile time, so the two
  // never coexist; testing box first means the bend row is never fetched for
  // one, which is what makes sharing primBend.w safe.
  if ((i32(prof) & 8) != 0) {
    let t = clamp(dot(qq - a, b - a) / max(dot(b - a, b - a), 1e-12), 0.0, 1.0);
    let closest = a + (b - a) * t;
    let round = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND}), 0).w;
    let e = A.w * (1.0 - round);
    return sdRoundBox(qq - closest, vec3<f32>(e), A.w * round) * minScale;
  }
  if ((i32(prof) & 2) != 0) { return coneBend(qq, a, b, c * inv, A.w, r2, minScale); }
  return coneCap(qq, a, b, A.w, r2, minScale);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "box in the shader"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run src/lab/sdf-zombie/`
Expected: PASS, no regressions.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "blob: sdRoundBox in the shader, mirroring the CPU field"
```

---

### Task 7: End-to-end — a real character file, and the renderer agreeing

**Files:**
- Create: `src/lab/sdf-zombie/characters/box-fixture.blob` (a throwaway two-prim body)
- Test: `src/lab/sdf-zombie/blob-box-e2e.test.ts`

The unit tests prove each layer. This proves the layers agree, which is the failure mode the skill's triage table is mostly about.

- [ ] **Step 1: Write the fixture**

Create `src/lab/sdf-zombie/characters/box-fixture.blob`:

```
name box-fixture
height 1.0

skeleton
  root pelvis
  bone spine parent=pelvis dir=up len=0.40

body
  # A machined slab and a soft one on the same bone: the pair exercises both
  # ends of the `round` sweep in one field.
  bar torso on spine from=0.10 to=0.60 r=0.060 wide=1.30 deep=0.80 box round=0.05 blend=0.010 core
  blob torso on spine at=0.75 r=0.070 box round=0.40 blend=0.010
```

- [ ] **Step 2: Write the failing test**

Create `src/lab/sdf-zombie/blob-box-e2e.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import { sdBody, validateBody } from './validate';
import { emitBlob } from './blob-emit';

const src = readFileSync('src/lab/sdf-zombie/characters/box-fixture.blob', 'utf8');
const body = buildBody(compileBlob(parseBlob(src)));

describe('box end to end', () => {
  it('validates as a closed, connected body', () => {
    expect(() => validateBody(body, { silhouetteNoiseAmp: 0, stepMultiplier: 1 })).not.toThrow();
  });

  it('the slab has FLAT sides — the surface sits at the same x across its span', () => {
    // A capsule's half-width falls off toward its caps; a box's does not.
    const at = (y: number) => {
      let lo = 0, hi = 0.5;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (sdBody([mid, y, 0], body) < 0) lo = mid; else hi = mid;
      }
      return lo;
    };
    const a = at(0.12), b = at(0.20);
    expect(Math.abs(a - b)).toBeLessThan(0.002);
  });

  it('round-trips through the emitter byte-for-byte', () => {
    expect(emitBlob(parseBlob(src))).toBe(src);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/blob-box-e2e.test.ts`
Expected: FAIL on the flat-sides assertion if any layer is wrong; PASS only when parse, compile, resolve, bounds and the CPU field all agree.

- [ ] **Step 4: Fix whatever it catches, then re-run**

Run: `npx vitest run src/lab/sdf-zombie/blob-box-e2e.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm the RENDERER agrees with the field**

Register `box-fixture` in `src/lab/sdf-zombie/webgpu/lab-main.ts` — a
`?raw` import beside the others at line ~50, and an entry in the source map at
line ~70, exactly as `bonewalker` is registered. Then:

Run: `npm run blob:render-check -- box-fixture`
Expected: exit 0 — "the renderer agrees with the field". Exit 1 names hole clusters and their owning line, and means the WGSL and the CPU field disagree: go back to Task 6. Exit 2 means it could not run.

- [ ] **Step 6: Look at it**

Run: `npm run blob:shot -- box-fixture`
Then `Read` `/tmp/blob-shot/box-fixture/frame-00.png` and `frame-02.png`.
Expected: a slab with visibly FLAT faces and crisp vertical edges, and a soft-cornered blob above it. If the slab reads as a lozenge, the box branch is not being taken — check `prof` bit 3 survived packing.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/characters/box-fixture.blob src/lab/sdf-zombie/blob-box-e2e.test.ts
git commit -m "blob: end-to-end box fixture — parse to render-check"
```

---

### Task 8: Document the primitive

**Files:**
- Modify: `.claude/skills/authoring-sdf-characters/reference.md`

The skill file is where the next author (or dispatched agent) will look. A primitive nobody knows about does not exist.

- [ ] **Step 1: Add a section**

In `.claude/skills/authoring-sdf-characters/reference.md`, after the "Curved primitives: `bend=`" section:

```markdown
## Hard surface: the bare word `box`

Every primitive was a capsule or round cone until 2026-09-02, which ruled out
a FLAT FACE. `chamfer` bevels the fold BETWEEN two prims; the prim itself still
had round ends, so a machined plate read as a lozenge. `box` sweeps a rounded
BOX along the segment instead:

```
bar leg on shin from=0.18 to=0.86 r=0.055 wide=1.35 deep=0.80 box round=0.10 color=8d9299
blob leg on knee at=0.50 r=0.070 box round=0.22 chamfer color=6f747b
```

`blob ... box` is a cube; `bar ... box` is a slab — the same point/segment
duality as everywhere else.

- **Half-extents are `r × wide/tall/deep`** — the SAME world semi-axes a
  capsule gets. That is deliberate: `blob:rings` measures semi-axes, so its
  suggestions stay meaningful on a box with no change to the fitter.
- **`round=` is a FRACTION of `r`, 0..1, default 0.08** — not metres. The field
  is evaluated in the scale-divided frame, where an absolute length would come
  out anisotropically distorted on any part with unequal `wide/tall/deep`.
  It is INSET, so raising it softens the corner without growing the part.
  `round=0.05` reads machined; `round=1` is exactly the capsule.
- **A box extends past its endpoints, exactly as a capsule does** — it reaches
  its half-extent beyond A and B along the axis. Surprising for a box, but it
  keeps `from=`/`to=` meaning what it already means.

Rejected, loudly: `bend=`, `r2=` and `tip=` on a box (no bent, tapered or
tip-displaced form of `sdRoundBox`), and `round=` outside 0..1 (above 1 the
inset extent goes negative and the field inverts — a clamp would hide a typo).

Still missing, and known: **`carve` is head-only**, so you cannot bore a socket
or cut a vent slot into a plate. And `gloss=` pulls toward a WET highlight,
which is a flesh cue — there is no metalness. Both are deliberate gaps; raise
them rather than routing around them.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/authoring-sdf-characters/reference.md
git commit -m "skill: document the box primitive and the two gaps it leaves"
```

---

### Task 9: Hand off the character

**Files:**
- Create: `docs/superpowers/plans/2026-09-02-minotaur-character.md`

The box exists; the character is the next plan. Write it from
`docs/dev-notes/dispatch-character-task-template.md` **verbatim** — a dispatched
agent that improvises its own loop is how the last several characters drifted.

- [ ] **Step 1: Fill the template**

Use the template's exact structure. The `WHAT IS ALREADY ESTABLISHED` section is
non-negotiable and comes from the spec — restate it rather than making the agent
re-derive it:

- reference: `docs/dev-notes/refs/minotaur-mesh/minotaur.glb` (committed — verify with `git ls-files`)
- rig `meshy-biped`, 24 joints; 135,942 verts, 21,657 dropped; bind height 1.217 m
- coverage 72.5% reach a measurable bone
- the cyber leg is the character's RIGHT (`shin.r` 18,032 verts vs `shin.l` 6,724)
- reference bone lengths, from the spec's table
- **use `blob:rings`, not `blob:measure`** — the reference stands in a wide
  semi-crouch, so a whole-figure raster score is POSE MISMATCH by construction
- **`blob:rings` is paint-blind** — it will ask for the prosthetic plates to
  shrink, exactly as it did for bonewalker's painted spine ridge. Overrule it
  there and judge those by render.
- the face is a baked decal (`npm run blob:face-bake -- minotaur`), never painted prims
- `base_branch` must be the branch carrying the box primitive AND the reference commit
- `model: zai/glm-5.3-flash` — it HAS native vision (`input: ["text","image"]`),
  so the agent `Read`s the reference and its own turntable frames DIRECTLY.
  Do NOT copy the old vision-sidecar paragraph into the task: telling a
  sighted model that `Read` shows it nothing wastes the best signal it has.
  The template was corrected for this on 2026-09-02.
- **use the box primitive** for the prosthetic leg's plates — that is what it
  was built for, and this is its first real character

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-09-02-minotaur-character.md
git commit -m "plan: minotaur character authoring, from the dispatch template"
```

---

## Done when

- `npx vitest run src/lab/sdf-zombie/` green, no regressions against the 1930-test baseline
- `npx tsc --noEmit` clean
- `npm run blob:render-check -- box-fixture` exits 0
- Frames in `/tmp/blob-shot/box-fixture/` show flat faces and crisp edges
- `boxReach` is used at all four outer-bound sites and nowhere else
- The stale `zw spare` comment in `march.wgsl.ts` is corrected
