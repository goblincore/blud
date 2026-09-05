# The body sheet: painting muscle onto the field

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An authored greyscale plate that DISPLACES the body's field, so
muscle lands where anatomy puts it instead of where noise happens to.

**Architecture:** A second additive term beside the existing
`fbm(anchor * 3.0) * noiseAmp` in `mapBody`. Same rest-frame anchor, same
displacement mechanism — only the content changes from random to authored.

**Tech Stack:** TypeScript, WGSL, Python (the bake), vitest.

**Follows:** [`2026-09-03-body-sheet-design.md`](../specs/2026-09-03-body-sheet-design.md) — read it, and the evidence note it points at.

---

## Read before starting

**Baseline: `npx vitest run src/lab/sdf-zombie/ scripts/` green at 2286 tests / 121 files.**

**The one thing that will bite you: THE GRADIENT BUDGET.** `mapBody` is a
sphere-tracing distance field. Displacing it breaks the Lipschitz bound and
the march pays, and the cost is `gain x maxFrequency x amplitude`. The shipped
baseline is `1.0 x 3.0 x 0.014 = 0.042`. Every spike behind this plan that
exceeded it tore the surface into black streaks — at an amplitude a
**fourteenth** of what `validateBody` currently permits, because that guard is
amplitude-only. For a painted plate the frequency term is `amp / pixel_size`,
so **a hard edge in the image is a cliff in the field.**

Mutation-verify every test. Several suites this session were caught passing
whether or not the feature existed.

---

### Task 1: `blob:relief --emit-map`

**Files:** `scripts/blob-relief.ts`, `scripts/blob-relief-core.ts`, `scripts/blob-relief.test.ts`

The tool already computes reference-minus-body front-wall depth per cell.
Write it as a PNG: mid-grey = no change, brighter = the mesh has mass the body
lacks, darker = the body is proud.

- [ ] **Step 1:** Failing tests on the mapping — a cell with zero difference
is exactly mid-grey; the sign convention holds; the encoded range is stated
and clamped rather than wrapping.
- [ ] **Step 2: REFUSE to emit without a `--y` window,** or emit and warn
loudly. The tool is only valid where the two subjects share a pose, and
emitting over the whole figure would bake pose error into the plate as
anatomy. Decide which, and say why in the code.
- [ ] **Step 3:** Cells are **47 mm**, coarser than a muscle line. Resample
and smooth, and **print the resolution the map can honestly claim.** Do not
upsample silently into a number that implies detail the measurement never had.
- [ ] **Step 4:** Emit for the minotaur, `Read` the PNG, and say whether the
pecs, sternum and abs are actually legible in it. If they are not, the rest of
this plan is built on sand — say so and stop.
- [ ] **Step 5:** Mutation-verify; commit.

---

### Task 2: give the noise guard a frequency term

**Files:** `src/lab/sdf-zombie/validate.ts`, `src/lab/sdf-zombie/validate.test.ts`

**Do this BEFORE the shader work**, so the new displacement path is born
inside a guard that can see it.

`validateBody` has `silhouetteNoiseAmp > (1 - stepMultiplier) * 0.5`.
Amplitude only. A spike at amp 0.014 — a fourteenth of the permitted 0.20 —
visibly tore the march because it raised the frequency.

- [ ] **Step 1:** Failing test — a high-frequency, low-amplitude displacement
must be REJECTED. It passes today, and that is the bug.
- [ ] **Step 2:** Generalise the check to the `gain x maxFrequency x amplitude`
product. The baseline `1.0 x 3.0 x 0.014` must stay legal, and **every shipped
character must still validate** — check all of them, not just one.
- [ ] **Step 3:** Mutation-verify; commit.

---

### Task 3: grammar, packing, sampling

**Files:** `blob-parse.ts`, `blob-compile.ts`, `blob-ast.ts`, `types.ts`, `pack.ts`, `webgpu/march.wgsl.ts`, plus tests

```
bodySheet
  image       minotaur-muscle.png
  amp         0.018
  projScaleX  0.42
  projScaleY  0.55
  projCentreX 0.5
  projCentreY 0.5
```

- [ ] **Step 1:** Parse + compile, with tests. Absent means absent: no row, no
sample, every existing character bit-identical.
- [ ] **Step 2:** Sample in `mapBody` beside the fbm, planar in the `anchor`
frame, front-on (`u = world x`), mid-grey = zero displacement.
- [ ] **Step 3: INVESTIGATE the early-out at `march.wgsl.ts:1181`.**
`if (noiseAmp <= 0.0) { return ... }` exists because fbm costs sixteen hash
calls. A texture fetch is a different cost, and **a character with a sheet and
no noise must still get its sheet.** Report what you found and what you did.
- [ ] **Step 4: THE TRAP.** `placePrims` and `pack.ts`'s cluster/group
`shaped` flags are explicit-copy chokepoints. Two silent-drop bugs of exactly
this shape were found this session — `p.shell` omitted from `shaped`
(schoolgirl-alt's cape a solid blob for weeks) and `grooveDepth` omitted from
`placePrims` (every groove in every character a no-op). If any part of this
feature rides a prim, add it to both and write a test whose fixture has ONLY
this feature.
- [ ] **Step 5:** Verify, mutation-verify, `blob:render-check` clean, commit.

---

### Task 4: the minotaur, and an honest verdict

- [ ] Emit the plate, wire it up, `BLOB_DIST=3.0 npm run blob:shot`, and
`Read` every frame. **The question is narrow: does the torso read as MUSCLED,
from every yaw?** Not "is the score better" — three rounds have now improved a
score while the render did not, and that is the specific failure this task
exists to catch.
- [ ] Re-run `blob:relief` and report the mean, but **subordinate it to the
frames.** If the numbers improve and it still does not read, that is a "no".
- [ ] `blob:render-check` at the shipped amp: 0 hole clusters.
- [ ] Append the verdict to `docs/dev-notes/2026-09-03-torso-relief/notes.md`.
**A "no" is a good outcome** and has been three times already in this file.

---

## Done when

- Full suite green, no regressions against 2286; tsc clean
- Characters without a `bodySheet` are bit-identical
- The noise guard rejects a high-frequency low-amplitude displacement
- `blob:render-check` clean on the minotaur at the shipped amplitude
- Frames looked at, verdict written down
