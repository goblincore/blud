# Burning feedback pass — design (2026-09-18)

Addresses the six owner playtest items in
`docs/dev-notes/2026-09-18-flame-playtest-feedback.md`. Builds on the flame lab
spec `2026-09-17-burning-enemies-flame-lab-design.md`.

## Decisions (owner, this session)

- **Fire renderer:** a low-res **volumetric fire + smoke pass** fed by the
  burning bodies' capsules, with **fewer flame cards kept as accents**
  (wildfire's architecture, Blood's crisp licks on top).
- **Burning behaviour:** **per type** — soldiers panic and flee, zombies keep
  coming, faster and stumbling.
- **Execution:** everything dispatched (`deepseek-flash` on `dsh`), in three
  rounds, reviewed by Claude against captures and numbers after each.
- **Not in scope:** burn damage/death (belongs to the real flare-gun pass),
  in-SDF-march fire, room-wide smoke accumulation.

## Rounds

| Round | Work | Tasks |
|---|---|---|
| 1 | A quick fixes, C burning behaviour, D skeleton | three parallel dispatch tasks |
| 2 | Volumetric fire in the flame lab, cost gate | one task |
| 3 | Volume in the game, smoke, velocity lag, card trim | one task, `base_branch` = round 2's branch |

Round 1 tasks touch disjoint areas; each task's guardrails name the others'
files as off-limits. Round 2 can start alongside round 1 (lab-only files).

---

## A. Quick fixes (items 3, 4b)

### A1. Fire lights the room (item 3)

Cause (confirmed): in-game fire only feeds `directFlashes` → each SDF body's
`bodyFlash`; no light reaches walls/floor. The lab uses a real
`THREE.PointLight` per burner.

The room (walls/floor) is SDF and is lit by the **probe gather's dynamic
light list** (`gatherLights`, max 8 slots, `game-main.ts` ~2100–2140);
explosions light the room through it (`EXPLOSION_LIGHT.gatherPeak`) and light
mesh props through an always-visible `PointLight` pool (`explosionLightPool`,
~662 / ~7915). Fire needs **both**:

- **Gather side (the room):** up to **2 gather slots** for fire, placed after
  explosions and before tracers; the nearest burners to the player's room
  win, and more burners than slots are merged into the nearest slot (summed
  intensity at the intensity-weighted position). Colour/flicker from
  `burn-light.ts`; peak is new tuning (`burnTuning.lightGatherPeak`).
- **Mesh side (props):** a pool of **4 `THREE.PointLight`s**, created at boot,
  **always `visible`**, `intensity = 0` when idle. Never toggle `.visible`
  (recompiles every lit material, 180–230 ms stalls measured).
- Keep the existing `directFlashes` push (lights the burning body itself).
- **Done:** a floor/wall crop next to a burning body is measurably brighter
  (mean luminance) than the same frame with fire light forced to 0; the gather
  cost with 4 burners is reported against 0 burners; boot shows no new
  pipeline compile after warm-up.

### A2. Molten look on non-burning neighbours (item 4b)

The feedback note's suspected route (crowd `burnCfg` bleed) did **not** hold up
on reading: crowd records carry burn per instance and the shared crowd
uniforms stay 0. Remaining candidates, most likely first: the burning body's
**flickering `directFlashes` light, which by design also lights its
neighbours** (`game-main.ts` ~2195 comment: "lights itself and its
neighbours") — a fast warm flicker on a body reads as moving molten skin; the
heat-distortion post pass (`burn-distort.ts`) warping neighbours; or a real
burn value on the wrong body.

- **Diagnose first:** ignite ONE zombie in a group (`__sdfGame`), capture a
  neighbour's screen crop over ~1 s, measure frame-to-frame change. Repeat with
  heat distortion off, then fire light off, then with `REC_BURN`/`burnCfg`
  logged for the neighbour.
- Fix what the numbers point at. If it is the distortion, bound its footprint
  to the burner's flame region (not a neighbour's surface) rather than turning
  it off. If it is the flicker light, neighbours keep a steady warm light
  (the flicker applies only to the burning body's own flash, or the flicker
  depth falls off with distance).
- **Done:** a non-burning body beside a burning one shows no animated change
  of its **own surface** (burn noise, char). Distortion visibly passing over it
  from the flames in front is acceptable; the notes state which was the cause.

## C. Burning behaviour (item 5)

Hook: the `doomed`-style mind override in `webgpu/game-actor.ts` — while an
actor is burning, its mind's output is replaced, so `brain.ts` and
`soldier-brain.ts` gain no states.

- **Soldier:** stops shooting and aiming; runs **away from the player** at
  ~**1.4×** run speed on an erratic heading (seeded wander target re-picked
  every ~1–2 s, biased away from the player, clamped to walkable space by the
  existing movement).
- **Zombie:** keeps its chase target, speed ~**1.25×**, heading jitter from a
  smooth seeded noise.
- **Both:** arm **flail** layered on the pose; a **lurch/stumble** every
  1.5–3 s (short stagger impulse via `stagger.ts`, which already maps
  burn → `'shudder'`); gait switches to RUN where the type has one (`gait.ts`).
- On extinguish, the override releases and the mind resumes.
- All numbers in one frozen tuning table next to `burn-profiles.ts`
  (data + bounds, like `BURN_BOUNDS`); the panic/wander/stumble logic is pure
  and unit-tested (seeded, deterministic).
- **Done:** tests for the pure logic; an in-game capture sequence (or position
  trace) of one burning soldier and one burning zombie showing flee vs chase,
  higher speed, and at least one stumble per 3 s.

## D. Skeleton (item 4a)

The bone-fix pass made revealed bone dark/scorched, which killed the skeleton
read. Target: bone reads **as bone** without pale limbs returning.

- Revealed bone (existing skeleton probe, `applyBones`, `burnSkeleton*`
  uniforms) shades **ivory with soot streaks**, with its own normal/gloss so the
  shape reads, only where flesh char has burned through (char above a
  threshold, masked by the same noise that drives soot).
- **Done:** lab captures at mid and full char where bones are clearly visible;
  **a fully charred body's mean luminance stays within +15% of the current
  (dark-bone) build** in the same capture, so limbs don't read pale.

---

## B. Volumetric fire and smoke (items 1, 2, 6)

### Field

- **Sources:** per burning body, ~12 capsules from its posed limbs — derived
  from the same posed data as `flame-anchors.ts` (a new pure helper beside it,
  e.g. `fireCapsules(build) → {a, b, radius, limbWeight}[]`), so lab and game
  share one rule. Plus a head **crown** source.
- **Per capsule:** endpoints, radius, burn (0..1), and **velocity** (from the
  previous frame's endpoints).
- **Upload:** a small storage/uniform array, **max 8 bodies × 16 capsules**;
  bodies ranked nearest-first. Bodies beyond 8 get cards only.
- **Sample** → `temperature`, `soot`:
  - temperature: capsule distance falloff, stretched **upward** (rise) and
    thinning with height, crown above the head;
  - soot: starts above the heat core, keeps rising, lower density, longer
    life;
  - motion: the existing 64³ curl volume (`curl-volume-node.ts`) warps the
    sample point, animated by time.
- **Velocity lag (item 6):** the sample point is offset by
  `+velocity × lag × heightAboveSource` (clamped), so flame trails a moving
  body and straightens when it stops. Replaces the unused
  `TongueTuning.lean`.

### Render pass

- Its own pass at **`resolutionScale` 0.25–0.5** of the drawing buffer.
- Ray bounds: screen-space rect / ray-AABB of the active bodies' fire bounds;
  pixels outside skip the march.
- **24–48 steps**, per-frame jittered start; **temporal reprojection** with
  previous view-projection and a neighbourhood min/max history clamp
  (wildfire's scheme); reset on camera cut/teleport.
- Stops at scene depth (the capture's sampleable depth texture).
- **Output:** emission rgb (temperature → Blood palette ramp dark red → orange
  → yellow) and **transmittance** from soot. Composite:
  `scene × transmittance + emission` — smoke is normal-blended darkening, fire
  is additive.
- `steps = 0` disables without a pipeline change (wildfire's trick).
- **Chain position:** a post-aa pass on the **same seam as the screen-space
  tongue pass** (`setTongues` in `post-aa.ts`): runs right after the chain's
  capture, **before the shutter capture stage and the glow extract**, marches
  into its own low-res target (it samples the capture's depth, so it cannot
  write the capture directly), then composites into the capture. Glow, heat
  distortion and shutter blur all apply to it. Off never binds its material,
  so the all-off parity path stays exact. The selective-shutter capture stage
  is untouched.
- Never sample the target being written (the screen-space-pass bug).
  WebGPU rules: alpha in `colorNode.w`, no `alphaHash`/`alphaTest`.

### Cards as accents

- Card count per body becomes tuning (target 4–6, 0 allowed), larger and
  softer; they ride the same velocity lag.
- Existing soft fade and curl flow stay.

### Round 2 — lab

- Flame lab technique **"volume + cards"**; panel section with resolution,
  steps, temperature/soot gains, rise, lag, card count; `__flameLab` state
  access for captures.
- A **"run" fixture**: the burning body moves across the floor and turns, so
  trailing is judged.
- **Captures:** standing, running, turning — volume+cards vs current cards,
  plus a sheet against the wildfire reference screenshots.
- **Cost:** GPU time via the lab's timing with 1, 4 and 8 burners.
  **Budget: ≤ 2 ms with 4 burners at 0.5 scale** on the owner's machine; if
  missed, report the 0.25-scale figure and what dominates.
- **Done:** captures + cost table + NOTES; the volume visibly reads as one
  continuous flame mass with rising smoke, and trails in the run fixture.

### Round 3 — game

- Port to `game-main.ts` behind the same burning registry; the 8-body ranking
  shares the burner list.
- Smoke keeps rising and fading; an **extinguished body smokes ~2 s** (soot
  only, temperature 0).
- Cards trimmed to the lab's chosen count.
- Pipelines compiled in warm-up (no first-ignite stall); verify with the
  in-game capture script (`flare-ingame-capture.mjs`, warm gate `ready`).
- **Done:** in-game captures standing/running/extinguished, frame time with
  4 burners reported, no new pipeline compile on first ignite.

## Testing and gates (all rounds)

- Targeted tests only plus `npx tsc --noEmit`; 12 pre-existing failing files
  are known.
- Visual claims need a measurement (luminance, pixel change, timing), not an
  eyeball. Headless capture only (the in-app pane loses the WebGPU device).
- Capture scripts must require `__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- Game defaults for unrelated systems unchanged (explosion curl stays OFF).
