# Next-session handoff — gib transition, loading and first-gib freeze

Updated 2026-09-16. This is the current handoff; the earlier appearance issue is
accepted, not the next task to reopen.

## Checkout and accepted baseline

- Worktree: `/Users/donny/Projects/blud/.claude/worktrees/dynamite-weapon-slot`.
- Branch: `claude/dynamite-weapon-slot`; [PR #8](https://github.com/goblincore/blud/pull/8), still draft and not merged.
- Accepted implementation: `9fa09374994c519f319aa2bf13a0603fd3596299`, pushed.
- Active game: `/sdf-game.html`. The retired `/index.html` game is a reference only.
- Manual-test server responded on `http://127.0.0.1:5391/sdf-game.html?gibbones=core`
  when this handoff was written. Check it before starting another server; if it
  has stopped, run `npx vite --host 127.0.0.1 --port 5391 --strictPort` in this worktree.
- Read the project AGENTS instructions and load both required DualMem contexts.
  Use the shared launcher, not MEMORY.md. Worktree memory tools have previously
  resolved the wrong namespace; explicit `--ns claude:blud` was used for these notes.

The owner accepted the flesh shading, dark stains and preserved head face after
manual testing. Keep the mesh-baking optimization enabled. No additional
appearance polish was requested. Source response, local noise anchors and cap
geometry survive the worker; textured heads use the original atlas per fragment
and shared `FACE_LAYER_WGSL`. Live chunks track the flashlight and head rotation;
recycled slots inherit the new actor's look. Head materials are disposed on retirement,
while the actor retains ownership of its atlas.

[Appearance results, comparisons, test limits and reproduction](../2026-09-15-gib-baked-vs-marched/parity-fix/RESULTS.md).

## New report: long loading and initial freeze with gibs

Owner: “there seems to be a long loading time and also initial freeze with the gibs.”
This is a reported symptom, not a measured regression or diagnosed cause. It is
not yet established whether the freeze occurs at detonation, first visible
pieces, or their first settle/bake. Do not silently equate these events.

Suggested investigation, before adding more transition work:

1. Capture a normal cold boot through ready-to-play and its first explosion,
   then repeat explosions in the same session. Compare with a warm reload.
   Record settings, browser, asset/network timing and machine load. Keep the
   visible game loop running for hitch attribution; the appearance rig pauses it.
2. Separate startup asset loading, shader/pipeline warm-up, first chunk creation,
   first worker submission, first mesh upload/draw, and first textured head draw.
   Correlate long frames with pipeline creations, CPU work and worker replies.
3. Measure the default forward renderer first. Compare the accepted baseline
   with the earlier commit only if necessary to attribute a regression, while
   keeping the accepted look as the final target.
4. Fix the measured cause and verify cold and repeated explosions. Moving every
   cost into a longer loader is not automatically an improvement. Preserve the
   accepted visuals, bounded pools, ownership and worker optimization.

Useful code and existing instrumentation:

- `webgpu/game-main.ts`: `warmPipelines`, `window.__warmDone`, loader gate,
  `spawnChunkPiece`, `finishChunkBake`, `chunkStats`, `pipelineLog`.
  Paths in this list are relative to `src/lab/sdf-zombie/`.
- `?pipelinelog=1`, `__sdfGame.pipelineLog()` and
  `src/lab/sdf-zombie/webgpu/pipeline-log.ts` already attribute pipeline creation.
- `scripts/startup-hitch-probe.mjs` is a live-loop startup/room-entry probe.
  Extend/adapt it to a timed first explosion; it does not already prove gib costs.
- Warm-up draws a real frame in the actual render-target context, warms crowd
  computes, then precompiles SDF/upscale passes. The loader has a 15-second
  `Promise.race`; a timeout does not cancel the underlying warm-up. Inspect
  completion/error state rather than treating loader disappearance as proof.
- `webgpu/chunk-bake-jobs.ts`: worker creation is lazy on first submit.
  `chunk-bake.worker.ts`, `chunk-bake-geometry.ts`, `chunk-bake-buffers.ts`
  cover extraction, transfer and wrapping. `chunkStats()` exposes worker bake
  time, request/swap time, pending job and errors; worker time is not main-thread time.
- The accepted repair creates a head-only face material in `finishChunkBake`.
  Its first-use pipeline/texture work is a plausible hypothesis, NOT a confirmed
  cause. The plain baked material is also lazy. Determine which variants the
  startup warm-up actually sees before prescribing more prewarming/caching.
- Older startup/gib-freeze notes describe earlier fixes, not current performance
  evidence. The optional carve library's historical ~19.7-second boot cost applies
  to `gibrender=carve`, not automatically the default `march` path.

## Main visual follow-up: body visibly tearing into gibs

Owner sees: throw dynamite → explosion → character instantly becomes separate
chunks. Wants a readable intermediate state: flesh tearing/peeling away, possible
rib/skeleton exposure, then detached pieces. References are the active melting
animation and the retired NotBlood tearing sprites. Retired code/assets are
reference material; extracted Blood assets remain dev-only and must not ship.

**An existing transition already exists in code.** `game-main.ts` defaults
`gibTearSec` to 0.1 seconds and `gibStaggerFrames` to 3; panel/query overrides may
change the effective values. `scheduleGib` calls `beginTear`; `spawnScheduledGibs`
advances the tear window then calls `gibActor`, followed by actor retirement and
staggered impulses. Inspect `gib-tear.ts`, `webgpu/game-actor.ts` (`drawnPose`,
`beginTear`, `stepTear`) and `stepPendingGibImpulses` before introducing a second
state machine. The requested change is a more convincing rupture, not merely
adding a delay that already exists.

A 150–250 ms outward rupture with immediate explosion/damage was suggested in
conversation, but no timing or implementation has been accepted. Examine the
melting effect's flesh-removal/skeleton-reveal technique without making an
explosion look like slow liquid melting. Preserve pose continuity into the actual
pieces, face placement, cut surfaces, replay timing and bounded piece budgets.
An effective review should show the sequence at normal speed and frame by frame.

## Explicitly deferred: settling and shorter limbs

The owner accepted the current appearance but reported some pieces remaining
above the floor and some limbs sticking upright. Each arm and leg should become
two shorter pieces instead of a single long tube. Elbow/knee cuts are only a
suggestion; exact cut placement is not settled.

- Reference screenshot: `/Users/donny/Desktop/Screenshot 2026-09-16 at 5.25.37 AM.png`.
  It shows the reported result; a still frame alone cannot establish the cause.
- Start with `gib-chunks.ts`: `stepChunk`, collision/rest radius,
  `toppleAngleToFlat`, `chunkSettled`; then the submit/swap logic in `game-main.ts`.
  Compare actual surface-to-floor distance with proxy/radius-based contact and
  record whether each problematic piece is live, queued, or baked. These are
  investigation leads, not conclusions.
- `gib-parts.ts` builds the anatomical pieces and caps; `game-main.ts` applies
  budgets and spawns them. Two pieces per limb affect counts, launch, pool
  pressure, cut continuity and performance, not just appearance.
- Preserve cap primitives. Empty `tornAt` is intentional for capped blast pieces;
  adding tear spheres to “repair” it would eat the caps.

## Verification and other known limits

For the accepted code: production build/typecheck and 292 focused tests passed;
forward WebGPU front/side/head captures completed without rendering/runtime errors.
Head-material retirement was exercised. The owner then accepted normal gameplay.
These checks did not measure startup latency or first-gib hitches.

Earlier full suite: 5,162 passed, 11 panel storage failures under Node 25. The
entire affected panel file passed under Node 22; no later full-suite-green claim.
Use Node 22 for the recorded workflow (a bash login shell used 22.22.1 here,
whereas the default zsh selected Node 25; check `node --version`).

Optional deferred comparison hit the live SDF compile error `unresolved value
gMarchAnchor`, also present in the starting shader/dependency setup. Its baked
face rendered, but deferred parity is unverified. Do not enable deferred by default.

The mesh remains approximate: noise frames, ambient/AO, backlit scattering and
wound shadow differ. Do not reopen these accepted differences without a concrete
need. `scripts/sdf-gib-bake-parity.mjs` supports same-pose and `HEAD=1` captures;
it is a visual regression rig, not a cold-start performance benchmark. Do not
force SDF scale 1 with the default neural upscaler: this produced missing live
coverage and invalid comparisons. No performance benchmark was claimed here.

## Suggested first message for the new session

> Continue PR #8 in the claude/dynamite-weapon-slot worktree. Read
> docs/dev-notes/2026-09-16-gib-follow-up/HANDOFF.md. The gib appearance is accepted.
> First investigate the reported long startup and initial gib freeze with real
> timings; then work on the more visible body-tearing transition, building on the
> existing tear window. Floating/upright settling and two-piece limbs are recorded
> follow-ups, previously deferred. Preserve the accepted baked appearance and faces.
