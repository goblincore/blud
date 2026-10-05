# The axe and the head split: handoff (2026-10-04)

**Branch:** `claude/head-cleaving-effect-ef9515` (worktree `.claude/worktrees/head-cleaving-effect-ef9515`). It was
fast-forwarded from `claude/head-explosion-effect-d6231e` at `e04577ce` and carries everything since. A session
cannot write into another worktree (a hook blocks it), so work continues here. To see it on the owner's 5273 server,
fast-forward `claude/head-explosion-effect-d6231e` to this branch in its own worktree.
**Draft PR:** goblincore/blud#31 tracks `claude/head-explosion-effect-d6231e`, pushed up to `e04577ce`. Nothing on
this branch is pushed.

| Document | Path |
| --- | --- |
| Spec | [`docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md`](../../superpowers/specs/2026-10-04-axe-and-head-split-design.md). §9 is "as built" for part A. §5 was corrected: the split's cut faces need `headSlot: 'keep'`. |
| Plan A (the axe) | [`docs/superpowers/plans/2026-10-04-axe-part-a.md`](../../superpowers/plans/2026-10-04-axe-part-a.md). Done. |
| Plan B (the head split) | [`docs/superpowers/plans/2026-10-04-head-split-part-b.md`](../../superpowers/plans/2026-10-04-head-split-part-b.md). B1 is done. **Read the amendment blocks at the end:** they override the B4 snippet. |
| Axe notes | [`docs/dev-notes/2026-10-04-axe/NOTES.md`](../2026-10-04-axe/NOTES.md) |
| Cut-wound handoff (house rules) | [`docs/dev-notes/2026-10-03-cut-wounds/HANDOFF.md`](../2026-10-03-cut-wounds/HANDOFF.md) |

The per-task texts used for dispatch are in the session scratchpad (`scratchpad/split/taskB*.md`). They may be gone in a new session. If so, rebuild them from the plan file: each `## Task Bn` section, plus the header as `common.md`, plus the amendments.

## Done

- **The axe, part A: built, reviewed, owner playtested.**
  - Slot 7: an H/R/L chop combo.
  - Each chop stamps a cut.
  - The 3rd head chop kills.
  - The light list is shared with the flail (`viewmodel-lights.ts`).
  - Gate: `scripts/axe-gate.mjs`, 24 checks.
- **Owner feedback (2026-10-04):**
  - Cuts are too short and too tidy, with abrupt ends. The owner wants them "more excessive".
  - The axe model is not important; the owner will do a Blender pass later.
  - The head split warp is the priority.
- **B1 is done** (`56656928`, `d0f4c3f4`): `src/lab/sdf-zombie/head-split.ts` plus 35 tests.
  - The split field is a union of three rigid capped pieces, with ball caps (rho) and a region bound `C = REGION_MARGIN + |dh − r|`. It is continuous and 1-Lipschitz everywhere, and an independent review verified it against brute force.
  - `REGION_MARGIN` is 0.06, because the shipped AO probe reads `mapBody(p + n·0.06)`.
  - A one-sided split costs 2 field evaluations.

- **B2 is done** (`866f7d5d`): the CPU mirror.
  - `sdBody` honours `body.split` (`splitField` over `sdBodyClosed`); with no split it is bit-for-bit unchanged.
  - Hits are un-warped before stamping through `unwarpHit` (`damage.ts`) and `unwarpCutSeg` (`cut-wound.ts`): pellet,
    slug, axe, rod, the flail's body crater, explosions and the `stampWoundAt` seam.
- **B3 is done** (`e86f2833`, fixes `c111d14e`): the leaf `webgpu/game-head-split.ts`, the axe driving it, the seams.
  - Chop 1 opens and stamps the cut faces (`headSlot: 'keep'`), chop 2 widens, chop 3 kills; the split stays open on
    the corpse. A chop on an open head always counts, and stamps its own cut only on outer skin
    (`headChopCut`, `webgpu/axe-head.ts`).
  - Head damage and the split are mutually exclusive: on a split head the slug burst and the flail's head ladder are
    skipped; a head that head damage already holds refuses to split and keeps part A.
  - The hook answers null for a dead head, a tearing body or a closed state.
  - `HeadFrame.radius` is the skull's largest semi-axis (0.137 on the zombie; 0.037 m spare inside rho).
    `choosePreset` still takes the half-width.
  - `warpPoint` / `warpDir` (forward warp); head blood emitters follow the opened halves.
  - Seams: `__sdfGame.headSplit(id)`, `forceSplit(id, preset, sides, offset, angleFrac)`.
- **B4 is done** (`535afee6`, notes `ec3d0889`, fixes `de671db2`, `cf49fccc`): the split is on screen.
  - `REC_VEC4S` is 21: lanes N 17 = (n, thetaP), H 18 = (h, d0), A 19 = (a, thetaM), R 20 = (r, 0, 0, 0). The view
    reads `body.split` in `update()`; a closed, torn or reused view writes zeros.
  - `mapBody` wraps the slot body in THE PIECE LOOP: three pieces as `vec3 (cap, theta, id)`, sorted by unrolled
    compare-swaps, with the exact early skip. `loadInstance` sets `gInstSplitOpen`, the only open test.
  - `gHitPiece` / `gHitSplitF` (the winning piece's field before its caps) are set at exit.
  - `webgpu/march/map-body-split-twin.test.ts` is a HAND TWIN of that WGSL, compared with `splitField`
    (max difference 3.5e-16). Edit both together.
  - With no split open the march-hash pins did not move.
  - Cost: cold shader compile +4.5 s (45.0 → 49.5 s warm-up; `drawOnce` unchanged), accepted.
- **B5 is done** (`0cba1400`, notes `e347eb27`, fixes `06039f50`): bounds and culls follow the open head.
  - One pure rule set in `head-split.ts` (`splitFrame`, `splitHolds`, `splitHoldBall`, `splitBound`,
    `splitSphereImages`): the proxy box, the cluster row, the tile groups, the outer hull (turned copies of chain
    spheres) and the occluder hull (inner spheres that could meet a moved half are dropped). Bounds use `rho`.
  - The per-ray wound list is off for an open slot.
  - **Past 12.7 m a split is drawn closed** (`splitDrawDistance`; reopens inside 0.9×). Beyond it the march's accept
    reach could draw the region shell as a false surface. `view.splitDrawn` is what the record really carries.
  - Shipped path against bounds off: the worst case (one side, 0.6 m) went from 215 clipped texels to 13; the closed
    head's own floor is 0–23.
  - Cost: an open head is about +6 ms over closed at 0.6 m (B4: +3.5) and about +1 ms at 2 m. Closed is unchanged.
    A tighter tile bound was tried, gained 0.2 ms, and was reverted.
- All measurements and photos: [`NOTES.md`](NOTES.md), `b4/`, `b5/`.

## For B6 and later (from B2–B5 and their reviews)

- **B6:** copy `gHitPiece` / `gHitSplitF` into locals in the march loop (`trace.wgsl.ts` ~136); `calcNormal` and the
  probes overwrite them.
- **B6:** `hitField.w` / `.z` are the winning piece's uncapped values, so a cut face reads as deep tissue
  (`tissue.wgsl.ts` ~20). Use `gHitSplitF` to shade the cut faces as a cross-section by depth (skin, bone ring,
  meat) rather than relying on the face cuts' masks alone.
- **B6:** `gRefoldWin` → `hitRefold` (`trace.wgsl.ts` ~138) and `gWoundOwners` come from whichever piece ran last,
  not the union winner. The shell noise (`trace.wgsl.ts` ~147) calls `restPoint` at the world point.
  `normal-gradient.wgsl.ts` ~462 reads `ROW_GROUP_BOUNDS` at the world point.
- **B7:** drive the skull pieces from `view.splitDrawn`, not the pose, or the skull opens past 12.7 m while the
  flesh is drawn closed.
- **B8:** `scripts/axe-gate.mjs` check K expects at least 3 head-tagged cuts on the corpse; a centred split chopped
  through the gap leaves 2. Restate it.
- **B8 look:** the face cuts are untuned (kerf 0.012, depth 0.12, inset 0.006 in `HEAD_SPLIT.faceCut` /
  `faceCalibre`). A flail hit on a split head takes the plain crater with full meter credit. Loose pixels at the
  slab tip and speckle on the face preset's crown remain.
- **Still closed-head:** the shadow hull, `bodyInSight` (`game-main.ts` ~7311) and motion vectors.
- **Known limits:** a pellet or slug crater on a cut face sits on the old plane, so it shows on both faces. A rod sweep
  across the gap is un-warped as one segment by its midpoint's piece. `sdBody` costs about 2.7× inside the region
  (radius ~0.32 m). A forced re-split with fewer sides leaves the old face wound (seam only). Temporal start uses
  last frame's depth with no split motion, so a thin slab swinging into a pixel may start late for one frame
  (unverified).
- **House rule added:** never run `git checkout -- .`, `git restore .`, `git reset --hard` or `git clean` here; an
  implementer wiped its own uncommitted work that way.

## The cut "excess" pass: landed as built

Status is in [`docs/dev-notes/2026-10-04-cut-excess/STATUS.md`](../2026-10-04-cut-excess/STATUS.md) (`3002f57e`). The code is committed as a labelled WIP commit (see `git log --grep "wip(cut)"`); the raw photos are untracked.

**What it does:**
- Longer cuts: the axe's half-length goes 0.09 → 0.15, and the rod's sweeps are 1.4× longer, with `maxLen` 0.45.
- Wider cuts: kerf 0.025 for the axe and 0.02 for the rod. Each cut's kerf is capped at 0.3 × its half-length to keep the Lipschitz bound ≤ 2.2.
- Tapered, broken-up ends; rougher walls; lips raised 8–9 mm (from 2.9); a blotchy wet band; more blood.

**Verified:**
- Lipschitz maxima are 1.7–2.0, now including the GPU noise.
- The far-skin, thin-limb, silhouette and lid invariants hold.
- Gates: 30/30 cut-wound and 24/24 axe.
- Golden `-u`; census ready; march-hash pins unmoved.

**Costs, carried as open debt (decision in [`compare/NOTES.md`](../2026-10-04-cut-excess/compare/NOTES.md), `880b201a`;
the owner can overrule):**
- Cold boot is about +430 ms (from +136 to +936 ms over 4 pairs).
- 3 axe chops now add about +22 ms of frame time, against +4.3 ms before.
- Neither has been investigated.

The before/after comparisons are in `compare/`. The raw photos are untracked in the OTHER worktree's `photos/`
(38 MB: don't commit them all).

## Remaining (plan B)

1. ~~The cut excess pass~~, ~~B2~~, ~~B3~~: done (above).
4. ~~B4~~, ~~B5~~: done (above).
6. **B6: post-hit shading at the un-warped point.**
   - `restPoint`, `woundMask`/`charMask`, the face block and the burn taps use it.
   - Analytic normals fall back to FD in the split.
7. **B7: the skull mesh.** Per-piece instances plus a clip plane.
8. **B8: the gate** (`scripts/head-split-gate.mjs`: S/O/W/K/L/F/T/C) and the look pass. The owner wants it EXCESSIVE.
9. **B9: docs.**

## Known design notes

- **Hands split with the head.** Each piece rotates the whole slot body above the hinge and within rho, so a hand raised near the face would split. That is accepted for now. If it shows in B8, evaluate P± on the head cluster only.
- **The face preset's hinge** sits 2 cm in front of its plane. It is sound, but consider moving it onto the plane while tuning.
- **The axe's kerf is capped at 0.015** by the Lipschitz bound. A wider axe cut needs the field reshaped, which is what the excess pass attempts.

## House rules

- Never `git stash`.
- Targeted vitest only; `tsc` allows only the `node:crypto` error.
- Headless capture only, via `scripts/lab-servers.sh`, which needs bash. Use ports 5241/9241. **Port 5273 is the owner's.**
- Every WGSL change needs golden `-u`, the census, march-hash and an interleaved cold boot pair (with a unique `hash13` nonce per boot).
- Don't run implementers in parallel when their files overlap: a broad `git add` mixed commits once.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use dualmem for memory, not MEMORY.md.
