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
- **B6 is done** (`1277bebe`, notes `23d91606`, fixes `791238ae`, `2ad65481`): shading rides the halves.
  - `webgpu/march/body/blocks/post/split-hit.wgsl.ts` derives the post-hit split state once: `splitTheta`, `pS` (the
    un-warped point), `splitQ`, `faceCentre` / `faceQuat`, `splitIn`, `cutFace`. Closed slots and piece 0 never run a
    rotation, so closed bodies are bit-identical (march-hash unmoved).
  - Readers at `pS`: the anchor, wound and char masks, the face sheet and eye glow, burn bone taps, wetness, motion.
  - Analytic normals fall back to FD inside an open region (`ngReason` 8, analytic mode only).
  - Cut faces shade as wound flesh; the gate is `smoothstep(cutLo, cutHi, hitField.x − hitSplitF)`, constants in
    `SPLIT_SHADE` (`head-split.ts`).
  - `mapBody` files re-fold wins per piece (`gRefoldBy`).
- **B7 is done** (`b794b416`, notes `d3c5628e`, fixes `c1b820bb`): the skull mesh cracks, then splits.
  - Pure rule in `head-split.ts` (`HEAD_SPLIT.skull`, `skullFollow`, `skullSplitOf`, `skullPieceAt`,
    `skullWarpPoint`, `skullPieces`): the bone opens LESS than the flesh, staged by the spring's target. The follow
    table is (0.55 → 0.1), (0.8 → 0.3), (1 → 0.85): a crack on chop 1, a wider crack on chop 2, split on the kill.
  - `webgpu/skeleton-spike/mesh-split.ts` and `mesh-renderer.ts`: per-piece instance copies in separate split
    batches, clipped at the un-rotated position with a fracture edge (one `jag` table shared by the WGSL and its TS
    twin), two-sided with a dark inside and a cut-bone rim. Driven from `view.splitDrawn`. Closed heads draw as
    before.
  - Seams: `__sdfGame.skullSplit(...)` (look and follow table), `meshSkeletonShow(...)`.
- **B8 part A is done** (2026-10-05): the gate, the look block, leftovers. Numbers in [`NOTES.md`](NOTES.md).
  - `scripts/head-split-gate.mjs`: 67 checks (open, widen, kill, one side, later hits, face, skull, range, a body
    chop near the neck, head damage, bounds, turned, cost). Pinned across boots (the dynamic-light clock, the probes'
    afterglow, the field interlace): the same numbers in every run. Each scenario was shown to fail under a breaking
    change; its expectations are derived from the live tuning constants, so the look pass can retune angles and spring.
    A routine run writes its sheets to `.lab-tmp/`; `SHEETS=1` rewrites the tracked ones in `gate/`.
  - One cut-face look block (`march/body/blocks/post/cut-face.wgsl.ts`), `cutDepth` from `split-hit`, and
    `SPLIT_SHADE` with one number per thing it drives. A pure move: pins unmoved, open heads equal to the bit.
    It also gives `cutKeep` (0 today): the share of a cut-face texel that is not flesh, which the mottle, the gore
    and the wound wetness after it leave alone. A bone ring written there sets it.
  - A flail hit on a split head credits the head's share of the meter. The bone has a per-tick bound.
  - **Only a chop on head flesh is a head chop** (`axe-head.ts chopOnHead`; decided by the controller, to be flagged
    to the owner). Since B3 a chop on the upper chest, within 0.2 m of the neck root, opened the head (the flail's
    `isHeadRegion`), and `scripts/axe-gate.mjs` failed 7 of 25. Now 25 of 25; `head-split-gate` scenario A holds it.
    Behaviour change for every character: three chops on the upper chest, collar or neck base no longer kill by count.
  - **Spec §4's sentence that a head chop is one `isHeadRegion` accepts is superseded for the axe** (the spec's
    wording is B9's).
- **Owner feedback (2026-10-05, on the B6 photos):** "looking pretty good"; the skull needs cracked/split states
  (B7 is the answer; photos in `b7/` for the owner's choice); the open-head cost (+6 ms at 0.6 m) "is a lot but we
  can figure out how to optimize later".
- **B8 part B, group 1 (the cut faces): tried, reverted** (`d0d407d2`). The owner prefers the cut faces as he played
  them, ragged face cuts included. Do not restyle them.
- **B8 part B, group 2 is done** (2026-10-05): the owner's two playtest requests. Numbers in [`NOTES.md`](NOTES.md),
  sheets in `look/`.
  - **The axe skips the thin crack** (`69124ac5`): `AXE_HEAD.openAngles` is `[0.8, 1]`. Chop 1 opens to the wide
    crack, chop 2 splits the head wide with the zombie alive, chop 3 kills and kicks the full split
    (`AXE_HEAD.killKick` 0.3, `head-split.ts punchSplit`). Off: `[0.55, 0.8]` and `killKick` 0. The thin crack is
    still the follow table's first stage.
  - **The skull's stage only advances** (`SplitState.stage`, `SplitWarp.stage` in place of `.target`): the bone keeps
    the stage's share of each half's own flesh angle, so a kick or a wobble swings it in proportion and never steps
    it.
  - **The opened halves wobble with the body** (`HEAD_SPLIT.wobble`): each turning half has its own offset
    (`SplitState.wobP` / `wobM`), a damped spring driven by the acceleration of the split's mass point, with hard
    limits. It reaches the renderers only through `SplitWarp.thetaP` / `thetaM`. Off: `gainSide` 0 and `gainBob` 0
    (bit-identical). A frozen actor rests at exactly zero offset.
  - The gate is 77 checks: K holds the kick, J is the wobble. After a thaw it waits for the wobble to rest
    (`restWobble`) before it measures a rest angle; a new scenario that thaws must do the same.
- All measurements and photos: [`NOTES.md`](NOTES.md), `b4/` … `b7/`, `look/`.
- **Testing rule added:** after any WGSL change run the full tree,
  `npx vitest run src/lab/sdf-zombie --exclude '**/cut-wound.test.ts'` (510 files, 3–5 minutes). Targeted sets missed
  a red cross-cutting gate twice (`entrails-gates`, `normal-gradient-probe`).

## For B8 and later (from B2–B7 and their reviews)

- **B8 groundwork:** the cut-face look is spread over five blocks; move it into one look block with `cutDepth`
  exported from `split-hit` before tuning anything. A bone ring on the flesh cut faces belongs there (`applyBones`
  at `pS`), not in the skull mesh (the march's cut face is coplanar with the skull's clip).
- **B8:** `scripts/axe-gate.mjs` check K expects at least 3 head-tagged cuts on the corpse; a centred split chopped
  through the gap leaves the 2 faces. Restate it. In gates, let the spring settle between chops.
- **B8 look, known wrong:** after the kill the skull is hollow and the gap is empty (the room shows through the V);
  a whole brain mesh riding piece 0 is the cheapest structural answer. The fracture teeth read as a regular saw up
  close. An off-centre split halves an eyeball. The face cuts are untuned (`HEAD_SPLIT.faceCut` / `faceCalibre`).
  Loose pixels at the slab tip and speckle on the face preset's crown. A flail hit on a split head takes the plain
  crater with full meter credit.
- **Bone residual (accepted):** a chop landing above the old target steps the stage at the next tick (seam only:
  play's minimum strike gap is 0.6 s). The dip on the swing back is gone with the monotone stage.
- **Still closed-head:** the shadow hull, `bodyInSight` (`game-main.ts` ~7311) and motion vectors. The top vertebra
  is left unsplit on purpose.
- **`gRefoldBy` is indexed by piece, not slot:** in a crowd pixel another slot's re-fold win can leak into an open
  slot's normal hint. A separate follow-up (the fix moves crowd pixels).
- **Costs carried as debt** (the owner: optimise later): open head about +6 to +6.7 ms at 0.6 m, +1.4 ms at 2 m;
  cold shader compile +4.5 s from B4; closed bodies +0.1–0.3 ms from B6, unattributed.
- **Known limits:** a pellet or slug crater on a cut face sits on the old plane, so it shows on both faces. A rod sweep
  across the gap is un-warped as one segment by its midpoint's piece. `sdBody` costs about 2.7× inside the region.
  A forced re-split with fewer sides leaves the old face wound (seam only). A baked split head has no answer yet.
- **House rule:** never run `git checkout -- .`, `git restore .`, `git reset --hard` or `git clean` here; an
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
6. ~~B6~~, ~~B7~~: done (above).
8. ~~B8 part A: the gate~~, ~~B8 part B: the look pass~~ (above: the cut faces stay as played; the axe's table and
   the wobble are in). A wetness-under-the-flashlight step for the cut faces is planned separately.
9. **B9: docs.** To record: spec §4 / §5 (the axe's stages are the table's second and third, the kill's kick, the
   stage that only advances, the wobble and its two off switches); `TASKS.md`.

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
