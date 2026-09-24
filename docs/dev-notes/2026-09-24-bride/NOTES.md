# Bride — sword enemy, Task 1: the flesh body (2026-09-24)

Spec: `docs/superpowers/specs/2026-09-24-bride-sword-enemy-design.md`.
Body: `src/lab/sdf-zombie/characters/bride.blob` (the header is the design brief).
Pins: `src/lab/sdf-zombie/characters/bride-blob.test.ts`.

Flesh only. No shells, hair, kit, sword or face sheet yet (Tasks 2-5).

## Numbers (CPU field, `sdBody` probes)

| What | Value | Spec |
| --- | --- | --- |
| Prims | 68 flesh + 27 bone = 95 | ≤ 108 (128 − 20 for Task 3's cloth) |
| Flesh crown | 1.814 m | ~1.85 once the hair and veil are on |
| Hip joint / height | 1.04 / 1.814 = 0.57 | ≥ 0.54 |
| Waist half-width | 0.086 | ≤ 0.095 |
| Hip half-width | 0.171 | ~0.16 (must stay < 0.18, or the hips touch the forearms) |
| Thigh | 0.068 semi at the root, 0.052 at mid-thigh, 0.035 at the knee | a woman's taper (look pass) |
| Neck bone | 0.140 m | ≥ 0.13 |
| Forearm R − L | 0.04 m (0.30 vs 0.26) | > 0.03 |

## Frames

Shot with `LAB_TMP=.lab-tmp LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 npm run blob:shot -- bride`.
The probe was `BLOB_PROBE="(window.__sdfLab.uniforms.lightDir.value.set(0.35,0.6,-0.72), 1)"`.

- **The light's z is negated** relative to the broodmother notes. In today's lab,
  **yaw 180 is her face** (frame 04 of 8), and the broodmother's `+0.72` lights her back.
- **Use private ports.** Another worktree's Vite was already on 5233. `lab-servers.sh`
  reuses any listener, so the first "bride" shot was that checkout's zombie.
  Sanity-shoot `cultist` on the same ports first.

![front](body-front.png) ![3/4](body-34.png) ![side](body-side.png) ![back](body-back.png)
![torso](torso-front.png) ![torso 3/4](torso-34.png) ![legs](legs-front.png)
![face](face-front.png) ![face 3/4](face-34.png) ![head at 1 m](head-1m.png)

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
