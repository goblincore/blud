# Flame playtest feedback — handoff for the next session (2026-09-18)

The owner played the in-game flare test harness (`sdf-game.html`, slot `3` /
`__sdfGame.igniteAll()`) with the real FIRE01 atlas, after a machine restart
fixed an unrelated GPU-watchdog boot failure. Overall: the burning read works and
is the right direction. Four pieces of feedback to address in a **new session**.

Each item has the owner's words, then what this session found in the code, then
suggested leads. Leads are starting points, not decisions.

---

## 1. Flames feel disjointed — you can see the repeated tiles

> "The flames still feel a little disjointed, like I can see the repeated tiles,
> they don't feel fluidly blended."

**What it is:** the flame cards (`src/lab/sdf-zombie/webgpu/flame-cards.ts`) are
~16 camera-facing quads per body, each playing the SAME 8-frame Blood FIRE01
flipbook. The frames are tiny (31×25 px each; `npm run flame:atlas` →
`public/assets/flame-placeholder/fire01.png`), scaled up a lot, and every card
shows one of only 8 images. Each card is independent, so there is nothing that
makes neighbouring cards read as one flame. The curl-volume flow (polish task 2)
moves cards together but does not blend their images.

**Leads:**
- More image variety per card: random horizontal flip, UV rotation/offset, and
  a per-card start frame are cheap; Blood has more flame tiles than FIRE01 (see
  `docs/dev-notes/2026-04-25-notblood-flare-burn-mechanic.md` and the tile table
  in the original research) and an original baked flipbook is the shippable path
  anyway.
- Distort each card's UV lookup by the shared curl field
  (`curl-volume-node.ts` → `curlVector`) so the licks warp continuously instead of
  playing a fixed 8-frame loop.
- Bigger, fewer, more overlapping cards with softer edges, so the body reads as
  one mass rather than a set of tiles.
- Or, stop fighting cards: see item 2.

## 2. The wildfire reference feels more dynamic and fluid — and needs smoke

> "In the reference (wildfire game) the flames were more dynamic and fluid
> looking, so not sure what we are missing. I also think adding some of the smoke
> effects would be good."

**What we are missing:** the architecture. Per
`docs/dev-notes/2026-09-18-wildfire-fire-teardown.md`, wildfire's fire is a
**continuous field** — a capsule-defined fire field, animated by a 64³ curl
volume, rendered by a **low-res volumetric march with temporal reprojection**.
We adopted two of its four ideas (curl volume, soft fade) but kept sprite cards
as the renderer. Cards are discrete by nature, so they cannot look as fluid as a
marched field no matter how well they are tuned. The volumetric option was
skipped earlier when it was priced as full-resolution marching inside the SDF
march; the teardown showed that at 0.25–0.5 resolution in its own pass with
reprojection it is a different cost class.

**Leads:**
- The biggest lever: a low-res volumetric fire pass whose field is the burning
  body's own capsules (our characters are already capsule prims), animated by the
  existing curl volume, reprojected temporally. Cards could stay as a crisp
  foreground layer, or be retired.
- **Smoke:** wildfire's field carries a `soot` channel alongside `temperature`.
  Cheapest version: normal-blended (not additive) smoke cards or a smoke term in
  the volumetric pass, rising and darkening above burning bodies, driven by the
  same curl volume. `explosion-vfx.ts` already has a smoke layer to borrow from.

## 3. The flames do not light up the room

> "Also lighting, the flames are not lighting up the room."

**Found the cause.** In the game, the burning body's fire light is only pushed
into `directFlashes` (`game-main.ts` ~2205), which feeds each SDF body's own
`bodyFlash` uniform — it lights **bodies only**, never walls, floor or props. The
flame LAB lights the floor because it uses a real `THREE.PointLight` per burning
body (`flame-lab-main.ts` ~713). The in-game harness never added one.

**Leads:**
- Add pooled, **always-visible** point lights for burning bodies (intensity 0
  when idle — never toggle `.visible`, which recompiles every lit material,
  measured 180–230 ms stalls; copy the `explosionLightPool` pattern in
  `game-main.ts`). Pool size is bounded by the dynamic-light budget (the game
  caps at 8 room lights) — nearest/brightest burners win.
- Feed burning bodies into the probe gather's dynamic light list as well (the
  "tracer light slots" seam), so the fire contributes bounce light, not only
  direct.
- Keep the existing `directFlashes` push — it is what lights the body itself.

## 4. No visible skeleton; nearby NON-burning zombies look molten and it moves

> "Don't really see skeleton. The molten kinda burnt skin kinda works, but on
> zombies who are not on fire but close by it looks a little weird since it's
> moving for some reason."

**Skeleton:** expected given the last fix. The bone-fix pass made revealed bone
dark and scorched so charred bodies stay black — that removed the pale-limb
problem but also most of the skeleton read. The skeleton look needs its own pass:
shading bone as bone (shape via normal/gloss) visibly, without re-paling limbs.

**The burn look on bodies that are NOT burning is likely a bug, not a style
issue** — "moving" means animated fire noise, and the noise only animates while
a body has burn. Suspected route (verify, not confirmed): crowd bodies share one
material per type, and the shader combines
`max(burnCfg.x, gInstBurn.x)` / `max(burnCfg.z, gInstBurn.z)` (`march.wgsl.ts`
~3943). `burnCfg` is a per-VIEW uniform; per-instance burn rides the crowd record
(`REC_BURN`). If a burning actor's per-view `burnCfg` (written by
`writeBurnUniforms`, `game-main.ts` ~902) is what the shared crowd draw binds —
or if the crowd type's uniforms are synced from a template view that includes
`burnCfg` (`zombie-gpu.ts` ~2857 copies template uniforms) — then every body in
that crowd draw gets the burning body's fire. The rupture-gore ramp hit exactly
this problem and solved it by making the per-instance record authoritative in
crowd draws (see `REC_GORE` comments in `crowd-records.ts`).

**Verify first:** ignite ONE zombie in a crowd with `__sdfGame.burning()` to
confirm only it is burning, then check whether other zombies of the same type
render fire. If they do, the fix is to keep `burnCfg` at 0 on anything a crowd
draw binds and let `REC_BURN` carry burn for crowd instances.

## 5. Burning enemies should move differently — faster, stumbling

> "I think we need to add some burning animations, like the zombie should maybe
> move a little faster or stumble around."

**What exists:** nothing yet — the in-game harness deliberately left AI and
motion alone (a burning enemy keeps doing whatever it was doing). This is the
"burning behaviour" half that was always scoped to the real flare-gun pass, and
it has precedent:
- **NotBlood:** a cultist that would die from burn damage turns into
  `kDudeBurningCultist` and runs around; burning zombies play the burning-run
  sequence (SEQ 4355). See `docs/dev-notes/2026-04-25-notblood-flare-burn-mechanic.md`.
- **Retired Blud game:** `src/game/enemy/cultist-ai.ts` (panic sprint ×1.4, no
  shooting) and `src/game/enemy/ai.ts` (zombie burn speed ×0.8, can't be
  staggered while burning); tuning in `src/game/gibs/tuning.ts` `BURN`.

**Leads (SDF game):**
- The cheapest hook is the `doomed` override in `game-actor.ts` (~902–914 when
  last read): replace the mind's output with a panic target while burning, rather
  than adding states to both `brain.ts` and `soldier-brain.ts`.
- Motion: `motion.ts` `stepMotion` / `MotionSignals` and `gait.ts` already have
  SHAMBLE/MARCH/RUN; a burning body could switch to RUN with an erratic heading
  (curl-noise or seeded wander target), plus a flail term on the arms. `stagger.ts`
  already maps `burn → 'shudder'`.
- Stumbling: periodic short stagger/lurch impulses while burning, and
  `forcedCollapse` when burn damage (not yet implemented) kills.

## 6. Flames should react to the body's movement

> "When the zombies/enemies walk or move, the flames should move in a more
> dynamic way."

**What exists:** cards are anchored to posed prims, so they follow the body
rigidly; the curl flow adds swirl but ignores the body's velocity. Nothing makes
flame trail behind a running body or whip when it turns.

**Leads:**
- **Velocity lag:** give each card (or the whole flame set) a spring-damped offset
  that lags the anchor, so flame streams backward when the body moves and settles
  upright when it stops. Blood's `fxFlameLick` spawns licks that *inherit the
  body's velocity plus an upward rise* — the lag is what reads as motion.
- `TongueTuning` already has a `lean` field ("how much the tongues lean with body
  motion") that nothing in the cards path uses yet — wire it.
- Stretch cards along the trailing direction with speed, and bias the curl field
  sample by velocity so fast movement tears the flame more.
- If the volumetric route (item 2) is taken, advect the field by body velocity
  instead — that gives this for free and more convincingly.

---

## Current state (so the next session can start cold)

- **Branch:** `claude/flare-gun-burning-effects-101cad`, worktree
  `.claude/worktrees/flare-gun-burning-effects-101cad`. Everything is committed.
- **Run:** `npx vite --port 5174 --strictPort`, open `/sdf-game.html`. Needs two
  **untracked** placeholders in the worktree: the FIRE01 atlas
  (`npm run flame:atlas`) and `public/assets/lab/flaregun-placeholder.glb`
  (copy of `docs/dev-notes/refs/flaregun/flare_gun.glb` from the primary
  checkout). `__sdfGame.flameCards().atlas === true` confirms the real atlas —
  without it the cards fall back to a procedural shader with hard rectangles.
- **Flame lab:** `sdf-flame-lab.html` (tuning panel, technique switch, captures via
  `npm run flame:capture -- --technique cards`).
- **Also ready, not yet on:** the explosion curl look — verified seam-free by an
  edge-map gate (`npm run explosion:seam`). Flip in `EXPLOSION_VFX_TUNING`:
  `curlStrength 1.1, curlScale 18, softFade 0.4`.
- **Blood:** DENSITY + per-stream goo live in the blood lab only; crossing sprays
  still read as one mass. Next: rope-not-fan emission, then a capsule field.
- **Known infra:** the SDF game's warm-up compiles all pipelines in one burst, so
  a slow/overloaded machine trips Chrome's GPU watchdog ("valid external Instance
  reference no longer exists" → device lost). A restart fixed today's case;
  spreading the warm-up would make it degrade gracefully.
- **Dispatch lessons:** `deepseek-flash` on the `dsh` harness was far more
  reliable here than `glm-5.3-flash` on `pi`; chained tasks need
  `base_branch` = previous task's branch; tell agents to run targeted tests only
  and to prove visual claims with measurements, not eyeballs.
