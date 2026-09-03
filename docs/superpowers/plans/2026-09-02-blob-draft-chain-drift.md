# `blob:draft` chain drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a drafted skeleton close — soles on the floor, chain matching its own height line — by taking lengths and directions from the rig instead of from overlapping vertex clouds.

**Architecture:** One conceptual change with one landing point. `DraftBone.line` (a `MedialLine`) is what carries both `len=` and `dir=` into the emitted bone statement. Today the CLI builds it from the bone's vertex cloud; it must be built from the rig's joint-to-joint segment times one global scale. The cloud keeps every job it is actually good at — radii, bands, colour — and gains one: supplying `offset=` where the surface is not centred on its bone.

**Tech Stack:** TypeScript, vitest, tsx.

**Spec:** [`docs/superpowers/specs/2026-09-02-blob-draft-chain-drift-design.md`](../specs/2026-09-02-blob-draft-chain-drift-design.md)

---

## Read before starting

**Baseline: `npx vitest run src/lab/sdf-zombie/` green at 2170 tests / 112 files.** Confirm before you start.

Read the spec first — the *why* matters more than usual here, because the change looks like it throws away a measurement in favour of a cruder number, and it does not.

Five facts, verified — do not re-derive:

1. **`.blob`'s skeleton is a rigid kinematic chain.** A bone's head is its parent's TAIL; its tail is head + `dir` × `len`. So `len=` places every descendant of a bone. **Length is a chain quantity, not a description of one bone.**
2. **Adjacent vertex clouds OVERLAP** — thigh and shin both own the knee — so summed extents overshoot and the error accumulates down the chain. Measured on the drafted minotaur: **soles ~0.3 m above the floor, chain ~8% too tall.**
3. **`refBones(skin.jointWorld, rig)` returns `{ head, tail }` per bone.** Joint-to-joint distance is `len(sub(tail, head))`, and those distances compose by construction — they are the chain that produced the skin.
4. **Bonewalker is the precedent.** Every `len=` came from the rig table × a single global scale, and its note records the result: *"no `BONE LENGTH IS OFF` block ever printed — the failure class that drowned every mouse/schoolgirl fit was absent by construction."*
5. **The 9-13 cm joint-vs-skin offset is real but says the wrong thing.** It describes where the SURFACE is, not how long the BONE is. The fix is `offset=` on the PRIMS. **Never relocate a bone to chase a surface** — that is what breaks the chain.

**The landing point:** `scripts/blob-draft.ts` builds a `Built.line` per bone from `medialLine(cloud)`. That is the line to change. `DraftBone.line` then carries it into the emitted statement.

---

### Task 1: Rig-derived chain lines

**Files:**
- Modify: `src/lab/sdf-zombie/draft-fit.ts`
- Test: `src/lab/sdf-zombie/draft-fit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('rigLine', () => {
  it('returns the rig segment scaled by one global scale', () => {
    // head [0,1,0] -> tail [0,0.6,0], scale 2 => length 0.8, direction -y.
    // Assert dir, and that t1 - t0 equals the scaled joint-to-joint distance.
  });

  it('composes: a chain of rigLines sums to the scaled chain length', () => {
    // THE PROPERTY THE CLOUD VERSION LACKS. Three bones head-to-tail in the
    // rig; assert the sum of the emitted lengths equals the scaled distance
    // from the first head to the last tail, to float tolerance.
  });

  it('is unaffected by where the SURFACE sits', () => {
    // Same rig segment, two very different clouds around it (one centred, one
    // offset 0.12 laterally). Assert the returned line is identical — the
    // 9-13cm trap must not move the bone.
  });
});

describe('cloudOffset', () => {
  it('is zero for a cloud centred on its rig segment', () => { … });

  it('measures the lateral displacement of an offset cloud', () => {
    // Cloud centroid 0.12 off the rig axis => offset ~0.12 in that direction,
    // with the ALONG-axis component discarded (that is `at=`'s job, not
    // `offset=`'s).
  });
});
```

The second `rigLine` test is the whole point of the task — it is the property overlapping clouds cannot have.

- [ ] **Step 2: Run and verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/draft-fit.test.ts -t "rigLine|cloudOffset"`

- [ ] **Step 3: Implement**

```ts
/**
 * A bone's chain line, taken from the RIG rather than from its vertex cloud.
 *
 * `.blob`'s skeleton is a rigid chain — a bone's head is its parent's TAIL —
 * so `len=` places every descendant rather than describing one bone. Adjacent
 * clouds OVERLAP (thigh and shin both own the knee), so summed cloud extents
 * overshoot and the error accumulates: the first drafted minotaur stood with
 * its soles ~0.3 m off the floor. Rig joint-to-joint distances compose by
 * construction, being the chain that produced the skin. Bonewalker took every
 * len= this way and never printed a BONE LENGTH IS OFF block.
 */
export function rigLine(head: Vec3, tail: Vec3, scale: number): MedialLine

/**
 * How far a bone's cloud centroid sits OFF its rig axis, perpendicular only.
 *
 * This is the honest answer to rig joints sitting 9-13 cm from the skin: the
 * surface is not where the joint is, so offset the PRIMS. Relocating the bone
 * instead is what breaks the chain — see rigLine.
 *
 * The along-axis component is deliberately dropped: sliding a prim along its
 * own bone is `at=`'s job.
 */
export function cloudOffset(points: Vec3[], line: MedialLine): Vec3
```

Return the same `MedialLine` shape the rest of the pipeline consumes, with `residual` reported as the cloud's spread about the RIG axis when points are supplied (it is a check now, not an input).

- [ ] **Step 4: Verify** — 5 tests pass; full suite 2175 / 112, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/draft-fit.ts src/lab/sdf-zombie/draft-fit.test.ts
git commit -m "draft-fit: chain lines from the rig, offsets from the cloud"
```

---

### Task 2: Wire the CLI — rig for the chain, cloud for the surface

**Files:**
- Modify: `scripts/blob-draft.ts`
- Modify: `src/lab/sdf-zombie/draft-emit.ts` (carry `offset=` on a fit)
- Test: `src/lab/sdf-zombie/draft-emit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('emitDraft offsets', () => {
  it('emits offset= on a prim whose fit carries one', () => { … });
  it('emits NO offset= when the fit has none', () => {
    // A zero offset must not appear as `offset=(0,0,0)` noise.
  });
  it('notes a cloud/rig axis disagreement in the # fit: comment', () => {
    // The >45-degree case is now a REPORTED CHECK, not a silent correction.
  });
});
```

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Change the source of `Built.line`**

In `scripts/blob-draft.ts`, the per-spec fit currently sets `line` from `orient(medialLine(data.positions), anatomical)`. Change it to `rigLine(refHead, refTail, globalScale)` using the bone's entry from `refBones`.

Then:
- Keep computing the cloud's `medialLine` — it still feeds `bandCloud`, and its direction is now a **check**: where it disagrees with the rig direction by more than the existing threshold, record that on the fit so Task 2's third test can see it in the `# fit:` comment.
- Compute `cloudOffset` per fit and carry it through `DraftSideFit` to the emitter.
- **Delete the `>45°` fallback's steering role.** It exists because a non-limb cloud (schoolgirl's dress measured an 86° axis) could otherwise point a bone sideways. Directions now come from the rig, so it cannot happen. Keep the measurement, report it, remove the substitution — and say in the commit message that this is why.

For a bone the rig does not map (the skull, hands), there is no rig segment. Keep the existing cloud-derived behaviour there and **comment why it is safe**: those bones are chain LEAVES, so their length places no descendants. Verify that claim against `SPECS` before relying on it; if any unmapped bone has children, report rather than assume.

- [ ] **Step 4: Verify** — 3 tests pass; full suite green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/blob-draft.ts src/lab/sdf-zombie/draft-emit.ts src/lab/sdf-zombie/draft-emit.test.ts
git commit -m "blob:draft: the chain comes from the rig, the surface from the cloud"
```

---

### Task 3: Make the acceptance properties testable

**Files:**
- Modify: `scripts/blob-draft.ts` (report the three numbers)
- Test: `src/lab/sdf-zombie/draft-emit.test.ts`

The old failure had numbers; the fix must too, and they must be checkable without an eye.

- [ ] **Step 1: Write the failing tests**

```ts
describe('drafted chain closes', () => {
  it('lands the soles on the floor', () => {
    // Build a synthetic rig + clouds through the whole pipeline, compile and
    // build the emitted text, and assert the body's lowest point is within
    // tolerance of y = 0. Today this is ~0.3 m out on the minotaur.
  });

  it('matches its own height line', () => {
    // Crown-to-sole extent within tolerance of the requested height.
    // Today ~8% out.
  });

  it('emits len= equal to the rig distance times the global scale', () => {
    // For every mapped bone. This is the property bonewalker had by
    // construction and the first draft did not — assert it directly rather
    // than inferring it from the two above.
  });
});
```

- [ ] **Step 2: Run and verify they fail** — they should fail *now*, against the current behaviour, before Task 2's change is in. If they pass already, the test is not measuring what it claims.

- [ ] **Step 3: Make them pass, and print the numbers**

Have the CLI report sole height, chain height vs requested, and worst `len=` deviation in its header comment and on stderr, so an author sees the chain closed without running a test.

- [ ] **Step 4: Verify** — full suite green; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/blob-draft.ts src/lab/sdf-zombie/draft-emit.test.ts
git commit -m "blob:draft: assert the chain closes, and say so in the output"
```

---

### Task 4: Re-draft both characters and judge

**Files:**
- Modify: `docs/dev-notes/2026-09-02-blobforge-depth/notes.md` (append)

- [ ] **Step 1: Re-run both drafts**

```bash
npm run blob:draft -- minotaur > /tmp/minotaur-draft.blob
npm run blob:draft -- schoolgirl > /tmp/schoolgirl-draft.blob
```

**`schoolgirl` must build connected with the `>45°` fallback's steering removed.** She is the case that needed it — an 86° dress-cloud axis. If she does not build, directions are still coming from clouds somewhere; find where rather than restoring the fallback.

- [ ] **Step 2: Check the acceptance numbers**

Soles within tolerance of the floor, chain height within tolerance of requested, every mapped `len=` equal to rig × scale. Report all three for both characters.

- [ ] **Step 3: Regression — the parts that worked must still work**

The minotaur draft stays inside the prim budget and its prosthetic stays **unmirrored** (the asymmetry detection is what `side=l|r` exists for). Report both.

- [ ] **Step 4: Author the minotaur draft in and LOOK**

```bash
npx vitest run src/lab/sdf-zombie/
npm run blob:render-check -- minotaur
npm run blob:depth -- minotaur
BLOB_DIST=3.0 npm run blob:shot -- minotaur
```

`Read` the frames. **Answer the same question Task 10 answered "no" to: is this now a better starting point than round 1's hand-authored scaffold?**

A second honest "no" is a perfectly good outcome and more useful than a green board — Task 10's "no" is what produced this fix. If it is still no, say exactly what is wrong now, because it will be a different thing.

- [ ] **Step 5: Append to the notes and commit**

Record both characters' acceptance numbers, the before/after against Task 10's ~0.3 m and ~8%, and the verdict.

```bash
git add docs/dev-notes/2026-09-02-blobforge-depth/notes.md
git commit -m "blob:draft: the chain closes — re-drafted, re-judged"
```

---

## Done when

- `npx vitest run src/lab/sdf-zombie/` green, no regressions against 2170
- `npx tsc --noEmit` clean
- Both drafts land soles on the floor and match their height line, within stated tolerance
- Every mapped `len=` equals rig distance × global scale
- `blob:draft -- schoolgirl` builds connected with no cloud-steering fallback
- The minotaur draft is in budget with its prosthetic unmirrored
- Frames exist, have been LOOKED AT, and a verdict is written down
