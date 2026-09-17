# Body-to-gib rupture — implementation (Task 1)

Branch: `codex/body-to-gib-rupture-task-1` (dispatch worktree), starting from
accepted baseline `4dcb1ffd` on `claude/dynamite-weapon-slot`. No merge, no push.

The owner's report: throw dynamite -> explosion -> the character *instantly*
becomes separate chunks. The old `gib-tear.ts` window did exist, but its
envelope (`tearAmount`) rose and then **relaxed back to zero** at the end of its
100 ms: the last frame before release was the intact body again, so increasing
the timer would only hold an intact body on screen longer. This task replaces
that with a **continuous, monotonic, region-rigid rupture** whose final frame
*is* the frame the chunks are spawned from.

## 1. Decision: one plan, region-rigid, monotonic

| Concern | Decision |
| --- | --- |
| Region representation | The existing `gibParts` partition, extended into a **reusable `GibPlan`** (`pieces[]` + piece-to-piece `cuts[]`) with `srcPrims[]`/`srcBones[]` indices back into the posed body. No second partitioning scheme. |
| Posed snapshot ownership | `scheduleGib` calls `gibPlan(a.posed())` **once**, at the blast, from the clean posed body. The plan is handed to `beginTear` (visualization) and kept on the pending queue for `gibActor` (physics). `a.posed()` stays clean throughout. |
| Progress / clock | `ruptureProgress(t, sec)` — monotonic ease-out, **0 at 0, exactly 1 at `sec`, stays 1**. `sec` defaults to 0.2 s (contract range 0.15–0.25). The actor owns the clock (`stepTear`), stepped by `spawnScheduledGibs`, so a frozen capture still advances and releases. No `Date.now`, no `Math.random`. |
| Region motion | Every region is translated **rigidly** — all its flesh prims, its bone prims and its `sub` caps by one offset. The push is `amplitudeM · e^{-d/falloffM} · falloff · progress · shudder`, damped on the head and lagged on bones. |
| Seams | Each cut adds a symmetric separation `±n · seamM · e^{-d/falloffM} · falloff · progress` to its two sides. This is what opens a gap between neighbours the blast pushes almost equally. |
| Skeleton exposure | Bones follow only `boneLag` (0.3) of the flesh push and take no seam, so the flesh recedes and the skeleton is left in the gap. For the forward **mesh-skeleton** default the bones are a separate object on the same rig, so they are simply exposed. For `?skeleton=procedural` the actor calls `view.setBonesBare(true)` while rupturing (folds the procedural bones bare) and the WGSL pale-bone branch now keys on `counts2.y` as well as `meltCfg.x`. |
| Preview-to-flight handoff | At release, `spawnScheduledGibs` reads `actor.tearFrame()` — the same `rupturePosed` result last uploaded — and spawns `displaceGibPieces(plan.pieces, offsets)`. The displayed region and the spawned piece are the same prims at the same transform; no second pose, no second partition, no snap. |
| Caps / faces | Caps are part of the piece (`srcPrims` does not index them) and translate with it, so each side keeps its own capped cut plane. The head region is damped (`headDamp` 0.3) and `meltCfg` stays 0, so the face projection and the painted face are untouched (no melt sag, no face melt). |
| Budget / timing | Budget allocation is unchanged and still happens at **release**, in `spawnScheduledGibs` (greedy, nearest-first, tier ladder). The rupture only prepares the `parts` plan; a tight pool degrades it exactly as before. |
| Kill vs. retirement | The kill is immediate: the resolver already marked the body `gibbed` at impact. The rupture is **only** the visual retirement. A doomed actor cannot attack or move (`step` overrides the mind's verdict; `meleeCapable`/`committed`/`engagedForCrowd` are false) while it is still drawn. |

`stepPendingGibImpulses` (the zero-velocity birth + staggered launch) is
unchanged: the pieces are still born at the ruptured transform with zero
velocity and get their concussion velocity one stagger-step later.

## 2. Residual / continuity

The displayed body is the original posed prims translated by their region
offset; the pieces are the partition of those same prims (plus caps) translated
by the same offsets. The only difference is the **existing** partition residual
— cluster seams and the smoothed cut fillet — which the clean path already had.
`gib-parts.test.ts` measured it at ~5.4 % of sampled surface points for the
clean body; the new `gib-rupture.test.ts` re-measures the *displaced* body
against the displaced piece union and requires the same order (< 10 %, measured
value in the test). No new pop is introduced by the transition: at progress 0
the frame is byte-identical to the posed body, and at progress 1 the drawn
regions are the spawned regions.

## 3. Immediate kill / non-interaction audit

The immediate path was traced before scheduling was touched:

- `detonateAt` -> `resolveExplosion` marks `pb.gibbed` for a lethal blast; there
  is no second death event.
- The gibbed branch is the only death hook for the dynamite path, so
  `scheduleGib` is the single place a rupture starts.
- `scheduleGib` refuses a body already `tearing()` or already queued, so a
  second blast cannot schedule a second breakup or reset the clock.
- A body mid-rupture stays in `actors` (so it is drawn) but `doomed=true`, which
  overrides `mind.step`'s verdict to `halt/target:null/attack:null/fire:false`
  and makes `meleeCapable()`, `committed()`, `engagedForCrowd()` false. It cannot
  swing, shoot or chase during the window.
- Room reset / cast rebuild (`rebuildCast`) drains every pending window with
  `endTear()` and clears `pendingGibs` / `pendingGibImpulses`, so a reset during
  a transition cannot gib a stale actor or launch a stale chunk id.

## 4. Files

- `src/lab/sdf-zombie/gib-parts.ts` — `gibPlan()`, `GibPlan`, `GibCutLink`,
  `srcPrims`/`srcBones`, `displaceGibPieces()`; `gibParts()` is now a wrapper.
- `src/lab/sdf-zombie/gib-tear.ts` — `ruptureProgress`, `ruptureOffsets`,
  `rupturePosed`, extended `TearTuning`; the old `tearAmount`/`tearPosed`
  (relax-to-clean-pose) are removed.
- `src/lab/sdf-zombie/webgpu/game-actor.ts` — plan on `beginTear`, rupture
  frame, `tearFrame()`, `doomed` suppression, `setBonesBare` while rupturing.
- `src/lab/sdf-zombie/webgpu/game-main.ts` — plan prepared once in
  `scheduleGib`, reused in `spawnScheduledGibs`; reset drains windows; default
  `gibTearSec` 0.2; rupture telemetry.
- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` — exposed-bone material read and
  pale-bone branch keyed on `bareBones` (`counts2.y`), separate from the melt
  flesh ramp.
- `scripts/sdf-gib-rupture.mjs` — the frame-sequence capture rig.
- Tests: `gib-tear.test.ts` (rewritten), `gib-rupture.test.ts` (new),
  `gib-parts.test.ts` (plan identity + hand-off), `march.wgsl.test.ts` (shader
  pins updated).

## 5. Diagnostics / controls preserved

- `?gibtear=0` is the zero-duration comparison path: no window, pieces spawn in
  the blast frame (unchanged).
- `?gibtear=<0..0.4>` retimes the window; `?gibtear*` panel knobs
  (`tearAmp`, `tearJiggle`) plus the new page defaults (`seamM`, `boneLag`,
  `headDamp`) drive every actor.
- `dynamite()` now also reports `ruptureMaxM` — the largest region offset any
  body is being drawn with — so a rig can assert the body is separating rather
  than trusting a frame.
- `__sdfGame.playerPos()` is a read-only accessor added so `sdf-gib-rupture.mjs`
  can stand the player beside the chosen body instead of detonating across the
  room. It has no gameplay effect.

## 6. Verification

Commands and exact counts are recorded in `RESULTS.md` next to this file.

## 7. Limitations

- Full visual tuning/review is Task 2. This task proves the transition runs and
  that rib exposure and the hand-off are visible; it does not claim the timing
  "feels right".
- The reported startup / first-gib freeze is a separate, still-undiagnosed task.
  The rupture *moves* the first piece-spawn work from the blast frame to the
  release frame; the frozen capture cannot measure that hitch, and no startup
  timing is claimed here.
- Deferred rendering keeps its pre-existing `gMarchAnchor` limitation.
