# Bride — sword enemy, Task 1: the flesh body (2026-09-24)

Spec: `docs/superpowers/specs/2026-09-24-bride-sword-enemy-design.md`.
Body: `src/lab/sdf-zombie/characters/bride.blob` (the header is the design brief).
Pins: `src/lab/sdf-zombie/characters/bride-blob.test.ts`.

Flesh only. No shells, hair, kit, sword or face sheet yet (Tasks 2-5).

## Numbers (CPU field, `sdBody` probes)

| What | Value | Spec |
| --- | --- | --- |
| Prims | 73 flesh + 27 bone = 100 | ≤ 108 (128 − 20 for Task 3's cloth) |
| Flesh crown | 1.814 m | ~1.85 once the hair and veil are on |
| Hip joint / height | 1.04 / 1.814 = 0.57 | ≥ 0.54 |
| Waist half-width | 0.086 | ≤ 0.095 |
| Hip half-width | 0.171 | ~0.16 (must stay < 0.18, or the hips touch the forearms) |
| Thigh | 0.068 semi at the root, 0.052 at mid-thigh, 0.035 at the knee | a woman's taper (look pass) |
| Neck bone | 0.140 m | ≥ 0.13 |
| Forearm R − L | 0.04 m (0.30 vs 0.26) | > 0.03 |

## Frames

Shot with `LAB_TMP=.lab-tmp LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 npm run blob:shot -- bride`.
The probe was `BLOB_PROBE="(window.__sdfLab.uniforms.lightDir.value.set(0.35,0.6,0.72), 1)"`
(the broodmother's light). **Yaw 0 is her face** (frame 00 of 8), as the broodmother notes
say. Earlier passes shot at yaw 180 with the light's z negated. That was a lab bug, not a
convention; see "Second look pass" below.

- **Use private ports.** Another worktree's Vite was already on 5233. `lab-servers.sh`
  reuses any listener, so the first "bride" shot was that checkout's zombie.
  Sanity-shoot `cultist` on the same ports first.

![front](body-front.png) ![3/4](body-34.png) ![side](body-side.png) ![back](body-back.png)
![torso](torso-front.png) ![torso 3/4](torso-34.png) ![legs](legs-front.png)
![face](face-front.png) ![face 3/4](face-34.png) ![profile](head-profile.png) ![head at 1 m](head-1m.png) ![legs side](legs-side.png)

## Things found on the way

- **A mirror block cannot make an asymmetric pair.** A bone outside the block cannot parent
  to `upperarm.r`, and it cannot carry arm prims. So the grammar gained `lenR=`, the `.r`
  copy's length (`blob-parse.ts` → `BoneDef.lengthR` → `mirror.ts`), with tests. The motion
  rig already measures each arm on its own (`makeMotionJoints` `arm.L` / `arm.R`), and the
  test pins that the long arm reaches it.
- **Chamfer reach is 4 × `blend`, and `buildBody` does not halve it.** Only round unions
  get `roundBlendScale` 0.5. The cheekbones' chamfer at 0.008 bevelled 3.2 cm of air into
  the head. With the other head blends, that grew a 0.092-wide "goggle" band at eye level
  with a shadow "moustache" under it. Smooth-min swell also accumulates across prims: four
  prims each ~2 cm away folded the field 1.9 cm negative.
- **Hips belong to the leg cluster.** Torso and leg meet at a hard seam between clusters.
  So a torso-owned hip flare always reads as a light bulb hung over two sticks. The flare
  is now a thigh prim, which is where the trochanter is anyway.
- **Paint is taken from the hit's nearest prim** (`prim-material.wgsl` `hitBest`). A
  buried lip painted a ~4 cm pink trapezoid, so the lip tint stays a step off the skin. A
  2 mm painted cross still reads as a dark drop at 1 m, not as a cross.
- **`stance humanoid` is enforced by the lab.** A shin pitched +1 put the knee 4 mm behind
  the hip-to-ankle line, and the lab then refused to load her. The test now pins
  `checkStance`.

## Honest read (first pass, superseded by the look pass below)

- **At distance:** a tall, very thin, long-legged pale figure with a wasp waist and a long
  neck. It reads as graceful-strange and more mannequin than woman. The hair, veil, bodice,
  skirt and boots (Tasks 3-4) have to carry "female" and "bride".
- **Up close:** the rib window reads clearly. The raw-red seams read as red bands at both
  elbows and as lumps under the right shoulder. The flesh cuff tapers past the right fist.
- **The face:** large dark eyes with red-rimmed bruised sockets, a fine pointed nose, pale
  lips and a pointed chin. Uncanny and doll-like. The wrong half is the Task 2 sheet.

## Look pass (same day)

The owner and controller's verdict on the first frames was **"an alien mannequin"**. A
later note: **"i kinda like it but its a bit too alien"**. So the target is the middle:
a pretty, doll-like young woman first, slightly otherworldly second. The frames above
were re-shot after this pass.

- **Head**
  - A human cranium: rounded back, forehead narrower than the cheeks, back of the head at
    z −0.096. It is a touch long, the one alien trace kept.
  - The face mass is one tapered capsule, flush with the cranium, narrowing to a slim jaw
    and a soft chin. The face now fills the lower ~60% of the head.
  - Small upturned nose (a slim bridge and a tip ball, ~1.5 cm of projection) in place of
    the chamfered beak.
  - Full pale-lilac lips with a cupid's-bow bend.
  - Round, broad cheekbones set outside and below the eye corners, with soft cheeks under
    them.
- **Eyes**
  - Almond eyes with a dull off-white sclera and a dark iris a touch too large, set a touch
    too wide (x ±0.034). An all-black almond read as a grey alien's eye; it was the
    loudest alien cue.
  - The sockets are flat bruised makeup ovals, sat ~0.5 mm off the face. At 2.7 mm proud
    their rims were ridges.
  - The upper lids and under-eyes are clean surfaces, per the owner's ask, so the Task 2
    sheet can paint liner, lashes and running mascara on them.
  - The brow fill is gone; it rendered as a ridge.
- **Body**
  - A modest bust: two r 0.044 forms at y ~1.345, ~2 cm proud.
  - The rib window moved BELOW and between the bust: sternal ends at y 1.303 to 1.207, the
    costal arch at y ~1.17–1.31. Task 3 must clip the bodice over that band, not the
    plan's 1.25–1.40.
  - Softer shoulders and a touch more arm.
  - Thighs taper 0.068 → 0.035 to a slim knee. The shin bar overlaps the thigh at the joint,
    and a long tapered calf replaces the knee ball and the calf ball.
- **The thigh stigmata moved** from thigh at=0.22 to at=0.34. At 0.22 the fattened thigh
  tops buried them 3 cm deep; the new placement was probed with `sdBody` at every painted
  prim.
- **Renderer bug (not fixed here).** A 10 cm × r 0.0024 drip on the thigh (length/radius
  ~50) drew dark-red lines 30+ cm out into the AIR on both sides of the body. Tapered or
  not made no difference, and the CPU field is empty there. Removing the drip removed the
  lines. The drip is now 6 cm at r 0.0025 (ratio 24) and the lines are gone.
  `blob:render-check` passes, because it only looks for holes. This belongs in `webgpu/`,
  probably in the cull or bounds for long thin prims.
- **Honest read**
  - At 3 m she reads as a tall, slim woman with an hourglass, a small bust, long legs and a
    long neck.
  - At 1 m, a porcelain doll-like face: dark-ringed eyes with whites, a small nose, full
    pale lips. The bald, slightly long cranium still leans alien until the Task 3 hair and
    veil go on.
  - The throat cross still renders as a ~2 × 4 cm dark teardrop, bigger than its prims. It
    is paint claiming past thin prims, and possibly the same thin-prim renderer issue.

## Second look pass (same day): feet, lids, profile

- **"Her feet point backwards" was a LAB bug**, and it had been skewing every frame in
  this folder.
  - `blob:shot` freezes the rig with `setMotionEnabled(false)`. That reset `rig.bodyYaw`
    and `restPose` to the authored facing (yaw 0), but left two things behind:
    `heroMotion.lastBodyYaw` at the wander's last heading (2.94 rad in one probe), and the
    rig points where the wander had put them.
  - `applyRig(current, bound, lastBodyYaw)` then rotated every offset-placed prim and the
    rigid head by that stale yaw. The bone-bound prims (legs, feet) stayed at the rest
    heading.
  - Result: the face, bust and ribs pointed one way and the feet the other, the "front"
    fell at whatever yaw the wander ended on, and the face looked a few degrees turned.
    `schoolgirl-described` showed the same backwards feet.
  - Fix in `webgpu/lab-main.ts` `setMotionEnabled(false)`: zero `lastBodyYaw` and snap the
    rig points onto the rest pose. Two back-to-back shots now give the same orientation,
    and green marker prims on the nose and the toes agree in every view.
  - The `.blob` was right all along (`foot dir=fwd`, toes at +z). `bride-blob.test.ts`
    now pins that toe.z > ankle.z on both feet (rest skeleton and motion-rig base pose), and
    that the face is on the same side.
  - Everything judged before this fix was judged on a half-rotated render. The re-shot
    frames are the first honest ones.
- **Heavy upper lids**: the almond capsule raised 8.3 mm, ~0.5 mm proud and flattened, so it
  caps the top ~third of each eye. The lids are unpainted skin with a small blend, leaving a
  clean upper edge for Task 2's liner and lashes.
- **Eyes set into the head**:
  - Sclera, iris, lid and socket all moved back 8.5 mm.
  - A small brow arc sits over each eye (probed front z 0.080 at x 0.03, y 1.72, with the
    eye ~3 mm under it), plus a nasal root between the eyes.
  - The cranium moved 5 mm back: its lower front rim overhung the eyes as a shelf across the
    whole forehead.
  - The face-mass capsule's top dome was lowered for the same reason.
- **Bust enlarged** (r 0.044 → 0.052, blend 0.012). With the render fixed, r 0.044 read as
  pectorals.
- **Honest read** (from the fixed render):
  - At 3 m: clearly a tall, slim woman, with bust, hourglass, long legs and long neck. The
    feet point forward in every view.
  - At 1 m: a sleepy-lidded porcelain doll, with eyes under a soft brow, a small nose and
    full pale-lilac lips.
  - Still alien-leaning: the bald, slightly long cranium, and a fairly strong brow line in
    front light. The ribs read hard (a xylophone) at 1 m; that is the hook, though the
    bodice will frame it.
  - Now that it renders right side out, the throat mark reads as a cross with a drip rather
    than a teardrop.

## Task 2: the corpse-makeup face sheet (same day)

Painter: `scripts/make-bride-face.py` (PIL, seeded `random.Random(24)`, byte-identical on
rerun) → `public/assets/lab/faces/bride-face.png`. Worn by the `.blob`'s `sheet` block;
the registry's `face` declares the measured mean. Pins in `bride-blob.test.ts`, including
one that the painter's four projection constants equal the sheet block's.

- **Projection, solved from the built body, not guessed.** `headShape()` normalises by
  the cranium (centre y 1.7223, semi 0.07097 × 0.09118). The prim positions converted to
  head-space: iris (±0.479, −0.247), lash line ≈ −0.21, mouth −0.955 with corners at
  ±0.275, cheekbone (0.747, −0.483). `projScale 0.40/0.40`, centre `0.50/0.70` (hs −0.5,
  mid-face, lands at uv 0.5).
- **Checked with a banded diagnostic sheet** (coloured bands at known hs, vertical lines at
  the iris and mouth-corner x; `face-sheet-diag-bands.png`). The lines hit the irises and the
  mouth corners, the cyan/magenta bands hit the lips, and the red band hits the lash line.
- **Painted prims ignore the sheet.** The same diagnostic showed that the sclera, iris,
  socket ovals and lips (all `color=`) are overwritten after the face pass
  (`paint-char.wgsl`), so the green band vanished across the eyeball. The sclera prim also
  covers down to hs ≈ −0.37, lower than its prim radius suggests. So the smoke is painted on
  the skin AROUND those prims: the lid, the under-eye below −0.37 and the brow valley. The
  `lips()` layer only greys the margin round the lips.
- **Blend: `decal 0` with `blendLuma 0` (rgb multiply), NOT the house luma default.**
  - There is no true overlay mode in `face.wgsl.ts`. The modes are 1 rgb multiply,
    2 replace, and 3 luma multiply, the "overlay-style" default the owner preferred.
  - Luma mode exists because a skin-toned bake times skin-toned flesh compounds hue. This
    sheet's base is neutral grey, so rgb multiply adds no hue to the skin. The makeup's hues
    are the point (bruise red, violet hollows, blue veins), and luma would flatten them to
    grey.
  - Dark goes dark enough under multiply, but only because of the base. The shader divides
    by the mean luma of every texel with alpha ≥ 8. Ink with nothing around it (the ogre's
    alpha-0 layout) is its own mean and multiplies by ~1, so it is invisible.
  - The sheet therefore lays a neutral grey (206) base over the face at alpha 1. Mean
    0.7212: the base multiplies by 1.12 (a faint pale powder) and the ink by 0.045.
- **The game does not measure the mean** (`game-vfx-leaves.ts faceFor` uses the registry
  value). So the registry declares `mean: 0.721241`, as the soldier's entry does, instead of
  `bakedFace`'s fallback 1, which would darken her face ~28% in game. The ogre, cyberdemon
  and gargoyle decals carry mean 1 in the game and a dark-only measured mean in the lab. That
  is worth a look separately.
- **`texRelief 0.3`.** The luminance relief at the 1.4 default (and still at 0.6) embossed
  every thin ink line: the stitches read WHITE in the 3/4.

### Numbers (close-up, `face-sheet-luma-boxes.png`: eye boxes include sclera, iris, lid and socket prim)

| crop (mean sRGB luma) | sheet on | sheet off | Δ |
| --- | --- | --- | --- |
| socket, viewer-left / right | 0.194 / 0.288 | 0.339 / 0.461 | −0.145 / −0.173 |
| cheek, viewer-left / right | 0.537 / 0.739 | 0.606 / 0.787 | −0.069 / −0.048 |
| **cheek − socket** | **0.343 / 0.451** | 0.267 / 0.326 | |

The task's bar is socket ≥ 0.15 darker than cheek. It passes with the sheet on (0.34 / 0.45).
The prims alone already passed it, so the sheet's own contribution is the Δ column:
≈ 0.15–0.17 darker at the eyes.

### Frames

Shot on private ports with `LAB_TMP=.lab-tmp LAB_VITE_PORT=5271 LAB_CDP_PORT=9271`, cultist
sanity shot first. The probe was
`(window.__sdfLab.uniforms.lightDir.value.set(0.35,0.6,0.72), window.__sdfLab.setSdfScale(1), 1)`.
`setSdfScale(1)` renders the SDF layer at full resolution. The default scale made the lashes
a smear.
Close-ups: `BLOB_TARGET_Y=1.675 BLOB_DIST=0.26 BLOB_PITCH=0`.

![close](face-sheet-close.png) ![close 3/4](face-sheet-close-34.png) ![sheet off](face-sheet-off-close.png)
![1 m 3/4](face-sheet-1m-34.png) ![3 m](face-sheet-3m.png) ![3 m head, 6x nearest](face-sheet-3m-head-6x.png)
![diagnostic bands](face-sheet-diag-bands.png)

### Honest read

- **Close-up:** a pale doll with heavy black liner and lashes on the hooded lids, smoke on
  the lid and under the eye, two mascara tear-tracks, and a stitched Glasgow smile from both
  mouth corners. The hollows are a soft lilac shadow under the cheekbones. They are there
  but quiet: shading carries more of the hollow than the paint does.
- **3/4:** the suture reads, and fades out toward the ear with the facing fade. The runs
  read. On the near eye the liner's wing is lost where the surface turns away: the outer
  corner is the red socket prim, which the sheet cannot paint.
- **3 m:** she reads as dark-eyed, and the eyes are the darkest thing on the head. Most of
  that darkness is the socket prims plus the under-eye smoke. The mascara runs are at best
  a one-pixel darker trace, even with the ~7 mm smudge under each streak. At 3 m one lab
  pixel is ~9 mm of face, so a painted tear that thin cannot carry at that range.
- **Concerns for the owner:** the eye makeup is capped by the Task 1 painted socket ovals
  (dark red `6a2632`), which dominate the outer corners as red wedges and ignore the sheet.
  If the smoky eye should be blacker, the lever is that prim's colour (Task 1 found `4a1a26`
  merged the eye into a goggle), or unpainting it and letting the sheet own the socket.

### Review pass: deeper cheek hollows (owner: "wow big difference, looking good" + one ask)

The owner asked for deeper hollows and nothing else. The red socket ovals and the
slit-looking eyes stay exactly as they were.

- **Geometry (`bride.blob`).** The face widened sharply at the cheekbones, and that flare
  fought the painted hollow. The cheekbone's outer reach went 0.077 → 0.0636 (x 0.053 →
  0.046, wide 1.50 → 1.10, −17%), with height and depth unchanged so the cheekbones stay
  high. The soft cheek went 0.064 → 0.054 (x 0.040 → 0.032, r 0.024 → 0.022, −16%). The
  cranium is still the fattest head prim, so the head frame, and with it the projection, is
  unchanged. The painter/blob parity pin passes.
- **Paint (`make-bride-face.py`).**
  - The hollow core alpha went 0.55 → 0.85, and the colour 4a3c55 → 3a2c46.
  - The band moved 0.03 in to follow the narrower cheekbone.
  - The cheekbone highlight went 0.20 → 0.25 and still rides the hollow's top edge.
  - The sheet mean is now 0.7125, and the registry declares it.
- **Numbers** (close-up, same framing and boxes: `face-sheet-hollow-boxes-before.png` /
  `-after.png`):

| crop (mean sRGB luma) | before | after |
| --- | --- | --- |
| hollow, viewer-left / right | 0.371 / 0.552 | 0.201 / 0.389 |
| upper cheek, viewer-left / right | 0.541 / 0.696 | 0.458 / 0.725 |
| **hollow − upper** | **−0.170 / −0.144** | **−0.257 / −0.336** |

  The hollow-to-upper-cheek contrast is 1.5× (left) and 2.3× (right) what it was.
- **Read.**
  - Front: the face no longer winged at the cheekbones, and a clear violet shadow runs
    under each cheekbone toward the sutures, under a lit cheekbone band.
  - 3/4: it reads as a violet shadow band under the cheekbone. The silhouette itself is not
    hollow; that is paint, as the owner asked.
  - 3 m: the hollows now show as two darker violet patches under the eyes, which help the
    gaunt read. At that size they could also pass for bruising.

## Task 3: cloth shells, strand hair, laces, stockings (same day)

Perf census deferred (owner, 2026-09-24).

Owner direction mid-task: build for the look first and optimise later; stay under
`MAX_PRIMS` 128 (a hard validator limit today) without raising it.

### What she wears (`bride.blob`, pins in `bride-blob.test.ts`)

| Part | How | Prims |
| --- | --- | --- |
| Corset bodice, ivory | one `shell` round cone on `chest`, `rigid`, clipped open down the sternum | 1 |
| Laces | five dark thin bars zig-zagging across the slot, ends sunk into the sheet's probed edges | 5 |
| Ruffle skirt, two tiers | two `shell` cones on a new `hem` pendulum bone, `rigid`, warped; the upper tier stops at y 0.945 | 2 |
| Veil | one `shell` round cone on `skull`, `rigid`, clipped at the face | 1 |
| Hair | scalp mass + strand bundles: face-framing locks (x2), side-back locks (x2), back curtain | 6 |
| Stockings | knee-down prims painted e8e0d0; a thigh overlay (+1 mm) and a darker lace-top band from y ~0.80 | 4 |
| Bust | painted the bodice's ivory (the cultist's rule), no new prim | 0 |

Budget: 92 flesh + 31 bone = **123 / 128**. Four of the bone prims are auto-derived from
the stocking overlays (a thigh-sized prim grows a femur, `bone-derive.ts`).

### Numbers (CPU field)

- **Sternum slot** (the bodice sheet's edge, probed): 6.7 cm wide at y 1.16, 6.0 at 1.22,
  5.6 at 1.25, 4.8 at 1.28, 2.7 at 1.31, 1.0 at 1.34, shut at 1.36. The plane was
  grid-searched against target half-widths (11 degrees off vertical). The cut is a few mm
  into a gently curved front, so a few mm of `clipd` moves the width by centimetres.
- **Skirt hem** y 0.855 (under the crotch at ~0.88); upper tier hem 0.945. Stocking top
  ~0.80, so the inner-thigh wounds sit under the hem and their drips run out into the
  3.5 cm of bare thigh above the stocking tops.
- **Face frame held:** every hair/veil prim's radius × max scale stays under the
  cranium's 0.0912. `game-main.ts` `headShape` takes the fattest head prim over ALL prims
  (the lab skips painted ones), so a bigger hair mass would re-centre the Task 2 sheet in
  the game only. Pinned.

### Things found on the way

- **A squashed shell under-reports its distance, and paint follows the field.** A shell's
  base distance is taken in the scaled space and comes back multiplied by the smallest
  axis. At `tall 0.35` (to flatten the bodice's top cap into a lid) two things broke:
  - `thick 0.004` became a 19 mm slab in z;
  - `nearestPrim` / `hitBest` saw the bodice as nearer than the ribs 2-3 cm behind it, so
    the whole rib window was painted ivory.
  At `tall 0.60` the slot's skin and ribs own their paint from y 1.16 up (probed). `thick`
  and `warp` are divided the same way; the `.blob` comments give the world sizes.
- **The hem pendulum stole the stocking tops (fixed, `rig-bind.ts`).** The stocking
  overlay's top end (y 0.78) was nearer the hem bone's tail (y 0.64, centreline) than the
  hip or knee. At rest nothing showed; in the walk frame each stocking rose off the leg
  as a tube to the swinging hem. Fix: the hem tail joins the DISTAL set (only prims on
  bones sharing its joints may bind to it), and `hem` is excluded from the axial joints
  and segments (the pelvis bone sits exactly on the hem segment). New pin: no flesh or
  bone prim binds to the hem tail. This built on main's `cab14582` (distal joints bind
  only their own limb's prims), cherry-picked onto this branch because it was not here yet.
- **Rigid veil, non-rigid hair.** The veil is `rigid` on the skull. Without that its low
  end bound to the upper back and the face could turn inside the opening. It turns with
  a body yaw (pinned). The hair strands are NOT rigid: their tops ride the head, their
  ends ride the chest, which reads as hair lying on the shoulders.
- **Width is boxed in by the hanging arms.** The hip flare is 0.171 wide and the forearm's
  inner edge is ~0.19 at y 1.0, so the skirt can only flare front to back.

### Frames

Lab: private ports (`LAB_TMP=.lab-tmp LAB_VITE_PORT=5271 LAB_CDP_PORT=9271`), cultist
sanity shot first, probe `lightDir (0.35,0.6,0.72)` + `setSdfScale(1)`. The back frames use
`lightDir (-0.35,0.6,-0.72)`. The walk is `BLOB_POSE=walk`, on the ZOMBIE profile she still
falls back to (hence the arms-out shamble; `BRIDE_PROFILE` is Task 8).

![front](cloth-front.png) ![3/4](cloth-34.png) ![side](cloth-side.png) ![back](cloth-back.png) ![back 3/4](cloth-back-34.png)
![walk](cloth-walk-front.png) ![walk side](cloth-walk-side.png)
![bodice](cloth-bodice-front.png) ![bodice 3/4](cloth-bodice-34.png)
![veil](cloth-veil-front.png) ![veil 3/4](cloth-veil-34.png) ![veil side](cloth-veil-side.png)

Game (`node scripts/bride-game-frames.mjs 5271 9271 <out>`: `?spawn=bride&frozen=1&seed=1&vhs=off`,
`teleport(2)`, `placePlayer` 2.6 m round the first bride). The veil, bodice slot and both
skirt tiers render **uncut** at her spawn position, and the face sheet sits on the face (so the
game's face frame is still the cranium):

![game front](game-front.png) ![game 3/4](game-34.png) ![game back](game-back.png)

### Honest read

- **3 m:** a tall pale woman in a white strapless corset and a short ruffled skirt, long
  black hair, a white veil down her back, ivory stockings. Bride first. The bald/alien
  cranium read is gone: the veil and the hair cover it.
- **1 m:** the laced slot down the bodice with ribs behind the laces reads as the
  reliquary hook. Between the breasts the bodice is smooth; the painted bust gives it cups.
- **Weak spots:**
  - The skirt reads as crumpled, tiered fabric rather than lace ruffles. The warp is a
    product of Cartesian sines, so it cannot make ruffles periodic around the waist.
  - From the front the veil's crown reads a little like a nun's coif, with a black centre
    stripe (the hair mass between the locks) as the part.
  - In game resolution the laces merge into a dark slot.
  - At rest the skirt comes within ~1 cm of the forearms.

### With more prims (owner: the controller raises MAX_PRIMS separately)

- +2-4: a third skirt tier, or petticoat layers, for a fuller tiered ruffle.
- +4-6: more strand bundles (a second back layer, fuller side falls), for hair volume
  under the veil.
- +2: a separate front hair part (two small strand sweeps from the part) instead of the
  mass showing as a stripe.
- +2: a veil hem layer, so the bottom ends in a free edge rather than a round cap.

## Task 4: the WAM kit (plate, boots, chains, crosses) + the armoured flag (same day)

Source: `src/lab/sdf-zombie/characters/bride-kit.wam` (the header holds the measured flesh
table and every reason). Built with `scripts/build-wam-kit.sh bride` into
`public/assets/lab/bride-kit.gltf` (committed): 1247 vertices, 1940 triangles, 4 materials.
Pins: `characters/bride-kit.test.ts`.

| Material | Pieces |
| --- | --- |
| `plate` (dull steel, breakable) | vambraces on both forearms; couters cupping the BACK of each elbow; a fingered gauntlet with pointed plate claws on the left hand; a back-of-hand plate on the right, whose short fingers sink into the flesh cuff; a domed pauldron with a haute-piece flange on the RIGHT (sword) shoulder only |
| `boot` | cream suede thigh-highs (12-sided), sole on the floor, top at y 0.759 |
| `chain` | a girdle round the skirt's waist; a choker; a long necklace down to the top of the bodice slot |
| `iron` | three Latin crosses: one on the necklace over the laces, two hanging off the girdle |

### The uneven forearm

`bride.blob` says `forearm len=0.26 lenR=0.30`, and a WAM mirror block gives `.l` and `.r`
one length. A ten-line test `.wam` confirmed that WAM accepts sided bones OUTSIDE a mirror
block that parent to a mirrored bone (`bone forearm.r parent=upperarm.r`: `find_parent`
resolves the literal name). So `forearm.l` / `forearm.r` are explicit bones with their own
lengths, and `.r`'s tilt is negated by hand, since nothing reflects it. The hands go back
into a second mirror block, whose `parent=forearm` resolves to the suffixed bones. WAM itself
was not edited.

### Numbers (CPU: `sdBody` against the compiled glTF's rest vertices)

- **Skeleton parity:** every blob bone head is within 1.8 mm of the kit's (worst: hands,
  1.6 / 1.8 mm; the pitch+tilt resolution difference the ogre test notes). The test bar is
  10 mm.
- **Tuck:** the deepest vertex per material is within the 45 mm `TUCK_MAX`. The deepest are
  the right-hand plate fingers, which sink 25 mm into the flesh cuff on purpose (hook 4). The
  pauldron's inner rim sits 21 mm into the yoke, which is forced the way the soldier's is.
- **Boots:** sole at y 0.0011. The top is at y 0.759, 1-3 cm under the stocking's lace band
  (0.77-0.79), so stocking, band and bare thigh show between the boot and the hem (0.855).
- **Skirt clearance (the controller's check).** With Task 1's arm hang (upperarm tilt 11,
  forearm 6), the forearm FLESH already ran 5-14 mm into the ruffle skirt at y 0.94-1.04,
  probed at the forearm's own z. The plate could only punch through. **The fix was the blob:
  the arms now splay to 14 / 12.** Flesh-to-skirt air is now ≥ 13 mm at rest, and the
  closest plate vertex is 4.4 mm off the skirt (the rings beside the skirt also sit 3 mm
  outward and 2 mm narrower). `bride-blob.test.ts` still passes unchanged. In the walk frames
  the zombie profile's arms-out shamble keeps the plate well clear.
- **Handedness settled.** `.r` is −x in both languages. In the lab's yaw-0 frame (facing
  her) the pauldron, the longer forearm and the red wrist cuff are all on SCREEN-LEFT, which
  is her right. The close-up at yaw 270 shows the pauldron side with the two red swellings.

### Registry and sparks

- `CharacterEntry.armoured?: boolean` is set on the soldier and the bride.
- `character-view.ts` keys armour sparks and `loadKit`'s breakable flag on
  `entry.armoured === true`, where both used to check `entry.name === 'soldier'`.
- Shotgun casings stay soldier-only.
- **Spec deviation (as planned):** the spec says armour hits leave no wound. The existing
  soldier mechanism sparks, sheds a plate after two or three hits, and lets the flesh under it
  take the wound. That bares the raw fused seams, which suits her brief better.

### Things found on the way

- **Inside a WAM `group`, `offset=` is silently ignored.** A part is placed with
  `at=(x,y,z)`. Every cross box stacked on the group origin, so the crosses read as T's until
  the boxes moved to `at=`.
- **Frozen game captures never pose a kit.** `?frozen=1` skips the body block, and
  `character.pose` (the kit's rig ride) only runs there. So every kit sits at its bind pose
  at the world origin, and the bride stood in flesh only in the first game frames (the
  soldier would too). `scripts/bride-game-frames.mjs` now unfreezes for `KIT_STEPS` (2)
  ticks after the teleport, then freezes again.
- **`chain` joins kit-overlay.ts's LOOK table** (iron's numbers). Unlisted, it fell to
  LOOK_DEFAULT's near-dielectric sheen. `LOOK` is keyed by material name across every kit, so
  her `boot` shares the ogre's dull suede-ish entry, and her breakable `plate` gets `loadKit`'s
  own duller armour look.
- The couters began as 45 mm domes, which read as steel BALLS from behind. They are now
  shorter and taper to a point. The girdle went from 10 to 16 mm: at 10 mm it read as a sewn
  seam round the skirt.

### Frames

Lab: `LAB_TMP=.lab-tmp LAB_VITE_PORT=5271 LAB_CDP_PORT=9271`, cultist sanity shot first,
probe `lightDir (0.35,0.6,0.72)` + `setSdfScale(1)`. The body is `BLOB_DIST=2.1 BLOB_TARGET_Y=0.95`
and the close-ups are `BLOB_DIST=0.75 BLOB_TARGET_Y=1.24`. The walk still uses the zombie
profile. Game: `node scripts/bride-game-frames.mjs 5271 9271 <out>`.

![front](kit-front.png) ![3/4](kit-34.png) ![side](kit-side.png) ![back](kit-back.png)
![walk](kit-walk.png) ![walk side](kit-walk-side.png)
![close front](kit-close-front.png) ![pauldron side](kit-close-pauldron.png) ![elbow side](kit-close-elbow.png)
![game front](kit-game-front.png) ![game 3/4](kit-game-34.png)

### Honest read

- **3 m / game:** she now reads as an armoured bride. The steel forearms and the single
  pauldron make the knight half legible, and the cream boots give the long legs a line. In
  game she reads well at 2.6 m, and the crosses and necklace carry there. The plate rides her
  rig correctly (no placement bug) and renders uncut.
- **Close:** the fused-gauntlet hook works. Raw-red bulges sit in front of both elbows,
  between the couter and the vambrace. Two red swellings push out from under the pauldron's
  lip. A red ring shows at the sword wrist, and the flesh tendril grows on past the right hand.
- **Weak spots:**
  - The plate is smooth, round, tube-like steel, closer to "robot arm" than to articulated
    armour. There are no lames, rivets or edge rolls.
  - The couters still read a little like ball joints from behind.
  - The boot and stocking are close in value, so the boot top reads as a seam, not a hard
    edge.
  - The chain girdle reads as a metal band rather than as links (the links are texture only).
  - The back view is dark, which is the lab key, not the kit.
  - The haute-piece flange is barely visible from the front.
