# The biomech style: flesh in SDF, bone-metal machinery as sculpted mesh

The house style for Blud's biomechanical horrors, worked out on the **twinhead** (2026-10-21, PR goblincore/blud#52).
It is the **default for any new enemy or creature** (SKILL.md, "The default pipeline"), not only machine-flavoured ones. The owner's rule of thumb: **machinery is styled after the demon
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
