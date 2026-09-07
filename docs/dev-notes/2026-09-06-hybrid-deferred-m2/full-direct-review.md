# Task 6 full gate — direct recovery

Base: `89534ddc` (timed-out character/lifecycle continuation). Core validation remains separately recorded at `20406278`.

The owner explicitly excludes the unused `mouse` character and the `strand-fixture` SDF hair test from gameplay validation. Polygonal bone tubes remain excluded. Sphere culling belongs to another agent and is not integrated here. The broader roster question remains open: the first direct run rendered zombie/goblin/clown/clown-alt, then exposed cyclops' missing gameplay motion-joint wiring. No arbitrary spawn-error waiver is accepted.

Direct review found fixture defects beyond the roster:

- `faceTarget` re-locks simulation. The sever phase now unlocks after aiming, holds actor motion, and advances projectiles/cooldowns explicitly.
- Repeated torso shots entered the same damaged area and produced only one chunk. The fixture aims at distinct limbs and records actual chunk creation by ID.
- Baking is disabled while proving two live shared-material chunks, then enabled for the specific synthetic bake subject. Existing bake behavior is restored afterward.
- `facePoint` used the camera destination instead of the subject position in its pitch denominator, aiming straight down instead of at a floor chunk.
- Chunk pixel checks now hide the exact selected producer and require its surface depth to disappear, plus world-position proximity. Class-only checks could accept unrelated actor flesh or the floor.
- Bake acceptance follows the newly spawned chunk ID from `livePieces` to `pieces`, rather than accepting any completed bake or the last aggregate record.
- Baked normals use the actual selected texel coordinate.

Temporary lifecycle-only diagnostics write under `/tmp/blud-m2-lifecycle-debug/` with `fullAcceptance:false`. They cannot replace a fresh final full run. Task 7 remains blocked pending full supported-scope acceptance.


Focused verification (2026-09-07):

- Lifecycle diagnostic: 32 checks passed, zero page errors. Includes 25 core checks plus two live chunks, exact-ID bake transition, actor rebuild, muzzle lighting, 640 cap, default legacy and explicit legacy boots. `game-validation-lifecycle-diagnostic.json` explicitly records `scope:lifecycle-debug` and `fullAcceptance:false`.
- Wound diagnostic: 26 checks passed, zero page errors. The controlled gameplay wound stamp darkens 27 matched flesh pixels and is recorded on the selected actor. `game-validation-wound-diagnostic.json` records `fullAcceptance:false`.
- These diagnostics skipped the registry phase deliberately to isolate remaining lifecycle failures. They are partial evidence, not a full gate pass. Canonical `game-validation.json` retains the Cyclops spawn failure.
- The kit inspector now accepts an actor ID and verifies the selected rig belongs to the spawned test actor. A name-only lookup can select the boot soldier instead.
- Visual inspection of the bake capture shows bright flesh highlights; functional depth/routing acceptance does not close the material/visual review.

Kit identity diagnostic passed: spawned soldier 11 selects rig actor 11 (36 mesh descendants), while the unfiltered lookup selects boot soldier 1. Unknown actor IDs return no rig. TypeScript `npx tsc --noEmit`, driver syntax, and `git diff --check` passed.


Read-only review caught a full-run contamination risk: selecting the first two live chunks could select older chunks. Inspection now filters against the pre-sever ID census, so only newly detached pieces qualify. The isolated diagnostic had no previous chunks and already inspected IDs 1 and 2; this filter does not change that diagnostic's subjects.

Review also identified weak equipment pixel attribution. The revised scan refreshes actor-specific posed anchors after each orbit, hides the exact selected visible mesh UUIDs, and requires their surface depth to disappear. For the soldier, only held-prop meshes are hidden, so armor cannot pass as the held gun. This is being checked separately from the full roster gate.


The stricter kit run exposed another fixture assumption: the actual gun mesh names include `barrel0`/`barrel1`, while the old guessed allowlist expected `barrels` and found only one matching mesh. The inspector now marks descendants of `actor.character.prop.object` directly. Soldier prop selection therefore follows the production object identity and does not depend on glTF names.


Final equipment diagnostic passed for zombie, goblin, clown, clown-alt and soldier with zero page errors. The four equipment actors have paired visibility depth evidence; soldier evidence uses actual held-prop subtree membership. Recorded in `game-validation-kit-pixels-diagnostic.json` with `scope:kit-pixels-debug` and `fullAcceptance:false`. This deliberately selected diagnostic roster does not alter the canonical registry scope. Read-only follow-up review found no further blocking issues in the chunk and equipment corrections. Final TypeScript and driver syntax checks passed.


Owner finalized the gameplay roster as zombie, soldier and goblin. Clowns and other unused characters/fixtures are explicitly outside this gate. The gate now checks selected names exist without pinning the entire lab registry size.

The first full run with this scope passed 30 checks through actor rebuild, then exposed a false assumption in the muzzle fixture: `__dungeon.setBeam({beamGain:0})` changes flesh key shading, not the real flashlight that illuminates walls. The check now saves `__dungeon.spot.intensity`, sets that intensity to zero for the independent muzzle test, and restores it. This corrects the test input rather than weakening the wall-darkening assertion. Earlier lifecycle-only muzzle evidence used the old input and is superseded by the fresh full run.


Full-run sequencing exposed a second fixture defect: the sever stage placed the camera 0.9m from its subject, while `aimAtNearestSurface` intentionally ignores candidates closer than `MIN_STANDOFF=1.5`. It could fire at a different actor across the level; prior registry probes also add overlapping actors at authored spawn points. The lifecycle phase now boots a fresh ordinary gameplay cast and faces a room-2 zombie from 1.8m. Character coverage remains recorded from the preceding phase. This isolates projectile/lifecycle behavior from character-probe setup without changing production aiming or sever logic.


Further sever-fixture corrections: actor-scoped diagnostic aiming prevents switching subjects, successful-shot counters do not advance on reload attempts, and a bounded nearby-angle scan settles the actual viewmodel muzzle before requiring the ballistic predictor to hit the selected actor. Scoped aiming orients toward a live cluster; it intentionally leaves final hit verification to the driver after settling, because the GLB muzzle transform is stale immediately after changing player yaw/pitch. Existing unscoped aim callers retain their behavior. The focused run detached two pieces from actor2 and verified both rendered; its later failure was a missing helper in the temporary diagnostic extraction, not a production failure. Full evidence must come from the unmodified complete driver.

The owner raised flat flesh appearance; see `material-parity-review.md` and paired captures. This is an open material regression for Task7, not a functional acceptance waiver.


Normal-direction oracle correction: a fresh posed flesh sample had n·v=0.195 (front-facing), but the old threshold0.3 mislabeled it as pointing away. The sanity check now requires positive n·v, matching the baked check, while retaining unit-length and exact-texel reconstruction assertions. This removes an unsupported maximum viewing-angle assumption for curved procedural shading normals. Independent read-only review confirmed the change; this sanity check does not claim exact normal-field parity.


Chunk inspection now uses a wider289-point lattice and temporarily hides the close-up viewmodel for both on/off samples; visibility is restored in `finally`. The router honors hidden ancestors. Exact selected-ID disappearance, class and world-proximity checks remain; FPV/world depth is tested separately in core.

The synthetic bake fixture no longer projects an arbitrary ray and inherits a random launch impulse that could carry it into walls (chunk physics currently collides with the floor only). It spawns at a fixed open room-2 position with an optional zero initial velocity, verifies furniture and room-wall clearance after settling. Existing spawn calls still use their original random velocity and consume the same RNG values; real severed chunks retain full gameplay physics. The focused lifecycle run before this placement refinement passed all7 checks, including flashlight23→muzzle60→expired24, flashlight-off15→muzzle54.


Final bake clearance assertion uses the baked mesh bounding sphere against room walls and furniture. Its centre can differ from the live physics origin because it describes the rotated baked geometry; equality of those two centres was an invalid test assumption. Sever coverage now explicitly selects the two ordinary room-2 zombies, taking the second live producer from the second actor once one piece exists; it no longer depends on obtaining two detachable pieces from one frozen damaged pose.
