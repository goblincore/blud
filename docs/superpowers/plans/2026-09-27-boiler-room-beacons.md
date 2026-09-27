# Boiler Room Emergency Beacons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Boiler Room's strobe kills its lamps, two red ceiling beacons stutter on and sweep the carriage. Each beacon has hard shadows, a visible beam, a glowing housing, and lights the bodies through the shared light list.

**Spec:** `docs/superpowers/specs/2026-09-27-boiler-room-beacons-design.md`. Read it first. Background on the lighting system: `docs/dev-notes/2026-09-27-shared-light-list/notes.md`.

**Architecture:**
- **Pure logic.** The switch-on timing is a new `emergency` lamp script in `lamp-moods.ts`. The beam direction is `beaconAxis` in a new `beacon.ts`.
- **Level data.** A new level light fixture, `'beacon'`, with a `spin` rate. It is authored in the Night Train layout.
- **Runtime.** Beacons are ordinary `Lamp`s in the dynamic-light runtime with a `beacon` part, stepped next to the tubes. The strobe command arms them with the `emergency` script.
- **Shared light list.** Beacons feed the list as spot sources with a new `beacon` profile.

**Tech Stack:** TypeScript, three.js r186 WebGPU/TSL, WGSL string modules, Vitest, Python level scripts, headless-Chrome CDP gate (`scripts/sdf-game-light-gate.mjs`).

## Rules for every task

- **Port-ready.** Logic goes in pure, renderer-free modules with tests (no `three` import). Renderer-facing modules only read their output.
- **State.** State lives on `ctx` slices or inside feature modules, never as new `main()` bindings (`npx vitest run src/lab/sdf-zombie/webgpu/game-context.test.ts`).
- **Determinism.** Keep it deterministic: sim clock (`ctx.world.light.time`), seeded hashes, no wall clock.
- **Never `git stash`.** `node_modules` is symlinked, so don't reinstall.
- **Tests.** Run targeted tests only (`npx vitest run <paths>`), plus `npx tsc --noEmit`.
- **Headless only**, with `LAB_TMP=.lab-tmp`. Never use the in-app browser pane.
  - Scripts manage their own servers.
  - Never kill a server you didn't start.
  - The owner's dev server is on **5180**: leave it alone.
  - Bound long runs with timeouts.
- **WebGPU rules:**
  - Never toggle a light's `.visible`.
  - `castShadow` is decided at boot, never toggled.
  - Idle shadows use `autoUpdate = false` plus `needsUpdate`.
- **Commits.** Messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Task 1: The `emergency` script and the beacon axis (pure)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lamp-moods.ts` (the `LampScript` union, `LAMP_SCRIPT`, and `lampLevel`)
- Test: `src/lab/sdf-zombie/webgpu/lamp-moods.test.ts` (it exists; add cases)
- Create: `src/lab/sdf-zombie/webgpu/beacon.ts`, `src/lab/sdf-zombie/webgpu/beacon.test.ts`

- [ ] **Step 1: Failing tests.** Append to `lamp-moods.test.ts`:

```ts
import { LAMP_SCRIPT, lampLevel } from './lamp-moods';

describe('emergency script (Boiler Room beacons)', () => {
  const s = { mode: 'emergency' as const, at: 10 };
  const on = 10 + LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS;
  it('is dark before it is armed, and through the strobe', () => {
    expect(lampLevel('dead', null, 5, 1)).toBe(0);
    expect(lampLevel('dead', s, 10.2, 1)).toBe(0);
    expect(lampLevel('dead', s, on - 0.01, 1)).toBe(0);
  });
  it('stutters on over emergencyOnS, then holds at 1 for good', () => {
    const lv: number[] = [];
    for (let t = on; t < on + LAMP_SCRIPT.emergencyOnS; t += 0.01) lv.push(lampLevel('dead', s, t, 1));
    expect(lv.some(v => v === 0)).toBe(true);
    expect(lv.some(v => v > 0)).toBe(true);
    expect(lampLevel('dead', s, on + LAMP_SCRIPT.emergencyOnS + 0.01, 1)).toBe(1);
    expect(lampLevel('dead', s, on + 600, 1)).toBe(1);
  });
  it('is deterministic per seed', () => {
    expect(lampLevel('dead', s, on + 0.05, 3)).toBe(lampLevel('dead', s, on + 0.05, 3));
  });
});
```

Create `beacon.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BEACON, beaconAxis } from './beacon';

describe('beaconAxis', () => {
  it('is a unit vector tilted BEACON.tilt below horizontal', () => {
    const a = beaconAxis(1.3, 0.7, 0);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(1, 6);
    expect(Math.asin(-a[1])).toBeCloseTo(BEACON.tilt, 6);
  });
  it('turns spin revolutions per second, sign = direction', () => {
    const a0 = beaconAxis(0, 0.5, 0), a1 = beaconAxis(1, 0.5, 0);   // half a turn
    expect(a1[0]).toBeCloseTo(-a0[0], 6); expect(a1[2]).toBeCloseTo(-a0[2], 6);
    const cw = beaconAxis(0.25, 1, 0), ccw = beaconAxis(0.25, -1, 0);
    expect(cw[2]).toBeCloseTo(-ccw[2], 6);   // a quarter turn each way: z flips
  });
  it('phase offsets the sweep', () => {
    const a = beaconAxis(0, 1, Math.PI / 2), b = beaconAxis(0.25, 1, 0);
    expect(a[0]).toBeCloseTo(b[0], 6); expect(a[2]).toBeCloseTo(b[2], 6);
  });
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/lab/sdf-zombie/webgpu/lamp-moods.test.ts src/lab/sdf-zombie/webgpu/beacon.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `lamp-moods.ts`:
  - Add `| { mode: 'emergency'; at: number }` to `LampScript`.
  - Add `emergencyOnS: 0.3` to `LAMP_SCRIPT`, with a comment: "emergency: dark through the strobe (surgeS + strobeS), then a stutter on over emergencyOnS, then 1 for good".
  - Add a case to `lampLevel`'s switch:

```ts
    case 'emergency': {
      const k = age - (LAMP_SCRIPT.surgeS + LAMP_SCRIPT.strobeS);
      if (k < 0) return 0;
      if (k >= LAMP_SCRIPT.emergencyOnS) return 1;
      return hash01(s + 29, Math.floor(k / 0.04)) < 0.45 + 0.55 * (k / LAMP_SCRIPT.emergencyOnS) ? 1 : 0;
    }
```

Note on ordering: `lampLevel` returns `base` (the mood level) when `t < script.at`. A beacon's mood is `dead`, so it is 0 before arming.

Create `beacon.ts`:

```ts
// src/lab/sdf-zombie/webgpu/beacon.ts
//
// BOILER ROOM EMERGENCY BEACONS (spec 2026-09-27-boiler-room-beacons-design.md). Pure: the beam's
// direction at a time on the sim clock. A beacon hangs from the ceiling, its spot tilted BEACON.tilt
// below horizontal, turning `spin` revolutions a second about the vertical (sign = direction).

export const BEACON = {
  /** Below horizontal, rad (~35 deg). */
  tilt: 0.61,
  /** Spot half-angle (rad), penumbra, decay, reach (m). */
  angle: 0.32, penumbra: 0.35, decay: 1.2, reach: 9,
  /** Emergency red. */
  color: [1.0, 0.08, 0.05] as [number, number, number],
  /** Spot intensity per unit of the lamp's power (like TUBE_SPOT_GAIN). */
  spotGain: 7,
  /** Hard, low-res shadows (owner: quality can be sacrificed). */
  shadowSize: 512,
  /** The beam's strength (the tube beam's is 0.035). */
  beam: 0.05,
} as const;

export type Vec3 = [number, number, number];

export function beaconAxis(t: number, spin: number, phase: number): Vec3 {
  const a = phase + t * spin * Math.PI * 2;
  const c = Math.cos(BEACON.tilt);
  return [Math.cos(a) * c, -Math.sin(BEACON.tilt), Math.sin(a) * c];
}
```

The test "phase offsets the sweep" pins `phase = π/2` to equal a quarter turn at spin 1. That holds with `a = phase + t·spin·2π`.

- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): emergency lamp script and the beacon sweep (pure)"`

---

## Task 2: `fixture: 'beacon'` in the level format, authored for the Boiler Room

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-level.ts:53-61`. On `AccentLight`, make `fixture?: 'bulb' | 'tube' | 'beacon'`, and add `spin?: number` with the doc "rev/s about the vertical, sign = direction (beacons)".
- Modify: `src/lab/sdf-zombie/webgpu/level-json.ts`:
  - `:42`: add `'spin'` to the `light` key list;
  - `:340-357`: accept `'beacon'`, parse `spin` as a finite number with |spin| ≤ 5, reject otherwise in the existing error style, and spread it onto the accent.
- Modify: `src/lab/sdf-zombie/webgpu/game-state-lighting.ts` (the `flickerLights` record type). Its `fixture` field gains `'beacon'`, and it gets `spin?: number`.
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`, where accents become `flickerLights` (about lines 794-830). Carry `spin` through. Read how `fixture: 'tube'` creates the tube fixture mesh there: a beacon must **not** get the tube fixture mesh (Task 3 builds its own housing).
- Modify: `scripts/levels/night_train_layout.py`:
  - add a `beacons` list per carriage: `(x, u, y, spin)` in the carriage frame;
  - for the Boiler Room (rid 5): `beacons=[(0.0, 4.0, 3.3, 0.7), (0.0, 14.0, 3.3, -0.7)]`, with y just under the 3.4 m ceiling;
  - emit each as `{"pos": [x, y, g(u)], "color": [1.0, 0.08, 0.05], "power": 2.4, "mood": "dead", "fixture": "beacon", "spin": spin}`;
  - carriages without the key get `beacons=[]` via `c.get("beacons", [])`;
  - draw them in the SVG as a red ◆ labelled "beacon".
- Modify: `scripts/levels/build_night_train.py` (`glight`, about line 91), and `scripts/levels/export_level.py` (about line 294). Carry `spin` like `fixture`.
- Regenerate: `public/assets/levels/night-train.level.json` through the real pipeline.
  - Read `docs/game/levels/01-night-train/layout.md` and the build scripts' headers to find the exact commands. It is the layout script's `--json`, then possibly Blender through `build_night_train.py` + `export_level.py`.
  - If Blender is needed and unavailable headless, apply the same two light entries to the JSON by hand. Keep the field order and formatting of the neighbouring lights, and say so in the commit message.
- Test: `src/lab/sdf-zombie/webgpu/level-json.test.ts` and `src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `level-json.test.ts`:
    - a light with `"fixture": "beacon", "spin": 0.7` parses to an accent with `fixture: 'beacon', spin: 0.7`;
    - `"spin": 9` is rejected with `lights[0].spin`;
    - `"fixture": "lamp"` is still rejected, with the message updated to "must be bulb, tube or beacon".
  - `level-json.night-train.test.ts`: the shipped level has exactly two beacon accents in room 5. Their spins are 0.7 and −0.7, and both have mood `dead`.
- [ ] **Step 2: Run them.** `npx vitest run src/lab/sdf-zombie/webgpu/level-json.test.ts src/lab/sdf-zombie/webgpu/level-json.night-train.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the parse, the types, the scripts, and the regenerated JSON.
  - `git diff public/assets/levels/night-train.level.json` must show only the two new light entries.
  - If the regeneration reorders or renumbers anything else, stop and report it.
- [ ] **Step 4: Run** those tests plus `npx tsc --noEmit`. Expected: PASS. At this point the game treats the beacons as dead point lamps, so nothing visible changes.
- [ ] **Step 5: Commit.** `git commit -m "feat(level): beacon light fixture (spin) — two in the Boiler Room"`

---

## Task 3: The beacon runtime (light, shadow, beam, housing, arming)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.ts`:
  - the `Lamp` type (about line 53) gains `beacon: Beacon | null`;
  - add a new `makeBeacon` next to `makeTube` (about line 188);
  - `createDynamicLight` (about line 98): build a beacon for flickerLights with `fixture === 'beacon'`;
  - `stepDynamicLight` (about lines 320-360): step it;
  - `runLightCommand` (about line 271): strobe arms beacons as `emergency`;
  - `adoptLightFx` (about line 236): move the beacon beams to the late scene too.
- Test: `src/lab/sdf-zombie/webgpu/game-dynamic-light-leaves.test.ts` if it exists; otherwise add a pure test for the arming rule, as below.

**What to build.** Follow `makeTube` line by line: the SpotLight settings, the shadow set-up, `SHADOW_HULL_LAYER`, `userData.onlyRooms`, and the beam built from `TUBE_BEAM_WGSL` with the shared `beamFn`.
- **Spot.**
  - Settings: `new THREE.SpotLight(color, 0, BEACON.reach, BEACON.angle, BEACON.penumbra, BEACON.decay)`, named `train.beacon-spot:${room}`, at the accent's position.
  - Shadows: `castShadow = true` at boot, mapSize `BEACON.shadowSize`, `autoUpdate = false`.
  - Shadow camera: near 0.15, far `BEACON.reach`.
  - Layers and rooms: `shadow.camera.layers.enable(SHADOW_HULL_LAYER)`, `userData.onlyRooms = new Set([room])`.
  - Group: add it to the same group as the tubes (`tubeGroup`, so `applyRig` doesn't zero it).
- **Beam.**
  - Geometry: an open cone of length `BEACON.reach * 0.6` and radius `tan(BEACON.angle) × length`, translated so its apex is at the origin and it points along −Y.
  - Orientation: each step, the beam's quaternion rotates −Y onto `beaconAxis(...)` (`setFromUnitVectors`).
  - Colour and strength: `BEACON.color`, `cfg.z = BEACON.beam`, `cfg.x` = the level.
- **Housing.** A small dome: `SphereGeometry(0.12, 12, 6, 0, 2π, 0, π/2)` flipped to hang down. It uses `MeshStandardNodeMaterial` with a red emissive, so it is lit and glows, and it must not be hidden by the deferred router; see the warning in notes about `MeshBasicNodeMaterial` in levelGroup. Its `emissiveIntensity` is `BOWL_EMISSIVE × level`. Put it at the accent's position.
- **Omni.** The accent's own PointLight (the Lamp's `light`) stays at intensity 0 for beacons. The spot is the light.
- **Phase.** Each beacon gets `phase = hash01(seed, 7) × 2π`, so the two don't sweep in lockstep.

**Stepping.** In `stepDynamicLight`'s lamp loop:

```ts
    if (l.beacon) {
      const bc = l.beacon;
      l.light.intensity = 0;
      bc.spot.intensity = l.base * BEACON.spotGain * l.level;
      const ax = beaconAxis(t, bc.spin, bc.phase);
      bc.spot.target.position.set(bc.pos.x + ax[0] * 3, bc.pos.y + ax[1] * 3, bc.pos.z + ax[2] * 3);
      bc.spot.target.updateMatrixWorld();
      bc.beam.quaternion.setFromUnitVectors(DOWN, scratchAxis.set(ax[0], ax[1], ax[2]));
      bc.beamLit.value.x = l.level;
      bc.housing.emissiveIntensity = BOWL_EMISSIVE * l.level;
      // Rotating: re-render its shadow every frame, but only while it is on and the player is in its room.
      if (l.room === here && l.level > 0) bc.spot.shadow.needsUpdate = true;
    }
```

`DOWN` and `scratchAxis` are module-level `THREE.Vector3`s, so nothing is allocated per frame. Make sure the tube branch's `l.light.intensity = l.base * l.level * (...)` does not overwrite the beacon's 0: order the branches, or fold the beacon case into that expression.

**Arming.** In `runLightCommand`, give beacons the `emergency` script when the command is `strobe`. Other commands (`die`, `blackout`) apply to them as usual.
- Put the mapping in a pure exported helper, `scriptFor(mode, isBeacon)`, and test it.
- If `LightMode` is a string union in `level-events.ts`, `emergency` does **not** need to become an authorable command. It is internal only.

```ts
export function scriptFor(mode: LightMode, isBeacon: boolean): LampScript['mode'] {
  return isBeacon && mode === 'strobe' ? 'emergency' : mode;
}
// in runLightCommand:
for (const l of rt.lamps) if (l.room === room && l.mood !== 'fire') l.script = { mode: scriptFor(mode, !!l.beacon), at: rt.time };
```

**The `lights()` seam.** Add `beacon: !!l.beacon` to each lamp row, and a top-level `beacons: rt.lamps.filter(l => l.beacon).map(l => ({ room: l.room, level: l.level, axis: [...] }))`, where the axis comes from the spot's target minus its position, normalised.

- [ ] **Step 1: Failing tests.**
  - `scriptFor`: strobe on a beacon gives emergency, strobe on a tube gives strobe, die on a beacon gives die.
  - If there's a pure place for it, a test that `lampLevel('dead', {mode:'emergency', at}, …)` drives the spot intensity: `base × spotGain × level`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Check.**
  - `npx vitest run src/lab/sdf-zombie/webgpu/lamp-moods.test.ts src/lab/sdf-zombie/webgpu/beacon.test.ts src/lab/sdf-zombie/webgpu/game-context.test.ts src/lab/sdf-zombie/webgpu/game-state-lighting.test.ts` (plus any new test file), then `npx tsc --noEmit`.
  - Headless smoke: `LAB_TMP=.lab-tmp bash scripts/sdf-game-light-gate.sh` must PASS. Its section 6 crosses the Boiler Room threshold, so after it the beacons are armed. Add the beacon rows to section 6's pass line (count, levels) and assert that two beacons exist in room 5.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): Boiler Room beacons — rotating red spots with shadows, beams and housings, armed by the strobe"`

---

## Task 4: Bodies pick the beacons from the shared list

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/light-profiles.ts`:
  - `PROFILE_ID` gains `beacon: 6`;
  - `PROFILES_BY_NAME.beacon` copies the tube's calibrated profile, with `rimTint: [1.3, 0.2, 0.15]` and `backRim` 2.5.
  - The table has 8 slots and this uses the 7th. `MAX_PROFILES` stays 8.
- Modify: `src/lab/sdf-zombie/webgpu/light-list.ts`: `ProfileName` includes `'beacon'` through `PROFILE_ID`.
- Modify: `src/lab/sdf-zombie/webgpu/game-light-list-leaves.ts`, in the lamp reader (about line 161 and the tube spot handling). For a lamp with `beacon`:
  - emit **one** spot source (profile `beacon`) from the beacon spot's world position, axis, cone, colour and intensity;
  - range = `spot.distance`, `rooms: [l.room]`, `refIntensity = l.base × BEACON.spotGain`.
  - The dead omni emits nothing: it is at intensity 0 and the list drops it anyway.
- Tests: `light-profiles.test.ts`, `game-light-list-leaves.test.ts`.

- [ ] **Step 1: Failing tests.**
  - The profiles list has 7 names in id order, with `beacon` at 6, and its `rimTint` is red.
  - `collectLightSources` turns a beacon lamp into `spot:beacon` with the given axis and ref.
  - A pick test: a body under a sweeping beacon, with the axis pointing at the body's feet, gets it as the dominant light.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The shader needs no change: `bodyLights` reads the profile by id from the packed table.
- [ ] **Step 4: Run** the light tests (`light-profiles`, `light-list`, `light-pick`, `light-shade`, `game-light-list-leaves`, `march/body-lights.wgsl`), plus `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git commit -m "feat(light): beacons in the shared light list (beacon profile, red rim)"`

---

## Task 5: Gate, contact sheet, cost, march-hash, docs

**Files:**
- Modify: `scripts/sdf-game-light-gate.mjs`, adding a new section "BEACONS".
- Create: `docs/dev-notes/2026-09-27-boiler-room-beacons/`, with `notes.md` and the sheets.
- Modify: `scripts/march-hash.mjs` pins (re-pin).
- Modify: `TASKS.md` and `docs/tasks/levels.md` (or wherever Night Train level tasks live; read first).

- [ ] **Step 1: Gate section.**
  - Boot Night Train with clocks pinned, as section 7 does, and stand in the Boiler Room just before the threshold.
  - Assert both beacons are at level 0.
  - Cross the threshold and step the sim clock past `surgeS + strobeS + emergencyOnS`. Both beacons must reach level 1.
  - Assert the axis changes between two sim times, by more than 20°.
  - A Boiler Room body's picks (`bodyPicks()`) include a light whose profile is `beacon`. Frame a dancer, and step the clock until a beam faces them if needed.
  - `shadowFrames` rises while the beacons are on.
  - Print one pass line with the numbers.
- [ ] **Step 2: Contact sheet for the owner.** The Boiler Room after the strobe, at 4 sim times a quarter-turn apart, with dancers and steam in view. Save it as `beacons-sweep.png`. **Look at it.**
- [ ] **Step 3: Cost.** Run the gate's cost section (`LIGHT_GATE_ONLY_COST=1`) with the Boiler Room pose after the beacons are armed. If needed, add a query or pose knob so the cost section arms them first.
  - Report the median frame and GPU on−off against the budget, **and** beacons on versus off. For the second comparison, add a seam to force the beacons' level, `setBeaconsOn(on)` for measurement only, or compare before and after the strobe.
  - If the two shadow passes push the Boiler Room over the +1.5 ms budget, **report the numbers. Do not drop the shadows.**
  - Measure at a 1-minute load under 4 (the gate waits for it).
- [ ] **Step 4: Re-pin march-hash.** `node scripts/march-hash.mjs`, following its header. Check that all modes are deterministic (3 boots each), update the pins, and say why they moved (the level changed).
- [ ] **Step 5: Docs.**
  - Notes: what shipped, the numbers, the sheet, and any deviations.
  - `TASKS.md` front page: one line.
  - The levels area page: the detail.
  - Check with `wc -l` and `tail` that nothing was truncated.
- [ ] **Step 6: Run** `LAB_TMP=.lab-tmp bash scripts/sdf-game-light-gate.sh` in full. Expected: PASS.
- [ ] **Step 7: Commit.** `git commit -m "test(light): beacon gate, sweep sheet, cost, march-hash re-pin; docs"`

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §1 the beat (the strobe arms them, stutter on, hold) | 1 (`emergency`), 3 (arming) |
| §2 placement (two, u 4 / u 14, opposite spin) | 2 |
| §2 light, tilt, spin, onlyRooms, hard shadows every frame while on and in the room | 3 |
| §2 beam, housing | 3 |
| §2 shared list, `beacon` profile | 4 |
| §2 sim clock, never toggle `.visible`, castShadow at boot | 1, 3 |
| §3 level format reusable | 2 |
| §4 tests, gate, sheet, cost (report, don't drop), march-hash | 1–5 |
