# GOBLIN — Production Scope (draft 1)

**Date:** 2026-09-10 · **Vision:** [vision.md](vision.md)

**What this is:** a coarse map from the vision to *what has to be built*,
systems and assets, in a sensible order. Not a step-by-step implementation plan;
each milestone below gets its own spec and plan when it starts. Sizes are
relative (S / M / L / XL), not time estimates.

---

## 1. Where we actually are

**The game today is a combat testbed, not a game.** There is one basic combat
loop: two enemies (zombie, soldier) with basic behaviour, and one weapon (the
double-barrelled sawn-off), in a single hard-coded grey-box level.

| Area | State | Notes |
| --- | --- | --- |
| **Rendering** (SDF bodies, WebGPU, VHS/interlace post-fx) | **Strong** | The most mature area. Perf margin is thin: the raymarch is ~75–83% of GPU time |
| **Bodies: deformation, wounds, gore, blood** | **Strong** | The game's core feel (P2) is already here |
| **Character authoring** (`.blob` / `.wam`) | **Strong** | ~19 characters authored; only zombie and soldier are in play |
| **Player movement** | Exists | Capsule vs. boxes, mouse look, flashlight |
| **Enemy AI** | Basic | Zombie brain, soldier shoot-back (soldier deals no damage yet) |
| **Weapons** | 1 | Sawn-off. Grapeshot model and dynamite exist only outside the game |
| **Levels** | **Missing** | One hard-coded ring of box rooms (`webgpu/game-level.ts`). No editor, doors, triggers, pickups or exits |
| **Game flow** | **Missing** | No player health, death, restart, level transitions, save/load |
| **HUD / menus** | **Missing** | Debug text and a crosshair |
| **Audio** | **Missing** | Nothing in the active game (the retired game's `src/audio/` is unused) |
| **Frame layers** (room, desktop, render-to-texture CRT) | **Missing** | Only a render-target hook used for readback |

**Structural debt that will bite:** `webgpu/game-main.ts` is ~7,700 lines, and
the FPS / legacy / shared source split isn't done. Adding game systems on top
of that file will get painful quickly.

---

## 2. The shape of the work

Four streams, in this order of risk:

1. **Make it a game.** Health, death, pickups, doors, exits, level loading,
   HUD, save. Unglamorous, and everything depends on it.
2. **Make levels possible.** A level format and an authoring path. **The
   biggest unknown in the whole project** (§4.1).
3. **Make it heard.** An audio engine with a beat clock. Music is structural
   here: bosses, the club, the knock and the bleed all need it.
4. **Make the frame.** Render the FPS onto a CRT inside a 3D room; camera
   transitions; the desktop UI; the portal.

Then content (levels, enemies, weapons, music) and the crossover systems.

---

## 3. Milestones

Ordered so that each one ends with something playable, and so the riskiest
unknowns are tackled first.

### G0 — Housekeeping *(M)*
- Split `game-main.ts` into systems with a documented tick order.
- Finish the FPS / shared source split, enough that new systems have a home.
- **Done when:** a new game system can be added without touching a 7,700-line file.

### G1 — Game loop foundation *(L)*
- Player health, damage from enemies (soldier fire lands), death, restart.
- Pickups: health, ammo, CD (as a collectible with an ID).
- Doors, keys, triggers, level exit.
- Level load / unload / transition; the Cloakroom as a hub of doors.
- Minimal HUD (health, ammo) in an in-fiction 90s style.
- Save/load (progress, collected CDs, and later room state).
- **Done when:** you can play two grey-box levels back to back via a hub, die,
  and resume.

### G2 — Level pipeline *(XL, highest risk)*
- Decide the level format and authoring route (§4.1 options).
- Level geometry beyond boxes: at minimum arches, stairs, slopes, props.
- Probe lighting per level (merge the existing branch).
- Soft/deformable architecture as a later extension (needed for Hell, the club).
- **Done when:** a non-programmer-friendly path produces a level with lighting,
  doors and pickups, and it loads in the game.

### G3 — Audio foundation *(L)*
- Audio engine in the active game (port or rewrite from `src/audio/`).
- Positional SFX: guns, body hits, gore, footsteps.
- Music system: layered stems, **beat clock** exposed to gameplay.
- Diegetic bleed: music sources in the world, muffling by distance and walls.
- **Done when:** a level has a placed music source you can walk toward, and
  gunfire/gore sound right.

### G4 — Vertical slice: the cold open *(XL)*
**The single most important milestone: it proves the whole concept.**
- ***The Wake***, final-quality demo level (zombies, sawn-off, one CD).
- **Render-to-texture:** the FPS drawn onto a CRT screen in a 3D room.
- **The Flat,** first version: walkable, core props, no decorating yet.
- **The pull-back:** a continuous camera move from full-screen FPS to the room.
- **The first push-through:** the CRT glass deforms and the wet CD drops onto
  the desk.
- **The Desktop,** first version: FPS icon, mail, boot sequence as title screen.
- Play the CD on the stereo.
- **Done when:** someone who knows nothing plays from launch to the room, puts
  the CD on, sits back down and launches the game. If this doesn't land, the
  frame needs rethinking before anything else is built.

### G5 — Arsenal and roster *(L)*
- Weapons to ~5–6: dynamite into the game, grapeshot, plus 2–3 new, each with
  a distinct effect on bodies.
- Bring authored characters into play with brains: gargoyle, clown, cyclops,
  gnasher, bloatmaw, mouse. New: train passengers, flesh dolls.
- **Done when:** each level's spotlight enemy exists and fights.

### G6 — Levels 1–5 *(XL)*
The Keep, Cold Storage, The Big Top, Night Train, The Ship. Each with its CD,
music source and spotlight enemy. Night Train's moving scenery.

### G7 — Crossover systems *(L)*
- **Tone-phase state machine** driving flat, desktop, boot and portal.
- **Portal routes:** CD tray, printer, mail slot, screen.
- **The beige machine becomes a body** (staged material/deformation on the PC).
- **Decorating:** free placement, saved.
- **Music collection:** shelf, stereo, desktop player, mix CDs.
- **The knock:** rhythm patterns, answering by knock / silence / track / object.
- Mail and routines.

### G8 — Levels 6–8 and bosses *(XL)*
The Works (+ Dollhouse secret), Floorfiller with **the Headliner**, Hell with
**the Host**. Needs soft architecture from G2 and the beat clock from G3.

### G9 — Endings and shareware wrapper *(M)*
The flat finale (fight in the decorated room, shelf-order soundtrack),
epilogues, knock-dependent ending selection, the nag screen.

### GR — Native port: Rust + wgpu *(XL)*
The release build is a native Rust app on `wgpu` (decision 4.6). Order: renderer
first (the WGSL carries over), simulation second, tooling (debug UI, scriptable
capture channel, shader/tuning hot-reload) alongside. The TypeScript build stays
the reference until the native one matches it frame for frame. Starts with the
one-zombie spike (4.6), which can run any time before this milestone.

### G10 — Polish and ship *(L)*
Balance, performance on target hardware, settings (including bezel off),
accessibility, store page, soundtrack release. Ships the native build (GR).

---

## 4. Big decisions and risks

### 4.1 How levels get made *(decide before G2)*

| Option | For | Against |
| --- | --- | --- |
| **A. Blender as the level editor**, exported to our format | Mature tool, already on this machine (Blender MCP available); good for props and arches | Need an exporter and conventions for doors, triggers, lights |
| **B. A classic brush editor** (TrenchBroom-style `.map`) | Built for exactly this era's levels; fast blockouts | A new importer; brushes vs. SDF bodies mismatch |
| **C. SDF-native levels** (levels as `.blob`-like SDF scenes) | Levels can deform like bodies (Hell, club); one pipeline | Raymarch budget is already tight; unproven for large spaces |
| **D. Hybrid:** meshes for most architecture, SDF only for soft set pieces | Cheapest perf path; soft where it matters | Two kinds of geometry to light consistently |

**Recommendation:** D, authored via A, with a spike on C for Hell only.

### 4.2 Two scenes at once *(test early in G4)*
The flat and the FPS render together when framed. The raymarch margin is thin.
Mitigations: the CRT shows a lower-resolution FPS image (period-correct), the
room is mostly cheap geometry, and the FPS renders full-screen with the room
paused when pushed in.

### 4.3 Soft architecture *(Hell, Floorfiller, the screen)*
Today, levels are boxes and bodies are SDF. Deforming *walls* and the CRT glass
are new. The screen is a small, contained first case (G4), which makes it a
good pilot before Hell.

### 4.4 Audio from nothing
Music is load-bearing for bosses, the knock and the club. G3 should land before
any of those.

### 4.5 One person
The scope is sized for a solo developer only if levels are cheap to make (4.1),
levels are remixed across phases rather than multiplied, and the finale and
secret reuse the flat.

### 4.7 Multi-height floors *(needed early; decided 2026-09-23)*
Everything assumes one floor at y = 0: the player controller clamps to it,
actors ground to it, and enemy navigation is a 2-D grid. Night Train's roof
route needs more than one floor height, and the Wake's crypt wants real stairs.
Needs: player ground from colliders (stairs, ramps), actors grounded on the
floor under them, and navigation with floor levels joined by stairs/drops.
Plan it before Night Train's blockout; the Wake v1 ships at one height.

### 4.6 Platform: web for development, Rust + wgpu for release *(decided 2026-09-18)*
Development stays on the web stack (TypeScript + three.js WebGPU): hot reload,
lab pages, headless capture and the agent workflow all depend on it. The
**release is a port to Rust on `wgpu`** — the same API family and the same
WGSL, so the raymarch, probe gather and post shaders carry over largely as-is.
What the port buys: ahead-of-time/cached pipelines (no cold multi-minute
compile), no browser GPU watchdog, real GPU profilers and in-pass timestamps,
native-speed and multithreaded simulation, deterministic replays, one binary
for Mac/Windows/Linux/Steam Deck. What it costs: rewriting all the TypeScript,
rebuilding the capture/console tooling, and slower iteration without hot
reload. Godot was considered and rejected: the renderer is custom SDF raymarch
work that its pipeline would not use. Tauri was rejected (Safari's engine on
macOS); Electron stays a fallback wrapper if release comes before the port.

**Spike (do early):** a small Rust + `wgpu` app that loads `march.wgsl` and draws
one static zombie through the same raymarch; measure pipeline compile time and
frame cost against the browser.

**Rules for the web build so the port stays cheap:**
- WGSL stays the source of truth for rendering; prefer hand-written WGSL
  modules over TSL-only node graphs for anything load-bearing.
- Game logic in pure, renderer-free modules (the `burn-state` / `burn-behaviour`
  pattern), so each is a mechanical translation with its tests.
- Keep state explicit (the `GameContext` slices) and simulation deterministic.
- Tooling seams (`__sdfGame`, capture scripts) talk in plain data, so a native
  command channel can answer the same questions.

---

## 5. Asset inventory

### 5.1 Levels (11)
The Wake · The Keep · Cold Storage · The Big Top · Night Train · The Ship ·
The Works · Floorfiller · Hell · Dollhouse (secret) · the flat finale.
Plus the Cloakroom hub.

### 5.2 Characters

| Character | Status | Level |
| --- | --- | --- |
| Zombie | In play | The Wake |
| Soldier | In play | Cold Storage |
| Gargoyle | Authored, not in play | The Keep |
| Bloatmaw | Authored | Cold Storage |
| Clown | Authored | The Big Top |
| Cyclops | Authored | The Ship |
| Gnasher | Authored | The Works |
| Mouse | Authored | Dollhouse |
| Cyberdemon → **the Headliner** | Authored; rename and redesign | Floorfiller |
| Train passengers | **New** | Night Train |
| Flesh dolls | **New** | The Works |
| Club crowd | **New** (or reuse guests) | Floorfiller |
| **The Host** (heart + tumour) | **New**, part level, part boss | Hell |
| Goblin hands/arm | Exists (arm model) | Everywhere |
| Bonewalker, minotaur, dragon, schoolgirl, others | Authored, unplaced | Role or cut |

### 5.3 Weapons (~5–6)
Sawn-off (in play) · starting melee: shovel / pickaxe / axe (new) · dynamite
(lab only) · grapeshot (model only) · **chainsaw** (new, decided) · 1–2 more.

### 5.8 First tasks in flight
- **The Flat:** [design](flat/design.md) · [tasks](flat/tasks.md)
- **The Wake:** [design](levels/00-the-wake/design.md) · [tasks](levels/00-the-wake/tasks.md)

### 5.4 The Flat
Room shell, desk, beige PC (with staged flesh versions), CRT (deformable
screen), chair, mattress, CD shelf, stereo, pipes, bucket, high window, covered
mirror, front door (staged soft version), printer, mail slot. Decoration objects:
one or more per level.

### 5.5 The Desktop
OS look (bevels, icons, fonts, cursor), boot sequence per phase, mail client,
file browser, music player, screensaver, nag screen. Built as 2D UI rendered to
the CRT texture.

### 5.6 Music and sound
- **Soundtrack:** ~12–15 tracks (one per level, hub, flat, bosses, extras), as
  stems for layering and beat-clock sync.
- **Releases:** ~10–12 CD covers (prerendered CG), fake artists, liner notes.
- **SFX:** weapons, body hits and gore, enemy voices (wordless), goblin giggles
  and wheezes, footsteps per surface, doors, pickups, CRT/PC sounds, the push-through,
  the knock, the flat's ambience.

### 5.7 Writing (small, by design)
Level names, intermission cards, ~25 mails, notes under the door, liner notes,
item names, the inner game's box copy.

---

## 6. Suggested next steps

1. **Decide the level route (§4.1)** with a short spike: build one Wake-sized
   blockout via Blender export.
2. **G0 housekeeping**, so new systems have somewhere to live.
3. **G1** on grey-box levels in parallel with the level spike.
4. **Pull G4's render-to-texture and pull-back forward as a tech spike:** it's
   the riskiest *frame* question and it's cheap to test with the current ring
   level on the monitor.
