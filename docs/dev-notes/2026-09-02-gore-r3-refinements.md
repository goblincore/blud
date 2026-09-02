# Gore system (wound pass r2) — refinements queue for round 3

Written 2026-09-02 from a read of `claude/continue-previous-work-91055b` at
`3823c04` (bones in `body.bonePrims`, `W_BONE = 4`, `applyBones` hard-min
after `applyWounds` gated on `nearWound`, tissue ramp on `mapBody.w`) plus a
merge dry run against the perf round-2 chain. Owner verdict on the review:
"good refinements — add to tasks/docs". Nothing here is implemented.

## Merge picture (measured, `git merge-tree`)

- Gore × perf chain (task-5 tip): conflicts only in `march.wgsl.ts` (10
  regions — 9 are 4–6-line signature/call-site hunks where gore inserts
  `counts2` mid-signature and perf appends `perfCfg`/`prevT`; one 49-line
  region where `APPLY_BONES` sits next to `MAP_BODY`'s signature),
  `game-main.ts` (one 83-line constants/seams region), `march.wgsl.test.ts`
  (3 tiny). `specialise.ts`: gore edits, perf task 4 deletes — deletion wins.
- Gore × `claude/elbow-fold-fix`: clean.
- Semantics compatible by design: task 3's wound skip fires only beyond
  2× radius, so the `nearWound` bone gate is unchanged; task 6 carries the
  distortion factor in a private global because gore owns `mapBody.w`.
- **Merge once, after the chain finishes** (~1 h). Merging main into the
  chain mid-flight breaks the dispatch worktrees' dependency merges.

## Refinements, in order

1. **BUG — curved ribs render straight.** `applyBones` calls
   `sdPrim(p, i, data, -1.0, 0.0, vec3(0), band)`: taper, profile and bend
   hard-coded to "none", while `zombie.blob`'s `bones` block authors six rib
   pairs with `bend=` up to 0.162 and tapered radii. The packer writes those
   rows; the shader never reads them for bones. Two owner rounds
   ("horizontal sticks rather than a cage") tuned curvature the GPU cannot
   draw. Fix: read `ROW_PRIM_SHAPE`/`ROW_PRIM_BEND` for bones exactly as
   `foldGroup` does. Verify first: set one rib's `bend` to 0 and diff a
   capture — if nothing changes, this is confirmed.
2. **Cull the bone fold.** No spatial test today: every bone (12 ribs,
   sternum, spine rod, pelvis, cranium, jaw ≈ 17) costs 3 texel loads + a
   capsule per field evaluation inside the 2× wound zone — per march step,
   ×4 for `calcNormal`, plus the AO/scatter probes. A wounded torso pixel
   evaluates ~2.4× the zombie's flesh. Bones already carry `cluster`: write
   per-cluster bone ranges and test the cluster sphere first, or better,
   precompute per wound which bones its 2× sphere touches (spare wound-row
   slots) and fold only those.
3. **Measure with counters, not timers.** The +0.0% bone verdict sat under a
   4% within-run spread. The march's debug prim counter (`gDebugPrims`)
   already exists — count bone evaluations per pixel and gate cost on that.
   Same lesson the perf chain learned twice (occupancy vs bench).
4. **Torso cavity, not a wall ramp.** The tissue ramp is right for a limb
   and wrong for a torso (owner: wants organs/entrails on body shots). The
   separate bone array is the foundation: add organs as another op in it
   (`W_ORGAN = 5`), folded under the same `nearWound` gate, shaded by the
   same prim-material identity read; give the ribcage interior a cavity
   colour once the carve passes the sternum plane. Same cost profile as
   bones — do (2) first.
5. **Gate the bone-material read.** The per-hit `hitMat` texel load runs on
   every hit pixel; bone can only show inside a wound, so gate on `wm > 0`.
6. **Bone in gib chunks.** Chunks carry no bone by design; a severed forearm
   showing a stub is the cheapest visible payoff of the array.
7. **Collision** (`X1.zombie-behaviour`): the parked wound-flip glitch is
   plausibly the interpenetrating crowd; task 5's per-body passes do not
   change that either way.
