# Blud — Design Doc

*A short-run roguelike FPS inspired by Blood (1997), in a terminally-online Weird West.*

**Date:** 2026-04-20
**Status:** design approved, pre-implementation
**Priority:** Make the violence *feel* right. Everything else serves that.

---

## 1. Pitch

You wake up in a frontier town that's been poisoned by the internet. Cowboys scroll cursed phones at the saloon. The preacher posts rituals. The algorithm is growing a body in the mines. You have a six-shooter, a sawed-off, and a dim memory of how things used to be.

A short-run roguelike FPS (10–15 min per run). Handcrafted chunks stitched by a generator. No meta-progression. You just get better at shooting goons until their pre-rendered claymation bodies burst into hunks of wet voxel clay.

Working title: **Blud**. (Blood + gooned out.)

---

## 2. Core loop

1. Start at the **hub** (saloon / general store / outhouse).
2. Grab starting loadout (1 weapon, find others across the run).
3. Traverse **3–5 procgen-stitched handcrafted chunks** with escalating difficulty.
4. **Boss arena** at the end.
5. Die or win → back to hub → new run.
6. **No meta-progression.** No unlocks. Runs are short and varied; replayability comes from generation + gib feel.

---

## 3. Rendering & art direction

### Stack
- **Engine:** Three.js on WebGL2. TypeScript throughout.
- **Physics:** Rapier3D.js (@dimforge/rapier3d-compat).
- **Bundler:** Vite.

### Look
- **Perspective:** first-person, 2.5D-feel inside a full 3D engine. Flat floors/ceilings, mostly orthogonal geometry. Camera is normal FPS (not raycaster).
- **Enemies intact:** **billboarded sprites** with 8-angle sprite sheets pre-rendered from 3D claymation-style models in Blender. Authentic Blood pipeline.
- **Enemies on death:** sprite is swapped for a **pre-baked voxel representation** (MagicaVoxel `.vox` per enemy) that shatters into Rapier-simulated voxel chunks with clay shader. This is the money shot.
- **Gib chunks:** each chunk is a Rapier rigidbody with a tiny convex collider, rendered with a fingerprint-textured clay shader (slightly smoothed, slightly wet). Decays into a ground blood decal after ~10s.
- **World palette:** dirty ochres, bruise purples, dried-blood browns — pierced by **phone-screen cyan and Monster-energy-green**. Sunlight bleached. Neon where there shouldn't be.
- **Post-processing:** dithered posterization, low-res pixelation, chromatic aberration on hit-confirm, slight bloom on anything screen-lit.

### Tone & setting
Weird West × terminally-online brainrot. Think *Cruelty Squad* meets *Blood* meets the worst parts of Twitter at 3am. Enemies are cowboys, preachers, sheriffs, and prospectors — all visibly deformed by posting. Ritual altars are made of energy-drink cans and phone chargers.

---

## 4. Gib & weapon tech (the priority)

This section gets the most care because **this is what the game is selling**.

### Hit response
- Every hit applies a physics impulse to the enemy's collider (knockback is real, not animated).
- Hit flash (vertex color pulse on sprite), damage number *maybe* (probably not — reads too video-gamey).
- Sprite particles for blood at impact point, GPU decal on the wall behind.
- Audio: layered wet impact + muffled grunt. Sound is doing heavy lifting here.

### Death paths
- **Normal death:** sprite plays death frames, leaves gibbable corpse (static sprite on ground, still has collider).
- **Overkill gib (single-hit damage > threshold):** skip death animation, swap immediately to voxel-pile explosion.
- **Corpse regib:** shoot or explode a corpse → triggers the same voxel-pile explosion path.
- **Fire/acid death:** over-time degradation, voxelization happens mid-animation as the body fails.

### Gib explosion
1. Despawn sprite billboard.
2. Spawn voxel pile at same transform, using the enemy's pre-baked `.vox`.
3. Each voxel = Rapier dynamic rigidbody. Apply radial impulse from impact direction with randomness.
4. Chunks collide with world and each other (cheap broadphase; cap simultaneous chunks globally — see §9 Performance).
5. Chunks leave tiny blood-drip trails (ribbon mesh), land, settle, decay into ground decal.

### Screen feel
- Shotgun fire: ~80ms camera kick, screen-shake impulse, slight FOV punch.
- Overkill gib: 100ms micro-freeze (time stutter), low-pass audio filter briefly, mild chromatic aberration.
- Not too much — Blood's feel is punchy but not juiced-to-death.

---

## 5. Starter rosters (drafts — will be tuned)

### Enemies (4 + 1 boss)
| Name | Role | Attack | Notes |
|---|---|---|---|
| **Scrollkin** | Fodder | Melee shamble | Phone fused to hand, leaks cyan light. Gibs easily. |
| **Posting Priest** | Ranged glass cannon | Lobs cursed glyphs | Slow. Gibs spectacularly mid-incantation. |
| **Deputy Dogg** | Mid-range tank | Shotgun | Fat sheriff. Takes two shells. Knockback is fun. |
| **Gooner Horse** | Fast melee | Charge | Quadruped, fast, ends runs. Voxel chunks = extra satisfying. |
| **The Algorithm** | Boss | Multi-phase | Floating monitor-head, grasping claw-arms that birth phones. Gibs in layers. |

### Weapons (4)
| Name | Primary | Alt | Notes |
|---|---|---|---|
| **Revolver** | Single shot, 6 rounds | Fan-the-hammer (empty cylinder fast) | Sidearm. Headshot fodder-deletes. |
| **Double-Wide (sawed-off)** | One barrel | Both barrels (big gib) | Core weapon. The feel of this determines the game. |
| **Dynamite Bundle** | Throw | Toss-with-bounce; cooks in hand | Corpse-sender. |
| **Cursed Phone** | Charged melee swing | Demoralizing beam (slow melt) | Melee/AOE. Alt fire gibs via goo-acid path. |

**Stretch weapons (post-v1):** flare gun, voodoo-doll analog.

---

## 6. Levels — chunks & generator

### Chunk format
- Authored in **Blender**, exported as **glTF** (`.glb`).
- Each chunk file bundles:
  - visual geometry
  - collision mesh (named `collider_*`)
  - N **connector markers** (named empties, tagged with direction + elevation class)
  - N **spawn markers** (enemy spawn points, optionally pool-tagged)
  - N **prop sockets** (where procgen drops props from a pool)
  - metadata JSON (chunk type, difficulty tier, mood tags)

### Chunk types (v1 target: ~20 chunks)
- **hub** ×1
- **combat room** ×10 (varying size/shape)
- **corridor** ×5 (transition pieces)
- **set-piece** ×3 (handcrafted moments — the outhouse massacre, the burning chapel, the phone altar)
- **boss arena** ×1

### Generator
Graph-based, simple:
1. Start node = hub.
2. Pick a chunk chain respecting connector compatibility + difficulty curve (easy → medium → hard).
3. End node = boss arena.
4. Scatter props from per-chunk prop pools at generation time.

No dungeon-gen PhD required. "Stitch chunks by matching their labeled doors" is the whole algorithm.

---

## 7. Project structure

```
blud/
├─ docs/superpowers/specs/          ← design & plans
├─ public/                          ← static assets served directly
├─ src/
│  ├─ engine/                       ← Three.js setup, render loop, input
│  ├─ physics/                      ← Rapier setup, body registries
│  ├─ game/
│  │  ├─ weapons/
│  │  ├─ enemies/
│  │  ├─ gibs/                      ← voxel gib system (central)
│  │  ├─ levels/                    ← chunk loading, generator
│  │  └─ runs/                      ← run state, progression
│  ├─ ui/                           ← HUD, menus
│  ├─ shaders/                      ← GLSL, clay shader
│  └─ assets/                       ← imported sprites, voxels, audio
├─ assets-source/                   ← Blender files, raw .vox, .wav masters (not shipped)
├─ index.html
├─ package.json
├─ vite.config.ts
└─ tsconfig.json
```

**Unit boundaries:** each enemy, each weapon, each chunk is self-contained data (glTF + JSON + TS module). Systems (gib, weapon fire, AI) live in `game/*`. Engine stuff is physics/rendering only — no gameplay leakage.

---

## 8. Scope discipline

**In v1:**
- 1 hub, 4 weapons, 4 enemies + 1 boss, ~20 chunks
- Single run length (3–5 chunks → boss)
- Keyboard + mouse only
- Web-only build (itch.io embed)
- Settings: volume + sensitivity + one "low-performance mode" toggle
- Highest-run-reached persistence (localStorage, one number)

**Not in v1 (YAGNI):**
- Meta-progression, unlocks, currencies
- Multiplayer
- Controller support (bolt on later if easy — Gamepad API is cheap but untested is untested)
- Mobile / touch controls
- Localization
- Cutscenes, narrative beyond ambient environmental storytelling
- Destructible environment (chunk schema supports prop sockets though, so this is a clean post-v1 addition)
- Accessibility beyond subtitle toggle

---

## 9. Performance budget

- Target: 60fps on a 2020-era laptop (integrated GPU), Chrome/Firefox/Safari.
- WASM bundle (Rapier): cache aggressively.
- **Gib cap:** max ~400 active voxel rigidbodies globally. Older gibs despawn FIFO. Voxel piles that settle for >1s freeze into static decals.
- **Enemy cap:** max ~12 active enemies per chunk.
- **Texture budget:** sprite atlases per enemy (512×512 or 1024×1024 per angle set).
- **Draw calls:** aggressively instance props and gib chunks.

---

## 10. Milestones

Two phases. **Phase 1 is where the game lives or dies.** Phase 2 is packaging. Expect Phase 1 to eat the majority of calendar time. Do not timebox it — its length is deliberately elastic.

### Phase 1 — Feel Lab *(one featureless test arena; no levels, no generator, no run structure)*

| # | Name | Goal | Rough size |
|---|---|---|---|
| **M1** | Engine & movement | Three.js + Rapier + FPS controls + test arena. Walk in a box. | 1–2 wk |
| **M2** | First kill | Revolver + placeholder Scrollkin + voxel gib MVP. Fire → hit → swap to voxel pile → chunks fly. Ugly but end-to-end. | 1–2 wk |
| **M3** | One-kill feel pass | Clay shader, blood decals, screen FX, impact audio, animation polish. One weapon + one enemy, but the single kill *feels* right. | 2–3 wk |
| **M4** | Full arsenal | Double-Wide, Dynamite, Cursed Phone. Primary + alt fire per weapon. Each tuned against a documented feel target. | 3–4 wk |
| **M5** | Full bestiary | Posting Priest, Deputy Dogg, Gooner Horse. AI, per-enemy gib tuning, mixed-wave behaviour. | 2–3 wk |

**Phase 1 gate:** sit in the arena and kill cultists for 30+ minutes straight. Self-report: *"is this fun just on its own?"* If yes → Phase 2. If no → keep iterating; **do not build levels on top of bad feel.**

### Phase 2 — Game *(structure, content, ship)*

| # | Name | Goal | Rough size |
|---|---|---|---|
| **M6** | Chunks & generator | Author 20 chunks in Blender, build stitcher, run loop, hub. | 2–3 wk |
| **M7** | The Algorithm (boss) | Multi-phase boss fight. | 1–2 wk |
| **M8** | Polish | Music, audio pass, HUD polish, additional decals, balance. | 2 wk |
| **M9** | Ship | itch.io build, trailer, external playtest, launch. | 1–2 wk |

**Total rough estimate:** 3–4 months solo evenings/weekends — with ~60% of that in Phase 1, by design. If Phase 1 feels cramped, extend it. That's where the game lives.

---

## 11. Verification plan

- **M1:** FPS camera moves, collides with walls, Rapier step runs at 60Hz fixed timestep.
- **M2:** shoot placeholder Scrollkin → gib explosion swaps in → voxel chunks simulated and despawn. Rough, but pipeline is end-to-end.
- **M3:** one-kill feel pass signed off — record a 30s clip of a single gib kill, self-rate "satisfying," share to 3 friends for gut-check.
- **M4:** every weapon has a written "feel target" (impulse values, sfx tags, particle signature, primary-vs-alt behaviour) and is signed off against it.
- **M5 (Phase 1 gate):** 30+ minutes in the arena killing mixed waves feels fun on its own. Do not begin Phase 2 until this passes.
- **M6:** 20 consecutive generated runs complete without stuck/unreachable generation; each completes in 10–15 min.
- **M7:** boss is completable and has ≥2 distinct phases.
- **M8:** full front-to-back run, recorded, feels like a game (not a demo).
- **M9 (ship gate):** itch.io web build loads <10s on broadband, 60fps on target hardware, 3 external playtesters rate "I'd do another run."

---

## 12. Mining Blood source for tuning values

The existing Blood source ports are a gift for tuning. We use them for **numbers, not code**.

### Sources
- **NotBlood** — <https://github.com/clipmove/NotBlood> (preferred port)
- **NBlood** (EDuke32-based) — parent project
- **BloodGDX** — Java port, often the most readable

All are **GPL-licensed**. We will not vendor code from them into this project. But **numeric constants are data**, and studying a reference implementation to inform design is exactly what reading a paper is. We keep attribution in `docs/tuning-sources.md` noting each value's origin (`<file>:<line>`).

### Values to extract
- **Enemy HP** for every baseline cultist/zombie/hound/etc.
- **Weapon damage** — revolver, sawed-off single + double, tommy gun, dynamite (radius + damage curve), voodoo doll, flare gun
- **Projectile behaviour** — dynamite fuse timer, bounce, flare ignition radius
- **Spread angles** — sawed-off cone, tommy gun spread
- **Reload & refire timers** per weapon, per fire mode
- **Knockback impulses** (Build physics often expresses as velocity deltas)
- **Corpse decay timers**
- **Gib thresholds** — single-hit damage that skips dying animation and explodes
- **Movement speeds** — player walk/run/jump/crouch; enemy AI speeds
- **AI behaviour timers** — aggression radii, attack cooldowns, pain-chance

### How we use them
- Translate each value into our unit system (Rapier is SI-ish; Build is not — expect to scale).
- Log as **starting values** in each weapon/enemy spec. Feel-test tuning may move away from them, and that's fine — they're the starting point, not the law.
- A subagent research task produces a single `docs/tuning-sources.md` extraction that's ready by the start of M2 so we tune against real numbers from day one.

---

## 13. Open questions / defer list

- Protagonist identity — faceless for v1? Named? Has a voice line on death?
- Music — commission, license, or freesound-stitch? Defer to M5.
- Controller support — if Gamepad API is a one-day job, maybe. Otherwise no.
- Steam release post-itch? Way too early to care.

---

## 14. Reference works (mood)

- **Blood** (1997) — gibs, pacing, weapon alt-fires, tone
- **Cruelty Squad** — dirty internet-cursed vibe, tone
- **Cultic** — contemporary Blood homage, handcrafted feel
- **Dusk** — how to do 2.5D-in-3D in a modern engine
- **Voxel Doom** (mod) — proof that voxel-enemy gibs work visually
- **Ziggurat / Immortal Redneck / Gunfire Reborn** — chunk-based FPS roguelike structure
- **Armature Studio / claymation PS1 games** — claymation sprite pipeline

---

*End of design.*
