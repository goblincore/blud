# The axe and the head split: handoff (2026-10-04)

**Branch:** `claude/head-explosion-effect-d6231e`
**Worktree:** `.claude/worktrees/head-explosion-effect-d6231e`
**Draft PR:** goblincore/blud#31. It is pushed up to `4955568c`. B1's commits are not pushed yet.

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

## In flight when we paused: the cut "excess" pass, stopped

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

**Concerns to decide before committing:**
- Cold boot is about +430 ms (from +136 to +936 ms over 4 pairs).
- 3 axe chops now add about +22 ms of frame time, against +4.3 ms before.
- Neither has been investigated.

**Unfinished:**
- the side-by-side comparison PNGs and `compare/NOTES.md`;
- the code commits;
- the cost decision.

The photos and logs are untracked in `photos/` (38 MB: don't commit them all) and `verify/`.

## Remaining (plan B)

1. Land the cut excess pass first (see above and its STATUS.md): decide the two costs, make the comparisons, commit. B2 and B4 touch some of the same files and the golden snapshot.
2. **B2, the CPU mirror.**
   - `sdBody` honours `body.split`.
   - `ZombieActor.setHeadSplit` and `unwarp`.
   - `strikeActorsFrom` carries `split`.
   - The axe, the rod and the pellet/slug paths stamp in the un-warped head.
3. **B3, the per-frame leaf.**
   - `game-head-split.ts`: the per-frame spring.
   - The axe opens, widens and kills through it.
   - The cut faces get `headSlot: 'keep'`.
   - A `forceSplit` seam.
   - Size `HeadFrame.radius` from the real head extent, not `headShape` axes.x.
4. **B4, the GPU record and `mapBody`.**
   - `REC_VEC4S` 17 → 21.
   - `mapBody` uses the three-piece union with the EXACT EARLY SKIP: caps first, `best = C`, visit pieces in ascending cap order with an unrolled compare-swap and no indexed arrays.
   - Then the full shader check set: golden `-u`, census, march-hash and a boot pair.
5. **B5: bounds and culls.** The proxy box `fit`, the head tile groups, the outer and occluder hulls, and the wound-list bypass.
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
