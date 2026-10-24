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

### The gutcrawler: a crawl that reads, and a design found in review (2026-10-23)

The gutcrawler (`characters/gutcrawler.blob`) went through six looks in one day, the owner steering from renders: a
lizard-man ("a lizard and a snake meets a hominid ... not creepy"), a belly-up man with his head hanging upside down,
then "bigger, like a fat worm / giant maggot", a "semi normal" head, "like a naked mole", and a star-nosed mole's tube
snout for a mouth. What carried over, and what it added:

- **Creepy is a recognisable human made wrong, not a monster.** The lizard-man had human arms and still read as an
  animal. What landed: a man's chest, arms and face stuck on the front of something that is not a man. Make the body
  grow bigger and stranger, keep the human part plainly human.
- **The cast has ball fists, not hands** (owner: "that's the way hands are in this universe"). Fingers add animation
  weight for nothing. One round blob on the hand bone.
- **One source for the eyes.** Black eye prims painted over a face decal's eyes fought it. Paint the change INTO the face
  image instead: `gutcrawler-face.png` is `female-face.png` run through PIL (desaturated toward pink, hair painted out,
  the eyes squeezed to slits, the mouth painted out under the snout). Cheap, and the face stays one image.
- **The generated head is upright at REST whatever way the skull bone points** (its prims are only translated), so a
  cocked or upside-down head needs its own prims. The decal can be flipped upside down (a negative `projScaleY`), not
  turned sideways.
- **A legless body is not a body that lost its legs.** The lab and the game called a limb with no cluster "missing",
  and `collapse.ts` dropped the gutcrawler flat every frame. Both now read `collapse.ts` `limbsMissing` (missing = the
  body has the limb and its cluster is dead; sever keeps a dead cluster). The node walk dumps never showed it: they
  pass `emptyActorSignals()`. Pass the signals the game sends (`gutcrawler-blob.test.ts` does).

**Making a drag read** (`gait.ts` CRAWL_DRAG; each new knob is opt-in and inert for every other body):

- **Bend the arm at rest.** Authored nearly straight, the fists planted at full stretch and the elbows never bent: a
  glide. At rest the shoulder-to-fist distance should be ~2/3 of the chain, so a haul can fold it right up.
- **`elbowPole`**: the planted arm's IK pole, body-local. A dog's elbow points back; a man hauling himself along a floor
  points his elbows up and out.
- **`crawlRoll`**: the shoulder over the planted fist drops and the reaching one rises; the chest leans onto the
  hauling arm.
- **`rockAmp` as a surge**: the body lurches forward on each pull instead of gliding at a constant speed.
- **`undulate` and a pendulum chain**: one rigid `hem` stick read as a needle ("so stiff"). Bones `hem2` (parent hem)
  and `hem3` (parent hem2) are now pendulum points like the hem (`rig-bind.ts` PENDULUM_CHAIN; not `tail2`/`tail3`,
  which the cyclops, dragon and gargoyle use for anatomy: the first names caught them), and the body wave
  runs from the shoulders down the chain with growing swing and lag, so a grub's rear rings writhe as it hauls.
- **Judge it travelling.** `BLOB_WALK_SWEEP` holds the walk on a treadmill, where a planted fist is never hauled past and
  the arms read as straight sticks. `BLOB_WALK_TRAVEL=1` walks the sweep straight ahead with the camera following.

**The rear-and-slam** (`hound-attack.ts` 'slam', `GUTCRAWLER_TUNING`): a grub cannot bite or leap, so it rears its front
half off the floor (both fists over its head, its own long clock: the rear is the threat) and slams it down, snout
first, surging ~0.9 m (`slamAdvance`). A first pass that lifted the chest 0.30 m read as a shrug on a 2.2 m body.

**Shooting a long, low body**: `blob:shot` reuses ANY Vite already on 5233, including another worktree's, and then
renders that checkout without a word; give each worktree its own `LAB_VITE_PORT`/`LAB_CDP_PORT` and read the
`lab-servers: starting vite` line. The lab's 0.4 m reference cube hides a body this low (hide it in a `BLOB_PROBE`), and
`BLOB_TARGET_X`/`BLOB_TARGET_Z` move the orbit centre to a head 0.8 m from the origin.
