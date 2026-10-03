# Cut wounds and the head split — Design

**Date:** 2026-10-03 · **Status:** design approved by owner in chat; plan not yet written
**Branch:** `claude/head-explosion-effect-d6231e`
**Follows:** [slug head burst](2026-10-02-slug-head-burst-design.md) (its §11 and the build notes' playtest rounds 1-3).

## 1. Why

The slug head burst opens the head with craters. Owner playtest (2026-10-03): it does not read as the head splitting, and
craters cannot make "deep jagged cuts into the body". An axe, sword or chainsaw, and a head cleaved in two (the owner's
references: a zombie with the side of its head torn open into ragged sheets, the top peeled back), all need a wound that
slices along a line, deep, with jagged lipped edges, and for the head, two halves that open apart.

Measured facts that rule out the existing tools (explored 2026-10-03):
- A crater is a sphere carve riding one prim (`damage.ts` Wound, `webgpu/march/fields/wounds.wgsl.ts` `applyWounds`). It cannot
  make a long thin slot.
- `op 'sub'` carves the whole body after the fold (`fields/carves.wgsl.ts` `applyCarves`); there is no intersect op, and the only
  plane clip is the per-prim shell clip (`primitives.wgsl.ts` `sdShell`).
- The sever path cuts only BETWEEN whole prims (`gib-parts.ts` `cutBetween`, `capAt`); the zombie head is essentially one
  ellipsoid, and `gib-parts.ts` keeps the head whole on purpose. `attachPiece` has no rotation, no face projection, no wounds.
- Nothing moves the sample point per actor or per cluster today: the head rotation uniform is read only by the face layer.

## 2. Decisions (owner, 2026-10-03)

1. **One spec, the cut wound type first, then the head split** built on it.
2. **Version 1 depth: gashes plus the head split.** Cutting clean through a limb so it falls off is a later version (it will reuse
   the sever path; a cut decides when to call it).
3. **Test input: a plain rod as the stand-in blade**, swept by the player. The real axe / sword / chainsaw come later and call the
   same cut function.
4. **The split uses authored presets per character; the hit picks the nearest.** This is the owner's "prebaked split state, then
   dynamic": the preset is the prebaked shape, and craters and cuts keep working on top.
5. **The slug head burst stays** as the debris, blood and crater layer; its `split` outcome becomes the trigger for the head split
   once milestone 2 lands. While tuning, any head hit triggers it (the burst's debug defaults `anyWeapon`, `alwaysSplit`).

## 3. The cut wound (`cut-wound.ts`, pure)

A new wound SHAPE beside the crater. It lives in the same wound ring, `MAX_WOUNDS` long (32 since M1 Task 2), rides one prim's frame exactly like a
crater (so it moves with the body and is stamped against the same `posed` prims; see the orient-presence warning in the repo
notes), bleeds through the same bleed ledger, and stacks with later damage.

**Data (all prim-local, metres):**
- `shape: 'cut'` (absent = the crater, unchanged).
- `local` (the existing anchor) is the cut's START; new `localB` its END. Length ≤ `CUT.maxLen` (0.35 m).
- `bladeN`: the blade plane's unit normal (the slot is thin along it).
- `depth`: how far into the body the slot reaches below the surface at its middle (to bone and past it).
- `kerf`: half-width of the slot at the surface (the blade's gap, before raggedness), ~0.006-0.015 m.
- `lip`: lip swelling height along both edges; `seed` for the jagged walls.

**Building one from a slash** (pure): `cutsFromSweep(prims, hits: surface points along the sweep, viewDirs) → Wound[]`:
- groups consecutive hit points by the CLUSTER of their nearest prim (a slash across forearm and torso → one cut per cluster,
  at most `CUT.maxPerSlash` = 3); each group becomes one segment (first → last point, clamped to `maxLen`);
- `bladeN = normalize(cross(sweepDir, viewDir))`; depth and kerf from the weapon's calibre argument (the rod: one calibre);
- the cut rides the prim nearest the segment's midpoint.

The rod and later weapons all call `applyCut(actor, cuts, calibre)`; the leaf stamps the wounds through the actor (as the head
leaf does with `a.blast`), and registers bleeds at the cut's midpoint.

## 4. Cut rendering (hand-written WGSL)

In `applyWounds`, a wound with the cut shape evaluates a SLOT instead of a sphere:
- **The slot:** in the wound's frame, `t` = position along the segment (0..1), `u` = distance along `bladeN`, `w` = distance
  across the segment within the blade plane. The slot is `|u| < kerf(t)` and depth below the surface `< depth · profile(t)`, with
  `profile` a lens (deepest at the middle, tapering to points at the ends), so the walls meet in a V at the bottom.
- **Jagged walls:** the kerf is perturbed by the march's existing scalar hash noise along `t` and depth (no arrays: the repo
  warns that runtime-indexed arrays inside the fold once stopped the march shader compiling; scalar / vec only, checked with
  `scripts/compile-census.mjs`).
- **Lips:** both edges swell by `lip` within a short band outside the kerf, the crater rim's idea along a line.
- **Interior:** the existing wound interior shading (wet meat, the fat band, bone where the slot reaches the skull or a bone
  prim) keyed on the slot's mask instead of the crater's.
- **Data:** a cut needs its end point and `bladeN`/`kerf`/`lip`/`depth` packed per wound: two more rows in the wound texture
  (`webgpu/march/layout.ts`: today ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS). Whether free rows exist is
  unverified: the plan checks the layout, or reuses crater-only fields for cuts.
- **Bounds:** a cut's bound for the wound cull is the segment's capsule (`maxLen`/2 + kerf + lip), not a sphere of the crater
  radius.
- **CPU mirror:** none needed. The CPU body field (`validate.ts sdBody`) does not include craters today, so shots trace against
  the uncarved surface; cuts follow the same rule.

## 5. The rod (a weapon slot)

- A plain rod in view (a long thin capsule, dark steel), drawn like the other view-model weapons.
- **Input:** hold the fire button and sweep the crosshair; the rod follows the sweep; on release, the sampled crosshair rays'
  hits on bodies (traced each frame against the posed field) become cuts through `cutsFromSweep`. A sweep that touches no body
  does nothing. Its calibre: one fixed depth/kerf pair (tunable).
- **Seam:** `__sdfGame.cut(actorId, a, b, normal, depth?)` for gates and the console.
- Which slot: the plan picks a free one (`WeaponSlot` today is `'flail' | 'shotgun' | 'dynamite' | 'launcher' | 'flare'`).

## 6. The head split (WGSL + CPU mirror)

**Presets (pure, per character):** a small table, e.g. for the zombie:
- `sagittal` — down the middle, left and right halves, hinge low at the back of the skull, opening ~35°;
- `coronal` — face from back, hinge at the crown's back, the face half folding down and forward;
- `crown` — the top of the skull lifting off, hinge at one temple.
Each preset: a plane (head-local normal and offset), a hinge (head-local point and axis), a maximum angle, and the side that moves
(one half or both, mirrored). The hit picks the preset whose plane best matches the blow (the blade plane for a cut, the shot
direction for a slug).

**State (pure):** per actor: preset, opening angle driven by a jelly spring (kick, overshoot, settle at the preset's angle),
and an "open" flag. Deterministic, per-actor seeded where random.

**The warp (WGSL):** at the top of the per-slot body in `mapBody` (`webgpu/march/map-body.wgsl.ts`, right after `loadInstance`
and the alive check), for an actor whose split is open:
- choose the half by the side of the WEDGE BISECTOR the sample point is on;
- rotate the point by that half's inverse rotation about the hinge → `pw`;
- evaluate everything that follows in that slot body (fold, carves, wounds, procedural bones, `restPoint`) at `pw`;
- `d = max(d, plane distance at pw)` so each half ends in a flat face at the cut plane;
- outside a region above the hinge the warp is the identity, so the neck and torso are untouched.
The split state travels as one or two new vec4s in the per-instance record (`crowd-records.ts`, `REC_VEC4S`).

**The cut faces:** opening a split also stamps a cut wound along the plane on the head, so the faces are ragged and lipped and
show the skull's cross-section and the interior shading. (No brain prim exists in the field; the brain interior is shading,
or a later prim.)

**What else must follow the warp (from the exploration):**
- **Normals** come right automatically (`calcNormal` differentiates `mapBody`).
- **The face texture and wound masks** read the world hit point after the march (`webgpu/march/body/trace.wgsl.ts`), not
  `mapBody`'s: the post-hit blocks get the warped point `pw` and the inverse-rotated normal for the face sheet, wound masks,
  tissue and `restPoint`; lighting keeps world `p` and `n`.
- **The field jumps at the bisector:** the march step is clamped there (`min(d, distance to the bisector)`), and the
  upper-bound cull (`gCullRef`) is disabled for a split actor.
- **Screen tiles and proxy boxes** (built on the CPU from rest bounds) are inflated for a split head.
- **CPU shot tracing:** `sdBody` and `worldHitToWound` apply the same inverse warp, so later craters and cuts land on the opened
  halves, stamped in the un-warped head (where the GPU reads them).
- **The skull mesh** (`skeleton=mesh`, the forward default): each skull vertex gets its side's rotation in the vertex shader and
  the cut plane clips it in the fragment shader (`skeleton-spike/mesh-renderer.ts`, `mesh-skull.ts`). The procedural bone path
  follows the warp for free.

**Cost:** about one point rotation per march step inside the head's bound sphere, not a second head fold.

## 7. Milestones

- **M1 — cut wounds and the rod.** Pure cut model + tests; WGSL slot, lips, interior; the two wound rows; the rod slot and the
  `cut` seam; a gate. Usable on any body part, including the head.
- **M2 — the head split.** Presets + spring (pure, tested); the `mapBody` warp; post-hit shading on `pw`; CPU mirror; tile
  inflation; the skull mesh; the slug burst's `split` outcome and any-head-hit debug trigger now open the split; a gate.
- **M3 — tuning with the owner.** Kerf, depth, lips, raggedness, preset angles, spring.

## 8. Testing

- **Pure (vitest):** `cutsFromSweep` (grouping by cluster, clamping, normal from sweep × view, one cut per cluster, the cap);
  the cut's slot math mirrored on the CPU for tests (lens profile, kerf, lips); preset choice from a blow; the warp and its
  inverse round-trip (a point maps back to itself; each half rotates about its hinge; identity below the hinge region); the spring
  (kick, overshoot, settle exactly).
- **Shader:** `scripts/compile-census.mjs` on every WGSL change; `scripts/march-hash.mjs` re-pinned with the reason recorded;
  cold-boot `drawOnce` compared against the base branch with `scripts/boot-time.mjs` (shaders change, so boot time is a gate).
- **Capture gates (headless WebGPU, real input):** M1 sweeps the rod across a torso and a head: a slot is visible (dark interior
  and lit lips measured across the cut line), bone shows where it reaches the skull, wounds survive the ring rules, frame cost
  reported. M2 shoots a head: the halves open (the gap between the two face halves measured in pixels, growing with the spring and
  settling), later shots still crater the opened halves (a crater lands where the predicted ray hits), the skull mesh splits,
  frame cost and boot time reported.
- **Honesty:** the march's timer on this machine spreads by milliseconds between identical runs (burst notes); cost claims are
  structural unless measured on a quiet machine. Whether it looks like the references is the owner's call.

## 9. Out of scope

- Severing through a limb with a cut (later; the sever path exists).
- Real blade weapons (axe, sword, chainsaw) beyond the rod stand-in.
- Torn flesh SHEETS hanging off the cut (the owner's reference look; needs flat geometry — see the burst notes' monster idea).
- Splits on characters other than the zombie (presets are per character; others come after the zombie looks right).
- The Rust/wgpu port (the WGSL is written to port).

## 10. Open questions for the plan

1. Free rows in the wound band layout for the cut's extra data, or which crater-only fields a cut can reuse.
2. The exact post-hit block list that must take `pw` (face, wound mask, tissue, `restPoint`) and how to pass two point/normal
   pairs through it without breaking the compile census.
3. How the skull mesh's instances get a per-side transform and clip (new uniforms on the existing material, or a second
   instance with a complementary clip).
4. Which weapon slot the rod takes, and its view-model asset (a primitive is enough).
5. Whether the split's cut-face wound uses the ring like any cut or a reserved slot (it must not be evicted while the head is open).
