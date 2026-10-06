# The axe and the head split: design (2026-10-04)

**Status:** approved in brainstorming with the owner (2026-10-04).

**Builds on:** [cut wounds](2026-10-03-cut-wounds-design.md). That spec's M1 is built: the cut wound, the rod, and 32 wounds that merge. This spec takes over its M2 (the head split, §6) and folds it into the axe.

## 1. Why

The owner playtested the rod (cut wounds M1) and liked the cutting. They want real blade weapons that use it. The axe comes first because it is the simplest; the chainsaw is the ideal but is more work and comes later.

A chop to the head should split the head open on a hinge, with a split-but-alive state. The owner asked for that during the slug-burst work, and craters could not deliver it.

## 2. Decisions (owner, 2026-10-04)

**Controls and feel:**
- **Swing control:** fixed chops. Click to swing, as with the flail: a short authored combo (overhead, then the two diagonals) that alternates while you keep clicking. The cut line is the blade's path at the strike frame.
- **View model:** a primitive axe built in code (haft plus wedge head) on the goblin arm. A real model comes later.

**Head chops:**
- **Rhythm:** the first chop splits the head and the zombie stays alive; later chops widen the split; the Nth chop kills.
- **Toughness:** `chopsToKill` is a tuning value, with a debug default of 3. The owner asked for it "a bit more tough for debug".

**Body chops:** cut wounds only. There is no limb severing in this spec.

**What opens the split:**
- **Trigger:** the axe only. The slug's rupture is unchanged; hooking the slug up to the split is a follow-up.
- **Mechanism:** a real domain warp in the shader (cut-wounds spec §6), not a fake made of a wide cut plus splay, and not two separate half-head bodies.
- **Presets:**
  - **Down-the-middle:** its offset follows the impact point. Off-centre, only the smaller side opens, hinged low by the jaw. That is the owner's reference: a cheek and temple slab peeling outward.
  - **Face-from-back:** kept, but rare.
  - **Crown:** dropped.

**Order:** part A (the axe, playable on its own) first, then part B (the warp).

## 3. Part A: the axe

**The slot.**
- The axe is weapon slot 7 (`Digit7`). It is always owned in the dev harnesses, like the rod and the flare.
- The rod stays on slot 6 as a dev tool, because the cut-wound gate drives it.
- The HUD reads `7 AXE (click to chop)`.

**`axe-swing.ts` (pure).** It follows `flail-swing.ts`:
- Authored view-space keyframes per chop. The chops are **H** (overhead), **R** (right to left, diagonal) and **L** (left to right, diagonal), using the flail's side names.
- A combo that alternates while the button is pressed again before recovery ends.
- Per-chop timing (wind-up, strike, recovery), heavier than the flail.
- Each chop's **blade line**, a view-space segment that is the edge's path through the strike frame.

**`axe-strike.ts` (pure).** It reuses `flail-strike.ts`:
- `resolveStrike` with an axe arc and reach decides who is hit and where. The impact point comes from an eye ray placed on real skin.
- For each hit, the chop's blade line is mapped to world space and centred on the impact point, giving a `CutSeg` with the view direction from the eye.
- Calibre `AXE_CALIBRE = { depth: 0.10, kerf: 0.022, lip: 1.1 }`, all tunable. The lip stays within the clamp of 1.1 in `cut-wound.ts`.

**What a body chop does:**
- One `stampCut` per hit actor.
- `a.blast` with a flail-like meter credit (`AXE_HIT[side].meterCredit`) and a stagger or flinch.
- A heavier bleed than the rod's.

**`game-axe.ts` (renderer side).** It follows `game-flail.ts`:
- The primitive axe on the goblin arm, on the aim rig, posed from the swing.
- Strike edges consumed by the tick.
- The rod's armed gate: live slot, `slotReady`, `!loopBlocksInput`.
- Blur and pointer-lock loss cancel a queued chop.
- Not a recorded demo verb, like the flail and the flare.

**Seams (`game-seams-*.ts`):**
- `axe()`: debug state (swing, side, last hits).
- `axeSwing(side?)`: starts a chop as a click would, for headless gates.
- `axeChop(id, side)`: strikes one actor directly.

## 4. Head chops and the kill

**Detecting a head hit.** A chop is a head chop only when it lands on head flesh: the prim nearest the hit is a head-limb prim (`axe-head.ts` `chopOnHead`; on an open head, the un-warped hit). See §10.2. *(Corrected 2026-10-05. Part A asked the flail's `isHeadRegion`, which also takes anything within 0.2 m of the neck root; with the split, a chop on the upper chest then opened the head.)*

**`axe-head.ts` (pure, per actor):**
- **Fields:** `chops` (count). The split state from §5 lives in the split's own leaf (§10.3).
- **`AXE_HEAD.chopsToKill`:** debug default 3.
- **`AXE_HEAD.openAngles`:** the opening per chop before the kill, as fractions of the preset's maximum angle. As built `[0.8, 1]`, and the kill chop kicks a split that is already full (`killKick` 0.3); see §10.2. *(The design default was `[0.55, 0.8]`, the kill then opening to 1.0.)*

**Part A behaviour (before the warp exists):**
- Each head chop stamps a deep, head-tagged cut along the blade line.
- On chop `chopsToKill` the actor dies through the normal death path.
- Head chops do not feed the body meter.

**Part B behaviour:**

| Chop | What happens |
| --- | --- |
| 1 | Pick the preset (§5), open it to `openAngles[0]` with the spring, and stamp the cut faces |
| 2 to N − 1 | Kick the spring to the next angle and stamp a cut. Keep the preset |
| N | Kick to the preset's maximum angle and die |

*As built the axe's table sits one stage further on: chop 2 already reaches the maximum angle, and chop 3 kills and kicks past it (§10.2).*

The split stays open on the corpse.

**Isolation from the slug burst.** `BURST_TUNING_DEFAULTS.anyWeapon` is `true` (the owner's debug setting), and routes any weapon's head hit into the slug burst. The axe bypasses that routing, so an axe chop never triggers the burst.

**Other characters.** Characters without split presets get the part A behaviour (cuts plus the counter) in part B as well.

## 5. Part B: the head split

> **Superseded in part by §10 (as built, 2026-10-05). Do not implement from this section.** What stands: the presets, the preset choice, the spring's shape, and the cut faces' `headSlot: 'keep'`. What was replaced: the warp (no bisector pick, no step clamp, no cull switched off: §10.1), the record (21 vec4s, not 19: §10.4), where the un-warp happens on the CPU (§10.3), the skull mesh (§10.5) and the step list (plan B's tasks B1 to B9).

**Presets (`head-split.ts`, pure, zombie only).** Each preset holds:
- a head-local plane: normal and offset;
- a hinge: a point and an axis;
- a maximum angle;
- the side that moves: one side, or both, mirrored.

There are two presets:
- **`middle` (sagittal):**
  - The plane's offset comes from the impact point, measured along the plane normal from the head centre and clamped to about ±40% of the head radius.
  - At an offset near 0, both halves open.
  - Otherwise only the smaller side opens, hinged low by the jaw on that side.
- **`face`:** the face half folds forward, hinged at the back of the skull.

**Choosing the preset:**
- The preset whose plane best matches the chop's blade plane wins.
- `face` (a coronal plane) needs a blade plane across the head from side to side. A chop's blade plane contains the view direction, so a chop from in front always reads as `middle`. `face` fires for a chop from the zombie's side, e.g. an overhead chop on a zombie turned 90°, which makes it rare in play.
- A debug seam can force either preset for tuning.

**The spring.** It reuses `head-deform.ts`'s burst spring shape (kick, overshoot, settle): the angle springs to its target. It is deterministic.

**GPU data.** Two new vec4s in the per-instance record (`crowd-records.ts`, `REC_VEC4S` 17 → 19): the plane, and the hinge with its angle. They are zero when no split is open.

**The warp (WGSL, `webgpu/march/map-body.wgsl.ts`).** It runs right after `loadInstance` and the alive check, only for an actor whose split is open, and only inside the head's bounding sphere:
- Choose the half by the side of the wedge bisector the point is on.
- Rotate the point back about the hinge by that half's angle, giving `pw`.
- Evaluate the rest of the slot body (fold, carves, wounds, bones) at `pw`.
- Set `d = max(d, plane distance at pw)`, so each half ends flat at the plane.
- Outside the region above the hinge, the warp is the identity.

The march step is clamped at the bisector (`min(d, distance to the bisector)`), and the upper-bound cull (`gCullRef`) is off for a split actor.

**After the hit** (`webgpu/march/body/trace.wgsl.ts` and the post blocks):
- The face sheet, wound masks, tissue and `restPoint` take `pw` and the inverse-rotated normal.
- Lighting keeps the world point and normal.

**Also follows the warp:**
- **CPU mirror:** `sdBody` and `worldHitToWound` apply the same inverse warp, so later chops, cuts and shots land on the opened halves. They are stamped in the unwarped head, where the GPU reads them.
- **Screen tiles and proxy boxes:** inflated for a split head.
- **The skull mesh** (`skeleton=mesh`, `skeleton-spike/mesh-renderer.ts`, `mesh-skull.ts`): a per-side rotation in the vertex shader and a plane clip in the fragment shader.

**Cut faces.** Opening a split stamps one cut per opened half along the plane. These cuts must survive eviction while the head is open. `headRegion` alone does NOT protect them: it only buys replace-in-place and no merging (`damage.ts` `pushWound`). So the cut faces set `headSlot: 'keep'`, which puts them under the `MAX_HEAD_WOUNDS` head cap and keeps them through the total cap. This answers the eviction question in cut-wounds spec §10.5. *(Corrected 2026-10-04 after the part A final review; the earlier text claimed head-tagging alone protected them.)* Part B must check how many `'keep'` slots head-damage already uses, so the split's two faces don't evict its brain or region craters.

**Steps.** *Superseded.* It was built as plan B's nine tasks ([plan](../plans/2026-10-04-head-split-part-b.md)), each with its own shader checks (§6): B1 the pure module, B2 the CPU mirror, B3 the leaf and the axe, B4 the GPU record and the field in `mapBody`, B5 bounds, B6 shading after the hit, B7 the skull mesh, B8 the gate and the look, B9 docs. There is no step clamp (§10.1).

## 6. Testing

**Pure (vitest):**
- **Axe and head state:**
  - The swing: timing, the combo, and each chop's blade line.
  - The strike's cut segments.
  - The head counter: split, then widen, then a kill at N, with no routing into the slug burst.
- **Presets and spring:**
  - Preset choice: the offset follows the impact point, and the side that moves follows the offset.
  - The spring: kick, overshoot, settle.
- **The warp:**
  - The warp and its inverse round-trip.
  - The CPU `sdBody` of a split head stays sound. Apply the Lipschitz and far-skin style tests from `cut-wound.test.ts` to it.

**Shader.** Every WGSL step runs:
- `node scripts/compile-census.mjs`;
- `node scripts/march-hash.mjs`, re-pinned only with a stated reason;
- `npx vitest run march-golden -u`;
- an interleaved cold-boot `drawOnce` pair, using a unique hash13 nonce per boot.

**Capture gate (`scripts/axe-gate.mjs`, headless WebGPU, seams in place of pointer lock):**

| Scenario | What it checks |
| --- | --- |
| A | An overhead body chop leaves a vertical gash (a luma dip between lit lips) |
| D | A diagonal chop leaves a diagonal gash |
| S | A centred head chop opens the split. The gap between the face halves is measured in pixels and grows, overshoots and settles |
| O | An off-centre chop opens one side only |
| K | The Nth chop kills, and the head stays open |
| L | A later rod cut or slug shot lands on an opened half |
| T | All of the above on a turned zombie |
| C | Frame cost with and without a split, and zero console errors |

*As built: `scripts/axe-gate.mjs` keeps A, D, K, S (the real swing), C and T for the axe. The split's scenarios are in their own gate, `scripts/head-split-gate.mjs` (§10.8).*

**Owner playtest.** Real clicks through pointer lock.

## 7. Out of scope

- The chainsaw. The sword.
- Limb severing by cuts.
- The slug opening the split.
- The crown preset.
- Further offset or angle variations beyond the impact offset of `middle`.
- Split presets for characters other than the zombie.
- A modelled axe.
- Torn flesh sheets.
- The Rust/wgpu port: the WGSL is written to port.

## 8. Open questions for the plan

1. Whether the swing reuses `flail-swing.ts`'s stepper directly with axe keyframes, or gets a copy. Prefer shared code if the flail's chain-specific parts separate cleanly.
2. How two point and normal pairs pass through the post-hit blocks without breaking the compile census. This is cut-wounds spec §10.2.
3. How the skull mesh gets its per-side transform: new uniforms on the existing material, or a second instance with a complementary clip. This is cut-wounds spec §10.3.
4. Whether `REC_VEC4S` 17 → 19 costs anything measurable for crowds with no split. Measure it in B2.
5. The death path for an axe kill: which existing kill entry it uses, so the corpse keeps its split state.

## 9. As built (part A, 2026-10-04)

- **Reach.** `resolveStrike` takes no reach parameter, so the axe uses the flail's `FLAIL_STRIKE.reach` (1.8 m, horizontal, eye to torso centre). Accepted for part A.
- **Kerf.** `AXE_CALIBRE` is `{ depth: 0.1, kerf: 0.015, lip: 1.1 }`, not §3's kerf 0.022. At 0.022 the measured Lipschitz bound in `cut-wound.test.ts` was 2.63 against its 2.2 limit, and a slash across a thin arm opened the arm's back (0.02 and 0.018 failed too). A wider axe gash needs the carve's shape changed, not a bigger number.
- **Lighting.** The axe and its goblin hand light from their own list: the flail's, extracted to `webgpu/viewmodel-lights.ts`. The torch is swapped for a 0.018 fill. Without it the torch clipped the haft white (92% at rest, forward mode).
- **The kill** (open question 5, part A only). The `chopsToKill`-th head chop calls `ZombieActor.blast` with `forceCollapse: true`. The actor's next `step()` consumes it into the normal collapse path (`standing` → `falling`).
  - Verified by the gate's K: its zombies are frozen, so each chop thaws them for 3 frames and reads the phase. Chops 1 and 2 stay `standing`, chop 3 goes `standing` → `falling`, and 45 thawed frames later the corpse still has its 3 head cuts. Without the thaw the check would be vacuous, because `forceCollapseNext` is consumed only in `step()`.
- **Seams.** `__sdfGame.axe()` returns debug state, plus `last.points` (each hit's world point) and `rig` (the drawn axe's world grip, haft top, head and hand, and `visible`). `axeSwing()` sets the click for the next tick, as a mousedown would (pointer lock is not available headless). `axeChop(id, side, target?)` chops actor `id` directly, aimed at its torso or head centre. `actorWounds` now returns each cut's world direction `dirWorld` and its `headRegion`.
- **Gate:** `scripts/axe-gate.mjs` runs A, D, K, S, C and T (24 checks). Notes and photos are in `docs/dev-notes/2026-10-04-axe/`.
- **Pose and look suggestions, left for the owner (none applied).** Details in the notes' "Look ideas for the owner".
  - At H's and R's strike the haft points back along the forearm, so the fist's grip tunnel faces the camera empty and H reads as a fist holding a stick. The fix is a pose redesign (fist higher, haft angled down onto the target, or a wrist roll), not a constant. A small z-roll on H's strike key would turn the head's side to the camera. R's strike, with the head in profile, reads best.
  - No fist at rest: the grip is below the frame, so the haft floats in from the bottom edge. Moving `AXE_REST.grip` up and in would show the hand.
  - L's wind-up crosses the fist and bracer over the top centre of the frame for several frames, covering the target's head. Its wind key could sit farther out or lower.
  - Three chops at one aim point make a star with a crater. A small along-blade offset per chop would avoid it.
  - The head is a plain box and reads a little like a cleaver. A tapered or bearded profile would help; a modelled axe is already planned.
  - Cuts on a dark face (K-1) are hard to see in this light. Part B's split will change this.
- **Cost.** Three chops on one torso add about +4.3 ms (ungated; `timeDraws(120)` at 0.9 m, against the second baseline read: the first read is ~5 ms lower in every run, cause not investigated, which would make it +9.9 ms), against +1 to +5 ms for three rod cuts.

## 10. As built (part B, 2026-10-05)

Built on `claude/head-cleaving-effect-ef9515`; draft PR goblincore/blud#31 tracks `claude/head-explosion-effect-d6231e`. Every measurement behind this section is in the [notes](../../dev-notes/2026-10-04-head-split/NOTES.md). How to run, verify and tune it is in the [handoff](../../dev-notes/2026-10-04-head-split/HANDOFF.md). Where this section and §5 differ, this section is what the code does.

### 10.1 The field: a union of three rigid pieces

§5 picked a half by the wedge's bisector. The field then jumps at the bisector, and patching that needed a step clamp and the upper-bound cull switched off, across seven or more walkers of the field (plan B, "Design decision"). That was not built.

- **What was built** (`src/lab/sdf-zombie/head-split.ts` `splitField`; the file's header is the reference). The closed head's field `f` is read through the `min` of three rigid, capped pieces. With `s` the distance from the cut plane, `up` the height above the hinge plane, `dh = |p − h|` the distance from the hinge point, and `q±` the point turned back about the hinge by that half's angle:
  - `P0 = max(f(p), min(up(p), rho − dh))`: the rest of the body, which does not move;
  - `P± = max(f(q±), ∓s(q±), −up(q±), dh − rho)`: the + half and the − half, each turned open and capped to its own piece;
  - `C = REGION_MARGIN + |dh − r|`: the region shell;
  - inside the region sphere (`dh ≤ r`) the field is `min(P0, P+, P−, C)`; outside it is `min(P0, C)`.
- **What that bought.** Each piece is a rigid motion of `f` cut by half-spaces and a ball, so each is a sound 1-Lipschitz distance bound, and so is their `min`. The field is continuous and 1-Lipschitz everywhere. There is no step clamp and no cull exception in any walker.
- **The hold ball `rho`.** Only material above the hinge plane AND within `rho` of the hinge point `h` moves. `rho = |head centre − h| + 1.25 × HeadFrame.radius` (`holdFrac`); the radius is the skull's largest semi-axis, 0.137 m on the zombie. The neck stays put. A hand raised inside the ball would turn with the head: accepted for now.
- **The region shell `C`.** The region sphere's radius is `r = rho + REGION_MARGIN`. `C` caps the field in open air near that sphere so the two branches meet there. Without it (the plan's first draft) the field jumped by up to about 0.2 m at the sphere. `C` is never under `REGION_MARGIN`, so it is never a surface.
- **`REGION_MARGIN` is 0.06 m** because the shipped AO probe reads `mapBody(p + n·0.06)`. At 0.03 the shell darkened 14–20% of surface samples by up to 0.48; at 0.06, none.
- **Evaluations.** A side that does not move shares `f(p)` with `P0`, so a one-sided split is two evaluations of `f` inside the region. Measured mean: 1.3 to 1.7 evaluations per in-region sample.

### 10.2 Behaviour

- **Only a chop on head flesh is a head chop** (`webgpu/axe-head.ts` `chopOnHead`: the prim nearest the un-warped hit is a head-limb prim). This replaces §4's first wording. With the flail's `isHeadRegion`, a chop on the upper chest within 0.2 m of the neck root opened the head, and `scripts/axe-gate.mjs` failed 7 of 25. On the posed zombie every head-prim hit lies within 0.168 m of the skull centre, down to 4.7 cm above the neck root.
  - **A behaviour change for every character:** chops on the upper chest, the collar and the neck's base are body chops. Each stamps its own cut and credits the collapse meter (0.12 overhead, 0.09 diagonal: about 7 overheads or 9 diagonals to kill). They no longer count toward the three-chop kill.
- **The axe's table** (`AXE_HEAD`: `chopsToKill` 3, `openAngles` `[0.8, 1]`, `killKick` 0.3). The angles below are per half, for `middle` with both sides open:

  | Chop | Flesh | Bone (§10.5) | The zombie |
  | --- | --- | --- | --- |
  | 1 | 0.8 of the preset's maximum: 25.2° | 7.6°: a wide crack | lives |
  | 2 | 1.0: 31.5° | 26.8°: split wide | lives |
  | 3 | already full, so the chop kicks it 0.3 of the maximum past where it stands (`head-split.ts` `punchSplit`) and the spring brings it back | swings in proportion | dies |

  The design's table was `[0.55, 0.8]` with no kick; `openAngles: [0.55, 0.8]` and `killKick: 0` restore it. A chop on the corpse's open head kicks it again. The owner's call: §10.11.
- **Which preset.** As §5. `middle` unless the blade plane lies across the head (`face`, rare; 0.8 rad). For `middle` the plane's offset follows the impact, up to 0.4 of the head's half-width. Within 0.15 of the half-width both halves open (0.55 rad each); beyond it one side opens (0.9 rad), hinged low by the jaw.
- **Zombies only.** Other characters keep part A (cuts and the count). So does a zombie whose head is gone or whose body is tearing apart.
- **The split stays open on the corpse.** The state is kept until the actor leaves the world.
- **Head damage and the split are mutually exclusive.** A head the head-damage leaf already holds refuses to split and keeps part A; it still dies on chop 3. On a split head the slug burst and the flail's head ladder are skipped: a slug leaves a plain head wound, and a flail hit leaves a plain crater that credits the head's share of the meter (0.0195, not 0.065).
- **Later chops on an open head always count.** A chop stamps its own cut only where it lands on outer skin (`headChopCut`: the closed head's field within `skinEps`, 0.015 m, of zero). On a cut face or through the gap it stamps nothing, and the faces bleed again.
- **Cut faces.** Opening stamps one cut per opened half along the plane (`splitFaceSegs`; `faceCalibre` depth 0.12, kerf 0.012, lip 1), tagged `headSlot: 'keep'` and `headRegion` `split+` / `split-`. They use at most 2 of the 8 `MAX_HEAD_WOUNDS` slots. The other users of those slots are head damage's craters, which a split head never has. That settles §5's budget check.
- **The spring** is `head-deform.ts`'s burst shape at 7 Hz with damping ratio 0.35: an opening overshoots its rest angle by about 30% and settles.

### 10.3 The CPU mirror

- **`sdBody` honours `body.split`** (`validate.ts`: `splitField` over `sdBodyClosed`), so every strike, shot and trace sees the opened halves. With no split it is unchanged to the bit. Inside the region it costs about 2.7× the closed field.
- **Hits are un-warped before they are stamped** (`damage.ts` `unwarpHit`, `cut-wound.ts` `unwarpCutSeg`): pellet, slug, axe, rod, the flail's body crater, explosions and the `stampWoundAt` seam. Wounds live on the closed head, where the GPU reads them. §5 put the inverse warp inside `worldHitToWound`; as built it is its own step before it.
- **The pose is the only source of the split.** The leaf `webgpu/game-head-split.ts` owns each actor's `SplitState`, steps its spring once a frame before the actors step, and installs the actor's split hook. The hook's answer rides `posed().split`. `sdBody` and the renderer both read it there, and nothing else keeps a copy. The leaf re-poses a frozen actor itself.
- Head blood emitters follow the opened halves (`warpPoint`, `warpDir`).

### 10.4 The GPU

- **The record** (`webgpu/crowd-records.ts`). `REC_VEC4S` is 21, not §5's 19. Four lanes: N 17 = (n, thetaP), H 18 = (h, d0), A 19 = (a, thetaM), R 20 = (r, 0, 0, 0). A closed head is four zero vec4s. The open test is "n is a unit vector", made once in `loadInstance` into `gInstSplitOpen`, so a closed body pays one extra record read.
- **THE PIECE LOOP** (`webgpu/march/map-body.wgsl.ts`). Up to three pieces, each a `vec3 (cap, theta, id)`, sorted by unrolled compare-swaps into ascending cap order. The whole slot body (fold, wounds, bones) is evaluated at each piece's un-warped point. A piece whose cap is already no better than the running best is skipped, which is exact. `gHitPiece` and `gHitSplitF` (the winning piece's field before its caps) come out with the hit.
  - **Its hand twin** is `webgpu/march/map-body-split-twin.test.ts`: the same logic in TypeScript, compared with `splitField` (largest difference 3.5e-16). Nothing in the repo runs WGSL on the CPU, so the two are edited together.
- **Bounds.** One pure rule set in `head-split.ts` (`splitFrame`, `splitHolds`, `splitHoldBall`, `splitBound`, `splitSphereImages`) feeds every bound: the proxy box, the cluster row, the screen tiles, the outer hull (turned copies of the chain spheres) and the occluder hull (inner spheres that could hold turning flesh are dropped). The radius is `rho`, not `r`: between the two there is only the shell, which is not a surface. The per-ray wound list is off for an open slot. On the worst view (one side, 0.6 m) clipped texels went from 215 to 13; the closed head's own floor is 0 to 23.
- **Past 12.7 m a split is drawn closed** (eye to hinge, at the game's defaults; `splitDrawDistance`, `SHELL_ACCEPT_FRAC` 0.8). The march accepts a sample within the pixel's footprint, and the last-step secant makes that reach four footprints. Past 16.2 m that reach passes `REGION_MARGIN`, and the region shell could then be drawn as a ball round the head; the rule stops at 0.8 of the margin. **Hysteresis:** it opens again only inside 0.9 of the distance, 11.4 m (`SPLIT_REOPEN_FRAC`). The pose keeps the split throughout. `view.splitDrawn` is what the record really carries. No false shell hit was seen at any distance; the cut-off comes from the accept law, not from a sighting.
- **Shading after the hit** (`webgpu/march/body/blocks/post/split-hit.wgsl.ts`). One block derives the hit's split state once: `splitTheta`, `pS` (the un-warped point), `splitQ`, `faceCentre` / `faceQuat`, `splitIn`, `cutFace`, `cutDepth`. Everything anchored to the body reads `pS`: the rest anchor, the wound and char masks, the face sheet and eye glow, the burn's bone taps, wetness, motion. Lighting, the normal's taps and the probes stay at the world point. A closed slot, and piece 0, never run a rotation, so closed bodies are bit-identical (the six `march-hash` pins did not move in any task).
- **Normals.** Inside an open head's region sphere the analytic gradient is skipped and the existing finite-difference fallback runs (`ngReason` 8, in analytic mode only). The piece caps are not in the analytic gradient.
- **The cut-face block** (`blocks/post/cut-face.wgsl.ts`; numbers in `SPLIT_SHADE`). The gate is `cutFace = smoothstep(0.0015, 0.004, hitField.x − hitSplitF)`: how far a piece's cap holds the split field above the piece's own field. It is exactly 0 on skin and on every closed body. A cut face shades as the existing wound interior: the tissue ramp read at `cutDepth` (skin at the rim, fat, red, clot), wet at every depth, no pores, no face sheet. `cutKeep` (0 today) is the share of a cut-face texel that is not flesh, for a later bone ring.

### 10.5 The skull mesh

- **Per-piece copies.** A split head's skull is drawn once per piece that owns part of it: the rest at its closed matrix, a half turned about the hinge by its bone angle (`webgpu/skeleton-spike/mesh-renderer.ts`). The copies have their own batches and materials. A closed head draws exactly as before.
- **Clipped along a shared fracture edge** (`skeleton-spike/mesh-split.ts`). Each fragment is taken back to its un-turned point `q` and kept only if the copy's piece owns `q`. The edge is not the plane but `s(q) + jag(q) ≥ 0`. The offset is a function of `q` alone, so both halves read the same number and their edges fit like one bone that broke. One `jag` table feeds the WGSL and its TypeScript twin. The copies are two-sided, with a dark inner wall and a 4 mm cut-bone rim. The fracture's seed is the actor id.
- **The follow table** (`HEAD_SPLIT.skull.follow`): (0.55 → 0.1), (0.8 → 0.3), (1 → 0.85). The bone opens LESS than its flesh, so it stays in the gap: a thin crack, a wide crack, then split. The axe uses the second and third stages (§10.2); the first is a lighter weapon's.
- **Staged by a monotone `stage`** (`SplitState.stage`, `SplitWarp.stage`): the furthest the spring has opened, no further than its target. It only advances. The bone is the stage's share of each half's own flesh angle, so a kick or a wobble swings it in proportion and never steps it.
- **Driven from `view.splitDrawn`**, so the skull closes with the flesh at the range cut-off. Only the `'head'` segment splits; the top neck vertebra stays whole on purpose.

### 10.6 Secondary motion: the wobble

- **What it is** (`HEAD_SPLIT.wobble`; pure, in `head-split.ts`). Each turning half carries an offset on top of the spring's angle (`SplitState.wobP` / `wobM`): a damped spring about zero, 3 Hz, damping ratio 0.3. It reaches the renderers only as the warp's two angles, `thetaP` and `thetaM`. Nothing downstream changed.
- **What drives it:** the acceleration of the split's mass point, 0.10 m up from the hinge (`arm`), by finite differences of the pose (`pointAccel`). Across the split (`gainSide` 6) one half opens and the other closes. Up out of the hinge (`gainBob` 8) both open or both close. A half less far open is driven in proportion. There is no gravity term, so a still head rests at exactly zero offset.
- **Its limits** (`wobbleLimits`, held on every sub-step): within 0.45 of the half's own spring angle either way (`max`: ±14.2° at 31.5°); never nearer shut than 0.03 rad (`minOpen`); never further open than the full angle × 1.45 (`over`: 45.7° for `middle`, both). Each drive component is clamped to 40 m/s² (`accelClamp`). A sample that moved faster than 25 m/s (`jumpSpeed`) is a teleport and is dropped. A drive that is not finite is no drive.
- **Measured:** 3 to 6° in a steady walk; a lurch takes a half to its limit for one to three frames.
- **Off:** `gainSide: 0` and `gainBob: 0`. The angles are then the spring's, to the bit.

### 10.7 Wetness: the film on an open head

- **What it is** (`webgpu/march/body/blocks/light/split-glisten.wgsl.ts`; numbers in `SPLIT_SHADE.glisten`). A wet film over the raw surfaces of an open split: the pit the face cuts carve and the flat caps around it. It adds highlights and nothing else, off a normal of its own (the shading normal leant by two octaves of noise that ride the half).
- **What gates it:** the hit is inside an open head's region sphere; on the head (above the hinge plane and inside the hold ball, fading over 1 cm); the wound mask past its faint reach (0.3 to 0.8); not under the face sheet, not char; and a distance fade measured in march texels (whole to about 2.4 m, gone by about 5 m at the gate's resolution). A chest wound on a zombie whose head is open does not take it.
- **Lights.** The torch glints from its own place with a cone wider than the beam's (`spill` 0.3): at 0.6 m the beam itself misses a head in the middle of the screen. A lamp glints only with the torch off. Each glint has a horizon on the surface's own normal (`horizon` 0.15).
- **Where it glints.** The film's lean (the angle between its normal and the surface's) is 14.5 / 39.3 / 54.8 degrees at 5% / median / 95% (`lumpTilt` 2.4, `lumpFlat` 1, `fineTilt` 0.6), so a cut face seen square on under the torch glints, and a raked one still does. The build before leant 72 degrees at the median and glinted only at a rake.
- **Effect** (`gain` 4.5, `pow` 28: the owner's pick, below). Square on to a one-sided head's big cut face, raw texels over 0.6 luma go from 1.19% to 11.50%, over 0.95 from 0.09% to 4.32%. Over the first cameras at 0.6 m (front, three-quarter, above-behind) under the torch they go from 1.98% to 6.30%, over 0.95 from 0.02% to 1.68%; looking down into the V, 1.27% to 6.05%. At 2 m, 6.15% to 7.82%. Torch off, at 0.6 m, 1.20% to 2.40% and nothing over 0.95. The worst view (a one-sided head from its right, into the pit at the crown) is 13.66% over 0.6 and 6.41% over 0.95. Nothing outside an open split's region changes (0 texels; pins unmoved).
- **Off:** `gain: 0`. The block is then not written into the shader at all, and the build is the one before the film to the byte.
- **Not on the deferred surface entry**, which has no light tail. The game's default entries (the march and its refine twin) carry it.
- **The owner chose C** from `docs/dev-notes/2026-10-04-head-split/look/14-wet-variants.jpg` on 2026-10-06 ("I think C is fine"): the boldest of three. It is past the 3% bound on highlight blow-out the quieter B kept (3.4% to 6.4% of raw texels over 0.95 luma in the views from the side; B's worst was 2.50%): that bound was the builder's, and the pick overrides it. The alternatives, to paste into `SPLIT_SHADE.glisten` (the other numbers stay): **B** `gain: 2.6, pow: 40` (the same film, quieter: 5.63% square on, 3.83% / 0.45% over the first cameras); **A** `gain: 4, pow: 24, lumpTilt: 3.2, lumpFlat: 0.1, fineTilt: 0.3` (a film that leans 72 degrees: wettest at a rake, dry square on); off `gain: 0`.

### 10.8 The gates

- **`scripts/head-split-gate.mjs`: 80 checks, as of 2026-10-05.** Scenarios S (open), W (widen), K (the kick and the kill), O (one side), L (later hits), F (`face`), M (the skull), R (range), A (a body chop near the neck), H (head damage), J (the wobble, scripted), B (bounds), T (a turned zombie) and C (cost, console, the depth guard). Five boots.
  - **It measures on the float march target** (`__sdfGameDebug.readMarchTarget`), not on screenshots: two screenshots of one closed head differ in over 150 000 pixels. Each capture is two reads, and their difference is checked (0 on a settled frame). The skull's eyes are the exception: a shown / hidden pair of one frame.
  - **The boot is pinned** as `march-hash` pins it (the dynamic-light clock, the probes' afterglow, the field interlace), so every number is the same in every run.
  - **Expectations are derived from the live tuning constants,** so a retuned angle or spring moves them with it. Every scenario has a check shown to fail under a breaking change.
  - **The depth guard** (`scripts/lib/march-depth-guard.mjs`, with unit tests) runs on every capture: each body texel, placed in the world by its depth, must lie in front of the camera and inside some actor's proxy box or live gib chunk's sphere, and of all the body texels at the world origin's clip depth no more than 2 may share one depth to the bit. Its positive control (each arm shown to fail on made-up texels) is a check of its own.
  - **To run it** (bash, not zsh; it needs its own servers):
    `bash -c 'export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/head-split-gate.mjs 5241 9241'`
- **`scripts/axe-gate.mjs` (27 checks: the 26th and 27th are the depth guard's positive control and the guard, at every screenshot) and `scripts/cut-wound-gate.mjs` (30 checks) stay green,** as of 2026-10-05. The axe gate's K was restated for the split: the corpse keeps the split and its two cut faces, not three head cuts.
- **The whole test tree** (`npx vitest run src/lab/sdf-zombie --exclude '**/cut-wound.test.ts'`): 511 files, as of 2026-10-05.

### 10.9 Costs, carried as debt

The owner (2026-10-05): the open-head cost "is a lot but we can figure out how to optimize later". Nothing below has been optimised. All frame times are `__sdfGame.timeDraws(120)`, headless, a 400 × 300 march target, one zombie's head centred, `middle` with both sides open.

| Open head minus closed head | At 0.6 m | At 2 m | Conditions |
| --- | --- | --- | --- |
| B4 (the field) | +3.5 to +4.0 ms | +0.4 to +1.2 ms | two sets of sessions (closed 20.0–22.5 ms, then 17.6–18.1 ms) |
| B5 (bounds: more pixels march the head) | +5.9 / +6.4 ms | +1.1 ms | one 2 m session unreadable |
| B6 (shading after the hit) | +5.9 to +6.1 ms | unreadable | load 2.0–2.8 |
| B7 (the skull) | +6.1 / +6.7 ms | +1.6 ms | busy machine (load 3–7); B6's tree in the same sessions read +5.9 / +6.3 and +1.4 |
| The gate's own scene, first build | +7.6 to +8.0 ms (25.2 → 33.2) | +0.6 to +0.7 ms | two quiet runs; "closed" still carries the cut faces |
| Before the axe's table and the wobble | +7.4 ms (26.2 → 33.6) | +0.6 ms | quiet machine; the same measure after: load 9 to 104, not quotable |
| The wet film's session | +8.7 ms before; +8.0 with the film, +7.2 with `gain` 0 | hidden by a 16 ms spread | load 4–5; the level moved 6–13 ms from boot to boot |

- **Read:** about +6 to +8 ms at 0.6 m and about +0.6 to +1.6 ms at 2 m. The film's own cost is not resolved: under 1 ms if anything. The staged skull copies cost +0.1 to +0.5 ms over the whole skull.
- **Cold shader compile:** +4.5 s on B4's boot pair (45.0 → 49.5 s warm-up, load 3.5–4.5; `drawOnce` unchanged), accepted then. The later quiet pairs (B5, B6, the look block, `cutKeep`, the film) read 44.1 to 45.9 s for base and new alike, and their base trees already hold B4. So the 49.5 s level was not seen again, and nobody has re-measured against the tree before B4. Pairs taken under load swung 4–5 s and are not counted.
- **Closed bodies:** B4 read about +0.3 ms at 2 m (inside the spread) and 0 to +1.5 ms at 0.6 m (unresolved, under load). B5: no change. B6: +0.1 to +0.3 ms at 0.6 m, unattributed. B7: none.
- **Other split costs:** a walking split head never rests, so its bounds, hulls and record are re-made every tick. The first split frame of a session draws in 60–66 ms against 32–37 ms after.
- **The cut excess pass's two costs** ([status](../../dev-notes/2026-10-04-cut-excess/STATUS.md), [decision](../../dev-notes/2026-10-04-cut-excess/compare/NOTES.md)): cold boot about +430 ms (+136 to +936 ms over four pairs, load 4–6); and three axe chops on one torso add about +22 ms of frame time (25.8 / 28.6 → 49.1 / 48.6 ms), against +4.3 ms before the pass. Neither has been investigated.

### 10.10 Known limits and follow-ups

**Limits, accepted for now:**
- **Still the closed head's:** the shadow hull (the shadow is the closed head's), `bodyInSight` (`game-main.ts`) and motion vectors (a moving half's object motion reads zero; temporal accumulation is off by default).
- **A pellet or slug crater on a cut face** sits on the old plane, so it shows on both faces. A rod sweep across the gap is un-warped as one segment, by its midpoint's piece.
- **A one-sided split's face cut marks the still half too:** 775 of 4520 texels of the crown, by up to 8.2 mm. The owner saw this build and is happy with it.
- **The deferred surface entry lacks the wet film** (§10.7).
- **The top neck vertebra is not split.** It stands up to 44 mm proud of the still half's cut face in `face`.
- **A baked split head has no answer yet.** A detached or baked head takes the mesh face layer with no split.
- **The bone's stage steps only through the seam:** a chop that lands while the flesh is still past the old target moves the bone about 20° in one tick. In play strikes are at least 0.6 s apart.
- **The range cut-off pops** (14 texels of the march target at 12.7 m). Up close, a coarser SDF pass (`aaCfg.x` over 0.00152) or `?laststep=7` could draw the region sphere as a ball; a test holds the shipped numbers under the margin and the view warns in a dev build.
- **Look, known and left:** the skull is hollow and the gap empty after the kill; the fracture's teeth read as a regular saw up close; an off-centre split halves an eyeball; loose pixels at the slab's tip and speckle on the `face` preset's crown; the corpse's halves pass through the floor.

**Follow-ups:**
1. **The depth fault: bisected, rule pinned** (notes, "The depth fault, bisected"). On Apple's GPU, when only some fragments of a 4 × 4 block of the march target take a `bodyLights` call, the others come back with a zeroed ray and hit distance in the entry point: colour right, depth the world origin's. Rule: `bodyLights` only under conditions every fragment shares (`lightListCfg`), pinned in `split-glisten.wgsl.test.ts`; the gates' depth guard (`scripts/lib/march-depth-guard.mjs`) catches it whatever the cause. The `return` after the miss `discard` in `MARCH_TRACE_POST` landed 2026-10-06 (and the refine twin's three): bit-identical, no frame or compile time saved, because on this GPU a discarded fragment already paid nothing for the code after its `discard` (notes, "The miss discard's return"). That leaves open which fragments take the gated call: the first reading (missed fragments running the tail) is not established.
2. **The `gRefoldBy` cross-slot leak.** The re-fold report is filed by piece, not by slot, so in a crowd pixel an open head's hit can read another slot's normal hint. It never touches the field. The fix moves what closed crowd pixels compute, so it is its own task with its own `march-hash` re-pin.
3. **Optimise the open head** (§10.9). Not tried: a fixed piece order with a per-piece `continue`; flattening the pieces into the slot loop; caching a resting head's bounds.
4. **The cut excess pass's costs** (§10.9).
5. **Something in the gap:** a brain mesh riding piece 0, drawn from `view.splitDrawn` like the skull.
6. **The slug opening the split** (§2, §7): not started.

### 10.11 What the owner decided in playtest (2026-10-05)

- **The axe skips the thin crack.** "The skull stages are fine, though I think we can skip to stage 2 or 3 with the axe." Kept: the table in §10.2.
- **The wobble stays as tuned.** He asked for the halves to be "a little less stiff", played the build and said it "looked fine to me". A reviewer's suggestion to lower `accelClamp` was not applied.
- **The ragged face cuts stay.** A restyle of the cut faces (the face cuts shrunk to a notch at the crown; a bone ring; skin, fat and muscle layers with a dark cavity) was built and then reverted in `d0d407d2` at his call: "pretty subtle", "I'm happy with the before". The three steps are `f2a1c7f8`, `eb2f131b` and `e1e4acf2`; their sheets (`look/01-face-cut-reach.jpg`, `02-bone-ring.jpg`, `03-layers-cavity.jpg`) are in `e1e4acf2`'s tree. To bring a step back, cherry-pick it or revert the revert.
- **The wet film** was built at his request ("the wetness under flashlight is probably more visually striking"). Shown three settings on one sheet (`look/14-wet-variants.jpg`), he chose the boldest, C, on 2026-10-06: "I think C is fine" (§10.7).
- **The open-head frame cost:** optimise later (§10.9).
- **He has been told** that chops to the upper chest, collar and neck base no longer count as head chops (§10.2), and did not object.

### 10.12 §8's open questions, as answered

- **2 (two point and normal pairs through the post blocks):** one block (`split-hit`) declares the un-warped set once and the other blocks read it. No new helper; the census stayed clean.
- **3 (the skull's per-side transform):** a second and third instance with complementary clips (§10.5), not uniforms on the one material.
- **4 (the bigger record's cost with no split):** one extra record read per closed body; see "Closed bodies" in §10.9.
- **5 (the death path):** part A's (`blast` with `forceCollapse`). The split state is the leaf's, so the corpse keeps it.
