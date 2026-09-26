# Characters

SDF characters: authoring, prims, the roster, blends. Part of the task wiki: [TASKS.md](../../TASKS.md) is the front page. Sections are newest-first where dated; each keeps its own history.

## Juggernaut (power-armour chaingunner, first soldier variant) — started 2026-09-25

- [x] **Soldier family trait**: `MotionProfile.family` + `isSoldierFamily()` replace ~37 `name === 'soldier'` checks,
  so a renamed variant keeps injury rules, kit breakoff, casings, footwork, collapse. No behaviour change.
- [x] **Body + kit authored**: `juggernaut.blob` (soldier x 1.15, 1.3x shoulders, no hair) and `juggernaut-kit.wam`
  (power armour, sealed helmet, lenses, backpack). `?character=juggernaut`. [Notes](../../docs/dev-notes/2026-09-25-juggernaut/NOTES.md)
- [x] **Chaingun**: TS-generated `juggernaut-chaingun.glb`, `heavy` hip carry (both hands pinned), `CHAINGUN_TUNING`
  (0.9 s spin-up, 15-24 rounds at ~10/s, sweep, no strafe or back-off), single rounds, spinning barrels, brass casings.
- [ ] **Blocked on WAM**: run `scripts/build-wam-kit.sh juggernaut` locally, then `juggernaut-kit.test.ts` (skips until then).
  Then GPU frames for the owner look, and a first playtest (the plan's open items).
- [x] **Plate armour works** (`plate-armor.ts`): plates absorb rounds until shot off (helmet guards the head), hips bare,
  blasts wound through, pellets never stagger him, slugs do; the kit sheds by the actor's plate state.
- [x] **In the game**: one juggernaut in the arena (`RoomDef.juggernauts`); `?spawn=juggernaut` fills the zombie slots.
  [Spec](../../docs/superpowers/specs/2026-09-25-juggernaut-design.md) · [Plan](../../docs/superpowers/plans/2026-09-25-juggernaut.md)
- [ ] *Next variant candidate:* Grenadier (gas mask, grenades flush last-known position, dodges dynamite).

## Bride (sword melee enemy) — first pass 2026-09-24

- [x] **Body, face, cloth, kit:** SDF flesh (wrong anatomy, stigmata), corpse-makeup face sheet, shell
  bodice/skirt/veil/hair/stockings, WAM plate+boots+chain+crosses kit. [Notes](../../docs/dev-notes/2026-09-24-bride/NOTES.md)
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

## Prim ceiling 128 -> 256, per-body texture width — done 2026-09-24

- [x] **`MAX_PRIMS` = 256** (flesh + bone). Each body's data texture is `primStride(total)` wide: 128 up to 128
  prims, then 192/256, so the shipped cast pays nothing. Crowd types size from their first body; lab hero is 256.
- [x] Gates: bench stills A/B/C/CZ and the game crowd path's float march target + prim-work buffers byte-identical
  to base; melee `sdf:march` 13.9-14.7 vs 13.4-14.7 ms; cold `drawOnce` median 1218 vs 1242 ms (noise, load ~12).
  Costs per width in `.claude/skills/authoring-sdf-characters/reference.md` ("Primitive budget").
- [ ] Next wall for the bride: **64 prims per cluster** (`MAX_CLUSTER_PRIMS`) — hair + face both land in `head` (34 now).
- [x] 2026-09-26 `game-context-coverage` green again: `spawnOverride` -> `ctx.boot.spawnOverride`, `artScene` -> `ctx.world.artScene`.
- [x] 2026-09-26 `blob-measure` "clears the flag" green again: the half-blend default (3662c1ca6) moved the mouse's
  fingertips from ~0.74 to ~0.76 of height, into the old `--range 0.75:1` legs window; the window is now `0.8:1`.

## Thin-prim "lines in the air" (bride) — fixed 2026-09-24

- [x] **Not a renderer bug: a rig bind.** `bindRig` bound each prim end to the nearest rig point of the WHOLE body,
  so the bride's 10 cm thigh drip rode her hand and stretched to 45 cm when the arm moved. Distal joints (elbow/knee
  and beyond) now bind only their own limb's prims. Also fixes minotaur, schoolgirl(-alt), female, cyclops binds.
  Gate: `rig-bind.test.ts` (cast-wide) + `characters/thin-fixture.blob`. Bride's drip can go back to 10 cm.
- [ ] **Other posed-vs-rest stretch, pre-existing, separate cause** (frozen lab pose, prim length change): gnasher
  skull line 315 +46 cm, cyberdemon chest 195 +26 cm / spine 202 +17 cm, minotaur shin/foot 324/375/379 +11-17 cm,
  goblin/gnasher feet +8-10 cm. Candidates: pelvis-root binds, own-chain knee/ankle drift. Not investigated.

## Cultist (cloaked zombie) + SDF-cloth spike — first pass 2026-09-23

- [x] **New character `cultist`**: hooded robed zombie, the costume all `shell` cloth; skirt swings on a `hem`
  Verlet pendulum, wind gusts push it; `GLIDE` gait keeps legs in the robe. 11 tests. [Notes](../../docs/dev-notes/2026-09-23-cultist/NOTES.md)
- [x] Face passes 2-3 (scowl brow, socketed eyes, hooked nose; heavier jaw + teeth), khaki robes; variant
  `cultist-cowled` kept (lower face hidden). Owner: good enough to merge (2026-09-23).
- [x] **Tommy gun**: cultist-smg.glb (Blender script), GLIDE_CARRY + low/aim carries, `profile.gunner` -> soldier
  brain on SMG_TUNING (bursts), rounds aimed at chest height. Game: `?spawn=cultist`. Palette/sheet now per-character.
- [x] **Playtest 2026-09-24 fixes**: cultists are SOFT targets (`MotionProfile.soft`: first bullet/blast kills); robe hits
  are painted decals (blood soak / scorched hole), never carved and never severing; the hem kick that spun the robe
  is gone; a kill throws the body along the shot (`soft-death.ts`); the hood drops on death (`.blob` `when=alive|dead`,
  `death-state.ts`). Soldier unchanged (still carved).
- [ ] **Cultist perf pass** — IN PROGRESS, paused for a quiet machine. Landed: upper-bound cull (all characters, -31% cultist
  / -34% zombie prim evals, pixel-identical). Findings + next steps: [PERF.md](../../docs/dev-notes/2026-09-23-cultist/PERF.md). Original plan:
  cut hidden flesh under the robe, merge robe shells, consider baking the hands (owner: no digit-level damage needed).
  Owner open to a mesh/baked robe if SDF can't get near ~1.5x a zombie.
- [ ] **Cloth feel**: hood and robe read stiff (owner). Options: more pendulum points (hem flare ring, hood tail),
  travelling warp waves driven by velocity, or a prebaked cloth sim. Robe distortion on the death throw.
- [ ] **Hip fire**: the cultist fires from the shoulder; owner wants a random mix of hip and shoulder bursts.
- [ ] (minor) **Head-explosion bench in the blood lab**: a head on a stake, sliders for the Scanners pop (swell time/size,
  burst drops/scraps/speeds, clump count, eyeball arc) and scrub/replay back and forth. Owner idea 2026-09-24.
- [ ] Cultist polish: own `aim` carry (left hand on the foregrip), player damage (no player health yet), SMG audio.
- [x] **Cloth hit reactions** — paint yields inside wounds (scorched fray); heavy rounds tear + reveal, small
  calibre = dark bullet hole (flags bit 1), size-scaled fillet, hem kick. Lab: Ctrl-click = SMG hole. Fibre puff w/ SMG.
- [ ] *Idea (owner, not this session):* flammability tiers — clothed characters catch/burn differently from bare flesh.

## Broodmother (spider-bodied temptress) — first pass 2026-09-22

- [x] **New character `broodmother`**: SDF body (`broodmother.blob`, prose-authored, Vore lineage but fleshy):
  slim woman out of a spider cephalothorax, 8 flesh legs, 3 orbs, prim face. 120/128 prims, 13 tests.
  [Notes + frames](../../docs/dev-notes/2026-09-22-broodmother/NOTES.md). Awaiting owner look.
- [ ] **Spider gait**: static in the lab — `gait.ts` maps no joint for spider leg bones. Alternating-tetrapod
  leg cycle + torso sway. Not started: attacks, brain, sounds, game-page spawn.

## Ogre (chainsaw brute) — first pass 2026-09-22

- [x] **New character `ogre`**: SDF body (`ogre.blob`, prose-authored, Quake-ogre lineage), WAM kit (belt, kilt,
  breeches, boots, bracers), Blender-scripted chainsaw PROP held two-handed via a new `saw` carry, `STOMP` gait +
  `OGRE_PROFILE`. 25 tests. [Notes + frames](../../docs/dev-notes/2026-09-22-ogre/NOTES.md). Awaiting owner look.
- [x] Calf through the breeches mid-stride and the kilt's back-hem V — fixed (deeper calf backs, belt/kilt refit).
- [x] Bent face prims lost their bow under a turned head (`applyRig` did not rotate `bend`) — fixed; lips painted.
- [x] Owner pass 2026-09-22: red glowing eyes, long pointed nose, thick parted lips, low hunch KEPT, long ape
  arms, chainsaw now DRAGGED one-handed behind him (new one-handed `drag` carry: `oneHanded`, `rightPole`).
- [ ] Polish: thigh-root lobes read as buttocks above the belt from behind; gut blend; hunch hides the mouth
  from above; saw nose floats a few cm off the floor.
  Not started by design: attacks (saw swing / grenades), brain, sounds, a game-page spawn.

## Character blends and zombie heading — owner accepted 2026-09-17

- [x] Half-strength round flesh blends, matching CPU/GPU/gib geometry, and heading-dependent torso/foot/attachment fix on main.
  [Wrap-up, measurements, verification and lessons](../../docs/dev-notes/2026-09-17-character-blends-wrap-up.md).

## Skeleton migration wrap-up — 2026-09-08

- [x] Mesh actor skeletons accepted and merged into main; now the forward default, including production.
- [-] Further aesthetic tuning paused; cavity brightness remains open. [Handoff](../../docs/dev-notes/2026-09-07-skeleton-comparison/wrap-up.md).

## Roster — bloatmaw — 2026-09-09

- [x] `bloatmaw` merged (`5aae04b0`): a floating flesh ball, mostly mouth, with
  tiny shackled arms. Third prose-brief character; the roster's FIRST legless one.
- [x] Floating solved deliberately: `stance` OMITTED (grammar knows only
  humanoid/digitigrade) so `checkStance` is off by choice; hover gap 0.302 m named;
  a vestigial spine chain keeps the gait wiring happy — `gait.ts` `leg()` returns
  zero offsets for a missing chain, so the shamble degrades to root sway.
- [ ] Brow still reads as a flattish lid, not a fleshy ridge with sockets; the
  little wings are barely visible. Both are "does it read?" calls.
- [!] ALL FOUR ROUNDS WERE AUTHORED BLIND — the Chrome sandbox fix
  (`70147f98` + `7c20c17a`) landed only after r4. The next pass is the first that
  can see its own frames.
- [-] Ships `blob:silview` / `blob:inspect` — CPU renderers the blind runs wrote
  for themselves. Useful; keep.

## Roster — gnasher — 2026-09-09

- [x] `gnasher` merged (`982024f3`, polished `dec159cb`): a hunched pink flesh
  brute. Second character from a PROSE BRIEF only. SDF flesh + horns/tusks WAM kit.
- [x] Round 1 was authored BLIND (deepseek-v4.1-flash) and committed three of its own
  failing pins, skipped its kit and never rendered. Rounds 2-3 ran on `deepseek-v4-flash-vision-exp` and fixed all three by moving GEOMETRY, not thresholds.
- [ ] Still thinner from the side than the front promises. The arm-daylight pin
  (`> 0.038`) caps torso width, so going further is a deliberate trade, not more tuning.
- [!] `blob:render-check` not run on it (owner accepted on manual turntable review).
- [-] `scripts/gnasher-{silhouette,head-colour}.ts` are general CPU analysis tools
  despite the names — rename generically when a second character wants them.

## Roster — cyberdemon — 2026-09-08

- [x] `cyberdemon` merged (`bc95b19f`): the first character authored from a PROSE
  BRIEF ONLY — no reference mesh, no plate. SDF flesh + WAM kit. [Spec](../../docs/superpowers/specs/2026-09-08-cyberdemon-character-design.md).
- [ ] Two accepted cosmetic weaknesses to fix later: the lit eyes read as a cyan
  visor band (the failure mode `face.ts` documents), and the red chest cabling reads as a flat band, not bundled loom.
- [!] Its dispatch run CRASHED with dispatch-ui and committed nothing; the work was
  rescued off the worktree. `blob:render-check` has not been run on it.
