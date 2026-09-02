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
- **Parity means the frozen-capture A/B/A/B procedure**, with an off-vs-off pair taken FIRST for the noise floor (0.015% settled). Never `drawImage`/`getImageData` off the WebGPU canvas — it returns black. Task 1b builds the harness for it (`scripts/perf-r2-parity.sh`, an in-page toggle A/B/A/B at a frozen scene); every later task uses that and ships its change behind a `__sdfGame` seam so it CAN be toggled.
- **Machine load.** While another dispatch chain is running on this machine, a bench number is noise. If `~/.claude/dispatch/plans/*.md` shows any task with `status: running` other than your own, write `DEFERRED (machine loaded)` for the bench step in the notes and move on; the parity and visual gates are NOT deferrable. Task 9 re-takes every bench when the machine is quiet.
- **Concurrent edits to `march.wgsl.ts`.** The wound-pass-r2 chain (branch `claude/continue-previous-work-91055b`) is editing `APPLY_WOUNDS`, `MAP_BODY`'s `.w` return slot and the hit shading at the same time. Keep every shader diff here minimal and local so the merge stays small; never repurpose `mapBody`'s `.w`.
- **Vision.** If your model cannot see a PNG through `Read` (glm-5.x and kimi-k3 on pi cannot), judge captures with `python3 scripts/vision-ask.py <png> "<question>"` and quote its answer in the notes.
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

### Task 1: Bound `tMax` by the hull exit on the un-relaxed path (behind a seam)

Miss rays currently march from hull entry to the proxy-box back face, through the empty space behind the body. The hull exit bounds every possible hit. It was left out of `tMax` because the RELAXED tracer's clamped final sample would land on the hull (the 2026-08-31 halo). That clamped sample only exists when `omega > 1.0` — the game page runs at 0.6 — so on the un-relaxed path the fold is exact.

**This task is the shader change and its seam ONLY.** The capture harness is Task 1b. Do not build, run or debug any capture tooling here; do not touch `sdf-layer.ts` or `game-main.ts` beyond the two lines named below. A first attempt at this task timed out after inventing a requestAnimationFrame-hold boot procedure for captures — that is exactly what not to do.

**Why a seam:** every A/B in this plan is an IN-PAGE toggle at a frozen scene (the proven shell-march gate). Cross-page-load captures are not deterministic (wander drift before the freeze, wall-clock shader time), so a shader change without a toggle cannot be parity-tested. A new `perfCfg` uniform carries this plan's toggles: `.x` = hull exit bound (this task), `.y` = wound early-out (Task 3), `.z`/`.w` spare. The lab leaves it all-zero and stays bit-identical.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (MARCH_BODY: signature gains `perfCfg: vec4<f32>` as the LAST parameter after `shellOut: f32`; the `let tMax` / `let relax` lines just after the `shellOut <= 0.0` discard; the comment block above it)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`defaultUniforms`: add `perfCfg: uniform(new THREE.Vector4(0, 0, 0, 0))` beside `aaCfg` ~364; `createMarchMaterial`: pass `perfCfg: u.perfCfg` as the LAST entry of the `march({...})` call, after `shellOut`)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (next to `GAME_RELAX` ~537 and its apply ~618; the `__sdfGame` object next to `setRelax` ~2037)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (the "shellOut must NOT bound tMax" guard, ~443–450)

**Positional-parameter warning:** `marchBody`'s WGSL parameters are bound POSITIONALLY by `createMarchMaterial` (`zombie-gpu.ts` ~600–605 records the day two slots were swapped and every beam knob silently broke). `perfCfg` goes LAST in both the WGSL signature and the `march({...})` object. `wgslFn` matches by name in the object but the generated call is positional — keep the order identical anyway.

- [ ] **Step 1: Replace the regression guard with the new contract**

In `march.wgsl.test.ts`, replace the assertion `expect(MARCH_BODY).not.toContain('occT + woundCfg2.z), shellOut');` and its comment with:

```ts
    // The hull exit bounds tMax ONLY on the un-relaxed path and only behind
    // perfCfg.x. The relaxed tracer takes a clamped final sample at tMax;
    // clamping to the hull put that sample on the hull and rendered a halo
    // (2026-08-31 visual gate), so above omega 1.0 the proxy-box far plane
    // stays the bound regardless of the seam.
    expect(MARCH_BODY).toContain('perfCfg: vec4<f32>');
    expect(MARCH_BODY.indexOf('shellOut: f32')).toBeLessThan(MARCH_BODY.indexOf('perfCfg: vec4<f32>'));
    expect(MARCH_BODY).toContain('let tMax = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);');
    expect(MARCH_BODY.indexOf('let relax = woundCfg2.y > 1.0;'))
      .toBeLessThan(MARCH_BODY.indexOf('let tMax = select('));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "shell"`
Expected: FAIL — `MARCH_BODY` has no `perfCfg`.

- [ ] **Step 3: Implement in MARCH_BODY**

Add `,\n  perfCfg: vec4<f32>` after `shellOut: f32` in the signature. Then, just after `if (shellOut <= 0.0) { discard; ... }` and the occluder comment block, the lines (there are comment lines between some of them — keep those):

```wgsl
  let tMax = length(worldPos - camPos);
  let steps = i32(marchCfg.x);
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);
  let relax = woundCfg2.y > 1.0;
  var omega = select(marchCfg.y, woundCfg2.y, relax);
```

become:

```wgsl
  let tMaxBox = length(worldPos - camPos);
  let relax = woundCfg2.y > 1.0;
  let tMax = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);
  let steps = i32(marchCfg.x);
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);
  var omega = select(marchCfg.y, woundCfg2.y, relax);
```

WGSL `select(falseValue, trueValue, cond)`. Rewrite the comment block that begins "shellOut IS DELIBERATELY NOT FOLDED INTO tMax" to the new contract: folded on the UN-RELAXED path behind `perfCfg.x` (exact — no ray can hit beyond the hull exit; the clamped final sample exists only above omega 1.0); the relaxed path keeps the proxy-box far plane (the halo); with the shell OFF `shellOut` is 1e9 so `min` is the identity; the lab binds `perfCfg` zero and is unchanged. Keep the history in a sentence or two.

- [ ] **Step 4: Plumb the uniform**

`zombie-gpu.ts` `defaultUniforms`: add

```ts
    /** Perf round 2 seams (plan 2026-09-01): x hull-exit tMax bound, y wound
     *  early-out, zw spare. All zero = the pre-plan shader, which is what the
     *  lab binds. */
    perfCfg: uniform(new THREE.Vector4(0, 0, 0, 0)),
```

`createMarchMaterial`: add `perfCfg: u.perfCfg,` as the LAST entry of the `march({ ... })` object, after the `shellOut:` entry. If a `MarchUniforms` type lists fields explicitly, add it there too. If chunk materials copy a template's uniforms field by field (search `template.marchCfg`), copy `perfCfg` the same way.

`game-main.ts`: beside `GAME_RELAX` add

```ts
  /** Perf round 2, task 1: the hull exit bounds tMax on the un-relaxed march
   *  (perfCfg.x). Exact; `__sdfGame.setHullExitBound()` flips it for A/B. */
  const GAME_HULL_EXIT_BOUND = 1;
```

and where `woundCfg2.value.y = GAME_RELAX` is applied per view add `view.uniforms.perfCfg.value.x = GAME_HULL_EXIT_BOUND;`. In the `__sdfGame` object next to `setRelax`:

```ts
    setHullExitBound(on: boolean) { for (const a of actors) a.view.uniforms.perfCfg.value.x = on ? 1 : 0; },
    get hullExitBound() { return (actors[0]?.view.uniforms.perfCfg.value.x ?? 0) > 0.5; },
```

Apply the same `perfCfg.x` to the gib-chunk material's uniforms if chunks have their own (search how chunks receive `woundCfg2`/`GAME_RELAX`; mirror it).

- [ ] **Step 5: Tests, type-check, lab parity**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` → PASS. Then `npx tsc --noEmit && npx vitest run src/lab/sdf-zombie/` → clean/green (ignore `scripts/blob-measure.test.ts`). Then `npm run blob:render-check -- zombie` → exit 0 (the lab binds `perfCfg` zero; a hole here means the positional binding slipped).

- [ ] **Step 6: Notes and commit**

Append to `docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md` a `## Task 1` section: what changed, the seam name, "parity + occupancy: see Task 1b". Commit:

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/game-main.ts docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "march: hull exit bounds tMax on the un-relaxed path, behind perfCfg.x"
```

---

### Task 1b: The parity harness, and Task 1's parity gate

Every later task's parity gate runs through this script. It is an IN-PAGE toggle A/B/A/B at a frozen scene — the same shape as the 2026-08-31 shell-march gate — never a comparison across page loads, and never a boot choreography. **Do not hold or intercept requestAnimationFrame, do not hand-step the boot, do not add debug seams to the page.** A previous attempt spent thirty minutes on exactly that and produced nothing. The page boots normally; you drive it only through `__sdfGame` after `resolveGpu()` returns.

**Files:**
- Create: `scripts/perf-r2-parity.mjs`, `scripts/perf-r2-parity.sh`
- Modify: `docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md`

**Start from the driver Task 0 already proved** (it produced bit-identical occupancy reads on a frozen scene). Copy it into `scripts/perf-r2-parity.mjs` and extend it; this is its full text:

```js
// Throwaway Task-0 driver: occupancy counters in rooms 3 and 4, at the
// bench's screen size, with adaptive resolution DISABLED (a loaded machine
// would otherwise downscale the march target and the counts would not be
// comparable). Counters, not timers — valid while another chain runs.
//
// Protocol per room: unfreeze, teleport to the room (centre, facing +z),
// 2 s of natural wander (~the bench walk segment), freeze, settle, then
// TWO occupancy reads (frozen scene => identical state => must agree).
import { execFileSync } from 'node:child_process';

const VITE = Number(process.argv[2] ?? 5299);
const CDP = Number(process.argv[3] ?? 9299);
const ROOMS = (process.env.OCC_ROOMS ?? '3,4').split(',').map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
const closeUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try { execFileSync('curl', ['-s', '-m', '2', closeUrl], { stdio: 'ignore' }); } catch {}
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 120_000) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
  });
  if (r.result?.exceptionDetails) {
    fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  }
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
});

await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html` });

// Wait for the seam and a resolved GPU backend.
const ready = await evaluate(`(async () => {
  for (let i = 0; i < 600; i++) {
    if (window.__sdfGame?.resolveGpu) {
      try { await __sdfGame.resolveGpu(); return 'ready'; } catch {}
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return 'never became ready';
})()`, 180_000);
if (ready !== 'ready') fail(`page boot: ${ready}`);
await sleep(5000); // boot settle, same as the bench's bootPage

// Pin the measurement state: bench-style. Adaptive OFF (machine is loaded),
// scale pinned to 1.0 so the march target is the ship 800x600.
const state = await evaluate(`(() => {
  __sdfGame.setAdaptive(false);
  __sdfGame.setSdfScale(1.0);
  __sdfGame.setFxaa(true);
  __sdfGame.setSmear(0.25);
  __sdfGame.setCone(false);
  __sdfGame.setOccluder(false);
  return {
    shell: __sdfGame.shell, occluder: __sdfGame.occluder, cone: __sdfGame.cone,
    fxaa: __sdfGame.fxaa, relax: __sdfGame.relax,
    sdfScale: __sdfGame.sdfScale, adaptive: __sdfGame.adaptive.enabled,
    halfRate: __sdfGame.halfRate, sdfTarget: __sdfGame.sdfTarget,
    backend: __sdfGame.backend,
  };
})()`);
console.error(`state: ${JSON.stringify(state)}`);

const out = { state, rooms: {} };
for (const room of ROOMS) {
  await evaluate(`(() => {
    __sdfGame.freeze(false);
    __sdfGame.teleport(${room});
  })()`);
  await sleep(2000); // ~120 frames of natural wander, as in the walk segment
  await evaluate(`__sdfGame.freeze(true)`);
  await sleep(500);  // post-AA smear settles on the frozen scene

  const a = await evaluate(`__sdfGame.occupancy()`);
  await sleep(1000);
  const b = await evaluate(`__sdfGame.occupancy()`);
  out.rooms[room] = { reads: [a, b] };
  console.error(`room ${room}: rasterised ${a.rasterised} hits ${a.hits} ` +
    `meanSteps hit ${a.meanStepsHit.toFixed(1)} miss ${a.meanStepsMiss.toFixed(1)} ` +
    `bodies ${a.bodiesOnScreen} (read2: rasterised ${b.rasterised} hits ${b.hits})`);
}
await evaluate(`__sdfGame.freeze(false)`);
console.log(JSON.stringify(out, null, 2));
```

- [ ] **Step 1: Extend the driver into the harness**

```
Usage:
  scripts/perf-r2-parity.sh capture <outDir> --room <3|4> --on "<js>" --off "<js>" [--occupancy]
  scripts/perf-r2-parity.sh diff <pngA> <pngB>
```

`capture`, per room: the driver's boot + pin block unchanged (`resolveGpu`, 5 s settle, `setAdaptive(false)`, `setSdfScale(1.0)`, fxaa on, smear 0.25, cone off, occluder off), then `freeze(false)`, `teleport(room)`, 2 s wander, `freeze(true)`, then **2500 ms** settle (the post-AA smear; 7.9% of pixels still differ across a freeze until it settles). Then:

1. `state-1.png`, `state-2.png` — the same state captured twice via CDP `Page.captureScreenshot` (`format: 'png'`); print their diff as the **noise floor**.
2. evaluate `--off`, settle 2500 ms, `b-1.png`; evaluate `--on`, settle, `a-1.png`; `--off`, settle, `b-2.png`; `--on`, settle, `a-2.png`. Print the diffs `a-1 vs b-1`, `a-2 vs b-2`, `a-1 vs a-2`, `b-1 vs b-2`.
3. With `--occupancy`: after each toggle also `__sdfGame.occupancy()` and print `hits`, `rasterised`, `meanStepsHit`, `meanStepsMiss` per state.

`diff <pngA> <pngB>`: changed-pixel count, changed fraction, max channel delta, and a 32-px coarse cell map — copy `decodePng` and `diffPngs` from `scripts/dungeon-shadowab.mjs` verbatim (read that file; do not rewrite the PNG decoder).

`scripts/perf-r2-parity.sh`: sources `scripts/lab-servers.sh` exactly as `scripts/sdf-game-bench.sh` does, defaults `LAB_VITE_PORT=5299 LAB_CDP_PORT=9299`, `trap lab_servers_down EXIT`, then `node scripts/perf-r2-parity.mjs "$@"` with the ports exported. If 5299 is already taken by a server that is NOT serving `sdf-game.html` (another chain's worktree), pick 5297/9297 by exporting the variables — never kill a server you did not start.

- [ ] **Step 2: Prove the harness on the shell seam first**

```bash
scripts/perf-r2-parity.sh capture /tmp/perf-r2/harness-check --room 3 --on "__sdfGame.setShell(true)" --off "__sdfGame.setShell(false)" --occupancy
```

Expected: noise floor at or near 0 pixels; `a-1 vs a-2` and `b-1 vs b-2` at the noise floor; `a vs b` shows the 11-pixel-class difference the 2026-08-31 gate recorded (the shell changes essentially nothing visible) while occupancy `rasterised` drops several-fold with the shell on. If `hits` reads 0 in any state, STOP: the page is not rendering bodies and the harness is wrong — do not debug the page.

- [ ] **Step 3: Task 1's parity gate**

```bash
scripts/perf-r2-parity.sh capture /tmp/perf-r2/task1-r3 --room 3 --on "__sdfGame.setHullExitBound(true)" --off "__sdfGame.setHullExitBound(false)" --occupancy
scripts/perf-r2-parity.sh capture /tmp/perf-r2/task1-r4 --room 4 --on "__sdfGame.setHullExitBound(true)" --off "__sdfGame.setHullExitBound(false)" --occupancy
```

Expected: `a vs b` within the noise floor (≤ 0.05% of pixels); `hits` identical on/off; `meanStepsMiss` lower with the bound on. If `a vs b` shows a halo hugging silhouettes in the cell map, report it as a finding and stop — do not tune.

- [ ] **Step 4: Notes and commit**

Write the noise floor, all four pair diffs per room, and the occupancy on/off into the `## Task 1` section of the notes (bench: `DEFERRED (machine loaded)` if any other task is running). Commit:

```bash
git add scripts/perf-r2-parity.mjs scripts/perf-r2-parity.sh docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md
git commit -m "scripts: perf-r2-parity — frozen in-page A/B/A/B capture + diff; task 1 parity recorded"
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

**Seam:** `perfCfg.y` (the uniform Task 1 added). `applyWounds` does not receive `perfCfg` today — add `perfCfg: vec4<f32>` as its LAST parameter and pass `perfCfg` through from `mapBody` (which must then also take it — add it LAST there too, and update the specialised/CPU mirrors' call sites only if they call `mapBody`; `calcNormal`, `coneMarch`, `woundShadow` and the scatter/AO probes call `mapBody`, so each gains the pass-through). Keep every other diff line untouched — the wound-r2 chain is editing this function concurrently. Game page: `view.uniforms.perfCfg.value.y = 1` beside the Task 1 apply; `__sdfGame.setWoundEarlyOut(on)` beside `setHullExitBound`.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (APPLY_WOUNDS ~605–640; `mapBody` and its callers for the pass-through)
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (the seam)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Check: `grep -rn "applyWounds\|carveWounds" src/lab/sdf-zombie/*.ts` — if a CPU mirror of the wound carve exists on your branch (the mesh-deform work had one), apply the identical early-out there in the same commit.

- [ ] **Step 1: Write the failing test**

```ts
  it('skips a wound before loading its meta/cap rows when the sample is out of reach (perf round 2 task 3)', () => {
    const iPos = APPLY_WOUNDS.indexOf(`vec2<i32>(i, ${ROW_WOUND})`);
    const iReach = APPLY_WOUNDS.indexOf('if (perfCfg.y > 0.5 && r > reach) { continue; }');
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
    if (perfCfg.y > 0.5 && r > reach) { continue; }
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

Use the Task 1b harness with `--on "__sdfGame.setWoundEarlyOut(true)" --off "__sdfGame.setWoundEarlyOut(false)"`. Wounds must exist first: extend the harness with an optional `--prelude "<js>"` evaluated after the freeze (e.g. a slug and a barrel of pellets into the nearest body via the bench's `aimSurface`/`fire` actions — read `game-bench-scenario.ts` and `__sdfGame.bench` for the seams), then re-settle. Expected: within noise floor. Also check the lab: `npm run blob:render-check -- zombie` exit 0 (the lab uploads no caps; the skip must be identical there too).

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

**Positional-parameter warning:** `marchBody`'s WGSL signature is bound POSITIONALLY by `createMarchMaterial` (`zombie-gpu.ts:600–605` records the day two slots were swapped and every beam knob silently broke). Add `prevT` as the LAST parameter, after `perfCfg` (Task 1's uniform), in both places.

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

Add `prevT: f32` after `perfCfg: vec4<f32>` in the signature. After the Task 1 `let tMax = ...` line:

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
    expect(MARCH_BODY.indexOf('perfCfg: vec4<f32>')).toBeLessThan(MARCH_BODY.indexOf('prevT: f32'));
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

`mapBody`'s `.w` return slot is NOT available — the wound-pass-r2 chain is taking it for the pre-wound field. The distortion rides a private global instead, exactly like `gFoldBestIdx` does: `mapBody` resets it, `foldGroup` writes it at the argmin, and MARCH_BODY reads it straight after its `mapBody` call (private globals are per-invocation, so this is the same contract the argmin already relies on).

- [ ] **Step 1: Failing test**

```ts
  it('tracks the dominant group distortion in a private global and divides the footprint epsilon by it', () => {
    expect(FOLD_GROUP).toContain('var<private> gFoldBestDistort: f32 = 1.0;');
    expect(FOLD_GROUP).toContain('if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }');
    expect(MAP_BODY).toContain('gFoldBestDistort = 1.0;');
    expect(MAP_BODY).not.toContain('nearWound, gFoldBestDistort');
    expect(MARCH_BODY).toContain('let distort = max(gFoldBestDistort, 1.0);');
    expect(MARCH_BODY).toContain('let hitEps = max(hitEpsBase, t * aaK / distort);');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t "distortion"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In FOLD_GROUP's tail declarations add `var<private> gFoldBestDistort: f32 = 1.0;` beside `gFoldBestIdx`, and change the argmin line to
`if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }`.
In MAP_BODY, reset `gFoldBestDistort = 1.0;` beside the other two resets. Do NOT touch the returns.
In MARCH_BODY, directly after the `let dres = mapBody(...)` line inside the loop, add `let distort = max(gFoldBestDistort, 1.0);`, then `let hitEps = max(hitEpsBase, t * aaK);` becomes `let hitEps = max(hitEpsBase, t * aaK / distort);` and the matching inner `-max(hitEpsBase, t * aaK)` becomes `-max(hitEpsBase, t * aaK / distort)`. The global is 1.0 for the volume branch and for any prim whose group has no distortion, so nothing changes at strength 0.

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

### Task 9: Bench sweep when the machine is quiet

Every bench step above may have been deferred. This task re-takes them all in one sitting, on the finished chain, using the live seams so each lever's delta is measured against the same session. **Trigger it only when no other dispatch task is running** (`grep -l 'status: running' ~/.claude/dispatch/plans/*.md` prints nothing but this task).

**Files:**
- Modify: `docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md`

- [ ] **Step 1: Baseline of the finished chain, then one lever off at a time**

```bash
BENCH_ROOMS=2,3,4 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

Then, using `BENCH_PRELUDE` if the bench script exposes one (read `scripts/sdf-game-bench.mjs` — if it does not, add an env var that evaluates a JS expression in the page after load, and commit that), repeat with each of: `__sdfGame.setHullExitBound(false)`, `__sdfGame.setOmega(0.6)`, `__sdfGame.setWoundEarlyOut(false)`, `__sdfGame.setDepthGate(false)`, `__sdfGame.setAa(0)`, `__sdfGame.setLevelShadow(false)`. Record a table: lever, room, median ms, spread, delta vs the finished chain. Note which bench steps in Tasks 1–8 were deferred and are now covered.

- [ ] **Step 2: Occupancy counters at the finished chain**

`__sdfGame.occupancy()` in rooms 3 and 4; record hits / marched / rasterised / mean steps.

- [ ] **Step 3: Commit**

```bash
git add docs/dev-notes/2026-09-01-sdf-perf-round2/notes.md scripts/sdf-game-bench.mjs
git commit -m "perf round 2: bench sweep on a quiet machine"
```

---

## Not in this plan, and why

- **Checkerboard rendering with the existing depth reprojection.** The right way to make C2 half-rate palatable, but the owner parked C2 until the post-fx colour-chain retune (`X1.3`). Revisit then; the reprojection in `sdf-layer.ts` hold mode 2 is most of it.
- **Prim-major data layout.** Speculative: GPU texture caches are tiled, so the 19 rows of one prim may already share lines. Only worth trying with a counter that shows texture-cache misses, which we do not have.
- **Body-on-body shadows.** Needs per-body shadow maps or a self-exclusion the hull cannot give. Task 7 gets the level's shadows, which is most of the read.
- **Relax 1.4.** Still blocked on the clamped-sample rework (`X1.game-relax`). Task 2 takes the safe part of that win.
