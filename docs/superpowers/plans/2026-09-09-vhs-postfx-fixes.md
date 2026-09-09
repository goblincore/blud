# VHS post-FX fixes and wiring

**Goal:** Fix the eight correctness/fit defects the 2026-09-09 review found in
`src/lab/sdf-zombie/webgpu/post-vhs.ts` BEFORE it is wired, then wire it into
`post-aa.ts`'s chain behind a default-OFF seam so the all-off parity gate is
untouched.
**Architecture:** `post-vhs.ts` is a WGSL source string + preset data + one pure
helper, consumed by `post-aa.ts` as a fourth chain stage (CAPTURE → FXAA → VHS →
BLIT, VHS replacing SMEAR while on). Spec:
`docs/superpowers/specs/2026-09-09-vhs-post-fx-design.md`.
**Tech Stack:** TypeScript, three.js WebGPU (TSL `wgslFn`), vitest.

### Task 1: post-vhs.ts correctness + fit fixes, with a parse contract

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/post-vhs.ts`
- Modify: `src/lab/sdf-zombie/webgpu/post-vhs.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/post-vhs.wgsl.test.ts`

Steps — each is a small, separately-testable change. Keep the main `fn postVhs(`
FIRST in the string (three anchors its declaration parse at `^`).

- [ ] **Time wrap.** `postVhsHash21` does `fract(p*345.45)`; with `floor(time*60)`
  feeding it, at t≈600 s the product reaches ~1.2e7 where f32 ulp is 1, so
  `fract` → 0 and the hash is 0 forever (row noise becomes constant darkening,
  bursts never fire, jitter pins). At the top of `postVhs` add
  `let t = time - 600.0 * floor(time / 600.0);` and use `t` everywhere `time`
  was used (including the helper calls). Document in the port notes that
  `time` is SECONDS (`performance.now()/1000`), not ms.
- [ ] **Entry Y-flip.** Every target-bound pass in `post-aa.ts` samples
  `(x, 1-y)` so all targets keep capture orientation (see `post-aa.ts:52-63`).
  `postVhs` samples `uv` raw. Add `let tc = vec2<f32>(uv.x, 1.0 - uv.y);` and
  use `tc` for EVERY sample (base, prev, both chroma taps, the blur) and for the
  row index in the noise/jitter hashes.
- [ ] **Display/working-space flag.** Add a parameter `isDisplay: f32` after
  `hasPrev`. When `isDisplay < 0.5` apply the OETF to each tap before grading
  (copy `postAaOetf` from `post-aa.ts` as `postVhsOetf`). The pass then always
  grades display-encoded values like the Phaser source did, and BLIT after it
  must be told `srcIsDisplay = 1`.
- [ ] **Resolution from the texture.** Delete the `resolution` parameter; derive
  `let resolution = vec2<f32>(textureDimensions(tex, 0));` at the top. A stale
  uniform after `refit()` silently changes texel size and warp amplitude.
- [ ] **Jitter hash rows.** Replace the hard-coded `512.0` in the jitter hash with
  `resolution.y`.
- [ ] **Horizontal blur.** Replace `postVhsBlur9` (3x3, 10 taps; the vertical taps
  erase the interlace comb the field renderer produces upstream) with a
  horizontal 3-tap 1-2-1 blur, passing the already-fetched centre texel in so
  it is not fetched again. `blurAmount` keeps its meaning (mix toward blurred).
- [ ] **Alpha.** Return alpha `1.0`, matching the blend/blit siblings, instead of
  the capture's alpha.
- [ ] **`prevTex` gate.** Only sample `prevTex` inside `if (hasPrev > 0.5)`.
- [ ] **Tests, `post-vhs.test.ts`:** pin the `balanced` and `chaotic` rows exactly
  (the `soft` row already is); assert every `VhsTerms` key appears as a
  PARAMETER of `fn postVhs(` (parse the parameter list between `fn postVhs(`
  and `) ->`, do not just `toContain` the name); assert the string contains
  `textureDimensions(tex, 0)` and does NOT declare a `resolution:` parameter;
  assert the time wrap line is present; assert no `textureSample(` of `prevTex`
  appears outside the `hasPrev` branch (a simple ordering check on indices is
  enough).
- [ ] **Parse contract, `post-vhs.wgsl.test.ts`:** follow
  `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (it imports
  `WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js'`).
  `new WGSLNodeFunction(POST_VHS_WGSL)` must parse; pin `inputs.length` to the
  new count and pin the ordered parameter NAMES so a future reorder is caught.
- [ ] Run `npx vitest run src/lab/sdf-zombie/webgpu/post-vhs` and
  `npx tsc --noEmit -p .`; paste output.

### Task 2: wire VHS into the post-aa chain, default OFF

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.ts`
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (seams only)

Read the spec's "chain" section and `post-aa.ts` lines 40-70 (ALL-OFF PARITY)
and 540-620 (the frame walk) before editing.

- [ ] Add to the `PostAa` interface and object: `setVhs(preset: VhsPreset | null)`,
  `setVhsTerm(name: keyof VhsTerms, value: number)`, `readonly vhs`,
  `readonly effectiveSmear`. Default preset is `null` (OFF).
- [ ] Build the VHS material once with `wgslFn(POST_VHS_WGSL)`: texture nodes for
  the source and for the previous INPUT, a `uniform()` per term, `uTime`
  (seconds), `uHasPrev`, `uIsDisplay`. Follow how the existing smear pass builds
  its `MeshBasicNodeMaterial` + quad.
- [ ] **Previous-INPUT history, not previous output.** The motion gate compares the
  current frame against `prevTex`; if `prevTex` were the pass's own output, the
  previous frame's chroma split alone exceeds `motionThreshold` near every edge
  and the gate latches on. Allocate a dedicated ping-pong pair for the VHS
  INPUT (same size/format as the smear history: content-size, HalfFloat,
  NearestFilter) and copy/render the FXAA output into it each frame VHS runs.
  Do not reuse `histA/histB`.
- [ ] Chain placement: when `vhs !== null`, run VHS after FXAA (or as the entry
  pass if FXAA is off, passing `uIsDisplay = srcIsDisplay ? 1 : 0`), SKIP the
  smear pass entirely, set `srcIsDisplay = true` for BLIT, and report
  `effectiveSmear = 0`. When `vhs === null` the frame walk must be BYTE-FOR-BYTE
  the code that exists today — the VHS material must not even be bound.
  `effectiveSmear` then equals the user's `smear` setting.
- [ ] `active` (the "any pass on" flag that decides whether the chain runs at all)
  must include `vhs !== null`.
- [ ] `refit()`/`setSize`: size the new pair with the other content-size targets.
- [ ] `dispose()`: dispose the pair and the material.
- [ ] `game-main.ts`: expose `setVhs` and `setVhsTerm` on `__sdfGame` next to the
  other post-aa seams (grep `setSmear` there), and accept `?vhs=soft|balanced|chaotic`
  from the URL for boot-time enable. Do not change the default.
- [ ] Tests in `post-aa.test.ts` (look at how the existing tests fake the renderer):
  preset `null` → `effectiveSmear === smear` and the VHS pass is never rendered;
  preset `'soft'` → `effectiveSmear === 0`, the smear pass is not rendered, the
  VHS pass is, and BLIT receives `srcIsDisplay = 1`; `setVhs(null)` after
  `'soft'` restores the previous smear setting exactly; `setVhsTerm` clamps to
  the source ranges the spec lists.
- [ ] Run `npx vitest run src/lab/sdf-zombie/webgpu/post-aa src/lab/sdf-zombie/webgpu/post-vhs`
  and `npx tsc --noEmit -p .`; paste output. You have no GPU: say so in the
  report and do NOT claim the picture is right.
