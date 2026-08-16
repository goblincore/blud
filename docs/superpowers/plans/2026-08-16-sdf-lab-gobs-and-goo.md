# SDF Lab Gobs & Goo Implementation Plan (X1.21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace geometric gib pieces with amorphous fleshy gobs, give them a bloody gore-mask material, render the blood as viscous screen-space metaball fluid, and run the shell-displacement silhouette experiment behind a bench gate.

**Architecture:** WebGPU path ONLY (`src/lab/sdf-zombie/` + `webgpu/` — the WebGL lab is frozen; do not touch `march.glsl.ts`, `zombie.ts`, or `src/lab/sdf-zombie/lab-main.ts` except where a task explicitly says so). Pure modules first (`gobs.ts`, blood-sim scrap band), then shader work (gore mask, shell displacement), then the metaball render passes, then wiring.

**Tech Stack:** TypeScript, vitest, three/webgpu + three/tsl (NEVER plain `three` under `webgpu/`).

**Spec:** `docs/superpowers/specs/2026-08-16-sdf-lab-gobs-and-goo-design.md`

**Ground rules (as the gore-feel plan, verbatim):** node_modules symlink if missing; `npx tsc --noEmit` clean + `npm test` green before every commit; WGSL reserved-word lint applies to every new WGSL string; no wall-clock perf claims from rAF — `window.__sdfLab.benchGpu()` only; the browser pane fires phantom clicks at the last cursor position between tool calls (click = shoot in this lab — treat wound-count growth between tool calls as harness noise).

---

### Task 1: gobs.ts — amorphous gob generation

**Files:**
- Create: `src/lab/sdf-zombie/gobs.ts`
- Test: `src/lab/sdf-zombie/gobs.test.ts`

A pure module that turns a body's live clusters into gib shapes: LARGE GOBS
(raymarched chunk groups) and SCRAPS (particle descriptors for the blood sim).

- [ ] **Step 1: Failing tests** — create `gobs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeGobs, GOB_TUNING } from './gobs';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';

function seeded(seed = 1): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const torso = body.clusters.find(c => c.limb === 'torso')!;

describe('makeGobs', () => {
  const { gobs, scraps } = makeGobs(body, torso.center, seeded(7));

  it('emits a large-gob count in the tuned band, plus the intact head', () => {
    const head = gobs.filter(g => g.limb === 'head');
    expect(head).toHaveLength(1);
    const meat = gobs.length - 1;
    expect(meat).toBeGreaterThanOrEqual(GOB_TUNING.largeMin);
    expect(meat).toBeLessThanOrEqual(GOB_TUNING.largeMax);
  });

  it('every non-head gob is a multi-blob lump, not a source prim', () => {
    for (const g of gobs) {
      if (g.limb === 'head') continue;
      expect(g.prims.length).toBeGreaterThanOrEqual(2);
      expect(g.prims.length).toBeLessThanOrEqual(4);
      // Blobs are NEW primitives (jittered), not references into body.prims.
      for (const p of g.prims) expect(body.prims).not.toContain(p);
    }
  });

  it('gob size tracks its source region (torso gob outweighs a hand gob)', () => {
    const vol = (g: (typeof gobs)[number]) =>
      g.prims.reduce((s, p) => s + p.radius ** 3, 0);
    const torsoGob = gobs.find(g => g.limb === 'torso')!;
    const armGobs = gobs.filter(g => g.limb === 'armL' || g.limb === 'armR');
    expect(armGobs.length).toBeGreaterThan(0);
    for (const a of armGobs) expect(vol(torsoGob)).toBeGreaterThan(vol(a));
  });

  it('per-axis jitter stays in the tuned band', () => {
    for (const g of gobs) {
      if (g.limb === 'head') continue;
      for (const p of g.prims) for (const s of p.scale) {
        expect(s).toBeGreaterThanOrEqual(0.6);
        expect(s).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('every non-head gob carries 1-2 torn points', () => {
    for (const g of gobs) {
      if (g.limb === 'head') continue;
      expect(g.tornAt.length).toBeGreaterThanOrEqual(1);
      expect(g.tornAt.length).toBeLessThanOrEqual(2);
    }
  });

  it('emits scraps in the tuned band with the scrap size/drag stamp', () => {
    expect(scraps.length).toBeGreaterThanOrEqual(GOB_TUNING.scrapMin);
    expect(scraps.length).toBeLessThanOrEqual(GOB_TUNING.scrapMax);
    for (const s of scraps) {
      expect(s.size).toBeGreaterThanOrEqual(GOB_TUNING.scrapSizeMin);
      expect(s.size).toBeLessThanOrEqual(GOB_TUNING.scrapSizeMax);
    }
  });

  it('skips dead prims and dead clusters', () => {
    const armDead = {
      ...body,
      clusters: body.clusters.map(c => c.limb === 'armL' ? { ...c, alive: false } : c),
    };
    const { gobs: g2 } = makeGobs(armDead, torso.center, seeded(7));
    expect(g2.some(g => g.limb === 'armL')).toBe(false);
  });

  it('is deterministic under a seed', () => {
    const a = makeGobs(body, torso.center, seeded(42));
    const b = makeGobs(body, torso.center, seeded(42));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Verify failure**, then **implement** `gobs.ts`:

```ts
// src/lab/sdf-zombie/gobs.ts
//
// Amorphous gib shapes (spec: gobs-and-goo §1). A full-body gib should read
// as "a few ragged hunks + gooey scraps", not anatomy capsules — playtest
// called the per-prim pieces "too geometric primitive shaped" (the torso's
// fat prims made clean balls).
//
// LARGE GOBS are chunk groups whose prims are NEWLY SYNTHESISED blobs: 2-4
// jittered overlapping spheres/short capsules seeded from a source prim's
// position and volume, smin'd by the normal chunk-view path. SCRAPS are not
// raymarched at all — they are particle descriptors the blood sim ingests,
// so they render through the metaball pass and fuse with the spray.
import type { BuildResult } from './build-body';
import type { LimbId, Primitive, Vec3 } from './types';
import type { ChunkGroup } from './sever';
import { add, len, scale as vscale, sub } from './vec';

export const GOB_TUNING = {
  largeMin: 4,
  largeMax: 6,
  blobsMin: 2,
  blobsMax: 4,
  /** Per-axis ellipsoid jitter band — spec §1. */
  jitterMin: 0.6,
  jitterMax: 1.3,
  scrapMin: 10,
  scrapMax: 15,
  scrapSizeMin: 0.05,
  scrapSizeMax: 0.11,
  /** Gob blob radius as a fraction of the source prim's radius. */
  blobRadiusScale: 0.75,
  /** Blob centre scatter, as a fraction of the source prim's radius. */
  blobScatter: 0.6,
} as const;

export interface Scrap {
  pos: Vec3;
  size: number;
}

/**
 * Gibs the live, non-dead prims of a body into large gobs + scraps.
 * Does NOT mutate the body — the caller still uses gibAllPieces/gibAll for
 * the alive-flag bookkeeping, or marks clusters dead itself.
 */
export function makeGobs(
  body: BuildResult, torsoCentre: Vec3, rng: () => number,
): { gobs: ChunkGroup[]; scraps: Scrap[] } {
  // Source pool: live add-prims of live non-head clusters, biggest first —
  // the biggest regions deserve the large gobs.
  const sources: { limb: LimbId; p: Primitive }[] = [];
  let head: ChunkGroup | null = null;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    const prims = body.prims.slice(c.start, c.start + c.count);
    if (c.limb === 'head') {
      // Intact head, torn at the neck end — same as gibAllPieces' head case.
      let neck: Vec3 = prims[0]!.a; let best = Infinity;
      for (const p of prims) {
        if (p.op === 'sub' || p.dead) continue;
        for (const e of [p.a, p.b]) {
          const d = len(sub(e, torsoCentre));
          if (d < best) { best = d; neck = e; }
        }
      }
      head = { limb: c.limb, prims, origin: c.center, tornAt: [neck] };
      continue;
    }
    for (const p of prims) {
      if (p.op === 'sub' || p.dead) continue;
      sources.push({ limb: c.limb, p });
    }
  }
  sources.sort((a, b) => b.p.radius - a.p.radius);

  const nLarge = GOB_TUNING.largeMin
    + Math.floor(rng() * (GOB_TUNING.largeMax - GOB_TUNING.largeMin + 1));
  const gobs: ChunkGroup[] = [];

  for (let i = 0; i < Math.min(nLarge, sources.length); i++) {
    const { limb, p } = sources[i]!;
    const mid: Vec3 = [
      (p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2,
    ];
    const nBlobs = GOB_TUNING.blobsMin
      + Math.floor(rng() * (GOB_TUNING.blobsMax - GOB_TUNING.blobsMin + 1));
    const prims: Primitive[] = [];
    for (let b = 0; b < nBlobs; b++) {
      const scatter = p.radius * GOB_TUNING.blobScatter;
      const centre = add(mid, [
        (rng() - 0.5) * 2 * scatter,
        (rng() - 0.5) * 2 * scatter,
        (rng() - 0.5) * 2 * scatter,
      ]);
      // Short fat capsule with a random small axis, or a sphere (a==b).
      const axis: Vec3 = rng() < 0.5
        ? [0, 0, 0]
        : vscale([rng() - 0.5, rng() - 0.5, rng() - 0.5], p.radius * 0.8);
      const jit = (): number => GOB_TUNING.jitterMin
        + rng() * (GOB_TUNING.jitterMax - GOB_TUNING.jitterMin);
      prims.push({
        a: centre,
        b: add(centre, axis),
        radius: p.radius * GOB_TUNING.blobRadiusScale * (0.8 + rng() * 0.4),
        scale: [jit(), jit(), jit()],
        blendK: 0.06,
        limb,
        cluster: 0,
      });
    }
    // 1-2 torn points on blob surfaces, so edges read ripped.
    const tornAt: Vec3[] = [];
    const nTorn = 1 + (rng() < 0.5 ? 1 : 0);
    for (let t = 0; t < nTorn; t++) {
      const bp = prims[Math.floor(rng() * prims.length)]!;
      const dir: Vec3 = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const l = len(dir) || 1;
      tornAt.push(add(bp.a, vscale(dir, bp.radius / l)));
    }
    gobs.push({ limb, prims, origin: mid, tornAt: tornAt.slice(0, 2) });
  }
  if (head) gobs.push(head);

  const nScraps = GOB_TUNING.scrapMin
    + Math.floor(rng() * (GOB_TUNING.scrapMax - GOB_TUNING.scrapMin + 1));
  const scraps: Scrap[] = [];
  for (let s = 0; s < nScraps; s++) {
    const src = sources[Math.floor(rng() * sources.length)]?.p;
    const at: Vec3 = src
      ? [(src.a[0] + src.b[0]) / 2, (src.a[1] + src.b[1]) / 2, (src.a[2] + src.b[2]) / 2]
      : torsoCentre;
    scraps.push({
      pos: [at[0] + (rng() - 0.5) * 0.2, at[1] + (rng() - 0.5) * 0.2, at[2] + (rng() - 0.5) * 0.2],
      size: GOB_TUNING.scrapSizeMin
        + rng() * (GOB_TUNING.scrapSizeMax - GOB_TUNING.scrapSizeMin),
    });
  }
  return { gobs, scraps };
}
```

- [ ] **Step 3:** tests pass, tsc clean, full suite green.
- [ ] **Step 4: Commit** — `feat(sdf-lab): amorphous gob generation — hunks + scraps, not anatomy prims`

---

### Task 2: Blood-sim scrap band

**Files:**
- Modify: `src/lab/sdf-zombie/blood-sim.ts`
- Test: `src/lab/sdf-zombie/blood-sim.test.ts` (append)

Scraps are heavy slow particles in the same sim: extend `Droplet` with a
`kind: 'drop' | 'scrap'` field (default `'drop'`), add
`addScraps(sim, scraps: {pos, size}[], origin: Vec3, rng)` that launches each
scrap radially from the body centre at HALF the burst speed band with an
up-bias, `life` 6s, and integrate scraps with 2x the drag. Splat on
floor/expiry as droplets do (scraps stamp a LARGER splat: size * 2.2).
TDD: failing tests first (scrap kind present, speed band half of GIB_BURST,
larger splats, determinism), then implement, suite green, commit
`feat(sdf-lab): scrap particles in the blood sim`.

---

### Task 3: Gore-mask chunk shading (WGSL)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (MARCH_BODY)
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (uniform + chunk views)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (tripwire)

Chunks drop the clean latex read (spec §2):

- New uniform slot: `lodCfg.w` is currently spare — RENAME nothing, just use
  it as `goreStrength` (0 on the body, 1 on chunk views). Verify it is spare
  first (`grep -n "lodCfg" src/lab/sdf-zombie/webgpu/*.ts`) — if it is taken,
  use `faceCfg3.z/.w` spares instead and document.
- In MARCH_BODY after `albedo = mix(albedo, charColor, cm);` insert:

```wgsl
  // Gore mask (gobs-and-goo spec §2): chunks are torn meat, not clean latex.
  // fbm mottling + proximity to the torn wounds; blends toward wet deep red
  // and darker clot, and rides the wet boost so bloody regions glisten.
  let goreStrength = lodCfg.w;
  var gore = 0.0;
  if (goreStrength > 0.0) {
    let mottle = clamp(fbm(p * 6.0) * 0.5 + 0.5, 0.0, 1.0);
    gore = clamp(mottle * 0.55 + wm * 0.65, 0.0, 1.0) * goreStrength;
    let clot = deepColor * 0.55;
    albedo = mix(albedo, mix(deepColor, clot, mottle), gore * 0.85);
  }
```

  and extend the wet line: `let wet = surfCfg2.x * mix(1.0, 1.6, max(wm, gore)) * (1.0 - cm);`
  (NOTE: `wm`/`cm` are computed above this point — insert AFTER them; `gore`
  must therefore be computed before `wet`, so move the gore block to just
  after the `wm`/`cm` lets and before the albedo/face section, adapting the
  albedo blend to operate on the `albedo` var at that point.)
- `createChunkGpuView`: after the template copy, set `u.lodCfg.value.w = 1;`
  (the body view keeps 0). The head chunk keeps gore too — it just tore off.
- Tripwire test: MARCH_BODY contains `goreStrength` and `fbm(p * 6.0)`.
- TDD, suite green, visual sanity if a browser is available (chunks mottled
  red, standing body unchanged), commit
  `feat(sdf-lab): gore-mask shading on chunk fields`.

---

### Task 4: Shell-displacement silhouette experiment (bench-gated)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (MARCH_BODY loop)
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts` (panel toggle + `__sdfLab.setShellDisplace`)
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (tripwire)

Restore REAL silhouette noise cheaply: march the smooth field with full
relaxation until close, then displace only inside a thin shell with
conservative steps (owner-approved "middle path").

- `woundCfg2.z` is a spare slot (verify) → `shellAmp` (0 = off; on = the
  silhouette noise amplitude, default `marchCfg.z`'s 0.016 value when the
  toggle is on).
- In MARCH_BODY's march loop, replace the `let d = mapBody(...)` line with:

```wgsl
    var d = mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2);
    // Shell displacement: inside a thin shell of the smooth surface, the
    // silhouette noise displaces the REAL field — bumpy outlines are back —
    // and stepping goes conservative because the noise breaks the Lipschitz
    // bound. Outside the shell the relaxed march is untouched.
    let shellAmp = woundCfg2.z;
    var conservative = false;
    if (shellAmp > 0.0 && abs(d) < shellAmp * 4.0) {
      d = d + fbm((camPos + rd * t) * 3.0) * shellAmp;
      conservative = true;
    }
```

  and where `stepLen = d * omega;` is computed, use
  `stepLen = d * select(omega, 0.6, conservative);` — also force the
  overshoot test to be skipped when `conservative` (`let overshot = !conservative && ...`),
  since retraction math assumes the un-displaced field.
- Panel: a `shell silhouette: off/on` button in the `lod` section wiring
  `u.woundCfg2.value.z = on ? 0.016 : 0` for the body AND all live chunk
  views (chunk views copy woundCfg2 from the template at spawn — enough; note
  in a comment that pre-existing chunks keep their spawn-time setting).
  Expose `setShellDisplace(on: boolean)` on `__sdfLab`.
- **Bench gate protocol (record all numbers in your final report):**
  1. `setCrowdCount(9)` (10 bodies), shell OFF → `await __sdfLab.benchGpu()` × 2, quote the second.
  2. Shell ON → same.
  3. KEEP ON BY DEFAULT if the 10-body shell-ON median is ≤ 12 ms at the
     default 0.70 scale; otherwise default OFF and note the numbers. Set the
     default in `defaultUniforms` (`woundCfg2` z component) accordingly.
- Tripwires: MARCH_BODY contains `shellAmp` and `select(omega, 0.6, conservative)`.
- TDD, suite green, commit `feat(sdf-lab): shell-displaced silhouettes behind a bench-gated toggle`.

---

### Task 5: Screen-space metaball blood

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/goo-layer.ts`
- Modify: `src/lab/sdf-zombie/webgpu/blood-view-gpu.ts` (demote to mist-only)
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts` OR compose in lab-main (see below)
- Test: none unit-testable beyond construction — verified visually + report.

The core of the spec. Structure `goo-layer.ts` as a small twin of
`sdf-layer.ts`'s target management (copy its RenderTarget option pattern at
`sdf-layer.ts:200-226` and its explicit-first-clear discipline — the comment
at `sdf-layer.ts:228-240` explains the WebGPU lazy-init submit rejection you
will otherwise hit):

1. **Density target:** `THREE.RenderTarget` at 1/2 the SDF layer size,
   `FloatType`, no depth. A `THREE.InstancedMesh` of unit quads (cap 700 =
   droplets+scraps) with an `AdditiveBlending` `MeshBasicNodeMaterial` whose
   colorNode is a radial falloff `max(0, 1 - r*r)` scaled by particle size;
   R channel accumulates density, G accumulates `density * viewDepth` (for a
   depth estimate), B accumulates `density` again for normalisation. Billboard
   the quads CPU-side per frame exactly as blood-view-gpu.ts does today
   (copy its matrix compose incl. velocity stretch — stretch is what makes
   strands fuse along motion).
2. **Surface pass:** a fullscreen quad (mirror how sdf-layer's composite pass
   draws) with a `wgslFn` fragment: sample density; `if (dens < THRESH) discard;`
   normal from central-difference density gradient (4 taps), fake depth =
   G/B; shade: deep red base `vec3(0.35, 0.02, 0.05)`, key-light diffuse,
   tight specular glint (pow 90) + fresnel rim using the same lightDir/
   keyColor uniforms the march uses (plumb them in); alpha 1. Write
   `frag_depth` from the fake depth so goo interleaves with flesh and floor
   (zombie-gpu's march material shows the TSL depth-write pattern to copy).
   THRESH, and a soft edge `smoothstep(THRESH, THRESH*1.6, dens)`, exported
   as tunable constants; add panel sliders `goo threshold` / `goo edge` in a
   new `goo` panel section.
3. **Wiring:** render order per frame = density pass → (existing sdf/cone/
   occluder flow) → surface pass composited with the scene. Follow how
   lab-main's `setDrawFn(() => sdfLayer.render(scene, camera))` composes and
   insert the goo layer's two passes inside a `gooLayer.render(...)` called
   from the same drawFn. The existing `blood-view-gpu` InstancedMesh stays
   ONLY for droplets smaller than 0.05 (mist); droplets ≥ 0.05 and ALL scraps
   go to the density pass. Splat quads unchanged.
4. `__sdfLab` gains `gooLayer` (threshold/edge setters) for console tuning.

This task is the most renderer-API-heavy: where this plan's code sketches
disagree with what three r185's node API actually accepts, ADAPT — the
in-repo patterns (sdf-layer.ts passes, zombie-gpu.ts wgslFn material,
blood-view-gpu.ts instancing) are the authority. Budget your time: a working
blobby-merged result with tunable threshold beats a pixel-perfect match to
the sketch. Commit `feat(sdf-lab): screen-space metaball blood`.

---

### Task 6: Wire gobs into the gib flow + verification + TASKS

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `TASKS.md`

- [ ] `gibEverything()` (WebGPU lab only): replace the `gibAllPieces` spawn
  loop with:

```ts
    const centre = torsoCentre();
    const { body: next } = gibAllPieces(current, centre); // alive-flag bookkeeping
    const { gobs, scraps } = makeGobs(current, centre, Math.random);
    for (const g of gobs) {
      // Radial launch, same speed band as before (fix-pass values).
      const dx = g.origin[0] - centre[0], dy = g.origin[1] - centre[1], dz = g.origin[2] - centre[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      const speed = 5.0 + Math.random() * 4.0;
      const vel: Vec3 = [
        (dx / l) * speed + (Math.random() - 0.5) * 1.2,
        (0.8 + Math.random() * 0.8) * speed * 0.8,
        (dz / l) * speed + (Math.random() - 0.5) * 1.2,
      ];
      spawnChunk(g.limb, g.origin, g.prims, vel, g.tornAt);
    }
    addScraps(bloodSim, scraps, centre, Math.random);
    current = next;
```

  (keep the rest of the function: wounds reset, view.update, refreshWounds,
  rebind). Sever paths are UNTOUCHED — amputations stay real anatomy.
- [ ] Verification (browser if available; `__sdfLab`-driven): G-gib → a few
  ragged mottled hunks + gooey scraps in a connected viscous spray; strands
  where the spray is dense; sever still drops real limbs; standing body
  unchanged; `benchGpu()` with the pile live recorded in the report. Note
  misses as PENDING, don't fail the task.
- [ ] TASKS.md: flip `X1.21` to `[x]` with a ≤2-line rollup (+ shell-experiment
  verdict and its numbers).
- [ ] Commit `feat(sdf-lab): gobs in the gib flow — X1.21 landed`.
