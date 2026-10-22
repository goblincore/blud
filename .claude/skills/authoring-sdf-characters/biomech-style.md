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

## Non-humanoid rigs (the gorehound, 2026-10-22)

The gorehound (`characters/gorehound.blob`) is a four-legged dog-frog on the BIPED rig. Read this before inventing
new bones for a creature.

**Keep the standard bone names.** Every system downstream keys on them: the gait's joint table (`gait.ts`
`JOINT_AT`), plants, sever, gore, damage and the pins. One unnamed bone makes `makeMotionJoints` return null and
the body stops moving (the twinhead's extra bones did exactly that). So map the anatomy onto the names:

| Anatomy | Bone | Joint the gait sees |
| --- | --- | --- |
| scapula, from the withers down to the shoulder | `clavicle` (`dir=side`, negative `tilt`) | clavicle -> shoulder |
| humerus, down and BACK | `upperarm` | shoulder -> elbow |
| radius, down and forward | `forearm` | elbow -> hand (the wrist) |
| metacarpal paw, sloping forward to the toes | `hand` | hand -> handTip |
| femur, forward to the stifle | `thigh` | hip -> knee |
| tibia, raked BACK to the hock | `shin` | knee -> foot (the hock, where the plant locks) |
| metatarsal, near vertical to the toes | `foot` | foot -> toe |
| a horizontal back | `spine` pitched ~70 deg, `chest` and `neck` falling forward | |
| a lower jaw that opens | `jaw` with `hinge=` near the back of the skull (a frog's mouth corner) | jaw |

**The gait: arms as front legs, not a new gait module.** `armStyle: 'foreleg'` (`gait.ts`) walks the arms with
the leg function: lift, reach and plant, on the same-side hind clock delayed by `forePhase` (0.25 is a dog's
four-beat walk, 0.5 a trot). `motion.ts` plants the paw (the hand joint) like a foot, with the elbow pole pointing
BACKWARD. It is opt-in per gait profile, so every biped is unchanged. `landAhead` sets each swing down ahead of
the hip: a near-vertical foreleg with little slack overstretches when the whole stance is spent behind it.
The other option, a real four-limb rig with its own joint names and a four-phase gait, touches sever, gore,
damage and every pin, so it was not taken. The trade-off: the spine does not flex, and the paw is rigid with the
wrist (no toe roll).

**Check slack before rendering.** Pin the shoulder-to-wrist drop against the arm chain (the gorehound: 0.59 m
against 0.65 m, 91%). At ~99% the leg is a table leg (the houndcorpse's lesson).

**See the walk without a GPU.** `blob:shot` disables motion. `scripts/gorehound-walk-dump.ts` walks the body
through the real pipeline (or swings one attack) and writes the joints as JSON, and
`scripts/gorehound-gait-strip.py` draws side-on stick strips with the planted feet ringed. Point them at another
body by editing the path; `gorehound-blob.test.ts` pins the four-beat walk the same way.

**Attacks.** A quadruped's melee is its head. `hound-attack.ts` adds `bite` (a neck strike off planted
shoulders) and `pounce` (crouch, then the body and both paws thrown up and forward, the front plants released,
the root advanced like the bride's lunge). The jaw gape rides the bite. `MotionProfile.melee: { kind: 'bite' }`
gives it the ring brain with jaw contact (`enemy-mind.ts` `makeHoundMind`).

**The normal map round a horizontal torso.** `bake-body-normal.ts` projects the torso round a vertical axis,
which sees a horizontal back as one polar cap. Pass `--torso-axis` along the body, a few degrees off exactly z
(the frame's f is +z made perpendicular to the axis; the shader needs no change). `scripts/gorehound-detail-gen.ts`
probes the skin in that same frame (ph 0 = belly, 180 = spine).

**Kit on a body with no upright axis.** Seat back and head machinery on the probed skin seen from above
(`scripts/gorehound-skin.ts` writes `skin.json`; `on_skin(x, z, lift)` in `hound_common.py`). Plates laid flush
with the skin vanish under the flesh noise, so lift them ~1 cm. The legs are the butcher's dog-leg sculpts
wrapped in `limb()` and run for both pairs: shapes built from the bend itself (a cap on the bisector of the two
bones) land outside the joint whichever way it folds, so the same code makes a stifle and an elbow. Thicken
them after the fact (`thicken`) for a heavy body, and keep the SDF cores under them thin (2-3.5 cm), or they show
through the open-fronted shells.

**Turn off the face sheet** on anything that is not a person: with no `sheet` block the registry's zombie face
is projected onto whatever sits at the front of the head (the gorehound's snout). Add `sheet` / `enabled 0`.

## A seated rig: the chair (2026-10-22)

The chair (`characters/chair.blob`, kit `assets-source/chair-kit/`) is a man fused into a walking throne, on the
same biped names. Three things are new.

**Hang the front legs from a short UPRIGHT spine.** A hound's spine runs level from the hips to the withers, so
`chest` starts at the front and nothing can sit up at the back. The chair's `spine` is the sitter's lumbar
(upright, 0.19 m), `chest` rises from it, and `clavicle` takes `side=` (any bone can: it offsets the head from
the parent's tail in x) and runs FORWARD and slightly down along the seat (`dir=down pitch=71`). So the
clavicle is his femur, `upperarm` his shin and the elbow his ankle. The front legs are his own legs, and the
gait never knows.

**Only the head aims.** The aim chain is rooted at the neck (motion.ts), so a seated torso stays put. Kit on
`spine` (backrest, armrests) never has to follow the chest. His upper arms are `torso` bars with no `rigid`, so
each end binds to its nearest rig point: chest top and clavicle head. They stretch between the torso and the
throne instead of tearing off the armrests.

**Flesh as upholstery.** Thin `rigid` ellipsoids on `spine` lie over the panel and pan as a skin cushion that
merges into his back and thighs. Brass studs on a diamond lattice tuft it. Two lessons:
- **Keep the cushion inside the panel.** At 3 cm thick, `r` 0.24 and `blend` 0.04, it swelled into a halo of
  meat past the panel's edges. 2 cm and blend 0.02 reads as a cushion.
- **Studs must stand proud.** Studs sunk 3 mm vanished under the blend and the skin noise. Put the dome 4 mm out.

**Let the joints show.** A seat pan that ran under his knees hid the shins, and the knees read as amputee
stumps. Stop the pan just behind the knees, so they overhang and the shins drop clear in front of the skirt.
Ribs that wrapped the panel edge with any sideways reach read as pegs through it; keep them tight to the lip.

**Fill open greaves.** `make_legs.py`'s tibia shell is open at the front. Under a thin metal core, the opening
shows black. Run flesh (his foot) down inside it instead.

**Pass your own ports.** Another worktree's Vite on 5233 serves ITS checkout: `blob:shot` reuses it and
quietly shoots the default zombie, because your new `?character=` does not exist there. Run `blob:shot` with
`LAB_VITE_PORT` / `LAB_CDP_PORT` set when other sessions are running.
