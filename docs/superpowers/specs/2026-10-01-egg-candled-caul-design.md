# Night Train egg: the candled egg and the torn caul — Design

**Date:** 2026-10-01 · **Status:** approved by the owner in chat (2026-10-01), then **paused** the same day: the owner wants to think about the egg more before a plan is written. Not built.
**Kind:** design. **Changes:** the control-room egg's look and how it is drawn. **Supersedes** §2 ("The egg") of the
[ending spec](2026-09-30-night-train-egg-ending-design.md); the room, the trigger and the sequence system are unchanged.
**Look-dev:** [Cycles renders + generator script](../../dev-notes/2026-10-01-egg-lookdev/) (round 1: lights and three
outer-flesh directions; round 2: the caul's levers, cumulative).

## Why

- The owner's verdict on the plan-2 egg: it reads as **semi-translucent glass**, which is not how an egg surface works. The egg
  should be an egg with a **powerful backlight or bottom light**, the light passing through the shell and showing what is inside.
- The outer veined egg is "not very good". It should be **grotesque and fleshy**: body horror, *Tetsuo: The Iron Man*. Flesh
  fused with metal, wet. **Gooey and shiny** are the key words for this egg and for the monitor transition that follows it.
- **The physics, which the look-dev confirmed.** An eggshell is diffuse-translucent: it is opaque to images and passes light.
  You never see *through* a backlit egg. You see light coming through it, and what is inside reads as **shadows on the shell,
  cast from the light source** (candling). Vessels on the inner membrane are sharp; a body deep inside is a smudge, and it
  sharpens as it nears the shell. The plan-2 pass composes tinted transparent layers along the eye ray, which is why it reads
  as glass.

## Decisions

1. **The inner egg is a candled egg:** opaque, chalky, wet, glowing from inside. It replaces the milky spotted inner egg.
2. **The outer egg is a torn caul of wet flesh**, chosen over a closed sac and a nest/cradle
   ([round 1](../../dev-notes/2026-10-01-egg-lookdev/r1-outer-flesh.png)). All three round-2 levers are kept: lips that thin
   and peel outward and glow red, a torn glossy film over the egg, and mucus (strands, drips, a pool)
   ([round 2](../../dev-notes/2026-10-01-egg-lookdev/r2-caul-levers.png)).
3. **The caul is a Blender mesh** built through the kit pipeline with a lit wet-flesh material, chosen over an SDF body (no
   static SDF prop path; thin torn membranes are awkward in prims; a close 2 m mass marches like a close zombie or worse) and
   over tracing it inside the egg pass (no room light; costly up close). What the owner approved in Cycles is what ships.
4. **The figure drifts toward the shell as you approach.** Sharpness comes from its distance to the shell, so `egg.resolve`
   becomes how far it is allowed to come: 0 stays deep (always a smudge), 1 presses against the shell.
5. **The spots go.** They belonged to the milky egg; a candled egg has none. Montage shot 4 ("spot") becomes a close-up of a
   vessel or of the figure pressing out (the montage spec decides).
6. **One heartbeat drives everything:** the lamps, the vessels' throb, the caul's swell, the strands' sway and the room's egg
   light (which ignores the pulse today).

## 1. What you see

| Part | Look |
| --- | --- |
| **Inner egg** | 1.2 m wide, 1.64 m tall (semi-axes 0.60 × 0.82, narrower at the top: taper 0.12), its centre 1.5 m above the floor and 1.1 m above the plinth top. A chalky, mottled cream shell, wet (a clear-coat highlight). It glows: brightest at the base, warm amber through peach |
| **Lamps** | A **bottom lamp** 0.1 m above the inner egg's base, inside it: the hot base, and it throws the figure's head shadow up toward the crown. A softer **core lamp** 0.26 m behind the figure (seen from the door): the round glow that makes the figure a silhouette from the front ([round 1](../../dev-notes/2026-10-01-egg-lookdev/r1-inner-lights.png), C) |
| **Vessels** | A dark-red branching net on the inner membrane, fanning from where the figure's stalk meets the shell (front, a little low): ~7 trunks, branching up to three times, thinning. Sharp, because they lie on the shell |
| **The figure** | The soft blobs of plan 2 reshaped to a curled body with a large head. Only ever a shadow on the shell |
| **Caul** | A lumpy, sagging membrane round the egg (semi-axes about 0.88 × 1.18, centre 1.52 m, vertical folds), torn open mostly toward the door. Raw-meat palette: clotted near-black, red, pink, yellow fat, bruise purple; raised bluish vessels; pores. The flesh is up to 7.5 cm thick and thins over the last 11 cm to each tear, where the lips peel outward 3.5 cm and the egg's light comes through them deep red |
| **Film** | A torn amniotic film inside the caul, stretched over the egg in the tears: glossy, faintly pink, veined |
| **Mucus** | ~18 strands across the tears, sagging, each with a bead gathered at its low point; ~9 tethers from the lips back to the egg (it is stuck in it); ~12 drips with beads from the lower lips; a blood-tinged slick pooled on the plinth |
| **Metal** | The plinth's six steel clamps bite into the flesh; the plinth's cables and a few from the ceiling enter through swollen flesh collars |

**From behind** the caul is mostly closed, and where it is open you see the core lamp's hot glow with the figure faint in
front of it. The figure reads from the door side; the light reads from behind. That asymmetry is intended.

## 2. The inner egg pass

A rewrite of `egg.wgsl.ts` with its pure twin `egg-look.ts`, on the same proxy box and the same uniforms seam (`look` = pulse,
resolve, time).

- **Opaque and depth-writing.** The pass discards a miss and writes the analytic hit's depth through `depthNode` (the trick
  in `humanoid-view.ts:198-208`). It moves from the SDF layer's late scene into the **main scene** as an opaque object, so SDF
  bodies and the blood goo depth-test against it, and the caul's transparent film draws in front of it in the normal
  transparent pass. (Today the egg writes no depth, so goo behind it can paint over it.) The pass stays unlit
  (`skipLevelLights`): the egg is a light, not a surface the room lights.
- **Shape.** The ray meets the plain ellipsoid analytically, then two or three refinement steps along the ray land on the
  tapered egg.
- **Light at a surface point `p`** (the first hit): for each lamp `L`,
  `E(p) += I_L · pulse · falloff(|p − L|) · exp(−τ_fig(L → p))`,
  where `τ_fig` is the figure's optical depth along the segment from the lamp to `p`: each Gaussian blob integrated in
  closed form, counted when its closest approach lies between `L` and `p` (the existing `tCore` idea), and widened with the
  blob's distance from `p` (the shell's diffusion: near blobs cast sharp shadows, far ones smudges). The colour is
  `shellTint(p) · vesselTransmit(p) · E(p)`, plus a cheap wet highlight (a fixed key direction, as the flail fakes one).
- **Vessels and mottling** come from a **small baked texture** (an octahedral or equirectangular map of shell direction,
  about 1024², tracked under `public/assets/lab/`), generated in Blender from the look-dev's vessel growth. Authored vessels,
  not a noise formula; it suits the pre-rendered look. The pulse darkens and slightly widens them (the throb).
- **The figure's drift.** The blobs share an offset toward the shell **on the player's side**, eased over about two seconds,
  growing from zero at the resolve range's far end to `resolve × maxDrift` (about 0.3 m, bounded so no blob crosses the
  shell) at its near end. Pure in `egg-look.ts` (`figureDrift(dist, dirToPlayer, setting)`), tested.
- **Removed:** the outer shell, the milk volume, the spots and their tables.

## 3. The caul

- **Kit piece `egg-caul`** in `scripts/levels/build_train_kit.py`, ported from the look-dev generator
  (`docs/dev-notes/2026-10-01-egg-lookdev/lookdev.py`, `CAUL_LEVEL=3`) with fixed seeds, so a kit rebuild reproduces it. It
  places on the existing plinth; the plinth and its clamps stay. Four parts, one material each: **`train.caul`** (the flesh,
  with its raised vessels and cable collars), **`train.caul-film`**, **`train.mucus`** (strands, tethers, drips, beads),
  **`train.caul-pool`**. The flesh's colour variation and its **thickness** (1 in the body, falling to 0.1 at a tear) are
  baked into vertex colours; pores and fine relief come from a small tiling normal map. The game mesh is decimated well below
  the look-dev's density: at most 40,000 triangles for the four parts together.
- **The `train.egg` placeholder stays as the anchor** that `createEgg` finds, resized to the inner egg.
- **The flesh material in the game** (`game-egg-leaves.ts` or a sibling leaf): a `MeshPhysicalNodeMaterial` with clearcoat and
  sheen (the brain gib's recipe, `game-brain-gib.ts:70-103`) on the control room's light list (`lightsNode`). Three node terms
  on top:
  - **egg light:** an emissive deep red-amber, `eggGlow(pulse) × falloff × (thinness + wrap(N · toEgg))`, so the lips and the
    inward faces light from the egg as in the renders;
  - **a fake key highlight** on the clearcoat, because the room's fire-mood lamps are diffuse-only (the cheap light tier);
  - **the swell:** `positionNode` pushes each vertex along its normal by about 1–1.5 cm × pulse × (1 − thinness), with the
    matching shadow position node.
- **Film:** glossy and alpha-blended, its alpha from its own torn mask; no real refraction. **Mucus:** glossy, nearly opaque
  milky amber, swaying a little on the pulse (vertex). **Pool:** a flat, glossy dark-red slick.
- **These meshes get their own materials, so `batchArt` leaves them out of the room batches.** Collision is unchanged: the
  plinth (radius 1.2 m) keeps the player out, and the trigger ring is at 1.6 m.

## 4. The pulse and the room

`eggPulse` (unchanged: a heartbeat on the train clock, quickening as you approach) drives the lamp intensities, the vessel
throb, the caul's swell, the mucus sway, and **the control room's egg lamp** (the fire-mood light at the egg's centre), whose
intensity now follows it. The egg stays the room's main light.

## 5. Budget

- **Draws:** about +4 in the control room (caul, film, mucus, pool). Art is not culled by room yet, so they count at every
  pose: the train gate's worst pose goes from +182 to about +186 of +200. If the gate fails, per-room art visibility (hand-off
  item 5, reusing `nearRoomMask`) lands first.
- **Frame cost:** the egg pass gets cheaper (one surface, not three composed layers and a milk volume); the caul costs about
  what a large lit physical mesh costs. Measured by `sdf-egg-check`'s cost step.

## 6. Verification

- **Unit tests** (`egg-look.test.ts`): the tapered-egg hit; lamp transmission (a blob between the lamp and `p` darkens it, a
  blob beside the path does not); the shadow's blur grows with the blob's distance; `figureDrift` is zero at range, points to
  the player within range and never pushes a blob through the shell; the pulse as before.
- **The headless boot compiles the WGSL** (nothing in node does): `scripts/sdf-egg-check.sh` boots the game and is the
  compiler.
- **`sdf-egg-check` updated:** wiring (the egg in the main scene, opaque, writing depth); a body placed behind the egg is
  hidden and one in front is drawn; contrast boxes re-chosen on fresh frames (the figure's shadow darker than the shell
  round it at drift 1; vessels present); the pulse's range; cost. Adjust boxes, never thresholds.
- **A look sheet** from the game beside the Cycles look-dev at matching poses (door, near, behind, pulse 0 and 1). Changes go
  one lever at a time with side-by-side sheets, as the owner prefers.
- **Gates:** `sdf-game-train-gate.sh`, `sdf-game-loop-gate.sh`, `sdf-disco-check.sh` pass; `tsc` shows only the pre-existing
  `pack-golden.test.ts` error.

## 7. Changes elsewhere

- The [ending spec](2026-09-30-night-train-egg-ending-design.md): a status note that §2 is superseded by this spec, and that
  shot 4 loses its spot.
- `build_train_kit.py` (the `egg-caul` piece, the resized placeholder) and a kit + art rebuild. The hand-off's warnings
  apply: build the kit in place; restore `kit-textures/*.png` and the art GLB if they churn with no art change; the level JSON
  must not move rooms 1–7.
- `docs/tasks/levels.md` item 4n and `TASKS.md`.

## Out of scope

- The montage (plan 4 of the ending spec), the monitor room and the membrane push-through: the next spec.
- The "inside the egg" montage shot: the opaque shell needs a back-face case for a camera inside it; a small addition with
  the montage.
- A shootable SDF caul (flesh that wounds and bleeds): possible later, its own spec.
- Sound.

## Risks

- **Wet without specular lights.** The room's lamps are diffuse-only, so the caul's shine rests on the fake key and the
  egg-light term. The look sheet is the check.
- **Transparency.** The film blends over an opaque egg in the main scene's transparent pass; check its order against the
  blood goo, the fog and the VHS grade.
- **Mesh density.** The look-dev caul is far too dense; decimation must keep the torn lips' silhouette.
- **Moving the egg out of the late scene.** Check that the SDF composite depth-tests against it and that nothing else relied
  on the egg being late (the egg check's `inLateScene` wiring assertion changes). Deferred mode skips the late scene today;
  check whether the egg now shows there.
- **Kit rebuild churn** (textures, the art GLB) as recorded in the hand-off.

## Open questions

None blocking. Who the figure is stays open (ending spec, open question 2).
