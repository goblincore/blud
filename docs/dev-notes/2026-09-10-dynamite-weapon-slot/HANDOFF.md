# HANDOFF — dynamite weapon slot / gib quality / explosion

**For the next agent. Read this first, then the four dev-notes it points at.**

## Where the work is

- **Branch:** `claude/dynamite-weapon-slot`
- **Worktree:** `.claude/worktrees/dynamite-weapon-slot` (node_modules symlinked to the
  primary checkout; run `scripts/link-dev-assets.sh` once for the Blood atlas mode)
- Branched from `fc7c70c7`. **The primary checkout was NOT used for this work** — an
  earlier session collided with a second agent there (see the TASKS.md memory entry).
  Keep the work in the worktree.
- Commit trail, FIRST session: `2e9ad849` feature · `01dd3eed` smaller explosion + atlas ·
  `42e07c95` arena · `040b3bd7` `?room=` · `51cef53a` unlimited ammo · `9c561f4b`
  vanish/gibs/light · `b6a019bb` prune + limb chunks · `bd280754` wound-probe cap ·
  `1a5f3adf` design note.
- Commit trail, SECOND session (2026-09-11, the gib/plume/cost pass): `275f2f05` the split
  piece set + staged release · `4cb8845b` the plume + the `fxSize` twice fix · `ced18faa`
  the wound phase · `e75468fb` §3(d) de-prioritised · `8426b5d3` the release look rig ·
  `0e31d32e` the mesh pre-bake declined · `e9af7ebd` §3(c) the pre-tear · `385d40da` the
  plume height settled · `c812c6fd` the plume's shape, in metres · `c3f96baa` the skeleton
  drawing as bone + the fallback burying it · `0f8507c2`, `27fc775c` the live-loop soak +
  the `selectSlot` trap · `c369c7c5` the frame cadence · `79717579` the crowd ribcage ·
  `e92d0992` the gate's A/B controls + the air burst.
- Commit trail, THIRD session (2026-09-11, the owner's "tubes and orbs" report): `e53f7edf`
  the collapsible DYNAMITE/GIB tuning panel + the pool default 24 → 64 + the live knobs,
  `dd3d5867` the pile-crowding rig and the gate assertion that reproduces the report.
- Commit trail, FOURTH session (2026-09-11, the owner's playtest bugs): the blast's rig
  shove (velocity passed where metres were wanted — bodies teleported off screen), the
  `aoesize` / `edge fling` / `blast light` panel knobs, and the `detonate` seam that was
  reporting a radius CONSTANT.

## The docs to read, in order

1. [`docs/dev-notes/2026-09-10-dynamite-weapon-slot/README.md`](docs/dev-notes/2026-09-10-dynamite-weapon-slot/README.md)
   — what the feature is, the knobs, the two bugs the gate caught, §3b the blast cost.
2. [`docs/dev-notes/2026-09-10-gib-quality-and-transition/README.md`](docs/dev-notes/2026-09-10-gib-quality-and-transition/README.md)
   — the gib, END TO END: why no bones showed (measured), the piece-set decisions, the
   staged body→gib transition, §3(c) the pre-tear, §5 what was measured, and the bone
   census that proves the skeleton draws.
3. [`docs/dev-notes/2026-09-11-explosion-plume/README.md`](docs/dev-notes/2026-09-11-explosion-plume/README.md)
   — the plume: what made it a ball, what changed, the shape in metres, and the two
   instrument traps that produced confident wrong numbers first.
4. [`docs/dev-notes/2026-09-11-piece-cost-and-the-pre-bake-decision/README.md`](docs/dev-notes/2026-09-11-piece-cost-and-the-pre-bake-decision/README.md)
   — what a detached piece costs, and why the mesh pre-bake is DECLINED.
5. `TASKS.md` — the entries at the top of "Current focus".

## What is DONE and verified

- `2` selects dynamite; hold LMB to cook, release to throw; the blast gibs live actors
  (the active game's first live-actor gib), lights the room, and has a procedural
  explosion. Gate: `node scripts/sdf-game-dynamite-gate.mjs <vite> <cdp>` — PASS.
- **Unlimited ammo is the default.** `?ammo=finite` is now the ONLY way to exercise the
  reload, so **`sdf-game-shorty-gate.mjs` pins it** — do not "simplify" that away.
- **The arena** exists (16×16×6 m, 8 zombies, `?room=arena` / `__sdfGame.teleport(6)`).
  ⚠ **The annex is now a through-room** (it gained an east door): a deliberate topology
  change. Three level gates were updated to assert BOTH halves (the door exists AND the
  closed sides still contain a capsule). If that is not wanted, rerouting the arena off
  room 3 or 4 is small — but then update those gates back.
- **The blast pause: 45 → 25 ms, then 18.1 → ~7.6 or 0 ms.** Root cause of round 1 was
  `probeFlesh` marching 150 `sdBody` folds per wound for a number only used as
  `min(1, thick / 2·lip)`; capped at `2·lip` (`?woundcap=0` is the control). Round 2
  capped the SECOND `probeFlesh` (the carve-depth one, capped exactly where the shader's
  slab stops binding) and stopped stamping 16 wounds on bodies the blast is about to gib
  (`woundsOnGibbed`, `?gibwounds=1` / `?carvecap=0` are the controls).
- **THE GIB IS BUILT** (2026-09-11): `src/lab/sdf-zombie/gib-parts.ts` splits the torso
  three ways and every limb at its joint, caps each cut plane with a `sub` sphere, and
  releases the SKELETON as its own bone-only chunks (11 groups: ribcage, spine/pelvis
  mass, skull, eight long bones). `gibActor` spawns every piece at its posed transform
  with zero velocity and releases the blast impulse over `?gibstagger` waves nearest
  first; §3(c)'s PRE-TEAR WINDOW (`?gibtear=<sec>`, default 0.1) bends the body outward
  from the blast before it tears. `chunkCensus()` reports what each piece was spawned as
  against what it will RENDER as (`bonePieces`, `boneRows`, `buriedBonePieces`,
  `bonesShadingAsMeat`), and the gate asserts it.
- **THE OWNER'S "i didnt see any skeleton chunks and the gib parts still looked like tubes
  and orbs" IS REPRODUCED AND FIXED** — and the cause was the POOL DEFAULT, not the piece
  set. `?maxchunks` shipped at 24, and the piece pool is GLOBAL: a blast that gibs several
  bodies can only afford the 24-piece split set for the FIRST one, so the later bodies fall
  down the tier ladder to `clusters+cage` — six tubes with the skeleton packed INSIDE them.
  At the old default the gate itself read `lastGibTier: clusters+cage`, 17 of that body's
  pieces dropped and 18 recycled on the frame they were born — and it PASSED, because the
  census assertion was skipped whenever the tier was not `parts`, i.e. skipped in exactly
  the degrading case. Default is now **64** (`?maxchunks=N`, 1..96) and the same gib reads
  `parts:24` for every body with `buriedBonePieces 0`. `scripts/sdf-pile-crowding.mjs` is
  the rig that proves it (five blasts in a row in the arena, at two caps) and the gate now
  asserts the shipped default never degrades the last body's shape.
- **THE COLLAPSIBLE TUNING PANEL** (`src/lab/sdf-zombie/webgpu/dynamite-panel.ts`): the
  owner asked for one ("or if you want me to manual tune please add another tuning panel
  that is collapsible"). Fourth slot (right:782px) beside GOO/WOUND/VHS, visible but
  collapsed, hidden with them on `H`. 19 rows generated from ONE key table that
  `dynamite-panel.test.ts` pins against `applyDynamiteTuning`'s switch cases. Presets:
  `split` vs `tubes (old)` (the A/B of his report) and `plume` vs `ball (old)`.
  Every gib knob it owns is now `let`, so a slider takes effect with no reload.

## What is NEXT

**EVERYTHING THE BRIEF ASKED FOR IS BUILT AND VERIFIED.** What is left is the
owner's judgement, plus two items this session DECLINED on measurement — both
documented with the numbers so they can be overruled rather than re-argued.

1. **OWNER LOOK CALLS — two, and they are the only gating items.**
   - **THE PANEL IS THE VEHICLE FOR BOTH.** Un-collapse `DYNAMITE` (fourth title bar,
     or `H` if the panels are hidden) and the look pass needs no agent: `mode`,
     `bones`, `maxchunks`, the whole pre-tear window, the burst's shape terms and
     both presets are sliders, live. COPY puts a console line on the clipboard.
     **Hard-reload the page first** — a long-open tab serves the previous module
     graph, which is one of the two explanations for a look pass that does not
     match the numbers (the other was the pool default, above).
   - **The release sequence:** `node scripts/sdf-gib-look.mjs 5391 9391 /tmp/gib-look`
     writes 10 frames (0 → 667 ms; the first frames are the body BENDING). It also
     asserts what a page can assert — the skeleton is in the marched frame
     (hiding the bone pieces changes the march-target `frameHash`, with a
     no-change control that must read identical) — but whether it READS as being
     torn apart is not a measurement.
   - **The plume:** `EXPLOSION_FX=atlas|procedural`, `FX_QS='&fxplume=0'` and
     `FX_TUNING='{"ringOpacity":0}'` on `scripts/sdf-explosion-fx-shot.mjs`.
     Shape and height are measured and match; colour and the final look are not.
   - `PLUME_KIND=air node scripts/sdf-plume-shape.mjs` is the OTHER reference
     sequence (the atlas's air SEQ is a fireball, and ours stays one).

2. **DECLINED, with evidence — build them only if the owner disagrees.**
   - **The per-archetype mesh pre-bake.** Measured three ways; the last one on the
     live loop's frame cadence: **16.70 ms in both arms** (22 of 22 pieces in
     frame), i.e. no frame-rate impact — the honest caveat being that a
     vsync-limited page hides any cost inside the budget, and `sdf:march` does
     show ~2.7 ms of a 16.7 ms budget. Against that: a rest-baked part cannot
     match a posed body (the seam the SDF pieces removed), every released piece
     would lose the body's accumulated wounds, and 24 parts per archetype need a
     boot-time bake pipeline. The useful consequence runs the other way: pieces
     are CHEAP in the frame, so `?maxchunks` is a LOOK lever and not a cost one —
     raising it buys more pieces on screen in a crowd, which is the arena's
     problem (a point-blank bundle gibs five bodies there).
   - **§3(d) the body-sized debris puff.** It existed to hide the one frame where
     the representation changes (an SDF body becoming a pre-baked mesh). There is
     no such frame now: frame 0 IS the body's silhouette, measured. A puff would
     only put a layer between the player and the gore he is judging, after he cut
     `?fxsmoke` to 0.38 for exactly that.
   - **The air burst as a mushroom.** The reference's air SEQ is a fireball and
     ours is too (fire 1.47 × 1.52 m against the ground plume's 2.72 × 2.18). Do
     not "fix" that without the owner asking.

3. **If a new pass is ever started on the gib, start from the census.** Every real
   bug this session found came from `chunkCensus()` (bones buried by the
   fallback; bones absent in a crowd), not from reading the diff. The instruments
   are committed: `sdf-gib-look.mjs` (the sequence + the skeleton check),
   `sdf-dynamite-soak.mjs` (the real loop), `sdf-piece-cost.mjs` (frame cadence),
   `sdf-plume-shape.mjs` (per-layer geometry), and `GATE_QS` to run the gate
   against its own A/B controls.

## Traps that cost real time — do not re-learn these

- **`__sdfGame.selectSlot()` TAKES A NAME, NOT A KEY NUMBER**, and until
  2026-09-11 it did not say so: `selectSlot(2)` — 2 is the key, the HUD says 2 —
  put the NUMBER in the slot machine, whose every comparison is against
  `'shotgun' | 'dynamite'`. The switch then "succeeded" (`phase: 'up'`), NOTHING
  was live, and every later press was dropped by `liveDyn` in silence: a soak rig
  spent an hour on "the throws never detonate" and found no error anywhere
  because there was none. The seam now REFUSES an unknown slot
  (`{ok:false, reason:'unknown-slot:2'}`) and the gate asserts that refusal. A
  driving script should pass `'dynamite'`.
- **THE REAL LOOP IS A DIFFERENT TEST FROM `step()`.** `scripts/sdf-dynamite-soak.mjs`
  runs the game on its own rAF loop (never calls `step`, never stops it) and
  throws real bundles: select by name, cook, release. That is where the pre-tear
  window, the deferred spawn and the view pool meet a variable dt and overlapping
  blasts. It asserts no page errors, a pool that never exceeds its cap, nothing
  left `tearing` or `pendingGibs` after settling, and that no bone piece ever
  shades as meat. Measured: 3 throws -> 3 detonations -> `bone 11 buried 0`,
  6 detonations / 8 gibs / 90 pieces in one run, peak pool 24 of 24.
- **Measure before optimising, and use the profile seams.** `__sdfGame.dynamite()
  .blastProfile` and `.resolveProfile` split the blast into resolve/gib/wound and
  trace/wound/cut. My first two diagnoses of this were both WRONG until measured: I
  blamed the chunk spawn (it was 3 ms) and then `sdBody`/`sdPrimitive` (the traces are
  5 ms of 56).
- **Single-run A/Bs are worthless on this machine.** The same build's resolve moved
  39 → 55 ms between runs; one light-sweep reading was a pure fluke that inverted on
  re-run. Compare arms **interleaved in one boot** (`scripts/sdf-wound-probe-ab.mjs`) and
  report medians. Do not run a GPU capture while the test suite is running.
- **`Page.captureScreenshot` returns what the COMPOSITOR last presented.** A page driven
  by `__sdfGame.step()` presents nothing between reads — three captures of three
  different states came back byte-identical. Use `__sdfGame.presentedShot()` (both
  capture scripts do).
- **...AND `presentedShot()` RETURNS THE LAST *PRESENTED* FRAME, SO DRAW ONE AFTER EVERY
  CHANGE.** Toggle something (hide the pieces, hide the bone pieces) and read immediately
  and you get the PRE-toggle image: the first version of the skeleton check reported
  "hiding every bone piece changes 0 px" exactly that way. `setRenderLock(true)` freezes
  the sim (tick mutates nothing, the draw still runs), so `step(1)` after a toggle is a
  comparable frame with no motion in it.
- **FOR "IS IT RENDERED?" ASK `frameHash`, NOT THE PIXELS.** A pixel differential needs the
  background to hold still and it does not: the explosion VFX ages in the RENDER path with
  its own dt, so with a burst alive every draw is a different picture (a no-change control
  read 55k px), and even with the sim locked and `?dynblend=1&dynfall=1` the empty scene
  varied by 3.3k px — more than the skeleton's own 1.7k. `frame-hash.ts`'s header says it:
  "the frame hash measures the march target and not the presented image". Three attempts
  went into learning that; reach for `frameHash` FIRST.
- **A knob in a rig's URL needs `?`, not `&`.** Appending `&gibtear=0` to a URL with no
  query makes it a PATH, the page 404s, and the failure reads as "__sdfGame never appeared
  (pageErrors: none)" — indistinguishable from a crash. `GATE_QS` now accepts either form.
- **THE PIECE POOL IS GLOBAL AND A PILE FROM EARLIER BLASTS IS CHARGED AGAINST A LATER
  BLAST'S BUDGET.** `maxChunks` bounds the LIVE VIEW count for the whole level, and a gib
  drops up to 24 views' worth of debris that stays for its lifetime. So the deeper into a
  pile you throw, the cheaper every body's shape gets: measured with
  `scripts/sdf-pile-crowding.mjs` (five blasts in a row in the arena), at `?maxchunks=24`
  the second blast gives `parts-core:16` then `clusters+cage:7` with **6 pieces carrying
  buried bones**, and at 64 both bodies get `parts:24` with 0 buried. A SINGLE-body blast
  does not suffer even in a full pile, because the new gib evicts the old debris to pay for
  itself — it is the MULTI-body blast (and the owner's arena, where a point-blank bundle
  gibs 3-5) that degrades. Any claim about "what the gib looks like" has to say which.
- **A RIG THAT RE-RUNS WHILE YOU EDIT WILL MEASURE A CACHED MODULE GRAPH.** The gate's
  falsification run (default pool set back to 24, expecting the new assertion to FAIL)
  instead reported the new value 64 and PASSED: Chrome had served its cached transform of
  `game-main.ts` while vite was correctly serving the edited file. Both the gate and the
  new rig now call `Network.setCacheDisabled`. If a rig's numbers do not move when the
  source does, suspect the cache BEFORE the logic.
- **A LIGHT THAT IS INVERSE-SQUARE CANNOT LIGHT A ROOM, AND THE PACKED LIGHT HAS NO
  SPARE FLOAT.** `DynLightInput.fill` is carried in the third vec4's `.w` — `cosInner`,
  which a POINT light never reads, because the cone branch is gated on `cosOuter > -1.5`
  and a point light packs -2 there. That is why adding the room-fill term needed no buffer
  layout change (LIGHT_FLOATS stays 12) and no `probe-gather-compute.ts` change. If you
  add another per-light parameter, that slot is now taken; the next one needs a 4th vec4
  in BOTH twins (probe-dynamic.ts and probe-dynamic.wgsl.ts) and their parity test.
- **A THROTTLED BACKGROUND TAB SILENTLY FREEZES THE PAGE.** Waiting in wall-clock time
  between measurements in a headless tab measures NOTHING: `requestAnimationFrame` throttles,
  the explosion light sat at `age 0` and never aged, the probe readback froze, and every
  `presentedShot()` returned the same stale frame. Two independent rigs reported "the fill
  does nothing" because of it. Drive frames with `step()`, and PRINT the quantity that
  proves the page advanced (the light's age) so a stalled page is visible rather than
  inferred. Related: `probeDynReadback()` stops updating after a few gathers within one
  boot (measured: arms 4-6 all returned arm 3's value) — ONE ARM PER BOOT.
- **`stepChunk` HAD ONE SURFACE: THE FLOOR.** A detached piece collided with a plane at
  `y < radius` and NOTHING else — no walls, no ceiling, no furniture — so a gib thrown at
  a wall left the level (owner: "the gibs dont bounce off the walls"). It now takes
  `ChunkColliders { boxes, ceilingY }`; the boxes are `levelColliders()` (the walls, split
  around doorways, which is why a piece can still fly through a door) and the ceiling
  comes from the page's existing per-enclosure `ceilingAt` (the collider boxes stop at
  WALL_H, so the roof is NOT one of them — a piece could leave through it, measured:
  4.87 m in 3 m rooms). Both fields are optional: a stepper given no geometry is
  bit-identical to the old one, which is what keeps the lab's tuning meaningful.
- **A CONTAINMENT RIG MUST ASK THE LOCAL QUESTION.** The first version of
  sdf-gib-wall-bounce.mjs asserted "every piece is inside the ARENA" and reported 5731
  escapes that were really pieces in the next room. The right invariant is "every piece
  is inside SOME enclosure" — the level's interiors tile the walkable space and the walls
  between them are solid, so a piece in none of them went through one. Read the box out
  of the page (`enclosureBoxAt`), never hard-code the level's rectangles in a rig.
- **A GATE THAT CAN ONLY PASS IS NOT A GATE.** The owner's bug lived inside a passing
  gate: the bone-census assertion is conditional on `lastGibTier === 'parts'`, so the
  degraded tier — the one that buries the skeleton — skipped the check entirely. When an
  assertion is conditional, ask what the OTHER branch does. Prove a new assertion by
  making it fail (that is what the falsification run above is), then restore.
- **THE SHOT SIGNAL'S `dirWorld` MUST BE A UNIT VECTOR, AND THE BLAST FED IT A VELOCITY.**
  `stagger.ts` scales `dir` by METRE amplitudes (lurchAmp 0.26) into `rootOffset` and
  `offsets.chest`/`offsets.neck`, so a 25.2-long "direction" produced an 8.5 m chest offset:
  the body tore in half for five frames and the rest-pose pull reeled it back ("the upper
  torso/arms/head fly off leaving just the legs and then they rubberband back"). Two owner
  reports came out of this one defect, from both ends. If a body ever deforms implausibly,
  check the UNITS of whatever drives the pose before anything else — a wrong unit here is
  invisible in a diff and looks like a physics bug.
- **`pos += delta` WITHOUT `prev` IS A KICK OF `delta/dt`.** A Verlet point's velocity IS
  `pos - prev`, so `impulseAt(bound, at, [0, 0.18, 0])` does not move a joint 18 cm, it
  gives it 10.8 m/s. That is why the blast's joint shove was never going to be tunable into
  something sane, and why the reaction now goes through the ROOT (`knockV`), which moves
  every joint together and cannot tear a body whose foot `bindRig` has PINNED.
- **`impulseAt` TAKES METRES, AND THE BLAST WAS FEEDING IT m/s.** That was the owner's
  "they are like teleported outside the screen then animated backwards": `blast()` passed
  `impulse.vel` (up to 25.2 m/s) into a function that displaces one rig point by that many
  METRES, so an edge body's joint went ~11 m out of frame and the rest-pose pull sprang it
  back. The type is `Vec3` in both cases, so nothing catches it — `RigImpulse`'s doc says
  the wiring must convert, and only this call site did not. If a body ever appears to
  teleport, check the units at the `impulseAt` call before anything else.
- **WHEN A KNOB LOOKS INERT, SUSPECT THE INSTRUMENT.** The `detonate` seam returned
  `radiusM: explosionRadiusM()` — a CONSTANT — so the brand-new `?aoesize` slider read
  4.6875 at every position and the gate's new assertion failed against working code. Every
  rig in the repo reads that field; it now returns what the blast actually resolved at.
  This is the third variant of "the measurement lied" in this project (cached module
  graph, un-drawn `presentedShot`, and now a hard-coded readback).
- **THE BONE CENSUS, NOT THE DIFF, IS WHERE THE GIB'S BUGS LIVE.** Two of them this
  session were invisible in the code and in the frames: a tier rung of bone-free flesh
  pieces won the tight-pool allocation and spent a body's whole allowance on meat
  (`bonePieces 0`), and a reserve floor of six did the same to EVERY body in the arena,
  where a point-blank bundle gibs five. Check `chunkCensus()` before believing a piece-set
  change is neutral.
- **Optimisations on the resolve/wound paths need an UNPRUNED REFERENCE, not reasoning.**
  A prim-level prune looked obviously sound and was wrong: `traceSurface` stops at the
  first crossing of the *body's* field, so a prim behind other flesh reports the near
  surface. A "lower bound" of 0.668 m came back against a reported hit at 0.598 m. Two
  more traps the same tests caught: scaled prims (the field is `(len − radius) * minScale`
  in a scale-divided frame) and strands/shells/bent cones (never prune them).
- **Reparenting a posed three.js object keeps its LOCAL transform.** A prop moved back
  into the camera rig kept the world position its flight pose wrote → the bundle drew at
  its last detonation position as a rig-local offset. Reset transforms at every hand-off.
- **A seam that resets counters on read is a trap** — `dynamite()` did, and the
  `blastProfile` call before it silently ate the split (every counter read zero).
- Fixing one node of a pair: `?maxchunks` was half-wired for a commit (`gibActor` honoured
  it, `spawnChunkPiece` still recycled on the old constant) — the gate's census caught it,
  not review. **Grep for the constant whenever you add a knob.**
- **`surface-nets.wgsl.test.ts` fails at HEAD** ("HULL_FIELD passes mapBody exactly the
  arguments MAP_BODY declares", 17 vs 19). Pre-existing, confirmed in the clean primary
  checkout. Do not chase it.

## Commands

```
# servers (own your ports; the ones from the last session may be gone)
LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 . scripts/lab-servers.sh && lab_servers_up

node scripts/sdf-game-dynamite-gate.mjs    5391 9391   # gameplay gate, PASS expected
node scripts/sdf-explosion-fx-shot.mjs     5391 9391   # differential burst capture + PNG pairs
node scripts/sdf-explosion-light-check.mjs 5391 9391   # whole-frame light sweep
node scripts/sdf-blast-profile.mjs         5391 9391   # where the blast's time goes
node scripts/sdf-dynamite-cycle.mjs        5391 9391   # six throws, prop-pool accounting
node scripts/sdf-wound-probe-ab.mjs        5391 9391   # interleaved probe-cap A/B
node scripts/sdf-gib-look.mjs             5391 9391 /tmp/gib-look  # release sequence + skeleton check
node scripts/sdf-dynamite-soak.mjs        5391 9391 [rounds]       # REAL rAF loop, real throws
node scripts/sdf-piece-cost.mjs           5391 9391 [qs] [bursts]  # frame cadence, pieces shown vs hidden
node scripts/sdf-plume-shape.mjs          5391 9391 [qs]           # per-layer geometry (PLUME_KIND=air)
node scripts/sdf-pile-crowding.mjs        5391 9391 24 64         # 5 blasts in a row, per-cap: what each body became
node scripts/sdf-blast-light-reach.mjs    5391 9391 0 1.2 3       # does the light cross the room? per-tile + probe readback
node scripts/sdf-gib-wall-bounce.mjs      5391 9391               # do detached pieces stay in the room?
GATE_QS='&gibtear=0' node scripts/sdf-game-dynamite-gate.mjs 5391 9391  # the gate on an A/B control
npx tsc --noEmit && npx vitest run                     # 4792 pass, 1 pre-existing failure
```

## Knobs

`?room=<id|name>` · `?ammo=finite` · `?maxchunks=N` (**default 64**, 1..96; 24 is the old
budget and the cost A/B) · `?gib=clusters|pieces` ·
`?gibvel=K` · `?dynspeed=K` · `?fxsize=` `?fxsmoke=` `?fxlife=` `?fxgain=` `?fxlight=` ·
`?explosionfx=procedural|atlas|standin` · `?woundcap=0` · `?carvecap=0` · `?gibwounds=1` ·
`?gibtear=<sec>` (0 = the instant swap) · `?gibstagger=N` (1 = no stagger) ·
`?fxplume=0` (the round-ball A/B) · `?gibbones=all|core|off` ·
`?aoesize=K` (AOE radius multiplier, default 1 = 4.6875 m) · `?edgekick=K` (fraction of
point-blank launch that survives to the radius edge, default 0.45) · `?fxlight=K` (how much
the blast lights the room, default 1; the arena's whole-frame mean moves +8.89 there and
+15.19 at 2x) · `?fxspread=K` (how far that light REACHES — the soft room-fill component,
default 1.2, 0 = the old pure point light)

## Seams worth knowing

`__sdfGame.dynamite()` (slot, cook, flights, gib counters, `gibTearSec` / `tearing` /
`pendingGibs`, `lastGibParts`) · `.chunkCensus()` (`live`/`baked`/`views`/`cap`,
`inFrustum`, and the BONE census: `bonePieces`, `boneRows`, `buriedBonePieces`,
`bonesShadingAsMeat`, `organsShadingAsBone`) · `.actorList()` · `.frameHash(0)` (the
deterministic per-pass readback) · `.presentedShot()` (the canvas — DRAW FIRST) ·
`.passTimings()` · `.setChunksVisible(on)` / `.setBonePiecesVisible(on)` (differentials:
they hide, they do not destroy) · `.setRenderLock(on)` (freeze the sim, keep drawing) ·
`.setLoopRunning(on)` · `.setGibWounds(on)` · `.explosionFx()` (tuning, `layerExtents`,
`burstHalfHeightM`, `liveBursts`) · `.selectSlot('dynamite')` — A NAME, not the key number ·
`.setDynamiteTuning({ maxchunks, mode, bones, plume, ... })` / `.dynamiteTuning()` — the
PANEL's own keys, the same ones its sliders and COPY use (`dynamite-panel.ts` is the one
source; `dynamite-panel.test.ts` pins them against the setter) · `.dynamitePanel(on)` /
`.dynamitePanelCollapsed(on)` · `.dynamite().gibTierLog` / `.lastBlastRadiusM` ·
`.chunkStates()` (every live piece: limb, pos, vel, radius, settled) ·
`.enclosureBoxAt(x, z)` (the room/tunnel box a point is in, or null) — EVERY body's rung for the last
blast, which is the field that exposes a multi-body degradation that `lastGibTier` hides.

## Standing constraints

- **Extracted Blood assets are dev placeholders**: never commit, never ship. That is why
  `atlas` is not the default. `?explosionfx=atlas` falls back to procedural discs without
  `scripts/link-dev-assets.sh`.
- **The look of everything here is UNJUDGED BY THE AGENT THAT BUILT IT** — it could not
  see images. Every aesthetic claim in the commits is a measurement (footprint,
  brightness) or an owner quote, never a visual judgement. Get the owner's eyes on it.
