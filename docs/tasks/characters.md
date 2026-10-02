# Characters

SDF characters: authoring, prims, the roster, blends. Part of the task wiki: [TASKS.md](../../TASKS.md) is the front page. Sections are newest-first where dated; each keeps its own history.

## Goblin refinement pass (body, kit, weapons, rig, animation) — phase 1 (body) done 2026-10-01

The owner's complaints:
- the armour kit clips and fits badly;
- the buckler and the "axe" are poorly modelled and held nonsensically;
- the body is a series of orbs and should be smoother;
- the rig needs work and the animation needs an overhaul.

The goblin is also the player character (the first-person arms copy its palette) and the star of the Flat's cutscenes,
so this pass matters more than for an enemy. Audit (read-only, 2026-10-01), likely causes:

- **Orbs.**
  - The ball joints are deliberate (`goblin.blob:252-278`): the nubs are 1.3–1.8× the shaft radius.
  - The blends are 0.0014–0.005 and are then halved (`roundBlendScale` 0.5, `build-body.ts`), so fillets come out at about 3–10 mm. The zombie's median blend is 0.012, giving about 24 mm.
  - The torso is five ellipsoids. The quality bar for the body is `zombie.blob` (tapered bars, no nubs).
  - `goblin-blob.test.ts` pins arm daylight, so a fatter torso blend eats it.
- **Kit.**
  - `goblin-kit.wam`'s skeleton is a hand-copied transcription of the `.blob` (metres ÷ 1.30, pitch flipped).
  - The skin is near rigid: 18 of 623 vertices are weighted to more than one joint, and the feet own none.
  - The breastplate is rigid per ring. The pauldron is buried 36 mm by design.
  - The tests check the rest pose only. There is no skeleton-parity test; `juggernaut-kit.test.ts:117` has one to copy.
- **Buckler and cleaver.**
  - Both are WAM groups, rigid to the hand bone. The cleaver is anchored at the fingertip (`hand.r at=1.0`).
  - The hand has no roll and is one mitten ellipsoid, so there is no fist to grip with.
  - The proper system exists and the goblin does not use it: `MotionProfile.prop` (`gripReach`, `fistOnGrip`), `carry.ts`, `webgpu/held-prop.ts`, `sword-swing.ts`.
  - No shield or left-arm carry exists anywhere yet.
- **Rig.** Two-point bones with no roll, and the known 8–10 cm foot stretch (below).
- **Animation.**
  - The goblin has none of its own: `motionProfileFor('goblin')` falls back to the zombie's SHAMBLE, with metres tuned for 0.96 m legs (the goblin's are 0.56 m) and the zombie's unarmed attacks.
  - The bar is the soldier family (clip-derived gaits, planted footwork, carries).
- **Also:** bone pitches above about 90° do not take in the look-dev pose overrides
  ([room look-dev notes](../dev-notes/2026-10-01-flat-room-lookdev/notes.md)).

- [x] **Spec** ([design](../superpowers/specs/2026-10-01-goblin-refinement-design.md), owner-approved structure,
  2026-10-01). The goblin is the protagonist, seen armed in-game (no enemy AI). It holds **the player's weapons**; the buckler
  and cleaver are retired. **The hands stay orbs** (an early-3D style). Body: **variant A, "sinew"**, picked from three
  rendered variants ([look-dev](../dev-notes/2026-10-01-goblin-body-lookdev/)).
- [x] **Phase 1, body:** re-authored to variant A (plan `docs/superpowers/plans/2026-10-01-goblin-body-phase1.md`):
  continuous torso, tapered limbs, orbs only at the shoulders, hands, ankles and toes; the shoulder round is the arm's
  `core`. All goblin-reading tests pass plus three new pins (the whole `src/lab/sdf-zombie/` suite: 6604 tests), the
  pack golden is re-pinned, and `blob:render-check` exits 0. **Owner approved 2026-10-01** ("lgtm") from the lab
  turntable ([frames](../dev-notes/2026-10-01-goblin-body-lookdev/lab/)); the profile (gut not reading in front) is
  accepted as is.
- [x] **Body grain** (owner, 2026-10-01: "apply the noise texture that is on his face to his body"):
  [spec](../superpowers/specs/2026-10-02-body-grain-design.md), [plan](../superpowers/plans/2026-10-02-body-grain.md).
  A palette `grain` in the face sheet's units: face-sized 3.5 mm cells, an albedo multiply and a bump in rest space; the goblin sets `grain 0.10`. **Owner approved 2026-10-02**
  ("fine for now"), as built: coarse cell 0.012, `surfaceNoiseAmp` 0.22, the painted and wound fades kept
  ([frames and numbers](../dev-notes/2026-10-02-body-grain/notes.md)). Built through dispatch (GLM 5.3 flash).
  **Reworked 2026-10-02 after the owner saw it on the armoured goblin** ("it looks like big pixels ... keep them small,
  fine if they disappear at distance, more like a bump map, like pitted pores"): the 1.2 cm coarse octave is removed (at
  normal framing the fine cells are sub-pixel, so the coarse squares were all that showed) and the albedo swing is a
  35% share of the face's while the tilt keeps the face's full strength. The body now has no grain beyond ~0.9 m in the
  lab turntable. GPU `render-check` ok; the cold-boot and march-hash gates of the original build were NOT re-run for this
  edit (shader text changed, 4 march-golden entries re-pinned; it removes code, so boot cost should only fall).
- [~] **Phase 2, armour: built 2026-10-02, awaiting the owner's final look.** [Spec](../superpowers/specs/2026-10-02-goblin-armour-design.md) ·
  [plan](../superpowers/plans/2026-10-02-goblin-armour.md) · [notes and frames](../dev-notes/2026-10-02-goblin-armour/notes.md).
  Painted dark-grey pants and a dirty off-white tank top (paint on the SDF, so no clipping and wounds still work); mesh
  boots, gaiter cuffs, knee plates, utility belt with pouches, football-pad pauldrons with a lame, left-pauldron spikes,
  a loose (oversized) chest yoke to the neck with a flared collar, round sunglasses with ear hooks, rust and wear. Flesh
  feet removed (the boot is the foot; restore lines are commented in `goblin.blob`). Cleaver and buckler removed (retired
  by this spec). Bandoliers were built and removed ("too busy"; saved in the notes folder). Fit pinned in
  `goblin-kit.test.ts` (tuck, loose-plate standoff, boot/cuff/belt standoff). Walk-pose clip check is by eye
  (`BLOB_POSE=walk`), not a vertex-level skinned test. Open: Blender for hero-quality plate (owner's option, see notes).
  The kit is rigid per bone, so the pads/yoke could be exported from Blender as separate skinned meshes.
- [~] **Phase 3, held weapons: thin first pass done 2026-10-02** (owner: "keep it thin, shotgun first"). The goblin holds the
  player's double-barrel shorty (`GOBLIN_PROFILE`, `shorty-double.glb` as a held prop, no model work), low and aim carries
  checked from 8 yaws with no clipping. [Notes](../dev-notes/2026-10-02-goblin-shotgun/notes.md). Not done: other weapons
  (the flail is the harder grip test), firing, goblin-specific carry angles (the soldier's are used), `chest` carry.
  - `webgpu/goblin-skin.ts` keeps `forearmRadius` 0.028 and `forearmElbowRadius` 0.038, documented as the goblin's
    forearm bar and elbow blob, which phase 1 removed (both constants are unreferenced). `handRadius` 0.046 is
    hard-coded and must stay equal to `goblin.blob`'s hand.
- [~] **Phase 4a, the in-game gait: built 2026-10-02, awaiting the owner's look in motion.** [Spec](../superpowers/specs/2026-10-02-goblin-gait-design.md) ·
  [plan](../superpowers/plans/2026-10-02-goblin-gait.md) · [notes and frames](../dev-notes/2026-10-02-goblin-gait/notes.md).
  "Scheming scamper": `GOBLIN_WALK`/`GOBLIN_RUN` in curve mode on the soldier's stride curves, retimed for 0.56 m legs
  (cruise 1.19, run up to 2.77 m/s, derived and pinned), stooped (lean 12/18 degrees), carry arms for the shotgun. Foot
  stretch measured: gone (flesh feet removed; only the neck cord stretches, +20 mm, under the collar). Only stills checked:
  tempo, bob, skating and the feel in motion are the owner's gate. The curve source is swappable for a hand-authored clip
  via `npm run gait:curves`.
- [ ] **Phase 4b, the Flat's authored poses and clips** (sit, type, recoil, stand, reach; vest and shorts): own spec,
  authoring route (Blender armature -> bone angles, or keyframes) still to decide. Cautionary case: the bride (shelved
  for janky animation and a sword clipping the body).
  - `goblin.blob`'s neck vertebra bead (`blob head on neck at=0.30 ...`) is a zero-length head-limb prim, so
    `rig-bind.ts` (`ridesHead`, ~line 388) binds it to the RIGID head: it is 94 mm below the skull pivot and will slide
    19-47 mm into or off the neck as the head pitches. Make it a short bar (`bar head on neck from=0.28 to=0.32 ...`)
    so it binds per end, and check with `__sdfLab.heroPosed()`. `female.blob:107` has the same pattern.

## Warbull (cyber-minotaur: flesh + bolted-in machinery, rockets + charge) — second draft from the owner's reference plate 2026-09-27, awaiting kit build + playtest

- [x] **Second draft** (owner rejected the first as the existing bull brutes rescaled): a fresh body from
  `docs/dev-notes/refs/warbull-reference.png` (front silhouette IoU 0.85), face decal cropped from the plate, the
  plate's kit (red cable belt, chrome braces, one shod hoof), the plate's cannon. Gameplay unchanged.
  [Notes](../../docs/dev-notes/2026-09-27-warbull/NOTES.md)

- [x] **Body** (Task 1): `warbull.blob` = `minotaur.blob` x 1.28 (horn tip 2.60 m) minus its painted metal; left
  flesh horn and eye only (the right side is kit); a hump behind the neck; face decal baked from the minotaur mesh
  (`warbull-face.png`, the minotaur's own PNG never existed). `?character=warbull`. 13 pins.
  [Notes](../../docs/dev-notes/2026-09-27-warbull/NOTES.md) · [Spec](../../docs/superpowers/specs/2026-09-27-warbull-design.md) · [Plan](../../docs/superpowers/plans/2026-09-27-warbull.md)
- [x] **Kit authored** (Task 2): `warbull-kit.wam` (hooves, knee cops, hock pistons, spine rack + conduit, reactor + cables,
  steel horn, optic, cheek plate, shoulder cap, gun-arm sleeve; brass collars at every insertion). Pre-flighted without
  WAM by the new `scripts/wam-preflight.ts` (a shadow of WAM's maths, checked against the juggernaut build).
- [ ] **Owner: build the kit** `scripts/build-wam-kit.sh warbull`, then `warbull-kit.test.ts` (13 pins; skips until built).
- [x] **Looks + blinking lights** (Task 3): `chrome`/`cable`/`led`/`core` looks; pure `status-lights.ts` (heartbeat idle,
  strobe on aim, stutter stunned, LED drop-outs with plate damage, red core when enraged) driven by the mind via
  `GameActor.statusLights()`; the lab turntable gets an idle heartbeat.
- [x] **Launcher + rockets** (Task 4): generated `warbull-launcher.glb` (casing swallows the fist, 3-tube indexing
  cluster), grid-solved one-handed `launcher`/`launcherLow` carries, `ROCKET_TUNING` (1 s telegraph, exactly 3 rockets),
  pure `rockets.ts` (slow 9 m/s warheads) detonating through the dynamite path, player blast damage with falloff.
- [x] **Plates on the machinery + the disarm** (Task 5): region plates (`PlateSpec.region`, `kitBones`) so only the metal
  stops rounds; shooting the launcher off drops the prop, ends the ranged mode, turns the core red. Also fixed his head
  pivot (the minotaur rig's neck ends deep in the traps, so the gaze nod swung his head 24-55 cm).
- [ ] Minotaur has the same head-pivot problem (cranium 0.48 m above the neck pivot); fix = the warbull's re-fraction.
- [x] **Charge + brawl + rage** (Task 6): pure `charge.ts` (telegraphed windup, locked line, 3.2 m/s run, one hit,
  wall = 2 s stun); `makeWarbullMind` layers it over the rocket brain, and once disarmed a one-armed brawl brain;
  `MindOutput.runSpeed` makes the legs run the charge; charge hit 30.
- [x] **In the game** (Task 7): one warbull in the arena (slot 1, beside the juggernaut); `?spawn=warbull`.
- [ ] **Owner playtest** (checklist in the notes): look, telegraphs, rocket dodgeability, charge/stun, disarm, brawl.

## Juggernaut (power-armour chaingunner, first soldier variant) — playable 2026-09-26

- [x] **Soldier family trait**: `MotionProfile.family` + `isSoldierFamily()` replace ~37 `name === 'soldier'` checks,
  so a renamed variant keeps injury rules, kit breakoff, casings, footwork, collapse. No behaviour change.
- [x] **Body + kit authored**: `juggernaut.blob` (soldier x 1.15, 1.3x shoulders, no hair) and `juggernaut-kit.wam`
  (power armour, sealed helmet, lenses, backpack). `?character=juggernaut`. [Notes](../../docs/dev-notes/2026-09-25-juggernaut/NOTES.md)
- [x] **Chaingun**: TS-generated `juggernaut-chaingun.glb`, `heavy` hip carry (both hands pinned), `CHAINGUN_TUNING`
  (0.9 s spin-up, 15-24 rounds at ~10/s, sweep, no strafe or back-off), single rounds, spinning barrels, brass casings.
- [x] **Kit built** (`juggernaut-kit.gltf` on main) and `juggernaut-kit.test.ts` green (9 tests: containment, sealed helmet,
  pauldron crown, boots on the floor, rest identity). **Owner playtest 2026-09-26:** "quite decent, does what it says on the tin".
- [x] **Plate armour works** (`plate-armor.ts`): plates absorb rounds until shot off (helmet guards the head), hips bare,
  blasts wound through, pellets never stagger him, slugs do; the kit sheds by the actor's plate state.
- [x] **In the game**: one juggernaut in the arena (`RoomDef.juggernauts`); `?spawn=juggernaut` fills the zombie slots.
  [Spec](../../docs/superpowers/specs/2026-09-25-juggernaut-design.md) · [Plan](../../docs/superpowers/plans/2026-09-25-juggernaut.md)
- [ ] **Armour aesthetic refinement** (owner, 2026-09-26): the power-armour design wants a polish pass (`juggernaut-kit.wam`).
- [ ] Unmeasured: cold boot with the extra `juggernaut@6` crowd type; chaingun audio (spin-up whine, stream, spin-down).
- [ ] *Deferred (owner, 2026-09-26):* the Grenadier variant (gas mask, grenades flush last-known position, dodges dynamite).

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

## Bride — SHELVED 2026-09-30 (owner call; branch `claude/bride-game-lod` keeps everything)

The owner's verdict after playtesting: she looks good, but the animation is janky, the two-handed sword clips
through her own body (hard), and above all **she doesn't fit the game's fleshy, visceral identity**: after the
game-LOD pass she is mostly mesh (lace dress, plate, boots) with a painted face, so little of her is the
cratering, rupturing SDF flesh the game is built on. Not spawned by any level (`?spawn=bride` only). Revisit
only if an idea below earns it.

- [x] **Engine fixes split out and merged to main** (`22390b19`): `kit-bounds.ts` bone-sphere cull (kit pose was
  ~75 ms/frame for a live armoured enemy: `SkinnedMesh.computeBoundingSphere` CPU-skins every vertex); O(1) kit
  support index; allocation-free `pack.ts` (byte-pinned by `pack-golden`); the `setSdfScale` / upscaler mismatch
  guard + `applyShipDefaults` pinning the shipping 0.5 scale (captures 2026-09-13..09-25 at scale 1 with the upscaler
  on were broken: a 2x-zoomed corner); vite ignores `.lab-tmp`; the stocking band / thigh drip ride the thigh (the
  lunge stretched them to 1.1 m); lunge foot planting (`plantReach`, inert unless set).
- [ ] **On the branch only, not merged** (42 commits ahead of main at the merge `c3171913`): `bride-game.blob`
  (registry `bride` = game LOD, `bride-hd` = the full-detail file for cutscene renders), 63 prims vs 94 (-52.9%
  prim evaluations, census in `docs/dev-notes/2026-09-24-bride-perf/COST.md`), painted game face sheet with glowing
  red eyes, cloth as breakable kit mesh (lace tears off without sparks), orb hands on both kits, the bride glow
  (surface emissive packed in `meltCfg.w` by `glow-pack.ts` + cold room light `game-glow.ts`).
- [x] **Kit-beam flashlight merged to main** (`88512f4a`, owner approved after playtest 2026-09-30): kits and enemy
  held props are lit by a twin of the flashlight fitted to the SDF body beam (`mesh-beam-fit.ts`, `kit-lights.ts`;
  kits used to get 28.6x albedo at 1 m against the bodies' 3.5x and clip to white). The twin follows the flashlight
  gate (dark until the night-train torch pickup) and is skipped by `levelSceneLights`; `?kitbeam=0` restores the
  old kit lighting. Not covered: the player's FPV gun/hands (separate glTF, still chrome-white under the beam).
- [ ] **Why she was slow:** not her SDF prims (she was already ~0.5x a cultist per frame) but the kit CPU stall
  above, then prim count for the GPU march (shells cost 3-5x their prim share: grouping, not count). Frozen
  (`?frozen=1`) benches never run the kit loop: time LIVE legs too (`scripts/bride-timing-check.sh`).
- [ ] **Known, unfixed:** animation jank; sword clips her body on the wind-up; the lunge glides her feet (no step);
  one skull prim stretches ~8 cm in swings; lace still clips at melee range under the flashlight.
- [ ] **Damage model (designed, not built):** she "comes apart at the seams" because she has no HP (zombie meter),
  her limbs are 2-3x thinner than a zombie's against a fixed pellet sever radius (pellet-on-arm severs 47/50 vs
  0/40), decoration prims act as fake joints (`connectivity.ts chainOrder` / `missingLimbs`), plate absorbs nothing
  and corpses keep severing. Spec `docs/superpowers/specs/2026-09-25-bride-damage-toughness-design.md`, plan
  `docs/superpowers/plans/2026-09-25-bride-damage-toughness.md` (both on the branch). **Main has since built much of
  this** for the juggernaut: `plate-armor.ts` (per-plate HP, no wound while intact, shed at zero) and the soldier
  family trait with regional injury: re-plan on those, do not build the plan's plate tasks. Owner direction for her
  damage: blood on white (lace stains) + hit reactions that carry it (flinch on every hit, stagger on heavy hits
  that cancels her swing, later angry recovery) + 3-4 death performances handing off to ragdoll, intact except
  dynamite and headshots (kneeling bride as the signature).
- [ ] **Ideas to revisit her:** (1) *the unveiling*: pristine until shot; the lace/plate tear off (built) to reveal
  a raw, fused torso with the rib window and red seams from `bride.blob`: a one-day spike, judged in one
  playtest; if it doesn't make her feel fleshy, leave her shelved. (2) make her a one-per-level *set piece* (chapel,
  train car) with a scripted arrival and authored death, not a regular enemy. (3) keep her kit/face pipeline as a
  pattern for a future mesh-heavy enemy.

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
