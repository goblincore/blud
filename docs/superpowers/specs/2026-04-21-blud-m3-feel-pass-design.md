# Blud M3 — One-Kill Feel Pass

**Status:** design approved 2026-04-21 · author: claude + donny

**Milestone goal:** make the single-kill loop in the crypt-stone arena feel *great*, not just correct. M3 is the polish foundation that M4 (arsenal) and M5 (bestiary) ride on. The Phase 1 gate at end of M5 — "30 min in the arena must feel fun" — depends on M3 landing the audio system, post-fx system, gib taxonomy, and weapon-FSM pattern as generalizable foundations.

## Scope

### In scope

- **Track 1 — Throw fidelity:** full Blood weapon FSM port (raise → ignite → cook → throw), visible projectile tumble, explosion sprite fix
- **Track 2 — Gib flavor:** bone variants (~20% of chunk spawns) + `GibProfile` interface for per-enemy death customization
- **Track 3a — Audio:** 10-event SFX vocabulary + 2-layer ambient bed, ripped from BLOOD.RFF (dev-only placeholders, ship-replaced in M8)
- **Track 3b — Post-processing (full clay stack):** Bayer 8×8 dither, BLOOD.PAL palette snap, damage-driven chromatic aberration, vignette, film grain, toggleable CRT scanlines + barrel distortion

### Out of scope (confirmed)

- Hit flash on player damage — disruptive per playtest
- Self-gib overlay polish — low priority
- Music bed — deferred to M8
- Weapon pickup sounds — M4
- Enemy damage to player (beyond self-gib) — M5
- Clay-proper vertex effects — incompatible with sprite-based enemies
- Scanlines/barrel as default-on — included as toggles only

### Budget target

1–2 weeks. If we overrun, **audio stays, post-processing gets trimmed** — audio is infrastructure that unblocks later milestones; post-fx is A/B-testable polish.

## Track 1 — Throw fidelity

### Weapon FSM port

Current 3-state (`IDLE` / `COOKING` / `THROWING`) replaced by 5-state to match Blood's `processTNT` (weapon.cpp:2141):

| Phase | QAV ID | QAV name | Duration | Behavior |
|---|---|---|---|---|
| `RAISING` | 18 | `tnt-raise-normal` | ~0.3s | Animation; fuse unlit; cook timer NOT started |
| `IGNITING` | 5 | `lighter-ignite` | ~0.4s | Lighter strikes; at last frame, fuse lights & cook timer starts |
| `COOKING` | (held idle tail) | sparking fuse | variable | Charge ramps; self-gib on over-cook |
| `THROWING` | 23 | `throw-bundle` | ~0.3s | Projectile spawns on impact frame, not start |

**Cook timer starts at IGNITING→COOKING transition**, not on press — matches Blood's sequencing.

**Edge case:** press-and-release during RAISING (before fuse lit) is a no-op that returns to IDLE without throwing. Matches Blood; feels faithful.

### Projectile tumble

Current `mesh.lookAt(projectileCamera.position)` hides the physics body's angular velocity. Fix: keep the plane camera-facing for readability but spin it around the camera-forward axis, with spin rate derived from the projection of the body's angular velocity onto that axis. Visible tumble while remaining legible.

Rejected alternative: full 3D-oriented billboard (no `lookAt`, use body rotation). Goes edge-on periodically; becomes invisible. Breaks readability.

### Explosion sprite investigation

Playtest reported the current explosion sprite looks distorted / wrong scale / wrong graphic. Diagnosis plan (not design — implementation approach):

1. Check current picnums in `explosion-placeholder/manifest.json` vs Blood's actual `kExplosionStandard` atlas
2. Check `ExplosionVfx` render code — plane aspect + world-space scale
3. Check frame advance rate against Blood's SEQ for explosions
4. Check if the sRGB color-space fix exposed a pre-existing aspect/atlas mismatch

Budget: ~1h. If it turns into a rabbit hole, stop and re-scope.

### Files touched (Track 1)

- `src/game/weapons/dynamite.ts` — FSM refactor, cook-timer relocation, projectile tumble
- `src/game/weapons/dynamite.test.ts` — FSM transition tests, press-during-raise edge case
- `src/animation/fp-weapon-animator.ts` — possibly extend for QAV chaining
- `src/vfx/explosion.ts` + `public/assets/vfx/explosion-placeholder/` — explosion fix

## Track 2 — Bone gib variants

### Two-tier gib spawn with bone bias

**Tier 1 — Flesh-dominant (~80%)** — existing 2154–2158 chunk spray + body parts per Blood's `gibHuman[]` defaults.

**Tier 2 — Bone variants (~20%, new)** — 3–4 clean-bone picnums from Blood's decorative pool (candidates around tiles000–003 wall-decoration range + `kThingBone` picnum 421). Tagged `gib_variant: "bone"` in the manifest. Minority status makes them feel earned rather than constant.

### `GibProfile` interface — infrastructure for M5

```ts
// src/game/gibs/tuning.ts
export interface GibProfile {
  fleshWeight: number;       // 0-1 probability of flesh chunks per roll
  boneWeight: number;        // 0-1 probability of bone pieces per roll
  bodyPartCount: { min: number; max: number };
  chunkCount: { min: number; max: number };
}

export const ZOMBIE_GIB_PROFILE: GibProfile = {
  fleshWeight: 0.8, boneWeight: 0.2,
  bodyPartCount: { min: 2, max: 4 },
  chunkCount: { min: 8, max: 14 }
};
```

Profile attached to each enemy type at dude-register time. `GibSystem.explodeDude()` reads the profile for spawn counts + weights. M3 wires the zombie profile; M5 enemies plug in without refactoring.

### Files touched (Track 2)

- `scripts/extract_blood_sprites.py` — run against tiles000–003 to scout bone picnums
- `public/assets/gibs-placeholder/` — add bone PNGs + manifest update
- `src/game/gibs/tuning.ts` — `GibProfile` type + `ZOMBIE_GIB_PROFILE`
- `src/game/gibs/chunks.ts` — profile-driven weighted pick between tiers
- `src/game/enemy/axe-zombie.ts` — declare gib profile

### Tests (Track 2)

- `spawnGibs(profile, rng)` returns correct ratios given seeded RNG (10k rolls, 80/20 within tolerance)
- `bodyPartCount`/`chunkCount` min/max respected

## Track 3a — Audio

### Architecture

Three.js `AudioListener` on camera + `PositionalAudio` for 3D-located sounds; Web Audio directly for 2D stuff (ambient, player-attached).

```
src/audio/
├── engine.ts          // AudioContext, listener, master gain, sfx/ambient buses
├── sfx-registry.ts    // event-id → AudioBuffer; silent fallback on missing
├── sfx.ts             // play(eventId, pos?)
├── ambient.ts         // looping bed + random-interval one-shots
└── events.ts          // typed event-ID vocabulary
```

Bus layout: master → [sfx, ambient]. Separate gain per bus future-proofs settings menu.

### Event vocabulary (10 events)

| # | Event | Trigger | Pos? | Blood SFX candidate |
|---|---|---|---|---|
| 1 | `LIGHTER_STRIKE` | IGNITING phase entry | 2D | ~431 (cigar lighter) |
| 2 | `FUSE_HISS` (loop) | COOKING phase | 2D | 441 |
| 3 | `THROW_GRUNT` | THROWING phase | 2D | 455 |
| 4 | `DYNAMITE_BOOM` | Explosion detonation | P | 304/305 |
| 5 | `GIB_SPLAT` | Chunk spawn (throttled) | P | 508/509 |
| 6 | `ZOMBIE_IDLE_GROAN` | Every 8–20s random | P | ~1107 |
| 7 | `ZOMBIE_AGGRO` | State change IDLE→CHASE | P | ~1106 |
| 8 | `ZOMBIE_DEATH` | Non-gib death | P | ~1105 |
| 9 | `ZOMBIE_FOOTSTEP` | Every N steps chasing | P | ~710 |
| 10 | `PLAYER_FOOTSTEP` | Every N steps moving | 2D | ~710 |

### `GIB_SPLAT` throttling

Cap 3 concurrent voices with "oldest-wins / skip-if-busy" — preserves the initial peak of a cluster-gib, drops trailing splats rather than cutting the first one. Matches the moment where the impact actually sells.

### Ambient bed (2 layers)

1. **Wind loop** — continuous, −24 dB. Seamless crossfade-loop wrap if Blood's source isn't clean.
2. **Random spikes** — distant thunder (3–6s sample, every 20–40s, random pan/pitch). Optional distant cultist muttering from Blood.

### RFF extraction tool

New: `scripts/extract_blood_sfx.py`. Same pattern as `extract_blood_sprites.py`:
1. Read BLOOD.RFF FAT
2. Find `.VOC` resources
3. Convert VOC → WAV (header rewrite, PCM preserved)
4. Output `public/assets/audio-placeholder/sfx/{sfx_id}.wav` + manifest

`.gitignore` adds `public/assets/audio-placeholder/` — same dev-only-never-ship policy as sprites.

### Tests (Track 3a)

- `sfx-registry.ts` — missing buffer returns silent fallback without throwing
- `ambient.ts` — random-spike scheduler respects `[min, max]` bounds under seeded RNG

### Files touched (Track 3a)

- `src/audio/*` — new (5 files, ~400 LOC)
- `src/audio/*.test.ts` — ~2 files
- `scripts/extract_blood_sfx.py` — new
- `public/assets/audio-placeholder/` — new
- `.gitignore` — add audio-placeholder/
- `src/game/weapons/dynamite.ts` — fire events 1–3
- `src/game/gibs/` — fire events 4, 5
- `src/game/enemy/ai.ts` + `axe-zombie.ts` — fire 6, 7, 8, 9
- `src/engine/player.ts` — fire 10
- `src/main.ts` — engine init + ambient start

## Track 3b — Post-processing (full clay stack)

### Architecture

`postprocessing` npm package for its composable pass system. Custom shader for the distinctive palette-dither pass. All passes at 960×540 internal res — ~1ms GPU cost total.

```
Scene render
  → VignettePass
  → PaletteDitherPass  (custom — Bayer 8×8 + BLOOD.PAL LUT)
  → ChromaticAberrationPass  (event-driven intensity)
  → FilmGrainPass
  → [ScanlinesPass]  (toggleable, default OFF)
  → [BarrelDistortionPass]  (toggleable, default OFF)
  → Output → CSS stretch
```

Each pass toggleable via `postFx` config. Default: 4 always-on + CRT/barrel off.

### Palette dither pass (the distinctive one)

Two operations in one shader:
- **Bayer 8×8 matrix** — offsets pixel colors by ±(matrix/64) before quantization
- **Palette snap** — finds closest BLOOD.PAL color via 16×16 RGB LUT texture, outputs that exact color

`ditherStrength` uniform (0–1): 0 = pure palette snap (flat-stepping), 0.5 = default, 1 = full Bayer (strong dither pattern). Live-tunable via dev panel.

BLOOD.PAL LUT baked at build time from the already-extracted palette.

### CA event coupling

`postFxBus` event module (pure, no Three.js dep):

```ts
// src/vfx/post-fx/post-fx-bus.ts
postFxBus.triggerDamagePulse(intensity, duration);
```

CA pass subscribes; reads `bus.currentCAIntensity(now)` per frame with ease-out decay back to baseline. Non-disruptive (no white flash) but communicates damage.

### Dev panel

Query-string `?devfx=1` or hotkey F9 surfaces a panel with:
- Toggle per pass (on/off)
- `ditherStrength` slider
- Grain amount slider
- CA baseline slider
- Enable/disable CRT scanlines + barrel

Dev-only — not in shipped build. Saves hours of rebuild-tune-rebuild.

### Known risk: sprite edge halos

Bayer dither operating across transparent sprite edges can create halos. Mitigations:
1. Dither runs *before* vignette/grain so alpha blending is clean
2. Alpha mask in shader skipping pixels below transparency threshold (fallback)

Ship with (1); add (2) only if halos appear.

### Tests (Track 3b)

- `post-fx-bus.ts` — damage pulse timing, decay curve under seeded time
- Shader tests not attempted (no GPU harness)

### Files touched (Track 3b)

- `package.json` — add `postprocessing` dep
- `src/vfx/post-fx/` — new:
  - `composer.ts` (EffectComposer setup)
  - `palette-dither-pass.ts` (custom shader)
  - `post-fx-bus.ts` (event emitter)
  - `config.ts` (toggles + defaults)
  - `dev-panel.ts` (dev HUD)
- `src/engine/renderer.ts` — `composer.render()` replaces direct `renderer.render()`
- `public/assets/post-fx/BLOOD.PAL.png` — baked palette LUT (gitignored)
- `src/vfx/post-fx/post-fx-bus.test.ts`

## Execution

### Phasing

Five phases, each playtestable on its own:

1. **Foundations** (dispatchable, parallel) — audio engine skeleton, post-fx composer skeleton, `GibProfile` interface, bone-picnum extraction. Infrastructure only; playtest unchanged.
2. **Throw fidelity** (in-session) — weapon FSM, projectile tumble, explosion fix. Feel-iteration.
3. **Audio pass** (hybrid) — dispatch event wiring, in-session mix + ambient curation.
4. **Visual pass** (in-session) — dither shader, CA coupling, tuning sweep.
5. **Gib pass** (hybrid) — dispatch bone wiring, in-session weight tuning.

### Dispatch vs in-session

| Work | Style | Why |
|---|---|---|
| Audio engine scaffold + tests | Dispatch | Pure code, clear spec |
| Blood SFX extraction tool | Dispatch | Python script, unit-testable |
| Post-fx composer skeleton | Dispatch | Three.js boilerplate |
| `GibProfile` interface + zombie profile | Dispatch | Pure data + refactor |
| Bone picnum research + extraction | Dispatch | Research task |
| Weapon FSM port | In-session | Animation timing needs feel-iteration |
| Projectile tumble | In-session | 5-min tweak |
| Explosion investigation | In-session | Visual diagnosis |
| Audio event wiring | Dispatch | Mechanical |
| Audio mix + ambient curation | In-session | Subjective |
| Palette dither shader | In-session | Shader tuning |
| CA + vignette + grain tuning | In-session | Entirely feel |
| CRT/barrel toggles | Dispatch | Mechanical (lib-provided) |
| Bone gib weight tuning | In-session | Feel |

~5 dispatchable tasks (parallel-safe, disjoint directories) + ~6 in-session streams.

### Testing strategy

Tests to actually write (no reflexive coverage):

| Component | Test | Why |
|---|---|---|
| Weapon FSM transitions | Unit | Press-during-raise edge case, timer bookkeeping |
| `GibProfile` spawn ratios | Unit, seeded RNG | 80/20 split within tolerance over 10k rolls |
| SFX registry fallback | Unit | Missing buffer = silent, not crash |
| Ambient scheduler | Unit, seeded RNG | Random-spike bounds |
| `postFxBus` pulse decay | Unit | Lerp/ease-out curve |

Not writing:
- Shader tests (no GPU harness)
- Web Audio JSDOM tests (cursed)
- Feel assertions (playtest's job)
- Brittle cross-system integration tests

### Acceptance criteria

M3 is done when:

1. Full Blood throw FSM wired — press plays raise → ignite → cook → throw with visible lighter animation
2. Flying projectile visibly tumbles
3. Explosion sprite looks right (no distortion, correct scale)
4. Audio plays for all 10 events + 2-layer ambient bed
5. Post-fx stack running with dither + palette snap + CA pulse + vignette + grain visible in-game
6. CRT + barrel toggleable (default off)
7. Bone gibs spawn at ~20% on zombie explosion
8. Dev-panel toggles for each post-fx layer + dither strength slider
9. All tests green; tsc clean; build clean
10. Playtest confirms "a single kill feels great" — subjective, donny's call

### Risks

1. **Post-fx sprite halos** — dither across transparent edges. Mitigation planned.
2. **Audio async race** — player acts before SFX buffer decodes. Mitigation: eager load at boot, silent fallback.
3. **Dispatch failures** — we've had R5.1 silent-exit twice this session. If any Phase 1 dispatch task fails, fall back to in-session. Don't let dispatch issues block the milestone.
4. **Tuning scope creep** — visual + audio tuning is a black hole. Budget 2h per track max; ship at "good enough" and revisit in M8 polish.

## References

- Blood source: `/Users/donny/Documents/Raze/NotBlood/source/blood/src/`
  - `weapon.cpp:2141` `processTNT` FSM
  - `actor.cpp:1708+` `thingInfo[]` table (picnum references)
  - `gib.cpp` + `gib.h` for `GIBTYPE` enum
- Existing Blud docs:
  - [docs/tuning-sources.md](../tuning-sources.md) — R1
  - [docs/tuning-sources-gibs.md](../tuning-sources-gibs.md) — R2
  - [docs/dev-notes/2026-04-21-blood-map-research.md](../dev-notes/2026-04-21-blood-map-research.md) — R5
  - [docs/dev-notes/2026-04-21-animation-system.md](../dev-notes/2026-04-21-animation-system.md) — A10
- Session notes: [Claude Notes/Blud/2026-04-21-m2-playtest-and-f1-port.md](../../../../../../Documents/obsidiandocs/my%20life%20and%20learnings/Claude%20Notes/Blud/2026-04-21-m2-playtest-and-f1-port.md)
