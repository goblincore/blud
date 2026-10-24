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

## Heavy, full-figured bodies (the venus, 2026-10-22)

Learned on `characters/venus.blob`, a heavy woman built to contrast the thin cyberbride. The rules above assume a
muscled brute; fat is a different problem.

- **Mass reads through CONTRAST, not size.** The first pass made every mass big (chest, waist, belly and rear all
  reaching ~0.2 m) and rendered as a stocky man. Probe the CPU field per height (half-width, front and back reach)
  before looking: aim for waist-to-hip ~0.65 (her hips 0.275 half-width against a 0.17 waist), a rear standing
  ~10 cm behind the waist's back in profile, and a bust well proud of the ribcage (`scripts/tmp/venus-sections.ts
  <name>` prints them). `venus-blob.test.ts` pins these as field reaches.
- **The thigh's root ball widens the waist.** A ball of the thigh's radius at the hip joint reaches up past the
  hip line; seat it ~10% down the thigh. Carry the hip's width down the OUTSIDE of the thigh with a long offset
  blob, or the outline steps in under the hip band.
- **Arms on a wide body:** they cannot hang straight. Tilt the upper arm out (27 deg) and bring the forearms
  forward (pitch 30) so the hands pass in front of the hips. The hips are what the hands hit (`daylightOf`), not
  the waist.
- **Flesh detail for fat is not muscle detail.** In the `.detail` (`scripts/venus-detail-gen.ts`): broad, low
  horizontal fat rolls (r ~2 cm, 6 mm proud) on the back and flanks; cellulite as a scatter of small soft lumps
  (r 9-15 mm, ~2 mm proud) over the rear, hips and outer thighs; stretch marks as short fine streaks (r 2.8 mm,
  1.4 mm proud); a navel as a ring of six small swellings. Veins follow the recipe above; on the torso give the
  swing in METRES and convert to degrees by the probed radius, since the torso's radius varies 2x round a heavy
  body. Cellulite read well on the rear. The fine lines (stretch marks, and veins at the recipe's thin end) read as
  scratch cuts on the venus's first bake. The bake is slow (56 min for ~1,300 detail prims), so trial a crop first.
- **Lay the kit on the PROBED skin, not round a bone.** A heavy body is nothing like a cylinder: probe it
  (`scripts/venus-surface.ts` writes `surface.json`; `venus_common.py`'s `waist_pt`) and build on those points.
  The corset ribs sit 4 mm INSIDE the skin, so they bite and the `.blob`'s raw lumps swell round them.
- **Bands are strips, not tubes.** Ribs that wrap a body made as round `tube`s read as barrel hoops. Make each a
  `surface_solid` strip on the skin, tallest over the flank and pointed at its ends, with lips and a crest.

## Porting a face onto a new body

- The cyberbride's glow eyes sat 1.5 cm ABOVE the flat face mask's painted sockets and stood 2 cm proud, which
  the owner read as "out of position". When porting a face, render the ORIGINAL first (a temporary registry
  entry) so you know which faults are inherited. Seat glow eyes in the mask's sockets, a few mm proud.

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
- On a bone pointing DOWN (legs, hanging forearms), `BoneFrame`'s `s = u x f` points INWARD (-x on .l), so the
  outer side is `ph = -90`. The venus's thigh plates landed between her legs the first time.
- A headless `build.py` run that throws part-way does NOT save the .blend: parts built before the error are lost.
  Re-run every make script after a crash.
- `blob:shot` reuses whatever Vite is on port 5233, which may be ANOTHER worktree's (the new character then
  renders as a fallback body). In parallel sessions set `LAB_VITE_PORT`/`LAB_CDP_PORT` to your own ports.

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

### A ranged variant: the deadeye's pistol

The deadeye (`characters/deadeye.blob`, kit `assets-source/deadeye-kit/`) is the same frame again, armed with a
pistol. A ranged variant needs a different set of parts from a melee one:

- **The gun is a held PROP, not kit.** A prop follows the carry's aim (`gunPitch`) and drops on death; a kit gun is
  rigid on the forearm and cannot. Sculpt it with the same toolkit, but in the GUN-LOCAL frame: glTF +y is up and +z
  is out of the muzzle, which `bv` maps exactly as it maps blob coordinates. Put the grip through `GUN_GRIP.gripHand`
  (0, -0.074, -0.074). `make_pistol.py` exports its own `pistol` collection to `public/assets/lab/<name>-pistol.glb`.
- **A short gun needs its own muzzle.** `MotionProfile.prop.muzzle` (gun-local) feeds the round's origin and the
  flash. The shared muzzle is the enemy shotgun's, 0.41 m out.
- **A gunner needs a CARRY gait.** `motion.ts` takes the arm style from the gait, so it is `PROWL_CARRY`, not
  `PROWL`. Without it the arms keep the zombie's reach and ignore the carries.
- **Pick or add the weapon's brain tuning.** `gunner: {weapon}` selects it in `soldier-brain.ts GUNNER_TUNING`.
  The pistol is `PISTOL_TUNING` (aimed singles, the odd double tap, mid range); `game-spawn.ts` fires one aimed
  round per trigger event.
- **Two hands on a pistol.** The owner rejected the one-handed aim. The `pistol` and `pistolLow` carries drop
  `oneHanded`, so the left hand is solved onto `prop.foreHand`, set to cup the gun hand (5 cm to the gun's left,
  under and behind the grip). The aim is an isosceles stance, the gun arm swung in to the centre line. The walk
  carry is a low ready, both hands at the belly and the muzzle at the floor, so the raise reads as a telegraph.
- A face mask only reads as a mask when it is SMALL and SHAPED. A band wrapping to the temple at full height read
  as a slab on the side of the head; taper it to a point. Cables run about one radius off the skin, or they stand
  off like sticks.

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

### The gibbet: hung masses and judging motion (2026-10-22)

The gibbet (`characters/gibbet.blob`) is a walking gallows: a bone-metal beam on four splayed spider legs, a sac of
meat in a birdcage hung under it, and a head dangling at the front. The owner's verdict on the gorehound ("uninspired,
looks like the gnasher") is the lesson: **make the machine the body and the flesh the cargo, not machinery stuck on an
animal.** What it added:

- **A hung mass is the `hem` pendulum.** Hang the sac's prims AND the cage kit on `hem` (from the hips down to the
  sac's bottom) and they swing together. The Verlet lag alone moved it ~1.5 cm on a steady walk, which reads as rigid,
  so `GaitProfile.hemSwing` drives it: sideways a third of a stride behind the body's sway, fore-aft and a drop on each
  footfall, and 40% of that while standing (`HEM_IDLE` in `motion.ts`). Keep the hem's tail above the toes.
- **Thin-core bodies need collinear fuse paths.** The validator fuses clusters along the STRAIGHT line between their
  `core` prims; struts at angles never contain one. Put the torso's core on the neck cord with the head's core riding
  the same axis, and join the legs to each other across crossbars (hips, shoulder yoke).
- **Judge the motion, not the pose.** `BLOB_WALK_SWEEP=<firstFrame>:<step>` with a fixed `BLOB_YAW` makes
  `blob:shot` render the walk frame by frame (deterministic treadmill poses); stitch the frames into a GIF.
- **Feet are silhouette.** The gorehound's paws on long sloping metacarpals read as skis; spidery legs want points
  (`TOE_STYLE = 'spike'` in a kit's `common.py`: one curled talon taking the floor at its tip).
- **A cage reads by contrast.** The first cage was rusty dark iron inside the sac's outline and read as lines on meat.
  It needs bars standing clear of the sac (1.14x its radius), a lid of bars and a finial, a spike below, and pale
  bone-iron with rust only low down.
- **Normal map down the pendulum.** The torso projection can run along any axis: the gibbet's runs down the hem
  (`--torso-axis` extended past both ends of the sac), and every detail line binds to `hem` so the detail swings too.
- **Attacks from the body's own story.** The gibbet's two (owner's pick): up close it rears both spiked front legs
  and STABS (`hound-attack.ts` 'stab': front plants released, contact on the thrust); at range the sac swings back and
  forward and SQUIRTS a lobbed glob of bile from its drip (`bile.ts`, fired from a rig point through
  `MotionProfile.spit`, PR #53's plumbing). `makeGibbetMind` wraps the hound mind and adds the squirt cycle. Zombie-kind
  minds that fire are gated by sight, not by the encounter director's firing lanes (those are the soldiers').
  `BLOB_SWING_SWEEP=<variant>:<p0>:<p1>` renders a swing frame by frame for review.

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

**Meld, don't seat (owner's second look).** A thin cushion behind him read as "a big flat skin shape behind
him". What worked:
- Three flat `rigid` ellipsoids on `spine` make a skin MEMBRANE over the backboard. He is sunk into it, with the
  back half of his head under it.
- One head prim with a wide `blend` (0.045) behind the skull, plus jaw-corner webs, pulls the membrane up round
  the face. All prims fold in one running smooth-min, so a later cluster's blend melts into an earlier one.
- Keep the kit panel 2.5 cm BEHIND the membrane's back. Flush, the blend and the skin noise pushed flesh out
  through the back of a 4 cm panel.

**Scars on blend-heavy flesh go in the normal map.** Painted scar prims paint where they are the NEAREST prim, and
wide torso blends put the skin ~7 mm outside its prims. Twinhead-sized scars painted 2 cm bands, and sunk 9 mm
they painted ragged dashes. Kit tubes painted red looked like "plastic straws" (owner). Raised keloid with stitch
bumps, baked with the veins (`scripts/seated-detail-gen.ts`), takes the skin's own colour and light. The generator
probes from the FRONT (`march` along -z) for a seated body, and the veins run out of him across the membrane too.

**Eyes that read in a decal'd head.** Ember points in painted sockets were lost, and so was a bare glowing slit
("a bit too simple"). What reads:
- A glowing slit 1 cm proud of the face, between two swollen lid prims.
- The lids' blend held tight (0.0015) with ~8 mm between them. At 0.004 and 5 mm apart they fused shut over it.
- A decal drawn ROUND the slit: an almond bruise along it, raw red rims, puckered creases drawn in from all
  round, and bags. Place it from the slit's head-space ends through the projection, then check a close-up and
  nudge `projCentreY`.
- Bold decal lines: the face spans ~276 px of a 512 sheet, so a 1.6 px crease is under a millimetre.
- Glow 0.6, not 0.9: the bloom drowned the decal round it.

Painted seams the eye cannot place (oval ends of a raw-edge bar beside the head) read as unexplained spots: end
seams under something, or drop them.

**Fill open greaves.** `make_legs.py`'s tibia shell is open at the front. Under a thin metal core, the opening
shows black. Run flesh (his foot) down inside it instead.

**Pass your own ports.** Another worktree's Vite on 5233 serves ITS checkout: `blob:shot` reuses it and
quietly shoots the default zombie, because your new `?character=` does not exist there. Run `blob:shot` with
`LAB_VITE_PORT` / `LAB_CDP_PORT` set when other sessions are running.

### The boss variant: the gamer (2026-10-22)

`characters/gamer.blob` (kit `assets-source/gamer-kit/`) is the chair's boss: a swollen man in a gaming chair,
plugged in. It uses the chair's rig at `scale 1.30`. What it adds:

- **Hands that hold something, with no arm bones.** On this rig the arms are the front legs, so his arms, hands
  and the joystick are all `rigid` on `chest`: one rigid group, and no pose can part them.
  `gamer-blob.test.ts` measures each hand against the grip on the posed body after a walk. Without `rigid`, a
  hand drifts 4.4 cm, because each end binds to its nearest joint and one of those is a front knee.
- **A scaled body's kit is in COMPILED metres.** `blender-kit.ts` skins to the built body, so take the kit's
  joints and prim positions from a `buildBody` dump, not from the `.blob`'s authored numbers.
- **A product read survives the style.** Black upholstery, red racing stripes, bucket bolsters, the two neck
  pillows, T-armrests and a five-star castor base (vestigial, drawn up like landing gear) say "gaming chair" at
  any distance. The bone-metal goes in the rim, the spined crest and ribs up the back, and the horns.
  The `leather` look renders tan-brown under the lab's environment; glossy `black` reads as PU leather.
- **Plumbing rides the bone of whatever it plugs into.** Put the feed hose in his mouth on `skull`, so it stays
  in when he turns. The IV, the shoulder cables and the catheter ride `spine`, plugging into the chest-rigid
  flesh, which moves only a few cm against the frame.
- **Small detail on a prop of flesh is NORMAL MAP, not prims.** Veins, sores and pustules as painted prims on the
  joystick read as "tubes and skittles" (owner). They are baked: the stick stands upright in front of him, so the
  torso projection's front rays land on it. `scripts/seated-detail-gen.ts` probes the front, and a small meander
  (`ampK`) keeps veins inside a 9 cm stick.
- **A colour gradient on SDF flesh is contiguous shells, kept small.** A painted prim is flat and loses the skin's
  mottle. One painted red cone read as a plastic bottle cap. Overlapping blotches merged into one hard band, and discs
  on the axis bulged into rings (a tiered cake). What works: frustums of the surface itself, 1.2 mm out and butted
  end to end, each the nearest prim over exactly its band. Keep them to where the colour is wanted (the owner: "more
  isolated to the tip"): three over the last 5 cm, a faint flush to the zombie's pink (`eab1b4`).
- **A held prop that moves is an UPWARD `hem`.** The gamer's stick, knob and hands ride a `hem` bone from his hips up
  to the middle of the grip, so an attack can move them. The only spare movable point on the standard names is the
  pendulum, and attack poses offset joints by name. `rig-bind.ts` holds an upward hem at `HEM_HELD_SCALE` (0.7, not
  the cloth's 0.15), so it does not droop or trail: walking it holds within ~1 cm. `MotionProfile.joystick`
  (`joystick.ts`) adds the jiggle: ~5 cm of beating back-and-forth through an attack, and a faint idle twitch. His
  forearms are left UNRIGID, so each end binds to its nearest joint (elbow to the seat, wrist to `hem`), and the
  arms stretch to follow the stick.
- **Torso flesh the torso cylinder cannot see gets its own region.** `bake-body-normal.ts --torso-seg` adds kind-0
  regions with an `rMax` (the shader bounds them by it; region 0 keeps none). The gamer has them for the stick, the
  forearms and the upper arms: with only the torso's cylinder, the arms across the gut smeared it.
- **Veins where the eye goes.** The owner wanted them "pronounced and a lot of them" on the neck, the face and down
  the shaft, not spread over the body. Probe each around its own axis (`axisVein` in `seated-detail-gen.ts`). The
  head gets a `--limb skull` region; its face sheet still covers the middle of the face.
- **Separate what is fused by cutting it.** His flesh hands melted into the grip, and any veins near them read as
  tendrils. Sawn wrist stumps in metal prosthetic C-clamps (kit) make a clean break, and each part can then be
  detailed alone. A stump is the forearm's round end painted raw by a shell 1.2 mm proud. The cuff runs on over most
  of it, so only a cut face shows; left bare, the painted dome read as a glossy ball. Splinter the bones (`r2` small,
  `chamfer`) and flatten the flaps along the cut (`deep` 0.4, blend ~0.007), or they read as balls too.
- **Whatever must stay inside a kit part has to turn with it.** The kit rides a bone's whole frame, but a prim bound
  to its nearest joint only translates with that point. Bound that way, the stumps slid ~2 cm in their cuffs when
  the stick tilted. The fix: make the wrist end `rigid` on `hem` with the clamp, and put the join with the stretching
  forearm inside the cuff.
- **A curved prop gets chord regions.** One `--torso-seg` down the chord of a quarter arc misses the outside of the
  bend. Two chords (`stalk1`, `stalk2`) cover it, and the wrinkle folds there are ridge rings that sag on the
  underside.
- **A part that breathes is a morph channel the motion drives.** The gamer's knob grows and its rocket rises on the
  `swell` channel (expression.ts). The prims carry `morph=swell:` words; `actor.ts` sets the weight every frame from
  `MotionProfile.joystick.swell` (`joystickSwell`: a slow breath, throbbing through an attack). The game's actors have
  no expression layer, so the profile is what drives it. To shoot a morph, the lab's `__sdfLab.setMorphs({ swell: 1 })`
  holds it (`BLOB_PROBE`), since `blob:shot` freezes motion.
- **More veins is not better veins.** A denser pass on the gamer was rejected: "too busy", and it "still doesn't read
  as veins". It added ~900 prims of veins over his upper chest, down every arm segment and round the neck. The owner
  preferred the sparser version before it, so it was reverted. Veins read when there are few of them, where the eye
  goes. Skin under another cluster (the neck under his jowls, head prims that take the head's region) shows none of its
  baked relief either.
- **A ranged attack does not fit this rig yet.** `onFire` needs a carried prop in the right hand, and here the
  right hand is a front claw. A ranged gamer needs a mind with the muzzle on the head (the headset); it uses the
  hound mind for now.


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
   the metal. Every place a run dives in gets a small raw wound prim in the `.blob`. The script prints the points. Author each side's
   wounds from its own printed points: on an asymmetric body a `both` mirror floats them off the skin (CI's `strandedOf`
   caught two at 35 and 83 mm).
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

## A fireball thrower: the imp (2026-10-24)

The imp (`characters/imp.blob`, kit `assets-source/imp-kit/`) is a gaunt demon on the butcher's digitigrade legs that
throws fireballs. What it taught:

- **A reference is a point of departure.** The owner's brief came with a Doom 3 imp; the first head (a pale egg with an
  eye-hole cluster and a lipless grin) read as an alien and as a copy. The owner pointed at the house style instead:
  build the head as **flesh over a simplified version of the twinhead's demon skull** (not the metal skull itself, which
  was tried and rejected as "the demon head"). In prims: a long low cranium blended wide into the temples, a brow ridge
  per side in a V, slanted sunken sockets with a small red ember each, cheekbones sweeping back, a long narrow muzzle, a
  jaw with a chin point, kit fangs and horns. Pitfalls on the way, each one a look: a cranium wider than the face (and
  one brow bar straight across) reads as a **hat brim**; sockets that meet in the middle read as **goggles**; round dark
  nostrils a centimetre across read as a **pig snout**, narrow slits raked up the muzzle read as flared nostrils; horns
  curling up and back are seen end-on from the front as **mouse ears**, so sweep them out as much as back.
- **No fingers: a socket, caged.** Each hand is a knuckled skullmetal cup round a burning coal (`ventglow`), with five
  talons rising off a crown of points on its rim and curling hard back in over the mouth (curl ~1.8 rad; at 1.35 they
  hung open). It reads at fighting range as an orange point between dark claws, and the fireball leaves from it. A
  straight flared tube for the cup read as a plastic drum; bulge it over the knuckles and give the rim points. Knuckles
  as balls read as marbles; ridges do not.
- **Fire light without lights.** The coal, the chest furnace and the eye embers light the parts round them through
  baked `_glow` (`glow_bake` in `imp_common.py`: falloff times facing). A second glow colour needs its own material name
  in `GLOW_FROM_ATTRIBUTE`: `impmetal` (skullmetal's look) and `impclaw` (horn's) burn orange where `skullmetal` burns
  red. (The teratoma's `orbitmetal` alias is not in kit-overlay.ts on main, so its socket glow falls back to the default
  look: worth a check.)
- **Joining parts in Blender: deselect first.** `bpy.ops.object.join()` joins every SELECTED object, and a part's
  install leaves it selected: the first eye-ember join swallowed the ocular plate, which then rendered as a glowing
  yellow crown.
- **A hunched torso bakes round a tilted axis.** At a 26 deg hunch the torso is probed and baked round the spine
  (`--torso-axis 0,1.56,0.19:0,0.90,-0.06`; `scripts/imp-detail-gen.ts` probes from the same line). The zombie's
  generated spinal column breached the starved back under the hunch (both the kyphosis and the lumbar curve): leave it
  out and put the spine's ridge in the normal map. Leg detail is a `--limb` region per leg bone like the arms'
  (`limbOf` in the generator picks `leg` or `arm`). **Sinew** is a long, nearly straight cord, thickest in its middle,
  sampled every ~1.4 cm (no meander, no knots): it is what makes a starved limb ropy where veins make it swollen.
- **The throw is an arm arc, not a new pose system.** `attack.ts` `throw` (windup pitch 2.4 rad, up and back past the
  vertical; strike 0.45, forward and down) runs through the zombie arms' `armArc`; `makeImpMind` holds the body,
  faces the player and raises `fire` once at `IMP_TUNING.fireAt`, and `MotionProfile.spit` from `handTipR` puts the
  ball in the hand. A strike pitch of 1.05 ended the follow-through 45 deg up and read as a lob. Judge it with
  `BLOB_SWING_SWEEP=throw:0:0.6 BLOB_YAW=-1.3` (yaw in RADIANS; degrees spin the camera round to a random angle).
- **A light projectile, not the rocket.** The teratoma's fireball is the warbull's rocket (the dynamite's blast). An
  imp throws often from a quick body, so `fireball.ts` is its own straight-ish ball (11 m/s, a slight droop it aims
  for, 14 on a hit and 5 on a near miss, a 0.55 m fire burst through the dynamite's burst visual and light), and it
  hurts only the player.
