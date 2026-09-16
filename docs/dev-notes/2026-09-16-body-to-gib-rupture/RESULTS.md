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
