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
