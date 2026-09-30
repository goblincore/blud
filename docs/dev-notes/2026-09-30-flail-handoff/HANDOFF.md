# Spike flail, head damage and wound look — hand-off (2026-09-30)

PR goblincore/blud#22 was merged into `main` (merge `27797f70`). This note says what exists, how to run and
check it, what to watch out for, and what is left. It replaces `docs/dev-notes/2026-09-26-flail/HANDOFF-v1.2.md`
(that one is history).

## Run it and check it

- Owner playtest server: `.claude/launch.json` config `blud-censer` (`npx vite --port 5190 --strictPort`) →
  http://localhost:5190/sdf-game.html?level=night-train. **Port 5190 is the owner's server: gates use 5241/9241.**
- Weapon keys: **1 flail**, 2 shotgun, 3 dynamite, **4 grenade launcher (only with `?launcher=1`)**, 5 flare.
- Headless gates (start vite and Chrome with `scripts/lab-servers.sh`, **sourced from bash**, not zsh):
  `bash -c 'export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up >/dev/null 2>&1; node <script> 5241 9241'`
  - `scripts/flail-gate.mjs`: must pass (the combo, the sweep's width, crosshair accuracy, free aim, live unfrozen
    zombies, impact numbers, blood, head hits, collapse).
  - `scripts/head-damage-gate.mjs`: the head model (eyes, skull, brain, wobble, dent). Known failures, all
    measurement issues: the popped-eye socket darkness, the cost check (±1.5 ms noise), and the painted-glow drop
    under main's brighter lighting (76–78% against an 80% bar).
  - `scripts/sdf-game-slug-gate.mjs` (shotgun placement, must pass) and main's `sdf-game-launcher-gate.mjs`.
  - Gates write photos into `docs/dev-notes/`; restore churn with `git checkout --` unless it changed legitimately.
- Tests are targeted only, never the bare suite: `npm test -- flail head damage torn gun-wet flesh gib-chunks game-actor`.
  `game-context-coverage` fails on `actorFill` and `fleshSpawnRng` (main's and ours); not from the flail work.

## What was built (all on `main` now)

Specs and plans: `docs/superpowers/specs/2026-09-26-spike-flail-design.md` (§§1–14),
`docs/superpowers/specs/2026-09-28-melee-head-damage-design.md` (§15 is the v2 model), plans
`docs/superpowers/plans/2026-09-26-spike-flail.md` and `2026-09-28-melee-head-damage.md`. Notes and photos:
`docs/dev-notes/2026-09-26-flail/NOTES.md`, `docs/dev-notes/2026-09-28-head-damage/NOTES.md`.

**The flail** (`webgpu/flail-swing.ts`, `flail-strike.ts`, `flail-chain.ts`, `game-flail.ts`, `flail-impact.ts`,
`flail-blur.ts`, `flail-blood.ts`; model `scripts/model_flail.py` → `public/assets/lab/flail.glb`)
- Click = a preset swing. Chained clicks run **R** (overhand) → **L** (cross) → **H** (a flat sweep, ±70°, the
  finisher); a pause over 0.35 s resets to R. The ball is a simulated chain that trails the haft and is pinned
  exactly on its impact point on the strike frame (at any frame rate).
- The strike goes through the **free-aim reticle** (`aimDir`), not the camera centre. A **head magnet** lands a
  strike that passes within 18 cm of the head on the head, through raised arms.
- About 11 body hits drop a zombie; head hits barely count toward the meter. The flail never decapitates.
- Impact: hit-stop then a slow tail (time scale 0.4 easing to 1 over 0.3 s), view-model recoil, camera pitch kick
  + judder + roll, an FOV pinch, a bigger zombie reaction and a head snap, shutter blur on the ball and chain,
  and blood that builds up on the ball, chain and haft (dries over ~2 min).

**Head damage v2** (`head-damage.ts` pure model; `head-deform.ts`, `head-eye.ts`, `head-crown.ts`,
`webgpu/game-head-damage.ts`, `game-brain-gib.ts`, `game-mesh-gibs.ts`; brain `scripts/model_brain.py`)
- Six regions (two orbits, brow, crown, two cheeks) wear away by ~0.40 per hit (H 0.55), with ±20% jitter.
  An exposed orbit shows a 3D eye; the next hit pops **both** eyes on stalks over dark sockets; the next head hit
  snaps them off and they fly in a comic arc and bounce. A skull stripped to bone, then cracked, sends a
  modelled brain mesh out and kills the zombie (head stays on). Jelly wobble (40% squash, ~4 Hz) plus dents; the
  skull deforms with the flesh on both skeleton paths.
- Engine hooks it added: `ZombieActor.setHeadDeform/reposeHead/rigImpulse`, `ActorBlastEffect.forceCollapse/gain`,
  `ChunkGpuView.morph`, `ctx.boot.attachPiece/spawnMeshGib`, `Wound.headRegion/headSlot`, a per-eye face glow mask.

**Wounds** (`torn-lips.ts` and the shader blocks): the flail's wounds are torn, splayed, thick, wet red
(`Wound.tear`, flag bit 3). Gun wounds (pellets, slugs) keep their crater shape and get the wet red lip
(`Wound.wetLip`, bit 4). Bone colour was restored on the procedural skeleton path and in settled-gib bakes.

**Off by default:** flying flesh bits (`setFleshBits(true)`; they read as giant round red blobs).

## Traps worth knowing

- **Free aim is on by default.** Any weapon ray must use `aimDir(ctx)`. Gates must also test with the reticle
  off-centre (`__sdfGame.setAimPoint`) or they hide this.
- **Frozen actors don't re-pose.** Sever/wound readbacks need the live body (`a.body`), and deform needs
  `reposeHead`. Gates freeze the crowd; play doesn't. **Test live, unfrozen zombies too** (the flail gate has a
  live section): frozen gates missed the raised-arms and lunge problems.
- **Attached pieces (eyes, plugs) are invisible until `warmBackground().gib === 'ready'`.** Poll it before photos.
- A first-hit wound's world position read back through `actorWounds` can drift ~7 cm (a `damage.ts` frame issue,
  fixed on main by another session); measure hits at the strike (`lastStrike.points`) rather than from wounds.
- The gib shutter-blur layer renders **flying gibs as faint grey smears** (found via the flesh bits; also affects
  brain lumps?). The flail's own ball/chain blur has its own tuned gains.
- Chunk views are pooled and each dangling eye is a marched draw (about 1.3 ms). Eyes are evicted last.
- Don't run implementer subagents in parallel in one worktree; commit with explicit pathspecs.

## To do (priority order; also in `TASKS.md` and `docs/tasks/combat-and-gore.md`)

1. **Owner's small tweaks** (he said there are a few) — get the list first.
2. **Optimization pass** (owner: after the look pass): the torn-wound draw cost (about +0.7 ms in the head gate),
   the dangling eyes' cost (~1.3 ms each pair), the first-swing hitch (one 31–39 ms frame, also with blur off),
   and the gib blur layer's grey smearing.
3. **Flesh as billboards / textured quads** (little tattered skin) to replace the marched bits (owner's idea).
4. **Red matter strings** (plan Task 33, exploratory): wet red drops that cling along a wound rim and sag; check
   what the blood sim and GOO layer can do first; stop if it needs a big new system.
5. **Head-gate cleanups:** retune the painted-glow bar under main's lighting; make the blood-blob-affected
   measurements robust (blobs survive `setBleed(false)`); the popped-eye socket reads crater-dark with a grey rim,
   not black (a deeper or separately drawn plug).
6. **Wound gaps:** wounds through zombie clothing and dynamite/explosion blasts don't get the wet lip.
7. **Later:** view-model wall clipping for all weapons (its own TASKS row); severed limbs as physical debris; a
   line-of-sight check for the strike (walls don't block it); the R overhand's drag is mostly above the frame.
