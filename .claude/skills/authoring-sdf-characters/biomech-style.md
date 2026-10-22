# The biomech style: flesh in SDF, bone-metal machinery as sculpted mesh

The house style for Blud's biomechanical horrors, worked out on the **twinhead** (2026-10-21, PR goblincore/blud#52).
Follow it for any new flesh-and-machine enemy. The owner's rule of thumb: **machinery is styled after the demon
skull (organic curves, ridges, bony metal), never basic shapes.** Boxes, drums and plain cylinders read as
placeholder robot parts.

## Split the body by what is cheap

| Part | Made as | Why |
| --- | --- | --- |
| Flesh (torso, arms, heads) | `.blob` SDF prims | gore, wounds, cut faces, blending: the SDF's strengths |
| Flesh detail (muscle, ribs, veins, knots) | baked **body normal map** (`<char>.detail` + `bake-body-normal.ts`) | detail as prims costs every pixel; as a map it is free |
| Machinery, armour, horns, weapons | **kit mesh** (Blender -> `scripts/blender-kit.ts`) | triangles are cheap next to SDF prims; mesh carries far more detail |
| What the mesh hides | a thin SDF **core** inside it | keeps the rig, gait and stranded checks happy; must never show through |

Keep the marched prim count low (the twinhead's torso: 35). Push detail to the normal map or the mesh.

## The look of the machinery

- **Silhouette first.** Every plate tapers, comes to points (front of the thigh over the knee, cheekbone-like
  sweeps on the pauldron edge) and rounds its corners. No square-cut ends.
- **Crests.** A raised double ridge (a base and a blade on top) runs along each major plate.
- **Chevron ribs.** Ridges rake down and back from the crest, like the skull's cheek ridges. Level bands read
  as a barrel.
- **Rolled lips** on every free edge, as thick as the bone around an eye socket.
- **Curled horns and spines.** Spines rake back along crests and shins, and a horn grows from a knee or hip.
  Talons and barbs curl. Use `horn()`.
- **Cranial sutures.** Zigzag grooves pressed into broad surfaces.
- **Knuckles** at joints: bony bosses with ring ridges, not drums.
- **Layering.** Lames cascade and overlap, tucking under the plate above. No gaps you can see through.
- **Surface.** A low clouds-noise hammered-ness, plus AO baked into vertex colours. Material is `skullmetal`.
  Brass and chrome are accents only (a band, a piston rod). Pistons are kept for the pneumatic read, but
  sculpted with ribs, a mount and a gland.
- **Tone.** Match the skull's silver (vertex colour mean about 0.4). AO baked at the default distance went black
  under neighbouring parts; bake with `ao_dist` 0.05 (local crevices only).
- **Wear.** Colour where the story is. The spike runs steel, then rust, then dried blood at the tip, with drips
  down the flutes, as vertex colours.

## The flesh

- Mottled, scarred, agitated: clustered swellings round seams, thin red crack scars (`# SCAR` bars), wounds as
  torn carves plus a decal stain. Painted lips made flat discs; swellings made a pig snout.
- **Muscle definition and varicose veins come from the normal map**, on the torso and on each flesh limb
  (`--limb bone:t0:t1:rMax:rows` regions; arm detail is generated on the arm skin with `side=` prims).

### Varicose veins that read (three attempts on the twinhead)

| Attempt | Result | Lesson |
| --- | --- | --- |
| r 3.5 mm, 1.6 mm proud, a few hand-placed points | vanished in the bake | too thin and too low to survive a 512-px map |
| alternate sides of the trunk every 22 mm sample | baked as sharp **zigzags**, "ZZZ" stitch marks | a straight bar between alternating points is a zigzag, not a meander |
| a sine meander, ~3.5 cm wavelength, ~1.4 cm swing | read as **crumpled skin** on the arms | too short a wavelength and too much swing for the limb's size |
| a sine meander, **~10 cm wavelength, ~1 cm swing**, 5-11 mm samples | ropey, branching veins | **this is the recipe** |

The recipe (`armVaricose` / `varicose` in `scripts/twinhead-detail-gen.ts`):
- **Size and density:** trunks 5-6.5 mm thick, 3.5-4.5 mm proud. Sample every 5-11 mm along the path, so each
  bar is short and the curve stays smooth. Taper the radius toward both ends (55% to 100%).
- **The meander:** offset the trunk by `amp * sin(phase)`, with `phase` advancing a little and a little randomly
  per sample (about 0.22-0.36 rad on arms), plus a slow drift in angle. Never alternate sides per sample.
- **Knots:** a bulge (1.5-2.1 times the radius, 30% prouder) at about one sample in five or six. More than that
  and the vein reads as beads.
- **Branches:** one per trunk on limbs, two on the torso; each branch is 65% as thick and peels off at 30-55 deg.
- **Placement:** probe the skin per sample (march the plain body along a ray), sink the bar so its top stands
  `proud` out, and bind it to the nearest bone. Check by measuring each prim's top against the plain skin; it
  should sit 2-5 mm out.
- **Where:** down the flanks into the waist, outboard of the abs, across the upper chest to the armpit, over the
  lats, and down the biceps, outer arm and back of each upper arm and the forearm flesh.
- Faces are a generated decal (`decal 0`, `blendLuma 0` for colour) on the head's fattest prim.
- A machine head is all kit mesh; the flesh neck stops short and cables fill the gap.

## The toolkit: `assets-source/twinhead-kit/kit_sculpt.py`

Run inside Blender with `exec(open(path).read())`, then a `make_*.py`. Everything is in Blender coords; `bv(x, y, z)`
converts blob rest coords (blob (x, y, z) -> blender (x, -z, y)).

- `BoneFrame(head, tail)` with `bone_shell(...)`: a carapace wrapped round a bone. Front/side radii are
  functions of `t`; the edge outline `t0(ph)`/`t1(ph)` makes points and round corners.
- `surface_solid(P, N, ...)`: any closed shell from a surface patch, e.g. the pelvic girdle or the pubic shield.
- `tube`, `ring`, `ball` (scaled icosphere) and `horn` (tapered, curling): crests, lips, ribs, knuckles, talons.
- `fuse(name)` voxel-remeshes everything in the work collection into one organic part (2 mm), smooths it and
  adds noise. Use `press_lines(o, zigzag(...))` for sutures.
- `decimate`, `bake_ao` and `install(o, '<bone>|<part>')`, plus `mirror_to_r` for the right side.

Worked examples:

- `make_pauldron.py`: the ellipsoid cap and lames.
- `make_body_armour.py`: thigh, shin, knee, ankle, foot, pistons, pelvis, spine and back pod.
- `make_spike.py`: a fluted loft with wear colours.

Each has a `PARTS` subset switch, so one part can be iterated in about 5 s.

## The loop

1. Find each joint in blob rest coords. The kit glTF's joint nodes give the heads; for prim ends, run
   `buildBody(compileBlob(...)).prims`.
2. Write or extend a `make_*.py`. Name each part `<bone>|<part>`; every vertex rides that one bone.
3. Look in Blender first (workbench matcap, three angles), then in engine:
   - export the `mech` collection with `export_vertex_color='ACTIVE', export_attributes=True`
   - run `npx tsx scripts/blender-kit.ts <char> <parts.glb>`
   - check with `LAB_TMP=.lab-tmp npm run blob:shot -- <char> <dir> 8`.
4. Hide or shrink any SDF prim that pokes through the mesh, keeping its overlap with its neighbours (`strandedOf`).
   Then re-pin with `npx vitest run src/lab/sdf-zombie/pack-golden.test.ts -u`.

## Gotchas

- An EXACT boolean on a voxel-remeshed mesh collapsed it to 38 faces. Press grooves in by moving vertices
  (`press_lines`) instead.
- Voxel remesh a whole, nearly closed mesh. Cropping first opens holes and the remesh collapses.
- Set `render_color_index` on the colour attribute, or COLOR_0 exports white.
- A per-part light rebuilds pipelines, so glow is baked: a `_glow` vertex attribute plus `GLOW_FROM_ATTRIBUTE`
  in `kit-overlay.ts`.
- Lighting falls off toward the ground in the lab shots, so judge the legs' tone from close frames.
- In a loop, a local named like a helper (`ring = []`, or `base` from an earlier lambda) shadows that helper.

## Budget

The twinhead kit is about 145k triangles, too high for crowds. Planned optimization: bake each sculpt's
detail into a normal map on a low-poly cage, aiming for 2-4k triangles per part. Author at full detail first;
optimize once the look is approved.

## Lessons from the teratoma (2026-10-22, the second character built from this guide)

The teratoma (`characters/teratoma.blob`, kit `assets-source/teratoma-kit/make_teratoma.py`) is a cacodemon-style
floater: a flesh ball with one eye and a maw. It was the first test of whether this guide gives better first results.

**What worked as written**

- The split table. The flesh is 35 marched prims. The folds, veins and nodules are a baked normal map, generated by
  `scripts/teratoma-detail-gen.ts` from the twinhead's template. Everything hard is kit.
- `kit_sculpt.py` worked unchanged, used as-is: `horn`, `tube`, `ring`, `ball`, `fuse`, `press_lines`, `bake_ao`,
  `install` and `mirror_to_r`. A part takes about 5-15 s to rebuild, so iterating in the engine is fast.
- The baked `_glow` route for an eye: a yellow slit eye whose glow is per-vertex (the iris burns, the slit is dead).
- Teeth as kit. The owner's rule: SDF teeth eat the prim budget.
- An additive mouth: a dark gullet prim recessed behind the lips, never a carve.
- The varicose recipe above, once it arrived mid-session. The teratoma's first torso veins, copied from the twinhead's
  older torso `varicose`, broke it (a ~1 rad phase step on 12 mm samples, a several-cm swing) and were re-generated
  before baking. The torso `varicose` in `twinhead-detail-gen.ts` still has those older numbers, so copy from
  `armVaricose`, not from it.

**What was missing (now added above or below)**

1. **Convert the creature from the start.** The first pass followed the brief literally (flesh, keratin horns,
   shackles) and the owner called it "too on the nose". The fix was this guide's own style applied to a creature whose
   brief never mentioned machinery. So treat every Blud enemy as a strogg CONVERSION: graft skullmetal onto the meat
   (a crest-plate that the horns grow out of, a demon-skull socket as the brow, a mandible with jaw pistons, an organ
   that explains its locomotion, such as a hover keel with vents) even when the brief does not ask for it.
2. **Wires and tubes in and out of the flesh** (owner: "more wires and tubes going in and out of the flesh"). Write a
   run as `(lat, lon, off)` controls. `off > 0` arches the run out of the skin; `off < 0` dives it under the skin, where
   the SDF hides it. Twisted black `cable` bundles, corrugated `hose` feed lines and brass ferrules where a run leaves
   the metal. Every place a run dives in gets a small raw wound prim in the `.blob`. The script prints the points.
3. **A body with no bone axis needs a skin table.** `BoneFrame`/`bone_shell` assume a limb. To seat anything on a
   ball, `scripts/teratoma-skin.ts` writes `skin.json`: the marched torso's outermost surface and normal on a lat/lon
   grid. `sk(lat, lon, off)`, `skn` and `cap_dir` (a polar patch round a pole) build on it. Re-run it after every torso
   edit. A good candidate to move into `kit_sculpt.py`.
4. **A carapace is a graft, not a helmet.** A cap covering the whole crown read as a motorcycle helmet. Keep plates
   partial (~35 deg of arc), with raked POINTS on the outline and the meat swelling round them.
5. **Colours are LINEAR and a new material is WHITE.** Vertex colours are linear, so a "near-black" 0.10 shows as
   sRGB ~0.35, mid-grey. Dark keratin is ~0.02-0.05. A fresh Blender material exports `baseColorFactor` 1, and the
   first conversion rendered as polished chrome. Copy the base colours from the twinhead kit: skullmetal
   (0.30, 0.31, 0.33), chrome (0.42, 0.44, 0.48), iron (0.055, 0.058, 0.065), cable (0.05, 0.05, 0.055),
   brass (0.32, 0.20, 0.07). On a large plate, `bake_ao` at gain 1 goes near-black against pink meat; use gain 1.5,
   gamma 1.6.
6. **`GLOW_FROM_ATTRIBUTE` is keyed by material NAME.** A glow in a second colour needs an alias material:
   `orbitmetal` is skullmetal whose `_glow` burns the eye's yellow, not the twinhead's red.
7. **Painted `.blob` colours render more saturated than their hex suggests.** `b8606a` lips came out as clown
   lipstick, and the twinhead's raw-pink wound colour read as red beads on a smaller body. Go muted (`a8706a`,
   `7a3c3c`) and let `gloss` carry the wet or filler look.
8. **Lips: the plain first pass won.** Two filler-lip passes were rejected. The first was painted glossy pink at
   r 0.095 or more, with a cupid's bow ("triangular, two weird knobs"). The second was one round bowed capsule per
   lip ("too smooth, too red"). The owner kept the original: unpainted, hide-coloured, tapered half-lips (r 0.068 /
   0.076 tapering to 0.032). Only the hide's mottle and noise give them texture: baked lip furrows were tried and
   taken out ("better without"). Lesson: a painted glossy lip reads as a separate material, and so does a combed
   one. Unpainted swelling flesh is the house look. For a round lip, the shape that worked was a constant-radius
   `bar` from corner to corner with `bend`, whose middle moves by about half its value. For detail at that scale
   bake 1024 wide: at 512 the torso map is ~7 mm a texel round a 1.2 m ball.
9. **Settle the flesh before baking.** The torso bake takes ~15 min, and any torso edit (a brow, lips, a wound prim)
   invalidates it. Bake last.

**Engine gaps this exposed (fixed on the teratoma's branch)**

- `makeMotionJoints` threw on a body with no feet, so a legless body could be neither shown in the lab nor spawned. Leg
  lengths are now 0, `groundY` is the floor, and the plants are skipped.
- Floaters walk with the `HOVER` gait (gait.ts): a root heave, a drift and a nod, with no stepping.
- A ranged enemy without a held prop: `MotionProfile.spit` fires from a rig point plus a body-local offset (the
  teratoma's maw), using the warbull's slow rocket as its fireball. A real flying mind (holding altitude, strafing
  over cover) is still missing.
