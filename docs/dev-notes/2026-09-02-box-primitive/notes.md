# Task 7 — box primitive, end-to-end proof

Fixture: `src/lab/sdf-zombie/characters/box-fixture.blob`. Test: `src/lab/sdf-zombie/blob-box-e2e.test.ts`.

## Fixture, and the one change from the task's literal template

The task's template skeleton (`root pelvis at 0.50` / `bone spine ... len=0.40`,
no `skull` bone) parses fine, but `buildBody` throws `prim references unknown
bone "skull"` — `compileBlob` unconditionally appends `facePrims(face)` to
every compiled body (`blob-compile.ts` line ~248: `prims: [...prims,
...facePrims(face)]`), and every face part rides a bone literally named
`skull` (`face.ts`: `const HEAD = { bone: 'skull', ... }`). This is not
special to a `box` fixture — `blob-compile.test.ts`'s own minimal "does the
builder accept this" fixture carries the same `bone skull parent=spine
dir=up len=0.16` for the same reason. Added it to `skeleton:` so
Step 3's `buildBody().errors` check has something to pass against. No other
line changed from the task's template.

Shipped fixture:

```
model box-fixture
  height 1.0

skeleton
  root pelvis at 0.50
  bone spine parent=pelvis dir=up len=0.40
  bone skull parent=spine dir=up len=0.16

body
  # A machined slab and a soft one on the same bone: the pair exercises both
  # ends of the `round` sweep in one field.
  bar torso on spine from=0.10 to=0.60 r=0.060 wide=1.30 deep=0.80 box round=0.05 blend=0.010 core
  blob torso on spine at=0.75 r=0.070 box round=0.40 blend=0.010
```

Resolved geometry (pelvis's default 0.14 length puts `spine` head at
y=0.64, not 0.50): the slab spans world y ∈ [0.68, 0.88]; the soft blob
sits at y=0.94.

## render-check

`npm run blob:render-check -- box-fixture` — exit 0:

```
proxy volume: [-0.40,0.46,-0.40] .. [0.40,1.38,0.40], field centre [0.00,0.92,0.00]
background sample: rgb(26,17,22) (expected 26,17,22)
camera: fov 75 aspect 1.683 pos [0.00,0.46,2.40]
marched 345x205 samples (70725 rays) in 0.0s — 317 inside, 98 after erosion
floor sample:      rgb(26,17,22) at px (689,392)
0 hole cluster(s), worst 0 px across (threshold 12)
OK: renderer agrees with the field. If you still see a hole, it is in your .blob.
```

GPU raymarch agrees with the CPU field for this fixture.

## Visual proof — the slab reads as a genuine box

The default turntable framing (`turntable-frame-*.png`, `BLOB_DIST` unset)
is tuned for a ~1.8 m character; at this fixture's 1.0 m the whole body is a
small column in the upper-middle of the frame. **The dark gray cube visible
on the floor in every turntable frame is unrelated scene furniture** — it
reproduces identically (same screen position, same size) when shooting
`bonewalker`, a character with no `box` primitives at all, so it predates
this task and is not the fixture's geometry. Do not mistake it for the slab.

Close-up frames (`BLOB_DIST=0.45 BLOB_TARGET_Y=0.78`, targeting the slab's
own mid-height) are the real evidence:

- `slab-closeup-front.png` (yaw 0°) and `slab-closeup-side.png` (yaw 90°):
  the slab's silhouette is dead straight on both visible edges, top to
  bottom, with a flat, sharp-cornered bottom cap (the `from=0.10` end).
  Compare to the region immediately above it (the neck/soft-blob), which
  bulges — a visibly different, rounder silhouette on the same body.
- `slab-closeup-corner-45deg.png` (yaw 45°) is the clearest single frame:
  two flat faces meet at one sharp vertical edge running the full height of
  the slab, with a specular highlight breaking exactly along that edge —
  the unmistakable read of a box corner, not a capsule's continuously
  curving highlight.
- `soft-blob-closeup-front.png` (`BLOB_TARGET_Y=0.94`, the `round=0.40`
  sphere): visibly rounder and softer than the slab immediately below it in
  the same shot — the two ends of the `round` sweep are clearly
  distinguishable on one body, which was the fixture's point.

Conclusion: the box branch is being taken. The slab is not a rounded
lozenge wearing a `box` flag — it is a flat-sided, sharp-edged box, and the
`round=0.40` blob is legibly softer/rounder than the `round=0.05` slab.

## Test discrimination matrix (mutation-verified by hand, reverted after)

| Assertion | Mutation | Result |
|---|---|---|
| `validates as a closed, connected body` | shrink the slab to `from=0.10 to=0.20`, delete the soft blob (head cluster and torso cluster now too far apart to fuse) | FAILS: `built.errors` reports both clusters "disconnected — not fused to any other cluster" |
| `has a constant half-width along the slab at two heights` | drop `box round=0.05` from the slab line (falls back to the plain capsule branch — this bar has no `r2=`) | **still PASSES** — documented in-test as expected: the axis-aligned crossing is provably identical between a box and a capsule of the same `radius` (`round=` is defined so `e + r == radius`, exactly canceling on-axis), so this assertion alone cannot tell a box from a capsule. It is a real, useful invariant (no unintended taper along the length) but not the box-ness proof — see the next row. |
| `reads square in cross-section` (the corner-vs-axis ratio) | same mutation (drop `box round=0.05`) | FAILS: ratio drops from ~0.985 to exactly 1/√2 ≈ 0.7071 (a sphere's constant), well under the 0.9 threshold |
| `reads square in cross-section` | neuter the box branch directly (`if (prim.box)` → `if (false && prim.box)` in `validate.ts`) | FAILS the same way, same ratio |
| `round-trips byte-for-byte through the emitter` | drop `doc.parts` from `emitBlob`'s `owned` array in `blob-emit.ts` | FAILS: re-emitted document loses the whole `body` block's content |

The corner-vs-axis ratio check exists because the on-axis check (which is
what the task text literally suggested — "binary-search the surface in x at
two heights") turned out to be **non-discriminating by construction**: a
rounded box's `round=` fraction is defined so its axis-aligned extreme point
coincides exactly with a same-`radius` capsule's (`round=1` *is* a capsule),
so probing purely along x at z=0 cannot tell a box from a sphere no matter
how many heights you sample. Verified by hand (see table) before trusting
either assertion. The two together are what "flat sides" means end to end:
flat along the length (on-axis check) and flat across the cross-section
(corner check).

## Test/build status

- `npx vitest run src/lab/sdf-zombie/`: 104 files, 1982 passing (1975
  baseline + 4 new in `blob-box-e2e.test.ts` + 3 the existing
  `blob-emit.test.ts` glob picked up automatically for the new
  `box-fixture.blob`). Zero regressions.
- `npx tsc --noEmit`: clean.
