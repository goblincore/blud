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
