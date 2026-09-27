# Warbull — Task 1 notes (body), 2026-09-27

Plan: `docs/superpowers/plans/2026-09-27-warbull.md`, Task 1.

## What landed

- **`characters/warbull.blob`** is `minotaur.blob` ×1.28 on every length, with
  angles and bone fractions unchanged. That takes 1.90 m to 2.432 m, with the
  horn tip at 2.605 m (field-marched). Beyond the scale:
  - **Dropped** the painted right-leg prosthetic (five metal `box` plates, a cable
    and two seam grooves) and the painted shoulder cables. Both legs are the
    minotaur's left-leg flesh, mirrored.
  - **Left-only** horn sweep and glowing eye bead. The right side is kit (steel
    horn, optic). Both horn-root bosses stay, as the steel horn's socket.
  - **A hump** behind the neck (one torso blob). The back surface at y 1.65–1.85
    moves from z ≈ −0.29 to about −0.39: about 10 cm of profile, where the
    minotaur has only the gap behind its traps.
- **`warbull-face.png`** was baked from the minotaur reference mesh
  (`blob:face-bake -- minotaur --head-frac 0.165`), then soft-cropped to the face
  band. The minotaur's own PNG was never committed; the registry has been 404ing
  it. Mean 0.3204, measured off the opaque texels.
- **Registry entry** `warbull`, shown as `?character=warbull` in the lab. He
  walks the zombie shamble for now; his profile is Task 4.
- **Tests:** `warbull-blob.test.ts`, 13 pins (plan, Task 1).

## Frames

There are no GPU frames: the cloud container has only SwiftShader, as for the
Juggernaut. The image below is a CPU sphere-trace of `sdBody`: flesh only, with
no face decal, no palette and no kit. Views are front, side and three-quarter,
with the Juggernaut's flesh left and the Warbull right in each pair. The blue
lines mark 2.60 m and 2.291 m.

![body vs juggernaut](body-vs-juggernaut.png)

## For the owner to judge in the lab

- The bull head and horns at scale, and whether the hump reads from the side.
- **Palette:** kept at the minotaur's pink (henenlotter-latex). A darker,
  redder hide may contrast the chrome better; judge that once the kit is on.
- **Gait:** the zombie shamble for now. STOMP (the ogre's) is the candidate.

# Task 2 — the kit, 2026-09-27

`characters/warbull-kit.wam` is the machinery, authored under one rule:
**embedded, not worn**. Every part is small against the body, and meets the
flesh at a collar or an insertion. The .wam header lists how far each part is
sunk.

- **Legs (both):**
  - steel-shod **hooves** over the paws, with a brass rim where the fetlock
    flesh enters;
  - a chrome **knee cop**;
  - a **hock piston**: a housing on the outer shin, and a rod diving into the
    ankle through a brass collar.
- **Centreline:**
  - a **spine rack** of five iron vertebral plates down the hump, each with an
    LED, and a chrome conduit over them;
  - a **reactor** sunk into the upper abdomen, with a brass collar, an amber
    core, and two cables that run up the chest and dive into the pecs.
- **Right side (the machine's):**
  - a **steel horn** with brass bands, collared into the flesh horn-root boss;
  - an **optic** (a chrome barrel sunk in the right eye socket, a red lens and
    an LED);
  - an iron **cheek plate**;
  - a chrome **shoulder cap** over the deltoid, with a brass collar;
  - a cable down the back of the upper arm;
  - a brass **elbow collar** and a chrome **gun-arm sleeve** down to the fist
    (the launcher prop, Task 4, swallows the fist), with two LEDs.
- **Materials:** chrome, iron, brass, cable, lens, led and core. The runtime
  looks for chrome, cable, led and core are Task 3; until then they take
  `LOOK_DEFAULT`.
- **Skinning chosen for the plates** (Task 5):
  - skull: horn, optic, cheek;
  - chest: reactor;
  - neck and spine2: rack;
  - forearm.r: sleeve and collar, which go with the launcher.
- **`warbull.blob`:** the paw's claw prims were dropped; the hoof encloses the
  paw.

## The skeleton transcription needed a fix the soldier kits never did

The .blob applies a down bone's **pitch then tilt** (`blob-compile.ts`
`dirVector`); WAM applies **tilt then pitch** (`skeleton.py` `resolve_dir`,
rotY·rotX·rotZ). The soldier-family kits negate pitch and copy tilt, which
is right to under a millimetre at their 2–12° angles. At the minotaur's 40°
arm tilt it is centimetres. The .wam solves each (pitch, tilt) pair to give
the .blob's exact direction (formula in its skeleton comment). All 20 bones
land within 0.004 mm.

## Pre-flight without WAM: `scripts/wam-shadow.ts` + `scripts/wam-preflight.ts`

WAM still cannot run in this container, so I transcribed its skeleton, loft,
attach and sweep maths into TypeScript. I read the source in a local WAM
checkout; I did not run it.

**Checked against the compiled `juggernaut-kit.gltf`:** every ring vertex
within 1 mm, and identical per-material bounds. Sweeps are transcribed but not
yet checked against a compiled kit.

```
npx tsx scripts/wam-preflight.ts warbull [part-prefix]
```

It prints bone agreement and, per part, the deepest sunk vertex and the
nearest and farthest distance to the flesh. The kit was sized with it:

- the deepest vertex is the shoulder cap's rim in the trap shelf, −57 mm;
- nothing floats except the rack LEDs and conduit, which sit on the plates;
- the soles are at y 0.004;
- the steel horn's tip lands within ~3 cm of the mirrored flesh horn.

`warbull-kit.test.ts` (13 pins) **passed against a shadow-built glTF**
(written temporarily, then deleted). It skips until the real build exists:

```
scripts/build-wam-kit.sh warbull
npx vitest run src/lab/sdf-zombie/characters/warbull-kit.test.ts
```

Preview: the CPU flesh raster with the shadow's kit vertices drawn as
depth-tested dots, coloured by material. Placement only; it shows no shading
of the kit.

![kit pre-flight](kit-preflight.png)

## Expect from the real build

- WAM lint on the `hips`/`hand`/`foot` bones having little geometry (normal).
- Possibly an `on=`-less "floating part" lint on the rack LEDs, which sit on
  the plates, not on the flesh.
- If the real mesh disagrees with the pre-flight, the sweeps (steel horn,
  reactor cables) are the least-checked parts.

# Task 3 — looks and blinking lights, 2026-09-27

- **`status-lights.ts` (pure, 9 tests).** It maps mind state, sim time, plate
  damage and rage to LED and core levels:

  | Mode | LEDs | Core |
  | --- | --- | --- |
  | idle | double-thump heartbeat, 1.2 s | breathes |
  | alert | heartbeat, 0.7 s | breathes |
  | aim (the rocket telegraph) | 8 Hz strobe | flares |
  | fire | bright and ragged | flares |
  | stunned | stutter | stutter |
  | dead | dark | dark |

  Plate damage drops LEDs out deterministically (up to 55% of the time at full
  damage). When he is enraged the core turns from amber to red. Each body gets
  its own phase, so a crowd doesn't blink in unison.
- **New looks in `kit-overlay.ts` LOOK:**
  - `chrome`: metalness 0.88, roughness 0.10, env 1.7. It is the one material
    that must read as polished metal against wet flesh.
  - `cable`: soft rubber sheen.
  - `led`: red emissive, 1.4.
  - `core`: amber emissive, 1.6.

  `KitOverlay.glow()` scales the pulsed materials (`led`, `core`) from those
  authored intensities. The juggernaut's `lens` is deliberately not pulsed.
- **Wiring:**
  - `GameActor.statusLights()` reports the actor's mind state and its plate
    damage fraction.
  - game-main passes it to `character-view.pose`.
  - With no lights passed, as in the lab turntable, the view runs an idle
    heartbeat on its own clock, so `?character=warbull` blinks in the lab.
- Unverified on a GPU here: the actual brightness of the emissives against the
  lab key. It is the owner's call once the kit is built.

# Task 4 — the launcher and the rockets, 2026-09-27

- **Prop.** `scripts/make-warbull-launcher.ts` writes `warbull-launcher.glb`
  (29 KB). It is a chrome-and-iron casing that swallows the fist and lower
  forearm, with iron ribs, a brass cuff where the kit's sleeve enters, and
  LED strips. On top is a three-tube rotary cluster (`Barrels`) with glowing
  tube floors.
  - The locators are GUN_GRIP's.
  - `gripReach` 0.09 seats Grip_Hand at the middle of his 0.18 m hand bone, so
    the casing is built round the fist, 2 cm prop-local (3.2 cm world) clear
    of it.
- **Two one-handed carries** (`carry.ts`). Each was grid-searched through the
  real motion pipeline, then refined with the wrist corrections
  (`.lab-tmp/solve-launcher.ts`; 61 ms per evaluation):

  | Carry | Used for | Carry angles | Wrist | Result |
  | --- | --- | --- | --- | --- |
  | `launcher` | fire (raised) | pitch 0.60, yaw 0.30, fold 0.35 | gunPitch 0.244 | muzzle level at 1.75 m and on his facing; fist 0.81 m ahead; casing ≥ 10 cm clear |
  | `launcherLow` | walk | pitch 0.25, yaw 0.40, fold 0.20 | gunPitch 0.165 | muzzle 31° down at 1.05 m; casing 6.6 cm clear |

  The swap from the walk carry to the raised one (the brain's `weaponUp`) is
  the visible raise before a volley. `warbull-blob.test.ts` pins both carries,
  standing and walking, through the pipeline:
  - **Grip in the fist: within 3 cm.** Not the soldier family's 2 cm, because
    the fist is hidden in a casing 3.2 cm clear. Measured 2.1 cm walking.
  - **Muzzle yaw:** within 7°.
  - **Muzzle pitch:** within 0.1 rad of target.
  - **Casing clearance:** at least 3 cm.
- **`WARBULL_PROFILE`:**
  - soldier family, so regional injury, collapse and footwork apply;
  - STOMP gait, cruise 0.85, turn 1.6 rad/s (the slowest in the roster);
  - `gunner.weapon: 'rocket'`.

  The registry now uses it, so the lab walks him with the launcher.
- **`ROCKET_TUNING`** (soldier brain):
  - notice 12 m, fire range 11 m, preferred range 7 m;
  - aim 1.0 s (the telegraph);
  - **exactly 3 rockets** about 0.4 s apart, with follow-ups sweeping;
  - settle 0.9 s, cooldown 2.6 s;
  - no strafing or retreating.

  Pinned in `soldier-brain.test.ts`.
- **`rockets.ts` (pure, 7 tests):**
  - slow (9 m/s) so the player can step out of the line;
  - detonates at the last free point on world, player or actor contact, or at
    20 m;
  - never hits its firer inside 0.15 s;
  - player damage 45 at the epicentre, quadratic falloff to 0 at 3.2 m, so two
    of the three must land to kill from full health.
- **Game wiring:**
  - `onFire` spawns a rocket, aimed like the SMG: the arm's heading, the
    player's chest for the vertical.
  - The frame loop steps rockets after the actors, with world, player and
    actor-capsule tests.
  - Each detonation goes through **`detonateAt`**, the dynamite path: wounds,
    gibs, light, fireball, camera kick. The player takes `blastPlayerDamage`
    (a new `'blast'` damage kind).
  - Rockets draw as fat slug tracers.
  - `ctx.weapon.rockets` and `rocketViews` are in the weapon slice.
- **Tube index:** `stepBarrelIndex` turns the cluster a third of a turn per
  rocket, in about 0.2 s (`barrel-spin.ts`, 2 tests). The actor drives
  `barrelSpin` with it for the rocket weapon.
- **The face decal's red eyes glow now,** using the soldier family's
  `eyeGlowRedOnly` values, since he is family.
- **No casings** from the launcher.
- **Not verified here (no GPU):**
  - the rocket tracer's look;
  - how big the dynamite burst reads as a rocket hit;
  - whether the warbull's own rockets wound him at point blank (they can:
    detonateAt wounds every body in range, firer included).

  All three are for the owner's playtest.

# Task 5 — plates on the machinery, and the disarm, 2026-09-27

## Plates that cover only the metal

The Juggernaut's plates cover whole bone groups, because his suit covers
everything. The Warbull's metal is embedded in flesh that shares its bones:
the neck bone carries his pecs *and* the spine rack behind them. So
`PlateSpec` gained two optional fields (`plate-armor.ts`):

- **`region`**: a rest-body sphere the hit must also land in.
- **`kitBones`**: which bones' kit islands shed with the plate, when that is
  narrower than `bones`.

`WARBULL_ARMOR`:

| Plate | Covers | HP |
| --- | --- | --- |
| `launcher` | the whole right forearm and fist (bone-only) | 14 |
| `headgear` | steel horn, optic and cheek plate (region on the right side of the head) | 6 |
| `reactor` | the housing below the pecs (region) | 12 |
| `rack` | the spine plates down the hump (region) | 12 |

Everything else is flesh on the first round. `WARBULL_INJURY_TUNING` is the
soldier's thresholds ×2.

**Hit points are carried back to the rest body** by `restHitPoint`:

- de-yaw about his root, then re-seat the hit on the rest prim along its
  segment;
- for a rigid head prim, undo its orient quaternion exactly.

The world point de-yawed about the root was not enough: the stomp's hunch and
the head's nod carry the chest and head centimetres off their rest places.
Blasts are judged by bone and crack every plate on a wounded bone.

## The disarm

- **When the launcher plate sheds,** `GameActor.disarmed()` goes true.
  game-main then releases the held prop, which is flung off to his right, and
  logs a `disarm` telemetry event.
- **With the prop released, `onFire` refuses to shoot,** so the ranged mode
  is over.
- **The status lights' core turns red** (`enraged`).
- **The kit's sleeve and elbow collar shed with it:** `kitShedFor` on
  `forearm.r`.
- **Until Task 6** his mind still raises the arm to "aim" at nothing. Task 6's
  warbull mind takes over when he is disarmed.

`webgpu/game-actor-warbull.test.ts` (5 tests):

- the reactor absorbs until it breaks;
- a pec beside it wounds at once;
- the rack guards his back;
- the left eye is flesh while the optic side is steel;
- 14 rounds on the forearm disarm him and turn the core red;
- his left arm is flesh.

## Found on the way: the head pivot (fixed for the Warbull; the minotaur still has it)

The actor test's head shots missed, and the reason was the rig:

- `motion.ts` aims the head bone at the gaze point through IK_TUNING's cone,
  which gives a ~28° nod on every character.
- The head pivots at the neck bone's tail.
- The minotaur ends its neck at 1.775 m (×1.28), deep in the trap shelf, and
  carries the cranium 0.48 m higher on a 1.08 m skull bone.

**Measured in the motion pipeline (cranium drift from its rest place,
relative to the pelvis):**

| Character | Standing | Walking |
| --- | --- | --- |
| soldier | 6 cm | 6 cm |
| minotaur | 19 cm | 36 cm |
| Warbull before | 24 cm | 55 cm |
| **Warbull after** | **10 cm** | **30 cm** |

After the fix the Warbull is in proportion with the ogre, whose head sits at
a similar height above its pivot; walking adds the gaze leading into turns.

**The fix, in `warbull.blob`:**

- The neck runs up to **2.05 m** (behind the jaw) and the skull is 0.4644 m,
  which keeps the cranium centre exactly where it was.
- Every neck and skull prim is re-fractioned to the same world place.
- The clavicles move to **spine2** (the soldier's topology), with the tilt and
  length re-solved so their tails, where the arms hang, don't move. A bone
  `at=` would have been simpler, but the grammar parses it and never compiles
  it: a gap, noted here.

The kit's skeleton and skull parts followed. The pre-flight numbers are
unchanged, and the kit test passes against a shadow glTF again.

**`minotaur.blob` has the same pivot problem** and was not touched here. That
is the owner's call: the minotaur is "done enough", and fixing it means the
same re-fraction.
