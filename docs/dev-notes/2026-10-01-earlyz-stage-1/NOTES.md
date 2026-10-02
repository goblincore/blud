# Early-Z stage 1 — results of record (2026-10-01)

Plan: `docs/superpowers/plans/2026-10-01-sdf-march-early-z-stage-1.md` · Spec: `docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md`

## Baselines (before Task 1)

Recorded at base commit `c484305c` (clean tree, branch `claude/sdf-rendering-dream-techniques-f29768`), no stage-1 code yet.

- `npm test -- march-golden crowd-type game-context`: 5 files, 49 tests — **48 passed, 1 failed (pre-existing)**.
  - `march-golden.test.ts` 2/2 pass
  - `crowd-type.test.ts` 11/11 pass
  - `game-context.test.ts` 3/3 pass
  - `scripts/game-context-codemod.test.ts` 29/29 pass
  - `scripts/game-context-coverage.test.ts` 3/4 pass. **Pre-existing failure, not caused by this plan:**
    `binding maps > leaves ctx as the only state binding in main()` expects `['ctx']` and gets
    `['ctx', 'actorFill', 'fleshSpawnRng']`. Both bindings are already in committed `game-main.ts`
    (`const actorFill = new WeakMap(...)` ~L2627, `const fleshSpawnRng = mulberry32(...)` ~L5408). Later tasks
    must hold this at exactly this one failure with exactly these two extra names, and must not add a third.
- `node scripts/march-hash.mjs` (default mode, run inside `lab-servers`, load average 2.9 at start): **PASS**, exit 0, first run.
  The script prints no PASS word. It calls `fail()` and exits non-zero on any mismatch, so exit 0 with `room1`
  equal to the pinned `DEFAULT_HASH` is the pass.

  ```
  {"room1":"d7392d5234c98ddc1babb3b29860abc3a02ced84","room1-repeat":"d7392d5234c98ddc1babb3b29860abc3a02ced84","room1-wounded":"76bd51aa6eb281297999463529a0b782ce2b67f6"}
  ```

## Smoke (Task 11)

`scripts/earlyz-run.sh smoke` (`LAB_TMP=.lab-tmp`, headless Chrome on the owner's Mac, Metal). Two boots on one tab, the
pack staged in each (`STAGES.pack`: 6 zombies 0.7 m apart, mean 3.46 m ahead, from the ring's room-1 near corner):

- **off first** (`?frozen=1`): the shipped boot. It also records the GPU baseline that the flag-on boot is held to.
- **then on** (`?frozen=1&earlyz=1`): the plan's checks, the same GPU baseline, then `STAGES.melee` on the same page.
  A melee staging failure is recorded as a failed `melee staged` check, and the flag-on checks still report.

A second CDP client on the tab collects the console (`$LAB_TMP/earlyz-smoke-<phase>.console.log`). The run is bounded:
a 45-minute watchdog, `fail()` waits at most 10 s for its diagnostic read, and `connectGame`'s `send` now rejects at
once on a closed socket (it used to hang forever). `--on` / `--off` runs one phase.

**Result of record (second review follow-up, `uptime` load 2.51 3.58 3.93 at start): every check PASS, exit 0.**
No game-code fix was needed. The pack is crowd type `zombie@1`: spawnDebugCharacter files a body under the PLAYER's room, and
the ring's room 1 has no zombie of its own.

```
gpu baseline: 0 uncaptured GPU errors with the flag off
PASS  [off] flag off
PASS  [off] earlyz not on
PASS  [off] the pack is visible (zombie@1 visible >= 6)
PASS  [off] no front batch (every type front === 0)
PASS  [off] no seed built
PASS  [off] patch never emitted
PASS  [off] GPU device not lost
PASS  [off] no page exceptions (0)
PASS  [on] flag on
PASS  [on] patched + detected
PASS  [on] patch emitted frag_depth greater
PASS  [on] seed drew
PASS  [on] the pack drew as front batches (zombie@1 front === 6, back === 0)
PASS  [on] the pack is visible (zombie@1 visible >= 6)
PASS  [on] no uncaptured GPU errors (earlyz listener)
PASS  [on] GPU device not lost
PASS  [on] uncaptured GPU error count 0 <= flag-off baseline 0
PASS  [on] melee staged
PASS  [on] melee: camera inside the near body's proxy box + 0.25 m guard (margins [1.129,0.775,0.366])
PASS  [on] melee: the near body's type (soldier@1) moved front -> back (front 1 -> 0, back 0 -> 1)
PASS  [on] melee: no new GPU errors, device not lost
PASS  [on] no page exceptions (0)
```

Flag on, pack staged:

```
earlyzInfo {"flag":true,"on":true,"reason":null,"gpuErrors":[],"patchHits":20,"seed":{"built":true,"on":true,"reason":null},"batches":{"soldier@1":{"front":1,"back":0},"zombie@2":{"front":2,"back":0},"zombie@3":{"front":0,"back":0},"zombie@4":{"front":1,"back":0},"juggernaut@6":{"front":0,"back":0},"warbull@6":{"front":0,"back":0},"zombie@6":{"front":0,"back":0},"soldier@5":{"front":0,"back":0},"zombie@5":{"front":0,"back":0},"zombie@1":{"front":6,"back":0}}}
gpuDiagnostics {"lost":null,"uncaptured":[],"uncapturedCount":0}
```

Flag off, pack staged: `{"flag":false,"on":false,"reason":null,"gpuErrors":[],"patchHits":0,"seed":{"built":false,"on":false,"reason":"not requested"},...}`,
every type `{"front":0,"back":0}`, `gpuDiagnostics` `{"lost":null,"uncaptured":[],"uncapturedCount":0}`.

**Melee (camera-inside fallback).** `STAGES.melee` stages room 1's first body, which on the ring is the soldier (body 1,
type `soldier@1`, at `[-4.8, 0, -4.8]`). The ladder asks for 0.4 m. After `step` the camera stood at `[-4.8, 0, -4.13]`,
which is 0.67 m away on the floor, pitch -1.0 rad: the player collision resolved the overlap. Coverage was 0.336.
- The proxy box the split tests has centre `[-4.8, 1.08, -4.8]` and half `[0.879, 1.065, 0.786]`. The centre is the view
  object's position and the half is the view's `bodyHalf`.
- The camera sat at `[-4.8, 1.62, -4.13]`. Inside margins (half + 0.25 - |camera - centre| per axis) were
  **`[1.129, 0.775, 0.366]` m**, all positive.
- `soldier@1` moved from `{front 1, back 0}` (pack) to **`{front 0, back 1}`**.
The pack behind the camera stayed `zombie@1 {front 6, back 0}`. `patchHits` stayed 20, `gpuErrors` stayed `[]`, and
`uncapturedCount` stayed 0.

- **crowdInfo** (both phases identical): crowd on, `boxes` dispatch, tiles on, no fallback. Visible types:
  `zombie@1` 6/6 at mean 3.46 m (the pack), `soldier@1` 1 at 4.84 m, `zombie@2` 2 at 12.65 m, `zombie@4` 1 at
  13.93 m. Camera `[-8.2, 0, -8.2]`, yaw 3π/4. Every drawn body landed in `front`: the camera is outside every
  proxy box, as the pack scene intends.
- `patchHits` 20 counts `getFragDepth` calls answered with `frag_depth, greater` (calls, not shaders).
- **Console.** The flag-on boot logs `[earlyz] on: front-face crowd proxies + frag_depth greater + level-depth seed`
  and no `[earlyz]` warning. There were zero page exceptions in either phase. Every other warning is in BOTH phases,
  so none is the flag's:
  - the `flaregun-placeholder.glb` fallback (a dev placeholder absent in this worktree; its network 404 is logged
    only on the tab's first boot)
  - Dawn's `Draw with an index count of 0 is unusual`
  - three's `Unable to serialize Texture`, 44x with the flag on and 26x off. The extra 18 under the flag were not traced.
- **An informal look, not the parity gate** (first version of the smoke). One pair of screenshots of the pack, flag on
  vs off, `?seed=7&loader=0`, 30 frames. Both show the same six bodies and the soldier behind them, with nothing missing
  or clipped. Viewport crop: mean abs diff 1.5 / 255, 0.8 % of pixels differ by more than 15, mean luminance 52.69 vs
  52.47. These are two separate boots with only the seed pinned, so this is not a parity number; `earlyz-parity.mjs`
  is the measurement.

**Timings.** The table counts from navigate to the loader gate being ready plus the background crowd job finishing.
"crowd job" is when that job finished (`warmDone.phases.backgroundDone.crowd`).

| Run | phases | `uptime` load at start | off: ready / crowd job | on: ready / crowd job |
| --- | --- | --- | --- | --- |
| 1 | on, off | 2.36 2.97 3.20 | 5.0 s / 3.3 s | **27.6 s / 25.5 s** (cold) |
| 2 | on, off | 2.63 2.96 3.19 | 4.5 s / 3.3 s | 5.9 s / 4.1 s |
| 3 | off, on | 7.33 3.77 3.53 | 5.4 s / 3.6 s | **27.0 s / 25.6 s** (cold) |
| 4 | on | 9.77 5.81 4.36 | — | 6.5 s / 4.6 s |
| 5 | on | 8.97 5.77 4.36 | — | 5.9 s / 4.3 s |
| 6 | off, on | 4.41 5.09 4.23 | 5.5 s / 3.6 s | 6.0 s / 4.5 s |
| 7 (of record) | off, on | 2.51 3.58 3.93 | **47.8 s / 46.0 s** (cold) | **36.1 s / 34.0 s** (cold) |

- **The cold compile.** The front-face crowd program's cold compile is **~22-30 s, paid in the background crowd job after
  `ready`**, not behind the loader. `drawOnce` stays 1.6-2.3 s in every boot, flag on or off.
- **Cold runs.** Run 3 came 22 minutes after the warm run 2, with no source change, and its front program was cold
  again. Runs 4-6 were warm straight after it, in both phase orders, so the order is not the cause.
- **Run 7 went cold for the shipped crowd program as well** (off-phase crowd job 46 s, layer precompile 3.3 s instead
  of ~0.1 s). So the shader cache loses entries between runs for both programs, not only the flag's. That is
  consistent with machine-level cache churn (other sessions share the machine) rather than something the flag does.
  Cause not traced further.
- **Not the boot-time gate.** These are smoke observations, not the gate against the base branch.

**Scene preludes, checked once outside the smoke.** This was a scratch run, flag on.
- `doorway` (ring): `tunnel-1-2`, player `[-3.3, -3.6]` in `room1`, aimed at the mouth `[-0.8, -4.8]`, 12 spawned.
  Batches: `zombie@1 {front 9}`, so 9 of the 12 far-room bodies were drawn.
- `far` (ring): 16 spawned, `zombie@1 {front 16}`.
- `pack` on `level=night-train`: refused by the ring-only guard, as intended.
- `train-doorway`: `tunnel-1-2`, player `[1.2, -13.5]` in `guards-van`, mouth `[0, -16]`, 12 spawned. Batches:
  `zombie@1 {front 4, back 1}`.
  - The `back 1` is the level's own zombie `van-guard`, at `(0.6, 0, -13.8)` in `night-train.level.json`, 0.67 m from
    the camera.
  - It is kept deliberately as a realistic close-body case for parity and the bench.
- No GPU errors in any of these.

## Parity and look (Task 12)

`LAB_TMP=.lab-tmp scripts/earlyz-run.sh parity` (`scripts/earlyz-parity.mjs`; headless Chrome 154.0.8037.93, Metal,
warm shader cache). The run of record was taken after the code review of 93592141, at `uptime` load
**2.06 1.65 1.76**, 2026-10-02. Per scene, four fresh boots on one tab, staged the same way
(`scripts/lib/earlyz-scenes.mjs`): `off`, `on` (`&earlyz=1`), `off2`, `on2`. The diff counts pixels whose max RGB
difference is > 8 (the plan's `DIFF_LEVEL`). Pixels that differ between two boots with the same flag (off vs off2, or
on vs on2) are boot noise: they are masked out of the diff and counted separately (cyan in the sheets). Output:
[`look/`](look/).

**Result: the plan's gate FAILS on `pack` (1071 px) and `far` (1118 px) against 1024 px. `melee` passes (152 px).**
Every other check passes (107 of 109). The extra pixels are the seed's upscaler fringe at polygon occlusion edges the
plan did not expect in the gated scenes: the shotgun in hand, the ring's door jambs, feet in the floor, and the mesh
skeleton's polygon eyes. The gate was not loosened. Whether to accept this look is the owner's call (see "Owner's
call" below).

### What the script does beyond the plan's sketch

- **Determinism pins, the same in every boot** (the `march-hash.mjs` recipe):
  - the rAF loop stopped, the dynamic-light clock frozen at 0, `setDemoHold(true)`, probe blend and fall 1, ship
    defaults;
  - the HUD text line hidden (it prints the frame-time EMA);
  - 180 settle frames, not 6: at 30, `melee` also differed on a highlight on the shotgun, because post-aa's temporal
    history had not converged;
  - the screenshot is taken only once two consecutive shots 250 ms apart are byte-identical.
- **Night Train.** Its own clocks are not pinned by the recipe above. Without fixes, `off` vs `off2` differed on
  **2.6 %** of the pixels: every level edge moved with the camera roll, and the flail's chain and ball moved too.
  - `setTrainSpeed(0)`, as `sdf-game-light-gate.mjs` does. At speed 0, roll, bob, lamp swing and curtain sway are
    exactly 0. That brought it down to 1.4 %, almost all of it the flail ball.
  - The flail's idle sway runs on a private clock (`game-flail.ts` `clock`) that no seam exposes. The train clock
    advances in the same tick with the same dt, so the script steps every boot to the next whole period of the sway
    pattern (100/9 s). That brought it down to **0.01-0.02 %**.
- **Why, not only how much.** Each boot also reads the exact march target (`readMarchTarget`, after the screenshot; a
  probe showed the screenshot is unchanged by that read).
  - off vs on, texel by texel: `seededOut` (hit -> miss), `changedHit`, `changedHitBig` (rgb moved > 0.03), `newHit`.
    `newHit` is a check and must be 0.
  - The seeded-out texels are grouped into 8-connected **components** (size, bbox in march texels, interior count),
    reported in `parity.json`. An **interior** texel is seeded with all 8 of its neighbours seeded.
  - **Check: no diff pixel may map to an interior texel.** If the seed had removed visible flesh, the pixels over the
    inside of that region would change. Components too thin to have an interior are not covered by this check; they
    are listed below and were looked at.
  - Each diff pixel is mapped back to its march texel through the canvas rect AND the fisheye lens
    (`fisheye.ts` `warpUv`). Without the lens the mapping is off by tens of pixels toward the edges.
  - Each diff pixel is then classified as **seed fringe** (counted within 6 and within 24 screen px of a seeded-out
    texel), **march change**, or **unexplained**. This split is a report, not a gate. 24 px is the t16 upscaler's
    reach of 6.5 texels, through the 1.33x canvas scale and the lens.
- **Output and the copy rule.**
  - A run writes everything to `$LAB_TMP/earlyz-parity/` (the work directory).
  - Per scene:
    - `<scene>-off-on-diff-half.png`: off | on | diff at half size, with a text strip giving the pixel count, max
      diff, masked noise and fringe counts. The images are box-averaged; the diff panel is max-pooled, so a 1 px
      fringe survives.
    - `<scene>-zoom.png`: a 320 x 200 window round the densest red, 3x nearest-neighbour.
    - `<scene>-seed-overlay-half.png`: the off frame with seeded-out texels tinted blue, and the diff coloured by
      cause: red = seed fringe, yellow = march change, magenta = unexplained, cyan = masked noise.
    - plus `parity.json`.
  - `raw/` holds the full-size sheets, the captures, the march floats and the logs.
  - Only a **complete run of record** copies the sheets, zooms, overlays and `parity.json` into `look/`. That means all
    five scenes in order, no `EARLYZ_EXTRA_QUERY`, the default settle, the `on2` boots on, and a run that reached the
    end. Every failed check must be one of the plan's parity gate checks; pack and far failing the gate is the result
    the owner has to see, so it does not block the copy.
  - Subset, A/B and aborted runs never touch `look/`. The copy removes the old committed files first.
  - `EARLYZ_EXTRA_QUERY` appends a query to every boot, for A/B diagnostics (used below with `skeleton=procedural`).

### Numbers of record

Noise floor: `pack` off vs off2 **0 px** (max diff 1), so the gate is max(2 x 0, 0.1 % of 1280 x 800) = **1024 px**.
Within each scene, two boots with the same flag gave a **bit-identical march target** (all 120000 texels, both flag
states).

| scene | diff px (masked noise) | % | max | noise off/off2, on/on2 | seed | batches (types drawn) | march seededOut / changedHit / big / newHit | seeded components (largest sizes) | fringe <=6 / <=24 px | march change / unexplained | diff in seeded interior | gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pack | **1071** (0) | 0.105 | 115 | 0, 0 | on, reason null | zombie@1 6F, soldier@1 1F, zombie@2 1F, zombie@4 1F | 5897 / 15097 / 4 / 0 | 5 (5216, 495, 164, 20, 2) | 923 / 1010 | 30 / 31 | **0** | **FAIL** |
| doorway | 1168 (0) | 0.114 | 84 | 0, 0 | on, reason null | zombie@1 9F, zombie@2 2F | 2527 / 2641 / 4 / 0 | 7 (1546, 945, 26, 4, 3, 2, 1) | 1023 / 1145 | 23 / 0 | **0** | reported |
| train-doorway | 1221 (27) | 0.119 | 85 | 126 (max 28), 157 (max 22) | on, reason null | zombie@1 2F 1B, zombie@2 1F | 899 / 1032 / 0 / 0 | 5 (659, 158, 51, 25, 6) | 1063 / 1153 | 0 / 68 | **0** | reported |
| melee | 152 (0) | 0.015 | 60 | 0, 0 | on, reason null | soldier@1 **1B** | 163 / 163 / 0 / 0 | 1 (163) | 152 / 152 | 0 / 0 | **0** | PASS |
| far | **1118** (0) | 0.109 | 103 | 0, 0 | on, reason null | zombie@1 16F, soldier@1 1F, zombie@2 1F, zombie@4 1F | 1077 / 11933 / 9 / 0 | 11 (897, 162, 3, 3, 3, 2, 2, 2, 1, 1, 1) | 875 / 926 | 164 / 28 | **0** | **FAIL** |

(F = front batch, B = back batch.)

- `patchHits` was 18-24 and `gpuErrors` was 0 in every flag-on boot.
- Ready times were warm: 4.4-5.5 s on the ring and 7.5-9.1 s on the Night Train.
- In both doorway scenes the seed drew, with `seed.reason` null.
- `melee`: the near body's type `soldier@1` is in the back batch (`{front 0, back 1}`), as the plan expects.
- **`melee` passes for a scene-specific reason.** The camera looks down at the floor, so the shotgun overlaps the body
  only where its muzzle crosses one foot: a single component of 163 texels. It is not evidence that a gated scene with
  the gun across a body would pass.

**What the seed took (the components, bbox in march texels of 400 x 300):**
- **pack:**
  - 5216 [166-245, 189-299]: the shotgun over the pack.
  - 495 [134-162, 247-278]: the hand and sleeve.
  - 164 [292-304, 152-183]: a body in the next room behind the right doorway jamb.
  - 20 [250-252, 239-247]: a thin strip at the gun's right barrel edge.
  - 2 [79-80, 191]: the small figure in the left doorway.
- **doorway:**
  - 1546 [301-327, 143-229] and 945 [281-298, 144-218]: far-room bodies behind the tunnel's right jamb (invisible in
    both frames).
  - 26 [260-261, 177-196]: a gap between two bodies in the column, where level geometry is in front of a farther body.
  - 4 [248-251, 207] and 1 [244, 214]: at the column's feet, on the floor.
  - **3 [252-253, 148-149] and 2 [244, 148-149]: the eyes (see the next section).**
- **train-doorway:**
  - 659 [262-284, 146-189]: a body behind the right-hand door frame (invisible in both frames).
  - 158, 51 and 25 [205-219, 184-217], and 6 [198-203, 183]: the chair-back slats in front of the visible body.
- **melee:** 163 [208-227, 189-201]: the muzzle over the soldier's foot.
- **far:**
  - 897 [188-222, 189-237]: the shotgun.
  - 162 [293-304, 152-183]: the body behind the right jamb.
  - Nine 1-3-texel components at y 213-238: feet sinking into the floor.

Per scene (pack / doorway / train-doorway / melee / far), 5092 / 2044 / 581 / 95 / 779 seeded texels are interior,
and **no diff pixel falls on any of them in any scene**. The thin components (doorway's eyes, gap and specks; far's feet; pack's 2- and 20-texel ones)
have no interior, so that check does not cover them. I mapped each one's centre to the screen through the lens and
looked at it in the overlays and zooms.

### The doorway "eye blobs": the mesh skeleton's polygon eyes

The two thin components in the middle of the nearest heads ([252-253, 148-149] and [244, 148-149], every neighbour a
hit) are behind the **polygon eyes of the mesh skeleton**.
- **The code path.**
  - Forward mode's default skeleton is the extracted mesh skeleton (`resolveSkeletonMode` -> `'mesh'`;
    `skeleton-spike/mesh-renderer.ts`).
  - Its seated eyes are instanced `SphereGeometry` with `depthWrite` on, on `FIELD_MESH_LAYER`.
  - The bone-exposure cull keeps the eye-carrying segment for every body, wounded or not (`segmentNeeded`: `hasEyes`),
    because by design the eyes show through intact flesh.
  - `sdf-layer.ts` pass 1 renders `FIELD_MESH_LAYER` into post-aa's capture. That capture's depth is the seed's source
    (spec D6), so wherever an eyeball covers a whole march texel, the seed removes the flesh texel behind it.
- **The A/B.** `EARLYZ_SCENES=doorway EARLYZ_EXTRA_QUERY=skeleton=procedural` (procedural bones in the field; no mesh
  eyes), same staging.
  - The seeded components are identical except that **exactly those two head components are gone**: 5 components
    (1546, 945, 26, 4, 1) instead of 7.
  - The diff falls from 1168 to **979 px**, and the face blobs are gone: 197 diff px in a 120 x 50 crop round the heads
    with the mesh skeleton, 11 with the procedural one.
  - In the mesh-skeleton frames each near head shows a light, sclera-like patch beside the glowing pupil, in both off
    and on. It is absent with the procedural skeleton, where the glow is painted in the march.
- **So this is the seed fringe again, at the eyeball's edge, on a visible face.** No interior to check, but every
  neighbour is flesh. The composite shows the eyeball there in both frames, and the diff (max 49, ~8 x 8 px) is the
  upscaler around it. It is a design consequence of D6, not a seed bug. It is the case most likely to matter for the
  look, because it is on faces at conversation distance.

### Why pack and far fail

- **The shotgun is in the seed.** Spec D6 takes the seed from post-aa's `sceneTarget.depthTexture`. That is the
  polygonal pass's depth, and it includes the first-person weapon and hand (and the mesh skeleton's eyes, above).
  - Wherever the gun covers a body over a whole march texel, the seed removes the texel (the 5216 / 897 / 163
    components).
  - The composite shows the gun there in both frames. But the upscaler (t16, plus the reconstruction that borrows a
    neighbour texel where its own texel is a miss) used to see hidden flesh under the gun and now sees `miss`. So the
    flesh along the gun's outline changes.
  - 79-98 % of the fringe pixels are within 4 screen px of a seeded texel; the tail reaches 24 px along silhouettes.
- The ring's room 1 also shows bodies in rooms 2 and 4 behind door jambs, and feet that sink into the floor.
- **A second, smaller source: the front-face path itself.**
  - With front batches, every hit texel moves at float level: rgb within 1e-3 for 99 % of texels, depth within 1e-6.
  - A handful of grazing silhouette texels hit a different surface (`changedHitBig`: 4 in `pack`, 4 in `doorway`, 9 in
    `far`, 0 in `melee` and the train). In `far` one crevice texel goes from dark red to a bright rim.
  - That is the "march change" column: 23-164 px.
  - `far` without it would be 954 px. That is under the gate, but only because it is shared with the gun fringe.

### What the checks show, and what they do not

- No march texel went miss -> hit, in any scene: the flag added no content.
- No diff pixel lies on an interior seeded texel, in any scene. Wherever the seed removed a block of texels, the image
  over its inside is unchanged, so no visible body was culled there.
- Thin components (1-2 texels across) are not covered by that check. Here they are the eyes, the doorway gap, specks,
  feet and a strip at the gun's edge, and looking at them shows only fringe.
- There is no vertically mirrored band: the overlays line up with the geometry through the lens, so the seed's uv
  origin is right.
- Two boots with the same flag give a bit-identical march target, flag on or off.
- **Unexplained, 0-31 px on the ring: mechanism unknown.** These are isolated pixels on body silhouettes.
  - Example: `pack` at (476, 433). The nearest seeded texel is **45 texels** away. The march target there differs
    between off and on only at float level (1.5e-5 at the texel itself, at most 2.4e-3 within 5 texels: the front-face
    path's change on every hit).
  - Candidates, none tested:
    - those float-level changes amplified by the t16 network or CAS at a high-contrast silhouette;
    - a later pass that depends on depth content, which changes with the flag on. Post-aa's depth readers are the fire
      volume, the flame tongues and SSCS; none should be active here (no fire; SSCS ships off), so this is unlikely;
    - FXAA's along-edge search.
  - Until one is shown, these pixels are an open question, not fringe.
  - The train's 68 unexplained px sit in the region where its own boots differ (posts in the dark carriage); 27 more
    were masked as noise.

### What I saw in each sheet

Every sheet now carries its numbers in a strip along the top.

- **pack.** Off and on look identical at half size, and also in the 3x zoom.
  - Red: a thin 1-3 px line tracing the shotgun's barrels and the hand/sleeve where they overlap the pack's legs and
    backs, plus the bead sight.
  - A short run on the right-most zombie's right arm, next to the right doorway jamb (the 164-texel body behind it).
  - Two dots on the small figure in the left doorway.
  - No red on the open parts of the bodies, the floor or the walls.
- **doorway.** Red along the tunnel's right jamb, which hides the far-room bodies (fully blue in the overlay, invisible
  in both frames).
  - A 2-3 px vertical line in the gap between two bodies in the column (the 26-texel component): level geometry is in
    front of a farther body there. The edge's light rim moves by ~1 px (red channel along y=540, x=842-845: off
    99 80 80 22, on 91 21 21 20).
  - Blobs at the two nearest heads' eyes: the mesh eyes, above.
  - The open doorway, the tunnel and the rest of the bodies have no red.
- **train-doorway.** Through the guards-van door, a body stands behind a slatted chair back. Red follows the edges of
  the chair slats across the body's legs, and the post beside them.
  - The body behind the right-hand door frame is fully seeded and invisible in both frames.
  - The `van-guard` at bottom left (0.67 m, back batch) has no red.
  - A few cyan (masked noise) dots on the flail ball, and magenta dots in the dark carriage.
- **melee.** The camera looks down at the soldier's legs. The only red is a thin arc where the shotgun's muzzle crosses
  the right foot (152 px). The body above it is clean.
- **far.** Red along the shotgun's top and left edges where it covers the front rows, and a few pixels at feet on the
  floor. Yellow march-change blobs on a few heads and shoulders in the crowd (grazing hits).
  - A blue strip behind the right-hand doorway jamb, with no visible red there.
  - The 16 bodies' open surfaces have no red.

### Owner's call (not decided here)

1. **Accept the fringe.** Treat the pixel count as a report, and gate instead on the evidence above: no miss -> hit,
   no diff in a seeded interior (0 in every scene), the seeded components accounted for by occluding polygons. The
   unexplained pixels are not part of that gate and should be explained first.
2. **Keep non-level polygons out of the seed's depth**: the viewmodel, and the mesh skeleton's eyes. That would remove
   the gun fringe in every scene and the face blobs, at the cost of no early-Z under the gun or behind an eye.
3. **Leave it as is:** the plan's gate stays red on `pack` and `far` until 1 or 2 is chosen.

The face blobs (doorway, the mesh eyes) are the case most worth a look at full size: `look/doorway-zoom.png` and
`look/doorway-seed-overlay-half.png`.
