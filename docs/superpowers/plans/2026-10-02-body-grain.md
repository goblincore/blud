# Body Grain Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-character palette setting, `grain`, that gives the body the face sheet's hard-edged speckle in two octaves
of one grain. Fine cells (3.5 mm, face-sized) show up close. Coarse cells (1.2 cm) take over as the fine ones shrink
below about 1.5 pixels. Every cell is an albedo multiply plus a normal tilt, cut in rest space. The goblin sets
`grain 0.10`, as its face sheet does.

**Spec:** `docs/superpowers/specs/2026-10-02-body-grain-design.md` — read it first (the "Two scales" bullet is the
owner's decision of 2026-10-02).

**Architecture:**
- The constants and arithmetic live in a pure module, `src/lab/sdf-zombie/body-grain.ts`, with its own tests.
- A hand-written post-hit WGSL block, `webgpu/march/body/blocks/post/body-grain.wgsl.ts`, names the same constants in
  its text; a test pins that the two agree.
- It is spliced into `MARCH_TRACE_POST` right after the face layer, so `marchBody`, `refineBody` and the deferred
  `marchSurface` all run it.
- The face layer leaves one new value for it, `faceSheetCover`.
- The palette value reaches the GPU with no new shader parameter. `applyMaterial` writes it into the spare lane
  `meltCfg.w`, the per-instance record copies that lane, and the shader reads it as `gInstMelt.w`.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest,
headless-Chrome capture scripts (`scripts/*.mjs`).

## How this plan runs

Each `### Task N` runs as one headless dispatch run, without the context of the others, on a fast model:
- Every task starts with a **Step 0** that checks the previous task is in the branch and prints the rules below.
- Every task ends by appending a `- Task N done: …` line to `docs/dev-notes/2026-10-02-body-grain/notes.md`, then
  committing. That shared file also makes the dispatcher chain the tasks in order.
- **Do exactly what the steps say.** When a step says "stop", end the run with a report that starts with the word given
  (`BLOCKED` or `GATE FAILED`) and quotes the output that triggered it. Do not improvise a fix.
- Visual judgments are the owner's: record what the step asks you to record, and decide nothing.

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production
  scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**
    (no `three` import; plain data in, plain data out — the `burn-state`,
    `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module
    only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string
    modules). TSL node graphs are for thin glue (binding, blending), not for
    the effect itself.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is
  symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`.
  Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
  Capture scripts require `window.__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance,
  frame-to-frame change, GPU ms, boot time) and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders or materials reports
  cold-boot `drawOnce` against the base branch (fresh profile each run).
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a
  light's `.visible`. Never sample the render target you are writing. In
  `march.wgsl.ts`'s positional uniform lists never put a `:` inside a comment.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

(Trimmed from the template, because they cannot apply here: the `ctx`-state rule and the deterministic-simulation rule.
This plan adds no game state, no simulation and no console seam.)

**Plan-specific rules:**

- **Sandbox.** Dispatch runs under a workspace-write sandbox: write only inside the worktree. Every lab capture sets
  `LAB_TMP=.lab-tmp` (gitignored). Scratch files go under `.lab-tmp/grain/`. They do NOT survive into the next task
  (each run may get a fresh worktree), so a task re-creates any scratch file it needs.
- **Ports.** Captures run on private ports: `5371/9371` for `blob:shot` and `blob:render-check`, `5373/9373` for
  `march-hash`, `5391/9391` for `boot-time`.
  - `scripts/lab-servers.sh` REUSES a server that is already listening. A foreign server on our port would serve
    another worktree's code, and the run would still look fine.
  - Every capture task checks its ports first. If any is busy, stop with `BLOCKED: port <p> busy`.
- **The test command** is `npx vitest run <files>`. Run the directory suite only in Task 9.
- **`npx tsc --noEmit` is NOT clean at the base.** It prints exactly one pre-existing error:
  `src/lab/sdf-zombie/pack-golden.test.ts(11,28): error TS2307: Cannot find module 'node:crypto' or its corresponding type declarations.`
  "Type-check passes" in this plan means that one error and no other. Do not fix it.
- **The march golden** is re-pinned only in Task 5, and only after its diff shows exactly the five keys named there.
- **Every commit** ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, given as a
  second `-m`.

---

## Where each octave shows (lab and game)

**The pixel cone.** One SDF pixel at hit distance t spans `2·t·k` metres, where k = `aaCfg.x` = tan(fovY/2) / (SDF
pass height) (`sdf-layer.ts:1399`, `lab-main.ts:2472-2477`).
- **Lab turntable** (1380×820 window): the render cap is 960×540 fit (`lab-renderer.ts:114-115`), giving 909×540. The
  SDF pass is 0.7 of that (`sdf-layer.ts:1466`), so 636×378. The fov is 75° (`lab-renderer.ts:350`). So
  **k = tan(37.5°)/378 = 0.00203**. Task 0 measures it.
- **Game** (estimate, not measured): the shipping march target is 400×300 (800×600 cap, `UPSCALE_SCALE` 0.5), with a
  58° lens (`webgpu/fisheye.ts:92`), so **k ≈ 0.00185**. Without the upscaler (scale 1.0, 600 px tall), k ≈ 0.00092
  and every distance below doubles. `?accumchecker=1` halves k again (`sdf-layer.ts:3300`); it is URL opt-in.

**The fade.** An octave with cell C is at full weight while `C/(2·t·k) ≥ 2` px, at half weight at 1.5 px, and gone at
or below 1 px. So it is full out to `C/(4k)`, half at `C/(3k)`, and gone beyond `C/(2k)`.

| octave | cell | lab: full / half / gone | game (k 0.00185): full / half / gone |
| --- | --- | --- | --- |
| fine | 3.5 mm | 0.43 / 0.57 / 0.86 m | 0.47 / 0.63 / 0.95 m |
| coarse | 12 mm | 1.48 / 1.97 / 2.96 m | 1.62 / 2.16 / 3.25 m |

**The combined weight**, `fine + (1 − fine)·coarseFade`, computed for the lab (k = 0.00203):
- **1 out to 1.48 m.** While the fine octave fades (0.43–0.86 m) the coarse cells are 3.4–6.9 px, so the coarse fade
  is 1 and the two weights sum to exactly 1.
- **0.5 at 1.97 m.**
- **0 beyond 2.96 m.**

| `BLOB_DIST` (torso surface ≈ dist − 0.07 m) | t | fine weight | coarse weight | fine / coarse cell, SDF px |
| --- | ---: | ---: | ---: | --- |
| 0.45 (close-up) | 0.38 m | 1.00 | 0.00 | 2.27 / 7.78 |
| 0.65 (mid cross-fade: both octaves drawn, the hash worst case) | 0.575 m | 0.50 | 0.50 | 1.50 / 5.14 |
| 0.85 | 0.78 m | 0.03 | 0.97 | 1.11 / 3.79 |
| **1.35 (the owner's usual framing)** | 1.28 m | 0.00 | **1.00** | 0.67 / **2.31** |
| 2.4 (turntable default) | 2.33 m | 0.00 | 0.18 | 0.37 / 1.27 |
| 3.0 | 2.93 m | 0.00 | 0.00 | 0.30 / 1.01 |

**The face is never faded.** At 1.35 m its 3.1–3.7 mm texels are about 0.6 SDF px: sub-pixel point-sampled noise that
crawls in motion. At that distance the body shows the coarse octave instead, with stable 2.3 px cells.

**Is 0.012 the right coarse cell? I keep 0.012 as the default.**

Why 0.012:
- It keeps the owner's 1.35 m framing at full strength, with 2.31 px cells. That is the closest stable match to how the
  face reads there.
- It is a 3.4× step from the fine octave, so the hand-off is about one octave.
- It meets the spec's "about 1.2 cm".

Its limit: it is half strength at 1.97 m and gone by 2.96 m in the lab (game ≈ 2.16 / 3.25 m), so it does not reach
3–4 m.

What would reach 3–4 m:
- **The cheap change:** `GRAIN_CELL_COARSE = 0.016`. In the lab that is full to 1.97 m, half at 2.63 m, gone at 3.94 m
  (game 2.16 / 2.89 / 4.33 m). The cost: chunkier cells, 3.1 px at 1.35 m, and a 4.6× step at the hand-off. It is
  one constant; Task 2's tests use the constant, so they need no edit.
- **The principled change:** a third octave at about 0.04 m with the same weighting rule. It adds 7 hashes, drawn only
  in its own band. It is not built here: the owner chose two scales.

**This is a question at the owner gate (Task 10).**

**Hash budget.** `hash13` per grained pixel: 7 for one octave (one hash for the cell's colour, six for the neighbour
gradient), 14 only in the cross-fade band, and 0 beyond both fades. Everything sits behind `grain > 0`, so a body
without grain pays one comparison. The existing post-hit noise is about 144 hashes per hit, measured at ~0 ms. That
measurement lives in the `claude/sdf-rendering-dream-techniques` worktree,
`docs/dev-notes/2026-10-01-posthit-noise-split/NOTES.md`.

---

## Facts and decisions (verified against `c9dfd1f5` / spec `c1f02fe2`, 2026-10-02; line numbers drift, quoted text does not)

### Anchors verified

| What | Where |
| --- | --- |
| Face sheet base tone `let v = 0.46 + (hash2(px, py, p.seed) - 0.5) * 2 * p.grain;` — a featureless corner texel at grain 0 is byte 117 = 0.4588 | `src/lab/sdf-zombie/blob-face-sheet.ts:312` |
| `DEFAULT_SHEET.texRelief: 1.4`, `texStrength: 1.0`, `projScaleX/Y 0.45/0.58`; the goblin's `sheet` block sets none of them | `blob-face-sheet.ts:225-255` |
| Goblin face texel: 0.118×0.76/(64×0.45) = 3.11 mm by 0.118×1.161/(64×0.58) = 3.69 mm | `characters/goblin.blob` face block |
| Face layer `var faceCover = 0.0;`; `var facing = smoothstep(…)`, `facing = facing * faceRegion;`; `faceCover = clamp(facing + faceRegion * ${HEAD_EXTERIOR_GORE_KEEP}, 0.0, 1.0);` (KEEP 0.3); sampled branch `let tex = texel(faceTex, base);` then `faceCover = faceCover * tex.a;` | `webgpu/march/body/face.wgsl.ts:28, 77, 101, 104, 111, 116` |
| Face multiply weight `facing * tex.a * faceCfg.y * (1.0 - faceGlow) * woundDecalFade`; relief `n = normalize(n + bump * faceCfg.w * facing * tex.a * (1.0 - faceGlow));` | `face.wgsl.ts:158-159, 188` |
| `FACE_LAYER_WGSL` is also used by settled heads (`MESH_FACE_LAYER`, which regex-renames `albedo` and a standalone `n`) | `webgpu/baked-chunks.ts:212-215` |
| Post-hit chain `PRIM_MATERIAL, SHADING_NORMAL, WOUND_MASKS, TISSUE, ORGAN, MOTTLE, FACE_LAYER, GORE, SOLDIER_MEAT, PAINT_CHAR, BURN, MELT`; `loadInstance(inst, gHitSlot);` before it | `webgpu/march/body/trace.wgsl.ts:314, 349-368` |
| `var gloss`, `var painted`, `var metal` | `blocks/post/prim-material.wgsl.ts:22-24` |
| `let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift), gBand);` (rest-space metres) | `blocks/post/shading-normal.wgsl.ts:32`; `march/fields/carves.wgsl.ts:28-50` |
| `let wm = wmBoth.x;`; `let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));`; micro-detail fbm added to `n` in rest axes, unrotated | `blocks/post/wound-masks.wgsl.ts:9, 13, 16-23` |
| `var albedo = mix(baseColor, tissue, wm);` | `blocks/post/tissue.wgsl.ts:37` |
| Gore `let goreStrength = max(lodCfg.w, gInstGore) * (1.0 - faceCover) * select(1.0, 0.0, isBone);`; paint replaces albedo in `if (painted > 0.0) {` | `blocks/post/gore.wgsl.ts:30`; `blocks/post/paint-char.wgsl.ts:43-52` |
| `hash13(pIn: vec3<f32>) -> f32`, the only hash, already in `HELPERS` | `webgpu/march/math.wgsl.ts:7-11`; `march/helpers.ts:44` |
| `meltCfg`: x melt, y motion-out, z skin detail k, **w documented spare**; grep 2026-10-02 finds no read or write of `gInstMelt.w` / `meltCfg.value.w` and no wholesale `meltCfg.value.set/copy` | `march/body/params.wgsl.ts:29-31` (TS comment, outside the WGSL string); `zombie-gpu.ts:381-387` |
| Record path: `meltCfg: u.meltCfg.value.toArray()` → `put4(b + REC_MELT * 4, s.meltCfg)` → `gInstMelt = (*inst)[base + ${REC_MELT}];` | `zombie-gpu.ts:1685`; `crowd-records.ts:98`; `march/fields/groups.wgsl.ts:353` |
| `function syncRecord()`; the lab calls it every frame through `view.setTime` | `zombie-gpu.ts:2785`; `lab-main.ts:2801` |
| `applyMaterial(m, light) {` … `u.marchCfg.value.z = m.silhouetteNoiseAmp;` … `u.bounceCfg.value.w = light.chromaGain;` — does NOT call `syncRecord()` | `zombie-gpu.ts:2925-2950` |
| Chunk views copy a fixed list of template uniforms, without `meltCfg` (gibs never get grain) | `zombie-gpu.ts:3181-3230` |
| `compilePalette` takes its keys from `Object.keys(PALETTE_BASE)`, so a new `FleshMaterial` field is authorable | `blob-compile.ts:190-220` |
| `MATERIAL_SLIDERS`; `savePalette` accepts only slider keys | `panel.ts:132-140`; `src/lab/dev-save.ts:63-70` |
| `__sdfLab`: `uniforms` (the hero's `u`), `benchGpu`, `setCam(yaw, pitch, dist, targetY?)`, `focusBody`, `setMotionEnabled`, `setWander`, `setAdaptive`, `sdfLayer`, `camera` | `webgpu/lab-main.ts:4147, 2213, 4751, 4375, 4450-4458, 4700` |
| Turntable: `BLOB_PROBE` runs once after boot; `BLOB_MASK=1` writes `mask-NN.png` (body mask, alpha 255/0); `BLOB_TARGET_Y` unset = leave the target (an EMPTY value means y = 0) | `scripts/blob-turntable.mjs` |
| `goblin.blob`: the sheet's `  grain      0.10` (line 454); the palette's last line is `  surfaceNoiseAmp 0.22` (line 510) | `src/lab/sdf-zombie/characters/goblin.blob` |

### Text pins the new WGSL must not trip (all pass at HEAD: 18 relevant files, 207 tests)

- **`entry.wgsl.test.ts:43-54`**: `MARCH_BODY_TRACE` must not contain `ANALYTIC FLASHLIGHT`, `ambientAt(`,
  `woundShadow(`, `levelShadow(`, `var fleshLit`, `softShoulder(` or `0.04045`, not even in a comment.
- **`entry.wgsl.test.ts:82-90`**: a name declared in `MARCH_TRACE_LOOP` and read later must also be declared in
  `REFINE_LOOP`. The block reads only `t` from the walk, and every local it declares starts with `grain`.
- **Counted tokens**: `deferred-sdf.test.ts:146` counts `mapBody(`, `tissue.wgsl.test.ts:22` counts `woundMask(`, and
  `entry.wgsl.test.ts:29-31` counts `let specPow` / `var wet = ` / `let glow = `. The block mentions none of them.
- **`pack-golden.test.ts`** hashes packed prims, not palettes: it is unaffected.

### Decisions

1. **Where the block goes: after `FACE_LAYER_WGSL`, before `GORE_BLOCK`.** It needs the face sheet's coverage, which
   only the face layer computes. Gore, paint, char and melt still paint over it, as they paint over the face.
2. **Face coverage: a new `var faceSheetCover`, set to `facing * tex.a` in the face's sampled branch.**
   - `faceCover` cannot stand in: it is the gore's protection, it adds 0.3 over the whole head region, and it is
     non-zero off the sheet.
   - `facing * tex.a` also keeps the grain off the glowing eyes.
   - The new var also lands, unused, in `MESH_FACE_LAYER`. That is harmless.
3. **The uniform lane: `meltCfg.w` (read as `gInstMelt.w`), not a new parameter.**
   - The lane is genuinely free.
   - It is per instance: the crowd record copies `meltCfg` whole, and the post-hit chain reloads the hit body's
     record. So a crowd body carries its own value through the shared per-type material.
   - Precedent: `meltCfg.z` (skin detail k) is already a per-character look setting.
   - A new parameter would touch `MARCH_BODY_PARAMS`, three binding literals in `zombie-gpu.ts`, `REFINE_PARAMS` and
     the deferred material.
   - The cost: `applyMaterial` must now call `syncRecord()`.
4. **The cells: two named constants, `GRAIN_CELL_FINE = 0.0035` and `GRAIN_CELL_COARSE = 0.012`.**
   - The fine cell sits between the face texel's 3.11 and 3.69 mm.
   - The coarse cell is a 3.4× step; see "Is 0.012 the right coarse cell?" above.
   - The coarse octave hashes `floor(anchor / 0.012) + 1000`. The offset puts it on its own stretch of the hash
     lattice, so a coarse cell never reuses a fine cell's hash. Within ±2 m the fine indices stay inside ±572 and the
     coarse ones inside 833..1167.
5. **The weights, with fades from `GRAIN_FADE_PX = { LO: 1.0, HI: 2.0 }`:**
   - `pix = max(2·t·aaCfg.x, 1e-6)`
   - `fadeF = smoothstep(1, 2, FINE/pix)`
   - `fadeC = (1 − fadeF) · smoothstep(1, 2, COARSE/pix)`
   - `mask = (1 − faceSheetCover) · (1 − max(gloss, metal)) · (1 − painted) · clamp(1 − wm, 0, 1)`
   - `wF = fadeF · mask` and `wC = fadeC · mask`

   Because `fadeC ≤ 1 − fadeF`, `wF + wC ≤ mask ≤ 1`.
6. **Colour: sum the octaves' deviations.** Do not multiply the octave factors.
   - The formula: `albedo *= 1 + 2·grain/0.46 · Σᵢ (hᵢ − 0.5)·wᵢ`.
   - **Bound:** `|Σ (hᵢ − 0.5)·wᵢ| ≤ 0.5·(wF + wC) ≤ 0.5`, so the factor stays within `1 ± grain/0.46`: ±21.7% at
     0.10. That is exactly one octave at full weight.
   - Multiplying instead would give `(1+a)(1+b) = 1 + a + b + ab`. With both octaves at their positive extreme the `ab`
     term would push it to 1.229, past one octave's 1.217.
   - The mean over uniform h is exactly 1.
7. **Tilt: sum the octaves' weighted neighbour gradients, then scale once.**
   - The gradient: `grad = Σᵢ wᵢ·(h(cᵢ+x) − h(cᵢ−x), h(cᵢ+y) − h(cᵢ−y), h(cᵢ+z) − h(cᵢ−z))`.
   - The tilt: `tilt = −grad · 2·grain·1.4`, then `n = normalize(n + tilt − n·dot(tilt, n))`.
   - **Per-axis bound:** each component of `grad` is at most `wF + wC ≤ 1`, so the tilt is at most `2·0.10·1.4 = 0.28`.
     That is the face's maximum: its relief is `texRelief·(v_R − v_L)`, and `v_R − v_L = 2·grain·(u_R − u_L)`.
   - **RMS at one octave's full weight:** 0.28/√6 = 0.114 per axis, matching the face's.
   - **Known limit:** the vector is in rest axes, unrotated, as the micro-detail's is. Cells stay glued to the skin; each
     facet's direction stays world-fixed as a limb turns.
8. **The two fades beyond the spec's letter, `(1 − painted)` and `(1 − wm)`, are kept but flagged OPTIONAL for the
   owner (Task 10).**
   - Painted prims have their colour replaced anyway.
   - Inside wounds the tissue ramp owns the colour.
   - Neither touches the goblin today: it has no painted prims and no wounds in the lab.
9. **A lab slider:** `MATERIAL_SLIDERS` gets `{ key: 'grain', min: 0, max: 0.3 }`, so the owner can tune the grain live.
   "save skin → repo" then writes it too. The retired WebGL lab shares the list and gets a slider that does nothing.
10. **Compile coverage.** The lab captures compile `marchBody`. `REFINE_BODY` and `MARCH_SURFACE` are pinned by text
    to the same `MARCH_TRACE_POST`. `deferred-check.sh` is not run, because it writes into tracked dev-notes folders.
11. **No temporary base worktree.** `git worktree add` writes outside the sandbox. Base numbers are recorded in Task 0
    and compared in Task 8; a mismatch stops and goes to the owner.

---

### Task 0: Baselines, before any code

**Context:** This plan adds a body grain to the march shader (see the Goal above). Before any code changes, this task
records the numbers that Task 8 compares against: the lab's pixel cone k, the `march-hash` pixel gate, and the cold boot
time. It changes no source.

**Files:**
- Create: `docs/dev-notes/2026-10-02-body-grain/notes.md`
- Scratch, not committed: `.lab-tmp/grain/*.log`

- [ ] **Step 0: Preconditions**

```bash
git status --short
test -f docs/superpowers/plans/2026-10-02-body-grain.md && echo plan-present || echo plan-MISSING
test -f docs/dev-notes/2026-10-02-body-grain/notes.md && echo notes-ALREADY-EXIST || echo notes-absent
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  Expected:
  - `git status --short` prints nothing, or only untracked `.lab-tmp/` content;
  - `plan-present`;
  - `notes-absent`;
  - the rules text. Read it.

  If `src/` shows modifications, or the notes already exist, stop: `BLOCKED: tree not at the base`.

- [ ] **Step 1: Quiet machine and free ports**

```bash
uptime
for p in 5371 9371 5373 9373 5391 9391; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo "BUSY $p"; done; echo ports-checked
```

  Expected: `ports-checked` with no `BUSY` line. If any port is busy, stop: `BLOCKED: port <p> busy`. Record the load
  average; Step 5 writes it down.

- [ ] **Step 2: Measure the lab's pixel cone** (one goblin frame; about a minute)

```bash
mkdir -p .lab-tmp/grain
LAB_TMP=.lab-tmp LAB_VITE_PORT=5371 LAB_CDP_PORT=9371 \
BLOB_PROBE='(()=>{const L=window.__sdfLab;return {k:L.uniforms.aaCfg.value.x,sdf:L.sdfLayer.targetSize,fov:L.camera.fov,grain:L.uniforms.meltCfg.value.w};})()' \
npm run blob:shot -- goblin .lab-tmp/grain/probe 1 2>&1 | tee .lab-tmp/grain/probe.log
grep '^probe: ' .lab-tmp/grain/probe.log
```

  Expected: `probe: {"k":0.0020299…,"sdf":{"width":636,"height":378},"fov":75,"grain":0}`, and the run ends with
  `frames: .lab-tmp/grain/probe/index.html`.
  - If no `probe:` line prints, the lab did not boot: stop with `BLOCKED: lab probe failed` and quote the last 20 lines
    of `.lab-tmp/grain/probe.log`.
  - A different k is not a failure: Step 5 records it, and Task 7 reports distances from it.

- [ ] **Step 3: The pixel-gate baseline** (`march-hash`, room 1; a few minutes)

```bash
LAB_TMP=.lab-tmp LAB_VITE_PORT=5373 LAB_CDP_PORT=9373 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs' 2>&1 \
  | tee .lab-tmp/grain/march-hash-base.log
grep '^{"room1"' .lab-tmp/grain/march-hash-base.log | tail -1
```

  Expected: one JSON line `{"room1":"<40 hex>","room1-repeat":"<same 40 hex>","room1-wounded":"<other 40 hex>"}`.
  - If `room1-repeat` differs from `room1`, the machine is loaded. Run the step once more.
  - If it still differs, or no line prints, stop: `BLOCKED: march-hash baseline not deterministic`.

- [ ] **Step 4: Cold-boot baseline, twice** (each run makes its own fresh profile under `.lab-tmp`)

```bash
node scripts/boot-time.mjs 5391 9391 2>&1 | tee .lab-tmp/grain/boot-base-1.log
node scripts/boot-time.mjs 5391 9391 2>&1 | tee .lab-tmp/grain/boot-base-2.log
grep -h '^{"drawOnce"' .lab-tmp/grain/boot-base-1.log .lab-tmp/grain/boot-base-2.log
```

  Expected: two lines like `{"drawOnce":3500.12,"warmMs":5000}`.
  - If a line is missing, rerun that one.
  - If a run's `warmMs` is over 30000, it paid Vite's first dependency pre-bundle. Run a third time and use the last
    two.

- [ ] **Step 5: Write the notes** (one command; it reads the logs above)

```bash
mkdir -p docs/dev-notes/2026-10-02-body-grain
SHA="$(git rev-parse HEAD)" \
CHROME="$(defaults read '/Applications/Google Chrome.app/Contents/Info.plist' CFBundleShortVersionString 2>/dev/null || echo unknown)" \
LOAD="$(uptime)" \
PROBE="$(grep '^probe: ' .lab-tmp/grain/probe.log | tail -1 | sed 's/^probe: //')" \
HASH="$(grep '^{"room1"' .lab-tmp/grain/march-hash-base.log | tail -1)" \
BOOTS="$(grep -h '^{"drawOnce"' .lab-tmp/grain/boot-base-*.log | tail -2 | tr '\n' ' ')" \
node -e '
const e = process.env;
const p = JSON.parse(e.PROBE), h = JSON.parse(e.HASH);
const boots = e.BOOTS.trim().split(" ").map((s) => JSON.parse(s).drawOnce);
const d = (c) => [4, 3, 2].map((n) => (c / (n * p.k)).toFixed(2)).join(" / ");
const lines = [
  "# Body grain: build notes (2026-10-02)",
  "",
  "Spec: ../../superpowers/specs/2026-10-02-body-grain-design.md. Plan: ../../superpowers/plans/2026-10-02-body-grain.md.",
  "",
  "## Baselines (Task 0, before any code)",
  "",
  "- BASE commit: " + e.SHA,
  "- BASE Chrome: " + e.CHROME,
  "- BASE load: " + e.LOAD.trim(),
  "- BASE k: " + p.k,
  "- BASE sdf pass: " + p.sdf.width + "x" + p.sdf.height + ", fov " + p.fov,
  "- Lab fade distances full / half / gone (m): fine 3.5 mm " + d(0.0035) + "; coarse 12 mm " + d(0.012),
  "- BASE march-hash room1: " + h.room1,
  "- BASE march-hash room1-wounded: " + h["room1-wounded"],
  "- BASE boot drawOnce: " + boots.join(" "),
  "- npx tsc --noEmit at the base: one pre-existing error (pack-golden.test.ts, node:crypto).",
  "",
  "## Progress",
  "",
  "- Task 0 done: baselines recorded.",
];
console.log(lines.join("\n"));
' > docs/dev-notes/2026-10-02-body-grain/notes.md
cat docs/dev-notes/2026-10-02-body-grain/notes.md
```

  Expected: the notes print with every `BASE` line filled in, and a fine line reading about `0.43 / 0.57 / 0.86`.
  - If node prints a `SyntaxError` or `Unexpected end of JSON input`, one of Steps 2–4 left no line in its log. Rerun
    that step, then this one.

- [ ] **Step 6: Commit**

```bash
git add docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "docs(grain): baselines before the body grain (pixel cone, march-hash, cold boot)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1: The `grain` field (material and palette)

**Context:** `FleshMaterial` (`src/lab/sdf-zombie/material.ts`) is the per-character flesh look. A `.blob` `palette`
block can set any of its fields, because `compilePalette` reads its keys off the `henenlotter-latex` preset. This task
adds the field `grain`, set to 0 (off) in all three presets. TDD: write the tests first and watch them fail.

**Files:**
- Modify: `src/lab/sdf-zombie/material.ts`
- Test: `src/lab/sdf-zombie/material.test.ts`, `src/lab/sdf-zombie/blob-compile.test.ts`
- Notes: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 0 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 0"
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  Expected: a `- Task 0 done` line, then the rules (read them). If `MISSING` prints, stop:
  `BLOCKED: Task 0 is not in this branch`.

- [ ] **Step 1: The preset test.** In `src/lab/sdf-zombie/material.test.ts`, find this test:

```ts
  it('keeps every silhouetteNoiseAmp inside the Lipschitz budget at stepMul 0.6', () => {
    for (const n of names)
      expect(FLESH_PRESETS[n].silhouetteNoiseAmp).toBeLessThanOrEqual((1 - 0.6) * 0.5);
  });
```

  Directly after it, add:

```ts

  // Body grain (body-grain.ts) is a per-character decision, like mottleAmp: 0 in every preset skips the
  // shader block, so a body that does not opt in shades exactly as it did before the grain existed.
  it('ships body grain OFF (0) in every preset', () => {
    for (const n of names) expect(FLESH_PRESETS[n].grain, n).toBe(0);
  });
```

- [ ] **Step 2: The palette test.** In `src/lab/sdf-zombie/blob-compile.test.ts`, find:

```ts
  it('carries the mottle fields through', () => {
    const m = compilePalette(doc('  mottleAmp 0.45\n  mottleScale 1.6\n  mottleColor 0.2 0.19 0.06\n'))!;
    expect(m.mottleAmp).toBe(0.45);
    expect(m.mottleScale).toBe(1.6);
    expect(m.mottleColor).toEqual([0.2, 0.19, 0.06]);
  });
```

  Directly after it, add:

```ts

  // Body grain (2026-10-02): authorable with no grammar change, because compilePalette reads its keys off
  // the base preset. Unnamed, it keeps the preset's 0 (off).
  it('carries the body grain through, and leaves it off when unnamed', () => {
    expect(compilePalette(doc('  grain 0.1\n'))!.grain).toBe(0.1);
    expect(compilePalette(doc('  wetness 0.2\n'))!.grain).toBe(0);
  });
```

- [ ] **Step 3: Run and confirm exactly the two new tests fail**

  Run: `npx vitest run src/lab/sdf-zombie/material.test.ts src/lab/sdf-zombie/blob-compile.test.ts`

  Expected: `Tests  2 failed | 66 passed (68)`.
  - `ships body grain OFF` fails with `expected undefined to be +0`.
  - `carries the body grain through` fails with a `BlobError` containing `unknown palette parameter "grain"`.

  If any other test fails, stop: `BLOCKED: unexpected failure before the change`, quoting it.

- [ ] **Step 4: Add the field.** In `src/lab/sdf-zombie/material.ts`, replace:

```ts
  /** 0 shades organ prims as plain bone, so the off-state is one knob
   *  rather than a rebuild. */
  organAmp: number;
}
```

  with:

```ts
  /** 0 shades organ prims as plain bone, so the off-state is one knob
   *  rather than a rebuild. */
  organAmp: number;
  /**
   * Body grain: the face sheet's speckle on the rest of the body, in two
   * octaves (body-grain.ts; spec docs/superpowers/specs/2026-10-02-body-grain-design.md).
   * Hard-edged cells cut in REST space so they ride each limb: face-sized
   * (3.5 mm) up close, 1.2 cm farther out. Each cell is an albedo multiply and
   * a small normal tilt.
   *
   * The SAME UNITS as the face sheet's `grain` (blob-face-sheet.ts draws plain
   * skin as 0.46 + (hash - 0.5) * 2 * grain): a character that sets one value in
   * both gets one contrast on face and body.
   *
   * 0 skips the whole shader block, which is why every preset ships 0: like
   * `mottleAmp`, turning it on is a per-character decision (a `.blob` `palette`
   * line). The renderer carries it per body in meltCfg.w (applyMaterial).
   */
  grain: number;
}
```

  Then add `grain: 0,` to each of the three presets. The line `    organColor: [0.72, 0.32, 0.30], organAmp: 1,`
  appears exactly three times (once per preset). Replace every occurrence with:

```ts
    organColor: [0.72, 0.32, 0.30], organAmp: 1,
    grain: 0,
```

  Check: `grep -c '    grain: 0,' src/lab/sdf-zombie/material.ts` prints `3`. If it prints anything else, fix the
  edit until it does.

- [ ] **Step 5: Run the two files again**

  Run: `npx vitest run src/lab/sdf-zombie/material.test.ts src/lab/sdf-zombie/blob-compile.test.ts`
  Expected: `Tests  68 passed (68)`.

- [ ] **Step 6: Type-check**

  Run: `npx tsc --noEmit 2>&1 | grep 'error TS'`

  Expected: exactly one line, the pre-existing `pack-golden.test.ts(11,28): error TS2307 … 'node:crypto'`.
  - If a new error names a `FleshMaterial` literal missing `grain`, add `grain: 0,` to that literal and rerun.
    None was found on 2026-10-02.
  - Stop on any other new error: `BLOCKED: type error`.

- [ ] **Step 7: Progress line.** Append this line at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 1 done: FleshMaterial.grain, 0 in every preset; palette parses it (68 tests pass).
```

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/material.ts src/lab/sdf-zombie/material.test.ts src/lab/sdf-zombie/blob-compile.test.ts \
  docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "feat(material): a palette grain field, 0 in every preset (body grain)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The pure module, `body-grain.ts`

**Context:** The grain's constants and arithmetic go in a renderer-free module with its own tests. Task 3's WGSL block
names the same constants. The design is two octaves of one grain, with a fine cell of 3.5 mm and a coarse cell of
12 mm. Each fades by the pixel cone, the coarse one weighted by what the fine one has lost. The octaves' colour
deviations and their neighbour-hash tilts are summed.

**Files:**
- Create: `src/lab/sdf-zombie/body-grain.ts`
- Test: `src/lab/sdf-zombie/body-grain.test.ts` (create)
- Notes: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 1 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 1"
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  If `MISSING` prints, stop: `BLOCKED: Task 1 is not in this branch`.

- [ ] **Step 1: Create the test file `src/lab/sdf-zombie/body-grain.test.ts`** with exactly this content:

```ts
// src/lab/sdf-zombie/body-grain.test.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md). The pure half: the constants
// match the face sheet they imitate, the two octaves hand over without a gap or an overshoot, and the
// arithmetic is the one the WGSL block (webgpu/march/body/blocks/post/body-grain.wgsl.ts) repeats per pixel.
import { describe, it, expect } from 'vitest';
import {
  GRAIN_BASE_TONE, GRAIN_CELL_COARSE, GRAIN_CELL_FINE, GRAIN_COARSE_LATTICE_OFFSET, GRAIN_FADE_PX, GRAIN_RELIEF,
  grainAlbedoScale, grainCell, grainFadeDistances, grainMask, grainOctaveFades, grainTiltScale, type GrainMasks,
} from './body-grain';
import { DEFAULT_SHEET, generateFaceSheet } from './blob-face-sheet';

const LAB_K = 0.00203; // the lab turntable's pixel cone: tan(37.5 deg) / 378 px

describe('body grain: the face sheet it imitates', () => {
  it("uses the sheet's base tone (a featureless corner texel at grain 0)", () => {
    // Texel (0, 0) is clear of the brow, eyes, nose, jaw, nostrils and mouth for the default sheet.
    const sheet = generateFaceSheet({ ...DEFAULT_SHEET, grain: 0 });
    expect(sheet.pixels[0]! / 255).toBeCloseTo(GRAIN_BASE_TONE, 2);
  });

  it("uses the face's default relief gain", () => {
    expect(GRAIN_RELIEF).toBe(DEFAULT_SHEET.texRelief);
  });

  it("cuts fine cells between the goblin face texel's two sides (3.1 x 3.7 mm)", () => {
    // goblin.blob face block: headRadius 0.118, headWidth 0.76, headHeight 1.161; a 64-texel sheet at the
    // default projection scales (the goblin's sheet block sets neither).
    const tx = (0.118 * 0.76) / (64 * DEFAULT_SHEET.projScaleX);
    const ty = (0.118 * 1.161) / (64 * DEFAULT_SHEET.projScaleY);
    expect(GRAIN_CELL_FINE).toBeGreaterThan(tx);
    expect(GRAIN_CELL_FINE).toBeLessThan(ty);
  });
});

describe('body grain: two octaves', () => {
  it('makes the coarse cell at least HI/LO times the fine one, so the coarse octave is full wherever the fine fades', () => {
    expect(GRAIN_CELL_COARSE / GRAIN_CELL_FINE).toBeGreaterThanOrEqual(GRAIN_FADE_PX.HI / GRAIN_FADE_PX.LO);
  });

  it('fades each octave at the lab distances the plan reports', () => {
    const fine = grainFadeDistances(GRAIN_CELL_FINE, LAB_K);
    expect(fine.full).toBeCloseTo(0.431, 2);
    expect(fine.half).toBeCloseTo(0.575, 2);
    expect(fine.none).toBeCloseTo(0.862, 2);
    const coarse = grainFadeDistances(GRAIN_CELL_COARSE, LAB_K);
    expect(coarse.full).toBeCloseTo(1.478, 2);
    expect(coarse.half).toBeCloseTo(1.970, 2);
    expect(coarse.none).toBeCloseTo(2.956, 2);
  });

  it('weighs the octaves as the plan tabulates at the lab framings', () => {
    const at = (t: number) => grainOctaveFades(t, LAB_K);
    expect(at(0.38)).toEqual({ fine: 1, coarse: 0 });      // BLOB_DIST 0.45 close-up
    expect(at(0.575).fine).toBeCloseTo(0.5, 2);            // BLOB_DIST 0.65, mid cross-fade
    expect(at(0.575).coarse).toBeCloseTo(0.5, 2);
    expect(at(1.28)).toEqual({ fine: 0, coarse: 1 });      // BLOB_DIST 1.35, the owner's framing
    expect(at(1.97).coarse).toBeCloseTo(0.5, 2);
    expect(at(3.0)).toEqual({ fine: 0, coarse: 0 });
  });

  it('never lets the weights sum past 1, and holds them at exactly 1 out to the coarse full distance', () => {
    const fullC = grainFadeDistances(GRAIN_CELL_COARSE, LAB_K).full;
    for (let t = 0.05; t < 6; t += 0.01) {
      const w = grainOctaveFades(t, LAB_K);
      expect(w.fine + w.coarse).toBeLessThanOrEqual(1 + 1e-12);
      if (t <= fullC) expect(w.fine + w.coarse).toBeCloseTo(1, 10);
    }
  });

  it('puts the coarse octave on its own stretch of the hash lattice (no index shared within 2 m)', () => {
    const fineMax = 2 / GRAIN_CELL_FINE;
    const coarseMin = GRAIN_COARSE_LATTICE_OFFSET - 2 / GRAIN_CELL_COARSE;
    expect(coarseMin).toBeGreaterThan(fineMax);
  });
});

describe('body grain: the per-pixel arithmetic', () => {
  it('finds a cell by flooring the rest-space anchor by the cell size', () => {
    expect(grainCell([0.0036, -0.0001, 0.0071], GRAIN_CELL_FINE)).toEqual([1, -1, 2]);
    expect(grainCell([0.0125, -0.0001, 0.025], GRAIN_CELL_COARSE)).toEqual([1, -1, 2]);
  });

  it("multiplies albedo by the face's swing: mean 1, at most +-22% at grain 0.10", () => {
    expect(grainAlbedoScale([{ h: 1, w: 1 }], 0.1)).toBeCloseTo(1.2174, 4);
    expect(grainAlbedoScale([{ h: 0, w: 1 }], 0.1)).toBeCloseTo(0.7826, 4);
    expect((grainAlbedoScale([{ h: 1, w: 1 }], 0.1) + grainAlbedoScale([{ h: 0, w: 1 }], 0.1)) / 2).toBeCloseTo(1, 10);
    // Two octaves at half weight, both at their extreme, swing exactly as far as one at full weight.
    expect(grainAlbedoScale([{ h: 1, w: 0.5 }, { h: 1, w: 0.5 }], 0.1)).toBeCloseTo(1.2174, 4);
    expect(grainAlbedoScale([{ h: 0.9, w: 0 }, { h: 0.1, w: 0 }], 0.1)).toBe(1);
    expect(grainAlbedoScale([], 0.1)).toBe(1);
  });

  it('never swings the albedo past one octave at full weight, at any distance', () => {
    const limit = 0.1 / GRAIN_BASE_TONE + 1e-12;
    for (let t = 0.05; t < 6; t += 0.01) {
      const w = grainOctaveFades(t, LAB_K);
      for (const hF of [0, 1]) for (const hC of [0, 1]) {
        const s = grainAlbedoScale([{ h: hF, w: w.fine }, { h: hC, w: w.coarse }], 0.1);
        expect(Math.abs(s - 1)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("tilts as far as the face's relief: at most 2 x grain x 1.4 = 0.28 per axis at grain 0.10", () => {
    // Face: texRelief x (v_R - v_L), v = 0.46 + (u - 0.5) x 2 x grain, so v_R - v_L = 2 x grain x (u_R - u_L).
    // The body's summed gradient has components of at most wF + wC <= 1, so the same scale tilts at most as far.
    expect(grainTiltScale(0.1)).toBeCloseTo(0.28, 10);
  });

  it('masks to 1 on bare skin and 0 under the face sheet, on gloss, metal, paint, or in a wound', () => {
    const skin: GrainMasks = { faceSheetCover: 0, gloss: 0, metal: 0, painted: 0, wound: 0 };
    expect(grainMask(skin)).toBe(1);
    expect(grainMask({ ...skin, faceSheetCover: 0.25 })).toBeCloseTo(0.75, 10);
    for (const kill of [{ faceSheetCover: 1 }, { gloss: 1 }, { metal: 1 }, { painted: 1 }, { wound: 1 }])
      expect(grainMask({ ...skin, ...kill }), JSON.stringify(kill)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails to load**

  Run: `npx vitest run src/lab/sdf-zombie/body-grain.test.ts`
  Expected: the file fails with `Failed to resolve import "./body-grain"`.

- [ ] **Step 3: Create `src/lab/sdf-zombie/body-grain.ts`** with exactly this content:

```ts
// src/lab/sdf-zombie/body-grain.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md; plan
// docs/superpowers/plans/2026-10-02-body-grain.md). The face sheet's texture on the body, in two octaves of one
// grain: hard-edged noise cells cut in the hit's REST-space anchor, each an albedo multiply and a normal tilt matched
// to the face sheet's own grain at the same `grain` value (FleshMaterial.grain, a palette line). Fine cells are
// face-sized and show up close; coarse cells take over as the fine ones drop below about 1.5 pixels, so the body
// stays textured farther out and no octave is ever drawn below a pixel, where it would crawl.
//
// Pure data and arithmetic, no renderer. The WGSL block (webgpu/march/body/blocks/post/body-grain.wgsl.ts) names
// these constants in its text (its test pins that they agree) and does the same arithmetic per pixel; these
// functions are the reference the tests pin and the Rust port follows.
import type { Vec3 } from './types';

/**
 * The fine octave's cell edge, rest-space metres. The goblin's face texel is 3.1 x 3.7 mm: the face projection
 * normalises head space by the skull's semi-axes (0.118 x 0.76 = 0.0897 m wide, 0.118 x 1.161 = 0.137 m tall) and
 * maps it onto 64 texels at projScale 0.45 / 0.58, so a texel is 0.0897 / (64 x 0.45) = 3.11 mm by
 * 0.137 / (64 x 0.58) = 3.69 mm. 3.5 mm sits between, so face and body speckle at one scale up close.
 */
export const GRAIN_CELL_FINE = 0.0035;

/**
 * The coarse octave's cell edge, rest-space metres: a 3.4x step from the fine one. In the lab turntable
 * (k = 0.00203) it is full out to 1.48 m (so the owner's 1.35 m framing shows it at full strength, 2.3 px cells),
 * half at 1.97 m and gone beyond 2.96 m. 0.016 would reach 3.9 m with chunkier cells; tuned on the owner's frames.
 * Must stay at least GRAIN_FADE_PX.HI / LO times GRAIN_CELL_FINE, so it is at full weight wherever the fine fades.
 */
export const GRAIN_CELL_COARSE = 0.012;

/** Added to the coarse octave's cell index before hashing, so its cells read their own stretch of the hash lattice:
 *  within 2 m of the rest origin the fine indices stay inside +-572 and the coarse ones inside 833..1167. */
export const GRAIN_COARSE_LATTICE_OFFSET = 1000;

/** The face sheet's base tone: blob-face-sheet.ts draws plain skin as 0.46 + (hash - 0.5) x 2 x grain, and the
 *  face multiplies albedo by the texel over its level, so the relative swing is 2 x grain / 0.46. */
export const GRAIN_BASE_TONE = 0.46;

/** The face relief's gain at its default (DEFAULT_SHEET.texRelief, faceCfg.w). The body has no relief knob of its
 *  own: `grain` alone sets both the colour swing and the tilt, as it does on the face. */
export const GRAIN_RELIEF = 1.4;

/** The pixel-cone fade, in SDF pixels per cell: an octave is absent at or below LO and full at or above HI,
 *  smoothstep between (midpoint 1.5 px, the spec's "about 1.5 pixels"). */
export const GRAIN_FADE_PX = { LO: 1.0, HI: 2.0 } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (lo: number, hi: number, x: number) => {
  const s = clamp01((x - lo) / (hi - lo));
  return s * s * (3 - 2 * s);
};

/** The integer cell a rest-space point falls in, for a cell edge of cellM metres. */
export function grainCell(anchor: Vec3, cellM: number): Vec3 {
  return [Math.floor(anchor[0] / cellM), Math.floor(anchor[1] / cellM), Math.floor(anchor[2] / cellM)];
}

/** One SDF pixel at hit distance t, in metres. pixelConeK is aaCfg.x, tan(fovY / 2) / SDF height: one pixel's
 *  footprint RADIUS per metre, so a pixel spans 2 x t x k. Floored so t = 0 cannot divide by zero. */
export function grainPixelM(t: number, pixelConeK: number): number {
  return Math.max(2 * t * pixelConeK, 1e-6);
}

/** The two octaves' fades at hit distance t, before the masks: the fine one by its own pixel size, the coarse one
 *  by its pixel size times what the fine one has lost. Up close (fine 1) the coarse adds nothing. */
export function grainOctaveFades(t: number, pixelConeK: number): { fine: number; coarse: number } {
  const pix = grainPixelM(t, pixelConeK);
  const fine = smoothstep(GRAIN_FADE_PX.LO, GRAIN_FADE_PX.HI, GRAIN_CELL_FINE / pix);
  const coarse = (1 - fine) * smoothstep(GRAIN_FADE_PX.LO, GRAIN_FADE_PX.HI, GRAIN_CELL_COARSE / pix);
  return { fine, coarse };
}

/** Where an octave with cell edge cellM is at full weight (out to `full`), half (`half`) and gone (beyond `none`),
 *  in metres of hit distance, for pixel cone k. */
export function grainFadeDistances(cellM: number, pixelConeK: number): { full: number; half: number; none: number } {
  const at = (px: number) => cellM / (2 * px * pixelConeK);
  return {
    full: at(GRAIN_FADE_PX.HI),
    half: at((GRAIN_FADE_PX.LO + GRAIN_FADE_PX.HI) / 2),
    none: at(GRAIN_FADE_PX.LO),
  };
}

/** Everything that turns the grain off at a hit, each 0..1 (BODY_GRAIN_BLOCK's grainMask). */
export interface GrainMasks {
  /** The face sheet's coverage at the hit: facing x alpha where the sheet is sampled, else 0. */
  faceSheetCover: number;
  gloss: number;
  metal: number;
  /** 1 on a painted (color=) prim, whose albedo the paint pass replaces anyway. OPTIONAL for the owner. */
  painted: number;
  /** The wound mask (wm): inside a wound the tissue ramp owns the colour. OPTIONAL for the owner. */
  wound: number;
}

export function grainMask(m: GrainMasks): number {
  return (1 - m.faceSheetCover) * (1 - Math.max(m.gloss, m.metal)) * (1 - m.painted) * clamp01(1 - m.wound);
}

/** One drawn octave at a hit: its cell's hash h (0..1) and its weight w (fade x mask). */
export interface GrainOctaveSample {
  h: number;
  w: number;
}

/** The albedo multiplier: 1 + 2 x grain / 0.46 x sum over octaves of (h - 0.5) x w. The weights sum to at most 1,
 *  so it never swings further than one octave at full weight (+-21.7% at grain 0.10); its mean is 1. */
export function grainAlbedoScale(octaves: readonly GrainOctaveSample[], grain: number): number {
  let dev = 0;
  for (const o of octaves) dev += (o.h - 0.5) * o.w;
  return 1 + dev * 2 * grain / GRAIN_BASE_TONE;
}

/** The scale on the summed, weighted neighbour-hash gradient (each component at most 1 in size) that gives the
 *  normal tilt, before projection onto the tangent plane. 0.28 at grain 0.10, the face relief's most. */
export function grainTiltScale(grain: number): number {
  return 2 * grain * GRAIN_RELIEF;
}
```

- [ ] **Step 4: Run the test**

  Run: `npx vitest run src/lab/sdf-zombie/body-grain.test.ts`

  Expected: `Tests  13 passed (13)`.
  - If the base-tone test fails reading about 0.40, a sheet default changed; stop: `BLOCKED: face sheet base tone moved`.
  - If a distance test fails, the constants in `body-grain.ts` do not match Step 3; fix the file to match Step 3
    exactly.

- [ ] **Step 5: Type-check.** `npx tsc --noEmit 2>&1 | grep 'error TS'`. Expected: only the pre-existing
  `pack-golden.test.ts` line.

- [ ] **Step 6: Progress line.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 2 done: body-grain.ts (two octaves: fine 3.5 mm, coarse 12 mm; summed deviations; 13 tests pass).
```

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/body-grain.ts src/lab/sdf-zombie/body-grain.test.ts docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "feat(grain): body-grain.ts, the pure constants and arithmetic of the two-octave body grain" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The WGSL block (written and tested, not spliced yet)

**Context:** The per-pixel shader code is a WGSL string module beside the other post-hit blocks in
`src/lab/sdf-zombie/webgpu/march/body/blocks/post/`. It names the constants from `body-grain.ts` (Task 2) in its
text. A string-level test pins every formula and that the constants agree. Task 5 splices it into the shader; until
then nothing renders it.

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts` (create)
- Notes: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 2 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 2"
test -f src/lab/sdf-zombie/body-grain.ts && echo module-present || echo module-MISSING
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  If either `MISSING` prints, stop: `BLOCKED: Task 2 is not in this branch`.

- [ ] **Step 1: Create the test file** `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`
  with exactly this content:

```ts
// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md). Nothing here compiles a shader;
// these pin what can be checked from text: the guards, the anchor, both octaves' cells and fades, that the
// constants agree with body-grain.ts, and the formulas. The GPU proof is docs/dev-notes/2026-10-02-body-grain/.
import { describe, it, expect } from 'vitest';
import { BODY_GRAIN_BLOCK } from './body-grain.wgsl';
import {
  GRAIN_BASE_TONE, GRAIN_CELL_COARSE, GRAIN_CELL_FINE, GRAIN_COARSE_LATTICE_OFFSET, GRAIN_FADE_PX, GRAIN_RELIEF,
} from '../../../../../body-grain';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const LO = f(GRAIN_FADE_PX.LO);
const HI = f(GRAIN_FADE_PX.HI);
const B = BODY_GRAIN_BLOCK;
const CODE = B.replace(/\/\/[^\n]*/g, '');
const at = (src: string, needle: string) => {
  const i = src.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe('body grain block (post-hit, two octaves)', () => {
  it('reads the per-instance grain lane, skips everything at 0, and writes only where an octave is drawn', () => {
    expect(B).toContain('let grainAmt = gInstMelt.w;');
    const guard = at(B, 'if (grainAmt > 0.0) {');
    const write = at(B, 'if (grainWF + grainWC > 0.0) {');
    expect(write).toBeGreaterThan(guard);
    expect(at(B, 'albedo = albedo *')).toBeGreaterThan(write);
    expect(at(B, 'n = normalize(')).toBeGreaterThan(write);
  });

  it('names its cell sizes with the same values as body-grain.ts', () => {
    expect(B).toContain(`let grainCellFine = ${f(GRAIN_CELL_FINE)};`);
    expect(B).toContain(`let grainCellCoarse = ${f(GRAIN_CELL_COARSE)};`);
  });

  it('fades each octave by the pixel cone, the coarse one by what the fine one has lost', () => {
    expect(B).toContain('let grainPix = max(2.0 * t * aaCfg.x, 1e-6);');
    expect(B).toContain(`let grainFadeF = smoothstep(${LO}, ${HI}, grainCellFine / grainPix);`);
    expect(B).toContain(`let grainFadeC = (1.0 - grainFadeF) * smoothstep(${LO}, ${HI}, grainCellCoarse / grainPix);`);
  });

  it('masks both octaves under the face sheet, on gloss and metal, on paint and in wounds', () => {
    expect(B).toContain(
      'let grainMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted) * clamp(1.0 - wm, 0.0, 1.0);');
    expect(B).toContain('let grainWF = grainFadeF * grainMask;');
    expect(B).toContain('let grainWC = grainFadeC * grainMask;');
  });

  it("guards each octave's hashes on its own weight: 7 per drawn octave, 14 at most", () => {
    const fine = at(B, 'if (grainWF > 0.0) {');
    const coarse = at(B, 'if (grainWC > 0.0) {');
    expect(coarse).toBeGreaterThan(fine);
    expect(at(B, 'hash13(grainCF')).toBeGreaterThan(fine);
    expect(at(B, 'hash13(grainCF')).toBeLessThan(coarse);
    expect(at(B, 'hash13(grainCC')).toBeGreaterThan(coarse);
    expect(CODE.match(/hash13\(/g)).toHaveLength(14);
    expect(CODE.match(/hash13\(grainCF/g)).toHaveLength(7);
    expect(CODE.match(/hash13\(grainCC/g)).toHaveLength(7);
  });

  it('cuts both octaves in the rest-space anchor, the coarse one on its own stretch of the hash lattice', () => {
    expect(B).toContain('let grainCF = floor(anchor / grainCellFine);');
    expect(B).toContain(`let grainCC = floor(anchor / grainCellCoarse) + vec3<f32>(${f(GRAIN_COARSE_LATTICE_OFFSET)});`);
    expect(CODE).not.toMatch(/floor\(p\b/);
  });

  it("sums the octaves' albedo deviations, in the face sheet's units", () => {
    expect(B).toContain('grainDev = grainDev + (hash13(grainCF) - 0.5) * grainWF;');
    expect(B).toContain('grainDev = grainDev + (hash13(grainCC) - 0.5) * grainWC;');
    expect(B).toContain(`albedo = albedo * (1.0 + grainDev * 2.0 * grainAmt / ${f(GRAIN_BASE_TONE)});`);
  });

  it("sums the octaves' neighbour-cell gradients into one tilt at the face's relief gain, in the tangent plane", () => {
    for (const c of ['grainCF', 'grainCC'])
      for (const axis of ['vec3<f32>(1.0, 0.0, 0.0)', 'vec3<f32>(0.0, 1.0, 0.0)', 'vec3<f32>(0.0, 0.0, 1.0)'])
        expect(B).toContain(`hash13(${c} + ${axis}) - hash13(${c} - ${axis})`);
    expect(B).toContain(`let grainTilt = -grainGrad * (2.0 * grainAmt * ${f(GRAIN_RELIEF)});`);
    expect(B).toContain('n = normalize(n + grainTilt - n * dot(grainTilt, n));');
  });

  it('prefixes every local with grain, so none can collide with a name the walk declares (REFINE_LOOP pin)', () => {
    const names = [...CODE.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith('grain'), name).toBe(true);
  });

  it('carries no light-dependent or counted marker (entry/deferred/tissue tests count them)', () => {
    for (const marker of ['ANALYTIC FLASHLIGHT', 'ambientAt(', 'woundShadow(', 'levelShadow(', 'var fleshLit',
      'softShoulder(', '0.04045', 'mapBody(', 'woundMask(', 'let specPow', 'var wet = ', 'let glow = '])
      expect(B).not.toContain(marker);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails to load**

  Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`
  Expected: `Failed to resolve import "./body-grain.wgsl"`.

- [ ] **Step 3: Create** `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.ts` with exactly this
  content:

```ts
// src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.ts
//
// BODY GRAIN (spec docs/superpowers/specs/2026-10-02-body-grain-design.md; plan
// docs/superpowers/plans/2026-10-02-body-grain.md): the face sheet's speckle on the rest of the body, in two
// octaves, post-hit. The constants and the arithmetic are body-grain.ts's (pure, tested); this is the same
// arithmetic per pixel, and body-grain.wgsl.test.ts pins that the named constants agree. Spliced into
// MARCH_TRACE_POST right after the face layer, so marchBody, refineBody and the deferred marchSurface all run it.
import {
  GRAIN_BASE_TONE, GRAIN_CELL_COARSE, GRAIN_CELL_FINE, GRAIN_COARSE_LATTICE_OFFSET, GRAIN_FADE_PX, GRAIN_RELIEF,
} from '../../../../../body-grain';

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const BODY_GRAIN_BLOCK = /* wgsl */ `  // BODY GRAIN (body-grain.ts). The face sheet carries per-texel white
  // noise, nearest-filtered, so its grain is hard-edged cells about 3 mm
  // across; the body had only the smooth micro-detail fbm and read as
  // plastic beside it. This cuts the same kind of cell into the body, in TWO
  // OCTAVES of one grain:
  //   - fine cells the size of a face texel, at full strength up close, where
  //     they match the face;
  //   - coarse cells about 1.2 cm across, which take over as the fine cells
  //     drop below about 1.5 SDF pixels, so the body stays grainy at the usual
  //     framings and no octave is ever drawn below a pixel (where it would
  //     crawl as anything moves).
  // Every cell is cut in the REST-space anchor, like the mottle and the
  // micro-detail, so it rides its limb. Per cell, one hash gives an albedo
  // multiply in the sheet's own units (plain skin on the sheet is base +
  // (hash - 0.5) * 2 * grain, and the face divides by its level), and the six
  // neighbouring cells' hashes give a normal tilt, the 3D twin of the face
  // relief's neighbour-texel luma differences, at the face's default relief
  // gain.
  // Masked out where the face sheet covers the head (faceSheetCover, left by
  // the face layer above, so the face is not grained twice), on gloss and
  // metal as the micro-detail is, on painted prims (their colour is replaced
  // below anyway) and inside wounds (the tissue ramp owns the colour).
  // Rides gInstMelt.w, the per-instance record lane that applyMaterial fills
  // from the palette. 0, as in every preset, skips the block, so a body that
  // does not opt in shades exactly as it did before this existed. Post-hit
  // only, never in the walk or the field.
  let grainAmt = gInstMelt.w;
  if (grainAmt > 0.0) {
    // Cell edges in rest-space metres: body-grain.ts GRAIN_CELL_FINE and
    // GRAIN_CELL_COARSE (body-grain.wgsl.test.ts pins that they agree).
    let grainCellFine = ${f(GRAIN_CELL_FINE)};
    let grainCellCoarse = ${f(GRAIN_CELL_COARSE)};
    // One SDF pixel at the hit, in metres: aaCfg.x is one pixel's footprint
    // radius per metre of distance.
    let grainPix = max(2.0 * t * aaCfg.x, 1e-6);
    // Each octave fades as its cell drops from 2 pixels to 1. The coarse one
    // is weighted by what the fine one has lost: up close the fine weight is
    // 1 and the coarse adds nothing. The coarse cell is at least twice the
    // fine one (a test pins it), so it is still at full weight wherever the
    // fine one fades, and the two sum to 1 until the coarse starts its own fade.
    let grainFadeF = smoothstep(${f(GRAIN_FADE_PX.LO)}, ${f(GRAIN_FADE_PX.HI)}, grainCellFine / grainPix);
    let grainFadeC = (1.0 - grainFadeF) * smoothstep(${f(GRAIN_FADE_PX.LO)}, ${f(GRAIN_FADE_PX.HI)}, grainCellCoarse / grainPix);
    let grainMask = (1.0 - faceSheetCover) * (1.0 - max(gloss, metal)) * (1.0 - painted) * clamp(1.0 - wm, 0.0, 1.0);
    let grainWF = grainFadeF * grainMask;
    let grainWC = grainFadeC * grainMask;
    // Summed over the octaves, each scaled by its weight: the cell's hash
    // deviation from 0.5, and its neighbour-hash gradient. The weights sum to
    // at most 1, so the colour never swings further than one octave at full
    // weight, and the tilt never further than the face relief's.
    var grainDev = 0.0;
    var grainGrad = vec3<f32>(0.0);
    // Each octave's hashes sit behind its own weight: 7 per drawn octave, 14
    // only where the two cross-fade, none beyond both fades.
    if (grainWF > 0.0) {
      let grainCF = floor(anchor / grainCellFine);
      grainDev = grainDev + (hash13(grainCF) - 0.5) * grainWF;
      grainGrad = grainGrad + grainWF * vec3<f32>(
        hash13(grainCF + vec3<f32>(1.0, 0.0, 0.0)) - hash13(grainCF - vec3<f32>(1.0, 0.0, 0.0)),
        hash13(grainCF + vec3<f32>(0.0, 1.0, 0.0)) - hash13(grainCF - vec3<f32>(0.0, 1.0, 0.0)),
        hash13(grainCF + vec3<f32>(0.0, 0.0, 1.0)) - hash13(grainCF - vec3<f32>(0.0, 0.0, 1.0)));
    }
    if (grainWC > 0.0) {
      // Offset onto its own stretch of the hash lattice, so a coarse cell
      // never shares a hash with a fine cell whose index coincides.
      let grainCC = floor(anchor / grainCellCoarse) + vec3<f32>(${f(GRAIN_COARSE_LATTICE_OFFSET)});
      grainDev = grainDev + (hash13(grainCC) - 0.5) * grainWC;
      grainGrad = grainGrad + grainWC * vec3<f32>(
        hash13(grainCC + vec3<f32>(1.0, 0.0, 0.0)) - hash13(grainCC - vec3<f32>(1.0, 0.0, 0.0)),
        hash13(grainCC + vec3<f32>(0.0, 1.0, 0.0)) - hash13(grainCC - vec3<f32>(0.0, 1.0, 0.0)),
        hash13(grainCC + vec3<f32>(0.0, 0.0, 1.0)) - hash13(grainCC - vec3<f32>(0.0, 0.0, 1.0)));
    }
    if (grainWF + grainWC > 0.0) {
      albedo = albedo * (1.0 + grainDev * 2.0 * grainAmt / ${f(GRAIN_BASE_TONE)});
      // Negated, as the face relief is: a normal tilts away from rising
      // ground. Projected onto the tangent plane, so the whole vector tilts
      // rather than part of it lengthening the normal. The vector is in rest
      // axes, like the micro-detail's: the cells stay glued, only each
      // facet's direction stays world-fixed as a limb turns.
      let grainTilt = -grainGrad * (2.0 * grainAmt * ${f(GRAIN_RELIEF)});
      n = normalize(n + grainTilt - n * dot(grainTilt, n));
    }
  }`;
```

- [ ] **Step 4: Run the test**

  Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`

  Expected: `Tests  10 passed (10)`. If a pin fails, the block text differs from Step 3: make the file match Step 3
  exactly. Do not edit the test.

- [ ] **Step 5: Confirm the shader is unchanged so far.** The block is not spliced or exported from the barrel, so the
  golden must still pass.

  Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/march-golden.test.ts`
  Expected: `Tests  2 passed (2)`. If it fails, stop: `BLOCKED: march golden moved in Task 3`.

- [ ] **Step 6: Type-check.** `npx tsc --noEmit 2>&1 | grep 'error TS'`. Expected: only the pre-existing
  `pack-golden.test.ts` line.

- [ ] **Step 7: Progress line.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 3 done: BODY_GRAIN_BLOCK written and pinned (10 tests), not spliced yet.
```

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.ts \
  src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "feat(grain): the two-octave body grain WGSL block (rest-space cells, summed albedo and tilt, fades)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Plumbing (palette → `meltCfg.w` → record → `gInstMelt.w`), and a lab slider

**Context:**
- The shader block (Task 3) reads the grain from `gInstMelt.w`. That is lane w of the per-instance record row
  `REC_MELT`, which `writeViewRecord` copies whole from each view's `meltCfg` uniform.
- `meltCfg.w` is documented spare and unused.
- This task makes `applyMaterial` (`src/lab/sdf-zombie/webgpu/zombie-gpu.ts`) write the palette's `grain` there and
  sync the record. It also updates the three comments that list `meltCfg`'s lanes, and adds a lab slider.
- The shader text does not change, so the march golden must not move.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, `src/lab/sdf-zombie/webgpu/crowd-records.ts`,
  `src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts` (a TS comment only), `src/lab/sdf-zombie/panel.ts`
- Test: `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`,
  `src/lab/sdf-zombie/webgpu/crowd-records.test.ts`
- Notes: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 3 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 3"
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  If `MISSING` prints, stop: `BLOCKED: Task 3 is not in this branch`.

- [ ] **Step 1: The applyMaterial pin.** Append at the end of
  `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`:

```ts

describe('body grain plumbing (palette -> meltCfg.w -> record -> gInstMelt.w)', () => {
  it('applyMaterial writes the palette grain into meltCfg.w and syncs the record', async () => {
    const gpu = (await import('../../../../zombie-gpu?raw')).default;
    const start = gpu.indexOf('applyMaterial(m, light) {');
    expect(start).toBeGreaterThan(-1);
    const apply = gpu.slice(start, gpu.indexOf('dispose() {', start));
    expect(apply).toContain('u.meltCfg.value.w = m.grain;');
    expect(apply).toContain('syncRecord();');
  });
});
```

- [ ] **Step 2: The record pin.** In `src/lab/sdf-zombie/webgpu/crowd-records.test.ts`, the file ends with these lines:

```ts
      expect(Array.from(r.floats.slice(o, o + 4))).toEqual([-1, -1, -1, -1]);
    });
  });
});
```

  Insert the block below between the last two lines: after `  });` and before the final `});`, inside the outer
  `describe`.

```ts
  // Body grain (body-grain.ts): the palette's grain rides meltCfg.w, which the record copies whole, so a
  // crowd body wears its own value through the shared per-type material.
  it('carries meltCfg.w (the body grain) in REC_MELT.w', () => {
    const r = createCrowdRecords(2);
    r.write(1, {
      counts: [0, 0, 0, 0], counts2: [0, 0, 0, 0], woundBound: [0, 0, 0, 1e9],
      bodyAnchor: [0, 0, 0], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0.1], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0, 0, 0], bodyYaw: 0, headCentre: [0, 0, 0], woundCount: 0,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 0, 0], variantSeed: 0, bodyHalf: [0, 0, 0], damageRevision: 0, gore: 0,
      burn: 0, burnSec: 0, charAmount: 0,
    });
    expect(r.floats[1 * REC_VEC4S * 4 + REC_MELT * 4 + 3]).toBeCloseTo(0.1, 6);
  });
```

- [ ] **Step 3: Run and confirm only the applyMaterial pin fails**

  Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts src/lab/sdf-zombie/webgpu/crowd-records.test.ts`

  Expected: `Tests  1 failed | 17 passed (18)`. The failure is `applyMaterial writes the palette grain…`, expecting
  `u.meltCfg.value.w = m.grain;`.
  - The record test passes at once. That is correct: it pins existing record behaviour that the grain now relies on.
  - If anything else fails, stop: `BLOCKED: unexpected failure before the change`.

- [ ] **Step 4: Write the lane in `applyMaterial`.** In `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, replace:

```ts
      u.marchCfg.value.z = m.silhouetteNoiseAmp;
      u.lightDir.value.set(...light.keyDir);
```

  with:

```ts
      u.marchCfg.value.z = m.silhouetteNoiseAmp;
      // BODY GRAIN (body-grain.ts): the palette's grain rides meltCfg.w, the per-INSTANCE record lane
      // (writeViewRecord copies meltCfg whole), so a crowd body wears its own palette's grain through the
      // shared per-type material. 0, every preset, skips the shader block. Written unconditionally so a
      // lab character switch to a body without grain clears it.
      u.meltCfg.value.w = m.grain;
      u.lightDir.value.set(...light.keyDir);
```

  and replace:

```ts
      u.bounceCfg.value.w = light.chromaGain;
    },
    dispose() {
```

  with:

```ts
      u.bounceCfg.value.w = light.chromaGain;
      // meltCfg.w is per instance (above): push it into the record now rather than waiting for the next
      // setter that happens to sync.
      syncRecord();
    },
    dispose() {
```

- [ ] **Step 5: Update the three comments that list `meltCfg`'s lanes.** These are TS comments only; no shader text
  changes.
  - In `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, replace the line
    `     *  (skin-detail-proto.ts, setSkinDetail), w spare. x drives the` with these two lines:

```ts
     *  (skin-detail-proto.ts, setSkinDetail), w body grain (FleshMaterial.grain,
     *  written by applyMaterial; body-grain.ts). x drives the
```

  - In `src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts`, replace the line
    `//              detail k (skin-detail-proto.ts), w spare.` with these three lines:

```ts
//              detail k (skin-detail-proto.ts), w body grain (palette
//              grain, body-grain.ts). meltCfg is not a parameter: it rides
//              the per-instance record (REC_MELT) and reads as gInstMelt.
```

  - In `src/lab/sdf-zombie/webgpu/crowd-records.ts`, replace the line
    `export const REC_MELT = 5;          // meltCfg` with:

```ts
export const REC_MELT = 5;          // meltCfg: x melt, y motion-out, z skin detail k, w body grain
```

  Check: `grep -c 'w spare\. x drives the' src/lab/sdf-zombie/webgpu/zombie-gpu.ts` prints `0`, and
  `grep -c 'w body grain' src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts src/lab/sdf-zombie/webgpu/crowd-records.ts`
  prints `1` for each file.

- [ ] **Step 6: The lab slider.** In `src/lab/sdf-zombie/panel.ts`, replace:

```ts
  { key: 'wetness', min: 0, max: 2 },
];
```

  with:

```ts
  { key: 'wetness', min: 0, max: 2 },
  // Body grain (body-grain.ts): the face sheet's units, so 0.085-0.10 matches the authored sheets; 0.3 is
  // a +-65% swing, headroom for the owner's look. "save skin -> repo" saves it with the rest.
  { key: 'grain', min: 0, max: 0.3 },
];
```

- [ ] **Step 7: Run the pins, the palette-save tests and the golden**

  Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts src/lab/sdf-zombie/webgpu/crowd-records.test.ts src/lab/dev-save.test.ts src/lab/sdf-zombie/webgpu/march/march-golden.test.ts`

  Expected: `Tests  31 passed (31)`: 11 + 7 + 11 + 2.
  - **If `march-golden` fails:** an edit landed inside a WGSL string. The `params.wgsl.ts` edit must sit in the `//`
    comment block ABOVE `export const MARCH_BODY_PARAMS`. Undo that edit, redo it in the right place, and rerun.
  - **Any other failure:** stop with `BLOCKED: <test name>`.

- [ ] **Step 8: Type-check.** `npx tsc --noEmit 2>&1 | grep 'error TS'`. Expected: only the pre-existing
  `pack-golden.test.ts` line.

- [ ] **Step 9: Progress line.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 4 done: applyMaterial writes grain to meltCfg.w and syncs the record; lane comments updated; lab slider (0..0.3).
```

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/crowd-records.ts \
  src/lab/sdf-zombie/webgpu/march/body/params.wgsl.ts src/lab/sdf-zombie/panel.ts \
  src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/crowd-records.test.ts docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "feat(grain): palette grain reaches the march through meltCfg.w (per-instance record); lab slider" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Splice the block after the face layer, re-pin the march golden, GPU compile smoke

**Context:**
- The face layer (`webgpu/march/body/face.wgsl.ts`) must leave the face sheet's own coverage, `faceSheetCover`, for
  the grain block. Then the block is spliced into `MARCH_TRACE_POST` (`webgpu/march/body/trace.wgsl.ts`) between the
  face layer and gore.
- `march-golden.test.ts` hashes every shader string. This deliberate change moves exactly five keys, and they are
  re-pinned with `-u` after their diff is read. Deliberate shader features re-pin this golden; the commits `6eeabf16`
  and `46c43d61` did the same.
- Finally, one lab frame proves the shader compiles on the GPU.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march/body/face.wgsl.ts`, `src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/march/body/face.wgsl.test.ts`,
  `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`
- Snapshot: `src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap`
- Notes: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 4 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 4"
grep -c 'u.meltCfg.value.w = m.grain;' src/lab/sdf-zombie/webgpu/zombie-gpu.ts
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  Expected: the Task 4 line, then `1`. If `MISSING` or `0` prints, stop: `BLOCKED: Task 4 is not in this branch`.

- [ ] **Step 1: The face-coverage pins.** Append at the end of `src/lab/sdf-zombie/webgpu/march/body/face.wgsl.test.ts`:

```ts

describe("the face sheet's own coverage, for the body grain (body-grain.ts)", () => {
  const FACE = MARCH_BODY.slice(
    MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'),
    MARCH_BODY.indexOf('// PER-PRIMITIVE COLOUR'),
  );
  it('declares faceSheetCover before the face branch, so it is 0 wherever no sheet is drawn', () => {
    const decl = MARCH_BODY.indexOf('var faceSheetCover = 0.0;');
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(MARCH_BODY.indexOf('if (faceCfg.x > 0.5) {'));
  });
  it('sets it to facing x alpha only where the sheet is actually sampled', () => {
    const set = FACE.indexOf('faceSheetCover = facing * tex.a;');
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(FACE.indexOf('let tex = texel(faceTex, base);'));
  });
});
```

- [ ] **Step 2: The chain pins.** In `src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`, add
  these imports directly below the existing `import { … } from '../../../../../body-grain';` statement:

```ts
import {
  MARCH_BODY, REFINE_BODY, MARCH_TRACE_POST, MARCH_TRACE_LOOP, MARCH_TRACE_SETUP,
  MAP_BODY, CALC_NORMAL, CONE_MARCH, DEPTH_PREPASS_MARCH, WOUND_SHADOW,
} from '../../../../march.wgsl';
import { MARCH_SURFACE } from '../../../../deferred-sdf';
```

  and append at the end of the file:

```ts

describe('body grain in the post-hit chain', () => {
  const entries: Record<string, string> = { MARCH_BODY, REFINE_BODY, MARCH_SURFACE };

  it('is spliced once into the shared post-hit section, so all three entries run it', () => {
    expect(MARCH_TRACE_POST.split(BODY_GRAIN_BLOCK)).toHaveLength(2);
    for (const [name, src] of Object.entries(entries)) expect(src.split(BODY_GRAIN_BLOCK), name).toHaveLength(2);
  });

  it('runs after the face layer leaves its coverage (and after the micro-detail and mottle), before gore and paint', () => {
    for (const src of Object.values(entries)) {
      const grain = at(src, 'let grainAmt = gInstMelt.w;');
      expect(at(src, 'faceSheetCover = facing * tex.a;')).toBeLessThan(grain);
      expect(at(src, 'mix(albedo, mottleColor')).toBeLessThan(grain);
      expect(at(src, 'let detailAmp = surfCfg2.y')).toBeLessThan(grain);
      expect(grain).toBeLessThan(at(src, 'let goreStrength = max(lodCfg.w, gInstGore)'));
      expect(grain).toBeLessThan(at(src, 'if (painted > 0.0) {'));
    }
  });

  it('stays out of the walk, the field and the pre-passes', () => {
    for (const src of [MARCH_TRACE_SETUP, MARCH_TRACE_LOOP, MAP_BODY, CALC_NORMAL, CONE_MARCH, DEPTH_PREPASS_MARCH, WOUND_SHADOW])
      expect(src).not.toContain('grainAmt');
  });
});
```

- [ ] **Step 3: Run and confirm the new pins fail**

  Run: `npx vitest run src/lab/sdf-zombie/webgpu/march/body/face.wgsl.test.ts src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts`

  Expected: `Tests  4 failed | 22 passed (26)`. The four failures are:
  - the two face-coverage tests;
  - `is spliced once…`;
  - `runs after the face layer…`.

  If a different set fails, stop: `BLOCKED: unexpected failures before the splice`.

- [ ] **Step 4: The face layer leaves its coverage.** In `src/lab/sdf-zombie/webgpu/march/body/face.wgsl.ts`, replace:

```
  var faceCover = 0.0;

  // Face texture, before wounds and char so damage still paints over it.
```

  with:

```
  var faceCover = 0.0;
  // The face SHEET's own coverage: facing * alpha, set only where the sheet is
  // actually sampled (0 off the sheet, and on a head with no face). The body
  // grain runs after this layer and fades out by it, so the head is not
  // grained twice (body-grain.ts). faceCover above is the gore's protection
  // and also counts the whole head region, so it cannot stand in for this.
  var faceSheetCover = 0.0;

  // Face texture, before wounds and char so damage still paints over it.
```

  and replace:

```
      faceCover = faceCover * tex.a;
      let W = vec3<f32>(0.2126, 0.7152, 0.0722);
```

  with:

```
      faceCover = faceCover * tex.a;
      faceSheetCover = facing * tex.a;
      let W = vec3<f32>(0.2126, 0.7152, 0.0722);
```

- [ ] **Step 5: Splice.** In `src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts`:
  - After the line `import { MOTTLE_BLOCK } from './blocks/post/mottle.wgsl';`, add:

```ts
import { BODY_GRAIN_BLOCK } from './blocks/post/body-grain.wgsl';
```

  - In `MARCH_TRACE_POST`, replace:

```
${FACE_LAYER_WGSL}

${GORE_BLOCK}
```

  with:

```
${FACE_LAYER_WGSL}

${BODY_GRAIN_BLOCK}

${GORE_BLOCK}
```

  - In the doc comment above `MARCH_TRACE_SETUP`, replace the line
    ` * wound/char masks, tissue ramp, organ/mottle/gore, the face pass, painted` with
    ` * wound/char masks, tissue ramp, organ/mottle/gore, the face pass, the body grain, painted`.

- [ ] **Step 6: Run everything that pins the march text**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/march/body/ src/lab/sdf-zombie/webgpu/march/march-golden.test.ts \
  src/lab/sdf-zombie/webgpu/march/fields/ src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts \
  src/lab/sdf-zombie/webgpu/baked-chunks.test.ts src/lab/sdf-zombie/torn-lips.test.ts \
  src/lab/sdf-zombie/gun-wet-lip.test.ts 2>&1 | tail -40
```

  Expected: everything passes except one test, `march-golden.test.ts > keeps every string export byte-identical`. Its
  diff shows exactly five keys moving: `FACE_LAYER_WGSL`, `MARCH_BODY`, `MARCH_BODY_TRACE`, `MARCH_TRACE_POST`,
  `REFINE_BODY`. If anything else fails, stop with `BLOCKED: <test name>`, quoting the failure. The likely causes, for
  the report:
  - an `entry.wgsl.test.ts` marker test means the block's text changed from Task 3;
  - a sixth golden key means an edit landed in another shader string.

- [ ] **Step 7: Re-pin the golden and check the diff**

```bash
npx vitest run -u src/lab/sdf-zombie/webgpu/march/march-golden.test.ts
git diff src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap \
  | grep '^[-+] ' | sed -E 's/^[-+] +//; s/:.*//' | sort | uniq -c
```

  Expected output, exactly these five lines (the count 2 is the old `-` line plus the new `+` line):

```
   2 "FACE_LAYER_WGSL"
   2 "MARCH_BODY"
   2 "MARCH_BODY_TRACE"
   2 "MARCH_TRACE_POST"
   2 "REFINE_BODY"
```

  If any other key appears, or a count is not 2, undo the re-pin with
  `git checkout -- src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap` and stop:
  `BLOCKED: golden moved on unexpected keys`, quoting the output.

- [ ] **Step 8: Type-check.** `npx tsc --noEmit 2>&1 | grep 'error TS'`. Expected: only the pre-existing
  `pack-golden.test.ts` line.

- [ ] **Step 9: GPU compile smoke** (one goblin frame; the block is compiled into every body even at grain 0)

```bash
mkdir -p .lab-tmp/grain
for p in 5371 9371; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo "BUSY $p"; done; echo ports-checked
LAB_TMP=.lab-tmp LAB_VITE_PORT=5371 LAB_CDP_PORT=9371 \
BLOB_PROBE='(()=>{const L=window.__sdfLab;return {k:L.uniforms.aaCfg.value.x,grain:L.uniforms.meltCfg.value.w};})()' \
npm run blob:shot -- goblin .lab-tmp/grain/smoke 1 2>&1 | tee .lab-tmp/grain/smoke.log
grep -E '^probe: |console errors|FAIL|^frames:' .lab-tmp/grain/smoke.log
```

  Expected:
  - `probe: {"k":0.00203…,"grain":0}`. The goblin's palette sets grain only in Task 6.
  - `frames: .lab-tmp/grain/smoke/index.html`.
  - No `FAIL` and no `console errors` line. The turntable fails on any console error, and a WGSL pipeline error is one.

  If it fails, stop: `BLOCKED: GPU compile failed`, and quote the 30 lines of `.lab-tmp/grain/smoke.log` around the
  error. It names the WGSL line.

- [ ] **Step 10: Notes.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 5 done: BODY_GRAIN_BLOCK spliced between the face layer and gore in MARCH_TRACE_POST (marchBody, refineBody,
  marchSurface); the face layer leaves faceSheetCover = facing * tex.a; march golden re-pinned on exactly
  FACE_LAYER_WGSL, MARCH_BODY, MARCH_BODY_TRACE, MARCH_TRACE_POST, REFINE_BODY; GPU compile smoke passed (goblin, grain 0).
```

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march/body/face.wgsl.ts src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts \
  src/lab/sdf-zombie/webgpu/march/body/face.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts \
  src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap \
  docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "feat(grain): splice the body grain after the face layer; re-pin the march golden" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The goblin wears it (`grain 0.10`)

**Context:** The goblin's face sheet uses `grain 0.10`. Its palette now sets the body grain to the same value, in the
same units. `surfaceNoiseAmp` stays at the 2026-10-01 preview's 0.22; the owner decides at the gate.

**Files:**
- Modify: `src/lab/sdf-zombie/characters/goblin.blob` (the last two lines of the file)
- Test: `src/lab/sdf-zombie/characters/goblin-blob.test.ts`
- Notes: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 5 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 5"
tail -2 src/lab/sdf-zombie/characters/goblin.blob
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  Expected: the Task 5 line, then:

```
  # is the proper version (planned).
  surfaceNoiseAmp 0.22
```

  If `MISSING` prints or the two lines differ, stop: `BLOCKED: goblin.blob not at the expected state`.

- [ ] **Step 1: The test.** In `src/lab/sdf-zombie/characters/goblin-blob.test.ts`, find:

```ts
    // And the mottle is actually on, since it is off in every stock preset.
    expect(m.mottleAmp).toBeGreaterThan(0);
  });
```

  Directly after it, add:

```ts

  // Body grain (docs/superpowers/specs/2026-10-02-body-grain-design.md): the face sheet's speckle on the
  // body. The palette's `grain` is in the sheet's own units, and the goblin sets one value in both, so face
  // and body carry one contrast.
  it('grains its body like its face sheet', () => {
    const m = compilePalette(doc)!;
    expect(m.grain).toBeGreaterThan(0);
    expect(m.grain).toBe(compileSheet(doc)!.grain);
  });
```

- [ ] **Step 2: Run and confirm only the new test fails**

  Run: `npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts`
  Expected: `Tests  1 failed | 16 passed (17)`, the failure reading `expected 0 to be greater than 0`.

- [ ] **Step 3: The palette.** In `src/lab/sdf-zombie/characters/goblin.blob`, replace the last two lines of the file:

```
  # is the proper version (planned).
  surfaceNoiseAmp 0.22
```

  with:

```
  # is the proper version, below. Whether this stays at 0.22 or goes back
  # toward 0.06 now that the grain carries the texture is the owner's call at
  # the grain gate (docs/superpowers/plans/2026-10-02-body-grain.md, Task 10).
  surfaceNoiseAmp 0.22
  # BODY GRAIN (body-grain.ts; spec docs/superpowers/specs/2026-10-02-body-grain-design.md):
  # the face sheet's speckle on the rest of the body, in two octaves. Same
  # units as the sheet block's `grain`, and the same value, so face and body
  # carry one contrast: hard-edged rest-space cells, face-sized (3.5 mm) up
  # close and 1.2 cm farther out, each an albedo multiply of up to +-22% and a
  # bump matched to the face's relief. It fades out where the face sheet
  # covers the head; each octave fades as its cells drop below ~1.5 SDF pixels
  # (in the lab turntable the coarse octave is full out to ~1.5 m and gone by
  # ~3 m).
  grain         0.10
```

- [ ] **Step 4: Run what reads the goblin's palette**

```bash
npx vitest run src/lab/sdf-zombie/characters/goblin-blob.test.ts src/lab/sdf-zombie/webgpu/goblin-skin.test.ts \
  src/lab/sdf-zombie/webgpu/game-arms.test.ts src/lab/sdf-zombie/blob-emit.test.ts \
  src/lab/sdf-zombie/character-registry.test.ts src/lab/sdf-zombie/pack-golden.test.ts src/lab/dev-save.test.ts
```

  Expected: every file passes. `pack-golden` hashes packed prims and must not move. If anything fails, stop:
  `BLOCKED: <test name>`, quoting it.

- [ ] **Step 5: Type-check.** `npx tsc --noEmit 2>&1 | grep 'error TS'`. Expected: only the pre-existing
  `pack-golden.test.ts` line.

- [ ] **Step 6: Progress line.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 6 done: goblin.blob palette sets grain 0.10 (= its sheet's grain); surfaceNoiseAmp left at 0.22 for the owner.
```

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/characters/goblin.blob src/lab/sdf-zombie/characters/goblin-blob.test.ts \
  docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "feat(goblin): body grain 0.10, the face sheet's value" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Lab proof: render-check, frames, and the speckle numbers

**Context:** The goblin now wears the two-octave grain. This task proves it on the GPU in the lab turntable, with the
goblin's kit (clothes) hidden.
- `blob:render-check` confirms the geometry still matches the CPU field.
- Frames are shot with grain on and off at the owner's usual framing (`BLOB_DIST=1.35`, where the coarse octave is at
  full strength) and in close-ups (`BLOB_DIST=0.45`, fine octave).
- A mask-based speckle number measures the difference.

The frames are for the owner, who judges them in Task 10. Here you record, you do not decide.

**Files:**
- Create: `docs/dev-notes/2026-10-02-body-grain/frames/` (eight PNGs)
- Modify: `docs/dev-notes/2026-10-02-body-grain/notes.md`
- Scratch, not committed: `.lab-tmp/grain/`

- [ ] **Step 0: Preconditions and ports**

```bash
grep -n '^- Task 6 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 6"
grep -n '^  grain         0.10' src/lab/sdf-zombie/characters/goblin.blob || echo "MISSING grain line"
for p in 5371 9371; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo "BUSY $p"; done; echo ports-checked
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  If `MISSING` prints, stop: `BLOCKED: Task 6 is not in this branch`. If `BUSY` prints, stop:
  `BLOCKED: port <p> busy`.

- [ ] **Step 1: Render-check**

  Run: `LAB_TMP=.lab-tmp LAB_VITE_PORT=5371 LAB_CDP_PORT=9371 npm run blob:render-check -- goblin; echo "exit $?"`

  Expected: `exit 0`.
  - `exit 1` (a hole) or `exit 2` (did not run): record it in Step 6, then stop with `GATE FAILED: render-check exit <n>`
    after committing the notes. The grain changes shading only, so a hole is not this work's; the owner must see it.

- [ ] **Step 2: Write the probes and the speckle script** (scratch files)

```bash
mkdir -p .lab-tmp/grain
cat > .lab-tmp/grain/probes.sh <<'EOF'
KIT='const L=window.__sdfLab;L.scene.children.forEach((c)=>{let s=0;c.traverse((o)=>{if(o.isSkinnedMesh)s++;});if(s>0)c.visible=false;});'
ON="(()=>{${KIT}return {grain:L.uniforms.meltCfg.value.w,noise:L.uniforms.surfCfg2.value.y,k:L.uniforms.aaCfg.value.x};})()"
OFF="(()=>{${KIT}L.uniforms.meltCfg.value.w=0;return {grain:L.uniforms.meltCfg.value.w,noise:L.uniforms.surfCfg2.value.y};})()"
N06="(()=>{${KIT}L.uniforms.surfCfg2.value.y=0.06;return {grain:L.uniforms.meltCfg.value.w,noise:L.uniforms.surfCfg2.value.y};})()"
export LAB_TMP=.lab-tmp LAB_VITE_PORT=5371 LAB_CDP_PORT=9371
EOF
cat > .lab-tmp/grain/speckle.mjs <<'EOF'
// usage: node .lab-tmp/grain/speckle.mjs <mask.png> <first.png> <other.png>...
// Mean luma, and "speckle" = mean |L(x+3,y) - L(x,y)| over body pixels at least 4 px inside the mask.
// Prints each frame's numbers and its ratio to the FIRST frame.
import { readFileSync } from 'node:fs';
import { decodePng } from '../../scripts/lib/demo-presented.mjs';
const [maskFile, ...files] = process.argv.slice(2);
const m = decodePng(readFileSync(maskFile));
if (m.ch !== 4) throw new Error(`${maskFile}: expected an RGBA mask`);
const on = (x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.data[(y * m.w + x) * 4 + 3] > 127;
const R = 4;
const inside = (x, y) => on(x - R, y) && on(x + 3 + R, y) && on(x, y - R) && on(x, y + R) && on(x + 3, y - R) && on(x + 3, y + R);
let first = null;
for (const file of files) {
  const p = decodePng(readFileSync(file));
  if (p.w !== m.w || p.h !== m.h) throw new Error(`${file}: ${p.w}x${p.h} does not match the mask ${m.w}x${m.h}`);
  const L = (x, y) => { const i = (y * p.w + x) * p.ch; return 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2]; };
  let n = 0, sum = 0, hf = 0;
  for (let y = 0; y < p.h; y++) for (let x = 0; x + 3 < p.w; x++) {
    if (!inside(x, y)) continue;
    sum += L(x, y); hf += Math.abs(L(x + 3, y) - L(x, y)); n++;
  }
  if (n < 1000) throw new Error(`${file}: only ${n} body pixels inside the mask`);
  const row = { file, pixels: n, mean: +(sum / n).toFixed(2), speckle: +(hf / n).toFixed(3) };
  if (!first) first = row;
  row.speckleRatio = +(row.speckle / first.speckle).toFixed(3);
  row.meanRatio = +(row.mean / first.mean).toFixed(3);
  console.log(JSON.stringify(row));
}
EOF
echo scratch-written
```

  How the probes work:
  - `KIT` hides the goblin's skinned kit.
  - `OFF` zeroes the grain lane for that run. The lab re-syncs the record every frame, so the change reaches the
    shader.
  - `N06` previews `surfaceNoiseAmp 0.06` for the owner's noise question.
  - `BLOB_MASK=1` also writes `mask-NN.png`, the body's silhouette, which the speckle script reads.

- [ ] **Step 3: Shoot the close-ups** (three runs, about a minute each; four yaws each: 0°, 90°, 180°, 270°, where 0°
  is the face)

```bash
. .lab-tmp/grain/probes.sh
BLOB_DIST=0.45 BLOB_TARGET_Y=0.85 BLOB_MASK=1 BLOB_PROBE="$OFF" npm run blob:shot -- goblin .lab-tmp/grain/torso-off 4 2>&1 | tee .lab-tmp/grain/torso-off.log
BLOB_DIST=0.45 BLOB_TARGET_Y=0.85 BLOB_PROBE="$ON" npm run blob:shot -- goblin .lab-tmp/grain/torso-on 4 2>&1 | tee .lab-tmp/grain/torso-on.log
BLOB_DIST=0.45 BLOB_TARGET_Y=0.85 BLOB_PROBE="$N06" npm run blob:shot -- goblin .lab-tmp/grain/torso-on-n06 4 2>&1 | tee .lab-tmp/grain/torso-on-n06.log
grep -h '^probe: ' .lab-tmp/grain/torso-off.log .lab-tmp/grain/torso-on.log .lab-tmp/grain/torso-on-n06.log
```

  Expected: the three probe lines, in order:
  - `{"grain":0,"noise":0.22}`
  - `{"grain":0.1,"noise":0.22,"k":0.00203…}`
  - `{"grain":0.1,"noise":0.06}`

  Each run ends with `frames: …/index.html`, and `torso-off` also wrote `mask-00.png`. If the `ON` probe prints
  `"grain":0`, stop: `GATE FAILED: palette grain did not reach meltCfg.w`. If a run fails, rerun it once; if it fails
  again, stop: `BLOCKED: blob:shot failed`, quoting its last 20 lines.

- [ ] **Step 4: Shoot the head close-up and the owner's framing** (three runs)

```bash
. .lab-tmp/grain/probes.sh
BLOB_DIST=0.45 BLOB_TARGET_Y=1.15 BLOB_PROBE="$ON" npm run blob:shot -- goblin .lab-tmp/grain/head-on 4 2>&1 | tee .lab-tmp/grain/head-on.log
BLOB_DIST=1.35 BLOB_MASK=1 BLOB_PROBE="$OFF" npm run blob:shot -- goblin .lab-tmp/grain/full-off 4 2>&1 | tee .lab-tmp/grain/full-off.log
BLOB_DIST=1.35 BLOB_PROBE="$ON" npm run blob:shot -- goblin .lab-tmp/grain/full-on 4 2>&1 | tee .lab-tmp/grain/full-on.log
grep -h '^probe: ' .lab-tmp/grain/head-on.log .lab-tmp/grain/full-off.log .lab-tmp/grain/full-on.log
```

  Expected: probes `{"grain":0.1,…}`, `{"grain":0,…}`, `{"grain":0.1,…}`, and every run ending with `frames: …`. The
  `BLOB_DIST=1.35` runs must NOT set `BLOB_TARGET_Y` at all: an empty value would aim at the floor.

- [ ] **Step 5: The speckle numbers**

```bash
node .lab-tmp/grain/speckle.mjs .lab-tmp/grain/torso-off/mask-00.png \
  .lab-tmp/grain/torso-off/frame-00.png .lab-tmp/grain/torso-on/frame-00.png .lab-tmp/grain/torso-on-n06/frame-00.png \
  | tee .lab-tmp/grain/speckle-torso.txt
node .lab-tmp/grain/speckle.mjs .lab-tmp/grain/full-off/mask-00.png \
  .lab-tmp/grain/full-off/frame-00.png .lab-tmp/grain/full-on/frame-00.png \
  | tee .lab-tmp/grain/speckle-full.txt
```

  Expected: three JSON rows, then two. The first row of each block has ratios of 1.

  Pass conditions:
  - `torso-on`: `speckleRatio ≥ 1.3` (fine octave, 2.3 px cells) and `meanRatio` between 0.95 and 1.05 (the multiply
    is mean-preserving).
  - `full-on`: `speckleRatio ≥ 1.15`. This is the coarse octave at full strength; the face's own grain is in both
    frames, so it dilutes the ratio.

  If either speckle threshold is missed, record the rows in Step 6, commit, and stop:
  `GATE FAILED: grain not visible (<rows>)`. Do not tune anything.

  If only the torso `meanRatio` is outside 0.95–1.05, it is not a stop. Write `MEAN SHIFT <meanRatio>` after the torso
  numbers in Step 6, so the owner sees it.

  If the script throws `only N body pixels`, the mask is missing or empty. Rerun the `-off` shot of that framing once.

- [ ] **Step 6: Look and record (no decisions).** Read these eight images:
  - `.lab-tmp/grain/{torso-off,torso-on,torso-on-n06,head-on}/frame-00.png`
  - `.lab-tmp/grain/{torso-on,head-on}/frame-01.png`
  - `.lab-tmp/grain/{full-off,full-on}/frame-00.png`

  Then append the section below at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`. Replace every
  `<…>`:
  - with the measured number;
  - for the four questions, with one plain sentence describing what you see.
  Write "unclear" if you cannot tell.

```markdown

## In the lab (Task 7)

Goblin, kit hidden, `npm run blob:shot`, 1380x820. Close-ups `BLOB_DIST=0.45` (torso `BLOB_TARGET_Y=0.85`, head `1.15`;
fine octave). Owner's framing `BLOB_DIST=1.35` (coarse octave at full strength). Off = `meltCfg.w` zeroed by the probe;
n06 = grain on with `surfaceNoiseAmp` 0.06.

- `blob:render-check -- goblin`: exit <n>.
- Speckle (mean |dL| 3 px apart inside the body mask), ratio to off:
  - torso: off <speckle>, on <speckle> (x<ratio>, mean x<meanRatio>), on + noise 0.06 <speckle> (x<ratio>)
  - 1.35 m: off <speckle>, on <speckle> (x<ratio>)
- Observed (for the owner, not a verdict):
  - Torso close-up, on vs off: <one sentence>
  - Head close-up (yaw 0 and 90), the face-to-neck crossing: <one sentence>
  - 1.35 m framing, on vs off: <one sentence>
  - Torso with surfaceNoiseAmp 0.06 vs 0.22: <one sentence>

![Torso, grain off](frames/torso-off-yaw000.png) ![Torso, grain on](frames/torso-on-yaw000.png)
![Torso, grain on, side](frames/torso-on-yaw090.png) ![Torso, grain on, surfaceNoiseAmp 0.06](frames/torso-on-n06-yaw000.png)
![Head, grain on](frames/head-on-yaw000.png) ![Head, grain on, side](frames/head-on-yaw090.png)
![1.35 m, grain off](frames/full-off-yaw000.png) ![1.35 m, grain on](frames/full-on-yaw000.png)

- Task 7 done: lab frames and speckle numbers recorded.
```

  If Step 1 or 5 failed, write the progress line as `- Task 7 done: GATE FAILED (<what>)` instead.

- [ ] **Step 7: Keep the frames**

```bash
D=docs/dev-notes/2026-10-02-body-grain/frames; mkdir -p $D
cp .lab-tmp/grain/torso-off/frame-00.png $D/torso-off-yaw000.png
cp .lab-tmp/grain/torso-on/frame-00.png $D/torso-on-yaw000.png
cp .lab-tmp/grain/torso-on/frame-01.png $D/torso-on-yaw090.png
cp .lab-tmp/grain/torso-on-n06/frame-00.png $D/torso-on-n06-yaw000.png
cp .lab-tmp/grain/head-on/frame-00.png $D/head-on-yaw000.png
cp .lab-tmp/grain/head-on/frame-01.png $D/head-on-yaw090.png
cp .lab-tmp/grain/full-off/frame-00.png $D/full-off-yaw000.png
cp .lab-tmp/grain/full-on/frame-00.png $D/full-on-yaw000.png
ls $D | wc -l
git status --short src/
```

  Expected: `8`, and `git status --short src/` prints nothing. If it prints anything, a source file changed in this
  task; stop: `BLOCKED: source modified during captures`.

- [ ] **Step 8: Commit**

```bash
git add docs/dev-notes/2026-10-02-body-grain
git commit -m "docs(grain): lab frames and speckle numbers for the two-octave body grain" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  If this task hit a `GATE FAILED` condition, end your run now with a report starting with that text.

### Task 8: Cost and the pixel gate (GPU ms, `march-hash`, cold boot)

**Context:** These three gates are the spec's "Cost" item, plus proof that every other character renders exactly as
before.
- **GPU time:** grain on against off, in the same session, at the octaves' cross-fade distance, where both are drawn
  (14 hashes per pixel, the worst case).
- **`march-hash`:** a soldier with grain 0 must be bit-identical to the base, which Task 0 recorded in the notes as
  `BASE` lines.
- **Cold boot:** against those same `BASE` lines.

Do not tune anything. Record, and stop on a failed gate.

**Files:**
- Modify: `docs/dev-notes/2026-10-02-body-grain/notes.md`
- Scratch, not committed: `.lab-tmp/grain/`

- [ ] **Step 0: Preconditions, a quiet machine, ports**

```bash
grep -n '^- Task 7 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 7"
grep '^- BASE ' docs/dev-notes/2026-10-02-body-grain/notes.md
uptime
for p in 5371 9371 5373 9373 5391 9391; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo "BUSY $p"; done; echo ports-checked
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  Expected:
  - the Task 7 line;
  - the `BASE` lines from Task 0 (commit, Chrome, load, k, sdf pass, march-hash room1, room1-wounded, boot drawOnce);
  - no `BUSY`.

  Stop conditions:
  - `MISSING`, or no `BASE` lines: `BLOCKED: Task 7 or Task 0's baselines are not in this branch`.
  - `BUSY`: `BLOCKED: port <p> busy`.
  - The Task 7 line contains `GATE FAILED`: stop with the same text.

  Record the load average. If the 1-minute load is above 6, wait a few minutes and check again once.

- [ ] **Step 1: GPU cost, grain on vs off, the cross-fade framing** (`BLOB_DIST=0.65`: torso at ~0.575 m, both octaves
  at ~0.5)

```bash
mkdir -p .lab-tmp/grain
cat > .lab-tmp/grain/bench.sh <<'EOF'
KIT='const L=window.__sdfLab;L.scene.children.forEach((c)=>{let s=0;c.traverse((o)=>{if(o.isSkinnedMesh)s++;});if(s>0)c.visible=false;});'
BENCH="(async()=>{${KIT}const sl=(ms)=>new Promise((r)=>setTimeout(r,ms));L.setAdaptive(false);L.setMotionEnabled(false);L.setWander(false);L.focusBody();L.setCam(0,0.12,0.65,0.85);await sl(4000);const g=L.uniforms.meltCfg.value.w;const out=[];for(const w of [g,0,g,0,g,0]){L.uniforms.meltCfg.value.w=w;await sl(300);const r=await L.benchGpu();out.push({w,median:r.median,p95:r.p95,hidden:r.hiddenSteps});}L.uniforms.meltCfg.value.w=g;return {k:L.uniforms.aaCfg.value.x,out};})()"
export LAB_TMP=.lab-tmp LAB_VITE_PORT=5371 LAB_CDP_PORT=9371
EOF
. .lab-tmp/grain/bench.sh
BLOB_PROBE="$BENCH" npm run blob:shot -- goblin .lab-tmp/grain/bench 1 2>&1 | tee .lab-tmp/grain/bench.log
node -e '
const line = require("fs").readFileSync(".lab-tmp/grain/bench.log", "utf8").split("\n").find((l) => l.startsWith("probe: "));
if (!line) { console.log("NO PROBE LINE"); process.exit(1); }
const r = JSON.parse(line.slice(7));
const on = r.out.filter((o) => o.w > 0).map((o) => o.median), off = r.out.filter((o) => o.w === 0).map((o) => o.median);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const delta = mean(on) - mean(off), noise = Math.max(...off) - Math.min(...off);
const hidden = r.out.reduce((s, o) => s + o.hidden, 0);
console.log(JSON.stringify({ k: r.k, on, off, delta: +delta.toFixed(3), noise: +noise.toFixed(3), hidden,
  pass: hidden === 0 && on.every((x) => x > 0) && delta <= Math.max(noise, 0.2) }));
' | tee .lab-tmp/grain/bench-result.json
```

  Expected: one JSON line with six medians (three on, three off), `hidden: 0` and `"pass":true`. Each benchGpu takes a
  few seconds; the whole run takes about two minutes.
  - **`hidden` above 0:** the page was not drawing. Rerun once with `BLOB_HEADED=1` in front of the `npm run` command.
  - **`"pass":false` with `hidden` 0:** run Step 1 once more. If it fails again, record both lines in Step 4 and stop
    with `GATE FAILED: grain costs <delta> ms (noise <noise> ms)`.

- [ ] **Step 2: The pixel gate (`march-hash`, room 1)**

```bash
defaults read '/Applications/Google Chrome.app/Contents/Info.plist' CFBundleShortVersionString 2>/dev/null || echo unknown
LAB_TMP=.lab-tmp LAB_VITE_PORT=5373 LAB_CDP_PORT=9373 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs' 2>&1 \
  | tee .lab-tmp/grain/march-hash-head.log
BASE=$(grep '^- BASE march-hash room1:' docs/dev-notes/2026-10-02-body-grain/notes.md | sed 's/^.*: //')
HEADLINE=$(grep '^{"room1"' .lab-tmp/grain/march-hash-head.log | tail -1)
HEAD=$(printf '%s' "$HEADLINE" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.parse(s).room1))')
[ "$BASE" = "$HEAD" ] && echo "room1 MATCH $HEAD" || echo "room1 DIFFERS base=$BASE head=$HEAD"
```

  Expected: `room1 MATCH <hash>`. No character in room 1 sets grain, so the block is skipped and the pixels are
  bit-identical. A `room1 DIFFERS` line with an empty `head=` means march-hash printed no result: treat it as "no
  line" below.
  - **`room1 DIFFERS`:** compare the Chrome version printed above with the `BASE Chrome` line. Record both in Step 4,
    and stop with `GATE FAILED: march-hash room1 differs (Chrome base <v> head <v>)`. The controller re-checks the base;
    a Chrome update alone moves this hash.
  - **No `{"room1"` line:** rerun once. If still none, stop with `BLOCKED: march-hash did not run`.

- [ ] **Step 3: Cold boot, twice**

```bash
node scripts/boot-time.mjs 5391 9391 2>&1 | tee .lab-tmp/grain/boot-head-1.log
node scripts/boot-time.mjs 5391 9391 2>&1 | tee .lab-tmp/grain/boot-head-2.log
BASEBOOT=$(grep '^- BASE boot drawOnce:' docs/dev-notes/2026-10-02-body-grain/notes.md | sed 's/^.*: //')
HEADBOOT=$(grep -h '^{"drawOnce"' .lab-tmp/grain/boot-head-1.log .lab-tmp/grain/boot-head-2.log | node -e '
let s=""; process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(s.trim().split("\n").map((l)=>JSON.parse(l).drawOnce).join(" ")))')
BASEBOOT="$BASEBOOT" HEADBOOT="$HEADBOOT" node -e '
const b = process.env.BASEBOOT.trim().split(/\s+/).map(Number), h = process.env.HEADBOOT.trim().split(/\s+/).map(Number);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const ratio = mean(h) / mean(b);
console.log(JSON.stringify({ base: b, head: h, ratio: +ratio.toFixed(3), pass: h.length === 2 && ratio <= 1.10 }));
' | tee .lab-tmp/grain/boot-result.json
```

  Expected: `"pass":true`, meaning the head's mean `drawOnce` is within 10% of the base's.
  - If a head line is missing, or `warmMs` is over 30000 (a Vite pre-bundle), rerun that run.
  - If `"pass":false`, run both head runs once more. If it still fails, record it and stop with
    `GATE FAILED: cold boot ratio <ratio>`.

- [ ] **Step 4: Notes.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`. Fill each `<…>` from the
  JSON lines above:

```markdown

## Cost and the pixel gate (Task 8)

- Load at start: <uptime load averages>.
- GPU, lab, `BLOB_DIST=0.65` (both octaves drawn, 14 hashes per pixel), `benchGpu` alternating on/off x3:
  on <a> / <b> / <c> ms, off <d> / <e> / <f> ms; delta <delta> ms, noise <noise> ms, hidden <hidden> -> <PASS|FAIL>.
- `march-hash` room 1 (Chrome <version>): <MATCH|DIFFERS> (base <hash>, head <hash>).
- Cold boot `drawOnce`: base <x> / <y> ms, head <x> / <y> ms, ratio <ratio> -> <PASS|FAIL>.
- Task 8 done: <all gates pass | GATE FAILED (<which>)>.
```

- [ ] **Step 5: Commit**

```bash
git add docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "docs(grain): cost, pixel gate and cold boot for the body grain" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  If any gate failed, end your run now with a report starting `GATE FAILED: …`.

### Task 9: The directory suite

**Context:** This is the whole `src/lab/sdf-zombie/` suite, run once at the end. It is the only time this plan runs
more than targeted tests. The suite has run this 24 GB machine out of memory before, so it runs with capped workers
and memory.

**Files:**
- Modify: `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 8 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 8"
uptime
sed -n '/^## Rules for every task/,/^## Where each octave shows/p' docs/superpowers/plans/2026-10-02-body-grain.md
```

  If `MISSING` prints, or the Task 8 line contains `GATE FAILED`, stop: `BLOCKED: Task 8 not passed`. If the 1-minute
  load is above 8, wait five minutes and check once more; if it is still above 8, stop with `BLOCKED: machine busy`.

- [ ] **Step 1: Run the suite** (about 5–10 minutes)

```bash
NODE_OPTIONS=--max-old-space-size=6144 npx vitest run src/lab/sdf-zombie/ --maxWorkers=2 --minWorkers=1 2>&1 \
  | tee .lab-tmp/grain/suite.log | tail -25
```

  Expected: `Test Files  <n> passed (<n>)` and `Tests  <m> passed (<m>)`. On 2026-10-01 that was 461 files and 6604
  tests; this plan adds 2 files and about 30 tests.
  - **Failing tests:** list each failing file and test name from `.lab-tmp/grain/suite.log`.
    - If every failure is in a file this plan touched, stop: `GATE FAILED: suite (<names>)`.
    - Otherwise, record them as "outside this plan; not checked against the base" and continue. The controller decides.
  - **Killed or out of memory:** stop with `BLOCKED: suite did not finish`.

- [ ] **Step 2: Notes.** Append at the end of `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown
- Task 9 done: directory suite <files> files, <tests> tests, <all pass | failures: <list>>.
```

- [ ] **Step 3: Commit**

```bash
git add docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "docs(grain): directory suite result" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Task board, docs, and the owner's gate

**Context:** Task 9 finished the build and its proof. This task:
- updates the task board (`docs/tasks/characters.md`, `TASKS.md`);
- updates the character-authoring reference (`.claude/skills/authoring-sdf-characters/reference.md`);
- writes the owner's gate questions into the notes, so the controller can relay them with the frames.

It changes no source.

**Files:**
- Modify: `docs/tasks/characters.md`, `TASKS.md`, `.claude/skills/authoring-sdf-characters/reference.md`,
  `docs/dev-notes/2026-10-02-body-grain/notes.md`

- [ ] **Step 0: Preconditions**

```bash
grep -n '^- Task 9 done' docs/dev-notes/2026-10-02-body-grain/notes.md || echo "MISSING Task 9"
grep -c '  accepted as is\.' docs/tasks/characters.md
grep -c 'phase 1 (body) done (owner-approved 2026-10-01); next armour,' TASKS.md
grep -c '  ON the creature rather than variation IN it\.' .claude/skills/authoring-sdf-characters/reference.md
```

  Expected: the Task 9 line, then `1`, `1`, `1`. If `MISSING` prints or any count is not `1`, stop:
  `BLOCKED: docs not at the expected state`.

- [ ] **Step 1: The task board.** In `docs/tasks/characters.md`, find the line `  accepted as is.`. It ends the
  "Phase 1, body" bullet. Directly after it, add:

```markdown
- [~] **Body grain** (owner, 2026-10-01: "apply the noise texture that is on his face to his body"):
  [spec](../superpowers/specs/2026-10-02-body-grain-design.md), [plan](../superpowers/plans/2026-10-02-body-grain.md).
  A palette `grain` in the face sheet's units, in two octaves: face-sized 3.5 mm cells up close, 1.2 cm cells farther
  out, each an albedo multiply and a bump in rest space; the goblin sets `grain 0.10`. **Awaiting the owner's look**
  ([frames and numbers](../dev-notes/2026-10-02-body-grain/notes.md)).
```

- [ ] **Step 2: The front page.** In `TASKS.md`, replace the text
  `phase 1 (body) done (owner-approved 2026-10-01); next armour,` with
  `phase 1 (body) done (owner-approved 2026-10-01); body grain (the face's texture on the body, two octaves) built, awaiting the owner's look ([spec](docs/superpowers/specs/2026-10-02-body-grain-design.md)); next armour,`.

- [ ] **Step 3: The authoring reference.** In `.claude/skills/authoring-sdf-characters/reference.md`, find the line
  `  ON the creature rather than variation IN it.`. Directly after it, add:

```markdown
- **`grain` puts the face sheet's speckle on the body** (`body-grain.ts`), in two octaves of hard-edged rest-space
  cells: face-sized (3.5 mm) up close, 1.2 cm farther out, each an albedo multiply plus a bump. It is in the sheet's
  own units, so setting the sheet's `grain` and the palette's `grain` to one value gives one contrast on face and body
  (the goblin: 0.10 in both). 0 (every preset) is off. Each octave fades as its cells drop below ~1.5 SDF pixels; in
  the lab turntable the coarse octave is full out to ~1.5 m and gone by ~3 m.
```

- [ ] **Step 4: The owner's gate, in the notes.** Append at the end of
  `docs/dev-notes/2026-10-02-body-grain/notes.md`:

```markdown

## Owner gate (Task 10)

The frames above (kit hidden) and the numbers in Tasks 7–8. Questions for the owner:

1. **Up close, does the body read like the face?** `torso-off` vs `torso-on`, and `head-on` for the face-to-neck
   crossing (fine octave, 3.5 mm cells).
2. **At your usual 1.35 m framing:** `full-off` vs `full-on`. The coarse octave (1.2 cm cells, about 2.3 SDF px) is at
   full strength there. Does it read as the same grain?
3. **How far it reaches.** With `GRAIN_CELL_COARSE = 0.012` the lab is full to 1.48 m, half at 1.97 m, and gone
   beyond 2.96 m. The game estimate is about 1.6 / 2.2 / 3.25 m. To be textured at 3–4 m, the options are:
   - `0.016`: lab 1.97 / 2.63 / 3.94 m, with chunkier 3.1 px cells at 1.35 m. One constant in `body-grain.ts`.
   - A third octave at about 0.04 m: plus 7 hashes, drawn only in its own band.

   Keep 0.012, or which?
4. **`surfaceNoiseAmp`:** keep the 2026-10-01 preview's 0.22, or go back toward 0.06 now that the grain carries the
   texture? Compare `torso-on` with `torso-on-n06`.
5. **Two optional fades** (beyond the spec): the grain is off on painted (`color=`) prims and inside wounds. Keep them?
6. **Motion:** stills cannot show crawl. To look live, run `npx vite`, open `/sdf-lab-webgpu.html?character=goblin`,
   and use the material panel's `grain` slider; "save skin → repo" writes it.

Each answer becomes an edit with a number behind it:
- the coarse cell is `GRAIN_CELL_COARSE` in `body-grain.ts` (the tests read the constant);
- the noise is `surfaceNoiseAmp` in `goblin.blob`, with its comment rewritten to the owner's verdict;
- the fades are `grainMask` in `body-grain.ts` and the `grainMask` line in `body-grain.wgsl.ts`, with their tests.

Re-shoot only the frames an edit affects.

- Task 10 done: task board, reference and gate questions written; awaiting the owner.
```

- [ ] **Step 5: Commit**

```bash
git add docs/tasks/characters.md TASKS.md .claude/skills/authoring-sdf-characters/reference.md \
  docs/dev-notes/2026-10-02-body-grain/notes.md
git commit -m "docs(grain): body grain built, awaiting the owner's look" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

  End your run with a report that lists:
  - the frame paths under `docs/dev-notes/2026-10-02-body-grain/frames/`;
  - the speckle ratios;
  - the GPU delta;
  - the `march-hash` and boot results;
  - the six gate questions.
