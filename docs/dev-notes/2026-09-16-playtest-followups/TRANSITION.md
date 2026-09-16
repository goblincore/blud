# Transition — coherent head motion, a stronger tear, and the shockwave experiment (task 4)

2026-09-16 playtest follow-ups, task 4. Worktree
`2026-09-16-blud-playtest-followups-task-4`, branch
`codex/playtest-followups-task-4`, from task-3 tip `49e9c95d`
(which sits on `ed97cd14`, `claude/dynamite-weapon-slot`). The code + evidence
commit is **`23497213`**. Node `v22.22.1`.
Owned Vite on `5434` + headless Chrome `9434` (`--enable-unsafe-webgpu`), all
scratch under `/tmp` (the profile is outside the Vite root so the watcher cannot
reload the page mid-capture). The owner's `5391`/`5415` servers and their Chrome
were never touched. No merge, no push. **Owner acceptance is NOT claimed.**

**Owner report this task answers.** *"Rupture too subtle. Chest peel currently
moves upward into the head, giving a false swollen/big head; carry the head
coherently with upper-body motion and retain neck/head separation."* plus the
suggested *"visual blast shockwave/distortion"* as a bounded, toggleable
experiment. Reports 1/3/4/5 are carried by tasks 1–3; the accumulated
end-to-end acceptance is in [REVIEW.md](REVIEW.md).

## 1. The defect, reproduced and measured

`ruptureOffsets` gave the ribcage-bearing chest band a full blast push **plus**
an independent `chestPeelM = 0.3 m` lift along the body's cranial axis, while
the head — a separate region with no cut link to the chest — kept only
`headDamp = 0.3` of its own push. The chest therefore out-travelled the head by
~0.3 m and rose *into* it: the two flesh masses merged and read as one swollen
head. Measured on the posed zombie at the release age, along the plan's own
`up` axis (positive = head above chest):

| arm | `|head|` | `|chest|` | head−chest along `up` |
| --- | ---: | ---: | ---: |
| `?tearhead=0&tearneck=0` (**old detached head**) | 0.013 m | 0.422 m | **−0.409 m** (chest 41 cm above the head) |
| default (**attached head + neck gap**) | 0.445 m | 0.375 m | **+0.070 m** (head 7 cm above the chest) |

`gib-tear.test.ts` pins both ends: `the detached control IS the reproduced
defect` asserts the control is at least 5 cm negative, and `carries the head
with the upper torso and opens the neck seam` asserts the default is positive
and ≥ `neckGapM`.

## 2. What changed

| # | Change | File |
| --- | --- | --- |
| 1 | **Head attachment.** `TearTuning.headFollow` (default 0.85) + `neckGapM` (0.07 m). After the per-region offsets are computed, the head is re-attached: it rides `headFollow` of the upper torso's offset, keeps `1−headFollow` of its own damped recoil, and the neck is guaranteed to open by at least `neckGapM` ALONG THE BODY'S OWN AXIS on the sharp seam ramp. The guarantee is a minimum against the parent's own up-travel, so no blast direction and no amount of chest peel can leave the head underneath the chest. `headAttachParent` prefers `torso.chest`, else the region whose origin is nearest the head (so the `clusters` tier works too). With both knobs 0 the whole attachment is inert — that is the honest A/B control. | `gib-tear.ts` |
| 2 | **Root recoil.** `TearTuning.recoilM` (default 0.05 m): one uniform whole-body displacement along the body's direction away from the epicentre, on the same ease-out as the push and **not** relaxing back. Uniform on purpose — pure recoil, opening no seam of its own, so it cannot reintroduce the inflation the seam ramp exists to prevent. | `gib-tear.ts` |
| 3 | **Page knobs + honest A/B.** `?tearhead=` / `?tearneck=` / `?tearrecoil=` (0 restores the old detached-head read), and the defaults are read from `TEAR_TUNING` so the page and the module cannot drift. | `webgpu/game-main.ts` |
| 4 | **Bounded blast refraction (experiment, default OFF).** A ring-shaped screen-space displacement folded into the existing final blit: at most FOUR unrolled blasts, summed UV offset clamped to 2 % of the screen, ring profile `sin²(πt)` raised to the 4th (zero at the blast centre and at the expanding front), aged on SIM time, inert while off. `?blastdistort=1` / `?bdstrength=`, plus a live `__sdfGame.setBlastDistort()` seam so a rig can capture the **same** frame off and on. No new render target and no per-blast pipeline. | `webgpu/post-aa.ts`, `webgpu/game-main.ts` |

Unchanged: the rupture's separation geometry through task 3 (peel, seam ramp,
gore ramp, tier coherence), the task-4 rotation/spin hand-off, the release
`delay = 0`, pre-existing wounds/face anchors/cut caps/source frames, the
accepted face/material ownership, and the bounded chunk pools. The explosion
light pool (the fixed lightsNode-key stall fix) is untouched.

## 3. Telemetry — deterministic, and the shockwave is post-only

All seven final runs (front/3-quarter/gameplay, real VFX, `?seed=7`) report the
same simulation: `maxOffset 0.477 m` at the last window frame, `57.7°` largest
region tilt, release at `217 ms` with `tier=parts`, `14` pieces, `62.5°` chunk
tilt and `4.87 rad/s` spin. The `blastdistort=0` and `=1` runs are numerically
identical, which is the proof the experiment is a pure post-process and that the
A/B is same-seed/pose/timing.

```
t4v-front       view=front        dist=2.4  | maxOffset@200ms=0.477m rot=57.7deg | release=217ms spawned=14 tier=parts chunkRot=62.5deg spin=4.87
t4v-3q          view=threequarter dist=2.4  | ... identical ...
t4v-play        view=threequarter dist=5.25 | ... identical ...
t4sw-off/on     view=front        dist=2.4  | ... identical ...
t4sw-play-off/on view=threequarter dist=5.25 | ... identical ...
```

The lifecycle rig (`sdf-gib-rupture-lifecycle.mjs 5434 9434 "&blastdistort=1"`)
finished `PASS` with `pageErrors: []`: moving cast ruptures once, a second blast
during the window does not reschedule, repeated explosions stay at the bounded
`64/64` pool, reset mid-window drains. Cold blast `8.4 ms`, repeated `1.7 ms`;
frame p50 27 ms / p95 36 ms on a live loop that was under load — reported raw,
not as a performance claim. The `tightMultiBody` in-session confound (already
documented in tasks 2/3 — the pool holds 64 views before `maxchunks` is set)
reproduces exactly as before.

## 4. Native-vision observations (every image opened, not inferred)

| Image | What was inspected | Observation |
| --- | --- | --- |
| `captures/task4-head-ab-f11.jpg` | OLD (detached) vs NEW (attached), 2.4 m front, 3× torso crop, last window frame (200 ms) | **OLD:** the chest flesh has climbed into the head's lower half and the two form one continuous mottled mass — the swollen-head read. **NEW:** the head is a distinct oval with a visible neck gap; the pale ribcage stands below it and the abdominal mass is separate. |
| `captures/task4-head-ab-f08.jpg` | same pair, 150 ms | Same difference earlier: the old chest is already overlapping the head base; the new head sits clear above the opening ribcage. |
| `captures/task4-head-ab-columns.jpg` | the pair as an 8-row column (f2…f14) | The new column keeps a head/neck/ribcage/abdomen stack for the whole window; the old column progressively merges head and chest. |
| `captures/task4-front-sheet.jpg` | default, front, real VFX, 16 tiles | f0 intact posed body; f1–f4 the chest band lifts and the pale rib ladder opens; f6–f11 the head is a distinct top mass with the neck gap, ribs and separated abdomen readable; f12 pieces spawn at the same tilt (no snap); f13–f18 they fly and rotate. |
| `captures/task4-threequarter-sheet.jpg` | default, 3/4, real VFX | Same separation off-axis; the head stays a distinct mass and the pieces leave on varied arcs. |
| `captures/task4-gameplay-sheet.jpg` | default, 3/4, **5.25 m gameplay distance**, real VFX | The body reads as a body at f0; by f6–f11 the ribs show and the head is separated; f12 release; f15–f18 pieces scatter. The read is legible but smaller, as expected at distance; the real fireball dominates after ~400 ms (pre-existing VFX). |
| `captures/task4-shockwave-diff-f03.jpg` | pixel diff of the same frame, distortion off vs on, 2.4 m | A single compact ring centred on the projected blast (lower torso) with a few faint concentric floor arcs — localized, not a full-frame warp. |
| `captures/task4-shockwave-gameplay-diff-f03.jpg` | same diff at 5.25 m | A compact ring on the upper body plus faint gun-edge shifts; the rest of the frame is effectively unchanged. |
| `captures/task4-shockwave-off-on-f03.jpg` | off vs on crops, 2.4 m | The on frame is subtly refracted through the body/floor; the gun and HUD region are essentially untouched (the HUD and reticle are DOM, outside the canvas). |
| `captures/task4-rupture-front-normal.mp4`, `task4-rupture-gameplay-normal.mp4` | 0.5 s at 60 fps, looped 4× | Normal-speed read: recoil, chest peel, rib reveal, head carried clear, release with no dead frame. |
| `captures/task4-head-old-detached-normal.mp4` / `task4-head-new-attached-normal.mp4` | the head A/B as normal-speed clips | Old merges head into chest by the last window frames; new keeps the neck gap. |
| `captures/task4-shockwave-off-normal.mp4` / `task4-shockwave-on-normal.mp4` | the shockwave A/B as normal-speed clips | At normal speed the distortion is a brief, subtle refraction around the blast; it does not read as a strong shockwave at gameplay distance. |

**Honest reading of the shockwave.** It is localized, bounded, deterministic,
compiles and runs with no page errors. At 2.4 m it reads as a gentle shell; at
5.25 m it is barely perceptible at normal speed. Because a barely-perceptible
effect does not clearly improve the read, it is **left default OFF and recorded
as an unaccepted experiment** — the toggle and strength control exist for the
owner to judge, and the A/B material is committed. It does not mask the anatomy
(the ring is small and zero at its centre) and it is not used to cover broken
geometry.

## 5. Tests and build

```
npx vitest run <30 focused files: gib-tear, gib-parts, gib-rupture, gib-chunks,
  gib-launch, gib-rest, explosion-aoe, sever, sever-bones, humanoid-sever,
  detached-pose, melt, melt-bones, melt-gate, chunk-bake-field, march.wgsl,
  crowd-records, post-aa, game-actor{,-soldier,-collision,-bounded-wounds,
  -elbow,-torso-slug}, baked-chunks, chunk-bake-jobs, gib-carve,
  gib-sprite-pieces, march-step-soundness, dynamite-panel>
# 30 files passed, 692 tests passed, 0 failed

npm run build        # tsc --noEmit && vite build — exit 0, built in 6.26s
```

New/updated pins:

- `gib-tear.test.ts` (26, +4/−1) — the detached control reproduces the defect
  (chest ≥ 5 cm above the head); the default carries the head and guarantees the
  neck gap; the head/chest separation stays ≤ `neckGapM + 3 cm` across the whole
  window (no independent lag); the root recoil is uniform and points away from
  the blast.
- `post-aa.test.ts` (42, +7) — the refraction is off/empty by default and inert
  in the parity path; enabling it runs the blit; the ring is bounded to four
  (oldest dropped); off-screen/behind-camera/degenerate feeds are dropped; it
  ages on sim time and expires; strength clamps to [0,4]; the WGSL loop is
  unrolled, bounded and offset-clamped, and is a separate fn appended after
  `postAaBlit` (the `^`-anchored parse contract). The existing
  `every declared WGSL parameter is supplied at the call site` gate covers the
  five new blit params.

## 6. Reproduction

```
bash scripts/link-dev-assets.sh
LAB_VITE_PORT=5434 LAB_CDP_PORT=9434 LAB_TMP=/tmp/blud-t4-lab \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; while true; do sleep 30; done' &

# default read, real VFX
RUP_VIEW=front        RUP_DIST=2.4  RUP_FRAMES=30 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "" t4v-front
RUP_VIEW=threequarter RUP_DIST=2.4  RUP_FRAMES=30 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "" t4v-3q
RUP_VIEW=threequarter RUP_DIST=5.25 RUP_FRAMES=30 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "" t4v-play

# head A/B (old detached head) — same seed/pose/timing, stand-in VFX
RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=18 RUP_VFX="&explosionfx=standin" \
  node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-ab "&tearhead=0&tearneck=0&tearrecoil=0" t4-head-detached

# shockwave A/B
RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=18 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "&blastdistort=0" t4sw-off
RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=18 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "&blastdistort=1" t4sw-on
RUP_VIEW=threequarter RUP_DIST=5.25 RUP_FRAMES=18 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "&blastdistort=0" t4sw-play-off
RUP_VIEW=threequarter RUP_DIST=5.25 RUP_FRAMES=18 node scripts/sdf-gib-rupture.mjs 5434 9434 /tmp/t4-final "&blastdistort=1" t4sw-play-on

# lifecycle / repeated blasts
node scripts/sdf-gib-rupture-lifecycle.mjs 5434 9434 "&blastdistort=1"
```

Emulated viewport 960×720 CSS at DPR 1; `presentedShot()` came back 800×600.
Frozen loop (`?frozen=1`), one fixed 1/60 s step per captured frame, `?seed=7`,
`?gibtear=0.2`, `?vhs=off` (the shockwave A/B additionally uses
`?blastdistort=`).

## 7. Limits / honest gaps

1. **Owner acceptance is not claimed.** Model inspection is not the owner's
   playtest.
2. **The shockwave does not clearly improve the read at gameplay distance** and
   is therefore default OFF / unaccepted (see §4). Its screen-space nature also
   means a wall between the camera and the blast is still warped; the feed drops
   behind-camera and off-screen blasts, but there is no depth gate. A
   depth-gated version is a renderer change, not a bounded experiment.
3. **The head attachment is translation-only.** The head keeps its damped
   `headSpin` rather than fully following the chest's rotation, so the face
   stays legible. This is deliberate and preserves the task-2 face read; a
   fuller rotational attachment was not attempted.
4. **No 150/250 ms re-comparison was run.** The 200 ms window is unchanged from
   the accepted task-2/3 choice; this task made the window read stronger rather
   than longer, per the brief ("don't merely lengthen delay").
5. **The default `?skeleton=mesh` segment-mesh skeleton is still not
   region-rotated** (documented in the earlier rupture work). At the last
   window frame the marched flesh and the visible ribs are coherent in the
   captures; no detached skull was observed, but the mismatch remains a
   renderer-level limitation, not fixed here.
6. **No performance claim.** The refraction adds four `vec4` uniforms and one
   four-iteration loop to the existing blit; frame times were not measured.
   The lifecycle run's live-loop numbers are reported raw under load.
