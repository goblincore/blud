# Blobforge draft + depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two tools — `blob:depth` (see inside the outline) and `blob:draft` (generate a refineable body from a skinned reference mesh).

**Architecture:** Both extend existing machinery rather than adding new. `blob:depth` turns on a per-pixel depth buffer in `silhouette.ts`'s two rasters — the sphere-trace already computes the hit distance and discards it — and diffs where both subjects are occupied. `blob:draft` reads the reference through the existing `ref-skin`/`ref-align` path, takes bone axes from each bone's vertex cloud rather than from rig joints (joints sit 9-13 cm off the skin), bands each bone at radial-profile inflections, and emits `.blob` text with a `# fit:` comment on every number.

**Tech Stack:** TypeScript, vitest, tsx.

**Spec:** [`docs/superpowers/specs/2026-09-02-blobforge-draft-and-depth-design.md`](../specs/2026-09-02-blobforge-draft-and-depth-design.md)

---

## Read before starting

**Baseline: `npx vitest run src/lab/sdf-zombie/` is green at 2121 tests / 108 files on `claude/blob-side-grammar`.** Confirm before you start; every task states its expected new count.

Facts verified against the code on 2026-09-02 — do not re-derive:

1. **`bodyRaster` already computes the depth and throws it away.** In `silhouette.ts`, the march loop carries `t` at the moment of hit and does `if (hit) bits[py * w + px] = 1`. `t` *is* the depth. This is why Tool B is an extension, not new machinery.
2. **View conventions are fixed and documented:** `front: u = world x, depth = z`; `side: u = world z, depth = x`. `frameOf` returns `{ w, h, u0, spanU, maxY, spanY, dMin, dMax }`.
3. **`normalise(mask, outW, outH)` maps a subject to its own bounding box**, which is what makes a comparison about proportion rather than size or position in frame.
4. **The primitive budget.** `MAX_PRIMS` 128 and `MAX_CLUSTERS` 6 error in `validateBody`. **`MAX_CLUSTER_PRIMS` 64 is silent** — `march.wgsl.ts` folds with a fixed `for (var i = 0; i < 64)` and past that quietly stops folding and loses geometry. Shipped characters run 23-67 prims with a worst cluster of 5-27, so nothing uses half of either.
5. **`dirVector`'s pitch is a no-op for `side`/`fwd` bases** (`side` has `y0 = 0`, so `sign(y0) = 0`). Angles for those bones are NOT derivable and must not be emitted as numbers.
6. **`Head`, `LeftHand` and `RightHand` are UNMAPPED by `MESHY_BIPED`.** Measured on `minotaur.glb`: `groupByBone` returns them in `unmapped` (7,354 / 4,286 / 4,075 verts) rather than in `byBone`, because no `.blob` bone claims them. So the head and hand masses in Task 9 **cannot come from `groupByBone`** — they must read those clouds out of `Grouped.unmapped`'s joints directly, via the rig's joint names. Task 8 builds that; do not discover it in Task 9.

**Build Tool B first.** It is smaller and `minotaur.blob` on `dispatch/minotaur-character` is a real failing test case for it — a character whose torso is a featureless blob that passed every existing check.

---

# PHASE 1 — `blob:depth`

### Task 1: Per-pixel depth out of the body raster

**Files:**
- Modify: `src/lab/sdf-zombie/silhouette.ts` (`BodyMaskOpts`, `bodyRaster`, and a new export)
- Test: `src/lab/sdf-zombie/silhouette.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lab/sdf-zombie/silhouette.test.ts`, matching that file's existing body-construction idiom:

```ts
describe('depthFromBody', () => {
  it('returns a depth for every occupied pixel and NaN elsewhere', () => {
    const body = /* a simple two-prim body, per this file's existing helpers */;
    const { mask, depth } = depthFromBody(body, { view: 'front', heightPx: 64 });
    expect(depth.length).toBe(mask.w * mask.h);
    let occupied = 0;
    for (let i = 0; i < depth.length; i++) {
      if (mask.bits[i]) { occupied++; expect(Number.isFinite(depth[i]!)).toBe(true); }
      else expect(Number.isNaN(depth[i]!)).toBe(true);
    }
    expect(occupied).toBeGreaterThan(0);
  });

  it('depth increases with distance from the camera', () => {
    // Two spheres at different z on the front view: the further one's pixels
    // must carry a larger depth than the nearer one's.
    const body = /* near sphere at z=0, far sphere at z=+0.3, no overlap in x */;
    const { mask, depth } = depthFromBody(body, { view: 'front', heightPx: 64 });
    // sample a column through each and compare
  });

  it('leaves maskFromBody bit-identical', () => {
    const body = /* any body */;
    const a = maskFromBody(body, { view: 'front', heightPx: 48 });
    const b = depthFromBody(body, { view: 'front', heightPx: 48 }).mask;
    expect(Array.from(b.bits)).toEqual(Array.from(a.bits));
  });
});
```

Fill in the bodies from the helpers that file already uses. The third test is the important one — it is the guarantee that this change cannot move any existing silhouette score.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/silhouette.test.ts -t depthFromBody`
Expected: FAIL — `depthFromBody` is not exported.

- [ ] **Step 3: Add the depth buffer**

In `bodyRaster`, allocate alongside `bits` and fill on hit:

```ts
  const bits = new Uint8Array(w * h);
  // Depth of the hit, in the view's depth axis (front: world z, side: world x).
  // NaN where the ray missed. The march already computes this and threw it
  // away — a silhouette only asks "is anything here" (see this file's header),
  // so nothing needed it until blob:depth.
  const depth = new Float32Array(w * h).fill(NaN);
```

and in the march loop, replace `if (hit) bits[py * w + px] = 1;` with:

```ts
      if (hit) { bits[py * w + px] = 1; depth[py * w + px] = t; }
```

Return `depth` from `bodyRaster` alongside `mask` and `frame`. **`maskFromBody` keeps its exact current signature and behaviour** — it just ignores the new field.

Note the kit: `rasterTriangles(bits, kit, f)` unions the kit into `bits` AFTER the march, so kit pixels get occupancy but no depth. Fill those with NaN and **document it** — a kit is a polygon overlay with no field behind it, and the diff must skip those pixels rather than treat NaN as zero.

Then export:

```ts
export interface BodyDepth { mask: Mask; depth: Float32Array; frame: Frame }

/**
 * Body raster WITH the per-pixel hit depth the silhouette path discards.
 * `depth` is NaN wherever the mask is 0, and also wherever a KIT triangle
 * supplied the pixel — a kit is a polygon overlay with no field behind it.
 */
export function depthFromBody(body: BuiltBody, opts: BodyMaskOpts = {}): BodyDepth { … }
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/silhouette.test.ts -t depthFromBody`
Expected: PASS, 3 tests.

Run: `npx vitest run src/lab/sdf-zombie/`
Expected: 2124 passing / 108 files. **Any change to an existing silhouette score is a regression** — the third test exists to catch it.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/silhouette.ts src/lab/sdf-zombie/silhouette.test.ts
git commit -m "silhouette: keep the hit depth the body raster already computed"
```

---

### Task 2: Per-pixel depth out of the triangle raster

**Files:**
- Modify: `src/lab/sdf-zombie/silhouette.ts` (`rasterTriangles` / `maskFromTriangles`)
- Test: `src/lab/sdf-zombie/silhouette.test.ts`

The reference side. Unlike the sphere-trace this needs a real **z-buffer**: triangles arrive in arbitrary order, so the nearest must win per pixel.

- [ ] **Step 1: Write the failing test**

```ts
describe('depthFromTriangles', () => {
  it('keeps the NEAREST surface when two triangles overlap', () => {
    // Two axis-aligned quads (2 tris each) at different z, fully overlapping in
    // x/y. Whichever is nearer the camera must own every shared pixel,
    // REGARDLESS of the order they appear in the array — build it twice with
    // the order swapped and assert the same depth both times.
  });

  it('is NaN off the subject', () => { … });

  it('leaves maskFromTriangles bit-identical', () => { … });
});
```

The order-swap assertion is the point: without a z-buffer the last triangle wins and the test passes only by luck of ordering.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/silhouette.test.ts -t depthFromTriangles`

- [ ] **Step 3: Implement**

Add a depth-aware variant of the triangle rasteriser. Interpolate the depth-axis coordinate barycentrically across each triangle and keep the nearest per pixel — `scripts/blob-face-bake.py` already does exactly this (its `zb` buffer and the `zz > sub` test); port that logic, do not invent a new one.

`maskFromTriangles` keeps its current signature and output.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lab/sdf-zombie/silhouette.test.ts -t depthFromTriangles` — PASS
Run: `npx vitest run src/lab/sdf-zombie/` — 2127 passing, no regressions

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/silhouette.ts src/lab/sdf-zombie/silhouette.test.ts
git commit -m "silhouette: z-buffered depth for the triangle raster"
```

---

### Task 3: The diff, and attribution to a `.blob` line

**Files:**
- Create: `src/lab/sdf-zombie/depth-diff.ts`
- Test: `src/lab/sdf-zombie/depth-diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('diffDepth', () => {
  it('reports zero error when a body is compared against itself', () => {
    // Same body both sides -> every both-occupied pixel has 0 difference.
  });

  it('IGNORES pixels occupied by only one side', () => {
    // A pixel the body fills and the reference does not must NOT contribute:
    // that is a silhouette difference, which blob:measure reports better.
    // Build a case with a deliberate outline mismatch and assert the reported
    // error is driven only by the overlap region.
  });

  it('catches a surface difference the SILHOUETTE cannot see', () => {
    // THE POINT OF THE WHOLE TOOL. Two bodies with the SAME outline and
    // different depth: e.g. a flat slab vs a domed one of equal extent.
    // Assert the silhouette IoU is ~1 while diffDepth reports a real error.
  });
});
```

That third test is the tool's reason to exist — write it first and make sure it fails for the right reason.

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement `diffDepth`**

```ts
export interface DepthDiffOpts { view?: 'front' | 'side'; heightPx?: number }

export interface DepthDiffBand {
  /** Fraction of subject height, 0 = crown. */
  y0: number; y1: number;
  /** Mean |body - reference| depth over both-occupied pixels, in metres. */
  meanErr: number;
  /** Signed mean: positive = the body sits NEARER the camera than the mesh. */
  signedErr: number;
  /** Both-occupied pixel count. A band with few is not evidence. */
  samples: number;
  /** The .blob line owning most of this band's error, via bandOwners. */
  owner?: { line: number; label: string };
}
```

Normalise both to a common raster with the existing `normalise` so the comparison is about proportion. Diff only where **both** masks are 1 and both depths are finite. Report per band, worst first, and attribute the owner using the existing `bandOwners`.

- [ ] **Step 4: Verify** — `npx vitest run src/lab/sdf-zombie/depth-diff.test.ts` PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/depth-diff.ts src/lab/sdf-zombie/depth-diff.test.ts
git commit -m "depth-diff: compare surfaces where the outlines agree"
```

---

### Task 4: The `blob:depth` CLI, and run it on the failing minotaur

**Files:**
- Create: `scripts/blob-depth.ts`
- Modify: `package.json` (`"blob:depth": "tsx scripts/blob-depth.ts"`)

- [ ] **Step 1: Write the CLI**

Mirror `scripts/blob-rings.ts`'s conventions exactly — same reference resolution (`--glb`, else `docs/dev-notes/refs/<name>-mesh/<name>.glb`, else first `.glb` with a stderr warning), same **exit codes: 0 whenever it RAN however bad the numbers, 2 for "did not run"**. Print the `=== mesh <path>` header line the other tools print.

Output both views, worst bands first, each naming its owning line.

- [ ] **Step 2: Run it on a character that is known-good**

```bash
npm run blob:depth -- schoolgirl
```

Expected: exit 0, modest errors. This is the control.

- [ ] **Step 3: Run it on the KNOWN-BAD minotaur**

```bash
git show dispatch/minotaur-character:src/lab/sdf-zombie/characters/minotaur.blob > /tmp/minotaur.blob
# author it into the tree however the CLI needs, then:
npm run blob:depth -- minotaur
```

**This is the acceptance test for the whole phase.** The minotaur's torso is a featureless blob against a heavily muscled reference, and it passed every existing check. If `blob:depth` does NOT report a large torso error here, the tool does not work — report that rather than tuning thresholds until it looks right.

Record the numbers in `docs/dev-notes/2026-09-02-blobforge-depth/notes.md` alongside what `blob:measure` and `blob:rings` said about the same character, so the contrast is on record.

- [ ] **Step 4: Commit**

```bash
git add scripts/blob-depth.ts package.json docs/dev-notes/2026-09-02-blobforge-depth/
git commit -m "blob:depth — the instrument that sees inside the outline"
```

---

# PHASE 2 — `blob:draft`

Phase 2 is independent of Phase 1. Each task below builds one measurement; Task 9 assembles them into `.blob` text.

### Task 5: Bone axis from the vertex cloud, not the rig

**Files:**
- Create: `src/lab/sdf-zombie/draft-fit.ts`
- Test: `src/lab/sdf-zombie/draft-fit.test.ts`

**This is the task the whole tool's credibility rests on.** Rig joints sit 9-13 cm off the skin; a draft built on them is subtly wrong everywhere, which is worse than hand-authoring because it is plausible and undebuggable.

- [ ] **Step 1: Write the failing test**

```ts
describe('medialLine', () => {
  it('recovers the axis of a synthetic cylinder', () => {
    // Generate points on a cylinder along a known, non-axis-aligned direction.
    // Assert the fitted direction matches to within a degree and the extent
    // matches the cylinder's length.
  });

  it('is NOT the joint-to-joint line when the cloud is offset from it', () => {
    // The trap, as a test. Build a cloud whose centroid sits 0.10 away from a
    // supplied "joint" line; assert the fit follows the CLOUD.
  });

  it('reports a large residual for a curved cloud', () => {
    // A banana-shaped cloud. A straight line cannot fit it, and the residual
    // is how the draft tells an author that bone wants a `bend=` it cannot
    // emit. Assert the residual is materially larger than the cylinder's.
  });
});
```

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

```ts
export interface MedialLine {
  /** Unit direction of the cloud's principal axis. */
  dir: Vec3;
  /** Point on the line — the cloud's centroid. */
  origin: Vec3;
  /** Extent along `dir`, min and max, relative to origin. */
  t0: number; t1: number;
  /** RMS distance of the cloud from the line. Large = the bone wants a bend. */
  residual: number;
}
export function medialLine(points: Vec3[]): MedialLine
```

Principal axis by the covariance matrix's dominant eigenvector (power iteration is sufficient and avoids a dependency).

- [ ] **Step 4: Verify** — 3 tests pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/draft-fit.ts src/lab/sdf-zombie/draft-fit.test.ts
git commit -m "draft-fit: bone axes from the vertex cloud, not the rig joints"
```

---

### Task 6: Radial profile, bands, and per-band `r`/`wide`/`deep`

**Files:**
- Modify: `src/lab/sdf-zombie/draft-fit.ts`
- Test: `src/lab/sdf-zombie/draft-fit.test.ts`

**Banding is what stops the draft generating a smooth tube** — the exact featureless-blob defect Phase 1 exists to detect.

- [ ] **Step 1: Write the failing test**

```ts
describe('bandCloud', () => {
  it('emits ONE band for a uniform cylinder', () => { … });

  it('splits a dumbbell into bands at the waist', () => {
    // Two fat ends and a thin middle. Assert >= 3 bands and that the middle
    // band's radius is materially smaller.
  });

  it('resolves wide/deep onto the bone axes for an elliptical cloud', () => {
    // A cloud with a 2:1 cross-section ALIGNED to the axes. Assert the fitted
    // wide/deep ratio is ~2:1.
  });

  it('flags a ROTATED cross-section instead of reporting it as axis-aligned', () => {
    // Same ellipse rotated 45 degrees about the bone axis. The format cannot
    // express that, so the fit must report a large |b| relative to |a| —
    // assert the returned `rotated` measure is large, and that wide/deep come
    // back near 1:1 rather than confidently wrong.
  });
});
```

That last test is the spec's pinned decision — write it.

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

```ts
export interface Band {
  t0: number; t1: number;
  /** Median radial distance in this band. */
  r: number;
  /** Axis-resolved cross-section ratios. 1,1 when circular. */
  wide: number; deep: number;
  /** |b| / |a| of the 2-theta fit. Large = genuinely rotated, format can't say it. */
  rotated: number;
  samples: number;
}
export function bandCloud(points: Vec3[], line: MedialLine, opts?): Band[]
```

Fit `d(θ) ≈ d0 + a·cos2θ + b·sin2θ` per band; take `a` for the axis ratio and report `|b|/|a|` as `rotated` — **do not** rotate the cross-section to the ellipse's own orientation, because `.blob` carries no such rotation.

Use a MEDIAN for `r`, not a mean: extremes are where blades and spurs live and a mean lets one spike move the ring.

- [ ] **Step 4: Verify** — 4 tests pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/draft-fit.ts src/lab/sdf-zombie/draft-fit.test.ts
git commit -m "draft-fit: band a cloud at its radial inflections"
```

---

### Task 7: Direction inversion, and honest refusal for `side`/`fwd`

**Files:**
- Modify: `src/lab/sdf-zombie/draft-fit.ts`
- Test: `src/lab/sdf-zombie/draft-fit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('inferDir', () => {
  it('round-trips an up-based direction through dirVector', () => {
    // For several (pitch, tilt), dirVector('up', p, t) -> inferDir -> the same
    // p and t back. This is the only honest test of an inversion.
  });

  it('round-trips a down-based direction', () => { … });

  it('picks side/fwd for a horizontal direction and REFUSES angles', () => {
    // dirVector's pitch is a no-op when the base has no vertical component
    // (side has y0 = 0, so sign(y0) = 0). Assert derivable === false and that
    // no pitch/tilt is returned — a number here would be confidently wrong.
  });
});
```

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

```ts
export interface DirFit {
  dir: 'up' | 'down' | 'side' | 'fwd';
  /** Absent when `derivable` is false. */
  pitchDeg?: number; tiltDeg?: number;
  derivable: boolean;
  /** Angle between the measured direction and what the emitted dir/pitch/tilt reproduce. */
  errDeg: number;
}
export function inferDir(v: Vec3): DirFit
```

Pick the base whose vector is closest to `v`; invert `dirVector` analytically for `up`/`down`; set `derivable: false` for `side`/`fwd` and return no angles. Always report `errDeg` so the author knows what the emitted line actually reproduces.

- [ ] **Step 4: Verify** — 3 tests pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/draft-fit.ts src/lab/sdf-zombie/draft-fit.test.ts
git commit -m "draft-fit: invert dirVector where it is invertible, refuse where it is not"
```

---

### Task 8: Colour, stance, and asymmetry

**Files:**
- Create: `src/lab/sdf-zombie/draft-paint.ts`
- Test: `src/lab/sdf-zombie/draft-paint.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('bandColour', () => {
  it('returns the dominant texel colour of a band', () => { … });
  it('flags a BIMODAL band as a paint boundary', () => {
    // Half the band's verts one colour, half another. The draft must split
    // there, because a paint boundary IS a primitive boundary in this format.
  });
});

describe('inferStance', () => {
  it('calls a knee forward of the hip-ankle line humanoid', () => { … });
  it('calls a knee behind it digitigrade', () => { … });
});

describe('unmappedCloud', () => {
  it('returns the Head cloud, which groupByBone does NOT map', () => {
    // MESHY_BIPED maps no .blob bone to `Head`, so groupByBone reports it in
    // `unmapped` with a vertex COUNT and no points. The draft still needs a
    // cranium mass and hand masses, so this reads those clouds by joint name
    // straight off the skin. Assert a non-empty cloud for `Head`.
  });

  it('returns both hand clouds', () => {
    // LeftHand / RightHand, same reason. No fingers are derivable — the rig
    // lumps the whole hand into one joint — so this is a single mass each.
  });
});

describe('asymmetry', () => {
  it('reports LOW for a mirrored pair', () => { … });
  it('reports HIGH for the minotaur prosthetic pair', () => {
    // shin.r carries 18,032 verts against shin.l's 6,724 on the real mesh.
    // This is the case that motivated side=l|r and it must be detected, not
    // mirrored away.
  });
});
```

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Implement**

Texel sampling: reuse the GLB decode path (`parseGlb` + the image decode `blob-face-bake.py` performs) rather than writing a second one. Report per band a dominant colour, a bimodality measure, and for the whole body a mean colour plus spread for the `palette` block.

Asymmetry: compare the `.l` and `.r` clouds' vertex counts and banded radii; above a stated threshold the pair is NOT mirrorable.

Unmapped clouds: `groupByBone` returns `{ byBone, unmapped }` where `unmapped` is a joint-name → COUNT map, not points. Add a reader that pulls the actual vertices for a named joint out of the `RefSkin` directly, so the head and hands can be sized. This is plumbing the draft needs and `blob:rings` never did, because ring-fit explicitly cannot see the head or hands.

- [ ] **Step 4: Verify** — 8 tests pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/draft-paint.ts src/lab/sdf-zombie/draft-paint.test.ts
git commit -m "draft-paint: colour per band, stance, asymmetry, and the unmapped head/hand clouds"
```

---

### Task 9: Emit the `.blob` text, within budget

**Files:**
- Create: `src/lab/sdf-zombie/draft-emit.ts`
- Test: `src/lab/sdf-zombie/draft-emit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('emitDraft', () => {
  it('emits text that PARSES and COMPILES', () => {
    // The only test that matters. Feed a synthetic fit through emitDraft, then
    // parseBlob -> compileBlob -> buildBody -> validateBody with no errors.
  });

  it('puts a # fit: comment on every emitted number', () => {
    // Scan the output: every line carrying a numeric arg has a `# fit:` note.
  });

  it('stays inside the primitive budget', () => {
    // <= 80 prims total, <= 40 in any one cluster. MAX_CLUSTER_PRIMS is 64 and
    // is SILENT — the shader stops folding past it with no error — so the
    // draft must budget rather than emit and let validateBody catch it.
  });

  it('emits a side= pair unmirrored when asymmetry is high', () => { … });

  it('emits no pitch/tilt on a side-based bone', () => { … });

  it('pre-wires the face decal and the bake reminder', () => {
    // sheet / image <name>-face.png / decal 1, plus a `# run: npm run
    // blob:face-bake -- <name>` line. The draft never paints a face.
  });
});
```

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Implement `emitDraft`**

Header comment states, in the output itself: what was derived and from what, what was NOT attempted (fingers, `bend=`, angles on `side`/`fwd` bones), the budget used, and any bones whose medial residual or `rotated` measure says a hand pass is owed.

- [ ] **Step 4: Verify** — 6 tests pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/draft-emit.ts src/lab/sdf-zombie/draft-emit.test.ts
git commit -m "draft-emit: .blob text with a source on every number"
```

---

### Task 10: The `blob:draft` CLI, and draft the minotaur from scratch

**Files:**
- Create: `scripts/blob-draft.ts`
- Modify: `package.json` (`"blob:draft": "tsx scripts/blob-draft.ts"`)

- [ ] **Step 1: Write the CLI**

Same conventions as `blob:rings`: reference resolution, the `=== mesh <path>` header, exit 0 when it ran and 2 when it did not.

- [ ] **Step 2: Draft the minotaur**

```bash
npm run blob:draft -- minotaur > /tmp/minotaur-draft.blob
```

- [ ] **Step 3: Prove the draft is a usable starting point**

Author it in as `minotaur` and run every gate:

```bash
npx vitest run src/lab/sdf-zombie/
npm run blob:render-check -- minotaur
npm run blob:depth -- minotaur
BLOB_DIST=3.0 npm run blob:shot -- minotaur
```

Then **`Read` the frames**. Report honestly whether the draft alone is closer to the reference than round 1's hand-authored scaffold was. It does not have to be good — it has to be a better starting point, and it must be judged by eye, not by a green board. A negative finding here is the most valuable thing this task can produce.

Record the comparison in `docs/dev-notes/2026-09-02-blobforge-depth/notes.md`.

- [ ] **Step 4: Commit**

```bash
git add scripts/blob-draft.ts package.json docs/dev-notes/2026-09-02-blobforge-depth/
git commit -m "blob:draft — a body from the mesh, with a source on every number"
```

---

## Done when

- `npx vitest run src/lab/sdf-zombie/` green with no regressions against 2121
- `npx tsc --noEmit` clean
- `npm run blob:depth -- minotaur` reports a large torso error where `blob:measure` and `blob:rings` both reported nothing
- `npm run blob:draft -- minotaur` emits text that parses, compiles, validates, and stays inside budget
- Frames of the drafted minotaur exist and have been LOOKED AT, with an honest verdict written down
