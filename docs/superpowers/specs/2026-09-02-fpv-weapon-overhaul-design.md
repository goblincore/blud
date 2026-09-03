# FPV weapon overhaul — the goblin sawed-off (design)

**Date:** 2026-09-02
**Status:** approved (brainstormed with project owner, seven blockout rounds)
**Scope:** `sdf-game.html` / `webgpu/game-main.ts` only. The sprite game
(`index.html`, `src/main.ts`, the Blood-QAV `FpWeaponAnimator`) is a separate
lineage and is untouched.
**Supersedes:** the model half of
[2026-08-16-sdf-lab-grapeshot-design.md](2026-08-16-sdf-lab-grapeshot-design.md)
§1. That spec's fire model, ballistics and wound wiring all stand.
**Blockout + reference measurements:**
[../../dev-notes/2026-09-02-fpv-weapon-blockout/](../../dev-notes/2026-09-02-fpv-weapon-blockout/notes.md)

> **Reference assets are untracked.** `docs/dev-notes/refs/supershortyshotgun.glb`
> (Serbu Super-Shorty) and `supershotgunref.glb` (Doom-style SSG) exist in the
> owner's working copy but are not committed — `git ls-files` does not list them,
> though the directory itself is tracked and they are not gitignored. Every
> measurement in §1.1 is reproduced in this spec, so implementation does not need
> them; only re-running `measure-serbu-profile.py` does.

## Why

The shipped view-model (`grapeshot-gun-k3.glb`) is a 45 cm plank-stocked
longarm built from unsubdivided boxes, and it reads in first person as a stack
of rectangles. The owner's verdict: not good enough to build feel on.

Two distinct faults, and it matters that they are distinct:

1. **Shape.** Box-stack topology, no lathed profiles, a long barrel and a plank
   stock. Not fixable by retexturing.
2. **Finish.** [`model_grapeshot_gun_k3.py:64`](../../../scripts/model_grapeshot_gun_k3.py)
   is headed *"Materials — dark, matte; the SDF hands stay the star"* and does
   exactly that: steel at base colour `0.045,0.048,0.055` and roughness `0.50`.
   At `Metallic: 1.0` the base colour **is** the reflection tint, so a 0.045
   metal reflects almost nothing regardless of environment. That deliberate
   choice is now wrong — the gun is the thing on screen every frame.

Missing entirely: any muzzle flash, any room light on firing, any reload.

## 1. The weapon

A **hammerless break-action side-by-side**, sawed to a pistol grip. Serbu
Super-Shorty silhouette, Doom-SSG guts. One weapon, not a family — this matches
the fire model already in [`game-weapon.ts`](../../../src/lab/sdf-zombie/webgpu/game-weapon.ts)
(LMB one barrel, RMB both, 0.45 s cooldown).

### 1.1 Proportions — measured, not eyeballed

`measure-serbu-profile.py` slices `docs/dev-notes/refs/supershortyshotgun.glb`
and reports the lowest material per slice. Landmarks, as fractions of overall
length:

| landmark | fraction |
|---|---|
| grip butt (rear) | 0.00 |
| grip front strap | 0.13 |
| **trigger centre** | **0.165** |
| guard front | 0.20 |
| receiver front | 0.36 |

**Build to this table.** The gap between front strap and trigger is ~15 mm on a
42 cm gun; blockout v5 had 4 mm and the trigger visibly cut into the grip.

Locked dimensions (metres, Blender space: grip at origin, muzzles down −Y, Z up):

| part | value |
|---|---|
| overall length | 0.467 |
| barrels | 0.258 long, **outer radius 0.0225, bore radius 0.0166** |
| barrel separation (centres) | 0.0468 |
| action body | 0.104 fore-aft × 0.049 tall, half-width 0.039 at breech → 0.026 at grip |
| grip | 125 mm deep, **30 mm across at the top, 52 mm at the heel**, raked **14°** |
| guard opening | y `0.008…0.058`, z `−0.028…−0.070` |
| tri budget | **< 14k** (blockout: 11.9k) |

**Thin walls over a big bore is the load-bearing ratio.** A 12-gauge hole is
18.5 mm. Thick walls over a small hole is what made v1/v2 read as a handgun.

### 1.2 Construction techniques

Three, and each exists because a simpler one failed:

- **`loft(outline, halfwidth_fn, round_frac, sections)`** — the action body,
  tang and grip are ONE solid: a closed outline in the side plane swept through
  a rounded cross-section whose half-width varies along the gun. A flat extrude
  plus bevel cannot produce the Serbu's continuous backstrap; it gives a slab
  with chamfered corners. `halfwidth` is a callable so the breech is wide and
  the grip narrow in one continuous piece.
- **`sweep_path(path, width, thick, closed)`** — rectangular-section sweep, for
  the trigger guard (a bent flat bar, which is what it is) and the trigger
  blades. Open sweeps root the blade inside the action and leave a free toe.
- **`rake(pts, deg, pivot)`** — grip rake as ONE tunable (`GRIP_RAKE_DEG = 14`),
  applied to the grip run of the outline and the wood panel together.

**Rounding rules.** `round_frac ≈ 0.30`, `sections ≥ 16`, and
`bpy.ops.object.shade_smooth_by_angle(angle=radians(38))`. **Never subsurf an
uncreased box** (collapses it to ~⅔ volume) and **never round_frac near 1.0**
(turns the grip into a paddle). Both were tried and rejected.

`loft()` must keep its signed-area winding check — `outline_normals` only points
outward on a CCW loop, and a CW one deforms the solid silently.

### 1.3 Features

Hammerless boxlock with a flush **top lever** — no exposed hammers, so the
reload never has to animate a thumb cocking them. **No ejection port**: wrong
for a break action, and the surface actually on screen during the reload is the
**breech face**, which gets the detail instead (two chamber mouths, extractor
rim). **Top rib with a brass bead** — the single most legible "shotgun, not
handgun" cue. Twin **inline** triggers on the centreline (not side by side).
Wood: raked pistol grip with inset side panels, and a rounded splinter fore-end.

Exaggeration dial: silhouette masses ~15% fatter than real, **nothing smaller
than 4 mm** (no screws, no lettering, no sights beyond the bead), bevels
1.2–2.8 mm at 2–4 segments. The owner rejected heavier stylisation three times;
err toward real.

## 2. Materials

| material | base colour (linear) | metallic | roughness |
|---|---|---|---|
| Steel (action, furniture) | `0.205, 0.215, 0.245` | 1.0 | **0.22** |
| Blue (barrels, rib) | `0.115, 0.125, 0.155` | 1.0 | 0.30 |
| Brass (hinge pins, bead) | `0.62, 0.44, 0.16` | 1.0 | 0.28 |
| Wood | `0.255, 0.135, 0.062` | 0.0 | 0.52 |
| Bore | `0.012, 0.012, 0.014` | 0.0 | 0.90 |

The gun keeps its own private PMREM environment (already built at
[`game-main.ts:1026`](../../../src/lab/sdf-zombie/webgpu/game-main.ts)) so it
stays lively under the dark dungeon rig, with `envMapIntensity` raised to ~1.1.

## 3. Hands and forearms

Green orbs stay — the player is the goblin — but corrected, and extended
because the reload swings the support arm into frame.

Values taken from [`goblin.blob`](../../../src/lab/sdf-zombie/characters/goblin.blob):

- **Colour** `baseColor 0.34 0.44 0.19` linear → sRGB ≈ `#9db17a`, `roughness
  0.42`. The current orbs are `0x5a8f3c` at roughness `0.85` — **much darker and
  more saturated than the goblin has ever been.**
- **Hand radius 0.046** (`blob arm on hand at=0.55 r=0.046`), not 0.055.
- **Forearms**: capsules, radius 0.028 mid tapering to 0.038 at the elbow, 0.235
  long (`goblin.blob:261-263`). Out of frame at rest; the reload reveals them.
- **Warty normal map**, generated on a canvas at boot: tileable fbm plus a
  sparser wart layer, matched to the goblin's `mottleAmp 0.65 / mottleScale
  1.6` ("patches a hand-span across, not freckles") and its clammy
  `specIntensity 0.52 / wetness 0.55`. Canvas-generated rather than a baked PNG
  because it is deterministic (testable by pixel checksum), live-tunable, and
  needs no load path — the same call the repo already makes for the burst-layer
  procedural fallback. Promotable to a baked asset later.
  Note `SphereGeometry`'s UV pole pinch: orient poles into the gun.

## 4. Muzzle flash

One envelope (~70 ms, sharp attack, exponential decay) drives three consumers:

1. **Geometry** — two additive cross-billboard quads plus a crown ring at the
   *fired* barrel's muzzle, with a random roll per shot so repeat shots don't
   strobe identically.
2. **The level** — a `THREE.PointLight` at the muzzle, **allocated once at boot
   with `intensity = 0`** and only modulated. Adding or removing a light at
   runtime forces a TSL shader recompile; doing that per trigger pull would
   hitch every shot.
3. **The SDF bodies** — and this is the load-bearing decision. Marched bodies
   cannot see that PointLight; they are lit by `spotPos / spotAxis / spotCfg /
   spotColor` in [`zombie-gpu.ts:239`](../../../src/lab/sdf-zombie/webgpu/zombie-gpu.ts).
   For its 70 ms the flash **borrows the existing flashlight uniforms**:
   intensity punched ~6×, cone widened, colour pushed warm, origin snapped to
   the muzzle; the flashlight's own state is saved and restored.

   Why borrow rather than add a second light slot: [`march.wgsl.ts`](../../../src/lab/sdf-zombie/webgpu/march.wgsl.ts)
   is being rewritten right now by the sdf-render-perf-r2 chain, and a shader
   edit here collides head-on. **A proper second light slot is the follow-up,
   after that chain merges.** The borrow is a deliberate temporary.

## 5. Reload

Requires a **2-shell magazine** — there is no ammo state today. Fires dry after
two barrels; `R` reloads early. Doom-SSG rhythm, ~0.95 s:

| t (s) | beat |
|---|---|
| 0.00–0.18 | **present** — gun rolls left and up toward camera |
| 0.18–0.34 | **break** — barrels hinge down ~35°; support forearm swings into frame |
| 0.34–0.46 | **eject** — two spent shells arc out spinning, gone under gravity |
| 0.46–0.66 | **load** — support hand dips out of frame, returns; shells shoved into the chambers |
| 0.66–0.82 | **snap** — hinge slams shut, small kick |
| 0.82–0.95 | **settle** — back to idle |

The GLB carries **no baked animation**. It exports named nodes — `Barrels`
(hinge child: barrels, rib, bead, chambers, fore-end), `Frame`, `Hinge`,
`Muzzle_L`, `Muzzle_R`, `Grip_Hand`, `Fore_Hand` — and the break is a
code-driven rotation of `Barrels` about `Hinge`. That keeps it interruptible,
blendable with recoil and view-bob, and re-timeable without a re-export; the
existing model pipeline has no animation export path to build on anyway.

## 6. Code shape

- **`scripts/model_grapeshot_shorty.py`** — new Blender script (not a patch of
  the k3 one; its box-stack topology is the thing being replaced) →
  `public/assets/lab/shorty-double.glb`. Seeded from
  `docs/dev-notes/2026-09-02-fpv-weapon-blockout/blockout.py`, which carries
  every tuned number but has no GLB export, no named nodes and no hinge split.
  Renders turntable + **FPV** previews as standing outputs. Old GLBs stay on
  disk for A/B.
- **`src/lab/sdf-zombie/webgpu/game-viewmodel.ts`** — new module owning the gun
  group, orbs, forearms, the hinge/recoil/bob state machine and the flash
  envelope. Pure timing functions (`viewmodelPose(t, state)`,
  `flashEnvelope(t)`, `magazineAfterFire(...)`) unit-tested; Three.js wiring
  thin. Lifts ~120 lines out of [`game-main.ts`](../../../src/lab/sdf-zombie/webgpu/game-main.ts),
  which is over 2,100 lines.

## 7. Gates

1. Turntable + trigger-group closeup + FPV renders committed to `docs/dev-notes/`.
2. **In-engine FPV capture is the look gate**, not the Blender FPV render — see
   the blockout notes for why that preview can only ever be a smoke test.
3. A reload-sequence capture strip (6 frames at the beat boundaries).
4. Flash: one capture with a zombie in frame proving the marched body is lit,
   since that is the part a `PointLight` cannot do.
5. Owner look gate before it becomes the default.

## 8. Deferred

- A real second light slot in the march shader for the flash (after
  sdf-render-perf-r2 merges).
- Baked (rather than procedural) goblin-skin normal + mottle maps, if the
  procedural one needs art direction.
- Porting the lab's marched `createHandsGpuView` hands into the game page.
- Single-barrel variant. Rejected for now: one gun, done well.
