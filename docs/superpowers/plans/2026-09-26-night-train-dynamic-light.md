# Night Train dynamic light and the flashlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Night Train starts dark. You find the flashlight in the baggage hold. Lamps have moods and scripted blackouts, a violent thunderstorm rages outside the windows, lightning and passing-light sweeps come through the windows with shadows, and the fires glow ([spec](../specs/2026-09-26-night-train-dynamic-light-design.md), §2 and §3).

**Architecture:**
- **Pure modules decide:**
  - `lamp-moods.ts`: a lamp's level for a mood and the scripted overrides, both at a time;
  - `storm.ts`: the seeded bolt and sweep schedule, and the window light at a time;
  - `level-events.ts`: gains a `light` command and cues.
- **One leaf applies them:** `game-dynamic-light-leaves.ts`, with its runtime on `ctx.world.light`. It sets the lamp intensities, the flashlight's brightness, the per-carriage shadowed directional window lights, and the storm uniforms the window glass reads.
- **The window glass** gets a `storm` path in hand-written WGSL.
- **The tables are still the plan of record.** The Night Train tables gain moods, fire lights, triggers, cues and the flashlight pickup; rebuild and export.

**Tech Stack:** TypeScript, three r186 WebGPU/TSL `wgslFn`, vitest, Blender 4 headless, CDP gate.

## Rules that bind every task

- **Lights are never hidden:** only their intensity moves. Hidden lights re-key the LightsNode and rebuild pipelines.
- **`castShadow` is set at boot and never toggled.** Shadow maps idle with `autoUpdate = false` and render with `needsUpdate = true`.
- **Window lights live in a group,** `train.window-lights`, not at the scene root. `applyRig` zeroes every root DirectionalLight.
- **Every light exists before the per-room light lists are built,** the same rule as `createOutdoor`: create them next to `createTrain`, which runs before them.
- **The sim clock drives all light time,** so replays match. `ctx.lighting.clockFrozen` (the gate's freeze) stops the lamp clock.

---

### Task 1: `lamp-moods.ts` (pure)

**Files:** Create `src/lab/sdf-zombie/webgpu/lamp-moods.ts` and `lamp-moods.test.ts`.

```ts
export type LampMood = 'steady' | 'flicker' | 'stutter' | 'dying' | 'dead' | 'fire';
export const LAMP_MOODS: readonly LampMood[];
/** 0..~1.3 multiplier on a lamp's power. Seeded by `seed` (the lamp's index), so replays match. */
export function moodLevel(mood: LampMood, t: number, seed: number): number;
export type LampScript =
  | { mode: 'die'; at: number }          // sputter 1.2 s, then 0 for good
  | { mode: 'blackout'; at: number }     // 0 for 6 s, stutter back over 1.5 s, then the mood again
  | { mode: 'strobe'; at: number };      // surge to 2.2 for 0.5 s, strobe at 8 Hz for 3 s, then 0 for good
/** The level with a script applied (null = the mood alone). */
export function lampLevel(mood: LampMood, script: LampScript | null, t: number, seed: number): number;
export const LAMP_SCRIPT = { sputterS: 1.2, blackoutS: 6, recoverS: 1.5, surgeS: 0.5, strobeS: 3, strobeHz: 8 } as const;
```

**The moods:**
- `steady` is today's wobble: 1 + 0.14 · (0.5 sin 7.3t + 0.25 sin 17.1t), with the phase from the seed.
- `flicker` is the same wobble at 0.35, plus a dip to 0.3 in about 1 of every 8 hashed 0.1 s slots.
- `stutter` is steady, with 0.4–1.2 s bursts every 3–7 s (hashed). A burst drops to 0 in about half of its 0.06 s slots.
- `dying` is a 0.35 base, a slow 0.25 Hz swell of ±0.1, and a 0 in about 1 of every 4 hashed 0.12 s slots.
- `dead` is 0.
- `fire` is 1 + 0.3 sin 5.1t + 0.18 sin 13.7t + 0.1 · hash noise at 0.08 s.

The hash is an integer mix of (seed, slot), with no `Math.random`.

**Tests:**
- every mood stays in [0, 1.4];
- `steady` equals the old formula;
- `dead` is 0;
- the same arguments give the same value;
- `dying` averages under 0.5 over 60 s;
- `stutter` hits 0 at least once in 30 s;
- `die` is 0 after `at + 1.2`;
- `blackout` is 0 at `at + 3` and back on the mood at `at + 8`;
- `strobe` peaks above 2 at `at + 0.2`, alternates during the strobe, and is 0 after `at + 3.5`.

- [ ] Write the tests, run them and see them fail. Write the module, run the tests, run tsc, and commit.

### Task 2: `storm.ts` (pure)

**Files:** Create `src/lab/sdf-zombie/webgpu/storm.ts` and `storm.test.ts`.

```ts
export const STORM = {
  boltGap: [6, 14], sweepGap: [14, 26], sweepS: 1.5,
  boltColor: [0.72, 0.82, 1.0], boltPeak: 7, sweepColor: [1.0, 0.68, 0.38], sweepPeak: 2.4,
} as const;
export interface Bolt { t: number; side: 1 | -1; z: number; seed: number }  // z: along-track offset of the bolt, metres
export interface Sweep { t: number; side: 1 | -1 }
/** The seeded schedule of bolts and sweeps up to `until` seconds. */
export function stormSchedule(seed: number, until: number): { bolts: Bolt[]; sweeps: Sweep[] };
/** A bolt's brightness envelope at `age` seconds: a 0.05 s spike to 1, a 0.08 s dip to 0.25, a second 0.06 s spike to 0.8, then a 0.35 s decay; 0 outside [0, 0.6]. */
export function boltEnvelope(age: number, seed: number): number;
/** The window light at time t: colour times intensity, and the direction TOWARD the light (normalised). */
export function windowLightAt(s: { bolts: Bolt[]; sweeps: Sweep[] }, t: number):
  { intensity: number; color: [number, number, number]; dir: [number, number, number]; bolt: Bolt | null; flash: number };
```

- **Lightning:** the direction is (side · 0.85, 0.5, 0.15); `flash` is the envelope.
- **Sweeps:** the direction is (side · 0.9, 0.18, s) with s running from -1.6 to 1.6 over `sweepS`. The intensity is `sweepPeak` · sin(π · k).
- **When both are live,** the colours add and the direction follows the brighter of the two.

**Tests:**
- the schedule is deterministic for a seed;
- the gaps stay inside their ranges;
- both sides occur within 120 s;
- the envelope is 0 before 0 and after 0.6, and peaks at 1;
- `windowLightAt` returns 0 intensity between events;
- the lightning intensity at bolt + 0.03 is above 5;
- a sweep's direction z changes sign across its span;
- the direction is unit length.

- [ ] Write the tests, see them fail, implement, run the tests and tsc, and commit.

### Task 3: The level format — the flashlight pickup, light moods, cues and the `light` command

**Files:**
- Modify `level-def.ts`:
  - add `'flashlight'` to `PickupItem` and `PICKUP_ITEMS`;
  - `AccentLight` gains `mood?: LampMood`;
  - `LevelDef` gains `cues: { on: string; emit: string[] }[]`.
- Modify `level-json.ts`:
  - the keys: `light` gains `mood`, and the top level gains `cues`;
  - parse them, rejecting an unknown mood or a cue without `on` and `emit`.
- Modify `game-level.ts`: the `AccentLight` type.
- Modify `pickups.ts`: `Inventory` gains `flashlight: boolean`. A `flashlight` pickup sets it, and a second one is left on the floor.
- Modify `level-events.ts`:
  - `LevelCommand` gains `{ kind: 'light'; mode: 'die' | 'blackout' | 'strobe'; room: number }`, from `^light\.(die|blackout|strobe)\.room\.(\d+)$`;
  - add `expandCues(events, cues)`. It returns the events plus each cue's `emit`, for one level only: a cue's output is not expanded again.
- Tests: `level-json` (mood, cues and bad values), `pickups` (flashlight), `level-events` (the light regex and `expandCues`).

- [ ] Tests first; implement; run tsc and the tests; commit.

### Task 4: The tables, the build and the exporter

**Files:** Modify `scripts/levels/night_train_layout.py`, `build_night_train.py` and `export_level.py`. Rebuild `assets-source/levels/night-train.blend`, then export `public/assets/levels/night-train.level.json` and `night-train.art.glb`.

- **`night_train_layout.py`:**
  - Each carriage gains `moods` (one per lamp, in lamp order), `fires` as `(id, x, u, y, power)`, and `triggers` as `(id, event, x0, x1, u0, u1)`.
  - Pickups take an optional height as a fifth element.
  - A top-level `CUES = [("pickup.flashlight", ["light.die.room.1", "alert.room.1"])]`.
  - `to_level()` writes all of it: triggers are `once`, from floor to 2.2 m.
  - Moods:

    | Carriage | Moods |
    | --- | --- |
    | van | `dying`, `stutter` (the office lamp) |
    | dining | `flicker`, `dead` |
    | sleeper | `stutter`, `stutter` |
    | party | `steady`, `steady` |
    | cab | `steady` |

  - Fires, colour (1, 0.42, 0.12):
    - van office stove (1.1, 15.2, y 0.5, power 0.8);
    - galley stoves (1.2, 16.6, y 0.6, power 0.8);
    - sleeper boiler (1.4, 0.6, y 0.6, power 1.0);
    - party boiler (1.5, 0.7, y 0.6, power 1.0);
    - the cab firebox stays (mood `fire`).
  - Triggers:
    - sleeper `blackout` (`light.blackout.room.4`), x -2.0..-0.6, u 8.6..9.4;
    - party `strobe` (`light.strobe.room.5`), x -2.1..2.1, u 5.5..6.5.
  - The pickup `torch` (`flashlight`) goes at x -1.45, u 4.6, height 1.4, on the hold's west wall by the van lamp.
- **`build_night_train.py`:**
  - `glight` takes `mood` and writes `obj["mood"]`;
  - fire lights come from `fires`;
  - trigger boxes go in the collection "triggers", named `trigger:<event>:<id>` with `once = True`;
  - pickups use their height;
  - `SC["cues"] = json.dumps(CUES)`;
  - small dressing stops casting shadows: set `inst["shadow"] = False` on instances of valve, gauges, grille, gear-housing, streamers, bunting-*, party-hats and lamp-hanging. Check how `put` passes custom props to the exported extras; the exporter reads `o.get("shadow")` on made-real objects.
- **`export_level.py`:**
  - lights write `mood` when present;
  - the scene prop `cues` (a JSON string) becomes the top-level `cues`.
- **Rebuild with:** `blender --background --factory-startup --python scripts/levels/build_night_train.py`, then the export command from the Night Train rebuild plan (`docs/superpowers/plans/2026-09-25-night-train-rebuild.md`).
- **Check:** the level test (`night-train` level test: the routes, the counts) still passes, updated for the new pickup and triggers.

- [ ] Tables, build, exporter; rebuild and export; run the level tests; commit (the JSON, the GLB, the scripts).

### Task 5: The runtime leaf — lamps, the flashlight, window lights and commands

**Files:**
- Create `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts`.
- Modify `game-state-world.ts`: `light: DynamicLightRuntime | null`, making `WORLD_BINDINGS` 30, with its test.
- Modify `game-main.ts` and `game-loop-leaves.ts`.

```ts
export interface DynamicLightRuntime {
  time: number;                                   // the light clock (sim seconds)
  lamps: { light: THREE.PointLight; bowl: THREE.MeshStandardMaterial | null; base: number; mood: LampMood; room: number; seed: number; script: LampScript | null }[];
  flashlight: { level: number; target: number };  // 0..1
  storm: { seed: number; schedule: ReturnType<typeof stormSchedule>; flash: number; bolt: Bolt | null } | null;
  windowLights: Map<number, THREE.DirectionalLight>;  // room -> light
  lampGlass: Map<number, THREE.MeshStandardMaterial[]>;  // room -> the art's train.lamp materials (cloned per room)
  shadowFrames: number;
}
export function createDynamicLight(ctx): DynamicLightRuntime;   // after createTrain, before the per-room light lists
export function stepDynamicLight(ctx, dt): void;                // the sim tick, after stepTrain
export function runLightCommand(ctx, cmd: { mode; room }): void;
export function flashlightGate(ctx): number;                    // 0..1, read by game-main's beam code
export function createDynamicLightSeams(ctx);   // lights(), setFlashlight(level), forceBolt(side), forceSweep(side), lampLevels(room)
```

- **Lamps:**
  - `createDynamicLight` adopts `ctx.lighting.flickerLights`, adding each accent's mood (from the def; `steady` when absent) and its bowl material. The accent loop in `game-main.ts` records the bowl.
  - `stepDynamicLight` sets `light.intensity = base * lampLevel(...)` and `bowl.emissiveIntensity = 2.2 * level`. Each room's lamp glass emissive gets the room's mean level.
  - The draw-path flicker block is removed. The ring and the Wake (all `steady`) keep today's wobble, on the sim clock.
- **The flashlight:**
  - `target` is 0 when the level has a `flashlight` pickup, and 1 otherwise.
  - On `pickup.flashlight`, the target becomes 1. The level ramps up over 0.25 s with two quick dips (a switch-on stutter).
  - `game-main.ts`:
    - `spot.intensity = 90 * gate` each frame, where the flashlight is posed;
    - `spotOn = (dungeonOn ? 1 : 0) * gate`;
    - the spot's and the twin's shadow maps idle (`autoUpdate = false`, `needsUpdate = gate > 0`), decided at boot and only on a level that starts dark.
- **Window lights:**
  - One `DirectionalLight` per room that has window glass (`ctx.world.train.windows` grouped by `userData.room`).
  - Each has `onlyRooms = {room}`, `castShadow = true` at boot, a 1024 map, `autoUpdate = false`, and bias -0.0005.
  - At boot `needsUpdate = true` once, with its frame fitted to its own carriage (`moonShadowFrame` on the lightning's east direction).
  - Each step, `windowLightAt(schedule, time)` sets every window light's colour and intensity. Only the player's carriage refits its frame to the direction and sets `needsUpdate` while the intensity is above 0.02.
  - `storm.flash` and `storm.bolt` feed the glass uniforms (Task 6).
  - The schedule is extended when `time` nears its end.
- **Commands:**
  - `game-loop-leaves.ts` `runLevelCommand` handles `light` by calling `runLightCommand`, which sets every lamp in the room to `{ mode, at: time }`.
  - The drain runs `expandCues` before gates and commands.
  - `pickup.flashlight` sets the target in the pickup loop.
  - LOOK gains `flashlight`: a 0.05 × 0.22 cylinder, colour 0xd8d0b0, emissive 0.5, that does not spin.
- **Seams:** `__sdfGame.lights()` returns `{ flashlight, lamps: [{room, mood, level}], windowLights, flash, shadowFrames, schedule: next bolt/sweep }`.

- [ ] Implement; run tsc; run the state tests and `npx vitest run src/lab/sdf-zombie/webgpu`; boot `night-train` headless and read `lights()` for sane values; commit.

### Task 6: The storm window (WGSL)

**Files:** Modify `train-window.ts` (`WINDOW_PRESETS` gains `storm`: speed 20, the same layer distances) and `train-window.wgsl.ts` (a new `TRAIN_STORM` fn next to `TRAIN_WINDOW`, both one fn per string); `game-train-leaves.ts` picks the storm when the level runs a storm (Night Train: always); tests.

```wgsl
fn trainStorm(wpos, eye, t, time, cfg0, cfg1, cfg2, flash: f32, bolt: vec4<f32>) -> vec3<f32>
// bolt: x = side (±1, 0 = none), y = along-track z of the bolt, z = seed, w = age (s)
```

- **Sky:** a dark storm gradient (zenith 0.012/0.014/0.02, horizon 0.03/0.034/0.045).
- **Clouds:** two octaves of value noise over (the ray's z / y at the cloud plane plus t · 0.02, height). They are lit from within by `flash`, strongest near the bolt's z: `cloud * (0.15 + 3 * flash * falloff)`.
- **Bolt:** on its side only, while age < 0.6. A jagged vertical polyline in the sky (8 segments, x offsets hashed from the seed), with one branch. Its core is white-blue, its glow falls off with distance, and it multiplies by the envelope. The WGSL recomputes the envelope from age and seed, the same as `boltEnvelope`.
- **Silhouettes:** the hills, treeline, poles and posts as today. Against the flash-lit sky they read black. Between flashes they sit on a near-black sky, so they are barely visible.
- **Rain on the glass:** streaks in the pane's own space (world y plus z along the window), falling at 1.5 m/s with hashed columns, 0.01 wide and 0.08 long, adding 0.04 plus 0.3 · flash.
- **Also** a whole-sky `flash * 0.35` wash.
- **Tests:** the WGSL string declares `fn trainStorm` and no nested `fn`, and the TS preset exists. The existing `train-window.wgsl.test.ts` pattern covers compile-shape checks. The GPU check is the gate.

- [ ] Implement, test, commit.

### Task 7: The light gate, the look check, regressions

**Files:** Create `scripts/sdf-game-light-gate.sh` and `.mjs` (on `night-train&nospawn&god`, `LAB_TMP=.lab-tmp`).

**Checks:**
1. At boot, `lights().flashlight` is 0 and the spot's intensity is 0. The van lamp's mood is `dying`.
2. Walk to the torch: the flashlight ramps to 1 within 0.5 s, the van lamp's level is 0 after 1.5 s, and `pickup.flashlight` and `alert.room.1` were emitted (telemetry).
3. `forceBolt(1)`: within 0.1 s the window light's intensity is above 5, `shadowFrames` rises, and after 1 s the intensity is 0 and `shadowFrames` has stopped rising.
4. A capture of the dining window during a forced bolt: the glass's mean luminance is at least 3× the mean without a bolt. Save both PNGs.
5. Walk into the sleeper blackout trigger: the sleeper lamps are 0 at +3 s and above 0 at +9 s.
6. The frame cost, A/B in one page (the train gate's method): idle within the train gate's budget (+350 draws / +12 ms over no art). During a forced bolt, report the frame time; the owner decides.

**Also:**
- **Look check:** screenshots of the hold (dark, then with the flashlight), the dining car mid-flash, a sweep and the party strobe. Show them to the owner.
- **Regressions:** the train, loop, Void, Wake, art and shorty gates, then the full suite.
- **Docs:** update TASKS.md and the hand-off. Commit.
