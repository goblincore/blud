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
the owner's `5391` server was never touched. The implementation/evidence commit
for this task is **`af601dc3`** (a following doc-only commit adds that hash to
this file); see §10.

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

Code + evidence commit: `af601dc3` on `codex/body-to-gib-rupture-task-2`
(inherits Task 1 `6898f65f` on `4dcb1ffd`). No merge, no push.

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

---

# Body-to-gib rupture — Task 3 results (rib reveal, material continuity, tier coherence)

Worktree `2026-09-16-body-to-gib-rupture-task-3`, branch
`codex/body-to-gib-rupture-task-3`, from Task 2 `ae524a23` (which sits on Task 1
`6898f65f` on accepted baseline `4dcb1ffd`). Node `v22.22.1`. Owned Vite on
`5403` and headless Chrome on `9403` (`--enable-unsafe-webgpu`, scratch in
`.lab-tmp/`); the owner's `5391` server was never touched. This section
**supersedes** the "unmet" claims in Task 1 §5 and Task 2 §7/§11 for the default
path; the remaining gaps are listed in §7 below.

## 1. What changed

The reviewer's read of `task2-c200-threequarter-sheet.jpg` was confirmed with
native vision before editing: intact smooth flesh splitting only at limb joints
through 200 ms, then an abrupt switch to mottled chunks at 217 ms, no readable
ribcage. Three defects, three fixes.

| # | Defect (Task 2) | Fix | File |
| --- | --- | --- | --- |
| 1 | No ribcage readable: the torso regions translated but the overlapping spine blobs kept the union closed, and the chest/abdomen cut was **below** the ribs. | **Flesh peel.** The chest band lifts along the body's own cranial axis and the abdominal/pelvic bands are driven the other way (`GibPiece.peel` + `TearTuning.chestPeelM`), tearing the smin bridge so the ribcage is left standing in the opening. Measured on the marched field: 85 % of the ribcage band's surface is exposed by 60 ms, 96 % by release. | `gib-parts.ts`, `gib-tear.ts` |
| 2 | Release material pop: the body's goreStrength (`lodCfg.w`) is 0 and a flesh chunk's is 1. | **Material ramp.** `ruptureGore(progress)` drives `lodCfg.w` from exactly 0 through the recoil to exactly 1 at release, so the last window frame already wears the chunk surface. Because the crowd shares one material, the ramp rides a new **per-instance** record field (`REC_GORE`), read by the shader as `max(lodCfg.w, gInstGore)`. | `gib-tear.ts`, `game-actor.ts`, `zombie-gpu.ts`, `crowd-records.ts`, `march.wgsl.ts` |
| 3 | Tight-pool mismatch: a fresh `?maxchunks=12` previewed the 16-region `parts` plan then spawned 9 `clusters+core` pieces. | **Tier at schedule time.** `gibTierPlan` runs the ladder once, against the body's allowance, before `beginTear`; the plan's views are reserved out of `gibBudget()`; `gibActor` is locked to the chosen tier and the release ladder is skipped. | `gib-parts.ts`, `game-main.ts` |

`rupturePosed` is unchanged in shape (originals shifted per region, re-fitted
clusters). An earlier attempt to append the plan's `sub` cut caps to the drawn
body was **reverted**: a cap is a huge sphere tangent to the cut that removes
everything on the far side, which is right per piece but deletes the neighbour
when both share one marched field. The cut-cap residual is therefore the
sub-centimetre overhang the piece set already documents, not a drawn flat face;
see §7.

## 2. Rib reveal — measured, not asserted

Vertical scan of the marched field (`sdBody`), zombie ribcage band y 1.16–1.40,
surface points of the posed body, at `age` into the 200 ms window (blast at the
torso centre):

| age | ribcage-band surface points | exposed (flesh no longer there) |
| --- | --- | --- |
| 60 ms | 192 | 164 (85 %) |
| 120 ms | 192 | 181 (94 %) |
| 200 ms | 192 | 184 (96 %) |

## 3. Native-vision observations (images actually opened)

Every image below was opened with the native image viewer, not read from a
filename. Before/after pairs are Task 2's committed sheets vs this task's.

| Image | What was inspected | Observation |
| --- | --- | --- |
| `captures/task3-front-sheet.jpg` | default crowd path, front, 2.4 m, 16 tiles | f0 the intact posed body; f1–f4 the chest band lifts and a pale **rib ladder** is readable across the thorax; f8–f11 the cage is fully readable while the flesh is stretched around it; f12 the pieces spawn wearing the same mottled surface (no switch). |
| `captures/task3-threequarter-sheet.jpg` | default crowd path, 3/4 view, real VFX | Same seam and cage read off-axis; the head stays a distinct mass; material is continuous across f11 → f12. |
| `captures/task3-gameplay-sheet.jpg` | 5.25 m, real explosion VFX | The pale ribs are visible from f4 onward even under the burst light; body through f11, chunks at f12, continuous mottle. |
| `captures/task3-front-lastwindow.jpg` / `task3-front-release.jpg` | 2.4× torso crop, 200 ms last window frame vs release tick | Pale ribcage in the opening in BOTH; the mottled/chunk surface is already present on the window frame, so the release tick is not a material switch (compare `captures/task2-c200-lastwindow.jpg`, which was smooth pink). |
| `captures/task3-front-onset.jpg` | pre-blast onset | The intact posed body — the silhouette the contract requires at onset, unchanged by the ramp (gore 0). |
| `captures/task3-zero-duration-control-sheet.jpg` | `?gibtear=0` | Already chunks on the first frame — the zero-duration comparison path is preserved. |
| `captures/rupture-task3-front-normal.mp4`, `rupture-task3-gameplay-normal.mp4` | 0.5 s at 60 fps, looped 4× | Normal-speed read: the chest peels, the ribs show, and the pieces continue outward with no dead frame or material blink. |

## 4. Tier coherence — observable behavior

From `captures/task3-tightpool12-telemetry.json` (fresh boot, `?maxchunks=12`,
one body; `pendingPlanPieces`/`pendingTiers` read live from `dynamite()`):

```
f0..f11 : pendingPlanPieces 9   pendingTiers ["clusters+core"]   (the PREVIEW)
f12     : pendingPlanPieces 0   tier clusters+core  spawned 9     (the RELEASE)
```

The preview draws 9 regions and the release spawns 9 of the same shape — the
"preview rich, spawn cheap" mismatch is gone. The full-pool run keeps `parts`
(16 preview / 16 spawned; `task3-front-telemetry.json`). Reservations are held
out of `gibBudget()` until release, so a later blast cannot spend a pending
body's slots; `?maxchunks` and `MAX_CHUNK_BUDGET` are unchanged.

## 5. Lifecycle, second humanoid, severed actor

From `captures/task3-lifecycle.json` (real loop, no `frozen`, `pageErrors: []`):

| Case | Result |
| --- | --- |
| Moving cast | `movingCast: true` |
| Second blast during the window | `pendingMid 1 → pendingAfterSecond 1`, `scheduledBodies 1`, `oneRelease true` — no second breakup, no clock reset |
| Repeated explosions | `live 64 / cap 64`, unique ids, `bounded true` |
| Reset mid-window | mid `tearing 1 / pending 1` → after `0 / 0`, `drained true` |
| Tight multi-body in-session | confounded exactly as Task 2 §8 recorded (the pool already held 64 views, so an in-session `maxchunks:12` does not bind); the fresh-boot test in §4 is the one that binds |

New unit coverage (`gib-parts.test.ts`): the peel flag is on `torso.chest`,
`torso.abdomen` and `torso.pelvis` only and `plan.up` is set; the **soldier**
(second humanoid) plans with the same peel and a headless fallback does not
throw; a **pre-severed** zombie emits no arm pieces in the full plan or the
cluster tier. The explicit fallback for an actor with no rib structure is that
the flesh still peels (the cage is the renderer's problem, not the planner's);
if there is no bone to reveal, the result is torn flesh, not an error.

## 6. Tests and build

```
npx vitest run <26 focused files: gib-tear, gib-parts, gib-rupture, gib-chunks,
  explosion-aoe, sever, sever-bones, humanoid-sever, detached-pose, melt,
  melt-bones, melt-gate, chunk-bake-field, march.wgsl, crowd-records,
  game-actor{,-soldier,-collision,-bounded-wounds,-elbow,-torso-slug},
  baked-chunks, chunk-bake-jobs, gib-sprite-pieces, march-step-soundness,
  dynamite-panel>
# 26 files passed, 602 tests passed (Task 1's set was 596)

npm run build        # tsc --noEmit && vite build — exit 0, built in 5.39s
```

New/updated pins: `ruptureGore` endpoints; the peel term; the cull bound
skips carves; the tier planner (rungs, src indices, reserve, determinism,
soldier, severed); `crowd-records.test.ts` (the `REC_GORE` write);
`march.wgsl.test.ts` (the `max(lodCfg.w, gInstGore)` gate and the instance
load).

## 7. Limits / honest gaps (Task 3)

1. **`?gib=pieces` still previews `parts`.** `gibAllPieces` has no source
   indices yet, so that A/B shape keeps the old preview-then-spawn route and can
   still mismatch. `?gib=clusters` is planned exactly by `gibClusterPieces`, and
   the default (`parts`) is coherent. This is the one mode not fixed.
2. **The cheap tiers do not reveal ribs.** A `clusters*` tier has one piece per
   whole limb, so there is no chest band to peel and no intra-torso cut; those
   tiers translate whole clusters. They agree with their own spawn (the §4 fix),
   but only the default `parts` tier peels. A rib read at every tier would need a
   torso-only subdivision plus a source-indexed plan for the rest.
3. **Cut caps are not drawn in the preview.** The drawn cut is the piece's
   rounded end and the spawned cut is the capped flat face; the difference is
   bounded by the cut overhang (`GIB_CUT.overhangK × blendK`, a few mm), which
   the continuity test already covers (<10 % union residual, measured). A
   per-piece preview (each region as its own marched view) would remove even
   that, but it is a renderer change, not a scheduler one.
4. **The gore ramp is view/record-wide, not cut-local.** It reaches exactly the
   chunk's value at release so the pop is gone, but it does not make cut faces
   more torn than intact skin. A cut-local mask (`-hitField.w`, the
   `gib-carve.ts` approach) would change the accepted chunk skin, which the
   contract says to preserve, so it was not taken.
5. **Performance is not a matched baseline.** The live-loop frames still show
   long p95 frames (cold p95 223 ms, repeated p95 182 ms) with the machine under
   load (~3); as in Task 2 these are **not attributed** and the pre-existing
   startup/first-gib freeze remains a separate, undiagnosed task. The new work
   adds one record vec4 and one `max` per fragment; no measurement claims a
   regression or an improvement.
6. **Owner acceptance is not claimed.** Model inspection is not the owner's
   playtest; the videos and sheets are the review material.
7. Deferred rendering keeps its pre-existing `gMarchAnchor` limitation; extracted
   assets were never committed.

---

# Body-to-gib rupture — Task 4 results (rotation during separation, continuous angular velocity)

Worktree `2026-09-16-body-to-gib-rupture-task-4`, branch
`codex/body-to-gib-rupture-task-4`, from Task 3 `d2bb6be5` (Task 3 `ae524a23` ←
Task 1 `6898f65f` ← accepted baseline `4dcb1ffd`). Node `v22.22.1`. Owned Vite
on `5414` and headless Chrome on `9414` (`--enable-unsafe-webgpu`, scratch in
`.lab-tmp/`); the owner's `5391` server was never touched. `node_modules` was
symlinked from the primary checkout (same lockfile) because the worktree had
none; no source outside the worktree was edited.

**Owner correction this task answers.** Reviewing the Task 3 video, the owner
reported: *"when the zombie begins coming apart all pieces remain upright/
parallel, like an exploded assembly diagram. The pieces should already be
rotated into different angles and have angular velocity."* The screenshot
supplied (`/Users/donny/Desktop/Screenshot 2026-09-16 at 7.56.21 AM.png`; not
present at that path, found as the dispatch attachment uploaded at task
creation and inspected with native vision) is a labelled `f0 ~-17ms … f15
~267ms` sheet: through f11 the flesh peels and the ribs show, then f12/f13/f15
show the pieces **translated apart but all still vertical**. That is the defect
reproduced, and it is what this task removes.

## 1. What changed

Task 3's rib peel, gore ramp and tier coherence are unchanged; this only adds
orientation. `rupturePosed` now rotates each region about its own pivot in
addition to translating it, and that rotation (plus its derivative) rides the
released chunk.

| # | Change | File |
| --- | --- | --- |
| 1 | `TearTuning.spinRadPerSec` / `spinCoherence` / `boneSpin` / `headSpin`; `ruptureSpins()` (per-region axis + rate) and `rotatePrimAbout()` (endpoints, `orient`, `bend`, shell clip); `RuptureFrame` carries `quats`/`angVels`; `rupturePosed` applies rotation about `region.origin` then the offset. | `gib-tear.ts` |
| 2 | `GibPiece.radius` (reach, for the mass/geometry term) and `GibPiece.spinQuat`/`spinAngVel` (the hand-off); `displaceGibPieces(pieces, offsets, quats?, angVels?)` attaches the spin but deliberately does **not** rotate the piece prims. | `gib-parts.ts` |
| 3 | `makeChunk(..., kind, spin?)` takes a pre-release `quat`/`angVel`; the random tumble is still drawn (shared rng stream unchanged) and then overridden. | `gib-chunks.ts` |
| 4 | `spawnChunkPiece` passes the spin into `makeChunk`; `gibActor` reads `g.spinQuat`/`g.spinAngVel` and the sprite path does the same; `spawnScheduledGibs` threads `frame.quats`/`frame.angVels`. `dynamite()` gains `ruptureMaxRad`; `chunkStats().livePieces` gains `quat`/`angVel`. | `game-main.ts` |
| 5 | A doomed body's **wounds ride their rotating region** (a rigid transform applied to the position `woundWorldPos` computes from the *clean* prims — never by re-reading `frame()` on a rotated prim, which would reinterpret the stored offset); `drawnBody()` accessor; the head's face projection composes the head region quaternion and the draw loop reads `headShape(a.drawnBody())`. | `game-actor.ts`, `character-view.ts`, `game-main.ts` |

## 2. The rotation model — why it is coherent, varied and continuous

- **Linear in age, so the derivative is continuous.** A region's displayed
  rotation is `qFromAxisAngle(axis, rate * age)` over the window. That is the
  torque-free motion an impulsive blast torque produces, and it means the last
  pre-release frame is a valid state of *the same rotation* the live chunk
  continues at the same rate. The chunk is handed the displayed quaternion AND
  `axis * rate`; because `stepChunk` integrates the next frame from exactly
  there, there is no orientation reset, no still frame and no second angular
  kick. The random spawn tumble never overwrites it (`makeChunk` still consumes
  the draws, then overrides).
- **Variation that is not synchronous and not noise.** Each axis is a blend
  (`spinCoherence` 0.5) of the blast-coherent `radial × up` cartwheel axis and a
  stable per-region seeded direction (an FNV-1a hash of `part#index`). Each rate
  is `spinRadPerSec × falloff × sqrt(refReach/reach) × seeded(0.6..1.5)`, then
  damped for bones (`boneSpin` 0.5) and the head (`headSpin` 0.3). So the
  variation comes from blast position, region geometry/mass and stable seeded
  asymmetry — pure, no `Math.random`, no whole-body rigid spin and no
  indiscriminate blender. Flesh turns most, the skeleton lags (keeping some of
  its upright read against the ribs), the head least (the face stays legible).
- **One pivot, one transform.** The pivot is the region's own `origin`. That is
  the same centre `spawnChunkPiece` uses as the chunk position and the same
  frame `chunkPoint` rotates about, so the drawn region and the spawned chunk
  are one transform rather than two approximations. The piece prims are handed
  over **translated but not rotated** and the chunk quaternion is applied once
  by the view — the rotation is never baked into the vertices and then applied
  again.
- **What rotates.** `rotatePrimAbout` turns `a`/`b` about the pivot, composes
  `orient` (`q * orient`, for non-spherical scale bases and the rig-oriented
  skull), rotates `bend` (a mid-relative world-vector) and the shell clip
  normal. Uniform capsules/spheres are left `orient`-free so the cheap
  `sdPrim` shader path survives. Cut caps have no source index but ride the
  piece, so they rotate with it. `refitClusters` re-fits every cull/proxy
  bound over the rotated prims (the existing "bound must cover the moved flesh"
  test still passes).

## 3. Telemetry — the rotation is real, and it does not reset

From `captures/task4-t4-clear-telemetry.json` (front, 2.4 m, frozen loop,
`__warmDone`-gated, one fixed step per frame, real sim times). `rot` is the
largest per-REGION angle the body is drawn with; `chunkRot`/`spin` are the
largest released-chunk orientation and angular speed:

| frame | sim | age | maxOffset | body rot | chunk rot | spin |
| --- | --- | --- | --- | --- | --- | --- |
| f0 | 17 ms | 0.017 | 0.139 m | 4.6° | — | — |
| f3 | 67 ms | 0.067 | 0.265 m | 18.3° | — | — |
| f8 | 150 ms | 0.150 | 0.347 m | 41.1° | — | — |
| f11 (last window) | 200 ms | 0.200 | 0.358 m | **54.8°** | — | — |
| f12 (release) | 217 ms | ended | — | — | **59.4°** | **4.63 rad/s** |
| f13 | 233 ms | — | — | — | 63.8° | 4.49 |
| f15 | 267 ms | — | — | — | 72.3° | 4.21 |
| f24 | 417 ms | — | — | — | 104.2° | 3.15 |
| f30 | 517 ms | — | — | — | 120.9° | 2.60 |

The release frame's chunk angle (59.4°) is the body's last drawn angle (54.8°)
plus one 60 Hz step of its own spin (4.63 rad/s × 1/60 = 4.4°): the orientation
is continuous across the hand-off, and the spin then bleeds off only at the
pre-existing `angularAirDamp` rate. Telemetry in
`captures/task4-t4-front-telemetry.json` (real VFX) and
`captures/task4-t4-3q-telemetry.json` show the same numbers; all three runs
exited 0 with `pageErrors: []`.

## 4. Native-vision observations (images actually opened)

Every image below was opened with the native image viewer, not read from a
filename.

| Image | What was inspected | Observation |
| --- | --- | --- |
| `captures/task4-t4-clear-sheet.jpg` | front, clear stand-in VFX, 16 tiles | f0 the intact posed body; f1–f4 the chest band lifts and the pale rib ladder opens; f8–f11 the regions are **already tilted** (chest and abdominal masses lean, arms at different angles) with the ribs readable in the gap; f12 the pieces spawn at those same angles; f13–f15 they continue to rotate. |
| `captures/task4-t4-clear-onset-zoom.jpg` | pre-blast onset, 2.4× | The intact posed silhouette, arms down, head/face intact — the identity-at-onset the tests pin. |
| `captures/task4-t4-clear-f11-zoom.jpg` | last window, 2.4× | The torso regions are visibly rotated apart (not upright/parallel), ribs exposed; this is the frame the owner's screenshot showed stacked vertically. |
| `captures/task4-t4-clear-f12-zoom.jpg` | release tick, 2.4× | The spawned chunks are in the SAME configuration as f11 — same tilt, same ribcage, no snap back to upright and no material blink. |
| `captures/task4-t4-clear-f13-zoom.jpg` / `-f15-zoom.jpg` | first flight / later flight, 2.4× | The pieces keep turning: by f15 a limb is near-horizontal and the chest mass is well off its birth angle. Clearly different from the owner's "exploded assembly diagram". |
| `captures/task4-t4-front-sheet.jpg` | front, **real explosion VFX**, 16 tiles | Same read with the real fireball; the body/rotation is visible before the flash dominates, and the chunks scatter. |
| `captures/task4-t4-3q-sheet.jpg` + `task4-3q-f15-zoom.jpg` | three-quarter, real VFX | Same separation and varied angles off-axis; the arm/leg pieces tumble at different angles, not in one plane. |
| `captures/task4-procedural-sheet.jpg` + `task4-proc-f11-zoom.jpg` | `?skeleton=procedural` diagnostic | The marched bone prims (ribcage/spine) are in the opening gap and rotate with their regions at the damped bone rate — the diagnostic view where the skeleton itself is part of the ruptured body. |
| `captures/task4-clear-normal.mp4`, `task4-front-vfx-normal.mp4`, `task4-threequarter-normal.mp4` | 0.5 s at 60 fps, looped 4× | Normal-speed read: the body rotates apart, the pieces continue turning through release with no dead frame or orientation reset. |

Task 3's accepted improvements were rechecked in the same frames: the pale
ribcage is readable from f1, and the last-window frame already wears the
mottled chunk surface, so f12 is not a material switch.

## 5. Tests and build

```
npx vitest run <27 focused files: gib-tear, gib-parts, gib-rupture, gib-chunks,
  explosion-aoe, sever, sever-bones, humanoid-sever, detached-pose, melt,
  melt-bones, melt-gate, chunk-bake-field, march.wgsl, crowd-records,
  game-actor{,-soldier,-collision,-bounded-wounds,-elbow,-torso-slug},
  baked-chunks, chunk-bake-jobs, gib-carve, gib-sprite-pieces,
  march-step-soundness, dynamite-panel>
# 27 files passed, 621 tests passed, 0 failed   (Task 3: 602)

npm run build        # tsc --noEmit && vite build — exit 0, built in 3.25s
```

New/updated pins (behavior, not formula mirrors):

- `gib-tear.test.ts` (23, +9) — identity at onset; nonzero pose across the body
  by release; **varied** axes (mean pairwise |dot| < 0.95) and rates; flesh >
  skeleton > head; zero-falloff identity and finite degenerate blast bounded by
  the peak rate; rigid + deterministic evolution; tight-budget `clusters` plan
  (cluster-centre pivots); a pre-severed limb; `rotatePrimAbout` turning
  endpoints, composing `orient`, rotating `bend`/shell clip, and leaving a
  uniform sphere `orient`-free.
- `gib-rupture.test.ts` (7, rewritten/added) — the drawn body is the plan's
  regions rotated about their origin then translated; the chunk convention
  (`origin+offset` + quat) reproduces the rupture transform exactly; the union
  of the ROTATED pieces still covers the drawn body (< 10 % residual); cut caps
  stay rigidly welded (offset to the piece's flesh preserved) and skull prims
  compose the head region spin.
- `gib-chunks.test.ts` (21, +1) — `makeChunk` takes the pre-release quat/angVel
  over the random tumble while still consuming the rng draws.

## 6. Limits / honest gaps (Task 4)

1. **The default `?skeleton=mesh` segment-mesh skeleton is not region-rotated.**
   In the forward default the skeleton is a separate rig-driven object
   (`createSkeletonSources(actor.body, actor.boundRig())` in `game-main.ts`), so
   while the flesh and bone PRIMS rotate, that mesh keeps the posed body's
   orientation through the window. The `?skeleton=procedural` path (marched
   bone prims, captured) and every released chunk DO rotate. Threading
   per-region transforms into the segment-mesh pose is a renderer change, not a
   scheduler one, and was not taken in this task's budget. This is the one
   sub-criterion of the rotation request not fully met.
2. **Linear-velocity continuity is the blast launch, not the window's tail.**
   The chunk is spawned with the blast `concussionVelocity` on the release tick
   (Task 2's `delay = 0`), so there is no zero-velocity hold; the displayed
   separation's own decelerating translation is not what carries into flight.
   This matches the original contract ("apply release velocity once") but is a
   deliberate discontinuity in the linear derivative the task text's "preserve
   linear velocity" could be read to forbid. Orientation and angular derivative
   ARE continuous.
3. **Sprite and carve renderers.** The sprite path now receives the pre-release
   quat/angVel but its own piece view was not visually reviewed; the carve path
   is a separate whole-body library and was not exercised here. The default
   marched path is the reviewed one.
4. **`?gib=pieces` still previews-then-spawns** (Task 3 §7.1) and therefore
   does not carry the plan's spin; the default `parts` and `clusters` tiers do.
5. **No performance claim.** All captures are frozen, stepped loops; frame
   times were not sampled on the live loop, and the pre-existing
   startup/first-gib freeze remains a separate undiagnosed task. The added work
   is one quaternion/region in the tear and one quat+angVel on the chunk — not
   measured.
6. **Owner acceptance is not claimed.** Model inspection is not the owner's
   playtest; the videos and sheets are the review material.

## 7. Artifacts

All under `docs/dev-notes/2026-09-16-body-to-gib-rupture/captures/`:

- Sheets: `task4-t4-clear-sheet.jpg` (clear front), `task4-t4-front-sheet.jpg`
  (real VFX front), `task4-t4-3q-sheet.jpg` (real VFX three-quarter),
  `task4-procedural-sheet.jpg`.
- Zoom key frames: `task4-t4-clear-{onset,f03,f08,f11,f12,f13,f15,f18,f30}-zoom.jpg`,
  `task4-3q-f{12,15}-zoom.jpg`, `task4-proc-f{11,12,15}-zoom.jpg`.
- Normal-speed videos: `task4-clear-normal.mp4`, `task4-front-vfx-normal.mp4`,
  `task4-threequarter-normal.mp4`.
- Telemetry: `task4-t4-{clear,front,3q,proc}-telemetry.json` (per-frame
  `tearAge`/`simMs`/`ruptureMaxM`/`ruptureMaxRad`/`chunkMaxRad`/`chunkMaxAngVel`,
  tier, parts, page-error-free).
- Reproduction: the Task 3 §4 commands, on `5414`/`9414`, e.g.
  `RUP_VIEW=front RUP_DIST=2.4 RUP_FRAMES=30 RUP_SEED=7 node
  scripts/sdf-gib-rupture.mjs 5414 9414 /tmp/t4-clear "&gibtear=0.2" t4-clear`.
