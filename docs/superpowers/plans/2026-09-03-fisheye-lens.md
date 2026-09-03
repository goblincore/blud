# Fisheye Lens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sdf-game view a strong fisheye lens — the middle of the screen magnified and bulging, no straight lines left — by rendering at a wider FOV and squeezing it back in the final blit.

**Architecture:** A new pure module `fisheye.ts` owns the radial map (JS forward, JS inverse, and the WGSL that mirrors it). `post-aa.ts` folds that map into its existing canvas blit — no new pass, no new render target. `game-main.ts` widens the camera to 90°, hands post-aa the lens, and draws the DOM reticle through the inverse map so the crosshair keeps sitting on what the shot hits.

**Tech Stack:** TypeScript, three.js r185 WebGPU + TSL (`wgslFn`), vitest.

**Spec:** [docs/superpowers/specs/2026-09-03-fisheye-lens-design.md](../specs/2026-09-03-fisheye-lens-design.md)

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/fisheye.ts` (**create**) | The lens, and nothing else: `Lens`, `makeLens`, `sampleRadius` (forward), `screenRadius` (inverse), `reticleNdc`, `visibleFovDeg`, and `FISHEYE_WGSL` — the single definition the shader and the reticle both use. |
| `src/lab/sdf-zombie/webgpu/fisheye.test.ts` (**create**) | Pure maths tests. |
| `src/lab/sdf-zombie/webgpu/post-aa.ts` (**modify**) | Blit grows a `lens` parameter and a 4-tap warped path; `setLens` / `lens` on the interface; the lens joins the `active` gate. |
| `src/lab/sdf-zombie/webgpu/post-aa.test.ts` (**modify**) | Parity with the lens off; redirect with it on; WGSL text guards cover the new helper. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` (**modify**) | Camera to 90°, `postAa.setLens`, reticle through `reticleNdc`, `__sdfGame` seams. |

Why the lens is its own file rather than more of `post-aa.ts`: `post-aa.ts` is already 580 lines and the reticle code lives in a different module entirely. A shader and a DOM element that must agree on one curve should import that curve, not each re-derive it.

---

### Task 1: The lens maths

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/fisheye.ts`
- Test: `src/lab/sdf-zombie/webgpu/fisheye.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/fisheye.test.ts`:

```ts
// src/lab/sdf-zombie/webgpu/fisheye.test.ts
//
// The lens is pure maths, so it is tested as pure maths. Every property here
// is one the shader and the reticle both depend on: if the corner stops
// pinning, black creeps into the frame; if the inverse stops round-tripping,
// the crosshair stops sitting on what the shot hits.

import { describe, it, expect } from 'vitest';
import {
  FISHEYE_DEFAULTS, FISHEYE_WGSL, makeLens, cornerRadius, sampleRadius,
  screenRadius, reticleNdc, visibleFovDeg,
} from './fisheye';

const ASPECT = 16 / 9;
const DEF = makeLens(
  FISHEYE_DEFAULTS.renderFovDeg, FISHEYE_DEFAULTS.centerFovDeg, ASPECT,
);

describe('fisheye lens geometry', () => {
  it('the corner radius is the diagonal in half-height units', () => {
    expect(cornerRadius(ASPECT)).toBeCloseTo(Math.hypot(ASPECT, 1), 12);
    expect(cornerRadius(1)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('pins the corner to the corner at every aspect', () => {
    for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9, 0.75]) {
      const lens = makeLens(90, 60, aspect);
      expect(sampleRadius(lens.rmax, lens)).toBeCloseTo(lens.rmax, 10);
    }
  });

  it('leaves the centre at the centre', () => {
    expect(sampleRadius(0, DEF)).toBe(0);
  });

  it('never samples outside the source (no black corners, by construction)', () => {
    for (let i = 0; i <= 200; i++) {
      const r = (DEF.rmax * i) / 200;
      expect(sampleRadius(r, DEF)).toBeLessThanOrEqual(r + 1e-12);
    }
  });

  it('is monotonic in r', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const s = sampleRadius((DEF.rmax * i) / 200, DEF);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('magnifies the centre by exactly the FOV ratio', () => {
    // sampleRadius'(0) = tan(centre/2) / tan(render/2): the knob is honest.
    const want = Math.tan((60 * Math.PI) / 360) / Math.tan((90 * Math.PI) / 360);
    const h = 1e-5;
    expect(sampleRadius(h, DEF) / h).toBeCloseTo(want, 8);
  });

  it('is an exact identity when the centre FOV is not narrower', () => {
    for (const [rf, cf] of [[90, 90], [60, 75], [75, 75]] as const) {
      const lens = makeLens(rf, cf, ASPECT);
      expect(lens.k).toBe(0);
      expect(sampleRadius(0.731, lens)).toBe(0.731);
      expect(screenRadius(0.731, lens)).toBe(0.731);
      expect(reticleNdc({ x: 0.4, y: -0.7 }, lens)).toEqual({ x: 0.4, y: -0.7 });
    }
  });
});

describe('fisheye inverse', () => {
  it('round-trips the forward map across the whole radius range', () => {
    for (let i = 0; i <= 200; i++) {
      const r = (DEF.rmax * i) / 200;
      expect(screenRadius(sampleRadius(r, DEF), DEF)).toBeCloseTo(r, 9);
    }
  });

  it('pushes an off-centre reticle outward, and pins the corner', () => {
    const mid = reticleNdc({ x: 0.5, y: 0 }, DEF);
    expect(mid.x).toBeGreaterThan(0.5);
    expect(mid.y).toBe(0);
    // The screen corner is the fixed point of the map in both directions.
    const corner = reticleNdc({ x: 1, y: 1 }, DEF);
    expect(corner.x).toBeCloseTo(1, 9);
    expect(corner.y).toBeCloseTo(1, 9);
  });

  it('leaves dead centre alone', () => {
    expect(reticleNdc({ x: 0, y: 0 }, DEF)).toEqual({ x: 0, y: 0 });
  });
});

describe('fisheye reporting', () => {
  it('reports the vertical FOV actually visible, not the one rendered', () => {
    // Mid-edges are cropped by the warp: 90 rendered reads as ~68.3 on screen.
    expect(visibleFovDeg(90, DEF)).toBeCloseTo(68.3, 1);
    expect(visibleFovDeg(90, makeLens(90, 90, ASPECT))).toBeCloseTo(90, 9);
  });

  it('ships the owner-approved defaults', () => {
    expect(FISHEYE_DEFAULTS.renderFovDeg).toBe(90);
    expect(FISHEYE_DEFAULTS.centerFovDeg).toBe(60);
  });
});

describe('fisheye shader/JS agreement', () => {
  // JS and WGSL cannot literally share an expression, so this is a tripwire
  // instead: edit one side of the map and this fails until the other side
  // matches. A silent divergence here puts the crosshair off the shot.
  it('the WGSL scale mirrors sampleRadius', () => {
    expect(FISHEYE_WGSL).toContain(
      'let scale = (1.0 + k * r * r) / (1.0 + k * rmax * rmax);',
    );
  });

  it('the WGSL takes the same off switch', () => {
    expect(FISHEYE_WGSL).toContain('if (k <= 0.0) { return st; }');
  });

  it('is exactly one helper fn, for appending to the blit', () => {
    expect(FISHEYE_WGSL.trim().startsWith('fn fisheyeWarp(')).toBe(true);
    expect(FISHEYE_WGSL.match(/\bfn\s+\w+\s*\(/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/fisheye.test.ts
```

Expected: FAIL — `Failed to resolve import "./fisheye"`.

- [ ] **Step 3: Write the module**

Create `src/lab/sdf-zombie/webgpu/fisheye.ts`:

```ts
// src/lab/sdf-zombie/webgpu/fisheye.ts
//
// THE LENS. A radial magnifying warp applied at the canvas blit: the middle of
// the screen samples a small patch of the rendered frame (magnified, bulging)
// and the periphery samples a wide one (squeezed). Straight lines bend, which
// is the whole point.
//
// Everything is expressed in HALF-HEIGHT UNITS: a point at NDC (x, y) sits at
// q = (x * aspect, y), so the screen's vertical edge is at radius 1 and its
// corner at rmax = sqrt(aspect^2 + 1). Working here rather than in UV keeps
// the map circular on screen instead of elliptical.
//
//   sampleRadius(r) = r * (1 + k*r^2) / (1 + k*rmax^2)
//   k               = (tan(render/2) / tan(centre/2) - 1) / rmax^2
//
// Two properties do the load-bearing work, and both are pinned by tests:
//
//   * sampleRadius(r) <= r everywhere for k >= 0, so every sample lands inside
//     the source rect. NO BLACK CORNERS, at any aspect, by construction.
//   * sampleRadius(rmax) = rmax, so the corner is a fixed point. Pinning there
//     retains the most field a radial warp can. The MID-EDGES are still pulled
//     in — a radial map on a rectangle cannot keep both — which is why the
//     render FOV goes UP to pay for it. See visibleFovDeg().
//
// THIS FILE IS THE ONE DEFINITION. The blit shader (FISHEYE_WGSL, below) and
// the DOM reticle (reticleNdc) must agree on the curve to the pixel, so they
// import it rather than each spelling it out. If you edit one, edit the other
// in the same commit — fisheye.test.ts and post-aa.test.ts both guard it.

/** A lens resolved for one display aspect. `k = 0` is an exact identity. */
export interface Lens {
  /** Cubic coefficient of the radial map. 0 = off. */
  k: number;
  /** Corner radius in half-height units, sqrt(aspect^2 + 1). */
  rmax: number;
  /** The display aspect (width / height) this lens was built for. */
  aspect: number;
}

/** The owner-approved look: render 90 vertical, read 60 at screen centre. */
export const FISHEYE_DEFAULTS = {
  renderFovDeg: 90,
  centerFovDeg: 60,
} as const;

/** Half the screen diagonal, in half-height units. */
export function cornerRadius(aspect: number): number {
  return Math.hypot(aspect, 1);
}

/**
 * Build the lens. Both FOVs are VERTICAL degrees: `renderFovDeg` is what the
 * camera draws, `centerFovDeg` what the middle of the screen should read as.
 * A centre FOV that is not narrower than the render FOV yields k = 0 — the
 * off switch, and an exact identity rather than an approximate one.
 */
export function makeLens(
  renderFovDeg: number, centerFovDeg: number, aspect: number,
): Lens {
  const rmax = cornerRadius(aspect);
  const clampFov = (d: number) => Math.min(179, Math.max(1, d));
  const rf = clampFov(renderFovDeg);
  const cf = clampFov(centerFovDeg);
  if (cf >= rf) return { k: 0, rmax, aspect };
  const ratio = Math.tan((rf * Math.PI) / 360) / Math.tan((cf * Math.PI) / 360);
  return { k: (ratio - 1) / (rmax * rmax), rmax, aspect };
}

/** Forward map: the source radius a screen radius samples from. */
export function sampleRadius(r: number, lens: Lens): number {
  if (lens.k <= 0) return r;
  return (r * (1 + lens.k * r * r)) / (1 + lens.k * lens.rmax * lens.rmax);
}

/**
 * Inverse map: the screen radius at which source radius `s` appears. Content
 * moves OUTWARD, because the centre is magnified.
 *
 * Solves k*r^3 + r - C = 0 with C = s * (1 + k*rmax^2). The cubic is strictly
 * increasing and convex for k > 0, so Newton from r = C (always an
 * overestimate) converges monotonically in a handful of steps.
 */
export function screenRadius(s: number, lens: Lens): number {
  if (lens.k <= 0) return s;
  const c = s * (1 + lens.k * lens.rmax * lens.rmax);
  let r = c;
  for (let i = 0; i < 24; i++) {
    const step = (lens.k * r * r * r + r - c) / (3 * lens.k * r * r + 1);
    r -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return r;
}

/**
 * Where to DRAW a reticle that marks the true-frustum aim point `aim` (NDC,
 * -1..1 on both axes). The world moves under the crosshair when the lens is
 * on, so the crosshair has to move with it or it stops telling the truth.
 */
export function reticleNdc(
  aim: { x: number; y: number }, lens: Lens,
): { x: number; y: number } {
  if (lens.k <= 0) return { x: aim.x, y: aim.y };
  const qx = aim.x * lens.aspect;
  const qy = aim.y;
  const s = Math.hypot(qx, qy);
  if (s < 1e-9) return { x: 0, y: 0 };
  const scale = screenRadius(s, lens) / s;
  return { x: (qx * scale) / lens.aspect, y: qy * scale };
}

/**
 * The vertical FOV actually VISIBLE on screen, degrees — smaller than the
 * render FOV, because the warp pulls the vertical mid-edge (radius 1) in.
 * Reported by the __sdfGame seam so the knob can be tuned against what the
 * player sees rather than what the camera draws.
 */
export function visibleFovDeg(renderFovDeg: number, lens: Lens): number {
  const tanR = Math.tan((renderFovDeg * Math.PI) / 360);
  return (360 / Math.PI) * Math.atan(sampleRadius(1, lens) * tanR);
}

/**
 * The shader half of the same map, appended to the blit's WGSL. `lens` is
 * (k, rmax, aspect) — aspect is passed rather than derived from
 * textureDimensions, because under a 'fixed' cap the content target is
 * letterboxed and its dimensions are not the display aspect.
 *
 * Mirrors sampleRadius() exactly, as the ratio (1 + k*r^2)/(1 + k*rmax^2) so
 * no divide by r is needed at the centre.
 */
export const FISHEYE_WGSL = /* wgsl */ `
fn fisheyeWarp(st: vec2<f32>, lens: vec3<f32>) -> vec2<f32> {
  let k = lens.x;
  if (k <= 0.0) { return st; }
  let rmax = lens.y;
  let aspect = lens.z;
  let q = (st - vec2<f32>(0.5, 0.5)) * vec2<f32>(2.0 * aspect, 2.0);
  let r = length(q);
  if (r < 1.0e-6) { return st; }
  let scale = (1.0 + k * r * r) / (1.0 + k * rmax * rmax);
  let w = q * scale;
  return vec2<f32>(w.x / (2.0 * aspect), w.y * 0.5) + vec2<f32>(0.5, 0.5);
}`;
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/fisheye.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/fisheye.ts src/lab/sdf-zombie/webgpu/fisheye.test.ts
git commit -m "fisheye: the lens map, forward and inverse

One definition of the radial warp for the shader and the reticle to share.
Corner pinned so no sample ever leaves the source rect; the mid-edge crop
that buys is reported by visibleFovDeg rather than hidden.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the lens into the blit shader

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.ts` (the `POST_AA_BLIT_WGSL` constant, currently at :211)
- Test: `src/lab/sdf-zombie/webgpu/post-aa.test.ts`

Read the header of `post-aa.ts` before touching it. Two rules there are easy to break: the colour chain (`postAaEotf` on the way out, `cfg.y` says whether the source is already display-encoded) and the orientation invariant (the pass count must not change — which is exactly why the warp goes *inside* this pass instead of becoming a new one).

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/lab/sdf-zombie/webgpu/post-aa.test.ts`:

```ts
describe('post-aa fisheye in the blit', () => {
  it('the blit takes a lens parameter', () => {
    expect(POST_AA_BLIT_WGSL).toMatch(/lens\s*:\s*vec3<f32>/);
  });

  it('carries the fisheye helper, and still starts with its own main fn', () => {
    // three anchors the wgslFn parse to ^, so the helper must be APPENDED.
    expect(/^fn\s+postAaBlit\s*\(/.test(POST_AA_BLIT_WGSL)).toBe(true);
    expect(POST_AA_BLIT_WGSL).toContain('fn fisheyeWarp(');
    expect(POST_AA_BLIT_WGSL.indexOf('fn fisheyeWarp('))
      .toBeGreaterThan(POST_AA_BLIT_WGSL.indexOf('fn postAaBlit('));
  });

  it('supersedes sharp mode rather than stacking with it', () => {
    // The warped branch is taken FIRST; sharp's fractional ramp assumes an
    // axis-aligned magnification the warp does not provide.
    const warpAt = POST_AA_BLIT_WGSL.indexOf('if (lens.x > 0.0)');
    const sharpAt = POST_AA_BLIT_WGSL.indexOf('} else if (cfg.z > 0.5)');
    expect(warpAt).toBeGreaterThan(-1);
    expect(sharpAt).toBeGreaterThan(warpAt);
  });

  it('prefilters the warped fetch with four taps', () => {
    // Pinning the corner minifies the periphery ~2x; a single point fetch
    // there shimmers. Four rotated-grid taps, warped independently, spread
    // themselves by the local Jacobian for free.
    expect(POST_AA_BLIT_WGSL).toContain('var offs: array<vec2<f32>, 4>');
    expect(POST_AA_BLIT_WGSL).toContain('acc * 0.25');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/post-aa.test.ts -t fisheye
```

Expected: FAIL — 4 failures, the first on `lens : vec3<f32>` not matching.

- [ ] **Step 3: Import the helper and add the parameter**

At the top of `src/lab/sdf-zombie/webgpu/post-aa.ts`, after the existing `lab-renderer` import, add:

```ts
import { FISHEYE_WGSL, makeLens, type Lens } from './fisheye';
```

Then change the `POST_AA_BLIT_WGSL` signature from:

```ts
export const POST_AA_BLIT_WGSL = /* wgsl */ `fn postAaBlit(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  cfg: vec4<f32>,
  dstSize: vec2<f32>
) -> vec4<f32> {
```

to:

```ts
export const POST_AA_BLIT_WGSL = /* wgsl */ `fn postAaBlit(
  srcTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  cfg: vec4<f32>,
  dstSize: vec2<f32>,
  lens: vec3<f32>
) -> vec4<f32> {
```

- [ ] **Step 4: Add the warped branch**

In the same string, replace this line:

```wgsl
  if (cfg.z > 0.5) {
```

with:

```wgsl
  if (lens.x > 0.0) {
    // FISHEYE. Four rotated-grid taps a quarter of a DESTINATION pixel apart,
    // each warped independently: where the lens minifies, the warp itself
    // spreads the taps further apart in the source, so the average is a
    // prefilter that costs no Jacobian maths. Supersedes sharp mode (cfg.z),
    // whose fractional ramp assumes an axis-aligned uniform magnification the
    // warp does not provide.
    var offs: array<vec2<f32>, 4> = array<vec2<f32>, 4>(
      vec2<f32>( 0.125,  0.375), vec2<f32>( 0.375, -0.125),
      vec2<f32>(-0.125, -0.375), vec2<f32>(-0.375,  0.125));
    let texel = vec2<f32>(1.0, 1.0) / dstSize;
    var acc = vec3<f32>(0.0, 0.0, 0.0);
    for (var i: i32 = 0; i < 4; i = i + 1) {
      let warped = fisheyeWarp(st + offs[i] * texel, lens);
      let wp = clamp(vec2<i32>(floor(warped * srcDims)), vec2<i32>(0, 0), maxP);
      acc = acc + postAaFetch(srcTex, wp, cfg.y, maxP);
    }
    c = acc * 0.25;
  } else if (cfg.z > 0.5) {
```

Leave the sharp branch and the final `else` (the plain nearest fetch) exactly as they are. `offs` is a `var`, not a `let`, because WGSL only allows a dynamic index on a reference.

- [ ] **Step 5: Append the helper to the string**

The blit constant's last helper is `postAaFetch`, whose closing brace is immediately followed by the terminating backtick and a semicolon (`post-aa.ts:271`). Only that terminator changes:

```ts
  if (isDisplay > 0.5) { return c; }
  return postAaOetf(c);
}

` + FISHEYE_WGSL;
```

The **blank line before the closing backtick matters**: `FISHEYE_WGSL` now begins directly with `fn fisheyeWarp(` (no leading newline, matching `humanoid.wgsl.ts`), so without a separator the concatenation would read `}fn fisheyeWarp(`. Leave every other line of the string exactly as it is.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/post-aa.test.ts
```

Expected: PASS, including the pre-existing WGSL parse-contract and reserved-word guards (the new names — `lens`, `k`, `rmax`, `aspect`, `q`, `r`, `scale`, `w`, `offs`, `texel`, `acc`, `i`, `warped`, `wp` — are all clear of the reserved list).

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/post-aa.ts src/lab/sdf-zombie/webgpu/post-aa.test.ts
git commit -m "post-aa: fisheye branch in the canvas blit

Warped 4-tap path ahead of sharp mode, helper appended so the wgslFn parse
still anchors on postAaBlit. No new pass: the orientation invariant counts
intermediate passes and must not move.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Give post-aa a lens to hold

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/post-aa.ts` (interface, uniforms, `refit`, `render`, returned object)
- Test: `src/lab/sdf-zombie/webgpu/post-aa.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lab/sdf-zombie/webgpu/post-aa.test.ts`, inside the existing `describe('post-aa all-off parity (the hard gate)')` block:

```ts
  it('a lens is off by default, and off is an exact identity', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    expect(post.lens.k).toBe(0);
  });

  it('all-off parity survives a lens that is set but not narrowing', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setLens(90, 90); // centre not narrower than render -> k = 0
    calls.setRenderTarget = 0;
    calls.render = 0;

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(post.lens.k).toBe(0);
    expect(chainCalls).toBe(1);
    expect(calls.setRenderTarget).toBe(0);
    expect(calls.render).toBe(0);
  });

  it('a narrowing lens is an active effect: it redirects and runs the passes', () => {
    const { renderer, calls } = stubRenderer();
    const post = createPostAa(renderer);
    post.setFxaa(false);
    post.setSmear(0);
    post.setLens(90, 60);
    const sink = { target: null as THREE.RenderTarget | null };
    post.addSink({ setOutputTarget(t) { sink.target = t; } });

    let chainCalls = 0;
    post.render(() => { chainCalls++; });

    expect(post.lens.k).toBeGreaterThan(0);
    expect(chainCalls).toBe(1);
    expect(sink.target).not.toBeNull();
    expect(calls.render).toBeGreaterThan(0);
  });

  it('resolves the lens against the CONTENT aspect, not the window', () => {
    const { renderer } = stubRenderer();
    const post = createPostAa(renderer);
    post.setLens(90, 60);
    const c = post.contentSize;
    expect(post.lens.aspect).toBeCloseTo(c.width / c.height, 9);
    expect(post.lens.rmax).toBeCloseTo(Math.hypot(post.lens.aspect, 1), 9);
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/post-aa.test.ts -t lens
```

Expected: FAIL — `post.lens is undefined` / `post.setLens is not a function`.

- [ ] **Step 3: Extend the interface**

In `src/lab/sdf-zombie/webgpu/post-aa.ts`, in the `PostAa` interface next to `setBlitFlipY` / `readonly fxaa`, add:

```ts
  /**
   * The fisheye. Both arguments are VERTICAL degrees: what the camera renders,
   * and what the middle of the screen should read as. A centre FOV that is not
   * narrower than the render FOV turns the lens off exactly (k = 0), and the
   * all-off parity path then still applies.
   */
  setLens(renderFovDeg: number, centerFovDeg: number): void;
  /** The lens resolved against the live content aspect. `k = 0` = off. */
  readonly lens: Lens;
```

- [ ] **Step 4: Add the state, the uniform, and the recompute**

Next to `const uSmear = ...` in `createPostAa`, add:

```ts
  // The lens, held as the two FOVs it was asked for: `k` depends on the
  // display aspect, so it is re-resolved on every refit rather than cached
  // from whatever the window happened to be at boot.
  let lensRenderFov = 0;
  let lensCenterFov = 0;
  let lens: Lens = makeLens(0, 0, 1);
  // (k, rmax, aspect) — see fisheye.ts. All zero until setLens is called.
  const uLens = uniform(new THREE.Vector3(0, 0, 0));
```

Add the resolver just above the existing `function refit()`:

```ts
  function recomputeLens() {
    const c = computeRenderSize(window.innerWidth, window.innerHeight);
    lens = makeLens(lensRenderFov, lensCenterFov, c.width / c.height);
    uLens.value.set(lens.k, lens.rmax, lens.aspect);
  }
```

Add `recomputeLens();` as the last statement inside `refit()` — after the target `setSize` calls — so a window resize re-resolves the lens on the same listener that resizes everything else.

- [ ] **Step 5: Feed the uniform to the blit and the gate**

In the `blitOut` wiring, add the parameter:

```ts
  const blitOut = wgslFn(POST_AA_BLIT_WGSL)({
    srcTex: blitSrcTex,
    texCoord: uv(),
    cfg: uBlitCfg,
    dstSize: uBlitDst,
    lens: uLens,
  }) as unknown as Swizzled;
```

In `render(chain)`, change the `active` line from:

```ts
      const active = fxaaOn || smear > 0 || sharpOn;
```

to:

```ts
      // A narrowing lens is an effect like any other: it needs the capture
      // redirect, because the blit has to sample a texture rather than be one.
      const active = fxaaOn || smear > 0 || sharpOn || lens.k > 0;
```

- [ ] **Step 6: Expose it on the returned object**

Next to `setSmear` / `get smear()` in the returned object, add:

```ts
    setLens(renderFovDeg, centerFovDeg) {
      lensRenderFov = renderFovDeg;
      lensCenterFov = centerFovDeg;
      recomputeLens();
    },
    get lens() { return lens; },
```

- [ ] **Step 7: Run the whole post-aa suite**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/post-aa.test.ts
```

Expected: PASS — in particular the pre-existing "is an exact pass-through" test, which must still see zero `setRenderTarget` and zero `render` calls.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/post-aa.ts src/lab/sdf-zombie/webgpu/post-aa.test.ts
git commit -m "post-aa: hold a lens, re-resolved per refit

k depends on the display aspect, so the FOVs are stored and the lens rebuilt
on resize. A narrowing lens joins the active gate; an off one leaves the
all-off parity path untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Point the game camera through the lens

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:377` (after `createPostAa`) and the `__sdfGame` seam block near `:3032`

No test in this task — it is wiring between two tested units, and the game page has no headless harness. Task 6 verifies it on screen.

- [ ] **Step 1: Import the lens defaults**

In the import block of `src/lab/sdf-zombie/webgpu/game-main.ts`, add:

```ts
import { FISHEYE_DEFAULTS, reticleNdc, visibleFovDeg } from './fisheye';
```

- [ ] **Step 2: Widen the camera and hand post-aa the lens**

Immediately after `const postAa = createPostAa(handle.renderer);` (`:377`), insert:

```ts
  // THE FISHEYE. The camera renders WIDER than the player sees and the blit
  // squeezes it back, which is what buys the bulge without losing the frame
  // to a warp that reaches off the buffer. `centerFovDeg` is the look knob;
  // camera.fov is what pays for it. Both live on __sdfGame.
  let centerFovDeg: number = FISHEYE_DEFAULTS.centerFovDeg;
  camera.fov = FISHEYE_DEFAULTS.renderFovDeg;
  camera.updateProjectionMatrix();
  postAa.setLens(camera.fov, centerFovDeg);
```

`camera` is already destructured from `handle` at `:160`. Nothing else needs touching for the wider frustum: `sizeSdfLayer` (`:408`), the tile cull, the LOD footprints and `free-aim`'s frustum tangents all read `camera.fov` and follow it.

- [ ] **Step 3: Add the seams**

In the `__sdfGame` object, directly after `setSmear: (v: number) => postAa.setSmear(v),` (`:3032`), insert:

```ts
    // ---------------------------------------------------------------
    // THE FISHEYE. setFisheye(deg) sets the apparent vertical FOV at
    // screen CENTRE; setRenderFov(deg) sets what the camera actually
    // draws. The bend is the ratio between them, so raising the render
    // FOV at a fixed centre FOV bends harder AND shows more world —
    // at the cost of more of it being marched. setFisheye(camera.fov)
    // (or anything wider) turns the lens off exactly.
    // ---------------------------------------------------------------
    setFisheye: (deg: number) => {
      centerFovDeg = deg;
      postAa.setLens(camera.fov, centerFovDeg);
    },
    setRenderFov: (deg: number) => {
      camera.fov = deg;
      camera.updateProjectionMatrix();
      postAa.setLens(camera.fov, centerFovDeg);
      sizeSdfLayer();
    },
    /** renderFovDeg is what is drawn, visibleFovDeg what reaches the
     *  screen (the warp crops the mid-edges), centerFovDeg what the
     *  middle reads as. Tune against `visible`, not `render`.
     *  Read the render FOV off the LENS, not off the camera: the lens
     *  is what the blit actually applied, and the two could otherwise
     *  drift through separate seams. */
    get fisheye() {
      return {
        renderFovDeg: postAa.lens.renderFovDeg,
        centerFovDeg,
        visibleFovDeg: visibleFovDeg(postAa.lens),
        k: postAa.lens.k,
      };
    },
```

`sizeSdfLayer` is called from `setRenderFov` because the cone geometry is derived from `camera.fov` and is otherwise only refreshed on resize.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. `reticleNdc` is imported here but not used until Task 5; `tsconfig.json` does not set `noUnusedLocals`, so that is not an error — it is used two tasks later.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game: render at 90 and squeeze to a 60-degree centre

The camera goes wider, not narrower — the warp needs frame to pull in.
Seams report the visible FOV alongside the rendered one, because the
mid-edge crop means those are not the same number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Make the crosshair tell the truth again

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:2379-2391` (the reticle placement block)
- Test: `src/lab/sdf-zombie/webgpu/fisheye.test.ts` (already covers `reticleNdc` from Task 1)

This is correctness, not polish. The reticle is a DOM element placed linearly from the free-aim point; once the world warps underneath it, at any off-centre aim it marks a spot the shot does not go to. Firing is unaffected — `free-aim.ts` keeps working in the true frustum — so only the drawn position moves.

- [ ] **Step 1: Replace the placement**

Change:

```ts
        const r = canvas.getBoundingClientRect();
        reticleEl.style.left = `${r.left + r.width * (0.5 + aim.x * 0.5)}px`;
        reticleEl.style.top = `${r.top + r.height * (0.5 - aim.y * 0.5)}px`;
```

to:

```ts
        const r = canvas.getBoundingClientRect();
        // Through the LENS. The fisheye moves the world under the crosshair,
        // so the crosshair rides the inverse map or it stops marking where
        // the shot lands. Pushed outward, because the centre is magnified.
        // Lens off (k = 0) returns `aim` unchanged — this is the old line.
        const p = reticleNdc(aim, postAa.lens);
        reticleEl.style.left = `${r.left + r.width * (0.5 + p.x * 0.5)}px`;
        reticleEl.style.top = `${r.top + r.height * (0.5 - p.y * 0.5)}px`;
```

- [ ] **Step 2: Typecheck and run the whole suite**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no type errors; every test passes.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game: draw the reticle through the lens inverse

The world moves under the crosshair when the fisheye is on. Without this
the thing marking where you aim sits somewhere you cannot shoot -- the
same class of bug the canvas-rect fix already caught once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Look at it

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Capture the four named poses**

```bash
scripts/dungeon-look.sh corridor /tmp/fisheye-after && scripts/dungeon-look.sh room /tmp/fisheye-after && scripts/dungeon-look.sh wall /tmp/fisheye-after && scripts/dungeon-look.sh beam /tmp/fisheye-after
```

Expected: four PNGs in `/tmp/fisheye-after/`. Open each and check, in order:

1. **No black anywhere at the frame edge or corners.** Any black is a bug in the forward map — `sampleRadius(r) <= r` should make it impossible, so suspect the UV round-trip in `fisheyeWarp` rather than the maths.
2. **The corridor bends.** In `corridor.png` the tunnel's wall/floor lines should bow outward from centre. If they are straight, `lens.k` is 0 — check `post.lens` in the console.
3. **The centre is magnified** relative to a pre-change shot. Compare against the same pose on `main` if you want an A/B: `git stash` is NOT safe in this worktree (shared stack) — use `git worktree add` or capture from a separate checkout.
4. **The gun bulges with the world** rather than sitting flat on top of it — that is the intended look, per the owner.

- [ ] **Step 2: Check the periphery for shimmer**

With the page open, strafe and rotate. Watch the outer third of the frame for crawling edges. Some is expected and the 0.25 smear hides most of it. If it is objectionable, the first thing to try is the knob, not the code:

```js
__sdfGame.setFisheye(70)   // gentler bend, less peripheral minification
```

- [ ] **Step 3: Check the reticle against the shot**

Enable free aim, push the reticle well off centre (a corner is the strongest test), and fire at a wall. The scorch must land under the crosshair. If it lands between the crosshair and screen centre, `reticleNdc` is being applied in the wrong direction — it must push OUTWARD.

- [ ] **Step 4: Check the frame budget**

```js
__sdfGame.resolveGpu()
```

Watch the HUD frame time in the `room` pose (three zombies). 90° vertical marches appreciably more world than 75° did. If it has slipped past the 30 fps budget, pull the render FOV back and re-look — this is the tuning the knob exists for:

```js
__sdfGame.setRenderFov(85)
```

- [ ] **Step 5: Record the verdict**

Write what the stills showed, the chosen `renderFovDeg` / `centerFovDeg`, and the measured frame time into `docs/dev-notes/2026-09-03-fisheye/notes.md`, and update the **Current focus** section of `TASKS.md` with the state and the seam names. Commit both.

```bash
git add docs/dev-notes/2026-09-03-fisheye/notes.md TASKS.md
git commit -m "fisheye: capture notes and the tuning verdict

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Save what was learned**

```bash
source ~/.claude/hooks/dualmem-env.sh
~/go/bin/dualmem add --type architecture --salience 0.8 --files "src/lab/sdf-zombie/webgpu/fisheye.ts,src/lab/sdf-zombie/webgpu/post-aa.ts,src/lab/sdf-zombie/webgpu/game-main.ts" --text "Fisheye lens: camera renders 90 vertical, the post-aa BLIT warps it to a 60-degree apparent centre. Map lives in fisheye.ts and is shared by the shader (FISHEYE_WGSL) and the DOM reticle (reticleNdc) -- they must not diverge. Corners pinned so no sample leaves the source rect; mid-edges ARE cropped (90 rendered reads 68.3 on screen). Seams: __sdfGame.setFisheye(centreDeg) / setRenderFov(deg) / .fisheye"
```

---

## Notes for the implementer

**Do not turn the warp into its own pass.** `post-aa.ts`'s orientation invariant depends on the number of intermediate passes: each one flips its entry sampling exactly once, and the blit's `flipY` handles the single canvas boundary. Adding a pass would flip the image, and the symptom (upside-down only in *some* toggle combinations, because the flips cancel in pairs) is genuinely hard to read. The file header spells this out — read it before restructuring anything there.

**`git stash` is unsafe in this worktree.** The stash stack is shared with the main checkout and other sessions. Use a WIP commit to set work aside.

**If the shader silently draws nothing**, the first suspect is the `wgslFn` parse anchor: three anchors on `^fn <name>(`, so `POST_AA_BLIT_WGSL` must still *begin* with `fn postAaBlit(` and the fisheye helper must be appended after it. Task 2 has a test for exactly this.
