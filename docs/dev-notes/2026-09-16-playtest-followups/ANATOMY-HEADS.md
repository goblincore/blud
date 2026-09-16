# ANATOMY, HEADS AND PIECE BUDGETS — task 2 evidence

Worktree `2026-09-16-blud-playtest-followups-task-2`, branch
`codex/playtest-followups-task-2`, inherited from the task-1 cold-start branch
(`64a4737b`, itself on `ed97cd14`). The implementation-and-evidence commit for
this task is **`d84b1f09`** (this following doc-only commit adds that hash to
the file). Node `v22.22.1`. Owned Vite on `5441` and headless Chrome on `9441` (`--enable-unsafe-webgpu`, scratch in `.lab-tmp/`);
the owner's `5391`/`5415` servers were never touched. `node_modules` was
symlinked from the primary checkout (same lockfile) and
`scripts/link-dev-assets.sh` was run for the dev-only placeholders; no source
outside the worktree was edited.

**Scope.** Owner reports 3 and 5 of the 2026-09-16 playtest: *recognizable
textured heads* and *always-split upper/lower limbs with leaner clutter and
grounded rest*. Report 2 (rupture subtlety / chest peel swallowing the head)
belongs to task 4 and is not changed here; report 4 (NotBlood launch) is task 3.
No merge, no push. Owner acceptance is **not** claimed.

---

## 1. What the head actually did — diagnosis

The face is not lost at a single point; each stage had a different cause, and
the captures below isolate them. Trace, whole body → rupture → chunk → bake:

1. **Whole body (onset).** The face renders (eyes, brow, sockets, mouth) — the
   accepted baseline. `faceCfg.x = 1`, `headShape(a.drawnBody())` tracks the
   posed skull.
2. **Rupture window.** Task 3's gore ramp drives the per-instance `REC_GORE`
   from 0 to exactly 1 by release. The gore pass ran **before** the face layer,
   so the face multiplied an already 85 %‑clot albedo: by ~100 ms the head was
   a near-black mottled ball with only the emissive eye glow surviving. The
   face projection itself was still correct — it had no bright albedo left to
   paint onto.
3. **Flying chunk.** `createChunkGpuView.reset` sets `faceCfg.x` for
   `limb === 'head'` and carries the head centre/quat/axes, so the projection
   is right; but `lodCfg.w = 1` for every flesh chunk, so the same dark gore
   covered the whole head. Measured: the release-frame head was a dark mottled
   ball (see the before column of `task2-head-before-after.jpg`).
4. **Baked rest.** `bakeChunkAlbedo` mirrors the march's albedo chain and bakes
   the gore into the vertex colour, so a settled head was dark even though its
   baked material re-applies the face (`entry.view.uniforms.faceCfg.x > 0.5`
   → `faceMaterial`). The bake needed its own face protection.
5. **Recycling.** Correct already: a recycled view recomputes the head frame on
   every `reset`, and a non-head `reset` zeroes `faceCfg.x`; the bake now also
   drops the stale `face` frame (`chunk-bake-look.test.ts`).

A second, structural cause: the default `bones: 'core'` release emitted
`bone.skull` **in addition to** the whole flesh head, so a blast could put two
head-shaped chunks in the air. That is the "both indistinguishable flesh/skull
heads" the brief forbids, and it spent a precious pool slot on a duplicate.

## 2. What changed

| # | Change | Files |
| --- | --- | --- |
| 1 | **Gore is face-aware and runs after the face pass.** `faceCover = clamp(facing + faceRegion·KEEP, 0…1)`, `goreStrength = max(lodCfg.w, gInstGore)·(1 − faceCover)`. A standing body has gore 0 and is unaffected; a non-head chunk has `faceCfg.x = 0`, so its result is unchanged too. `faceRegion` is the head's own extent mask (1 on the head, 0 down the neck), so a detached head keeps its EXTERIOR SKIN all around, not just the frontal face — the torn treatment stays on the neck cut. | `webgpu/march.wgsl.ts`, `gib-look-tuning.ts` |
| 2 | **The bake mirrors it.** `bakeFaceCover(p, frame)` reproduces the facing + head-extent terms (radial-normal approximation, stated) and `bakeChunkAlbedo` attenuates `look.goreStrength` by `(1 − faceCover)`. `ChunkBakeData.face` is filled from the view only while `faceCfg.x > 0.5`. | `chunk-bake-field.ts`, `webgpu/chunk-bake-geometry.ts`, `webgpu/zombie-gpu.ts` |
| 3 | **One split plan, priority-ordered; the whole-limb ladder is gone.** `gibBlastPlan` produces the split-only blast shape in `BLAST_RANK` order (head → chest → 4 uppers → ribcage → 4 lowers → abdomen/pelvis → gut → optional long bones). `gibTierPlan` returns that plan in full when it fits, else a PREFIX of it — never a merge back into a whole tube. `gibActor` no longer re-runs a release-time ladder, and the zero-duration (`?gibtear=0`) path calls the same `gibTierPlan`. | `gib-parts.ts`, `webgpu/game-main.ts` |
| 4 | **No duplicate skeleton.** The blast plan never emits `bone.skull`/`bone.pelvis` while their flesh pieces exist, and never emits a long bone for a limb that was already severed (that chunk carried it). `?gibbones=all` still releases the full 11 groups as the labelled reference. | `gib-parts.ts` |
| 5 | **Adversarial-cap clamp.** `gibAllowance` is clamped to `remaining`, so at `?maxchunks=5` a body can no longer be handed 7 slots and recycle two of its own pieces in the same call. | `webgpu/game-main.ts` |

### The default piece set (14)

`head`, `torso.chest`, `armL/R.upper`, `legL/R.upper`, `bone.cage`,
`armL/R.lower`, `legL/R.lower`, `torso.abdomen`, `torso.pelvis`, `organ.gut`.
The first **seven** alone read as a body: head, torso, a ribcage and four split
upper limbs. Dropped in order, never anatomy: the gut coil, the skull/pelvis
duplicates (already gone), then the tail of the priority list.

`?gib=clusters` remains the explicitly labelled whole-limb A/B control (the
shape the owner rejected by name); the default never falls back to it.
`?gib=pieces` is unchanged and still has no source indices (Task 3's known
limit).

## 3. Reproduction

```
LAB_VITE_PORT=5441 LAB_CDP_PORT=9441 LAB_TMP="$PWD/.lab-tmp" \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; \
           while true; do sleep 30; done' &

# close clear rupture (body facing camera)
RUP_VIEW=back RUP_DIST=1.6 RUP_FRAMES=24 RUP_VFX="&explosionfx=standin" RUP_SEED=7 \
  node scripts/sdf-gib-rupture.mjs 5441 9441 /tmp/t2-final "&gibtear=0.2" front-clear
# marched-bone census diagnostic
RUP_VIEW=back RUP_DIST=2.4 RUP_FRAMES=14 RUP_VFX="&explosionfx=standin" RUP_SEED=7 \
  node scripts/sdf-gib-rupture.mjs 5441 9441 /tmp/t2-final "&gibtear=0.2&gibbonemesh=0" marchbones
# gameplay distance, real VFX
RUP_VIEW=threequarter RUP_DIST=5.25 RUP_FRAMES=20 RUP_SEED=7 \
  node scripts/sdf-gib-rupture.mjs 5441 9441 /tmp/t2-final "" gameplay
# FOLLOW the head's own face through flight and bake
HEAD_LOOK_VIEW=face HEAD_LOOK_DIST=0.7 HEAD_LOOK_FRAMES=10 HEAD_LOOK_SETTLE=700 \
  HEAD_LOOK_VHS=blud node scripts/sdf-gib-head-look.mjs 5441 9441 /tmp/t2-headfinal "&gibtear=0.2"
# tiny cap, zero-duration fallback
RUP_VIEW=back RUP_DIST=2.4 RUP_FRAMES=4 RUP_SEED=7 \
  node scripts/sdf-gib-rupture.mjs 5441 9441 /tmp/t2-tiny "&gibtear=0&maxchunks=6" tiny
```

`scripts/sdf-gib-head-look.mjs` is new: it re-aims the player (and therefore
the flashlight) at the head chunk's own centre each frame and, with
`HEAD_LOOK_VIEW=face`, along the head's own quaternion forward, so the face is
close and lit during the window, in flight and after baking. All rigs use
`presentedShot()` and a frozen, stepped loop (the two documented capture traps).

## 4. Piece census (beside the images, not instead of them)

Full-body blast, seed 7, `&gibtear=0.2`, default `maxchunks=64`:

| Run | tier | spawned | pieces | `bonePieces` | `boneRows` | `buriedBonePieces` | organ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| front-clear | `parts` | 14 | 14 | 0 (tube-drawn) | 0 | **0** | 1 |
| marchbones (`?gibbonemesh=0`) | `parts` | 14 | 14 | **1 (`bone.cage`)** | **31** | **0** | 1 |
| gameplay 5.25 m | `parts` | 14 | 14 | — | — | — | — |
| tiny cap `&gibtear=0&maxchunks=6` | `parts-slice` | 6 | 6/6 views | — | — | — | 0 |

`buriedBonePieces 0` is the point: no emitted flesh piece re-buries a skeleton
inside its own field, which is exactly what the old `clusters` fallback did.
`bone.cage` leaves as a bone-only piece with 31 packed rows. Bones are drawn by
the bone-tube instancer in the default (`?gibbonemesh` is on), which is why the
marched census reads 0 in the default and 1 with the tubes off; both are the
accepted arrangement, not a regression.

Tiny cap, exact parts: `head torso.chest armL.upper armR.upper legL.upper
legR.upper` — six pieces, head present, every limb section upper/lower-shaped.

The head's own piece is rank 0 in the plans above; the runtime spawn order is
`byBlast` (nearest the explosion first) for the stagger, so the head can appear
anywhere in `lastGibParts`. What matters is that it is always IN the prefix.

## 5. Native-vision observations (images actually opened)

Every file below was opened with the native image viewer, not read off a
filename. Crops are committed in [`captures/anatomy-heads/`](captures/anatomy-heads).

| Image | What was inspected | Observation |
| --- | --- | --- |
| `task2-marchbones-sheet.jpg` | front, 2.4 m, clear stand-in VFX, `?gibbonemesh=0`, 15 tiles | f0 intact posed body; from f1 the chest band lifts and the **pale ribcage is readable**; f8–f11 the cage stands in the opening; f12 the pieces spawn already wearing the mottled surface; the head stays a distinct mass. |
| `task2-gameplay-sheet.jpg` | three-quarter, **5.25 m**, real explosion VFX, 14 tiles | At gameplay distance the body still reads through f11 and becomes clearly separate head / split arm / split leg / torso masses from f12; no whole tubes and no orbs. |
| `task2-front-clear-sheet.jpg` | front, 1.6 m, clear stand-in, 15 tiles | Close read of the same transition: regions tilt apart, the ribcage is visible, the head separates as one mass. |
| `task2-head-before-after.jpg` | before (top) vs after (bottom), f08/f11/f12/f15, same camera+seed | The before arm is the pre-task-2 code as a whole (old 16-piece plan with the skull duplicate AND the old gore order). After: a legible frontal face — brow, eye sockets, nose/mouth plane and the glowing eyes — on the head through f08–f12. Before: a near-uniform dark mottle where only the eye glow survived. The improvement is the **face and exterior skin**, not an overall brightness lift. |
| `task2-head-flight-13.jpg` / `-17` / `-21` | head followed along its own face axis, 0.7 m | The face (sockets, mouth) is present on the tumbling head; the tumbling sequence also shows the crown/back, which stays bloodied — correct. |
| `task2-head-baked-clear.jpg` / `-vhs` | the settled, baked head (`faceBaked 1`), clear and VHS | The baked head keeps the face material and a face region; VHS does not wash it out. |
| `task2-front-clear-normal.mp4`, `task2-head-face-follow-normal.mp4` | 0.4 s / tracked flight at 60 fps, looped | Normal-speed read: continuous separation, no whole-limb resubstitution, no face pop. |

Honest reading: the head is no longer a generic mottled meat blob **when its
face is toward the camera and lit**; the crown and back of a tumbling head are
still bloodied, and at 5.25 m the face is only a few pixels. The head's identity
at gameplay distance rests on its silhouette and the ribcage/limb split, not on
resolving the face.

## 6. Tests and build

```
npx vitest run <30 focused files: gib-tear, gib-parts, gib-rupture, gib-chunks,
  explosion-aoe, sever, sever-bones, humanoid-sever, detached-pose, melt,
  melt-bones, melt-gate, chunk-bake-field, march.wgsl, crowd-records,
  game-actor{,-soldier,-collision,-bounded-wounds,-elbow,-torso-slug},
  baked-chunks, chunk-bake-jobs, chunk-bake-look, chunk-bake-buffers, gib-carve,
  gib-sprite-pieces, march-step-soundness, dynamite-panel, zombie-gpu, gib-library>
# 30 files passed, 663 tests passed, 0 failed

npx vitest run       # FULL suite — 333 files passed, 5248 tests passed, 0 failed
npm run build        # tsc --noEmit && vite build — exit 0
```

New/updated pins:

- `gib-parts.test.ts` — the split-only priority prefix at budgets 1/3/5/7/9/12/13;
  no `.whole` piece at any budget × bone release; the seven-slot floor is head +
  chest + four uppers + cage; the head is the one-slot budget; the head is rank
  0; `core` releases only `bone.cage`; the blast plan partitions every live flesh
  prim once; a pre-severed limb emits neither its flesh nor its long bone, while
  the other limb's bones still release; sliced cuts only link surviving pieces.
- `march.wgsl.test.ts` — the face layer precedes the gore pass; the gore is
  attenuated by face coverage; the head-region mask and the shared
  `HEAD_EXTERIOR_GORE_KEEP` constant are present.
- `chunk-bake-field.test.ts` — `bakeFaceCover` is high on the face, the shared
  exterior fraction behind it, and zero off the head extent; full coverage leaves
  the gore mix untouched while no coverage still stains.
- `chunk-bake-look.test.ts` — a head view's `bakeData().face` is present with the
  live forward sign, and a recycled non-head view carries none.

## 7. Limits / honest gaps

1. **The head's crown/back still reads as bloodied meat.** `HEAD_EXTERIOR_GORE_KEEP`
   is 0.3; A/B showed 0.6 and 0.3 differ by only ~1000 px at f11 because the
   unlit side of a tilted head carries almost no albedo signal. The value is not
   finely tuned and the whole-head exterior is deliberately not made clean.
2. **The bake's face coverage is an approximation.** `bakeFaceCover` uses the
   radial direction from the head centre instead of the interpolated vertex
   normal (the bake computes albedo before it needs normals). On a locally convex
   head the front coverage matches; grazing angles can differ slightly from the
   march.
3. **The head is framed/carried by existing machinery.** Task 4's region
   rotation and task 3's peel still own the rupture motion; the chest peel
   pushing toward the head (owner report 2) is **not** addressed here. The head's
   face frame does follow the displaced head, so no new transform was added.
4. **`?gib=pieces` is still preview-then-spawn** (no source indices) and
   `?gib=clusters` is still whole-limb — both labelled reference modes, not the
   default. Only the default `parts` path is coherent preview↔release end to end.
5. **Bounded degradation is a prefix, not a cover.** Below the seven-piece floor
   a body emits fewer pieces and therefore has gaps; the alternative (merging
   limbs) is what the owner rejected. No body is hidden, no actor is left
   invisible, and no default piece is a whole limb.
6. **Front/side/rear coverage is partial.** Body-level front and three-quarter
   are captured; the tumble supplies side/rear of the head inside the flight
   sheet. A dedicated head orbit was not run.
7. **Bones default to the tube instancer.** The marched-bone census only reads
   non-zero with `?gibbonemesh=0`; the default path is validated by the accepted
   2026-09-15 arrangement and the visible ribcage in the sheets, not by that
   counter.
8. **Owner acceptance is not claimed.** Model inspection is not the owner's
   playtest; the sheets and clips are the review material.
