# Isometric view experiment — 2026-09-07

Branch: `iso-experiment` (off `main` @ 7a10a4b4). Owner question: "what would
the FPS look like from an isometric view from above?" This pass answers the
plumbing half (camera, player body, weapon carry) and isolates one open
rendering bug (below) that blocks the final look.

**Try it:** `npm run dev:fps` → `/sdf-game.html?iso` (or press **I** in game,
or `__sdfGame.setIso(true)`). Toggle back to FPV the same ways. A lab server
was left running for the owner at `http://localhost:5333/sdf-game.html?iso`
(vite 5333, CDP Chrome 9333, profile `/tmp/chrome-lab-9333`).

## What was built

**1. The iso camera** (`game-main.ts`, `ISO_CAM` / `applyIso`).

- **Narrow-FOV perspective, not orthographic** (26° at 9.5 m, pitch 0.31π,
  fixed yaw, exponential-follow focal at the player's chest). Deliberate:
  the march's accumulated-depth gate unprojects clip depth with the explicit
  perspective formula (`near*far/(far - depth*(far-near))`, zombie-gpu.ts),
  the goo surface pass rebuilds rays with `tan(fov/2)`, and the cone
  pre-pass derives its footprint from `camera.fov` — ortho would silently
  corrupt all three. A true ortho pass is a bigger project (WGSL + goo +
  cone changes), not a spike item.
- **Lens co-invariant honoured**: `applyIso` is the one writer of
  `camera.fov` for this mode and re-calls `postAa.setLens(camera.fov,
  centerFovDeg)` in the same breath (k = 0 → exact identity, which iso wants).
- **Fog ×4 while in iso** — the dungeon fog (far 13) is view-distance-tuned
  for an eye at 1.62 m and washes an orbit camera at ~9.5 m to black.
  Restored on toggle-off. Caveat: toggling the dungeon rig *while* in iso
  re-runs `applyRig`, which resets fog — accepted dev-surface combination.
- **WASD is screen-relative**: intent is remapped from the camera's fixed
  ground axes into the player's view frame before `stepPlayer` (the 2×2 is
  its own inverse). Mouse X turns the goblin; mouse Y is dead in iso
  (guarded in both the mouselook and free-aim paths) so a leftover FPV pitch
  can't tilt shots nobody sees aiming. Shots run off the player yaw exactly
  as in FPV (`muzzleWorld`'s eye-relative fallback + `convergedDir`) — the
  fire path is untouched.
- Flashlight: in iso the beam is re-posed at the **player's eye** along the
  facing (`isoLightRig`, a bare proxy camera — `dungeon-lighting.update`
  reads only position/quaternion/direction), because a beam from the orbit
  camera reads as a searchlight.

**2. The player goblin body** — "the player is an invisible capsule" stops
being true visually in iso.

- **`game-player-body.ts` (`createPlayerBodyDrive`)**: the lab's motion
  pipeline (stepMotion → stepRig → applyRig → view.update) driven directly by
  the capsule — the drive contract is `wander.pos <- player pos`,
  `faceHeading <- yaw`, `forceSpeed <- |horizontal vel|` (the lab treadmill
  knob keeps the gait blending with integration off; `shift` is built from
  `wander.pos` unconditionally, so the body lands exactly on the capsule),
  and `sig.fire` as a one-shot per shot (arms `FIRE.holdSec`, the aim carry,
  `sinceFire` → muzzle rise). Substep discipline, ropes, kicks and
  `constrainRigBends` mirror `game-actor.step` minus mind/wander/damage.
  **Gotcha found while wiring:** `pickArmStyle` prefers the *gait* profile's
  arm style, so a SHAMBLE-legged carrier needs `cfg.armStyle: 'carry'`
  explicitly — the soldier gets away with it only because MARCH/RUN carry.
- **`GOBLIN_GUN_PROFILE`** (motion-profile.ts): goblin shamble + the
  soldier's carry table (`low`/`chest`/`aim`), `cruise = PLAYER.walkSpeed`,
  prop = the FPV's own `/assets/lab/shorty-double.glb` scale 1.2. The rig
  work ("new animations mimicking FPV actions") turned out to already exist:
  `carry.ts`'s authored arm rotations + the left hand's FABRIK solve are
  body-agnostic — the goblin's 0.54 m arm reach seats the gun fine.
- **`goblin-gun` registry entry** (character-registry.ts): same goblin.blob +
  goblin-kit, separate NAME because profiles are per-entry — re-arming the
  plain goblin would have re-armed the lab's goblin too.
- **`spawnCharacterView`** extracted from `spawnEnemy` verbatim (compile →
  build → view → tiles → materials → face → enclosure → scene), so enemies
  and the player body wear identical wiring. The player body is deliberately
  **not** in `actors`: nothing traces projectiles against it, it never
  enters the hulls, and the wound panel's `rebuildCast` leaves it alone.
  Cosmetic by design.
- **Wear the character's own palette**: `spawnCharacterView` now applies
  `character.palette` for soldier AND goblin-gun (a goblin in the game's
  pink preset reads as just another spawn); everyone else keeps the `flesh`
  preset.
- **Iso self-key light** (`isoKeyLight`): the held beam is born at the
  goblin's eye and points forward, so his own body is outside the cone — at
  dungeon ambient (0.035) he marched as a silhouette while every enemy
  caught the beam. A small warm SpotLight rides above the goblin on the
  camera side; `drawFn` stamps the player body's ONE march spot slot from it
  (the beam stamp would light nothing there), gain 2.6 vs the beam's 4 —
  the beam's gain blown him out to white on the first iteration. Boot-allocated
  at intensity 0 (adding a light at runtime recompiles the TSL graph).
- **March/polygon integration**: the player view rides `sdfLayer.setBodies`,
  the per-body beam stamp (shared `stampBeam` closure), the bone instancer,
  tile refresh, and `view.setTime`. Viewmodel hidden via
  `viewModelAnchor.visible` (its matrices still update, so `muzzleWorld()`
  keeps reading the GLB locators); the reticle is hidden in iso.
- Seams: `__sdfGame.setIso` / `iso` / `playerBody()` / `playerView()` /
  `enemyView(i)` (the last two are marked DEBUG — they exist because the
  open bug below was hunted through them; keep for the next session).

**3. Tests**: `game-player-body.test.ts` — offline (stub view/character, real
motion pipeline): body lands on commanded feet position (root shift =
commanded displacement), carry is `low` at rest / `aim` through the whole
`FIRE.holdSec` / back to `low`, applied yaw is fed to the march proxy and
turns damped, never snapping. Registry/profile pins all green.

**Verification status**: `tsc --noEmit` clean; full vitest 3720/3720 pass;
`npm run build` passes. Visual runs: iso camera framing, screen-relative
walk, walk/chest/aim carries, ejected shells, reload, room-5 encounter all
behaviourally correct.

## The open bug: the player body's SDF flesh does not march

**Symptom.** In iso the goblin shows his kit, his gun, and his **bone tubes**
(walking, holding the gun — the skeleton reads clearly), but NO marched
flesh. Enemies — zombies, soldiers, and (diagnostically) a `goblin-gun`
spawned as a regular actor — march perfectly in the same frame. The lab
renders the same character fine.

**Eliminated (each verified, not guessed):**
- Field data: `playerView().dataTexture` texels carry real packed prim rows
  at world coords (goblin flesh prims present).
- Proxy box: in scene, layer SDF_LAYER, visible, sane position/scale
  (`fit()` output correct), `frustumCulled` false, bounding sphere sane.
- Uniforms: full A/B dump vs a working enemy — structurally identical;
  palette applied (`baseColor` = the goblin's olive), sane counts
  (42 prims / 6 clusters / 32 bones).
- Bodies list: temp-instrumented `setBodies` input — 16 entries, player
  object included, `visible: true`, every frame.
- Material/pipeline: swapping materials between the marching actor and the
  invisible player changes NOTHING (actor still marches with the player's
  material; player still outputs nothing with the actor's). So it is not a
  compile/pipeline fault and not a uniform-values fault.
- Live-uniform repaint: painting a working enemy's `baseColor` repaints it
  instantly; painting the player's does nothing — the march shader runs on
  the player's box and **discards every fragment**.
- No console errors, no exceptions, no target-crash in any capture.

**Shape of the remaining suspect.** Everything the march consumes has been
swapped or verified except the shader-side per-body state. The thread that
was being pulled when time ran out: **`bodyAnchor`** — the noise-frame
triple `(shiftX, bodyYaw, shiftZ)` written by `setRootShift`
(zombie-gpu.ts:1677 `u.bodyAnchor.value.set(x, bodyYaw, z)`) and consumed by
`noiseLocal(p - drift, gBodyAnchor)` inside the prim-warp
(march.wgsl.ts:715). The player's value is `[0, 2.356, 0]` (shift 0,0 at
spawn + yaw), which *looks* legitimate, but it is the one per-body input
whose semantics were not fully traced — the warp/certify path around
`gBodyAnchor` has an explicit "a divergence there certifies emptiness
against a surface the march does not have" warning in its header. Worth
reading `noiseLocal` + the prim-warp branch first.

**Suggested next steps** (in order):
1. Trace `bodyAnchor`/`noiseLocal`/prim-warp semantics (march.wgsl.ts
   ~:700-720, :1683, :2125) against the player's values.
2. Reproduce with `setBodies` ordering games: render the player's body
   FIRST/ALONE in pass 2 (temp) to rule out per-body `prev`-gate interaction.
3. Try `__sdfGame.playerView().uniforms.bodyAnchor.value.set(-7.4, 0, -7.4)`
   style probes (or zeroing it) live from a CDP driver.
4. Compare a CPU readback of the player's full data texture vs the actor's
   (rows beyond ROW_PRIM_A: primShape/primBend/primClip — a corrupt shape
   row could zero every prim's SDF).
5. One-off seen once: the page context died after fire → auto-reload →
   `teleport(5)` (never reproduced; console clean on the repro attempt).
   Keep an eye on it.

## Known smaller gaps (deliberate, spike-scoped)

- Enclosure uniforms pin to the player's START room — walk to room 5 and
  the goblin's bounce/ambient is room-1's. Cosmetic; needs per-room
  re-stamping on room change if the experiment graduates.
- `bodyAnchor` semantics + the fog reset interplay with
  `__dungeon.setDungeon` while in iso (comment on `applyIso`).
- HUD "bodies N/M" counts actors only, not the player body.
- The gun prop grip uses the shared `GUN_GRIP` offsets measured on
  soldier-shotgun.glb; the shorty's muzzle-flash origin sits slightly ahead
  of the barrel. Tunable via `GOBLIN_GUN_PROFILE.prop.scale`.
- Camera framing constants (`ISO_CAM` fov/pitch/dist) are first-pass and
  were chosen for readability at 1280×800; owner will want to tune.
- Server hygiene note: four vite instances were found running (main
  checkout, two finished dispatch worktrees); per owner request only ONE
  pair was kept (5333/9333, this branch).
