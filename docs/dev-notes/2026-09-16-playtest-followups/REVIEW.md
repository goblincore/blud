# End-to-end review — all five owner requirements on the accumulated branch

2026-09-16 playtest follow-ups, end-of-chain review. Branch
`codex/playtest-followups-task-4`, from task-1 `b8636ffc`, task-2 `d84b1f09`,
task-3 `bb5150e9` (all inherited on top of `ed97cd14`,
`claude/dynamite-weapon-slot`). This task's code + evidence commit is recorded
in §8; this document is the honest accumulated status at that tip.

**Owner report (ed97cd14)** and the parts that answer it:

| # | Owner report | Answered by | Status |
| --- | --- | --- | --- |
| 1 | Random long pause on cold start; reloads smoother | task 1 → [COLD-START.md](COLD-START.md) | **PARTLY** — biggest block fixed; residual cold premium ~150 ms attributed, not fixed |
| 2 | Rupture too subtle; chest peel swallows the head; suggested shockwave | **task 4** → [TRANSITION.md](TRANSITION.md) | **FIXED (head merge) / IMPROVED (read)**; shockwave default OFF, unaccepted |
| 3 | Preserve distinct head silhouettes / face textures; no kicking yet | task 2 → [ANATOMY-HEADS.md](ANATOMY-HEADS.md) | **FIXED** |
| 4 | Gib launch closer to NotBlood; pieces cluster too much | task 3 → [PHYSICS.md](PHYSICS.md) | **FIXED** by the source-derived spread (landing spread 5.08×) |
| 5 | Always-split upper/lower limbs; less clutter; grounded rest | task 2 + task 3 | **FIXED** |

**No owner acceptance is claimed anywhere in this chain.** The captures and
clips are review material; model inspection is not a playtest.

## 1. Cold-session pause (task 1)

- **Measured before:** cold READY ~4.07 s mean, reload ~3.82 s mean; the
  cold-vs-reload gap is only ~150–260 ms (~5 %). The owner's random 38.9 s
  one-off / WebGPU device loss did **not** reproduce in 18 fresh-profile loads
  plus a freeze-probe run.
- **Fixed (commit `b8636ffc`):** `spawnAll` built and containment-validated the
  body per actor (23 builds/load). Memoizing the per-character body build drops
  it to 2 builds/load: spawn block 862 → 135 ms, cold READY −784 ms (~19 % or
  ~0.74 s), the same gain on reloads. No visual or behavioural change.
- **Attributed, not fixed:** `SegmentMeshCache` extraction (~700–790 ms every
  load, load-invariant) and shader/pipeline compile inside
  `drawOnce`+`precompile` (~1.4 s, deliberately behind the loader). The residual
  cold-only premium (~150 ms) is first-session browser/V8/shader cache warmup;
  there is no in-scope app change that removes it.
- **Status:** the largest single fixable block is fixed; the reported pause is
  substantially shorter but cold start is still ~3.7 s. Not claimed fully solved.

## 2. Rupture, coherent head motion and the shockwave (task 4)

- **Reproduced, measured:** the old detached head left the chest 0.409 m above
  the head along the body axis at release (head moved 0.013 m, chest 0.422 m) —
  the chest rose into the head. The fix attaches the head to the upper torso
  (`headFollow 0.85`) and guarantees a 0.07 m neck gap along the body axis;
  measured after: head 0.445 m, chest 0.375 m, **head 0.070 m above the chest**.
- **Visual:** the old read merges head and chest into one mottled mass by the
  last window frame; the new read keeps a distinct head, neck gap, pale
  ribcage and separated abdomen at 2.4 m front/3-quarter and at 5.25 m gameplay
  distance, then releases the same regions with no snap or material blink
  (task-4 rotation preserved: 57.7° body / 62.5° chunk at release, 4.87 rad/s).
- **Root recoil** (0.05 m uniform) and the **sharp seam/peel** keep the tear
  reading at normal speed. The 200 ms window is unchanged; the read was made
  stronger, not longer.
- **Shockwave experiment:** a bounded, toggleable, deterministic screen-space
  refraction in the final blit (≤ 4 blasts, ≤ 2 % UV offset, ring profile,
  sim-time aging, no new target/pipeline). It compiles and runs clean, is
  localized, and does not warp the DOM HUD/reticle or mask the anatomy. At
  2.4 m it is a subtle shell; at 5.25 m it is barely perceptible, so it is
  **left DEFAULT OFF and recorded as an unaccepted experiment** with an honest
  A/B (same seed/pose/timing, `?blastdistort=`).
- **Status:** the reported head defect is fixed; the tear read is improved; the
  shockwave is a candidate for the owner's judgement, not accepted.

## 3. Recognizable heads (task 2)

- **Fixed:** the gore pass now runs after the face layer and is attenuated by a
  face/head-exterior cover, so a standing body, a rupture body and a detached
  chunk keep the painted face and head skin; the bake mirrors it
  (`bakeFaceCover`). The blast plan no longer emits a duplicate `bone.skull`
  next to the whole flesh head, so two indistinguishable heads cannot appear.
  `HEAD_EXTERIOR_GORE_KEEP` is shared by the shader and the CPU bake so they
  cannot drift.
- **Preserved under task 4:** the head region carries its own face anchors
  (centre from `headShape(drawnBody())`, rotation composed with the rig base),
  so the face follows the new head motion; the neck cut keeps its torn
  treatment. Head-crown/back remain bloodied (documented limitation), no
  skull/material polish was attempted, and no head-kicking feature exists.
- **Status:** fixed per the owner's requirement.

## 4. NotBlood-like gib launch (task 3)

- **Fixed:** the old per-piece `concussionVelocity(at, origin, …)` correlated
  neighbours on one radial spoke. `gib-launch.ts` replaces it with the source's
  two-path model: an independent, hash-deterministic per-piece spread from the
  ported gib table (`atc`/`at10`, unit chain pinned) plus one shared
  `ConcussSprite` body shove. `?giblaunch=radial` is the labelled control.
- **Measured:** 0.5 s landing-distance range 1.30 m vs 0.26 m for the control
  (**5.08×**). Honest caveat recorded: the 3D direction-dot is *worse* for the
  new path (0.947 vs 0.855) because the source table gives every gib a strong
  upward kick; direction-dot alone is the wrong acceptance metric, and the
  landing-spread and the normal-speed clips are the ones that changed.
- **Status:** fixed by the source-derived spread, with the adverse metric
  reported rather than hidden.

## 5. Always-split limbs, density and grounded rest (tasks 2 & 3)

- **Split-only:** the blast shape is `gibBlastPlan`, a priority-ordered 14-piece
  set (`head`, `torso.chest`, four `*.upper`, `bone.cage`, four `*.lower`,
  `torso.abdomen`, `torso.pelvis`, `organ.gut`). Under a tight pool it degrades
  by a PRIORITY PREFIX of that list, never by merging an upper/lower pair back
  into a tube. The old whole-limb ladder was deleted. Preview and release are
  planned by the same function, so a tight pool cannot preview rich and spawn
  cheap (measured fresh `?maxchunks=12`: 9 preview / 9 spawned, same shape).
- **Less clutter:** the optional gut is first to drop; duplicate skull/pelvis
  bones and long bones of an already-severed limb are suppressed.
- **Grounded rest (task 3):** `Chunk.support` is the piece's own local geometry
  (one sphere per capsule end); `stepChunk` floors at the lowest world point for
  the current orientation and re-seats upward after a topple. Real severed
  limbs settle with a rendered surface gap of **0.0000 m** (from ~half-limb
  float), and `chunkSettled` uses the same predicate.
- **Status:** fixed. `?gib=pieces` still previews-then-spawns (session-indexed
  shape, documented); carve keeps the old single-sphere support (non-default).

## 6. Acceptance checklist (candidate, for the owner's playtest)

- [ ] Cold start no longer shows a random long pause (task 1: biggest block
      fixed; residual ~150 ms first-session warmup remains).
- [ ] The rupture reads as a tear, not inflation, at normal speed.
- [ ] The head is not swallowed by the chest; the neck is visible.
- [ ] The face and head silhouette stay recognizable through the release.
- [ ] Pieces leave on varied, uncorrelated arcs (NotBlood spread), not one spoke.
- [ ] Arms and legs are always upper/lower sections, never whole tubes.
- [ ] Resting pieces lie on the floor, not floating or upright.
- [ ] The shockwave distortion (default OFF) either helps the read or is dropped.

## 7. Remaining issues / limits (honest)

1. **Owner acceptance is not claimed**; this is a candidate review, not a merge.
2. **Cold start is improved, not solved** — extraction (~0.75 s) and shader
   compile (~1.4 s) are attributed and unchanged; the ~150 ms cold premium is
   browser-cache warmup.
3. **The shockwave does not clearly improve the gameplay-distance read** and is
   default OFF/unaccepted. No depth gate, so an occluded blast is still warped;
   a depth-gated version is a renderer change.
4. **Head attachment is translation-only** (damped head spin preserves the
   face); a fuller rotational attachment was not attempted.
5. **The default `?skeleton=mesh` segment-mesh skeleton is not region-rotated**
   (pre-existing limitation). No detached skull was observed in the captures,
   but the mismatch is still a renderer-level gap.
6. **Torso cavity brightness** remains the documented limitation from the
   accepted skeleton work; **`?gib=pieces`** keeps the old preview route.
7. **No performance claim**: frozen captures are not perf tests, and the one
   live-loop lifecycle run was under load. No full-suite run; two focused sets
   (692 tests this task + 201+459 in task 3) plus `tsc` and the production
   build passed.
8. **Extracted Blood assets are dev-only** and were never committed.

## 8. Playtest URL, settings and commit

Code + evidence commit: **`23497213`** on `codex/playtest-followups-task-4`
(recorded in the following doc-only commit). Node `v22.22.1`. Owned Vite on
`5434` + headless Chrome `9434` (`--enable-unsafe-webgpu`); the owner's
`5391`/`5415` servers and Chrome were never touched.

Default candidate (no experiment flags):

```
http://localhost:<owned-vite>/sdf-game.html?room=arena&seed=7
```

The exact captured settings were `?room=arena&frozen=1&vhs=off&seed=7&gibtear=0.2`
(headless, `presentedShot()` 800×600 at 960×720 CSS DPR 1), with
`&explosionfx=standin` for the anatomy-only head A/B and real VFX otherwise.
The shockwave A/B adds `&blastdistort=0`/`&blastdistort=1`; the head control
adds `&tearhead=0&tearneck=0&tearrecoil=0`. `__sdfGame.setBlastDistort(true)`
toggles the experiment live for a same-session judgement.

No merge, no push — the root reviews and offers the candidate for manual test.
