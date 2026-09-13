# Neural upscale run 5 — one-step SDF refinement at output resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the run-4 full-res head a real geometric signal — a Newton-refined surface point, a true output-res normal and the march's own lighting on it — computed per 800×600 pixel from the 400×300 march, then capture it, train against the run-4 head, and decide by eye.

**Architecture:** A per-body `sdf:refine` pass (a proxy-box twin mesh on its own layer, drawn once at output res with the body's march bindings) reuses the march's setup, post-hit material and lighting sections verbatim; only the walk is replaced by "interpolate the hit from the march texels, reject if the SDF disagrees, Newton-step, shade". Two output-res attachments (`refineC` lit rgb + clip depth, `refineN` world normal) feed a 17-channel head in PyTorch, the TS twin and WGSL, with capture v3.2 writing them per pair. Spec: `docs/superpowers/specs/2026-09-13-neural-upscale-run5-sdf-refine-design.md`.

**Tech Stack:** TypeScript + three.js WebGPU/TSL (`wgslFn`), WGSL, vitest (source-text pins + CPU twin), Python 3.12 + PyTorch via `uv` + pytest, Node capture/smoke scripts driving headless Chrome through `scripts/lab-servers.sh`.

---

## Conventions for every task

- Worktree: `/Users/donny/Projects/blud/.claude/worktrees/neural-upscaling-experiments-da69a4`. Run everything from there.
- Vitest one file: `npx vitest run <path>`. Python tests:
  ```bash
  (cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt --with pytest python -m pytest -q -p no:cacheprovider tests/<file>.py)
  ```
- Browser scripts need the lab servers (bash, not zsh — the helper uses `set -m`):
  ```bash
  bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node <script>'
  ```
- **Do not run the full vitest suite while a training grid or capture is live on this machine** (dualmem warning: OOMs and phantom failures). Run single files.
- Names used throughout (keep them exactly): WGSL `MARCH_TRACE_SETUP` / `MARCH_TRACE_LOOP` / `MARCH_TRACE_POST` / `REFINE_LOOP` / `REFINE_PARAMS` / `REFINE_BODY` (`fn refineBody`) / `gNormalEps`; layer `REFINE_LAYER = 9`, `refineTarget`, `refineSource`, `setRefine`, `setRefineView`, `setRefineCfg`; game `__sdfGame.setRefine/setRefineView/refineInfo`, `__sdfGameDebug.readRefine`; dataset files `refine_n.npy` / `refine_c.npy`, manifest keys `refineN` / `refineC`; Python `head_inputs` (`"detail" | "detail+refine"`), `Pair.refine` (8, 2h, 2w), `sample_with_extras`; model JSON `headInputs`; TS `HeadInputs`, `headInChannels()`, stage textures `refineN` / `refineC`.
- **Accept gate convention:** a refined pixel is accepted iff `refineC.w < 1.0` (clip depth, cleared to 1.0 — the march's own sentinel). `refineN.w` is 1.0 where written; never read it as the gate (the clear alpha is also 1.0).
- Commit after every task with the attribution trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | Split `MARCH_BODY_TRACE` into SETUP/LOOP/POST (textually identical concatenation); `gNormalEps` private in `CALC_NORMAL`; new `REFINE_LOOP`, `REFINE_PARAMS`, `REFINE_BODY` |
| `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` | Pins: concatenation identity, REFINE_LOOP declares what POST/PREP/LIGHT read, reject precedes Newton, no walk, eps default |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | `buildEntryFn`, `refineBody`, `RefineSource`/`createRefineUniforms`, `createMarchMaterial(..., extra)`, refine twin mesh per view |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` | `REFINE_LAYER`, refine target + MRT + pass + view pass, API, stage plumbing |
| `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` | Layer-constant uniqueness pin |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | `?refine=1` boot, twin wiring, `__sdfGame`/`__sdfGameDebug` API |
| `scripts/refine-smoke.mjs` | Boot, read back, check, PNG dump (Gate 1 artefact) |
| `scripts/lib/upscale-capture.mjs`, `scripts/upscale-capture-v2.mjs` | `readRefine`, per-pair `refine_n.npy` / `refine_c.npy` |
| `scripts/upscale-refine-check.py` | Dataset closeness check (capture stop gate) |
| `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` | §1 rows, §2 `headInputs`, §3 fixtures |
| `scripts/neural-upscale/nupscale/{constants,model,reconstruct,data,train,grid,evaluate,export}.py` + tests | 17-channel head, `Pair.refine`, `head_inputs` |
| `src/lab/sdf-zombie/webgpu/upscale/{upscale-model,upscale-reference,upscale-wgsl,upscale-stage,upscale-selfcheck}.ts` + tests | `headInputs`, twin, H1 taps, stage textures |
| `scripts/upscale-trained-parity.ts` | Refine fixtures |
| `scripts/sdf-game-bench.mjs` | `refine-on` leg, ship-default pin |
| `TASKS.md`, `docs/dev-notes/2026-09-12-upscaler-next-steps.md` | Status, §14 |

---

## Task 1: Split `MARCH_BODY_TRACE` into SETUP / LOOP / POST (bit-identical)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (the `MARCH_BODY_TRACE` constant, currently lines ~2351–3577)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

The split points, as of HEAD c2b45d7b (verify with the grep in step 1):
- `MARCH_TRACE_SETUP`: from the first line of the trace (`  // FIRST STATEMENT, before anything folds...`) up to and **excluding** the line `  var t = clamp(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), 0.0, tMax);`
- `MARCH_TRACE_LOOP`: from that `var t = clamp(` line up to and **excluding** `  if (!hit) { discard; }`
- `MARCH_TRACE_POST`: from `  if (!hit) { discard; }` to the end of the trace text.

- [ ] **Step 1: Confirm the anchors**

Run:
```bash
grep -n 'var t = clamp(max(max(max(max(startT\|^  var hit = false;\|if (!hit) { discard; }\|^export const MARCH_BODY_TRACE\|^export const MARCH_BODY_SURFACE_PREP' src/lab/sdf-zombie/webgpu/march.wgsl.ts
```
Expected: exactly one line each for `var t = clamp(`, `var hit = false;` (the next line), `if (!hit) { discard; }`, and the two `export const` lines, in that order.

- [ ] **Step 2: Write the failing pin test**

Append to `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`:
```ts
describe('run 5: MARCH_BODY_TRACE is SETUP + LOOP + POST', () => {
  it('concatenates textually and splits at the walk', async () => {
    const m = await import('./march.wgsl');
    expect(m.MARCH_BODY_TRACE).toBe(`${m.MARCH_TRACE_SETUP}${m.MARCH_TRACE_LOOP}${m.MARCH_TRACE_POST}`);
    expect(m.MARCH_TRACE_LOOP.startsWith('  var t = clamp(max(max(max(max(startT')).toBe(true);
    expect(m.MARCH_TRACE_POST.startsWith('  if (!hit) { discard; }')).toBe(true);
    expect(m.MARCH_TRACE_SETUP).not.toContain('for (var i = 0; i < 512');
    expect(m.MARCH_TRACE_LOOP).toContain('for (var i = 0; i < 512');
    expect(m.MARCH_TRACE_POST).not.toContain('for (var i = 0; i < 512');
  });
});
```

- [ ] **Step 3: Run it, expect failure**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t 'run 5'`
Expected: FAIL — `MARCH_TRACE_SETUP` is undefined.

- [ ] **Step 4: Split the constant**

In `march.wgsl.ts`, replace the single template literal with three, then define the old name as their concatenation. Cut the text at exactly the two anchor lines (the anchor line starts the next section). Keep every character, including the leading two spaces and trailing newlines:
```ts
export const MARCH_TRACE_SETUP = /* wgsl */ `  // FIRST STATEMENT, before anything folds. ...
  ...everything up to the line before `var t = clamp(`...
`;
/** Run 5 (plan 2026-09-13-neural-upscale-run5-sdf-refine): the walk alone — from `var t` to the
 *  line before `if (!hit) { discard; }`. REFINE_LOOP replaces exactly this section. */
export const MARCH_TRACE_LOOP = /* wgsl */ `  var t = clamp(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), 0.0, tMax);
  var hit = false;
  ...
`;
export const MARCH_TRACE_POST = /* wgsl */ `  if (!hit) { discard; }
  ...to the old end...
`;
export const MARCH_BODY_TRACE = `${MARCH_TRACE_SETUP}${MARCH_TRACE_LOOP}${MARCH_TRACE_POST}`;
```
Watch for backticks and `${...}` inside the trace text (e.g. `${TILE_MAX_ENTRIES}`, `${DATA_ROWS}`): they stay template interpolations in whichever piece they land in.

- [ ] **Step 5: Run the pin and the existing assembly pins**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts`
Expected: all PASS (the `MARCH_BODY` assembly pin and the deferred `marchSurface` pin prove the text is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "refactor(march): split MARCH_BODY_TRACE into SETUP/LOOP/POST (textually identical) for the run-5 refine entry"
```

---

## Task 2: `gNormalEps` — the normal stencil size becomes a private (default unchanged)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (`CALC_NORMAL`, line ~1746)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Failing pin**

Append to the run-5 describe block:
```ts
  it('calcNormal takes its stencil size from gNormalEps, default 0.0015', async () => {
    const m = await import('./march.wgsl');
    expect(m.CALC_NORMAL).toContain('var<private> gNormalEps: f32 = 0.0015;');
    expect(m.CALC_NORMAL).toContain('let e = vec2<f32>(1.0, -1.0) * gNormalEps;');
    expect(m.CALC_NORMAL).not.toContain('* 0.0015;');
  });
```
Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t 'gNormalEps'` — expect FAIL.

- [ ] **Step 2: Implement**

In `CALC_NORMAL` change `let e = vec2<f32>(1.0, -1.0) * 0.0015;` to `let e = vec2<f32>(1.0, -1.0) * gNormalEps;` and append after the function's closing brace, inside the same template literal:
```wgsl
// Run 5: the refine entry (REFINE_LOOP) sets this to its output-pixel footprint; the march never
// touches it, so x * 0.0015 is the exact pre-run-5 stencil.
var<private> gNormalEps: f32 = 0.0015;
```
(The private trails the fn because `wgslFn`'s parser is `^fn`-anchored — the `MARCH_NORMAL_OUT` pattern.)

- [ ] **Step 3: Run the file, then the march parity gate**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — PASS.
Run the in-browser march parity (the G1-class gate that proves the frame is unchanged):
```bash
bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node scripts/sdf-game-parity.mjs'
```
Expected: the script's PASS line (read its header for the exact wording; any pixel diff is a failure of this task).

- [ ] **Step 4: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "feat(march): gNormalEps private for the normal stencil (default 0.0015, march unchanged)"
```

---

## Task 3: `REFINE_LOOP` + `REFINE_PARAMS` + `REFINE_BODY` (WGSL only, pinned by tests)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (append after `MARCH_BODY`)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Failing pins (derived from the source, so they cannot rot)**

Append to the run-5 describe block:
```ts
  it('REFINE_BODY is params + setup + REFINE_LOOP + post + prep + light, with four refine params appended', async () => {
    const m = await import('./march.wgsl');
    expect(m.REFINE_BODY).toBe(`fn refineBody${m.REFINE_PARAMS}${m.MARCH_TRACE_SETUP}${m.REFINE_LOOP}${m.MARCH_TRACE_POST}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`);
    expect(m.REFINE_PARAMS.endsWith('  marchTex: texture_2d<f32>,\n  cosRay: f32,\n  nearFar: vec2<f32>,\n  refineCfg: vec4<f32>\n) -> vec4<f32> {\n')).toBe(true);
    expect(m.REFINE_PARAMS.startsWith(m.MARCH_BODY_PARAMS.slice(0, m.MARCH_BODY_PARAMS.lastIndexOf(')')))).toBe(true);
  });
  it('REFINE_LOOP declares every name the walk declares that the later sections read', async () => {
    const m = await import('./march.wgsl');
    const later = `${m.MARCH_TRACE_POST}${m.MARCH_BODY_SURFACE_PREP}${m.MARCH_BODY_LIGHT}`;
    const declared = [...m.MARCH_TRACE_LOOP.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map((x) => x[1]!);
    const needed = [...new Set(declared)].filter((n) => new RegExp(`\\b${n}\\b`).test(later));
    expect(needed.length).toBeGreaterThan(0);
    for (const n of needed) expect(m.REFINE_LOOP, `REFINE_LOOP must declare ${n}`).toMatch(new RegExp(`\\b(?:let|var)\\s+${n}\\b`));
  });
  it('REFINE_LOOP rejects on the SDF distance before any Newton step, never walks, and sets gNormalEps', async () => {
    const m = await import('./march.wgsl');
    expect(m.REFINE_LOOP).not.toContain('for (var i = 0; i < 512');
    const reject = m.REFINE_LOOP.indexOf('refineCfg.y');
    const newton = m.REFINE_LOOP.indexOf('t = t + dres.x');
    expect(reject).toBeGreaterThan(-1); expect(newton).toBeGreaterThan(reject);
    expect(m.REFINE_LOOP).toContain('gNormalEps = ');
    expect(m.REFINE_LOOP).toContain('if (wsum <= 0.0) { discard; }');
  });
```
Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts -t 'REFINE'` — expect FAIL (undefined exports).

- [ ] **Step 2: Find what the walk defines for the later sections**

Run (prints the names the second pin will demand):
```bash
node -e "
const m=require('fs').readFileSync('src/lab/sdf-zombie/webgpu/march.wgsl.ts','utf8');
const g=(n)=>m.match(new RegExp('export const '+n+' = (?:/\\\\* wgsl \\\\*/ )?\`([\\\\s\\\\S]*?)\`;'))[1];
const loop=g('MARCH_TRACE_LOOP'), later=g('MARCH_TRACE_POST')+g('MARCH_BODY_SURFACE_PREP')+g('MARCH_BODY_LIGHT');
const d=[...new Set([...loop.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g)].map(x=>x[1]))];
console.log(d.filter(n=>new RegExp('\\\\b'+n+'\\\\b').test(later)).join(' '));"
```
Expected: a list including at least `t hit hitBest hitNearWound` (there will be more — e.g. the hit field sample and step bookkeeping). Every printed name gets a declaration in REFINE_LOOP below, with the same type the walk gives it; for names that are pure walk bookkeeping (step counters, previous radius, omega flags) initialise to the value the walk would hold at a clean hit (`0.0` / `false` / `-1`), reading their declarations in `MARCH_TRACE_LOOP` to pick the type.

- [ ] **Step 3: Write the WGSL**

Append after `export const MARCH_BODY = ...`:
```ts
/**
 * RUN 5 (spec docs/superpowers/specs/2026-09-13-neural-upscale-run5-sdf-refine-design.md §4).
 * The refine entry shares the march's PARAMS (+4 appended), SETUP, POST, SURFACE_PREP and LIGHT
 * sections verbatim; only the walk is replaced. Per OUTPUT pixel: the hit comes from the four
 * surrounding march texels (hit-gated bilinear of linear view depth, along THIS pixel's ray), the
 * body's own SDF rejects the pixel if it disagrees by more than refineCfg.y march texels (another
 * body, or an edge — the net keeps owning edges), then refineCfg.w Newton steps land on the true
 * surface and the normal stencil shrinks to refineCfg.z of an OUTPUT pixel's footprint.
 * refineCfg: x = enabled (0 discards everything), y = reject in march texels (1.0),
 *            z = normal stencil in output-pixel footprints (0.25), w = Newton steps (2).
 */
export const REFINE_LOOP = /* wgsl */ `  if (refineCfg.x < 0.5) { discard; }
  // The march texel grid under this output pixel (coneFetch's mapping: screenUV * dims, nearest).
  let mDims = vec2<f32>(textureDimensions(marchTex, 0));
  let mMax = vec2<i32>(mDims) - vec2<i32>(1, 1);
  let q = screenUV * mDims - vec2<f32>(0.5, 0.5);
  let c0 = clamp(vec2<i32>(floor(q)), vec2<i32>(0, 0), mMax);
  let fr = clamp(q - vec2<f32>(c0), vec2<f32>(0.0), vec2<f32>(1.0));
  var zsum = 0.0;
  var wsum = 0.0;
  for (var k = 0; k < 4; k = k + 1) {
    let dx = k & 1;
    let dy = k >> 1;
    let mc = textureLoad(marchTex, clamp(c0 + vec2<i32>(dx, dy), vec2<i32>(0, 0), mMax), 0);
    if (mc.w >= 1.0) { continue; }
    let z = nearFar.x * nearFar.y / (nearFar.y - mc.w * (nearFar.y - nearFar.x));
    let wgt = (1.0 - abs(fr.x - f32(dx))) * (1.0 - abs(fr.y - f32(dy)));
    zsum = zsum + z * wgt;
    wsum = wsum + wgt;
  }
  if (wsum <= 0.0) { discard; }
  // View depth -> distance along this pixel's ray (cosRay = -(V * rd).z, bound by the material).
  var t = clamp((zsum / wsum) / max(cosRay, 1e-4), 0.0, tMax);
  var hit = false;
  var hitBest = -1;
  var hitNearWound = false;
  // ...one declaration per name printed by Task 3 step 2 that is not listed above, initialised to
  // its clean-hit value (see the walk's own declaration for the type)...
  var p = camPos + rd * t;
  // COPY the walk's mapBody call verbatim (same argument list as the march loop's `dres = mapBody(`).
  var dres = mapBody(p, /* ...the march loop's exact arguments... */);
  let texelFoot = 2.0 * t * aaCfg.x;   // one MARCH texel's world footprint at this depth
  if (abs(dres.x) > refineCfg.y * max(texelFoot, 1e-4)) { discard; }
  for (var k = 0; k < i32(refineCfg.w); k = k + 1) {
    t = t + dres.x;
    p = camPos + rd * t;
    dres = mapBody(p, /* ...same arguments... */);
  }
  hit = true;
  hitBest = i32(dres.y);
  hitNearWound = dres.z > 0.5;
  gNormalEps = max(refineCfg.z * t * aaCfg.x, 2e-4);   // aaCfg.x is a MARCH texel radius; an output pixel is half
`;
export const REFINE_PARAMS = MARCH_BODY_PARAMS.slice(0, MARCH_BODY_PARAMS.lastIndexOf(')')).replace(/\s*$/, '') +
  `,\n  marchTex: texture_2d<f32>,\n  cosRay: f32,\n  nearFar: vec2<f32>,\n  refineCfg: vec4<f32>\n) -> vec4<f32> {\n`;
export const REFINE_BODY = `fn refineBody${REFINE_PARAMS}${MARCH_TRACE_SETUP}${REFINE_LOOP}${MARCH_TRACE_POST}${MARCH_BODY_SURFACE_PREP}${MARCH_BODY_LIGHT}`;
```
Notes for the executor:
- Look at `MARCH_TRACE_LOOP` for the exact `mapBody(` argument list the walk uses (it passes `noiseShift`, `perfCfg`, `woundBound` etc. from SETUP) and copy it twice.
- If `MARCH_TRACE_POST` reads the walk's field sample under another name (e.g. `hitField`), declare it in REFINE_LOOP as `dres` copied into that name after the Newton loop.
- If the walk declares `p` with `let` inside the loop and POST re-declares its own `p` from `t`, do not declare `p` with `var` in REFINE_LOOP under a colliding name — use `pRef` for the local and let POST derive `p` from `t` as it already does. The derived pin only demands names POST/PREP/LIGHT *read*.
- `MARCH_TRACE_SETUP` already defines `rd`, `tMax`, `bodyEntry`, `noiseShift`; do not redeclare.

- [ ] **Step 4: Run the pins**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
Expected: PASS, including the derived-names pin. If it names a variable you did not expect, declare it (step 2's rule) rather than loosening the test.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
git commit -m "feat(march): REFINE_BODY — the run-5 output-res refine entry on the march's shared sections"
```

---

## Task 4: `refineBody` node, `RefineSource`, `createMarchMaterial(..., extra)` and the refine twin mesh

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (`buildMarchFn` ~line 185, `createMarchMaterial` ~981–1316, `DepthPreSource` ~925, view creation ~1790–1960, sync ~1990)
- Test: `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts` (create if absent; a source-text pin is enough — the real gate is the compile smoke in Task 6)

- [ ] **Step 1: Failing pin**

Create or append to `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
describe('run 5 refine twin (source pins)', () => {
  const src = readFileSync(new URL('./zombie-gpu.ts', import.meta.url), 'utf8');
  it('builds refineBody on the march chain and binds the four refine inputs by name', () => {
    expect(src).toContain('export const refineBody = buildEntryFn(REFINE_BODY);');
    expect(src).toContain('export const marchBody = buildEntryFn(MARCH_BODY);');
    for (const k of ['marchTex:', 'cosRay:', 'nearFar:', 'refineCfg:']) expect(src).toContain(k);
    expect(src).toContain('refineObject:');
  });
});
```
Run: `npx vitest run src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts` — FAIL.

- [ ] **Step 2: `buildEntryFn` and `refineBody`**

In `zombie-gpu.ts` import `REFINE_BODY` from `./march.wgsl` (line ~35 import list), then generalise the builder:
```ts
function buildEntryFn(entry: string) {
  const sources = [...HELPERS, ...NORMAL_GRADIENT_HELPERS, ...NORMAL_GRADIENT_GAME_HELPERS, TEMPORAL_START_WGSL];
  const nodes = sources.reduce<ReturnType<typeof wgslFn>[]>(
    (acc, src) => [...acc, wgslFn(src, acc.slice(-1))], [marchNormalRead],
  );
  return wgslFn(entry, nodes.slice(-1));
}
export const marchBody = buildEntryFn(MARCH_BODY);
/** Run 5: the output-res refine entry (REFINE_BODY) on the same helper chain — same gMarchNormal
 *  private, so the layer's MRT read of the normal works for both. */
export const refineBody = buildEntryFn(REFINE_BODY);
```
(Keep the explanatory comments that were in `buildMarchFn`; delete `buildMarchFn`.)

- [ ] **Step 3: `RefineSource` and `createRefineUniforms`**

Next to `DepthPreSource`:
```ts
/** Run 5: what the refine twin binds — the march target (400×300 colour + clip depth in alpha)
 *  and the layer's refine uniforms. cfg: x enabled, y reject (march texels), z normal stencil
 *  (output-pixel footprints), w Newton steps. */
export function createRefineUniforms() {
  return { cfg: uniform(new THREE.Vector4(0, 1, 0.25, 2)), nearFar: uniform(new THREE.Vector2(0.1, 200)) };
}
export type RefineUniforms = ReturnType<typeof createRefineUniforms>;
export interface RefineSource { texture: THREE.Texture; uniforms: RefineUniforms }
```

- [ ] **Step 4: `createMarchMaterial(..., extra)`**

Add a final optional parameter after `lastFrame?: LastFrameSource`:
```ts
  // Run 5: extra named inputs for an entry whose signature extends MARCH_BODY_PARAMS (refineBody).
  // Spread LAST into the call object; bound by name like every other input.
  extra?: Record<string, unknown>,
```
and at the end of the `march({ ... })` call object, after `temporalCfg: ...,` add `...(extra ?? {}),`. Hoist the `cosRay` expression so it can be reused: just above the call, `const cosRay = mul(cameraViewMatrix, vec4(rayDir, 0.0)).z.negate();` and use it in the existing `prevFetchNode({ ... cosRay: ... })` too.

- [ ] **Step 5: The refine twin in the view**

In the view creation, after the depth-prepass twin block, add (mirroring it):
```ts
  // Run 5: the output-res refine twin — same proxy box, the refineBody entry, its own layer.
  // No cone/occluder/shell/prev/depthPre sources: the fetch identities keep SETUP's gates open and
  // the refine reads its start from the march texels instead. Chunks get no twin (see depthPre).
  let refineMesh: THREE.Mesh | undefined;
  if (opts.refine) {
    const refineMaterial = createMarchMaterial(dataTex, volumeTex, u, refineBody, undefined, undefined,
      viewTiles ? { header: viewTiles.header, entries: viewTiles.entries } : undefined,
      undefined, undefined, opts.levelShadow, undefined, undefined, 'lit', undefined, opts.probeDyn?.node, undefined, {
        marchTex: texture(opts.refine.texture),
        cosRay: mul(cameraViewMatrix, vec4(normalize(sub(positionWorld, cameraPosition)), 0.0)).z.negate(),
        nearFar: opts.refine.uniforms.nearFar,
        refineCfg: opts.refine.uniforms.cfg,
      });
    refineMesh = new THREE.Mesh(mesh.geometry, refineMaterial);
    refineMesh.frustumCulled = false;
    refineMesh.position.copy(mesh.position);
  }
```
Match the positional arguments to `createMarchMaterial`'s real signature at the time of editing (read it; the tiles argument is whatever the main material passes). Return `refineObject: refineMesh` next to `depthPreObject`, add `refine?: RefineSource` to the view options interface (line ~1588, next to `depthPre?`), and in the sync method copy position/scale to `refineMesh` exactly as `depthPreMesh` is handled.

- [ ] **Step 6: Typecheck and pin**

Run: `npx tsc --noEmit -p . 2>&1 | head -20` — expect no errors in `zombie-gpu.ts`.
Run: `npx vitest run src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts` — PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
git commit -m "feat(zombie-gpu): refineBody entry, RefineSource, createMarchMaterial extra inputs, refine twin mesh"
```

---

## Task 5: The layer — `sdf:refine` pass, targets, MRT, API, refine view, stage plumbing

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts`
- Test: `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`

- [ ] **Step 1: Failing pins**

Append to `sdf-layer.test.ts`:
```ts
describe('run 5 refine pass (source pins)', () => {
  it('REFINE_LAYER is a new, unique layer and the pass is labelled sdf:refine', async () => {
    const m = await import('./sdf-layer');
    const layers = [m.SDF_LAYER, m.CONE_LAYER, m.OCCLUDER_LAYER, m.SHELL_LAYER, m.SHELL_EXIT_LAYER, m.SHADOW_HULL_LAYER, m.DEPTH_PREPASS_LAYER, m.FIELD_MESH_LAYER, m.REFINE_LAYER];
    expect(new Set(layers).size).toBe(layers.length);
    expect(m.REFINE_LAYER).toBe(9);
    const src = readFileSync(new URL('./sdf-layer.ts', import.meta.url), 'utf8');
    expect(src).toContain("setPassLabel('sdf:refine')");
    expect(src).toContain("setPassLabel('sdf:refine-view')");
  });
});
```
(Add `import { readFileSync } from 'node:fs'` if the file lacks it.) Run the file — FAIL.

- [ ] **Step 2: Option, constant, uniforms, targets**

- `export const REFINE_LAYER = 9;` after `FIELD_MESH_LAYER` with a comment: run-5 refine twins.
- `SdfLayerOptions.refine?: boolean` (doc: "Run 5: allocate the output-res refine targets and run the per-body refine pass; implies `marchNormals`").
- In `createSdfLayer`: `const refineOn = options.refine === true; const marchNormals = options.marchNormals === true || refineOn;`
- After `detailTarget`:
```ts
  // RUN 5 REFINE (spec 2026-09-13-neural-upscale-run5-sdf-refine-design §4): two OUTPUT-res
  // attachments written by the refine twins under a hardware depth test (nearest body wins).
  // [0] 'output' = re-lit linear rgb, w = clip depth (accepted iff w < 1.0 — the march's sentinel);
  // [1] 'refineN' = world-space unit normal, w = 1 where written. FloatType so readback is exact.
  const refineUniforms = createRefineUniforms();
  const refineTarget = new THREE.RenderTarget(1, 1, {
    depthBuffer: true, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, count: refineOn ? 2 : 1,
  });
  let refineMrt: unknown = null;
  if (refineOn) {
    refineTarget.textures[0]!.name = 'output';
    refineTarget.textures[1]!.name = 'refineN';
    refineMrt = mrt({ output, refineN: marchNormalRead({ dep: output as never }) });
  }
  let refineView = false;
```
Import `createRefineUniforms` and `type RefineSource` from `./zombie-gpu`.
- In `setSize`/resize where `detailTarget.setSize(fullW, fullH)` happens: `if (refineOn) { refineTarget.setSize(Math.max(1, fullW), Math.max(1, fullH)); refineViewTarget.setSize(...same...); }`.
- Wherever the layer learns `near`/`far` for the upscale stage (`uNearFar` in the stage is fed from the camera in `render`; find the line that sets the stage's near/far or reads `camera.near`), also set `refineUniforms.nearFar.value.set(camera.near, camera.far)` each frame before the refine pass.

- [ ] **Step 3: The pass**

Right after the `sdf:detail` block in `render` (before `if (upscale) upscale.render(...)`):
```ts
      if (refineOn && refineUniforms.cfg.value.x > 0.5) {
        setPassLabel('sdf:refine');
        camera.layers.set(REFINE_LAYER);
        renderer.setRenderTarget(refineTarget);
        renderer.clear();   // colour alpha 1.0 = not refined; depth cleared for the per-body test
        renderer.setMRT(refineMrt as never);
        try { void renderer.render(scene, camera); } finally { renderer.setMRT(null); }
        camera.layers.set(SDF_LAYER);
      }
```
Check the clear colour in force at that point leaves alpha at 1.0 (the march target relies on the same clear; if the layer sets a clear colour with alpha 0 anywhere before, set `renderer.setClearAlpha(1)` around the clear and restore).

- [ ] **Step 4: The debug view pass (Gate 1's picture)**

A fullscreen material over the composite's output-res input: where accepted, the re-lit colour and its depth; elsewhere the current output-res source (the upscale output when the stage is on, else the march texel nearest-upsampled).
```ts
  const refineViewTarget = new THREE.RenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const REFINE_VIEW_WGSL = /* wgsl */ `fn refineView(refineC: texture_2d<f32>, src: texture_2d<f32>, texCoord: vec2<f32>, flipY: f32, srcIsLow: f32) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(refineC, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let p = clamp(vec2<i32>(floor(st * vec2<f32>(dims))), vec2<i32>(0, 0), dims - vec2<i32>(1, 1));
  let rc = textureLoad(refineC, p, 0);
  if (rc.w < 1.0) { return rc; }
  let sdims = vec2<i32>(textureDimensions(src, 0));
  let sp = clamp(select(p, p / 2, srcIsLow > 0.5), vec2<i32>(0, 0), sdims - vec2<i32>(1, 1));
  return textureLoad(src, sp, 0);
}`;
```
Build a `refineViewScene` like `detailScene` (`wgslFn(REFINE_VIEW_WGSL)` with `refineC: texture(refineTarget.textures[0])`, `src: refineViewSrcNode` (a `texture(...)` node whose `.value` is switched), `texCoord: uv()`, `flipY: uFlipY`, `srcIsLow: uRefineViewSrcLow`). In `render`, after the upscale stage runs:
```ts
      if (refineOn && refineView) {
        setPassLabel('sdf:refine-view');
        refineViewSrcNode.value = upscale ? upscale.output.texture : target.texture;
        (uRefineViewSrcLow.value as number) = upscale ? 0 : 1;
        renderer.setRenderTarget(refineViewTarget);
        void renderer.render(refineViewScene, quadCam);
        accumTexNode.value = refineViewTarget.texture;
        (uAccumOn.value as number) = 1;
      }
```
and when the view is turned off restore `accumTexNode.value` / `uAccumOn` to what `setUpscale`/accumulation would have set (call the same code path `setUpscale` uses to point the composite at the stage output, or `accumNext.texture` with `uAccumOn` per `accumOn`).

- [ ] **Step 5: Public API and stage plumbing**

Add to the `SdfLayer` interface and the returned object:
```ts
  /** Run 5: the refine twins' bindings (march target + refine uniforms); null unless created with `refine`. */
  readonly refineSource: RefineSource | null;
  /** Run 5: [0] re-lit rgb + clip depth (accepted iff w < 1), [1] world normal; output-res; null unless `refine`. */
  readonly refineTarget: THREE.RenderTarget | null;
  setRefine(on: boolean): void;            // cfg.x
  readonly refine: boolean;
  setRefineCfg(cfg: { reject?: number; normalEps?: number; steps?: number }): void;   // cfg.y/z/w
  readonly refineCfg: { reject: number; normalEps: number; steps: number };
  setRefineView(on: boolean): void;        // the Gate-1 picture in place of the composite source
  readonly refineView: boolean;
```
`refineSource` = `refineOn ? { texture: target.texture, uniforms: refineUniforms } : null`. `setRefine(true)` on a layer without `refine` throws `new Error('refine: boot with ?refine=1 so the layer allocates the refine targets')`.

In `setUpscale`, pass the refine textures to the stage (Task 12 adds the parameter): `createUpscaleStage(config, target.texture, uFlipY, model, marchNormals ? target.textures[1] : undefined, detailScene ? detailTarget.texture : undefined, refineOn ? { n: refineTarget.textures[1]!, c: refineTarget.textures[0]! } : undefined)`. Until Task 12 lands, pass only the first six arguments (this task must typecheck on its own).

- [ ] **Step 6: Typecheck, pins, parity**

Run: `npx tsc --noEmit -p . 2>&1 | head` — clean.
Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` — PASS.
Run the march parity script (Task 2 step 3 command) — PASS (the layer without `refine` is unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/sdf-layer.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts
git commit -m "feat(sdf-layer): run-5 refine pass (REFINE_LAYER twins, 2-attachment output-res target), refine view, API"
```

---

## Task 6: Game wiring, `?refine=1`, debug API, `scripts/refine-smoke.mjs` → **Gate 1**

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (boot flag ~821, view creation ~2480–2500, scene add ~2589, `__sdfGame` ~7220, `__sdfGameDebug` ~8165–8260)
- Create: `scripts/refine-smoke.mjs`

- [ ] **Step 1: Boot flag and layer option**

Replace the `marchNormalsWanted` IIFE's tail so a refine boot also allocates normals, and add `refineWanted`:
```ts
  const refineWanted = (() => {
    const q = new URLSearchParams(location.search);
    if (q.get('refine') === '1') return true;
    if (q.get('refine') === '0') return false;
    return /headr(-|$)/.test(q.get('upscalemodel') ?? '');   // run-5 trained exports are named *-headr-*
  })();
  const marchNormalsWanted = refineWanted || (() => { /* the existing body */ })();
  const sdfLayer = createSdfLayer(handle.renderer, { marchNormals: marchNormalsWanted, refine: refineWanted });
```
After the layer exists: `if (refineWanted) sdfLayer.setRefine(true);`

- [ ] **Step 2: Views and scene**

In the `createZombieView({...})` call add `refine: sdfLayer.refineSource ?? undefined,` next to `depthPre`. Where `view.depthPreObject` is layered/added/registered, add the same three lines for `view.refineObject` with `REFINE_LAYER` (import it) and `'exclude'`; where actors are removed (`scene.remove(a.view.coneObject)` ~2769), also remove `refineObject` when present.

- [ ] **Step 3: `__sdfGame` and `__sdfGameDebug`**

In the `__sdfGame` object:
```ts
    setRefine: (on: boolean) => { sdfLayer.setRefine(on); return sdfLayer.refine; },
    setRefineView: (on: boolean) => { sdfLayer.setRefineView(on); return sdfLayer.refineView; },
    setRefineCfg: (cfg: { reject?: number; normalEps?: number; steps?: number }) => { sdfLayer.setRefineCfg(cfg); return sdfLayer.refineCfg; },
    refineInfo: () => ({ allocated: sdfLayer.refineSource !== null, on: sdfLayer.refine, view: sdfLayer.refineView, cfg: sdfLayer.refineCfg }),
```
In `__sdfGameDebug`, factor the body of `readDetailTarget` into a local `packFloatTarget(t: THREE.RenderTarget, index = 0)` (same de-pad, add the `textureIndex` argument to `readRenderTargetPixelsAsync`), make `readDetailTarget` call it, and add:
```ts
        /** Run 5: both refine attachments as { w, h, rgba32f }; null unless the boot allocated them. */
        async readRefine() {
          const t = sdfLayer.refineTarget;
          if (!t) return null;
          handle.setLoopRunning(false); handle.step(0); await handle.resolveGpu();
          return { c: await packFloatTarget(t, 0), n: await packFloatTarget(t, 1) };
        },
```

- [ ] **Step 4: The smoke script**

Create `scripts/refine-smoke.mjs` modelled on the run-4 look script (`.lab-tmp/detail-shot.mjs` in worktree agitated-jennings-f0650e; copy its `png()` helper and boot sequence) and `scripts/upscale-smoke.mjs`'s exit discipline:
```js
// Run 5 refine smoke + Gate-1 look: boots ?frozen=1&vhs=off&upscale=0&refine=1, stages the close-up,
// reads both refine attachments and the march, checks them, dumps refine-c.png / refine-n.png / frame.png.
// PASS criteria: accepted pixels ⊆ march hits (nearest-up), every accepted normal unit (|len-1| < 1e-3),
// accepted count > 0, refine-c rgb finite. Exit 0 on PASS, 1 otherwise; prints one JSON line.
import { writeFileSync, mkdirSync } from 'node:fs';
import { applyShipDefaults, bootCloseupPage, connectGame, stageCloseUp } from './lib/sdf-closeup-stage.mjs';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5323), CDP = Number(process.env.LAB_CDP_PORT ?? 9323);
const OUT = process.env.REFINE_SMOKE_OUT ?? '.lab-tmp/refine-smoke';
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
setTimeout(() => fail('watchdog'), 6 * 60_000).unref();
mkdirSync(OUT, { recursive: true });
const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: 1280, height: 800, onFail: fail });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0&refine=1`, fail });
await applyShipDefaults(evaluate);
const staged = await stageCloseUp(evaluate, { room: 1 }, fail);
await evaluate('(() => { __sdfGame.setSdfScale(0.5); __sdfGame.setRefine(true); __sdfGame.step(6); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const f32 = (r) => { const b = Buffer.from(r.rgba32f, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const ref = await evaluate('__sdfGameDebug.readRefine()', 120_000); if (!ref) fail('readRefine null (refine not allocated)');
const march = await evaluate('__sdfGameDebug.readMarchTarget()', 120_000);
const c = f32(ref.c), n = f32(ref.n), m = f32(march);
const W = ref.c.w, H = ref.c.h, mw = march.w;
let accepted = 0, outsideHit = 0, badNormal = 0, nonFinite = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x; if (c[i * 4 + 3] >= 1) continue; accepted++;
  const mi = ((y >> 1) * mw + (x >> 1)) * 4; if (m[mi + 3] >= 1) outsideHit++;
  const len = Math.hypot(n[i * 4], n[i * 4 + 1], n[i * 4 + 2]); if (Math.abs(len - 1) > 1e-3) badNormal++;
  for (let k = 0; k < 3; k++) if (!Number.isFinite(c[i * 4 + k])) nonFinite++;
}
// PNGs: refine-c tone-mapped like the game's presented frame is NOT needed — raw linear clamped is enough to look at.
const rgbC = new Uint8Array(W * H * 3), rgbN = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) { const acc = c[i * 4 + 3] < 1; for (let k = 0; k < 3; k++) { rgbC[i * 3 + k] = acc ? Math.max(0, Math.min(255, Math.round(Math.pow(c[i * 4 + k], 1 / 2.2) * 255))) : 20; rgbN[i * 3 + k] = acc ? Math.round((n[i * 4 + k] * 0.5 + 0.5) * 255) : 20; } }
writeFileSync(`${OUT}/refine-c.png`, png(W, H, rgbC)); writeFileSync(`${OUT}/refine-n.png`, png(W, H, rgbN));
await evaluate('__sdfGame.setRefineView(true)'); await evaluate('(() => { __sdfGame.step(2); return 1; })()'); await evaluate('__sdfGame.resolveGpu()');
writeFileSync(`${OUT}/frame-refine-view.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
await evaluate('__sdfGame.setRefineView(false)'); await evaluate('(() => { __sdfGame.step(2); return 1; })()'); await evaluate('__sdfGame.resolveGpu()');
writeFileSync(`${OUT}/frame-shipped.png`, Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
const problems = [];
if (accepted === 0) problems.push('no accepted pixels');
if (outsideHit > 0) problems.push(`${outsideHit} accepted pixels outside march hits`);
if (badNormal > accepted * 0.001) problems.push(`${badNormal} non-unit normals`);
if (nonFinite) problems.push(`${nonFinite} non-finite colour values`);
console.log(JSON.stringify({ staged, w: W, h: H, accepted, outsideHit, badNormal, nonFinite, out: OUT }));
if (problems.length) { for (const p of problems) console.error('PROBLEM:', p); console.log('REFINE SMOKE: FAIL'); process.exit(1); }
console.log('REFINE SMOKE: PASS'); process.exit(0);
```
(Paste the `png()` helper from the detail-shot script above the boot.)

- [ ] **Step 5: Run the compile smoke and the refine smoke**

```bash
bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node scripts/upscale-smoke.mjs && node scripts/refine-smoke.mjs'
```
Expected: `upscale-smoke` PASS (no `GPUValidationError` in the console — a WGSL name collision between a TSL var and a generated fn shows up ONLY here); `REFINE SMOKE: PASS` with `accepted` in the tens of thousands at the close-up. If the refine pass compiles but accepts nothing, check `refineCfg.x` (setRefine), the `cosRay` sign, and the `screenUV` mapping against `coneFetch`.

- [ ] **Step 6: Cost**

With the servers up, run the pass-attribution bench for one room to read `sdf:refine`:
```bash
BENCH_QUERY='upscale=0&refine=1' BENCH_PASSES=1 BENCH_LEGS=baseline BENCH_PRELUDE='__sdfGame.setRefine(true)' BENCH_ROOMS=1 BENCH_REPEATS=1 node scripts/sdf-game-bench.mjs
```
Read the `sdf:refine` row (ms). Record it in the plan log (bottom of this file).

- [ ] **Step 7: Commit, then STOP for Gate 1**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts scripts/refine-smoke.mjs
git commit -m "feat(game): ?refine=1 boot, refine twins in the scene, __sdfGame refine API, refine-smoke + Gate-1 pictures"
```
**Gate 1 (owner):** open `http://localhost:5173/sdf-game.html?upscale=0&refine=1`, run `__sdfGame.setRefineView(true)` in the console (or compare `.lab-tmp/refine-smoke/frame-refine-view.png` vs `frame-shipped.png`). The question: does the re-lit view show relief on the interior that the shipped image lacks? If no → stop here; write the finding in the plan log and TASKS.md. If yes → continue.

---

## Task 7: Capture v3.2 — `readRefine`, per-pair `refine_n.npy` / `refine_c.npy`, contracts

**Files:**
- Modify: `scripts/lib/upscale-capture.mjs`, `scripts/upscale-capture-v2.mjs`, `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md`

- [ ] **Step 1: `readRefine` in the lib**

After `readDetailField`:
```js
/** Run 5: both output-res refine attachments ({ c, n } each { w, h, data: Float32Array(4 ch) }). */
export async function readRefine(evaluate) {
  const r = await evaluate('__sdfGameDebug.readRefine()', 300_000);
  if (!r) throw new Error('readRefine returned null — boot the capture page with refine=1');
  const img = (x) => { const b = Buffer.from(Buffer.from(x.rgba32f, 'base64')); return { w: x.w, h: x.h, data: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) }; };
  return { c: img(r.c), n: img(r.n) };
}
```

- [ ] **Step 2: Capture writes the two files**

In `upscale-capture-v2.mjs`: the boot query becomes `'frozen=1&vhs=off&upscale=0&upscalenormals=1&refine=1'` unless `UPSCALE_REFINE=0` (document the env var in the header comment). After the detail read:
```js
  const refine = REFINE ? await readRefine(evaluate) : null;
  if (refine && (refine.c.w !== OUT_W || refine.c.h !== OUT_H)) fail(`refine ${refine.c.w}x${refine.c.h}, expected ${OUT_W}x${OUT_H}`);
```
Add to `files`: `refineN: refine ? \`pairs/${pid}/refine_n.npy\` : null, refineC: refine ? \`pairs/${pid}/refine_c.npy\` : null,` and after the detail write:
```js
  if (refine) {
    bytes += write(files.refineN, cropFrame(refine.n.data, OUT_W, OUT_H, 4, X, Y, W2, H2), [H2, W2, 4]);
    bytes += write(files.refineC, cropFrame(refine.c.data, OUT_W, OUT_H, 4, X, Y, W2, H2), [H2, W2, 4]);
  }
```
Also call `__sdfGame.setRefine(true)` right after boot when `REFINE` (the boot flag allocates; the layer's `setRefine` call in Task 6 already turns it on — keep the explicit call so the capture does not depend on that).

- [ ] **Step 3: Contracts**

§1 tree: two lines `pairs/<pair id>/refine_n.npy  # optional (run 5): output-res refined world normal` / `refine_c.npy  # optional (run 5): output-res re-lit rgb + clip depth`. Table rows:
```
| `refine_n.npy` | (2h, 2w, 4) | Run 5: WORLD-space unit normal of the Newton-refined surface point under each output pixel (march.wgsl.ts REFINE_LOOP: hit interpolated from the 4 march texels, rejected where the SDF disagrees by > 1 march texel, 2 Newton steps, calcNormal at 0.25 output-pixel footprint), w = 1 where written. Read the gate from `refine_c.npy` |
| `refine_c.npy` | (2h, 2w, 4) | Run 5: the march's own lighting evaluated at the refined point with the refined normal (linear rgb), w = clip depth of the refined point; **accepted iff w < 1.0** (cleared to 1.0 = not refined). Optional; feeds `headInputs: "detail+refine"` models |
```
§2 (model JSON): a `headInputs` line — `"detail"` (default when absent; run-4 exports) or `"detail+refine"`; head layer 0 `inC` is 10 or 17 accordingly. §3: fixtures may carry `"refineN": "refine_n-k.npy"`, `"refineC": "refine_c-k.npy"` (both (2h, 2w, 4), the pair's arrays).

- [ ] **Step 4: 4-pair capture smoke**

```bash
bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp UPSCALE_NAME=v32-smoke UPSCALE_PAIRS=4 UPSCALE_FRAMES=1 UPSCALE_CHARACTERS=zombie,soldier; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node scripts/upscale-capture-v2.mjs'
ls ~/blud-upscale-data/v32-smoke/pairs/*/ | head
```
Expected: every pair dir has `refine_n.npy` and `refine_c.npy`; the manifest's `files` carry `refineN`/`refineC`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/upscale-capture.mjs scripts/upscale-capture-v2.mjs docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md
git commit -m "feat(capture v3.2): refine_n/refine_c per pair, contracts rows, headInputs in the model contract"
```

---

## Task 8: `scripts/upscale-refine-check.py` — the capture stop gate

**Files:**
- Create: `scripts/upscale-refine-check.py`

- [ ] **Step 1: Write it**

```python
#!/usr/bin/env python3
"""Run-5 capture gate (spec §5). For every pair with refine files: overlap of accepted pixels with
the target flesh mask, and mean |refine_c - target| over accepted pixels vs mean |nearest-up in -
target| over the same pixels. PASS iff overlap >= 0.95 and closeness_refine < closeness_input on the
dataset mean. Usage: uv run --with numpy python3 scripts/upscale-refine-check.py <dataset dir>"""
import json, sys
from pathlib import Path
import numpy as np

root = Path(sys.argv[1])
m = json.load(open(root / "manifest.json"))
pairs = [p for p in m["pairs"] if p["files"].get("refineC")]
if not pairs: sys.exit("no pairs with refine files")
ov, cr, ci, n = 0.0, 0.0, 0.0, 0
for p in pairs:
    f = p["files"]
    inp = np.load(root / f["in"]); tgt = np.load(root / f["target"]); rc = np.load(root / f["refineC"])
    acc = rc[..., 3] < 1.0; flesh = tgt[..., 3] < 1.0
    if acc.sum() == 0: continue
    up = inp.repeat(2, axis=0).repeat(2, axis=1)
    ov += (acc & flesh).sum() / acc.sum()
    cr += np.abs(rc[..., :3] - tgt[..., :3])[acc].mean()
    ci += np.abs(up[..., :3] - tgt[..., :3])[acc].mean()
    n += 1
ov, cr, ci = ov / n, cr / n, ci / n
print(json.dumps({"pairs": n, "overlap": round(ov, 4), "closeness_refine": round(float(cr), 5), "closeness_input": round(float(ci), 5)}))
ok = ov >= 0.95 and cr < ci
print("REFINE CHECK:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
```

- [ ] **Step 2: Run on the smoke dataset**

Run: `uv run --with numpy python3 scripts/upscale-refine-check.py ~/blud-upscale-data/v32-smoke`
Expected: `REFINE CHECK: PASS`. **Stop gate:** a FAIL on closeness means the re-lit candidate is no closer to the target than the input; do not capture 800 pairs — record it in the plan log and TASKS.md and stop.

- [ ] **Step 3: Commit**

```bash
git add scripts/upscale-refine-check.py
git commit -m "feat(upscale): refine dataset check — overlap + closeness stop gate for run 5"
```

---

## Task 9: Launch the v3.2 capture (unattended)

- [ ] **Step 1: Launch** (owner's machine; ~800 pairs at 9 GB, ~1.5 h)

```bash
mkdir -p .lab-tmp && nohup bash -c 'export LAB_VITE_PORT=5325 LAB_CDP_PORT=9325 LAB_TMP=.lab-tmp UPSCALE_NAME=v3.2-2026-09-13 UPSCALE_CAP_GB=9 UPSCALE_CHARACTERS=zombie,goblin,soldier,bonewalker,clown,cyberdemon,female,gnasher,minotaur; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node scripts/upscale-capture-v2.mjs; echo "capture exit $?" > .lab-tmp/capture-v32-status.txt; echo CAPTURE_DONE >> .lab-tmp/capture-v32-status.txt' > .lab-tmp/capture-v32.log 2>&1 &
```
Tasks 10–12 (Python + TS net changes) proceed while it runs — they need no GPU. Do not run vitest whole-suite or the grid until `CAPTURE_DONE`.

---

## Task 10: Python — `head_inputs`, `Pair.refine`, `sample_with_extras`, predict/train/grid/evaluate/export

**Files:**
- Modify: `scripts/neural-upscale/nupscale/constants.py`, `model.py`, `reconstruct.py`, `data.py`, `train.py`, `grid.py`, `evaluate.py`, `export.py`
- Tests: `scripts/neural-upscale/tests/helpers.py`, `tests/test_model.py`, `tests/test_data.py`, `tests/test_export.py`

- [ ] **Step 1: Failing tests**

`tests/helpers.py` `write_v2_dataset(..., refine: bool = False)`: after the detail block,
```python
        if refine:
            rn = torch.rand((3, 2 * h, 2 * w), generator=g) * 2 - 1
            rn = rn / rn.norm(dim=0, keepdim=True).clamp(min=1e-6) * flesh
            rn4 = torch.cat([rn, flesh.to(torch.float32)], dim=0)
            rc = torch.cat([(target[:3] + 0.02 * torch.rand((3, 2 * h, 2 * w), generator=g)) * flesh, target[3:4]], dim=0)
            np.save(d / "refine_n.npy", hwc(rn4)); np.save(d / "refine_c.npy", hwc(rc))
            files["refineN"] = f"pairs/{pid}/refine_n.npy"; files["refineC"] = f"pairs/{pid}/refine_c.npy"
```
`tests/test_data.py`:
```python
def test_refine_loads_as_8_channels_and_crops_with_the_target(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True, refine=True))
    p = ds.pairs[0]
    assert p.refine is not None and p.refine.shape == (8, 24, 32)
    assert torch.equal(p.refine[7] < 1, p.target[3] < 1)          # accept gate == target flesh in the synthetic set
    march, target, weight, detail, refine = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=1.0, flip_y=0.0).sample_with_extras(2)
    assert refine.shape == (2, 8, 16, 16) and detail.shape == (2, 4, 16, 16)
    assert torch.equal(refine[:, 7] < 1, target[:, 3] < 1)        # flipped together
```
`tests/test_model.py`:
```python
def test_refine_head_starts_as_a_no_op_and_needs_refine(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True, refine=True))
    march, target, weight, detail, refine = CropSampler(ds.split("train"), crop=8, seed=1, flip_x=0.0, flip_y=0.0).sample_with_extras(3)
    m = Upscaler("s8", "rgbn", seed=2, head=True, head_inputs="detail+refine")
    assert m.head[0].in_channels == 17
    plain = predict(Upscaler("s8", "rgbn", seed=2), march, 0.1, 200.0).march()
    assert torch.allclose(predict(m, march, 0.1, 200.0, detail, refine).march(), plain)
    with torch.no_grad(): m.head[1].weight.normal_(); m.head[1].bias.fill_(0.2)
    out = predict(m, march, 0.1, 200.0, detail, refine).march()
    assert not torch.allclose(out, plain)
    import pytest as _p
    with _p.raises(ValueError, match="refine"): predict(m, march, 0.1, 200.0, detail)
```
`tests/test_export.py`:
```python
def test_refine_head_exports_headInputs_and_fixtures(tmp_path):
    ds = load_dataset(write_v2_dataset(tmp_path / "ds", pairs=2, size=(12, 16), normals=True, detail=True, refine=True))
    m = Upscaler("s8", "rgbn", seed=3, head=True, head_inputs="detail+refine")
    doc = export_model(m, tmp_path / "e", run="r", step=1, dataset="d", manifest_hash="h", metrics=None)
    assert doc["headInputs"] == "detail+refine" and doc["head"][0]["inC"] == 17
    fx = export_parity_fixture(m, ds.pairs, 0.1, 200.0, tmp_path / "e" / "parity", count=1)
    assert fx[0]["refineN"] == "refine_n-0.npy" and fx[0]["refineC"] == "refine_c-0.npy"
    assert np.load(tmp_path / "e" / "parity" / "refine_c-0.npy").shape == (24, 32, 4)
```
Run: the three test files — expect FAIL (unknown kwargs / attributes).

- [ ] **Step 2: Implement**

`constants.py`:
```python
# Run-5 head input sets (spec 2026-09-13 §6): "detail" = the run-4 10 channels; "detail+refine" adds
# refined world normal*gate (3), re-lit rgb*gate (3), gate (1) = 17.
HEAD_INPUT_CHANNELS = {"detail": 10, "detail+refine": 17}
HEAD_IN_CHANNELS = HEAD_INPUT_CHANNELS["detail"]   # back-compat name
```
`model.py`: `__init__(..., head: bool = False, head_inputs: str = "detail")`, `self.head_inputs = head_inputs`, head conv 0 `nn.Conv2d(HEAD_INPUT_CHANNELS[head_inputs], HEAD_WIDTH, ...)`, seeding scale uses the same count; `head_input(rec_rgb, covered, detail, march, refine=None)`:
```python
        x = torch.cat([rec_rgb * cov, cov, d, up_rgb], dim=1)
        if refine is not None:
            ga = (refine[:, 7:8] < 1).to(rec_rgb.dtype)
            x = torch.cat([x, refine[:, 0:3] * ga, refine[:, 4:7] * ga, ga], dim=1)
        return x
```
`head_residual(..., refine=None)` passes it through; `fused()` copies `head_inputs`.
`reconstruct.py`: `predict(model, march, near, far, detail=None, refine=None)`: if the model's `head_inputs` is `"detail+refine"` and `refine is None` → `ValueError("a model with head_inputs detail+refine needs the refine field (dataset pairs with refine_n.npy/refine_c.npy)")`; call `model.head_residual(rec.rgb, rec.covered, detail, march, refine)`.
`data.py`: `Pair.refine: torch.Tensor | None` = `torch.cat([chw(refine_n), chw(refine_c)])` when both files exist (shape check `(2h, 2w, 4)` each); `CropSampler.sample_with_extras(batch)` = the existing body extended with `r = paste(p.refine, 2*ox, 2*oy, 2*c, zero8)` (sentinel `torch.tensor([0,0,0,0,0,0,0,1.0])` so pasted margin reads *not accepted*), flipped with the target, returned fifth; `sample_with_detail` calls it and drops the fifth.
`train.py`: `RunConfig.head_inputs: str = "detail"`; model construction passes it; the step loop uses `sample_with_extras` and passes `refine` to `predict` (the `loss_of`/`compute` signatures gain `refine=None`).
`grid.py`: `--head-inputs` choices `detail`/`detail+refine` (default `detail`) → `RunConfig(head_inputs=...)`.
`evaluate.py`: `refine = pair.refine.unsqueeze(0).to(device) if pair.refine is not None else None`; pass to `predict`.
`export.py`: `"headInputs": model.head_inputs if head else None` in the doc; in `export_parity_fixture` save `refine_n-k.npy` (`pair.refine[:4]`) and `refine_c-k.npy` (`pair.refine[4:]`) with keys `refineN`/`refineC`, and pass `refine` to `predict`.

- [ ] **Step 3: Run all Python tests**

Run (whole nupscale suite, no browser, safe alongside the capture): `(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt --with pytest python -m pytest -q -p no:cacheprovider)`
Expected: all pass, including the existing head tests (default `head_inputs="detail"` keeps them unchanged).

- [ ] **Step 4: Commit**

```bash
git add scripts/neural-upscale
git commit -m "feat(nupscale): head_inputs detail+refine — Pair.refine, sample_with_extras, 17-channel head, export headInputs + fixtures"
```

---

## Task 11: TS model + twin — `headInputs`, `headInChannels`, `assembleHeadInput` with refine

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts`, `upscale-reference.ts`
- Tests: `upscale-model.test.ts`, `upscale-reference.test.ts`

- [ ] **Step 1: Failing tests**

`upscale-model.test.ts`:
```ts
describe('run-5 headInputs', () => {
  it('defaults to detail, round-trips detail+refine with a 17-wide first head layer, and rejects a mismatch', () => {
    const m = createUpscaleModel('s8', 'rgbn', 1, true, 'detail+refine');
    expect(m.headInputs).toBe('detail+refine');
    expect(m.head![0]!.inC).toBe(17);
    const json = serializeUpscaleModel(m, { run: 'r', step: 1 });
    expect(json.headInputs).toBe('detail+refine');
    const back = parseUpscaleModelJson(json);
    expect(back.headInputs).toBe('detail+refine'); expect(back.head![0]!.inC).toBe(17);
    expect(parseUpscaleModelJson({ ...json, headInputs: undefined }).headInputs).toBeUndefined;   // absent + 17-wide → throws below
    expect(() => parseUpscaleModelJson({ ...json, headInputs: 'detail' })).toThrow(/head layer 0 is 17->8, expected 10->8/);
    expect(createUpscaleModel('s8', 'rgbn', 1, true).headInputs).toBe('detail');
  });
});
```
(Use the real serializer name from the file — grep `export function` in `upscale-model.ts`.)
`upscale-reference.test.ts`:
```ts
describe('run-5 refine channels in the twin', () => {
  it('a zero head is a no-op with refine; refine channels enter only where accepted (refineC.w < 1)', () => {
    const w = 12, h = 10;
    const march = randomMarch(6, 5, 7);   // use the file's existing random-march helper
    const m = createUpscaleModel('s8', 'rgbn', 1, true, 'detail+refine');
    const detail = { w, h, c: 4, data: new Float32Array(w * h * 4).map((_, k) => (k % 4 === 3 ? 1 : Math.sin(k * 0.7))) };
    const refineN = { w, h, c: 4, data: new Float32Array(w * h * 4).map((_, k) => (k % 4 === 3 ? 1 : Math.cos(k * 0.3))) };
    const refineC = { w, h, c: 4, data: new Float32Array(w * h * 4).map((_, k) => (k % 4 === 3 ? (k % 8 === 3 ? 0.5 : 1) : 0.3)) };
    const plain = upscaleReference(march, createUpscaleModel('s8', 'rgbn', 1), 'sp', 0.1, 100, w, h, {});
    const same = upscaleReference(march, m, 'sp', 0.1, 100, w, h, { detail, refineN, refineC });
    expect(Array.from(same.data)).toEqual(Array.from(plain.data));
    expect(() => upscaleReference(march, m, 'sp', 0.1, 100, w, h, { detail })).toThrow(/needs opts.refineN and opts.refineC/);
    const x = assembleHeadInput(same, detail, march, { n: refineN, c: refineC });
    expect(x.c).toBe(17);
    for (let p = 0; p < w * h; p++) { const ga = refineC.data[p * 4 + 3]! < 1 ? 1 : 0; expect(x.data[p * 17 + 16]).toBe(ga); expect(x.data[p * 17 + 10]).toBeCloseTo(refineN.data[p * 4]! * ga); }
  });
});
```
Run both files — FAIL.

- [ ] **Step 2: Implement `upscale-model.ts`**

```ts
export type HeadInputs = 'detail' | 'detail+refine';
/** Run 5: head input width per set (nupscale/constants.py HEAD_INPUT_CHANNELS). */
export function headInChannels(h: HeadInputs = 'detail'): number { return h === 'detail+refine' ? 17 : 10; }
```
- `UpscaleModel.headInputs?: HeadInputs` (present iff `head`). `createUpscaleModel(id, inputs, seed = 1, head = false, headInputs: HeadInputs = 'detail')` — `mk(headInChannels(headInputs), HEAD_WIDTH, ...)`; set `headInputs` on the model when `head`.
- JSON type: `headInputs?: HeadInputs | null`; serializer writes it when `head`; parser: `const headInputs = j.headInputs === 'detail+refine' ? 'detail+refine' : 'detail'` (reject any other string), and `shape[0] = [headInChannels(headInputs), HEAD_WIDTH, true]`; set `model.headInputs` when the head parsed.
- `parseUpscaleConfig`: accept `headInputs` from the URL config (`?upscaleheadinputs=detail+refine`) — optional, only for random-weight boots.
- `hashModel` unchanged (weights already differ by shape).

- [ ] **Step 3: Implement `upscale-reference.ts`**

`ReferenceOptions.refineN?: FloatImage; refineC?: FloatImage;`
```ts
export function assembleHeadInput(out: FloatImage, detail: FloatImage, march: FloatImage, refine?: { n: FloatImage; c: FloatImage }): FloatImage {
  const C = refine ? 17 : 10;
  ... existing body with HEAD_IN_CHANNELS → C ...
      if (refine) {
        const ga = refine.c.data[p * 4 + 3]! < 1 ? 1 : 0;
        x.data[b + 10] = refine.n.data[p * 4]! * ga; x.data[b + 11] = refine.n.data[p * 4 + 1]! * ga; x.data[b + 12] = refine.n.data[p * 4 + 2]! * ga;
        x.data[b + 13] = refine.c.data[p * 4]! * ga; x.data[b + 14] = refine.c.data[p * 4 + 1]! * ga; x.data[b + 15] = refine.c.data[p * 4 + 2]! * ga;
        x.data[b + 16] = ga;
      }
```
Size checks: refine images must match `out` and have 4 channels. `applyHead(out, model, detail, march, refine?, store)`; in `upscaleReference`: if `model.headInputs === 'detail+refine'` and `!(opts.refineN && opts.refineC)` throw `'upscaleReference: this model has a refine head and needs opts.refineN and opts.refineC'`.

- [ ] **Step 4: Run, commit**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/upscale-model.test.ts src/lab/sdf-zombie/webgpu/upscale/upscale-reference.test.ts` — PASS.
```bash
git add src/lab/sdf-zombie/webgpu/upscale/upscale-model.ts src/lab/sdf-zombie/webgpu/upscale/upscale-reference.ts src/lab/sdf-zombie/webgpu/upscale/*.test.ts
git commit -m "feat(upscale twin): headInputs detail+refine — 17-channel head assembly, JSON round trip"
```

---

## Task 12: WGSL H1 refine taps, stage textures, self-check, trained parity script

**Files:**
- Modify: `upscale-wgsl.ts` (`head1Pass`), `upscale-stage.ts` (`createUpscaleStage`, `textureOf`, `upscaleInfoOf`), `upscale-selfcheck.ts`, `scripts/upscale-trained-parity.ts`, `sdf-layer.ts` (the seventh argument from Task 5 step 5)
- Tests: `upscale-wgsl.test.ts`, `upscale-stage.test.ts`

- [ ] **Step 1: Failing tests**

`upscale-wgsl.test.ts`:
```ts
  it('a detail+refine head binds refineN/refineC on H1 and reads 5 input groups', () => {
    const passes = planUpscalePasses(createUpscaleModel('s8', 'rgbn', 1, true, 'detail+refine'), 'sp');
    expect(passes[4]!.inputs).toEqual(['shuffle:0', 'march', 'detail', 'refineN', 'refineC']);
    expect(passes[4]!.run).toContain('let rn0 = textureLoad(refineN, q0, 0);');
    expect(passes[4]!.run).toContain('let ga0 = select(0.0, 1.0, rc0.w < 1.0);');
    expect(passes[4]!.run).toContain('a4_0');
    for (const p of passes.slice(4)) { expectParses(p.run); for (const r of p.reads) expectParses(r); if (p.state) expectParses(p.state); }
  });
```
`upscale-stage.test.ts`:
```ts
  it('a detail+refine model needs the refine textures and reports headInputs', () => {
    const cfg = { model: 's8', layout: 'sp', inputs: 'rgbn', seed: 1, head: true, headInputs: 'detail+refine' } as const;
    expect(() => createUpscaleStage(cfg, new THREE.Texture(), uniform(1), undefined, new THREE.Texture(), new THREE.Texture())).toThrow(/needs the refine textures/);
    const stage = createUpscaleStage(cfg, new THREE.Texture(), uniform(1), undefined, new THREE.Texture(), new THREE.Texture(), { n: new THREE.Texture(), c: new THREE.Texture() });
    expect(upscaleInfoOf(stage).headInputs).toBe('detail+refine');
  });
```
Run both — FAIL.

- [ ] **Step 2: `head1Pass`**

```ts
  const refine = model.headInputs === 'detail+refine';
  const params = ['net', 'march', 'detail', ...(refine ? ['refineN', 'refineC'] : [])];
  ...
    if (refine) {
      taps.push(`  let rn${k} = textureLoad(refineN, q${k}, 0);`);
      taps.push(`  let rc${k} = textureLoad(refineC, q${k}, 0);`);
      taps.push(`  let ga${k} = select(0.0, 1.0, rc${k}.w < 1.0);`);
      taps.push(`  let a2_${k} = vec4<f32>(m${k}.y * h${k}, m${k}.z * h${k}, rn${k}.x * ga${k}, rn${k}.y * ga${k});`);
      taps.push(`  let a3_${k} = vec4<f32>(rn${k}.z * ga${k}, rc${k}.x * ga${k}, rc${k}.y * ga${k}, rc${k}.z * ga${k});`);
      taps.push(`  let a4_${k} = vec4<f32>(ga${k}, 0.0, 0.0, 0.0);`);
    } else {
      taps.push(`  let a2_${k} = vec4<f32>(m${k}.y * h${k}, m${k}.z * h${k}, 0.0, 0.0);`);
    }
  ...
    body += accumulate(layer, outCh, refine ? 5 : 3, `acc${t}`);
  ...
  inputs: [`${netPassName}:0`, 'march', 'detail', ...(refine ? ['refineN', 'refineC'] : [])],
```
Channel order must equal the twin's: [0..3] rec*cov,cov · [4..7] d*g, up.r*hit · [8..11] up.g*hit, up.b*hit, rn.x*ga, rn.y*ga · [12..15] rn.z*ga, rc.rgb*ga · [16] ga. Confirm `matLiteral` pads input channels ≥ `inC` with zeros (it already does for the 10-channel head's channels 10–11).

- [ ] **Step 3: Stage, self-check, parity, layer**

- `createUpscaleStage(config, marchTexture, flipY, trained?, normalTexture?, detailTexture?, refine?: { n: THREE.Texture; c: THREE.Texture })`; `createUpscaleModel(config.model, config.inputs, config.seed, config.head === true, config.headInputs)`; throw `'upscale: this model has a refine head (headInputs detail+refine) and needs the refine textures (boot with ?refine=1)'` when missing; `textureOf`: `'refineN' → refine!.n`, `'refineC' → refine!.c`. `UpscaleInfo.headInputs: HeadInputs | null` in `upscaleInfoOf` (`stage.model.headInputs ?? null`, `null` when off). `UpscaleConfig.headInputs?: HeadInputs`.
- `upscale-selfcheck.ts`: `const refine = stage.model.headInputs === 'detail+refine' && deps.layer.refineTarget ? { n: await readFloatTarget(deps.renderer, deps.layer.refineTarget, 1), c: await readFloatTarget(deps.renderer, deps.layer.refineTarget, 0) } : undefined;` and pass `refineN: refine?.n, refineC: refine?.c` to `upscaleReference`. Add `refineTarget` to the deps' layer type.
- `scripts/upscale-trained-parity.ts`: read `f.refineN`/`f.refineC` as 4-channel images; throw if the model's `headInputs` is `detail+refine` and either is missing; pass them in `opts`.
- `sdf-layer.ts`: pass the seventh argument (Task 5 step 5).

- [ ] **Step 4: Run, then compile + trained smoke on a random refine head**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/` — PASS.
```bash
bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node scripts/upscale-smoke.mjs'
```
Add the boot `?upscale=s8&upscaleinputs=rgbn&upscalehead=1&upscaleheadinputs=detail%2Brefine&refine=1` to `upscale-smoke.mjs`'s config list (next to its `?upscalehead=1` entry) so the H1 pass with five textures compiles under the smoke. Expected: PASS, and the in-page GPU-vs-twin self-check for that config ≤ 2e-3 (the refine head is zero-weight at random init's last layer, so this is really a binding check).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/upscale src/lab/sdf-zombie/webgpu/sdf-layer.ts scripts/upscale-trained-parity.ts scripts/upscale-smoke.mjs
git commit -m "feat(upscale stage): refineN/refineC taps on H1 for detail+refine heads; stage, self-check and parity plumbing"
```

---

## Task 13: G3 on a synthetic refine export, then the run-5 grid → **Gate 2**

- [ ] **Step 1: G3 with a real refine fixture (needs the smoke dataset from Task 7)**

Train one tiny run on `v32-smoke` to get an export with refine fixtures, then run the parity script:
```bash
(cd scripts/neural-upscale && uv run --python 3.12 --with-requirements requirements.txt python -m nupscale.grid --data ~/blud-upscale-data/v32-smoke --root ~/blud-upscale-data/runs-local-run5-g3 --hourly-usd 0.01 --cap-usd 1 --reserve-min 0 --max-steps 50 --time-cap-min 5 --runs s8-rgbn --head --head-inputs detail+refine --tag=-headr-g3)
rm -rf .upscale-models/g3-s8-rgbn-headr-g3 && cp -R ~/blud-upscale-data/runs-local-run5-g3/s8-rgbn-headr-g3/exports/s8-rgbn-headr-g3-best .upscale-models/g3-s8-rgbn-headr-g3
npx tsx scripts/upscale-trained-parity.ts .upscale-models/g3-s8-rgbn-headr-g3
```
Expected: `G3: PASS` with maxRelRgb in the 1e-6 class. (Random-ish weights after 50 steps are non-zero, so this exercises every refine channel.)

- [ ] **Step 2: Wait for the capture, check the dataset**

`cat .lab-tmp/capture-v32-status.txt` must say `CAPTURE_DONE`, exit 0. Then:
```bash
python3 -c "
import json,os; m=json.load(open(os.path.expanduser('~/blud-upscale-data/v3.2-2026-09-13/manifest.json'))); p=m['pairs']
print(len(p), sum(1 for x in p if x['files'].get('refineC')), sum(1 for x in p if x['files'].get('detail')))"
uv run --with numpy python3 scripts/upscale-refine-check.py ~/blud-upscale-data/v3.2-2026-09-13
```
Expected: ≥ 600 pairs, all with refine and detail; `REFINE CHECK: PASS`.

- [ ] **Step 3: The grid** (same recipe as run 4; control retrained on v3.2)

Write `.lab-tmp/grid-run5.sh`:
```bash
#!/usr/bin/env bash
cd /Users/donny/Projects/blud/.claude/worktrees/neural-upscaling-experiments-da69a4/scripts/neural-upscale
ROOT=~/blud-upscale-data/runs-local-run5-$(date +%F)
COMMON=(--data ~/blud-upscale-data/v3.2-2026-09-13 --root $ROOT --hourly-usd 0.01 --cap-usd 1000 --reserve-min 0 --compile --max-steps 12000 --time-cap-min 120 --interior-weight 2.0)
run() { uv run --python 3.12 --with-requirements requirements.txt python -m nupscale.grid "${COMMON[@]}" "$@"; }
run --runs s32-rgbn --head --tag=-head-int2                              # control: run-4 head, detail only
run --runs s32-rgbn --head --head-inputs detail+refine --tag=-headr-int2 # the experiment
echo "grid exit $?" > ../../.lab-tmp/grid-run5-status.txt; echo GRID_DONE >> ../../.lab-tmp/grid-run5-status.txt
```
Launch: `chmod +x .lab-tmp/grid-run5.sh && nohup .lab-tmp/grid-run5.sh > .lab-tmp/grid-run5.log 2>&1 &` (~40 min on the MacBook Air). Dashboard: add a `.claude/launch.json` entry like `upscale-dashboard-run4` pointing at the new root on a free port.

- [ ] **Step 4: Stage and gate**

When `GRID_DONE`: copy both `exports/*-best` to `.upscale-models/r5-<run>` (names contain `rgbn` and, for the experiment, `headr`, so the boot allocates normals + refine), then:
```bash
npx tsx scripts/upscale-trained-parity.ts .upscale-models/r5-s32-rgbn-headr-int2      # G3
bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp UPSCALE_SMOKE_MODEL=r5-s32-rgbn-headr-int2; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && node scripts/upscale-trained-smoke.mjs'
```
(The trained smoke boots by model name; the `headr` pattern in Task 6 turns refine on. If the smoke's own boot URL sets `refine=0`, add `refine=1` there.) Expected: G3 PASS; trained smoke coverage/depth exact, GPU-vs-twin reported (the head's f16 pass reads ~3e-3 as in run 4 — record, do not move the bar).

**Gate 2 (owner):** `?upscale=trained&upscalemodel=r5-s32-rgbn-headr-int2` vs `r5-s32-rgbn-head-int2` (U key). Keep iff not a regression by eye AND `interior` on the dashboard is not worse than the control.

---

## Task 14: Bench leg, note §14, TASKS.md

**Files:**
- Modify: `scripts/sdf-game-bench.mjs`, `docs/dev-notes/2026-09-12-upscaler-next-steps.md`, `TASKS.md`

- [ ] **Step 1: Bench**

In `ALL_LEGS`: `'refine-on': { setRefine: true },` with a comment (needs `BENCH_QUERY=upscale=0&refine=1`; baseline is refine-off). In the ship-defaults block of `applyLeg` add `__sdfGame.setRefine(false);` guarded: `if (__sdfGame.refineInfo().allocated) __sdfGame.setRefine(false);`. Run three repeats, rooms 1–2:
```bash
bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up && BENCH_QUERY="upscale=0&refine=1" BENCH_LEGS=baseline,refine-on BENCH_ROOMS=1,2 BENCH_REPEATS=3 node scripts/sdf-game-bench.mjs'
```
Record the delta.

- [ ] **Step 2: Note §14 and TASKS**

Append `## 14. Run 5 results (<date>) — one-step SDF refinement` to the next-steps note (repo and the Obsidian copy under `Claude Notes/Research/`): the table (control vs headr vs bicubic, all regions), Gate 1 and Gate 2 verdicts verbatim, the `sdf:refine` cost and the bench delta, the G3/smoke numbers, and the decision (ship / iterate / stop). Update the TASKS.md run-5 row accordingly. Commit:
```bash
git add scripts/sdf-game-bench.mjs docs/dev-notes/2026-09-12-upscaler-next-steps.md TASKS.md
git commit -m "docs(upscale run 5): results, gates, cost; refine-on bench leg"
```

---

## Log

(append dated entries as tasks land: what was built, what the gates read, deviations from this plan and why)

- **2026-09-13 (session 1, subagent-driven):** Tasks 1–6, 8, 10–12 landed and were two-stage reviewed
  (HEAD 2405a1e4 at the time of writing). Deviations and findings:
  - The plan's parity gate (`scripts/sdf-game-parity.mjs`) is a seam self-test and is broken at its first
    evaluate; the refactor gate is now `scripts/march-hash.mjs` (sha1 over the exact float readback of the
    march target: `room1`, `room1-repeat`, `room1-wounded`). Its first version (page `hashMarchTarget`,
    truncating) could not see a wound; the exact version can. Bimodality across boots traced to the
    field-interlace parity counter private to sdf-layer (`fieldParity(frameIndex)`), fixed by a boot render:
    the gate now pins `setFieldStyle('off')` — the regime the upscale stage and the refine pass run in.
    The Task-5 "createRefineUniforms() perturbs the shipped frame" bisection was that bimodality, not the
    uniforms; the lazy allocation it chose stays (it is cleaner).
  - REFINE_LOOP: the derived declared-names pin strips comments; only `t, hit, hitBest, hitField,
    hitNearWound` are real reads of the walk's state. `aaCfg.x` = march-pixel footprint RADIUS per unit
    distance (one march texel = 2·t·aaCfg.x, one output pixel = t·aaCfg.x).
  - Twin binding drift (the meltCfg class of bug, new form): `createMarchMaterial` builds per-material
    level-shadow and segment-volume texture nodes, and only the MAIN material's nodes are rebound (game-main
    ~1463 per frame; `setSkeletonVolume`). The refine twin kept the 1×1 fallback → `LEVEL_SHADOW` returned
    0 → key diffuse+spec vanished → ambient-only pale picture. Fixed by sharing the main material's nodes
    (`levelShadowTexNodeIn`, `segVolume*NodeIn`). Diagnosis by per-pixel ratio (0.86 → 1.017 after) and the
    flat-albedo seam (bit-identical, so the hit/albedo chain was never wrong).
  - refine-smoke: fields must be off (the ship default 'bodies' halves the march height); 0.66 % of accepted
    pixels sit one march texel outside the nearest hit (the rim the half-res march misses) — gated on the
    3×3 neighbourhood, strict count reported.
  - **Cost:** `sdf:refine` 6.6 ms p50 vs `sdf:march` 7.6 ms at the room-1 close-up (single run). The
    10–20 % estimate counted the SDF evals only; the twin runs the whole post-hit tail (probes, scatter,
    wound soft shadow, level shadow) at 4× the pixels. Decision (owner): run the experiment at full cost;
    if it wins, ablate (normal-only variant) to find the cheapest sufficient input, then slim the tail.
  - **Gate 1 (owner, 2026-09-13):** "the refine one looks good, like native basically." Edges resolve at
    output res; interior relief is the same smoothness as the march (the geometry is smooth at this
    distance); colour matches after the level-shadow fix. PASS → capture.
  - Python: `reset_parameters` now draws the head AFTER the ICNR layer so headed/headless models at one seed
    share low-res weights (needed for the no-op test; TS already drew in that order). Trained checkpoints
    unaffected; from-scratch seeds pre/post this change do not bit-match.
