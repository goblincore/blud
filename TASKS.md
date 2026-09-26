# Blud — Task Tracker

> **Session start: read this file first.** It's the cross-cutting status board.
> Per-milestone step-by-step tasks live in `docs/superpowers/plans/`.
> This file is **coarse-grained state only** — keep rows to ≤2 lines and link out for detail.

## Bride (sword melee enemy) — first pass 2026-09-24

- [x] **Body, face, cloth, kit:** SDF flesh (wrong anatomy, stigmata), corpse-makeup face sheet, shell
  bodice/skirt/veil/hair/stockings, WAM plate+boots+chain+crosses kit. [Notes](docs/dev-notes/2026-09-24-bride/NOTES.md)
- [x] **Sword carry + swing:** `swordGuard`/`swordTrail` carries, `STALK` gait, `BRIDE_PROFILE`; phase-keyed
  cleave/sweep/lunge tracks with `fistOnGrip` and pinned arms; jaw gapes on the wind-up.
- [x] **Game wiring:** `?spawn=bride` fights on the sword mind; hits flash/shake/count (no player health).
  `node scripts/bride-melee-gate.mjs 5271 9271` passed as of Task 11 (`64285c82`'s jaw-adjacent
  edits are untested in a browser since). Crowd gate's negative control fails on the base commit
  too (pre-existing, unrelated).
- [x] **Unit-test verification (Task 13):** `tsc --noEmit` clean, all targeted tests pass after the
  kit gained Task 12's `jaw` bone (skeleton parity had caught it; geometry unchanged, WAM rebuild).
- [ ] Perf census vs cultist (fallback-B gate) deferred by the owner (2026-09-24).
- [ ] Polish: jaw red interior + corner tear; plate detail (lames, rivets, rolled edges); the boot
  top edge (reads as a seam against the stocking); the skirt reading as crumpled cloth rather than
  lace ruffles; the veil's crown reading like a nun's coif; the STALK gait's trailing-foot kick
  (reads brisker than a stalk); she doesn't re-face between swings; the head tilts ~45° looking
  around (jaw-gape measurement had to account for it).
- [ ] Out of scope (by design): a second elbow, veil collapse on a head hit, a ranged special,
  real player damage (health), sounds.
- [ ] Room to grow: `MAX_PRIMS` is now 256 (landed on main, see below), so the Task 3 wish-list (third skirt
  tier, hair volume, veil hem, part sweeps) is unblocked; the next wall is 64 prims per cluster.

## New game flow restructure — design approved 2026-09-24

**Hand-off:** [2026-09-26 night train](docs/dev-notes/2026-09-26-night-train-handoff.md) — next: part 2 (flashlight pickup, storm + lightning, lamps, furnaces).

[Spec](docs/superpowers/specs/2026-09-24-new-game-flow-design.md): intro → menu → **the void** (hub, unlit, one portal) → **Night Train first**; the Wake moves later (train crash).
- [x] 1 Design + doc updates (vision §6.1/§10.3/§10.4, Night Train, Wake).
- [x] 2 **The Void + portal** ([spec](docs/superpowers/specs/2026-09-24-void-portal-design.md) · [plan](docs/superpowers/plans/2026-09-24-void-portal.md)): `?level=the-void`; Esc → New game starts there. WGSL portal (flame rim, haze, ray-cast tracks), embers, glow pool; format `void` rooms + `portals`. Gate `scripts/sdf-game-void-gate.sh` 3/3; Wake + shorty gates pass. First level with no bodies (boot seeds guarded). **Next:** owner look review; portal targets `the-wake` until Night Train exists.
- [x] 3a **Level mesh key** ([spec](docs/superpowers/specs/2026-09-24-level-mesh-key-design.md) · [plan](docs/superpowers/plans/2026-09-24-level-mesh-key.md)): `dressing` → `<id>.art.glb` (kit linked + GPU-instanced, rest joined per room/material), `shell: "art"`; with art, solids/furniture are collision only. The Wake draws its dressing (359 meshes → 53). Gate `scripts/sdf-game-art-gate.sh` passes; budget +75 draws / +5 ms (owner-approved). Art emission capped at 1 (Blender strengths blew out).
- [x] 3b **Train carriage kit** ([spec](docs/superpowers/specs/2026-09-25-train-carriage-kit-design.md) · [plan](docs/superpowers/plans/2026-09-25-train-carriage-kit.md)): `kit.blend` (23 pieces, 6 baked textures) → `night-train` carriages 1, 3, 5, 8 (310 linked pieces → 71 instanced meshes), WGSL window scenery, sway; the Void's portal → `night-train`. Gate `scripts/sdf-game-train-gate.sh` passes. Budget +175 draws / +10 ms (owner-approved). Art nits open: lamp bloom, ceiling brackets, black hills.
- [x] 4a **Night Train layout** draft 1 approved ([layout.md](docs/game/levels/01-night-train/layout.md)): five carriages as chains of rooms (van 3 rooms, dining saloon + island + galley, **sleeper** 5 compartments, party, cab); widths 3.6/4.2/4.0/4.2/3.0.
- [x] 4b **Carriages rebuilt from the layout** ([plan](docs/superpowers/plans/2026-09-25-night-train-rebuild.md)): `cultist` spawn kind; kit walls at the wall plane, shells sized per carriage, partitions, layout props; `build_night_train.py` reads `night_train_layout.py`. Gate: every room walked (24 waypoints, `?nospawn`). Budget raised to +200 draws / +10 ms (owner; optimise once the level feels good).
- [~] 4c **Night Train look v2** (owner, after playing): a grimy industrial prison train. Part 1 restyle [spec](docs/superpowers/specs/2026-09-25-night-train-art-v2-design.md) · [plan](docs/superpowers/plans/2026-09-25-night-train-art-v2.md) **built** (kit v2: 54 pieces, 11 materials baked to colour/roughness/normal, art 7.4 MB; 202 instanced meshes). Walk, windows, sway pass; budget raised to +350 draws / +12 ms (owner, 2026-09-26; optimise later: small-dressing shadows off, then texture atlas) → part 2 flashlight pickup + dynamic lights **built** (see 4g) → part 3 haze + raymarched volumetric light for every light, **folded with hybrid lighting** (owner, 2026-09-26): one shared light list with shadows (lamps, window lights, flashlight, fires) read by both the level shaders and the SDF march, each keeping its own stylized shading, not the deferred renderer's single realistic BRDF; replaces the hand-wired body feeds (`applyWindowKey`, `applyRoomFill`).
- [x] 4f **Game loop** ([plan](docs/superpowers/plans/2026-09-26-game-loop.md)): health 100, zombie bites 10 (0.9 m, 0.8 s), sword 15, pellets/rounds 3, death + restart, pickups (sawn-off loaded 2 + 4, shells 8, health 25), finite ammo, triggers/events/gates, the CD completes the level; `?god`. Gate `scripts/sdf-game-loop-gate.sh` 5/5 on Night Train. Defaults to tweak. Train gate frame check is load-sensitive (passes +11.9 ms at load ~6; optimise later, owner).
- [x] 4g **Dynamic light + the flashlight** ([spec](docs/superpowers/specs/2026-09-26-night-train-dynamic-light-design.md) · [plan](docs/superpowers/plans/2026-09-26-night-train-dynamic-light.md)): Night Train starts dark; the torch on the hold's west wall switches the flashlight on and kills the van lamps (a `cues` entry). Lamp moods on the sim clock (`lamp-moods.ts`: steady, flicker, stutter, dying, dead, fire), scripted `light.<die|blackout|strobe>.room.<n>` (sleeper blackout, party strobe triggers), fire lights at the stoves, boilers and firebox. The violent storm (`storm.ts`, `TRAIN_STORM` WGSL: clouds lit from within, forked bolts, rain on the glass) and one shadowed window light per windowed carriage (lightning + warm sweeps; only the player's carriage re-renders per step, the rest once per event; about +0.2–0.5 ms while lit). Small dressing casts no shadow. Seams `lights()`, `setFlashlight`, `forceBolt`, `forceSweep`, `holdWindowLight`, `lightCommand`; `?torch` starts lit, `?window=night` the calm view. Gate `scripts/sdf-game-light-gate.sh` 6/6. Known gap: the SDF bodies don't see the window light. **Next:** owner look review (bolt rate/brightness, lamp moods), then part 3.
