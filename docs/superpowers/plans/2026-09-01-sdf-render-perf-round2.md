# SDF Render Perf Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the next measurable frame-time wins on `sdf-game.html` after the shell march, without changing what renders, and land two quality fixes that ride on the same plumbing.

**Architecture:** Every task is one lever on the fill-bound march in `src/lab/sdf-zombie/webgpu/`. Tasks 1–4 are small, exact-by-construction changes to the WGSL march and the game page's constants; Task 5 adds per-body front-to-back passes with an accumulated-depth gate; Tasks 6–7 are quality (footprint AA, level shadows on bodies); Task 8 is a measurement with a conditional change. Each task has a bench gate and a render-parity gate, because the last two rounds proved that a plausible number is not a result (`docs/dev-notes/2026-08-31-game-perf-baseline/notes.md`).

**Tech Stack:** TypeScript, three.js r185 WebGPU (TSL `wgslFn`), WGSL, vitest. Bench: `scripts/sdf-game-bench.sh`. Capture parity: the frozen A/B/A/B `Page.captureScreenshot` procedure from the shell-march gate (never an in-page canvas readback — see the 2026-09-01 warning in `docs/dev-notes/2026-09-01-dungeon-relight/frozen-capture-verdict.md`).

**Why these and not others:** the review that produced this plan is in Obsidian, `Claude Notes/Blud/2026-09-01-sdf-render-and-blobforge-review.md`. Short version: 82–92% of rasterised pixels miss; misses carry 63–84% of march steps; the frame is fill-bound; occlusion between bodies is the largest untouched cost (6.2x penalty for ten bodies sharing a silhouette, lab X1.4). Quality LOD, the merged single-pass march, the second cone level and the occluder `tMax` clamp are all measured dead ends — do not re-propose them.

---

## Ground rules for every task

- **Machine quiet during any bench.** Deltas here are smaller than a background build.
- **Reload the page per bench run.** Damage persists otherwise (the 583% spread bug).
- **Parity means the frozen-capture A/B/A/B procedure**, with an off-vs-off pair taken FIRST for the noise floor (0.015% settled). Never `drawImage`/`getImageData` off the WebGPU canvas — it returns black.
- **Numbers go in** `docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md` (create in Task 0). One section per task, before/after, spread, verdict.
- **Kill switch per task.** Every behavioural change ships behind a `__sdfGame.setX()` seam so the owner can A/B it live.
- Tests: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` for the fast loop; `npx vitest run src/lab/sdf-zombie/` before each commit. `scripts/blob-measure.test.ts` (7 tests) fails on main today for an environmental reason unrelated to this plan — ignore it, do not "fix" it here.

---

### Task 0: Fresh baseline

The last bench predates shadow-hull spanning (instances went 30 → 51 per body) and a one-off HUD read showed 54 ms against the 21–27 ms in the notes. Nothing later in this plan can be judged without a trusted baseline.

**Files:**
- Create: `docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md`

- [ ] **Step 1: Run the bench, rooms 3 and 4, three repeats**

```bash
BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Expected: a table per room with median chunk-mean ms and repeat spread. If spread exceeds 13% on any leg, the machine was not quiet — rerun.

- [ ] **Step 2: Record the occupancy counters at the same state**

Open `sdf-game.html` via the bench's Chrome (CDP port from `LAB_CDP_PORT`, default 9277), walk to room 3, run in the console:

```js
__sdfGame.occupancy()
```

Record `hits`, `marched`, `rasterised` and mean steps for hit and miss. Repeat in room 4.

- [ ] **Step 3: Write the notes file**

```markdown
# SDF perf round 2 — notes

Plan: docs/superpowers/plans/2026-09-01-sdf-render-perf-round2.md
Review: Obsidian `Claude Notes/Blud/2026-09-01-sdf-render-and-blobforge-review.md`

## Task 0 — baseline (2026-09-DD, main <sha>)

| room | median ms | spread | hits | marched | mean steps hit / miss |
|---|---|---|---|---|---|
| 3 | | | | | |
| 4 | | | | | |

Shell ON, occluder OFF, cone OFF, fxaa ON, smear 0.25, scale 1.0 at 800x600, relax 1.0 (omega 0.6).
```

- [ ] **Step 4: Commit**

```bash
git add docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "perf round 2: fresh baseline after shadow-hull spanning"
```

---

### Task 1: Bound `tMax` by the hull exit on the un-relaxed path

Miss rays currently march from hull entry to the proxy-box back face, through the empty space behind the body. The hull exit bounds every possible hit. It was left out of `tMax` because the RELAXED tracer's clamped final sample would land on the hull (the 2026-08-31 halo). That clamped sample only exists when `omega > 1.0` — the game page runs at 0.6 — so on the un-relaxed path the fold is exact.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (MARCH_BODY, the `let tMax` / `let relax` lines just after the `shellOut <= 0.0` discard, ~1339–1400)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (the "shellOut must NOT bound tMax" guard, ~443–450)

- [ ] **Step 1: Replace the regression guard with the new contract**

In `march.wgsl.test.ts`, replace the assertion at ~449 (`expect(MARCH_BODY).not.toContain('occT + woundCfg2.z), shellOut');`) with:

```ts
    // The hull exit bounds tMax ONLY on the un-relaxed path. The relaxed
    // tracer takes a clamped final sample at tMax; clamping to the hull put
    // that sample on the hull and rendered a halo (2026-08-31 visual gate),
    // so above omega 1.0 the proxy-box far plane stays the bound.
    expect(MARCH_BODY).toContain('let tMax = select(min(tMaxBox, shellOut), tMaxBox, relax);');
    expect(MARCH_BODY.indexOf('let relax = woundCfg2.y > 1.0;'))
      .toBeLessThan(MARCH_BODY.indexOf('let tMax = select('));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "shell"`
Expected: FAIL — `MARCH_BODY` does not contain `let tMax = select(`.

- [ ] **Step 3: Implement in MARCH_BODY**

Find, just after `if (shellOut <= 0.0) { discard; ... }` and the occluder comment block:

```wgsl
  let tMax = length(worldPos - camPos);
  let steps = i32(marchCfg.x);
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);
  let relax = woundCfg2.y > 1.0;
  var omega = select(marchCfg.y, woundCfg2.y, relax);
```

Replace with:

```wgsl
  let tMaxBox = length(worldPos - camPos);
  let relax = woundCfg2.y > 1.0;
  let tMax = select(min(tMaxBox, shellOut), tMaxBox, relax);
  let steps = i32(marchCfg.x);
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);
  var omega = select(marchCfg.y, woundCfg2.y, relax);
```

Then rewrite the comment block above the discard ("shellOut IS DELIBERATELY NOT FOLDED INTO tMax...") to say: folded on the un-relaxed path only; the relaxed path keeps the box far plane because its clamped final sample must never land on the hull. With the shell OFF `shellOut` is 1e9 so `min` is the identity.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
Expected: PASS.

- [ ] **Step 5: Parity gate**

Frozen capture, room 3 and room 4, A (before) / B (after) / A / B, plus an off-vs-off pair first. Expected: B-vs-A within the settled noise floor (≤ 0.02% of pixels). Also `__sdfGame.occupancy()` hits unchanged (room 3 ≈ 104184, room 4 ≈ 46225 at Task 0's state). Record in notes.

- [ ] **Step 6: Bench gate**

```bash
BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Expected: mean steps on miss pixels drop (they were 6–14); frame time at or below baseline. Record before/after and spread.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "march: hull exit bounds tMax on the un-relaxed path"
```

---

### Task 2: Plain sphere tracing (omega 1.0) on the game page

`marchCfg.y` defaults to 0.6 (`zombie-gpu.ts:181`) and the game page never changes it. 0.6 existed to survive the fbm shell displacement (`marchCfg.z`), which is bench-gated OFF on this page, and wounds already force 0.6 locally (`select(omega, 0.6, conservative || nearWound)`). The field is documented conservative (`SMIN` header), so omega 1.0 is safe by its own property, never enters the `omega > 1.0` overshoot/clamped-sample logic that produced the box washes at 1.4, and should recover the flesh 0.6 leaves unresolved at range (room 4: 27171 hits at 0.6 vs 46224 at 1.4).

The lab stays at 0.6 — `characters/zombie-blob.test.ts` pins the lab to 0.1 mm and the lab is the owner's bisect reference.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (next to `GAME_RELAX` ~537; the per-view apply ~618; the `__sdfGame` seam next to `setRelax` ~2037)

- [ ] **Step 1: Add the constant beside GAME_RELAX**

```ts
  /**
   * Step multiplier for the game page's march (marchCfg.y). The lab ships
   * 0.6 (under-relaxed) to survive the fbm shell displacement, which this
   * page runs with amplitude 0. With a conservative field, 1.0 is plain
   * sphere tracing: exact, fewer steps, and it never enters the omega > 1
   * overshoot path that produced the 2026-08-31 box washes.
   * `__sdfGame.setOmega()` flips it live for A/B.
   */
  const GAME_OMEGA = 1.0;
```

- [ ] **Step 2: Apply it where GAME_RELAX is applied**

Find `view.uniforms.woundCfg2.value.y = GAME_RELAX;` (~618) and add directly after:

```ts
      view.uniforms.marchCfg.value.y = GAME_OMEGA;
```

- [ ] **Step 3: Add the live seam**

Next to `setRelax(v: number)` in the `__sdfGame` object:

```ts
    /** Step multiplier (marchCfg.y). Ships at GAME_OMEGA. */
    setOmega(v: number) {
      const n = Math.max(0.1, Math.min(1.0, v));
      for (const a of actors) a.view.uniforms.marchCfg.value.y = n;
    },
    get omega() { return actors[0]?.view.uniforms.marchCfg.value.y ?? 0; },
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Visual gate (this changes what renders, so it needs eyes, not parity)**

Frozen captures at ~2 m and ~6 m from a body, room 3 and room 4, `setOmega(0.6)` vs `setOmega(1.0)`. Expected: identical silhouettes, more resolved flesh at 6 m, no halos, no box washes. Fire a slug and repeat with a wounded body — the crater must read the same (the nearWound path is unchanged). If anything at 1.0 reads worse, stop and record it; do not tune around it.

- [ ] **Step 6: Bench + occupancy gate**

```bash
BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

and `__sdfGame.occupancy()` in both rooms. Expected: mean steps down on both hits and misses; hits in room 4 rise toward the 46k the same field resolves at 1.4. Record.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "game: plain sphere tracing (omega 1.0) — the page runs no shell displacement"
```

---

### Task 3: Early-out in the wound loop

`applyWounds` loads three texels per wound (position, meta, cap) for EVERY field evaluation — each march step, the four normal taps, AO and scatter — before it knows whether the wound is anywhere near the sample. Load the position first, compute the distance, skip the rest beyond the wound's reach. The skip is exact: the quadratic `smin` is exactly `min` once the operands differ by 4k, the rim bump at three widths is 1.2e-4 of its amplitude (sub-micron), and `nearWound` (r < 2·depth) is inside the reach by construction.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (APPLY_WOUNDS ~605–640)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Check: `grep -rn "applyWounds\|carveWounds" src/lab/sdf-zombie/*.ts` — if a CPU mirror of the wound carve exists on your branch (the mesh-deform work had one), apply the identical early-out there in the same commit.

- [ ] **Step 1: Write the failing test**

```ts
  it('skips a wound before loading its meta/cap rows when the sample is out of reach (perf round 2 task 3)', () => {
    const iPos = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND})`);
    const iReach = APPLY_WOUNDS.indexOf('if (r > reach) { continue; }');
    const iMeta = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND_META})`);
    const iCap = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND_CAP})`);
    expect(iPos).toBeGreaterThan(-1);
    expect(iReach).toBeGreaterThan(iPos);
    expect(iMeta).toBeGreaterThan(iReach);
    expect(iCap).toBeGreaterThan(iReach);
    // Reach covers the crater (2 depth, the nearWound radius), the smax
    // fillet (exact min beyond 4k, plus 0.25 m for how deep inside a limb
    // the running field can be) and three rim widths past the rim offset.
    expect(APPLY_WOUNDS).toContain(
      'let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25;');
  });
```

(`ROW_WOUND`, `ROW_WOUND_META`, `ROW_WOUND_CAP` and `APPLY_WOUNDS` are already exported from `march.wgsl.ts`; import them at the top of the test if not already.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "out of reach"`
Expected: FAIL on `iReach` being -1.

- [ ] **Step 3: Implement**

In APPLY_WOUNDS the loop body currently begins:

```wgsl
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    ...
    let wCap = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP}), 0);
    let capEff = select(1.0e5, wCap.w, wCap.w > 0.0);
    let isBurn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
    let r = length(p - w.xyz);
```

Reorder to:

```wgsl
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let r = length(p - w.xyz);
    // Reach of this wound's influence, beyond which the carve, the fillet
    // and the rim bump all contribute exactly nothing (see the test):
    //   crater .......... r < depth <= w.w, and nearWound at 2 depth
    //   smax fillet ..... quadratic smin is exactly min once |a-b| >= 4k;
    //                     a-b here is (r - depth) + d, and d >= -0.25 inside
    //                     any limb this game has
    //   rim bump ........ exp(-x^2) at x >= 3 is 1.2e-4 of amp — sub-micron
    // Skipping here saves the two texel loads below and every op after them
    // for every wound the sample is nowhere near — which, per march step,
    // is all of them but one.
    let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25;
    if (r > reach) { continue; }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    let wCap = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP}), 0);
    let capEff = select(1.0e5, wCap.w, wCap.w > 0.0);
    let isBurn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
```

Keep everything after `let r` (the `smax`, `near`, rim lines) byte-identical, just remove the old `let r = ...` line that now sits below.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
Expected: PASS.

- [ ] **Step 5: Parity gate WITH wounds present**

In room 3: fire one slug and eight pellets into a body, `__sdfGame.freeze()` (or the bench's freeze seam), capture A/B/A/B before and after. Expected: within noise floor. Also check the lab: `npm run blob:render-check -- zombie` exit 0 (the lab uploads no caps; the skip must be identical there too).

- [ ] **Step 6: Bench gate — the fire segment is the one that moves**

```bash
BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Expected: the fire/wounded segments improve; idle segments unchanged. Record.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "march: skip a wound's meta/cap loads when the sample is out of its reach"
```

---

### Task 4: Stop paying for the disabled occluder pre-pass, and retire the bit-rotted specialiser

Two pieces of dead weight.

(a) `occluderHull.update()` rebuilds BOTH the occluder instances (consumed by nothing — the pre-pass is disabled at `game-main.ts:510` and the `tMax` clamp was removed from the shader on 2026-09-01) and the shadow twin (load-bearing) every unfrozen frame. Split them so the occluder half runs only when the pre-pass is on.

(b) `specialise.ts` emits `sdPrim(p, ${i}, data)` — three arguments — against the current seven-argument `SD_PRIM`. It would fail pipeline creation if anyone enabled `?specialise=1`. It cannot apply to the game page anyway (its own guard rejects rig-posed bodies, and every body on the page is rig-posed). **Owner call:** delete it (recommended — a −20% lab-era number for statues is not worth a broken code path), or repair the call sites. This task deletes; if the owner wants it kept, replace Step 5 with a signature fix and a string test asserting the seven-argument form.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/occluder-hull.ts` (`update`, the `OccluderHull` interface)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:1279–1288`
- Test: `src/lab/sdf-zombie/webgpu/occluder-hull.test.ts`
- Delete: `src/lab/sdf-zombie/webgpu/specialise.ts`, `src/lab/sdf-zombie/webgpu/specialise.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts:996` (the `opts.specialise` branch), `src/lab/sdf-zombie/webgpu/lab-main.ts` (the `?specialise=` param), `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (~1176–1230, the specialise parity tests)

- [ ] **Step 1: Write the failing test for the split**

In `occluder-hull.test.ts`:

```ts
  it('update({ occluder: false }) refreshes the shadow twin but leaves the occluder instances alone', () => {
    const hull = createOccluderHull(64);
    hull.update([body]);                       // whatever fixture the file already uses
    const before = hull.instanceCount;
    hull.update([], { occluder: false });      // no bodies: shadow twin empties
    expect(hull.shadowObject.count).toBe(0);
    expect(hull.instanceCount).toBe(before);   // occluder untouched
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/occluder-hull.test.ts -t "occluder: false"`
Expected: FAIL — `update` takes no options argument.

- [ ] **Step 3: Implement the split**

In `occluder-hull.ts`, change the interface and `update`:

```ts
export interface OccluderHull {
  object: THREE.Mesh;
  shadowObject: THREE.Mesh;
  /** `occluder: false` skips the inner-hull rebuild (the pre-pass consumes
   *  it, and the pre-pass is off on the game page); the shadow twin is
   *  always rebuilt because the shadow map is always live. */
  update(bodies: BuiltBody[], wounds?: WoundSphere[], opts?: { occluder?: boolean }): void;
  ...
}

  function update(bodies: BuiltBody[], wounds: WoundSphere[] = [], opts: { occluder?: boolean } = {}) {
    if (opts.occluder !== false) {
      count = fillInstances(mesh, buildHullInstances(bodies, HULL_SHRINK, wounds));
    }
    fillInstances(shadowMesh, buildHullInstances(bodies, shadowInflate, wounds, 0, shadowSpan));
  }
```

In `game-main.ts` (~1279), pass the flag:

```ts
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled ? /* unchanged */ : [],
        { occluder: sdfLayer.occluderEnabled },
      );
```

`__sdfGame.setOccluder(true)` still works: the next frame rebuilds the occluder instances.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/occluder-hull.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the specialiser**

```bash
git rm src/lab/sdf-zombie/webgpu/specialise.ts src/lab/sdf-zombie/webgpu/specialise.test.ts
```

In `zombie-gpu.ts:996` replace `opts.specialise ? buildMarchFn(specialiseMapBody(body)) : marchBody,` with `marchBody,` and remove the `specialise` option from the view options type and the import. In `lab-main.ts` remove the `?specialise=` URL param handling. In `march.wgsl.test.ts` remove the `specialiseMapBody` import and the tests that reference it (~1176–1230).

- [ ] **Step 6: Type-check and full suite**

Run: `npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/`
Expected: clean; all green except the pre-existing `scripts/blob-measure.test.ts`.

- [ ] **Step 7: Bench**

```bash
BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Expected: a small CPU-side gain (one `buildHullInstances` walk per frame removed); GPU parity exact. Record.

- [ ] **Step 8: Commit**

```bash
git add -A src/lab/sdf-zombie/webgpu docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "hull: rebuild the occluder instances only when the pre-pass is on; retire the bit-rotted specialiser"
```

---

### Task 5: Front-to-back per-body passes with an accumulated depth gate

The biggest structural lever left. A body behind another body (or behind a wall) marches its full pixel set today: the march target's hardware depth resolves the WRITE, but `frag_depth` + `discard` defeat early-Z, so every fragment runs. Render bodies front to back, one pass each, and give each pass a copy of the accumulated result so far: a fragment whose hull entry lies beyond the nearest hit already recorded at that pixel discards before marching, and one that overlaps clamps `tMax` to it. Exact by construction — it removes work the depth test would have thrown away anyway — so the gate is parity, and the win is proportional to overlap (rooms 3 and 4 show 8–9 bodies through the ring's sightlines).

Gib chunks stay in one final pass together, gated by the accumulated bodies.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (a `prev` target, a blit, `setBodies`, `setDepthGate`, the march draw loop, a pure `sortFrontToBack`)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`createMarchMaterial`: a `PrevSource` and the `prevT` node; `MarchUniforms`: nothing new)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (MARCH_BODY: one new trailing parameter `prevT`, two lines)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (sort actors per frame, `setBodies`, `__sdfGame.setDepthGate`)
- Test: `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

**Positional-parameter warning:** `marchBody`'s WGSL signature is bound POSITIONALLY by `createMarchMaterial` (`zombie-gpu.ts:600–605` records the day two slots were swapped and every beam knob silently broke). Add `prevT` as the LAST parameter, after `shellOut`, in both places.

- [ ] **Step 1: Failing test for the sort helper**

In `sdf-layer.test.ts`:

```ts
import { sortFrontToBack } from './sdf-layer';

describe('sortFrontToBack', () => {
  it('orders objects by distance from the camera, nearest first, without mutating the input', () => {
    const mk = (x: number) => { const o = new THREE.Object3D(); o.position.set(x, 0, 0); return o; };
    const far = mk(10), near = mk(1), mid = mk(5);
    const input = [far, near, mid];
    const out = sortFrontToBack(input, new THREE.Vector3(0, 0, 0));
    expect(out).toEqual([near, mid, far]);
    expect(input).toEqual([far, near, mid]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts -t sortFrontToBack`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the helper and the layer plumbing**

In `sdf-layer.ts`, export:

```ts
/** Nearest first by world-position distance. Pure; returns a new array. */
export function sortFrontToBack(objects: THREE.Object3D[], camPos: THREE.Vector3): THREE.Object3D[] {
  const d = new Map<THREE.Object3D, number>();
  for (const o of objects) d.set(o, o.getWorldPosition(new THREE.Vector3()).distanceToSquared(camPos));
  return [...objects].sort((a, b) => d.get(a)! - d.get(b)!);
}
```

Inside `createSdfLayer`, next to `target`:

```ts
  // Accumulated colour+depth so far in this frame's front-to-back walk. A
  // pass cannot read the target it writes, so each body reads a blit of
  // the previous state. Same format as `target`; its alpha is the clip depth
  // the composite already consumes.
  const prev = new THREE.RenderTarget(1, 1, {
    depthBuffer: false,
    type: THREE.FloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const prevUniforms = { enabled: uniform(0) };
  let bodies: THREE.Object3D[] = [];
  let chunks: THREE.Object3D[] = [];
  const blitMat = new MeshBasicNodeMaterial();
  blitMat.colorNode = texture(target.texture, uv());
  blitMat.outputNode = texture(target.texture, uv());   // carry alpha (depth) verbatim
  blitMat.depthTest = false;
  blitMat.depthWrite = false;
  const blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
  blitQuad.frustumCulled = false;
  const blitScene = new THREE.Scene();
  blitScene.add(blitQuad);
```

Add `prev.setSize(w, h)` in `resize()`, `prev.dispose()` in `dispose()`, and in the returned object:

```ts
    prev: { texture: prev.texture, uniforms: prevUniforms },
    setBodies(list, chunkList) { bodies = list; chunks = chunkList; },
    setDepthGate(on) { prevUniforms.enabled.value = on ? 1 : 0; },
    get depthGate() { return prevUniforms.enabled.value > 0.5; },
```

Replace the march draw

```ts
      camera.layers.set(SDF_LAYER);
      renderer.setRenderTarget(target);
      void renderer.render(scene, camera);
```

with

```ts
      camera.layers.set(SDF_LAYER);
      if (prevUniforms.enabled.value > 0.5 && bodies.length > 0) {
        // Clear once, then one pass per body nearest-first, each preceded by
        // a blit of the accumulated state into `prev`. Chunks go last, all
        // together, gated by every body.
        const ordered = sortFrontToBack(bodies, camera.position);
        const wasVisible = new Map<THREE.Object3D, boolean>();
        for (const o of [...bodies, ...chunks]) { wasVisible.set(o, o.visible); o.visible = false; }
        renderer.setRenderTarget(target);
        renderer.clear();
        const prevAuto = renderer.autoClear;
        renderer.autoClear = false;
        const passes: THREE.Object3D[][] = [...ordered.map(o => [o]), chunks];
        for (const group of passes) {
          if (group.length === 0) continue;
          renderer.setRenderTarget(prev);
          void renderer.render(blitScene, quadCam);
          for (const o of group) o.visible = true;
          renderer.setRenderTarget(target);
          void renderer.render(scene, camera);
          for (const o of group) o.visible = false;
        }
        renderer.autoClear = prevAuto;
        for (const [o, v] of wasVisible) o.visible = v;
      } else {
        renderer.setRenderTarget(target);
        void renderer.render(scene, camera);
      }
```

(`quadCam` already exists for the composite; the blit quad is a second scene drawn with the same camera.) Add `setBodies`, `setDepthGate`, `depthGate` and `prev` to the `SdfLayer` interface.

- [ ] **Step 4: The `prevT` node in `createMarchMaterial`**

In `zombie-gpu.ts`, add next to `shellFetchNode`:

```ts
/** Ray distance to the nearest hit already accumulated at this pixel, or
 *  1e9 when nothing (alpha >= 1 is the composite's "nothing here" sentinel)
 *  or when the gate is off. Alpha holds WebGPU clip depth in [0,1] from
 *  three's perspective projection, depth = far*(z-near)/((far-near)*z), so
 *  z = near*far / (far - depth*(far-near)); the ray distance is z over the
 *  cosine between the ray and the camera forward axis. */
const prevFetchNode = wgslFn(/* wgsl */ `fn prevFetch(prevTex: texture_2d<f32>, screenUV: vec2<f32>, enabled: f32, near: f32, far: f32, cosRay: f32) -> f32 {
  if (enabled < 0.5) { return 1e9; }
  let dims = vec2<f32>(textureDimensions(prevTex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let depth = textureLoad(prevTex, c, 0).a;
  if (depth >= 1.0) { return 1e9; }
  let z = near * far / max(far - depth * (far - near), 1e-6);
  return z / max(cosRay, 1e-4);
}`);

export interface PrevSource { texture: THREE.Texture; uniforms: { enabled: ReturnType<typeof uniform> }; }
```

Add `prev?: PrevSource` as the last parameter of `createMarchMaterial`. Move `const rayDir = normalize(sub(positionWorld, cameraPosition));` ABOVE the `march({...})` call, then add the final argument:

```ts
    prevT: prev
      ? prevFetchNode({
          prevTex: texture(prev.texture),
          screenUV: screenUV,
          enabled: prev.uniforms.enabled,
          near: cameraNear,
          far: cameraFar,
          cosRay: mul(cameraViewMatrix, vec4(rayDir, 0.0)).z.negate(),
        })
      : float(1e9),
```

(`cameraNear`, `cameraFar` come from `three/tsl`.) Thread `prev` through `createZombieGpuView`'s options exactly as `shell` is threaded, and through the shared chunk material.

- [ ] **Step 5: The two lines in MARCH_BODY**

Add `prevT: f32` after `shellOut: f32` in the signature. After the Task 1 `let tMax = ...` line:

```wgsl
  // Accumulated-depth gate (perf round 2 task 5): a nearer body already
  // owns this pixel out to prevT. Hull entry beyond it — nothing of this
  // body can be seen. Otherwise the recorded hit bounds the ray.
  if (shellIn > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let tMax = min(tMaxSel, prevT);
```

(rename Task 1's `tMax` to `tMaxSel` so this stays one `let`.) Add to `march.wgsl.test.ts`:

```ts
  it('discards on the accumulated-depth gate before marching and bounds tMax by it', () => {
    expect(MARCH_BODY).toContain('prevT: f32');
    expect(MARCH_BODY.indexOf('shellOut: f32')).toBeLessThan(MARCH_BODY.indexOf('prevT: f32'));
    expect(MARCH_BODY).toContain('if (shellIn > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
    expect(MARCH_BODY).toContain('let tMax = min(tMaxSel, prevT);');
  });
```

- [ ] **Step 6: Wire the game page**

In `game-main.ts`, pass `prev: sdfLayer.prev` when creating each zombie view and the chunk material; each frame before `sdfLayer.render`:

```ts
    sdfLayer.setBodies(actors.map(a => a.view.object), chunkSystem.objects());
```

(use whatever accessor the chunk system exposes for its meshes — `grep -n "coneObject\|SDF_LAYER" game-main.ts` finds where they are added to the scene). Add:

```ts
    setDepthGate(on: boolean) { sdfLayer.setDepthGate(on); },
    get depthGate() { return sdfLayer.depthGate; },
```

to `__sdfGame`, and `sdfLayer.setDepthGate(true)` next to `setShellEnabled(true)`.

- [ ] **Step 7: Type-check and tests**

Run: `npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/webgpu/`
Expected: clean, green.

- [ ] **Step 8: Verify the depth decode before trusting parity**

Stand ~3 m from one isolated body, `setDepthGate(true)`, and confirm it still renders identically (no hole, no shrink) — a wrong `prevT` decode shows here as the body eating itself where its own hull entry exceeds a mis-decoded depth. Then walk until a second body is directly behind it and confirm the far body vanishes exactly where the near one covers it and nowhere else. Take captures.

- [ ] **Step 9: Parity gate**

Frozen A/B/A/B, rooms 3 and 4, `setDepthGate(false)` vs `(true)`. Expected: within the noise floor — the hardware depth test already resolved these overlaps; this only stops paying for them.

- [ ] **Step 10: Bench gate**

```bash
BENCH_ROOMS=3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Expected: room 4 (the ring sightlines) improves most; per-pass overhead (N+1 `render()` calls and blits) must not exceed the gain in room 2 (one body). If room 2 regresses by more than the spread, cap the per-body passes at the nearest K bodies and batch the rest. Record.

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/webgpu docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "march: front-to-back per-body passes gated on the accumulated depth"
```

---

### Task 6: Distortion-corrected footprint epsilon (in-march AA on)

`aaCfg = (pixelConeK, strength)` ships with strength 0 because `mapBody` under-reports Euclidean distance by the group distortion factor (up to 22x on the schoolgirl's sole plate), so a footprint-sized epsilon could stop a ray short. The fold already carries that factor per group (`grp.z`). Track the dominant prim's factor alongside the argmin, return it in `mapBody`'s spare `.w`, and divide the epsilon by it. Then distant bodies converge in fewer steps and stop shimmering — a quality win that is also a speed win, the only kind worth taking here.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (FOLD_GROUP's private globals + argmin update; MAP_BODY's returns; MARCH_BODY's `hitEps`)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (`aaCfg.value.y`, `__sdfGame.setAa`)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('returns the dominant group distortion in mapBody.w and divides the footprint epsilon by it', () => {
    expect(FOLD_GROUP).toContain('var<private> gFoldBestDistort: f32 = 1.0;');
    expect(FOLD_GROUP).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }');
    expect(MAP_BODY).toContain('gFoldBestDistort = 1.0;');
    expect(MAP_BODY).toContain('return vec4<f32>(dmg, f32(bestIdx), nearWound, gFoldBestDistort);');
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaK / max(dres.w, 1.0));');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "distortion"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In FOLD_GROUP's tail declarations add `var<private> gFoldBestDistort: f32 = 1.0;` beside `gFoldBestIdx`, and change the argmin line to
`if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }`.
In MAP_BODY, reset `gFoldBestDistort = 1.0;` beside the other two resets, and change both returns' `.w` from `0.0` to `gFoldBestDistort`.
In MARCH_BODY, `let hitEps = max(hitEpsBase, t * aaK);` becomes `let hitEps = max(hitEpsBase, t * aaK / max(dres.w, 1.0));` and the matching inner `-max(hitEpsBase, t * aaK)` the same. `dres.w` is 1.0 for the volume branch and for any prim whose group has no distortion, so nothing changes at strength 0.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
Expected: PASS. Then parity at strength 0 (A/B/A/B, expected noise floor) — the plumbing must be invisible before the knob turns.

- [ ] **Step 5: Turn it on behind a seam**

In `game-main.ts` add `__sdfGame.setAa(strength: number)` setting `aaCfg.value.y` on every view, and default it to `1.0` next to `GAME_OMEGA`. `aaCfg.value.x` already tracks the adaptive ladder via `sdfLayer.pixelConeK` — confirm that assignment runs on rung change.

- [ ] **Step 6: Visual gate**

Captures at 2 m and 8 m, `setAa(0)` vs `setAa(1)`, room 4 through a tunnel sightline. Expected: far silhouettes stop crawling; near bodies unchanged; craters still read at 8 m (if they fill in, floor the epsilon at `wound radius * 0.25` and record). Check the schoolgirl if she is on the page — the sole plate is the 22x case.

- [ ] **Step 7: Bench**

Expected: mean steps down at range; frame time at or below Task 5's. Record.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "march: footprint epsilon corrected by the dominant group's distortion; in-march AA on"
```

---

### Task 7: Bodies receive the level's shadows (quality)

Bodies CAST via the spanned shadow hull but never RECEIVE: a zombie behind a pillar is lit by the flashlight. Sampling the flashlight's shadow map is not enough — the body's own inflated hull is in it, so every flesh point would shadow itself. Render a second shadow map from a twin light that sees only the level (layer 0), and sample THAT inside the march: level shadows on bodies, no self-shadowing, one texture sample per hit pixel, zero extra field evaluations. Body-on-body shadows stay out of scope.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/dungeon-lighting.ts` (the twin light)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`MarchUniforms`: `levelShadowMatrix`, `levelShadowCfg`; `createMarchMaterial`: `levelShadowTex`)
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (LEVEL_SHADOW helper; MARCH_BODY: multiply `keyI` by it)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (pose the twin each frame with the flashlight; `__sdfGame.setLevelShadow`)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`, `src/lab/sdf-zombie/webgpu/dungeon-lighting.test.ts`

- [ ] **Step 1: Failing shader test**

```ts
  it('applies the level shadow map to the key term only, and only when enabled', () => {
    expect(LEVEL_SHADOW).toContain('fn levelShadow(p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32>) -> f32');
    expect(LEVEL_SHADOW).toContain('if (cfg.x < 0.5) { return 1.0; }');
    expect(MARCH_BODY).toContain('let lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg);');
    expect(MARCH_BODY).toContain('diff * wShadow * lvl * keyI * keyC');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "level shadow"`
Expected: FAIL — `LEVEL_SHADOW` is not exported.

- [ ] **Step 3: The helper**

```ts
// Level-only shadow map lookup (perf round 2 task 7). cfg = (enabled,
// normalBias m, depthBias, spare). The map comes from a twin spotlight that
// renders layer 0 only, so a body never sees its own hull in it. The
// projection is three's `shadow.matrix` (bias * proj * view), whose output
// is [0,1] uv with depth in .z — the same contract three's own ShadowNode
// samples. 4-tap PCF on the texel grid; the owner's PSX look wants soft
// edges, not hard ones.
export const LEVEL_SHADOW = /* wgsl */ `fn levelShadow(p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32>) -> f32 {
  if (cfg.x < 0.5) { return 1.0; }
  let sp = shadowMat * vec4<f32>(p + n * cfg.y, 1.0);
  let uv = sp.xy / sp.w;
  let z = sp.z / sp.w - cfg.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || z > 1.0) { return 1.0; }
  let dims = vec2<f32>(textureDimensions(shadowTex, 0));
  let base = uv * dims - vec2<f32>(0.5, 0.5);
  var lit = 0.0;
  for (var dy = 0; dy < 2; dy = dy + 1) {
    for (var dx = 0; dx < 2; dx = dx + 1) {
      let c = clamp(vec2<i32>(floor(base)) + vec2<i32>(dx, dy), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
      let d = textureLoad(shadowTex, c, 0);
      lit = lit + select(0.0, 1.0, z <= d);
    }
  }
  return lit * 0.25;
}`;
```

Add it to `HELPERS` before `MARCH_BODY`'s dependencies. In MARCH_BODY add the three parameters at the END (`levelShadowTex: texture_depth_2d, levelShadowMatrix: mat4x4<f32>, levelShadowCfg: vec4<f32>` — after `prevT`), compute `let lvl = levelShadow(...)` right after `wShadow`, and change the key term to `diff * wShadow * lvl * keyI * keyC` and the specular `shine * wShadow` to `shine * wShadow * lvl`.

- [ ] **Step 4: The twin light**

In `dungeon-lighting.ts`, beside the flashlight creation:

```ts
  /** Shadow-only twin of the flashlight: same pose every frame, sees layer 0
   *  (the level) only, lights nothing (intensity 0 — the map still renders;
   *  three zeroes the sampling term, not the pass). The march samples its
   *  map so bodies take the level's shadows without seeing their own hull. */
  const levelShadowLight = new THREE.SpotLight(0xffffff, 0);
  levelShadowLight.castShadow = true;
  levelShadowLight.shadow.mapSize.set(1024, 1024);
  levelShadowLight.shadow.camera.layers.set(0);
  levelShadowLight.angle = spot.angle;
  levelShadowLight.penumbra = spot.penumbra;
  levelShadowLight.distance = spot.distance;
  scene.add(levelShadowLight, levelShadowLight.target);
```

and export it from the lighting rig's return value. In `game-main.ts` where the flashlight is posed each frame (the `spotPos`/`spotAxis` writes, ~452–473), copy position and target to the twin.

- [ ] **Step 5: Bind it**

`MarchUniforms` gains `levelShadowMatrix: uniform(new THREE.Matrix4())` and `levelShadowCfg: uniform(new THREE.Vector4(0, 0.02, 0.0005, 0))`. `createMarchMaterial` gains a `levelShadow?: { light: THREE.SpotLight }` option and passes `levelShadowTex: texture(levelShadow.light.shadow.map.depthTexture)` — **`shadow.map` is null until three has rendered the light once**, so create the body views AFTER the first `renderer.render` of the scene, or render one warm-up frame before `createZombieGpuView` (the game already precompiles; put the warm-up there). Each frame copy `levelShadowLight.shadow.matrix` into every view's `levelShadowMatrix`.

- [ ] **Step 6: Type-check, tests, then LOOK**

Run: `npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/webgpu/`. Then `__sdfGame.setLevelShadow(true)`: stand so a pillar is between the flashlight and a body. Expected: a shadow edge crosses the body where the pillar's shadow falls on the floor. No acne on the lit side (raise `cfg.y` normal bias to 0.03 if there is; do not exceed 0.05 — the bias shifts the shadow off the body). If `shadow.map` binding fails to compile, the fallback is a manual depth pass of the level into an R32F target from the flashlight's camera, sampled the same way — record which path shipped.

- [ ] **Step 7: Bench**

Expected: one extra 1024² level-only depth pass (polygonal, cheap) and one texture load per hit pixel. Must stay inside the Task 6 spread. Record.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "lighting: bodies receive the level's shadows from a level-only twin of the flashlight"
```

---

### Task 8: Measure the per-body upload; narrow the data texture only if it shows

Every body re-packs and re-uploads a 128×19 RGBA32F texture (38 KB) per frame for a 12-prim zombie — 116 of 128 columns are zeros. Probably under a quarter millisecond for ten bodies. Measure before touching it; the change is small if it shows.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts` (~412) — timing around `view.update`
- Modify (conditional): `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`createDataTexture` width)
- Test (conditional): `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`

- [ ] **Step 1: Instrument**

Around `view.update(posed, current)` in `game-actor.ts`:

```ts
      const t0 = performance.now();
      this.view.update(posed, current);
      uploadMsAccum += performance.now() - t0;
```

with a module-level `let uploadMsAccum = 0;` and an exported `takeUploadMs()` that returns and zeroes it; expose as `__sdfGame.uploadMs` (read once per second from the HUD or console). Record ten-body room 4 idle: total ms per frame across all actors.

- [ ] **Step 2: Decide**

If the total is under 0.3 ms per frame: record it in notes, remove the instrumentation, commit ("measured, not worth it"), and stop here.

- [ ] **Step 3 (only if it shows): narrow the texture per body**

In `createDataTexture(width)` take a width instead of `MAX_PRIMS`; the view computes `width = Math.max(primCount, MAX_WOUNDS, groupCount + 1)` at creation (the `+1` keeps the zero-column end-of-list sentinel for the group rows), rounded up to a multiple of 4. `writeRow` writes at that width. Nothing in the shader indexes past `counts.x`, `counts.y`, `MAX_WOUNDS` or the group sentinel, so no WGSL change. Add a test that `createZombieGpuView` for the zombie allocates a texture no wider than 20 texels, then re-run the full suite and the render-check:

```bash
npx vitest run src/lab/sdf-zombie/ && npm run blob:render-check -- zombie
```

Expected: green; render-check exit 0.

- [ ] **Step 4: Bench and commit**

```bash
git add src/lab/sdf-zombie/webgpu docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "upload: per-body data texture sized to the body"
```

---

## Not in this plan, and why

- **Checkerboard rendering with the existing depth reprojection.** The right way to make C2 half-rate palatable, but the owner parked C2 until the post-fx colour-chain retune (`X1.3`). Revisit then; the reprojection in `sdf-layer.ts` hold mode 2 is most of it.
- **Prim-major data layout.** Speculative: GPU texture caches are tiled, so the 19 rows of one prim may already share lines. Only worth trying with a counter that shows texture-cache misses, which we do not have.
- **Body-on-body shadows.** Needs per-body shadow maps or a self-exclusion the hull cannot give. Task 7 gets the level's shadows, which is most of the read.
- **Relax 1.4.** Still blocked on the clamped-sample rework (`X1.game-relax`). Task 2 takes the safe part of that win.
