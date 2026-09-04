# FPV goblin arms — design (2026-09-04)

**Status:** approved in conversation, spec for owner review.
**Owner's ask:** "the FPV arms are a bit too thin... the goblin SDF has a nice
texture on the face we could apply to the hands and arms... the goblin has
some gauntlets, quite basic looking; in FPV make them more detailed to match
the shotgun." Then: "ball hand is fine... skin texture and making it less
flat without the glow." Then: "maybe if he wore a watch... smartwatch is
appealing with a small glowing screen, could be a useful in-game device."
Tracked as **F-arm.1** in `TASKS.md`.

## Goal

The player's arms and hands read as the goblin — green mottled skin with
presence, a leather bracer with hardware that matches the shotgun's finish,
and a smartwatch on the left wrist — instead of two flat green tubes with a
glow. The ball-hand stylisation stays. Reload, fist hold and elbow anchoring
are untouched.

## Non-goals

* A real hand with fingers. The ball hand is the goblin's look.
* Arm inverse kinematics. The arm stays a rigid stick from the hand to a
  fixed elbow anchor, as today; an elbow lump gives the read.
* Using the watch as a device. The screen is a drawable texture from day
  one (see §5) but shows only a static face in this pass.
* Changing the goblin `.blob` flesh. The third-person goblin gets the watch
  in its **kit** (`goblin-kit.wam`), nothing else moves.

## 1. The asset — `public/assets/lab/goblin-arm.glb`

Built by `scripts/model_goblin_arm.py`, a headless Blender script in the
mould of `scripts/model_grapeshot_shorty.py` (same `put`/`cyl`/`tube`/`loft`
helpers, same export + verify + gate tail). One arm is authored and mirrored
in x for the other; both are exported.

**Frame.** Each arm's root sits at the **hand centre**; local **+Y runs from
the hand toward the elbow**, so `aimForearm` in `game-main.ts` keeps working
verbatim (it aims local +Y at the fixed elbow anchor). glTF Y-up export as
the gun.

**Parts per arm** (metres; skin radii are up from the blob's 0.028 shaft,
per the owner's "too thin"):

| part | shape | size | material |
| --- | --- | --- | --- |
| hand | sphere, UV pole toward the gun | r 0.046 (unchanged: `GOBLIN_SKIN.handRadius`, `loadHold` depends on it) | Skin |
| knuckle nubs | 3 spheres on the dorsal side, merged by smooth shading only | r 0.011 | Skin |
| wrist | sphere | r 0.034 at y 0.055 | Skin |
| forearm | cone frustum wrist→elbow | r 0.036 → 0.042, y 0.055 → 0.235 | Skin |
| elbow | sphere | r 0.046 at y 0.235 | Skin |
| upper-arm stub | cylinder past the elbow | r 0.040, y 0.235 → 0.70 | Skin |
| warts | 5 small spheres, hand + forearm, fixed seed | r 0.003–0.005 | Skin |

The upper-arm stub runs on so the far end is never in frame on a hard look
down (the F-eject.2 forearm was lengthened to 0.90 m for exactly this).

**Bracer** (left and right): a leather cuff lofted over the forearm from
y 0.075 to y 0.180, radius forearm + 0.007, with:

* a **steel lip plate** ring at the wrist end (3 mm tall, 2 mm proud),
* **two raised straps** (leather, darker) at y 0.100 and y 0.155, each with a
  **brass buckle** (a 12 × 8 × 3 mm frame and a pin) on the outer face,
* **six brass rivets** (r 2 mm domes) in a row along the dorsal ridge.

**Smartwatch** (left arm only): a **silicone band** ring at y 0.052 (the
wrist), 8 mm wide, 3 mm thick, dark; a **body** — rounded square 30 × 26 mm,
6 mm thick — on the dorsal side; a **screen** inset 1 mm as its own mesh,
`Watch_Screen`, with planar UVs 0..1 so a texture maps onto it
straight. The face outline is a mesh, the display is a texture.

**Named nodes the runtime requires** (missing = throw, like the gun):
`Arm_L`, `Arm_R`, `Hand_L`, `Hand_R`, `Wrist_L`, `Wrist_R`, `Elbow_L`,
`Elbow_R`, `Watch_Screen`.

**Materials by name:** `Skin`, `Leather`, `Steel`, `Brass`, `Band`, `WatchBody`,
`Screen`. Steel and Brass use the shotgun script's values verbatim so the kit
reads as one set. Leather: base (0.14, 0.09, 0.06), roughness 0.75, metal 0.
Band/WatchBody: near-black, roughness 0.6/0.35.

**Budgets and gate** (in the script, like the gun): both arms ≤ **14,000
tris**, GLB < 1 MB, every required node present, `Watch_Screen` under
`Arm_L`, every skin mesh carries UVs (a mesh without UVs would render the
maps as one texel — the flat green this exists to remove).

**UVs.** Skin meshes get a cylindrical unwrap around local Y scaled so one
tile of the generated maps covers ~60 mm of arm; the hand sphere keeps its
sphere UVs with the pole toward the gun (as today).

## 2. Skin that reads — `goblin-skin.ts`

Today the hand material is base green + a generated wart **normal** map +
`emissive 0.30`. The emissive is what flattens it. Changes:

* **`goblinAlbedoPixels(size, seed)`** — a new tiling sRGB colour map: the
  blob's `baseColor` with `mottleColor (0.21, 0.19, 0.06)` patches mixed in by
  the same tiling value noise at `mottleScale`, amplitude `mottleAmp`, plus a
  faint darkening ring around each wart position shared with the normal map
  (same seed, same lattice, so bumps and blotches agree).
* Material: `map` = albedo, `normalMap` = existing warts at `normalScale 1.2`,
  `roughness 0.42`, **no emissive**, `envMap` = the gun's RoomEnvironment
  PMREM at the gun's `envMapIntensity`, so skin catches light in the dungeon
  the way the gun does. Same material instance on both arms.
* Tests (`goblin-skin.test.ts`, extending the existing normal-map tests):
  the albedo tiles (first/last row and column agree within 1/255), its mean
  is within 8% of the base sRGB, its per-channel standard deviation is above
  a floor (it is not flat), no NaN, and the same seed gives the same bytes.

## 3. The watch screen — `game-arms.ts`

A `CanvasTexture` 128 × 112 drawn once at load with a static face: dark
background, a thin ring, a few glyph bars, a small dot — no text, so nothing
has to be readable at 25 mm. Material `Screen`: `map` + `emissiveMap` = the
same canvas, `emissive white`, `emissiveIntensity 1.4`, so it glows faintly
in the dark and is the only emissive on the arms. The module exposes
`watchScreen(): { canvas, texture }` so a later pass can draw shells, health
or a timer on it (`needsUpdate` after drawing). That later use is recorded in
`TASKS.md` as a follow-up, not built here.

## 4. Runtime — `game-arms.ts` + `game-main.ts`

New module `src/lab/sdf-zombie/webgpu/game-arms.ts` so `game-main.ts` (4,000+
lines) does not grow: `loadGoblinArms(url, { env, envMapIntensity }) →
{ left: Group, right: Group, watchScreen }`. It loads the GLB, asserts the
node contract, builds the skin material (§2) and the watch material (§3),
maps `Steel`/`Brass` to the gun's treatment (env map, intensity 1.1), and
returns the two arm groups with their roots at the hand.

`game-main.ts` replaces `makeHand`'s sphere+capsule with the two groups:
`gripHandGroup = arms.right`, `foreHandGroup = arms.left`, positioned at
`GRIP_HAND_REST` / `FORE_HAND_REST` as today, aimed at `ELBOW_R` / `ELBOW_L`
by `aimForearm` — which now sets the arm root's quaternion so local +Y
points at the elbow anchor. The root's origin IS the hand centre, so aiming
never moves the hand; only the arm swings behind it. `GOBLIN_SKIN.handRadius` stays the source of truth for
`loadHold`; the hand sphere in the asset is built from the same number and
the model gate asserts it.

Seams: `__sdfGame.arms` → `{ left: boolean, right: boolean, skinEmissive:
number, watch: boolean }` for the gate.

## 5. Kit parity — `goblin-kit.wam`

The third-person goblin gets the same watch on the left forearm: a `loft
watchband bones=forearm..forearm` ring at the wrist (t 0.90–0.96, w/d =
flesh + band) in a new `band` material, and a small `loft watch` for the
body on the dorsal side. Whether WAM's loft can express a rounded-square body
is checked in the plan; if not, the body is a short elliptical loft and the
kit test pins its presence and placement only. The screen does not glow in
the kit (no emissive path there); it is a dark disc. `goblin-kit.test.ts`
gains a check that the watch exists on the left forearm only.

## 6. Gates and evidence

* Model script gate (§1) runs on every export; `[goblin-arm] OK`.
* `scripts/sdf-game-shorty-gate.mjs` gains check 2b: `__sdfGame.arms` reports
  both arms, `skinEmissive === 0`, `watch === true`.
* Evidence, in `docs/dev-notes/2026-09-04-fpv-goblin-arms/`: a Blender
  turntable of one arm (four angles), `fpv-rest.png`, the reload strip (the
  left arm crosses the frame at 900–1110 ms), and a 2× crop of the support
  hand at rest showing mottle, bracer hardware and the watch glow.
* Owner verdict in play, as always.

## Open questions

None. The watch's in-game use is a follow-up, not a question.
