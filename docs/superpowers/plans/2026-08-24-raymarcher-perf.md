# Raymarcher Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. When executed via dispatch-ui, each dispatch task names the plan tasks it owns.

**Goal:** 30 fps (p95 ≤ 33 ms) at SDF scale ≥ 0.7 at the owner's full window, for both 4 close bodies and 12 mixed-range bodies.

**Architecture:** Four stages from `docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md` (read it FIRST — it holds the measured facts and the locked decisions): a dedicated bench page with per-pixel instrumentation; cheaper hit shading; per-tile primitive lists feeding one merged full-screen march; smooth LOD ramps plus a coverage-based headroom signal for the adaptive controller.

**Tech Stack:** TypeScript, Three.js WebGPU (TSL `wgslFn`), Vite, vitest. All shader work in `src/lab/sdf-zombie/webgpu/march.wgsl.ts`; packing in `src/lab/sdf-zombie/pack.ts`.

**Read before any task:** the spec (above); `src/lab/sdf-zombie/webgpu/march.wgsl.ts` header comments; `src/lab/sdf-zombie/pack.ts` (bound groups + the DISTORTION rule); `scripts/blob-turntable.mjs` header (CDP pattern, `BLOB_PROBE`); `scripts/lab-servers.sh` (server lifecycle, port overrides).

**Hard rules for every task:**
- The cull-soundness rule: any test comparing a Euclidean bound distance against the field's running `d` multiplies its threshold by the packed distortion factor (`groupRange.z` / `clusterGroups.z`). No exceptions — a factor-free test tore black crack seams inside wound cavities.
- Wound shading semantics are frozen: the facing-gated colouring mask, the radial fresnel fade, the light-gated specular, near-wound 0.6·d stepping, and the flat-lit face decal must render identically. The 8-yaw wounded turntable is the gate.
- Bench numbers quoted in any report come from the bench page (Task 1), never from the lab, and never while another dispatch or the owner's lab tab is active. State host conditions in the report.
- `npx vitest run src/lab/sdf-zombie/` green before every commit.

---

### Task 1: Bench page — fixed scenes, scripted orbit, honest timing

**Files:**
- Create: `sdf-bench.html` (repo root, next to `sdf-lab-webgpu.html`)
- Create: `src/lab/sdf-zombie/webgpu/bench-main.ts`
- Create: `scripts/sdf-bench.sh`, `scripts/sdf-bench.mjs`
- Create: `src/lab/sdf-zombie/webgpu/bench-stats.ts`, `src/lab/sdf-zombie/webgpu/bench-stats.test.ts`
- Modify: `package.json` (script `bench:sdf`), `vite.config.ts` (add the html input if the build enumerates pages)

- [ ] **Step 1: Write the failing stats test**

`bench-stats.ts` is the pure part: frame-delta accumulation and percentiles. Test first:

```ts
// src/lab/sdf-zombie/webgpu/bench-stats.test.ts
import { describe, it, expect } from 'vitest';
import { BenchStats } from './bench-stats';

describe('BenchStats', () => {
  it('reports p50/p95/p99 over recorded frame deltas', () => {
    const s = new BenchStats();
    // 100 frames: 99 at 10 ms, one 50 ms spike
    for (let i = 0; i < 99; i++) s.record(10);
    s.record(50);
    const r = s.summary();
    expect(r.n).toBe(100);
    expect(r.p50).toBe(10);
    expect(r.p95).toBe(10);
    expect(r.p99).toBe(50);
  });
  it('drops the warm-up frames', () => {
    const s = new BenchStats({ warmup: 5 });
    for (let i = 0; i < 5; i++) s.record(100); // warm-up junk
    for (let i = 0; i < 10; i++) s.record(10);
    expect(s.summary().n).toBe(10);
    expect(s.summary().p99).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/lab/sdf-zombie/webgpu/bench-stats.test.ts`, expect "Cannot find module './bench-stats'".

- [ ] **Step 3: Implement `bench-stats.ts`**

```ts
// src/lab/sdf-zombie/webgpu/bench-stats.ts
//
// Pure frame-time accumulator for the bench page. Wall-clock rAF deltas,
// because GPU timestamps are unreliable across this renderer's multi-pass
// frames (see adaptive-scale.ts header). Percentiles by sorted index —
// n is small (a 15 s orbit at 60 Hz is ~900 samples).
export interface BenchSummary { n: number; p50: number; p95: number; p99: number; mean: number }

export class BenchStats {
  private samples: number[] = [];
  private skip: number;
  constructor(opts: { warmup?: number } = {}) { this.skip = opts.warmup ?? 0; }
  record(deltaMs: number): void {
    if (this.skip > 0) { this.skip--; return; }
    this.samples.push(deltaMs);
  }
  summary(): BenchSummary {
    const s = [...this.samples].sort((a, b) => a - b);
    const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
    const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), mean };
  }
}
```

- [ ] **Step 4: Tests pass** — same command, expect PASS. Commit: `git commit -m "bench: pure frame-stats accumulator"`.

- [ ] **Step 5: The bench page**

`sdf-bench.html` mirrors `sdf-lab-webgpu.html`'s skeleton (copy it, change the module src to `/src/lab/sdf-zombie/webgpu/bench-main.ts`, strip any panel UI markup). `bench-main.ts` reuses the lab's builders — do NOT fork the renderer. Structure:

```ts
// src/lab/sdf-zombie/webgpu/bench-main.ts
//
// The measurement surface (spec decision 4). NOT the lab: fixed scenes, a
// scripted orbit, adaptive OFF, no panel, no motion wander. Every number in
// a perf report comes from here.
//
// Scenes: 'A' = 4 schoolgirls in a line 0.8 m apart, camera orbiting at
// dist 1.2 target y 1.2 (the close fight). 'B' = 12 bodies (4 schoolgirl,
// 4 zombie, 4 cyclops) on a 4x3 grid 1.5 m apart, camera orbiting at
// dist 6 (the crowd). Query: sdf-bench.html?scene=A|B&scale=0.7&seconds=15
```

Implementation notes (follow, they are the decisions):
- Boot exactly like `lab-main.ts` boots the renderer and hero view; use the existing crowd-body path (`lab-main.ts`'s crowd creation around `setCrowdCount`) as the reference for how to instantiate N static bodies from a `.blob` — factor that body-spawning helper OUT of `lab-main.ts` into a small exported function if it is inline today, rather than duplicating it.
- `setAdaptive(false)` equivalent: never create the adaptive controller; set the SDF scale from the query param directly (the lab's scale plumbing — look for where `adaptive` writes the render scale — expose that setter).
- Orbit: `yaw = elapsed / seconds * 2π`, fixed pitch 0.1, camera set per frame exactly as `blob-turntable.mjs` does via `setCam`.
- Per frame: `stats.record(delta)` with `BenchStats({ warmup: 40 })`.
- On completion: render `{scene, scale, summary}` into a `<pre>` AND set `window.__bench = { done: true, ...summary, scene, scale }`.
- Expose `window.__sdfBench = { start(scene, scale, seconds), stats }` for the driver.

- [ ] **Step 6: The headless driver**

`scripts/sdf-bench.mjs`: copy the CDP mechanics of `scripts/blob-turntable.mjs` (fetch `/json/new`, WebSocket, `evaluate`) but navigate to `/sdf-bench.html?scene=...`, poll `window.__bench?.done`, print the JSON. `scripts/sdf-bench.sh` wraps it with `scripts/lab-servers.sh` exactly like `blob-shot.sh` does (`LAB_VITE_PORT`/`LAB_CDP_PORT` respected). `package.json`: `"bench:sdf": "scripts/sdf-bench.sh"`. Usage line in both files:

```
LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 npm run bench:sdf -- A 0.7 15
```

- [ ] **Step 7: Verify end-to-end** — run scene A and scene B once each; both must print a JSON summary with `n > 500`. Record the two baseline summaries in the task report (these are THE baselines every later task compares against).

- [ ] **Step 8: Commit** — `git commit -m "bench: sdf-bench page, scenes A/B, scripted orbit, headless driver"`.

---

### Task 2: Instrumentation heatmaps — steps/pixel and prims/pixel

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (march loop + mapBody fold: two counters; debug output branch)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (a `debugCfg` uniform: x = 0 off / 1 steps / 2 prims)
- Modify: `src/lab/sdf-zombie/webgpu/bench-main.ts` (`?debug=steps|prims` query; screenshot note)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (pin: debug branch exists and is guarded so debugCfg.x == 0 costs nothing)

- [ ] **Step 1: Counters.** In the march loop, count iterations (a plain `var stepCount` increment). In `mapBody`'s group fold, counting evaluated prims per CALL is not free to thread outward through every caller — instead count per march step at the call site: have `mapBody` return its prim count only when a debug flag is on. Cheapest structure that cannot slow the normal path: a separate `mapBodyCounted` wrapper is NOT acceptable (fold duplication); instead add the counter into the existing fold but write it to a `var<private>` (WGSL private-scope global), incremented inside the prim loop, zeroed by the march entry when `debugCfg.x > 0.5`. Guard every write with `if (debugCfg.x > 0.5)` so the normal path only pays a branch on a uniform (uniform control flow, effectively free).
- [ ] **Step 2: Output branch.** At the end of the march entry, `if (debugCfg.x > 0.5)`: emit `vec4(viridis-ish ramp(count / maxExpected), 1)` instead of the shaded colour. Steps ramp: 0..96 (`marchCfg.x`). Prims ramp: 0..2000 (56 prims × ~35 steps as the red end). A two-stop mix (blue→yellow→red) is fine; no texture needed.
- [ ] **Step 3: Bench page hook.** `?debug=steps` sets `debugCfg.x = 1` on every body's uniforms before the orbit; the driver saves one PNG at yaw 0 via the existing screenshot mechanism in `blob-turntable.mjs` (reuse its `captureScreenshot` code).
- [ ] **Step 4: Pin test.** In `march.wgsl.test.ts`: assert the march source contains the `debugCfg` guard string in both places (follow the file's existing `toContain` pin style).
- [ ] **Step 5: Verify.** Heatmaps for scene A at yaw 0, steps and prims, attached to the report. Bench A/B re-run with `debug` off must match Task 1's baselines within noise (< 5%) — the instrumentation must be free when off.
- [ ] **Step 6: Commit.**

---

### Task 3: Cheaper hit shading — share the post-hit field probes

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (hit-shading section, ~line 1195 on: normal, AO probe, scatter probe)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (update pins that count mapBody calls if any)

Today the hit pays: 4 mapBody (tetrahedron normal) + 1 (AO, `p + n*0.06`) + 1 (scatter, `p + L*0.06`) = 6.

- [ ] **Step 1: Derive AO from the tetrahedron.** The tetrahedron samples 4 offsets of size `e` around `p`. The AO probe wants the field at `p + n*0.06`. Replace the separate AO call with a cheaper estimate: `ao = clamp((d_at_hit + dot(grad, n) * 0.06) / 0.06, 0.35, 1.0)` where `grad` is the (unnormalised) tetrahedron gradient — a first-order extrapolation. CAVEAT to verify visually: this linearises away concavity, and the CAVITY OCCLUSION term (`ao *= 1 - 0.55*smoothstep(...wm)`) already handles craters — check limb creases still darken (the AO note in the shader says that is its whole job). If creases flatten, fall back to keeping the real AO probe and cutting only the scatter probe (net 6 → 5) and SAY SO in the report.
- [ ] **Step 2: Scatter probe.** `translucency` is preset-gated (`surfCfg.w > 0`) and skipped at zero — for presets that use it, reuse the tetrahedron gradient the same way: `thin ≈ clamp((d + dot(grad, L)*0.06) * -8, 0, 1)`. Same visual caveat, same fallback rule.
- [ ] **Step 3: Verify.** (a) Bench A and B before/after — record the deltas. (b) The wound gate: `LAB_VITE_PORT=5271 LAB_CDP_PORT=9271 BLOB_DIST=1.2 BLOB_PITCH=0.1 BLOB_PROBE="(window.__sdfLab.stampWounds(6), 1)" npm run blob:shot -- zombie /tmp/wound-gate 8` — compare the 8 frames against the same command on `main` (stash A/B); no new white patches, no crack seams, cavities stay red. (c) `npm run blob:render-check -- <name>` exit 0 for zombie, schoolgirl, cyclops, mouse. (d) A close-up of an UNWOUNDED zombie: creases (armpit, neck, groin) must still shade darker than open skin.
- [ ] **Step 4: Commit.**

---

### Task 4: Specialise-the-crowd measurement (measure-only)

**Files:** none modified permanently — this task produces a NUMBER.

- [ ] **Step 1:** `specialiseShaders` already exists in `lab-main.ts` (crowd-only, off by default) and `zombie-gpu.ts` (`opts.specialise`). Wire a `?specialise=1` query onto the bench page that passes it to crowd body creation.
- [ ] **Step 2:** Bench B with and without, 3 runs each, min-of-5 protocol. Record the delta.
- [ ] **Step 3:** Decision rule: ≥ 10% improvement → leave the query flag in and note in the spec that stage-3 crowd bodies should specialise; < 10% → still leave the flag (it is one line) but record "not worth complicating stage 3 for".
- [ ] **Step 4: Commit** (the flag + the report numbers in the commit message).

---

### Task 5: Per-tile primitive lists + one merged march

The big one. Sub-staged; each sub-stage lands green before the next. Read `pack.ts` (`boundGroups`, distortion) and the spec's flat-list lesson first: per-step reads before prim work are the enemy — the tile list is read ONCE per pixel (not per step), which is why this wins where the flat group list lost.

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/tile-cull.ts` (CPU tile binning + packing), `src/lab/sdf-zombie/webgpu/tile-cull.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (tile-list fold path), `zombie-gpu.ts` (tile texture + uniforms), `bench-main.ts` + `lab-main.ts` (the merged-pass wiring behind a flag)

- [ ] **Step 1: CPU tile binning, TDD.** Screen tiles of 16×16 px at SDF-pass resolution. For each body's bound group (posed, per frame): project the sphere (centre, radius, camera) to a screen-space AABB **conservatively** (use the sphere's screen-space extent at its nearest depth, clamp behind-camera to full screen) and append the group's global prim range to every tile the AABB touches. Pack per tile: `[count, (bodyIndex, groupStart, groupCount, distort) × count]` into a data texture (RGBA32F rows, same `writeRow` idiom as `zombie-gpu.ts`). Cap: 64 entries/tile, count clamped, and a `console.warn` once per frame when clamped (no silent truncation). Tests:

```ts
// tile-cull.test.ts — the behaviours that matter:
// 1. a sphere fully left of the frustum bins into zero tiles
// 2. a sphere covering the screen centre bins into exactly the tiles its
//    projected AABB covers (assert count on a hand-computed 4-tile case)
// 3. a sphere BEHIND the camera bins into every tile (conservative)
// 4. per-tile entry carries the same distortion factor packBody stored
// 5. the 64-entry cap clamps and flags, never wraps
```

- [ ] **Step 2: Shader fold from a tile list.** New fold path in `march.wgsl.ts` guarded by a `tileCfg` uniform (x = enabled, y = tiles-per-row, z = tile px size): the march entry computes its tile id from `@builtin(position)`, reads the tile's entry list ONCE into registers/loop, and for each entry folds that group's prims (same inner loop as today — reuse the existing prim-fold body; extract it into a WGSL helper `foldGroup(...)` used by BOTH paths so they cannot drift). The per-step group-sphere cull REMAINS inside the fold (tiles cut the list, spheres still cut per-step work) — with the distortion factor, unchanged.
- [ ] **Step 3: Hero-only parity.** Enable tiles for the hero body only (`?tiles=1` on bench + a lab panel toggle). Gates: `blob:render-check` all four glb characters exit 0; the 8-yaw wounded turntable matches main; bench A delta recorded (expect a win at close range where limb spheres overlap on screen).
- [ ] **Step 4: Merged multi-body pass.** One full-screen march draw for ALL bodies: bin every body's groups (crowd + hero + live chunks) into one tile list with a per-entry body index selecting that body's data texture region (restructure: give each body a row-band in ONE shared data texture — MAX_PRIMS columns × N body bands — rather than N textures; chunks join as bodies with their `singleGroup` cluster mirror). Per-body proxy draws stay behind `?merged=0` until parity. Wounds/palette/face uniforms become per-body arrays indexed by the entry's body index — scope: uniforms that differ per body in the CROWD today (palette, face) are already per-view; collapse them into arrays of MAX_BODIES=16.
- [ ] **Step 5: Gates.** Bench A ≤ 33 ms p95 at scale 0.7; bench B ≤ 33 ms p95 at scale 0.7 (the success criteria); render-check ×4; wounded turntable; sever a limb and gib in the lab with tiles+merged on — chunks must render and tumble. If B misses 33 ms, record how far off and STOP — do not start compensating hacks; Task 6's LOD is the next lever and the report should say what the gap is.
- [ ] **Step 6: Commit per sub-stage** (binning, shader path, hero parity, merged).

---

### Task 6: Smooth LOD ramps + coverage headroom

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts` (`applyLod` — today's stepped levels), `src/lab/sdf-zombie/adaptive-scale.ts` (+ its test), `bench-main.ts`

- [ ] **Step 1: Ramps, not steps.** Replace the discrete LOD levels' on/off quality switches with distance-driven scalar ramps: for body distance `d` in metres, `q = smoothstep(farFull, nearFull, d)` per lever, applied to the AMPLITUDES (surface noise, mottle, silhouette noise, scatter) and step budget (96 → 48 linearly). Face decal and wounds stay on at all distances (they are identity features). No lever may snap: the bench page's slow-approach capture (camera dollying from 8 m to 1 m over 10 s) is the gate — record it, eyeball for pops.
- [ ] **Step 2: Coverage predictor.** In `adaptive-scale.ts`, add `predictCoverage(bodies): number` = Σ projected cluster-sphere areas (px²) × current scale², clamped to the framebuffer area. Feed it to the controller: an upward probe is only attempted when `predictCoverage` is below the coverage at which the last downward move happened (hysteresis stored per rung). TDD in `adaptive-scale.test.ts` following its existing test style: a synthetic sequence where coverage stays high must produce zero probe attempts; coverage dropping by 2× must re-enable probing.
- [ ] **Step 3: Gates.** Bench B with LOD active at scale 0.7 — this is where the 33 ms target must finally hold if Task 5 left a gap; the approach capture shows no pops; adaptive probe-spike bursts (the "one 3-frame burst per failed probe" residual in TASKS.md) reduced — record p99 over a 30 s mixed orbit before/after.
- [ ] **Step 4: Commit.**

---

## Self-review notes (done at write time)

- Spec coverage: stage 1 → Tasks 1–2; stage 2 → Tasks 3–4; stage 3 → Task 5; stage 4 → Task 6. Success criteria A/B are Task 5/6 gates verbatim. Decision 3 (no pops) is Task 6 step 1's gate. Decision 4 is Task 1.
- The AO/scatter first-order extrapolation in Task 3 has an explicit visual caveat and a fallback rule instead of a hidden assumption.
- Task 5 names the flat-list economics lesson and keeps per-step sphere culls; the distortion rule is restated at every cull site.
- Type/name consistency: `BenchStats.summary()` used in Tasks 1–2; `tileCfg`/`foldGroup` introduced once in Task 5 and not referenced earlier.
