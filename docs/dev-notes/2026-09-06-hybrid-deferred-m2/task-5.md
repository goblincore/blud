# M2 Task 5 — Wire the opt-in playable game and its frame composition

**Status: continuation complete (recovered from the 50-minute timeout of the first run).**
Branch `codex/dispatch/2026-09-06-hybrid-deferred-m2-task-5-continue-1`, head
`1fbf1283` (2026-09-07). Legacy remains the default renderer; nothing is
pushed or merged. This report covers task 5's own acceptance; the MILESTONE
IS NOT COMPLETE — tasks 6 (producer/lifecycle GPU gate) and 7 (shadow/effect
visual gate + measurements) are still ahead of it, and a composition
correction is queued before task 6 (see "Remaining review blockers").

## What landed, in order

| commit | content |
| --- | --- |
| `b0f0bff7` | `game-deferred-renderer.ts` coordinator + boot-mode/environment adapter tests (first run) |
| `33aa77f5` | `game-main.ts` integration: `?renderer=deferred` opt-in, character GPU passthrough, actor world kit/prop groups, bone/chunk/baked surface options, shared lights |
| `9b50f668` | stamp `surfaceKind` on bone-instancer and baked-chunk surface MATERIALS — the task-3 router reads the material, not the factory handle; before this fix both producers were hidden as unsupported |
| `6aa7406d` | forward the coordinator's output target to the layer (`setOutputTarget`), drop the unused legacy cone input — the game stopped rendering a black opaque canvas |
| `ab8f2d5c` | saved probes/captures from the timed-out first run (evidence only) |
| `866e5d93` | **flashlight march-key conversion + flesh highlight shoulder** in the deferred lit pass; router-eligibility regressions for bone/baked materials (see below) |
| `1fbf1283` | **calibrated default gain (`GAME_DEFERRED_LIGHT_GAIN = 0.5`)** + strengthened boot driver (pixel coverage, camera-facing asserts, calibration band, capture manifest) |

## The light conversion — exact constants and why

### The problem the gain sweep could not solve

The first run's evidence: flesh ROI ~112 (deferred) vs ~51 (legacy) at gain 1,
and a gain sweep 1.0→0.2 that never restored wound detail. This continuation's
faced-pose captures (camera actually looking at the wounded zombie) proved the
blowout is **not an exposure problem**: the beam-centre torso stays pinned
white at gains 1.0 / 0.7 / 0.5 nearly unchanged, because the two engines use
different falloff families for the same flashlight:

- **legacy march (bodies):** `march.wgsl.ts` — `beam = coneFall² × (1 − d/16)²`
  (linear-to-range window, **no inverse square**), `keyI = beam ×
  beamTuning.gain(=4)`, plus a **highlight shoulder** `softShoulder(fleshLit,
  knee = 1 − 0.35)` applied to the flesh lit sum. The march's own comment
  names the invariant: a hard-clipped body DELETES its wounds — crater, lip
  and clean skin all clamp to the same white exactly when the player is close
  enough to aim.
- **deferred lit pass (everything):** `intensity × window² / d²` with three's
  physical flashlight intensity **90** passed through unchanged. At 1.8 m that
  is ~27.8 vs the march's ~3.1 — ~9× over, saturating at every gain ≥ 0.5.

No scalar gain reconciles `d⁻²` with `(1 − d/16)²`: gain 0.057 fixes 1.8 m
flesh but drives a 6 m body ~15× darker than legacy. Per the task's
instruction ("if clipping/detail persists after gain, investigate
source-specific surface/normal/BRDF evidence"), the fix is the conversion:

### The fix (commit `866e5d93`)

**Two receiver models share one packed light.** The deferred light record
(`deferred-lighting.ts`, packed layout documented in its header) gains two
optional fields, packed into the previously reserved floats:

- `fleshKeyIntensity` (v3.z, float o+14): when > 0, **flesh-class receivers**
  evaluate this slot as `key × window²` — the march's linear window, no
  inverse square. Every other class (walls, floors, kit meshes) keeps the
  packed physical intensity under bounded inverse-square. Bodies were authored
  under the march; the level was authored under three — one light record now
  carries both models.
- `fleshShoulderKnee` (v3.w, float o+15): when > 0, the flesh lit sum
  EXCLUDING emission is compressed with the march's `softShoulder` curve
  (identity below the knee, monotonic `[knee, ∞) → [knee, 1)` above it, so
  differing flesh texels stay differing inside the beam). Multiple
  shoulder-carrying slots collapse to the strongest knee (in practice exactly
  one). Emission is excluded the same way the march adds glow after the
  shoulder.

Defaults are 0 = feature off = **bit-identical to the pre-task-5 evaluation**,
which is what every M1 fixture pins. Both fields are validated in
`packDeferredLights` (finite, key ≥ 0, knee ∈ [0, 0.95)).

The game stamps exactly one slot — the flashlight — through
`buildGameDeferredLights(..., { intensityScale, flashKey })`, with
`flashKey` supplied by `game-main` as a **live getter** over its existing
`beamTuning` (`{ gain: 4, shoulder: 0.35 }` → knee `0.65`), so
`__sdfGame.setBeamTuning` moves the legacy march and the deferred path
together and the constants cannot drift apart. The exposure knob
(`setDeferredLightGain` → `intensityScale`) multiplies the physical intensity
AND the stamped key gain, so it moves both receiver models together. Muzzle
and practicals carry no stamp: they stay physical-model (a muzzle flash
saturating flesh white for its ~100 ms life is in-family; task 6/7 calibrate
the flash beat).

Magnitude default (commit `1fbf1283`): `GAME_DEFERRED_LIGHT_GAIN = 0.5` in
`game-deferred-renderer.ts`. With the family fixed, the remaining scalar
question was decided by matched captures (below), not by matching overall
brightness.

## Calibration evidence

Commands (private ports; the shell wrapper owns/stops only what it starts):

```
LAB_VITE_PORT=5346 LAB_CDP_PORT=9346 scripts/deferred-game-boot-check.sh
```

Matched deterministic framing: camera 1.8 m east of a room-2 zombie, yaw from
the page's own convention (`atan2(dx, −dz)`), pitch −0.12, frozen wanderers,
hand-stepped; blast, then capture. ROI statistics decoded in-page
(`task5-cal2-gain{1,0.7,0.5}-faced-wounded.png` vs
`task5-cal2-legacy-faced-wounded.png`):

| state | torso RGB (clip %) | face RGB (clip %) | lit wall | dark wall |
| --- | --- | --- | --- | --- |
| legacy | 171,128,131 (0.7 %) | 139,100,103 (0.1 %) | 34,33,34 | 12,8,6 |
| gain 1.0 | 175,168,169 (**32.4 %**) | 186,176,177 (**40.5 %**) | 42,40,41 | 17,15,15 |
| gain 0.7 | 172,158,159 (9.0 %) | 182,166,167 (15.4 %) | 36,35,36 | 15,14,15 |
| **gain 0.5 (shipped)** | 167,144,145 (**1.1 %**) | 177,153,153 (**3.3 %**) | 31,31,32 | 14,13,14 |

Gain 0.5 matches legacy on clip class (1.1 % vs 0.7 %), torso mean (167 vs
171), lit wall (0.9×), dark wall (parity) — while preserving the authored
pink/red saturation, which gain 1.0 washed to white. Verified live in the boot
driver at the shipped default: torso clip 1.2 %, R−G saturation 26 (legacy
0.6 % / 27).

## Boot driver strengthening (`scripts/deferred-game-boot-check.mjs`)

The first version passed ten diagnostics checks while the composite was a
black opaque canvas, and its wounded capture faced +Z with the actor 1.2 m to
the WEST. Diagnostics alone are not visual evidence. The driver now:

1. **Aims every capture** at its subject (page yaw convention) and asserts the
   subject is IN FRAME through the new `__sdfGame.screenPosOf(x, y, z)` seam —
   a projection through the LIVE game camera (`|ndc| ≤ 0.9`, in front).
2. **Decodes every screenshot in-page** and asserts actual pixel coverage:
   frame ≥ 8 % non-dark (the black-canvas guard; the real composite reads
   83–92 %), lit-centre floors for actor shots, and for the wounded capture a
   torso clip band (≤ 3.5 %) that rejects the wound-deleting blowout (the old
   frame clips 32 % there) together with a mean floor.
3. **Pins the conversion from diagnostics**: `lights.flashKey` must equal
   `{ fleshKeyIntensity: 2, fleshShoulderKnee: 0.65 }` (beamGain 4 × shipped
   gain 0.5) and `lightGain === 0.5`.
4. Records a per-capture state manifest (pose, screen position, pixel stats)
   into `task5-boot-check.json`.

Result: **12/12 checks PASS** (boot deferred/legacy, diagnostics,
flashkey-conversion, boot-frame-coverage, soldier, wounded, goblin kit/face,
detached chunk, sampling-toggle, generation-toggle, unknown-renderer-value),
no page/GPU errors, both modes, shadow generation vs sampling counters
distinct (2 maps render with sampling off; 0 with generation off).

## Captures inspected (human-viewed, not just numeric)

All in `docs/dev-notes/2026-09-06-hybrid-deferred-m2/`, regenerated from the
fixed tree at the shipped gain:

- `task5-deferred-wounded.png` — wounded zombie centred and legible: face
  (eyes, jaw), formed hands, wound pockmarks along the arm, torso blast
  craters, the body's SHADOW on the wall behind it (task-4 flashlight shadows
  working in-game). Compare `task5-cal2-legacy-faced-wounded.png`.
- `task5-deferred-goblin.png` — generated face sheet rendering (red glowing
  eyes, beard, ear), flesh routed. Kit registered (router mesh 199→200) but
  kit PIECES are not clearly identifiable in this frame — the known
  owner-deferred kit-load race (TASKS.md F-kit-load-race) is the suspect;
  face evidence is the acceptance target here and it passes.
- `task5-deferred-soldier.png` — pauldron kit, baked angry face, the BLACK
  held shotgun prop, fire practical glowing on the crate, wall shadow.
- `task5-deferred-chunk.png` — severed head mid-flight (a flesh chunk with a
  face), blood particle field, torso crater, two spent shells mid-air — the
  detach/blood evidence in one frame; router sdf count incremented.
- `task5-deferred-{boot,sampling-off,gen-off}.png`, `task5-legacy-wounded.png`
  — mode/toggle evidence, all non-trivial composites.

## Verification

- `npx tsc --noEmit` — clean.
- Focused Vitest (`NODE_OPTIONS=--no-experimental-webstorage`, workers 2/1):
  **187/187 pass** across deferred-lighting/layer/surface/mesh/shadows,
  game-deferred-lights/renderer/scene, bone-instancer, baked-chunks.
  New regressions: packing/validation/zeros for the two packed fields;
  flashlight-only stamping (muzzle/practicals unstamped); gain scales the key
  gain; router eligibility (`materialEligibility`, now exported) admits real
  bone/baked surface materials through the ACTUAL material — not the factory
  handle — with an unstamped `MeshBasicNodeMaterial` still rejected.
- GPU: 12/12 boot checks above on private ports 5346/9346, bounded CDP,
  owned cleanup; no other tasks' ports touched.

## Remaining look differences (precise)

1. **Face decal brightness**: deferred faces read brighter than legacy (face
   ROI 177,153 vs 139,100). The march relights the baked face decal with a
   fixed favourable diffuse (0.30 factor + 0.85 mix); the deferred path shades
   it as regular flesh. In-family, but visible.
2. **Flesh BRDF omissions**: the deferred flesh branch has wrapped diffuse +
   capped specular, but not the march's AO, wShadow, scatter/backlit, or wet
   terms. Deferred flesh sits slightly paler than legacy at equal clip.
3. **Muzzle flash on flesh** stays on the physical model (no key stamp): a
   flash blows flesh white for its brief life. The legacy borrow made it a
   hot key. Task 6/7 calibrate the flash beat from captures.
4. **Off-beam level** reads slightly brighter in deferred than legacy at the
   same gain (the deferred pass does not divide by π the way three's standard
   material does); within the dark-dungeon requirement, worth revisiting only
   if the owner objects.
5. **Goblin kit visibility** in captures is weak (kit routed, pieces not
   identifiable) — the owner-deferred kit-load race, not a router defect.

## Remaining review blockers — queued correction (NOT done here)

`2026-09-06-hybrid-deferred-m2-game-composition-review-fix` (queued by the
coordinator after this continuation, before task 6) owns:

- correct shared hardware depth when ALL postprocessing is off (the M1 null
  canvas present is intentionally depthless);
- explicit deferred routing for opaque first-person gun/arms/shells, with
  blended effects forward;
- actual gun/hand tuning coverage;
- behavioural coordinator target/depth tests.

Task 5's own continuation scope is complete; overall game integration remains
provisional pending that correction and the task-6/7 gates. **The milestone is
not complete**: tasks 6 and 7 are unexecuted, the coordinator's final full
suite/build and the owner playtest are outstanding, legacy stays the default
renderer, and nothing is merged to main.

Reproduce the deferred game locally: `npm run dev` (or the lab servers) then
open `http://localhost:<port>/sdf-game.html?renderer=deferred`.
