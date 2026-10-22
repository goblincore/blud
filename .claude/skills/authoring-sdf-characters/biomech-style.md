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

## Converting an existing body (the butcher, 2026-10-22)

The butcher (`characters/butcher.blob`, kit `assets-source/butcher-kit/`) is the zombie converted, not a new body.
What a conversion needed that the twinhead did not:

- **Start from the base `.blob` and keep its skeleton names.** Copy the body, thicken the masses (muscle is mass
  plus the normal map), and carry the base's `bones` block over verbatim if the torso only grew. Renamed or extra
  leg bones are what broke the twinhead's gait.
- **Keep it reading as the base.** The owner rejected a sallow tan skin at once: it read as the ogre, not as a
  zombie. A variant keeps the base's skin family (the zombie's pink, paled toward white) and takes its menace from
  the machinery, the silhouette and the weapon.

### Reverse-knee (digitigrade) legs on the three leg bones

The gait knows `thigh -> knee -> foot -> toe`, and its foot-plant IK always bows the KNEE forward
(`ik.ts solvePlantedLeg`). A dog's hind leg already does that: its forward joint is the knee, and the joint that
points back is the HOCK (ankle). So no rig change is needed:

| bone | anatomy | butcher rest direction |
| --- | --- | --- |
| `thigh` | femur | `dir=down pitch=35` (knee 23 cm ahead of the hip) |
| `shin` | tibia | `dir=down pitch=-38` (the hock, the gait's `foot` joint, behind the hip) |
| `foot` | metatarsal | `dir=down pitch=15` (the toe joint on the floor) |

`pitch` is the bone's ABSOLUTE direction (`blob-compile.ts dirVector`), +z forward. The model still declares
`stance humanoid`: `checkStance` measures the thigh/shin knee, and that knee is forward. The trade-off: the
metatarsal translates rigidly with the hock (the gait drives `toe` with the foot's offset), so there is no toe-off
roll. A true four-joint chain would need a new gait joint, `JOINT_AT` entries and IK changes.

**Match the cadence to the leg.** A planted foot holds while the body travels `cruise x stance time`. The shamble's
cadence at the butcher's 1.45 m/s dragged every leg dead straight (0.86 m per stance against about 0.54 m of
sweep). Its own `PROWL` gait (1.8 Hz, duty 0.55) keeps the knee bowed. `characters/butcher-blob.test.ts` walks the
real pipeline and pins the knee forward and the hock back; copy it for any new leg shape.

The look: the hock is the read, so it carries the biggest shape (a knuckle with a curled spur raking back and up).
Spines rake down the BACK ridge of the tibia, toes splay forward with talons, and a dewclaw sits behind.

### A weapon grafted onto an arm

- The weapon is kit on the forearm bone, so the arm's own swing carries it: no held prop and no sword mind.
  `MotionProfile.armWeapon {side, damage}` pins every swing to that arm (`brain.ts swingSide`) and sets the hit's
  damage (`game-loop.ts`, in place of the zombie bite).
- Face the edge to the body's BACK at rest. Pitching the arm forward turns it DOWN (the reach walk), and overhead
  it faces forward, so the chop leads with it. Facing it forward at rest pointed the edge at the ceiling in the
  reach walk.
- **Do not voxel-remesh a blade.** A 1.6 mm voxel rounds a 2 mm edge away. Build the head as a bmesh loft (thick at
  the haft, about 1 mm at the edge), join the ornament tubes unremeshed, and colour it with `wear_colours`
  (steel, then rust, then blood toward the edge). Only the haft and graft collar are fused and AO-baked.
- A graft collar with staples biting into the flesh above it, plus feed hoses down the forearm into the collar,
  sells "grafted" more than the weapon itself.

### Hoses, wires and ports

- A hose is a Catmull-Rom tube with a rib ring every 1.6 cm, fused, with brass collars at both ends
  (`make_upper.py hose()`). Place its control points from **skin probes** (march `sdBody` along a ray, as the
  detail generators do) and keep them about one hose radius out.
- A hose rides ONE bone. Break it at a joint: end one segment in a port where the next begins (pump on `spine`,
  neck hose on `neck`, socket on `skull`).
- Where a hose enters the flesh, set a bony flanged port with bolts. The swollen flesh round it is in the normal
  map's agitated lumps.
- Coloured wires (the reference figure's yellow and blue) use kit-overlay's dielectric looks `yellow`, `blue`,
  `red` and `purple`. Wind them close: 1-2 turns per bone at about one wire radius off the shell. Looser and more
  turns read as springs.
- Collars and other small fused bits still need `decimate`. Undecimated brass collars were 60% of the first
  butcher kit's 250k triangles.

### A second variant on the same frame (the flayer)

The flayer (`characters/flayer.blob`, kit `assets-source/flayer-kit/`) reuses the butcher's skeleton exactly, so
its legs are the butcher's leg kit rebuilt (`make_legs.py`, with wires recoloured by the kit's `common.py`) and the
gait work carries over. What makes it a different enemy at a glance:

- **A different silhouette class:** gaunt (the zombie's own masses) against the butcher's pumped bruiser. A dorsal
  ridge of long raked spines replaces the back pump.
- **A different weapon on the other arm:** a long serrated sickle on the left, with a saw wheel in a bony guard. A
  thin blade vanishes from the front, so give it width: 11 cm at the root, not 6.
- **A different head:** a bony helmet over the upper face with a glowing visor slit (the `led` look, emissive 1.4;
  `eyeglow` at 7 is for pinpoints), cheek guards, and curled horn "ears". The flayed jaw below is the decal's job.
  Fit the shell to probes of the head: crown, front at three heights, back and sides, 10-16 mm clear.
- **Faster means quicker steps, not longer ones.** At 1.55 m/s the 1.8 Hz prowl flattened the knee, so the flayer
  walks a 2.0 Hz `PROWL_QUICK`. Re-run the walk pin whenever cruise changes.
- The lab's `holdPose` swing preview (`BLOB_SWING`) swings `armWeapon.side`, so a left-armed weapon is judged on
  the right arm.

### Practicalities

- **The Blender MCP window may belong to another session** (it held the teratoma's file). Run the kit headless:
  `Blender -b assets-source/butcher-kit/butcher-kit.blend --python assets-source/butcher-kit/build.py -- make_legs.py:femur,tibia --export --preview <dir>`.
  `build.py` runs the make scripts, saves, exports `mech` and renders workbench previews. It serves any kit: open
  that kit's `.blend`, and scripts resolve in its folder first, then `butcher-kit/`.
- `blob:shot` reuses ANY lab on its port, including another worktree's Vite, so pass your own
  `LAB_VITE_PORT`/`LAB_CDP_PORT`.
- A face-block head can wear a generated decal: solve `projScale`/`projCentre` in the head space of the face
  block's ellipsoid (offset / semi-axis), against eye embers you place yourself.

## Budget

The twinhead kit is about 145k triangles, too high for crowds. Planned optimization: bake each sculpt's
detail into a normal map on a low-poly cage, aiming for 2-4k triangles per part. Author at full detail first;
optimize once the look is approved.
