# Detached-piece background baking

Implemented in the main checkout with owner approval. The existing CPU
surface extraction, welding, albedo and normals now run in one Web Worker.
`chunk-bake-geometry.ts` retains the original bake algorithm; the worker transfers
four typed-array buffers and the frame loop wraps them into a mesh.

Settled SDF pieces stay visible in their frozen pose until the mesh is ready.
Pending and queued pieces remain shootable. Hits, recycling, disabling baking,
page exit and HMR cancel obsolete work. Generation checks reject stale results.
Freed chunk views are reused within the existing twelve-view limit. Worker
failure leaves SDF rendering active and exposes `chunkStats().bakeError`.

## Validation

- 31 focused field, physics, queue and transfer tests pass; TypeScript and the
  production Vite build pass (including the worker asset).
- `node scripts/sdf-chunk-worker-check.mjs 5173 9263`: real worker completion,
  visible pending piece, disable/cancel/resume, and a real slug hitting a piece
  whose worker message is delayed. Deliberately disabling pending collision
  makes the shot regression fail; restoring it passes.
- Final focused run: 67.4 ms worker bake, 0.4 ms request preparation/submission,
  0.4 ms buffer wrapping/material/scene swap. These are CPU spans, not a frame
  throughput benchmark; GPU upload, compilation and drawing are excluded.
- `node scripts/sdf-chunk-bake-gate.mjs 5173 9263`: boot, bake-off repeatability,
  real severed-piece baking, baked-piece hits and six recycling cycles pass;
  25 total bakes, at most twelve views. No comparison to a separate baseline
  server was requested by this invocation.
- Scoped follow-up review found no remaining issues. The owner authorized
  publication on main; a separate detailed playthrough verdict was not recorded.

## Manual check

Reload http://127.0.0.1:5173/sdf-game.html?slug in the current checkout. Sever
limbs, let pieces settle, and shoot settled pieces again. Watch for pauses,
disappearing pieces or visible jumps during the mesh swap.

This addresses detached-piece CPU bake stalls. It does not establish the cause
of the one-off 4.373-second freeze or fix the separate cached-wound raymarch
failure on the zoned-wounds experimental branch.

## Wrap-up — 2026-09-06

Implementation committed on local main as `4049547`. Before committing,
TypeScript passed and the complete Vitest suite passed: 211 files, 3,466 tests.
The first sandboxed suite run could not open tsx IPC sockets; rerunning with
local IPC access resolved all eleven CLI test failures.

**Remote publication remains pending.** Automatic approval review rejected
`git push origin main` because the payload also includes the two pre-existing
local commits `386e028` (hair wind motion) and `b78bca2` (task notes), and it
requires explicit approval for the complete payload and destination
`https://github.com/goblincore/blud.git`. No push occurred. The owner then asked
to wrap up and update notes; do not interpret that as the requested explicit
push approval. Recheck branch/remote state before any later publication.

The isolated headless test browser was stopped. The development server on
port 5173 was left running for manual checks. Unrelated reference-asset changes
were left untouched.

Separate follow-up: the cached wound visual corrections remain on
`codex/zoned-wounds-visual-fix`; cached ray convergence still needs investigation
before another visual/performance verdict. The analytic-normal GPU timing work
also remains outstanding. Neither is part of this worker commit.
