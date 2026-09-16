# Body-to-gib rupture — verification results (Task 1)

Worktree `2026-09-16-body-to-gib-rupture-task-1`, branch
`codex/body-to-gib-rupture-task-1`, from `4dcb1ffd`. Node `v22.22.1`.
Implementation decision and design: [IMPLEMENTATION.md](IMPLEMENTATION.md).

## 1. Typecheck and build

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean (no output) |
| `npm run build` (`tsc --noEmit && vite build`) | exit 0; `✓ built in 5.89s` |

## 2. Focused tests

Single consolidated run (tear, parts, chunks, explosion, sever, melt, actor,
bake, carve, march shader, panel):

```
npx vitest run \
  src/lab/sdf-zombie/gib-tear.test.ts src/lab/sdf-zombie/gib-parts.test.ts \
  src/lab/sdf-zombie/gib-rupture.test.ts src/lab/sdf-zombie/gib-chunks.test.ts \
  src/lab/sdf-zombie/explosion-aoe.test.ts src/lab/sdf-zombie/sever.test.ts \
  src/lab/sdf-zombie/sever-bones.test.ts src/lab/sdf-zombie/humanoid-sever.test.ts \
  src/lab/sdf-zombie/detached-pose.test.ts src/lab/sdf-zombie/melt.test.ts \
  src/lab/sdf-zombie/melt-bones.test.ts src/lab/sdf-zombie/melt-gate.test.ts \
  src/lab/sdf-zombie/chunk-bake-field.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor.test.ts src/lab/sdf-zombie/webgpu/game-actor-soldier.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor-collision.test.ts src/lab/sdf-zombie/webgpu/game-actor-bounded-wounds.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor-elbow.test.ts src/lab/sdf-zombie/webgpu/game-actor-torso-slug.test.ts \
  src/lab/sdf-zombie/webgpu/baked-chunks.test.ts src/lab/sdf-zombie/webgpu/chunk-bake-jobs.test.ts \
  src/lab/sdf-zombie/webgpu/gib-carve.test.ts src/lab/sdf-zombie/webgpu/gib-sprite-pieces.test.ts \
  src/lab/sdf-zombie/webgpu/march-step-soundness.test.ts src/lab/sdf-zombie/webgpu/dynamite-panel.test.ts
```

Result: **26 files passed, 596 tests passed, 0 failed.**

New/rewritten tests:

- `gib-tear.test.ts` (10) — monotonic progress that clamps at 1 (never relaxes
  to the clean pose), progress 0 is the posed body bit-for-bit, flesh leads bone,
  head damping, every cut opens, cull bound covers the moved flesh, no NaN on an
  on-prim blast, purity, determinism.
- `gib-rupture.test.ts` (5) — actor-level lifecycle: doomed bodies cannot
  fight/move but are still drawn; the clock ends exactly once; the released
  frame is the plan displaced by the frame last drawn; a reset mid-window drains
  cleanly; the displaced piece union covers the displaced body (< 10 % residual,
  the pre-existing partition residual).
- `gib-parts.test.ts` (18, +5) — `srcPrims`/`srcBones` partition every live
  flesh/bone prim exactly once (organs are their own region), caps carry no
  source index but ride their piece, cuts link real pieces, `displaceGibPieces`
  is identity at zero and a rigid translation otherwise.
- `march.wgsl.test.ts` (234) — updated pins for the `bareBones` exposed-bone
  material read and the pale-bone/wet branches being separate from the melt
  flesh ramp.

## 3. Real rendered sequence

Two capture runs on `http://127.0.0.1:5399/sdf-game.html` (own Vite server;
Chrome 152 headless, own CDP port 9399, `--enable-unsafe-webgpu`), driven by the
new `scripts/sdf-gib-rupture.mjs`. The owner's server on 5391 was not touched.

```
node scripts/sdf-gib-rupture.mjs 5399 9399 /tmp/gib-rupture-new2 ""                    # forward mesh skeleton (default)
node scripts/sdf-gib-rupture.mjs 5399 9399 /tmp/gib-rupture-proc  "&skeleton=procedural"
node scripts/sdf-gib-rupture.mjs 5399 9399 /tmp/gib-rupture-control "&gibtear=0"       # zero-duration control
```

Target: arena zombie id 17, 5.25 m from the player. All three runs exited 0 and
reported **no page errors**. Frames: 0..30 at 60 Hz (0–500 ms); the release
window is 0.2 s, so frame 12 is the first chunk frame.

### Default (mesh skeleton) — `maxOffset` climbs 0.022 m → 0.093 m

```
frame + 0 ( 0 ms): tearing 1 age 0.026 maxOffset 0.0217m pendingGibs 1 | chunks 0/0
frame + 4 (67 ms): tearing 1 age 0.093 maxOffset 0.0670m pendingGibs 1 | chunks 0/0
frame + 8(133 ms): tearing 1 age 0.160 maxOffset 0.0882m pendingGibs 1 | chunks 0/0
frame +10(167 ms): tearing 1 age 0.193 maxOffset 0.0928m pendingGibs 1 | chunks 0/0
frame +12(200 ms): tearing 0 pendingGibs 0 | chunks 16/16
frame +30(500 ms): tearing 0 pendingGibs 0 | chunks 15/16
by name (last): legR.lower legL.upper legL.lower legR.upper torso.pelvis bone.pelvis
  armL.lower armR.lower organ.gut torso.abdomen bone.cage torso.chest
  armR.upper armL.upper bone.skull head
```

### Procedural skeleton — same offsets, skeleton folded bare

```
gibTearSec=0.2  &skeleton=procedural
frame +10(167 ms): tearing 1 age 0.195 maxOffset 0.0914m | chunks 0/0
frame +12(200 ms): tearing 0 pendingGibs 0 | chunks 16/16
```

### Zero-duration control — instant chunks, unchanged

```
gibTearSec=0  &gibtear=0
frame + 0 ( 0 ms): tearing 0 pendingGibs 0 | chunks 16/16     <- already pieces
CONTROL: gibtear=0 — pieces spawn in the blast frame, like the old path
```

## 4. Native-vision observations (images inspected)

Committed crops in [`captures/`](captures). Each is a 2.4× crop/upscale of the
target body region from the full frame; I inspected the full PNGs and the crops.

| Image | Frames inspected | Observation |
| --- | --- | --- |
| `mesh-f00.jpg` | default, 0 ms | Intact posed zombie exactly as before the blast (onset silhouette). |
| `mesh-f04.jpg` | default, 67 ms | A bright seam has opened across the torso; the upper mass leans off the hips and the limbs splay — the regions are visibly separating, not held intact. |
| `mesh-f08.jpg` | default, 133 ms | The torso is split into distinct upper/lower masses with a pale structure in the gap; the whole silhouette is stretched. |
| `mesh-f12.jpg` | default, 200 ms | The zombie is now separate chunks — mottled torn-meat pieces with the head/face chunk recognisable — i.e. the displayed regions became the spawned pieces. |
| `proc-f00.jpg` | procedural, 0 ms | Intact posed body. |
| `proc-f04.jpg` | procedural, 67 ms | A pale bone structure appears in the chest midline as the pink flesh pulls away. |
| `proc-f06.jpg` | procedural, 100 ms | The pale skeleton is clearly exposed in the opening thorax seam (this is the honest proof that exposed bones shade as bone and render). |
| `proc-f10.jpg` | procedural, 167 ms | The pale skeleton still stands in the torso gap while the flesh has separated. |
| `control-f00.jpg` | `gibtear=0`, 0 ms | The body is **already chunks** at the blast frame — no intermediate state. Contrast with `mesh-f00.jpg`. |

Full untouched sequences: `/tmp/gib-rupture-new2`, `/tmp/gib-rupture-proc`,
`/tmp/gib-rupture-control` (16 PNGs each).

## 5. Limits / honest gaps

- The default forward path uses the **mesh** skeleton, which is a separate
  object on the actor rig; the pale-rib still is the `?skeleton=procedural`
  path (where the folded `bonePrims` render). In the default path the skeleton
  is exposed by the flesh receding, but at 5 m and in this lighting the ribs are
  a few pixels — Task 2 should confirm the default read at gameplay distance.
- A true old-binary baseline (`4dcb1ffd`) was not re-run: the accepted 100 ms
  relax-to-clean-pose window is described in the handoff, and `gibtear=0` is the
  in-code control that shows the "instant chunks" behaviour it produced. The
  candidate default is `gibtear=0.2`.
- The frozen capture cannot measure the first-gib hitch. The rupture **moves**
  the first piece-spawn work from the blast frame to the release frame (frame
  ~12); `dynamite().blastProfile` and `lastBlastMs` are available to time it,
  and the previously reported startup/freeze problem remains a separate task.
- Visual feel and final tuning are Task 2.

---

# Body-to-gib rupture — Task 2 results (native-vision review, tuning, regression)

Worktree `2026-09-16-body-to-gib-rupture-task-2`, branch
`codex/body-to-gib-rupture-task-2`, inherited Task 1 as
`6898f65f` on top of `4dcb1ffd`. Node `v22.22.1`. Owned Vite on `5401` and
headless Chrome on `9401` (`--enable-unsafe-webgpu`, scratch in `.lab-tmp/`);
the owner's `5391` server was never touched. Commit for this task is the tip of
the branch (see §10).

## 1. What changed here

Task 1's implementation was reviewed first; the following are Task 2 changes.

| Change | File | Why |
| --- | --- | --- |
| **Seam opens on its own ramp, larger** (`seamM` 0.05→0.09, `sqrt(p)` seam ramp) | `gib-tear.ts` | At 0.05 m the blast's radial push dominated and the window read as INFLATION. 0.09 m + the sharper ramp makes the chest/abdomen gap legible by ~67 ms. |
| **Bones lag harder** (`boneLag` 0.3→0.15) | `gib-tear.ts`, `game-main.ts` | 0.3 let the cage ride out with the chest; 0.15 keeps it nearer the body's own pose so it sits in the opening gap. |
| **Peak push up slightly** (`amplitudeM` 0.055→0.06) | `gib-tear.ts`, `game-main.ts` | Matches the enlarged seam. |
| **Rupture hand-off launches on the SPAWN TICK** (`delay = 0` when a planned hand-off is present) | `game-main.ts` `gibActor` | The old `1 + stagger` zero-velocity hold was written for the pre-rupture path where the body was intact up to the blast frame. A body that has already separated for 200 ms then froze at release for 1–3 stagger frames — the "second pause" the contract forbids. `delay 0` still fires in the spawn tick (`stepPendingGibImpulses` runs later in the same tick), so the piece integrates its launch velocity on the release frame; the jump is `vel·dt`, identical to the delay-1 case one frame later, minus the dead frame. `?gibstagger` keeps its meaning on the `gibtear=0` path. |
| **Capture-rig determinism** (`__warmDone` gate, contiguous frames, framed camera, real sim-time + telemetry, labeled sheet) | `scripts/sdf-gib-rupture.mjs`, `scripts/sdf-gib-look.mjs` | See §2. |
| **Lifecycle/live-loop probe** | `scripts/sdf-gib-rupture-lifecycle.mjs` (new) | Behavioural evidence on the real loop. |
| **Two new pinned tests** | `gib-tear.test.ts` (12 tests, was 10) | Seam-ahead-of-push ratio and bone-lag bound. |

## 2. Evidence-quality defect found in the rigs (and fixed)

The old rigs stopped the loop, then waited on `gunReady`. But `warmPipelines`
pauses the loop and its `.finally` **re-arms** it, so the stop was silently
undone. Measured on a probe: after `detonate` and **no step**, `tearAge` reached
`0.052` in 300 ms of wall time, and the first captured frame of the Task 1 rigs
read `age 0.026` instead of `1/60 = 0.0167`. Both rigs now wait on
`window.__warmDone` before stopping the loop; the same probe then held `tearAge`
at exactly `0.0167` across 300 ms with no step. Everything below is captured
after that gate.

## 3. Timing recommendation — 200 ms

Three candidates were captured with identical character, pose, blast position,
camera, renderer and settings (`seed=7`, front bearing, 2.4 m standoff,
stand-in explosion VFX so the body is not hidden, `vhs=off`, `frozen=1`):

- **150 ms** (`c150`): release at step 8 (~150 ms). Only ~2 frames of visible
  seam before the pieces spawn; it reads as abrupt and does not give the
  "readable intermediate state" the owner asked for.
- **200 ms** (`c200`): release at step 13 (age 0.2167 s, one frame after the
  0.2 s window because of the float accumulation `12/60 < 0.2`). The torso gap
  is clearly open by f8–f11 and the pieces are already flying on the release
  frame.
- **250 ms** (`c250`): release at step 16. The extra 50 ms does not add a
  readable separation — f8–f12 look like f8–f11 of the 200 ms run — while the
  body is held longer, which is the opposite of the contract's "avoid …
  holding an intact active enemy alive" direction.

**Chosen: 200 ms** (the Task 1/plan start value). It is the shortest window in
which the chest/abdomen gap and the outward region separation are both legible
before release.

## 4. Reproduction

```
bash scripts/link-dev-assets.sh          # dev-only placeholders, never committed
LAB_VITE_PORT=5401 LAB_CDP_PORT=9401 LAB_TMP="$PWD/.lab-tmp" \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; \
           while true; do sleep 30; done' &        # owned server + Chrome

# candidates (identical settings; only gibtear differs)
RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=30 RUP_VFX="&explosionfx=standin" \
  node scripts/sdf-gib-rupture.mjs 5401 9401 /tmp/c150 "&gibtear=0.15" c150-front
RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=30 RUP_VFX="&explosionfx=standin" \
  node scripts/sdf-gib-rupture.mjs 5401 9401 /tmp/c200 "&gibtear=0.2"  c200-front
RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=30 RUP_VFX="&explosionfx=standin" \
  node scripts/sdf-gib-rupture.mjs 5401 9401 /tmp/c250 "&gibtear=0.25" c250-front

# three-quarter, gameplay-distance (real VFX) and zero-duration control
RUP_VIEW=threequarter RUP_DIST=2.4 ...  /tmp/c200-3q  "&gibtear=0.2" c200-3q
RUP_VIEW=back RUP_DIST=5.25 ...          /tmp/play200 "&gibtear=0.2" c200-play
RUP_VIEW=front ...                       /tmp/control "&gibtear=0"   control

# lifecycle + live-loop perf
node scripts/sdf-gib-rupture-lifecycle.mjs 5401 9401

# videos (ffmpeg present; the rig writes the PNG sequences)
ffmpeg -stream_loop 3 -framerate 60 -pattern_type glob -i '/tmp/play200/c200-play-f*.png' \
  -vf scale=640:-2:flags=neighbor -c:v libx264 -pix_fmt yuv420p -crf 20 rupture-normal.mp4
```

Every frame's **actual** sim time is in
[`captures/task2-c200-front-telemetry.json`](captures/task2-c200-front-telemetry.json)
(`tearAge`, `simMs`, `ruptureMaxM`, `held`, `delays`, tier, part list).

## 5. Native-vision observations (images inspected, not a census)

All images below were opened with the native image viewer, not read from
filenames:

| Image | What was inspected | Observation |
| --- | --- | --- |
| `captures/task2-c200-onset.jpg` | pre-blast onset, framed | The posed zombie, arms down, head/face intact — the silhouette the contract requires at onset. |
| `captures/task2-c150-front-sheet.jpg` | 150 ms, 16 tiles | Torso seams begin at ~f4 but the body is already chunks by f8; too abrupt for a readable tear. |
| `captures/task2-c200-front-sheet.jpg` | 200 ms, 16 tiles | f0–f6 recoil/lean; f8–f11 a **visible horizontal waist seam** opens and the chest lifts off the pelvis; f12 (release) pieces are already spread; f13+ ballistic. |
| `captures/task2-c250-front-sheet.jpg` | 250 ms, 16 tiles | Reads the same as 200 ms from ~f8 onward; the extra 50 ms only holds the body. |
| `captures/task2-c200-threequarter-sheet.jpg` | 200 ms, 3/4 view | The same seam and separation seen off-axis; limbs part from the torso; head stays a distinct mass. |
| `captures/task2-c200-gameplay-sheet.jpg` | 200 ms, 5.25 m, **procedural VFX on** | At real gameplay distance the transition still reads: body through f11, chunks at f12, pieces scattering by f15–f24 with the head recognisable. Smaller and partly lit by the burst, but no intact-body pause. |
| `captures/task2-c200-lastwindow.jpg` / `task2-c200-release.jpg` | 2.4× torso zoom, 200 ms last window frame vs release | The seam and lift are clear; **no pale ribcage is visible in the gap** (see §7). The surface texture also changes from smooth flesh to the mottled per-chunk gib material on the release frame (see §7). |
| `captures/task2-zero-duration-control-sheet.jpg` | `gibtear=0`, 20 tiles | Already chunks on the first frame — the control the contract asks to keep. |
| `captures/rupture-200ms-gameplay-normal.mp4` | 0.5 s at 60 fps, looped 4× | Normal-speed gameplay read; motion is continuous through release, no dead frame. |
| `captures/rupture-200ms-threequarter-slow.mp4` | same frames at 0.25× | Frame-by-frame timing: seam opens, then the same regions continue outward. |

The normal-speed video and the slow version were also watched frame by frame;
the release now shows the regions already moving rather than freezing (see §6).

## 6. Defects fixed, with before/after evidence

1. **Release dead frame (contract: "avoid a second pause or kick").**
   - Before (Task 1 rig telemetry, `/tmp/t2-front`): release frame showed
     `impulses 16 delays [0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2]` — every piece held at
     zero velocity for 1–3 stagger frames on a body that had been moving.
   - After: release frame shows `impulses 0`; all pieces launch on the spawn
     tick. The separation offsets are unchanged, so onset/release geometry
     continuity is untouched.
2. **Capture rigs ran the tear on wall time** (§2): first captured frame
   `age 0.026` → `0.0167`; release timings now land on the intended frame.
3. **Window read as ballooning, not tearing.** With 0.05 m seams the whole body
   expanded; with 0.09 m + `sqrt(p)` seams + `boneLag 0.15` the waist seam is
   open and the chest separates (compare the Task 1 `mesh-f08.jpg` with
   `task2-c200-front-sheet.jpg` f8/f10/f11).

## 7. Demonstrated defects NOT fixed (honest limits)

1. **Budget/tier preview is not coherent at a tight pool.** With a fresh boot at
   `?maxchunks=12`, the rupture **previews the full 16-region `parts` plan** for
   the whole 200 ms, then `gibActor` degrades and **spawns 9 pieces** as
   `clusters+core` (`legR legL bone.pelvis armL armR torso bone.cage
   bone.skull head`) — the exact "preview a full body partition and then swap to
   different cheap chunks" the contract forbids. Repro:
   `RUP_FRAMES=16 node scripts/sdf-gib-rupture.mjs 5401 9401 /tmp/tight
   "&gibtear=0.2&maxchunks=12" tight12`; evidence in
   `captures/task2-tightpool12-telemetry.json` and the sheet. The fix is to
   choose the tier at `scheduleGib` time and build the preview from the same
   regions; that needs `gibAll`'s cluster pieces to carry `srcPrims`/`srcBones`
   and a cut remap for merged regions, which did not fit this task's budget.
   In the default pool (64 views) a single-body blast does not hit this.
2. **Rib/skeleton exposure is not readable.** At 2.4 m front and 3/4, and at
   5.25 m gameplay distance, the opening torso gap shows background/explosion
   light, not a pale ribcage. The `?skeleton=procedural` path (packed bone prims
   folded bare by `setBonesBare`) was captured too and is no better. The bones
   are in the pile once released (the Task 1 census), but the "expose the rib
   cage in the gaps" milestone is **unmet** and needs a real flesh-removal/peel
   mask or a front/back torso split, both outside the stated scope.
3. **Release material pop.** The last window frame is smooth flesh; the release
   frame is the accepted mottled per-chunk gib surface. The geometry hand-off is
   continuous (Task 1's union residual), but the surface appearance changes in
   one frame — visible in the two zoom stills. Making the body wear the gib
   material through the window would be a visual change to the accepted body
   appearance and was not attempted.
4. **Pre-wounded/severed actor and a second humanoid profile**: not exercised
   in this pass (no bench seam was wired for a pre-severed arena actor), so
   whether the rupture preview matches a body whose clusters are already missing
   is unverified.

## 8. Lifecycle and live-loop results

From `captures/task2-lifecycle.json` (real loop, no `frozen`, no step-driving;
page error channel clean, `pageErrors: []`):

| Case | Result |
| --- | --- |
| Moving cast | `movingCast: true` (positions changed over 800 ms before the blast) |
| Second blast during the window | `pendingGibs` stayed `1`; `scheduledGibBodies: 1` — no second breakup, no clock reset |
| Repeated explosions | `live 64 / cap 64`, unique chunk ids, no page errors |
| Reset mid-window (`resetCast`) | mid: `tearing 1`, `pending 1`; after: `tearing 0`, `pending 0` — drained cleanly |
| Tight multi-body (`maxchunks:12` in-session) | confounded: the pool already held 64 views, so the cap did not bind (see the fresh-boot test in §7.1, which did bind) |

Notes: the second-blast and repeated cases ran on a live loop, so the tear
clock is wall time there — that is correct for a gameplay test. The frozen
rigs (§4) are the deterministic ones.

## 9. Performance (live loop; contention reported)

Measured on the real loop with an in-page rAF frame-time sampler; `frozen`
captures are not perf tests.

| Measure | Cold first blast | Repeated blast |
| --- | --- | --- |
| `dynamite().lastBlastMs` (CPU detonation) | 4.3 ms | 0.5 ms |
| frame p50 / p95 / max | 17.2 / 201.4 / 201.4 ms (n=6) | 12.5 / 171.5 / 200 ms (n=95) |

The long frames are real but **not attributed**: the machine was under
contention (load average ~3.3–4.2; the owner's `5391` Vite and many Chrome
processes were running), and no pipeline was named for them. Per the handoff,
the previously reported startup/initial-gib freeze remains undiagnosed and is
NOT fixed or hidden here; `lastBakeMs`/`lastBakeSwapMs` stayed 0 in this run
(the pieces had not settled). This is a live-loop observation, not a
before/after regression claim.

## 10. Tests and build

```
npx vitest run src/lab/sdf-zombie/gib-tear.test.ts \
  src/lab/sdf-zombie/gib-parts.test.ts src/lab/sdf-zombie/gib-rupture.test.ts \
  src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
# 4 files passed, 269 tests passed

npm run build        # tsc --noEmit && vite build — exit 0, built in 4.35s
```

Additional direct run of the changed file: `gib-tear.test.ts` 12 tests passed
(2 new: seam-ahead-of-push, bone-lag bound).

## 11. Honest summary

- The transition is **better**: the window now opens a readable seam instead of
  inflating, and the release no longer freezes pieces that were already moving.
- The two contract items that remain **unmet** are rib/skeleton exposure and
  budget/tier preview coherence at a tight pool (§7). Both are recorded with
  reproductions; neither is claimed as fixed.
- Owner acceptance is **not** claimed. The videos and sheets are the review
  material; model inspection does not equal the owner's playtest.
- Extracted assets were never committed; the deferred rendering blocker
  (`gMarchAnchor`) is untouched.
