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

**Detecting a head hit.** A hit counts as a head hit when the flail's `isHeadRegion` test says so: the head limb, or a point above the neck root.

**`axe-head.ts` (pure, per actor):**
- **Fields:** `chops` (count), plus the split state from §5.
- **`AXE_HEAD.chopsToKill`:** debug default 3.
- **`AXE_HEAD.openAngles`:** the opening per chop before the kill, as fractions of the preset's maximum angle. Default `[0.55, 0.8]`; the kill then kicks to 1.0.

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

The split stays open on the corpse.

**Isolation from the slug burst.** `BURST_TUNING_DEFAULTS.anyWeapon` is `true` (the owner's debug setting), and routes any weapon's head hit into the slug burst. The axe bypasses that routing, so an axe chop never triggers the burst.

**Other characters.** Characters without split presets get the part A behaviour (cuts plus the counter) in part B as well.

## 5. Part B: the head split

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

**Cut faces.** Opening a split stamps one cut per opened half along the plane. These cuts are head-tagged, so the protected head slots (`MAX_HEAD_WOUNDS`) keep them while the head is open. This answers the eviction question in cut-wounds spec §10.5.

**Steps.** Each step is small and runs its own shader checks (§6):
- **B1:** presets, spring and the CPU mirror.
- **B2:** the core warp and the step clamp.
- **B3:** shading after the hit on `pw`.
- **B4:** tiles and the skull mesh.
- **B5:** the gate.

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
- **Cost.** Three chops on one torso add about +4.3 ms (ungated; `timeDraws(120)` at 0.9 m), against +1 to +5 ms for three rod cuts.
