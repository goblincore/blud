# Blood viscosity — impact gouts + overlay goo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sdf-game.html` blood read as viscous and voluminous — impact-fired gouts dense enough for the metaball to fuse, composited as a screen-space overlay, shaded with Beer-Lambert thickness.

**Architecture:** Two emission profiles feed one unchanged render pipeline. A new pure `spawnImpactGout()` fires a dense one-tick burst at projectile impact and at sever; the existing wound trickle is untouched. `goo-layer.ts` gains an `overlay` mode (no depth write, no depth test, alpha-blended) that deletes the depth-rejection blocker rather than solving it, and a thickness term in the surface shader that gives the mass a dark core with bright thin edges.

**Tech Stack:** TypeScript, three.js r185 WebGPU (`three/webgpu`, `three/tsl`), WGSL via `wgslFn`, vitest, Playwright-driven headless capture scripts.

**Spec:** [docs/superpowers/specs/2026-08-31-blood-viscosity-design.md](../specs/2026-08-31-blood-viscosity-design.md)

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/goo-layer.ts` | Screen-space metaball: density → blur → surface. Owns `GOO_TUNING`, `GOO_SURFACE_WGSL`, `GOO_BLUR_WGSL`, `createGooLayer`. | Modify: add `GOO_ALPHA_WGSL`, thickness + live shading uniforms, `setMode`, retire `setDepthTest` |
| `src/lab/sdf-zombie/webgpu/goo-layer.test.ts` | WGSL text guards + tuning value pins. Compiles nothing. | Modify: add guards for the new shader math and mode wiring |
| `src/lab/sdf-zombie/blood-sim.ts` | Pure droplet sim. Owns `WOUND_BLEED`, `spawnWoundDroplets`, `stepBlood`. | Modify: add `IMPACT_GOUT` + `spawnImpactGout` |
| `src/lab/sdf-zombie/blood-sim.test.ts` | Sim behaviour under seeded rng. | Modify: add the gout describe block |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Game page wiring + `__sdfGame` debug seams. | Modify: fire gouts at 2 call sites; `setGooTuning` grows knobs |
| `TASKS.md` | Status board. | Modify: record state at the end |

**Baseline to hold throughout:** `npx tsc --noEmit` clean, `npx vitest run` at 1719 tests or more.

---

### Task 1: Merge the spike branch

The game-page goo port is on `claude/bleed-look-spike`, not on this branch. `goo-layer.ts` exists here but that is the lab's copy from X1.21 — the tell is that `setGoo` does not appear in `game-main.ts`. Every later task assumes the merged tree.

**Files:**
- Modify: whole tree (merge)

- [ ] **Step 1: Confirm the port really is absent**

Run:
```bash
grep -c "setGoo" src/lab/sdf-zombie/webgpu/game-main.ts
```
Expected: `0`. If it prints a non-zero number the merge already happened — skip to Step 4.

- [ ] **Step 2: Merge**

Run:
```bash
git merge claude/bleed-look-spike -m "merge: goo-layer game-page port (X1.bleed-look round 2) as the base for blood-viscosity"
```

Expected: a conflict in `TASKS.md` only. Resolve it by **keeping both sides' content** — this branch's side has the blood-viscosity spec row, the spike's side has the round-2 status. No other file should conflict; `docs/superpowers/specs/2026-08-31-blood-viscosity-design.md` exists only on this side and merges clean.

- [ ] **Step 3: Commit the merge if the conflict needed hand-resolution**

```bash
git add TASKS.md
git commit --no-edit
```

- [ ] **Step 4: Verify the merged tree**

Run:
```bash
npx tsc --noEmit && npx vitest run 2>&1 | tail -5
```
Expected: tsc silent; vitest reports 1719 passing tests, 0 failures.

- [ ] **Step 5: Confirm the seams arrived**

Run:
```bash
grep -c "setGoo\|setGooTuning" src/lab/sdf-zombie/webgpu/game-main.ts
```
Expected: a number ≥ 4.

---

### Task 2: Beer-Lambert thickness + live shading uniforms

This is the change that makes the mass read as volume. The surface currently shades a flat `base = vec3(0.35, 0.02, 0.05)` with a hard-coded specular exponent of 90 and a rim fixed at 0.35. It becomes: absorption over field thickness (red absorbed lightly, green and blue hard), with specular strength, specular exponent and rim strength promoted to uniforms so they can be swept from the console.

All four new knobs ride ONE new `vec4` parameter, so the `wgslFn` signature churns once rather than four times.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/goo-layer.ts`
- Test: `src/lab/sdf-zombie/webgpu/goo-layer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lab/sdf-zombie/webgpu/goo-layer.test.ts`, at the end of the file:

```ts
describe('goo thickness shading (blood-viscosity spec §d)', () => {
  it('absorbs green and blue harder than red, so a thick core goes dark crimson', () => {
    const m = GOO_SURFACE_WGSL.match(
      /exp\(-thick \* vec3<f32>\(([\d.]+), ([\d.]+), ([\d.]+)\)\)/,
    );
    expect(m, 'the Beer-Lambert absorption vector must be present').not.toBeNull();
    const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
    // Blood is red because red survives the path length. If red were absorbed
    // as hard as green, thick blood would go grey, not crimson.
    expect(r).toBeLessThan(g);
    expect(r).toBeLessThan(b);
  });

  it('measures thickness from the field ABOVE the threshold, not raw density', () => {
    // dens alone would make the whole surface dark the moment the threshold
    // moves; (dens - thresh) keeps the thin fringe bright at any setting.
    expect(GOO_SURFACE_WGSL).toMatch(/let thick = max\(dens - thresh, 0\.0\) \* gooCfg2\.x/);
  });

  it('takes specular strength, exponent and rim from uniforms, not literals', () => {
    expect(GOO_SURFACE_WGSL).toMatch(/pow\(max\(dot\(n, H\), 0\.0\), gooCfg2\.z\)/);
    expect(GOO_SURFACE_WGSL).toContain('gooCfg2.y');
    expect(GOO_SURFACE_WGSL).toContain('gooCfg2.w');
    // The old hard-coded exponent must be gone, or the uniform is dead code.
    expect(GOO_SURFACE_WGSL).not.toContain('0.0), 90.0)');
  });

  it('declares gooCfg2 as a vec4 parameter', () => {
    expect(GOO_SURFACE_WGSL).toMatch(/gooCfg2: vec4<f32>/);
  });
});

describe('goo shading setters (blood-viscosity spec: clamp ranges)', () => {
  // The clamp trap, in test form: setThreshold was clamped at 0.95 while a
  // lone blob peaks near 1.0, so no reachable value could reject a single
  // droplet and three rounds of tuning were unwinnable. Every new setter gets
  // its ceiling checked against the range the shader actually produces.
  it('exposes absorb/spec/gloss/rim on the layer interface', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');
    for (const fn of ['setAbsorb', 'setSpec', 'setGloss', 'setRim']) {
      expect(src, `${fn} must exist`).toContain(`${fn}(`);
    }
  });

  it('clamps absorb above 3 and gloss down to a broad 8, per the 2D prototype range', () => {
    const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');
    expect(src).toMatch(/setAbsorb\(v\) \{ uAbsorb\.value = Math\.max\(0, Math\.min\(3, v\)\); \}/);
    expect(src).toMatch(/setGloss\(v\) \{ uGloss\.value = Math\.max\(8, Math\.min\(220, v\)\); \}/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run src/lab/sdf-zombie/webgpu/goo-layer.test.ts
```
Expected: FAIL — the absorption regex does not match, `setAbsorb` is not in the source.

- [ ] **Step 3: Add the tuning defaults**

In `src/lab/sdf-zombie/webgpu/goo-layer.ts`, inside `GOO_TUNING`, after the `blurPx` entry, add:

```ts
  /**
   * Beer-Lambert thickness strength (blood-viscosity spec §d). Multiplies
   * (density - threshold) before the absorption exponential, so it scales
   * how fast a mass darkens as it thickens. 0 reproduces the old flat base.
   * 0.55 is the 2D prototype's owner-selected value.
   */
  absorb: 0.55,
  /** Specular strength — the wet glint that sells "shiny". */
  spec: 1.4,
  /** Specular exponent. LOW = broad wet sheen, HIGH = a pinpoint star. */
  gloss: 80,
  /** Fresnel rim strength, warm-tinted so edges do not read pink. */
  rim: 0.3,
```

- [ ] **Step 4: Rewrite the shading block in `GOO_SURFACE_WGSL`**

In `src/lab/sdf-zombie/webgpu/goo-layer.ts`, change the function signature — add `gooCfg2` as the last parameter:

```wgsl
export const GOO_SURFACE_WGSL = /* wgsl */ `fn gooSurface(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  camWorld: mat4x4<f32>,
  camCfg: vec4<f32>,
  gooCfg: vec3<f32>,
  gooCfg2: vec4<f32>
) -> vec4<f32> {
```

Then replace the whole shading block — everything from the comment line
`// Shade with the march's rig: deep red base, key diffuse, a tight wet` down
to and including the line `lit = lit + keyColor * (glint * 1.2 + rim) * softEdge;`
— with:

```wgsl
  // Shade with the march's rig, over a BEER-LAMBERT body (blood-viscosity
  // spec §d). The old flat base made every mass the same red whatever its
  // depth, which is exactly why the layer read as stickers rather than
  // fluid. Absorption over the field ABOVE the threshold gives a thick core
  // that goes near-black crimson while a thin film stays bright orange-red;
  // that gradient IS the volume read, and it is what the reference frames
  // have that the shipped effect did not. Red is absorbed lightly and green
  // and blue hard, which is why blood is red rather than grey at depth.
  let L = normalize(lightDir);
  let Vv = -ray;
  let H = normalize(L + Vv);
  let diff = max(dot(n, L), 0.0);
  let softEdge = smoothstep(thresh, thresh * gooCfg.y, dens);

  let thick = max(dens - thresh, 0.0) * gooCfg2.x;
  let absorb = exp(-thick * vec3<f32>(0.30, 2.40, 2.00));
  let lambert = lightCfg.y + diff * lightCfg.x;
  var lit = vec3<f32>(0.62, 0.11, 0.10) * absorb * lambert * keyColor
    * mix(0.55, 1.0, softEdge);

  // Highlights ride ON TOP of the absorbed body and are NOT absorbed —
  // a surface reflection never travelled through the blood. Glint is white
  // and tight (the wet read); the rim stays warm so a fringe cannot wash the
  // mass pink, which is what a neutral rim did at high bump values.
  let glint = pow(max(dot(n, H), 0.0), gooCfg2.z);
  lit = lit + keyColor * glint * gooCfg2.y * softEdge;
  let fres = pow(1.0 - max(dot(n, Vv), 0.0), 3.0);
  lit = lit + vec3<f32>(0.85, 0.14, 0.12) * fres * gooCfg2.w * softEdge;
```

Leave the `if (gooCfg.z > 0.5)` legacy-gamma block and the `return vec4<f32>(lit, depthBuf);` exactly as they are.

- [ ] **Step 5: Add the uniforms**

In `createGooLayer`, next to `const uBlurPx = uniform(GOO_TUNING.blurPx);`, add:

```ts
  const uAbsorb = uniform(GOO_TUNING.absorb);
  const uSpec = uniform(GOO_TUNING.spec);
  const uGloss = uniform(GOO_TUNING.gloss);
  const uRim = uniform(GOO_TUNING.rim);
```

- [ ] **Step 6: Pass the new vector in `makeSurfaceMat`**

In `makeSurfaceMat`, add one line to the `surface({...})` argument object, immediately after `gooCfg: vec3(uThresh, uEdge, uLegacy),`:

```ts
      gooCfg2: vec4(uAbsorb, uSpec, uGloss, uRim),
```

`vec4` is already imported from `three/tsl` at the top of the file — confirm it is in the import list and add it if not.

- [ ] **Step 7: Add the setters and readbacks**

In the `GooLayer` interface, after `setSizeScale(v: number): void;`, add:

```ts
  /** Beer-Lambert thickness strength — 0 is the old flat base. */
  setAbsorb(v: number): void;
  /** Specular strength (the wet glint). */
  setSpec(v: number): void;
  /** Specular exponent — low is a broad sheen, high is a pinpoint. */
  setGloss(v: number): void;
  /** Fresnel rim strength. */
  setRim(v: number): void;
  readonly absorb: number;
  readonly spec: number;
  readonly gloss: number;
  readonly rim: number;
```

In the returned object, next to `setSizeScale`, add:

```ts
    // CLAMP RANGES are checked against what the shader actually produces, not
    // guessed — see the setThreshold note above for what guessing cost.
    // absorb: 0 is the old flat base; past ~2.5 even the fringe is black.
    setAbsorb(v) { uAbsorb.value = Math.max(0, Math.min(3, v)); },
    setSpec(v) { uSpec.value = Math.max(0, Math.min(4, v)); },
    // gloss FLOOR of 8, not 1: below ~8 the lobe is wider than the blob and
    // the whole surface reads as flat white, which looks like a broken pass.
    setGloss(v) { uGloss.value = Math.max(8, Math.min(220, v)); },
    setRim(v) { uRim.value = Math.max(0, Math.min(1, v)); },
```

And next to the existing `get blurPx()`-style readbacks, add:

```ts
    get absorb() { return uAbsorb.value; },
    get spec() { return uSpec.value; },
    get gloss() { return uGloss.value; },
    get rim() { return uRim.value; },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run:
```bash
npx vitest run src/lab/sdf-zombie/webgpu/goo-layer.test.ts && npx tsc --noEmit
```
Expected: all goo-layer tests PASS, tsc silent.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/goo-layer.ts src/lab/sdf-zombie/webgpu/goo-layer.test.ts
git commit -m "goo: Beer-Lambert thickness + live specular/rim uniforms

The flat base made every mass the same red whatever its depth, which is
why the layer read as stickers. Absorption over (density - threshold),
red light and green/blue hard, gives a dark crimson core with a bright
thin fringe -- the volume read the reference frames have.

Specular strength/exponent and rim promoted to uniforms so the look can
be swept from the console; all four ride one new vec4 so the wgslFn
signature churns once."
```

---

### Task 3: Overlay mode

The surface pass currently writes a depth reconstructed from the density field's average view depth, and depth-tests against it. That reconstruction rejects near-body blood — the blood that matters — so goo appeared only against distant background. Overlay mode stops writing and testing depth entirely and composites over the frame.

The existing `setDepthTest` diagnostic is retired: it was a partial preview of this mode, and keeping two overlapping knobs invites setting one and wondering why the other did nothing.

Alpha needs a second tiny shader. `gooSurface` already spends its `w` on the depth value, so the soft-edge band that overlay mode wants as alpha comes from a separate one-texel `gooAlpha`.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/goo-layer.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Test: `src/lab/sdf-zombie/webgpu/goo-layer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/webgpu/goo-layer.test.ts`:

```ts
describe('goo alpha WGSL (overlay mode)', () => {
  it('starts with fn, since three anchors its parse to ^', () => {
    expect(GOO_ALPHA_WGSL.startsWith('fn ')).toBe(true);
  });

  it('declares nothing reserved', () => {
    for (const name of declaredNames(GOO_ALPHA_WGSL)) {
      expect(RESERVED_WORDS, `"${name}" is a WGSL reserved word`).not.toContain(name);
    }
  });

  it('discards below the threshold, exactly as the surface pass does', () => {
    // If the two passes disagreed on the cutoff, overlay mode would blend a
    // colour the surface pass never shaded.
    expect(GOO_ALPHA_WGSL).toContain('if (dens < thresh) { discard; }');
  });

  it('returns the soft-edge band in w so strands feather instead of hard-cutting', () => {
    expect(GOO_ALPHA_WGSL).toMatch(/smoothstep\(thresh, thresh \* gooCfg\.y, dens\)/);
    expect(GOO_ALPHA_WGSL).toMatch(/return vec4<f32>\(0\.0, 0\.0, 0\.0, a\)/);
  });
});

describe('goo overlay mode wiring (source tripwires)', () => {
  const src = readFileSync('src/lab/sdf-zombie/webgpu/goo-layer.ts', 'utf8');

  it('builds a material per (mode x blurred) combination', () => {
    // Asserted on the table literal and the dynamic lookup, NOT on
    // "surfMats.depth.blur"-style paths: render() indexes the pair with
    // computed keys, so those strings never appear in the source.
    expect(src).toMatch(/overlay: \{ raw: makeOverlayMat\(target\.texture\), blur: makeOverlayMat\(blurB\.texture\) \}/);
    expect(src).toMatch(/depth: \{ raw: makeDepthMat\(target\.texture\), blur: makeDepthMat\(blurB\.texture\) \}/);
    expect(src).toContain("surfMats[mode][blurred ? 'blur' : 'raw']");
  });

  it('overlay materials neither test nor write depth, and are transparent', () => {
    expect(src).toMatch(/m\.depthWrite = false;\s*\n\s*m\.depthTest = false;\s*\n\s*m\.transparent = true;/);
  });

  it('overlay materials do not bind a depthNode', () => {
    // Binding depthNode in overlay mode would silently reinstate the
    // reconstruction this mode exists to delete.
    const overlayFn = src.slice(src.indexOf('function makeOverlayMat'), src.indexOf('function makeDepthMat'));
    expect(overlayFn).not.toContain('depthNode');
  });

  it('retires setDepthTest in favour of setMode', () => {
    expect(src).not.toContain('setDepthTest');
    expect(src).toContain("setMode(m: 'overlay' | 'depth')");
  });

  it('defaults to overlay — the shipped answer to the depth blocker', () => {
    expect(src).toMatch(/let mode: 'overlay' \| 'depth' = 'overlay';/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run src/lab/sdf-zombie/webgpu/goo-layer.test.ts
```
Expected: FAIL — `GOO_ALPHA_WGSL` is not exported.

- [ ] **Step 3: Add the alpha shader**

In `src/lab/sdf-zombie/webgpu/goo-layer.ts`, immediately after `GOO_SURFACE_WGSL`, add:

```ts
/**
 * Overlay mode's alpha (blood-viscosity spec §c). `gooSurface` spends its w
 * on the reconstructed depth value, so the soft-edge band that overlay mode
 * blends with comes from here — one texel load, no gradient taps.
 *
 * The discard condition is duplicated deliberately and must stay identical
 * to the surface pass's: if the two disagreed on the cutoff, overlay would
 * blend a colour the surface never shaded.
 *
 * Returns a vec4 rather than a bare f32 so it swizzles through the same
 * `Swizzled` cast every other pass here uses.
 */
export const GOO_ALPHA_WGSL = /* wgsl */ `fn gooAlpha(
  densTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  gooCfg: vec3<f32>
) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(densTex, 0));
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let maxP = vec2<i32>(dims) - vec2<i32>(1, 1);
  let px = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), maxP);
  let dens = textureLoad(densTex, px, 0).r;
  let thresh = gooCfg.x;
  if (dens < thresh) { discard; }
  let a = smoothstep(thresh, thresh * gooCfg.y, dens);
  return vec4<f32>(0.0, 0.0, 0.0, a);
}`;
```

- [ ] **Step 4: Split `makeSurfaceMat` into two builders**

In `createGooLayer`, replace the whole `makeSurfaceMat` function and the two `surfRawMat` / `surfBlurMat` lines with:

```ts
  const surface = wgslFn(GOO_SURFACE_WGSL);
  const alphaFn = wgslFn(GOO_ALPHA_WGSL);

  /** The shaded colour, shared by both modes. */
  function shadeOf(densTexture: THREE.Texture): Swizzled {
    return surface({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      lightDir: rig.lightDir,
      keyColor: rig.keyColor,
      lightCfg: rig.lightCfg,
      camWorld: uCamWorld,
      camCfg: uCamCfg,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
      gooCfg2: vec4(uAbsorb, uSpec, uGloss, uRim),
    }) as unknown as Swizzled;
  }

  /**
   * OVERLAY (default). No depth at all: the goo composites over the finished
   * frame. This DELETES the depth blocker rather than fixing it — the
   * reconstruction from the density field's average view depth rejected
   * near-body blood, so goo appeared only against distant background. The
   * accepted cost is that a burst behind a pillar still paints over it,
   * which for a sub-second event centred on the thing you just shot is close
   * to theoretical.
   */
  function makeOverlayMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const a = alphaFn({
      densTex: texture(densTexture),
      texCoord: uv(),
      flipY: uFlipY,
      gooCfg: vec3(uThresh, uEdge, uLegacy),
    }) as unknown as Swizzled;
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, a.w as never);
    m.depthWrite = false;
    m.depthTest = false;
    m.transparent = true;
    m.fog = false;
    return m;
  }

  /** DEPTH (the escape hatch). The original behaviour, kept intact. */
  function makeDepthMat(densTexture: THREE.Texture): MeshBasicNodeMaterial {
    const shaded = shadeOf(densTexture);
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(shaded.xyz as never, 1.0);
    m.depthNode = shaded.w as never;
    m.depthWrite = true;
    m.depthTest = true;
    m.fog = false;
    return m;
  }

  const surfMats = {
    overlay: { raw: makeOverlayMat(target.texture), blur: makeOverlayMat(blurB.texture) },
    depth: { raw: makeDepthMat(target.texture), blur: makeDepthMat(blurB.texture) },
  };
  let mode: 'overlay' | 'depth' = 'overlay';
```

Delete the now-unused `const surfaceMaterials: THREE.Material[] = [];` declaration and its `surfaceMaterials.push(m);` line.

- [ ] **Step 5: Point the quad at the mode's material**

Change the quad construction from `new THREE.Mesh(new THREE.PlaneGeometry(2, 2), surfRawMat)` to:

```ts
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), surfMats.overlay.raw);
```

In `render()`, replace the two lines that pick the material:

```ts
      const wantMat = surfMats[mode][blurred ? 'blur' : 'raw'];
      if (quad.material !== wantMat) quad.material = wantMat;
```

- [ ] **Step 6: Swap the setter**

Replace the whole `setDepthTest(on) { ... }` entry in the returned object with:

```ts
    setMode(m: 'overlay' | 'depth') { mode = m; },
    get mode() { return mode; },
```

And in the `GooLayer` interface, replace the `setDepthTest` declaration and its comment block with:

```ts
  /**
   * 'overlay' (default) composites the goo over the finished frame with no
   * depth involvement. 'depth' restores the original reconstructed-depth
   * interleaving — kept as the escape hatch if the overlay reads wrong
   * against walls in play.
   */
  setMode(m: 'overlay' | 'depth'): void;
  readonly mode: 'overlay' | 'depth';
```

- [ ] **Step 7: Dispose the new materials**

In `dispose()`, replace the `surfRawMat.dispose();` and `surfBlurMat.dispose();` lines with:

```ts
      for (const byMode of Object.values(surfMats)) {
        for (const m of Object.values(byMode)) m.dispose();
      }
```

- [ ] **Step 8: Update the game-main seam**

In `src/lab/sdf-zombie/webgpu/game-main.ts`, change the `setGooTuning` signature and body — replace the `depthTest?: boolean;` field and its `if (o.depthTest !== undefined)` line with the new knobs:

```ts
    setGooTuning(o: {
      threshold?: number; edge?: number; blurPx?: number; sizeScale?: number;
      mode?: 'overlay' | 'depth';
      absorb?: number; spec?: number; gloss?: number; rim?: number;
    }) {
      if (!gooLayer) return;
      if (o.threshold !== undefined) gooLayer.setThreshold(o.threshold);
      if (o.edge !== undefined) gooLayer.setEdge(o.edge);
      if (o.blurPx !== undefined) gooLayer.setBlurPx(o.blurPx);
      if (o.sizeScale !== undefined) gooLayer.setSizeScale(o.sizeScale);
      if (o.mode !== undefined) gooLayer.setMode(o.mode);
      if (o.absorb !== undefined) gooLayer.setAbsorb(o.absorb);
      if (o.spec !== undefined) gooLayer.setSpec(o.spec);
      if (o.gloss !== undefined) gooLayer.setGloss(o.gloss);
      if (o.rim !== undefined) gooLayer.setRim(o.rim);
    },
```

In the `get goo()` readback object, add after `sizeScale: gooLayer.sizeScale,`:

```ts
          mode: gooLayer.mode,
          absorb: gooLayer.absorb,
          spec: gooLayer.spec,
          gloss: gooLayer.gloss,
          rim: gooLayer.rim,
```

- [ ] **Step 9: Run the full suite**

Run:
```bash
npx vitest run && npx tsc --noEmit
```
Expected: all tests PASS (1719 + the new ones), tsc silent.

- [ ] **Step 10: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/goo-layer.ts src/lab/sdf-zombie/webgpu/goo-layer.test.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "goo: overlay mode -- delete the depth blocker rather than fix it

The surface reconstructed a depth from the density field's average view
depth and lost everywhere except against distant background, which is to
say it discarded near-body blood: the blood that matters. Overlay mode
drops depth entirely and composites over the frame, with alpha from a new
one-texel gooAlpha pass so strands feather instead of hard-cutting.

setDepthTest retires into setMode -- it was a partial preview of this,
and two overlapping knobs invites setting one and wondering why the other
did nothing. mode:'depth' keeps the old path as the escape hatch."
```

---

### Task 4: Owner look-check — shading half, before any emitter

**This task writes no code.** It exists because the spec's order of work puts a verdict here deliberately: thickness and overlay change how the *existing* trickle looks, so if the shading is wrong we learn it before building an emitter on top of it.

**Files:** none

- [ ] **Step 1: Serve the game page**

Use the Browser pane's `preview_start` with the project's dev server entry (never `npm run dev` through Bash). Navigate to `sdf-game.html`.

- [ ] **Step 2: Turn the goo on and confirm it draws against a body**

In the page console:
```js
__sdfGame.setGoo(true)
__sdfGame.goo
```
Expected: `enabled: true`, `mode: 'overlay'`.

Shoot a zombie at close range and confirm blood is now visible **on and in front of the body**, not only against the far wall. That single observation is the overlay mode's whole point — if blood still only appears against distant background, the overlay material is not the one being used; check that `quad.material` is being reassigned in `render()`.

- [ ] **Step 3: Confirm alpha actually reached the blend**

Look at the edge of a strand. Feathered means alpha works. If every edge is a hard pixel cut, `colorNode`'s alpha is not reaching the blend stage on this backend. **Contingency, not a TODO:** in that case, change `makeOverlayMat` to premultiply in the shader instead — multiply `lit` by the alpha inside `GOO_SURFACE_WGSL`'s final line, set `m.colorNode = vec4(shaded.xyz, 1.0)`, and set `m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;`. Record which path shipped in the commit message.

- [ ] **Step 4: Hand the owner the sweep**

Give them these console lines and ask for a verdict on the shading alone:

```js
__sdfGame.setGooTuning({ absorb: 0.55, spec: 1.4, gloss: 80, rim: 0.30 })  // spec default
__sdfGame.setGooTuning({ absorb: 1.40, spec: 2.4, gloss: 44, rim: 0.30 })  // "thick sheet"
__sdfGame.setGooTuning({ absorb: 0.00 })                                    // old flat base, for A/B
```

- [ ] **Step 5: STOP and wait for the verdict**

Do not start Task 5 until the owner has passed the shading or asked for changes. If they ask for changes, retune `GOO_TUNING` defaults and re-run this task.

---

### Task 5: The impact gout emitter

A dense one-tick burst. The distribution is the whole point: ~80–300 droplets spread through a volume never overlap densely enough to fuse, but the same blood fired as one packed pulse does.

**Head-fast/tail-slow speed ordering is load-bearing** — in the 2D prototype it was the difference between one round blob and a connected arcing rope. It is a deterministic ramp with no jitter, which is also what makes it testable.

**Files:**
- Modify: `src/lab/sdf-zombie/blood-sim.ts`
- Test: `src/lab/sdf-zombie/blood-sim.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/blood-sim.test.ts`:

```ts
describe('impact gouts (blood-viscosity spec §a)', () => {
  const seeded = () => {
    let s = 0x12345678;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  };
  const anchor: Vec3 = [0, 1.2, 0];
  const dir: Vec3 = [0, 0, 1]; // travelling +z, so blood sprays back along -z

  it('emits the profile count in ONE call — the density the metaball needs', () => {
    for (const kind of ['pellet', 'slug', 'stump'] as const) {
      const sim = createBloodSim();
      spawnImpactGout(sim, kind, anchor, dir, seeded());
      expect(sim.droplets.length, kind).toBe(IMPACT_GOUT[kind].count);
    }
  });

  it('sprays BACK along the incoming direction, not through the body', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    // Every droplet's velocity must have a negative z component: the cone
    // half-angles are all under 90 degrees around -dir.
    for (const d of sim.droplets) expect(d.vel[2]).toBeLessThan(0);
  });

  it('is head-fast/tail-slow: speeds decrease monotonically across the pulse', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    const speeds = sim.droplets.map(d => Math.hypot(d.vel[0], d.vel[1], d.vel[2]));
    for (let i = 1; i < speeds.length; i++) {
      // Strictly decreasing: the ramp carries no jitter, precisely so the
      // pulse STRETCHES into a rope instead of expanding as a ball.
      expect(speeds[i]!).toBeLessThan(speeds[i - 1]!);
    }
    expect(speeds[0]!).toBeCloseTo(IMPACT_GOUT.slug.speedMax, 5);
    expect(speeds[speeds.length - 1]!).toBeCloseTo(IMPACT_GOUT.slug.speedMin, 5);
  });

  it('keeps every droplet inside the profile cone half-angle', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'stump', anchor, dir, seeded());
    const axis = [-dir[0], -dir[1], -dir[2]];
    for (const d of sim.droplets) {
      const len = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
      const cos = (d.vel[0] * axis[0] + d.vel[1] * axis[1] + d.vel[2] * axis[2]) / len;
      expect(Math.acos(Math.min(1, cos))).toBeLessThanOrEqual(IMPACT_GOUT.stump.coneRad + 1e-6);
    }
  });

  it('draws exactly 4 rng values per droplet, in a fixed order', () => {
    const sim = createBloodSim();
    let draws = 0;
    const rng = () => { draws++; return 0.5; };
    spawnImpactGout(sim, 'pellet', anchor, dir, rng);
    expect(draws).toBe(IMPACT_GOUT.pellet.count * 4);
  });

  it('spawns kind "drop" — gout beads are the fluid body, not haze', () => {
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    expect(sim.droplets.every(d => d.kind === 'drop')).toBe(true);
  });

  it('does NOT mark gout beads ribbon-eligible', () => {
    // Ribbons draw straight metre rods at gib speeds -- the round-1 "laser
    // spaghetti" bug. Only slow bleed streams arc enough to read as liquid.
    const sim = createBloodSim();
    spawnImpactGout(sim, 'slug', anchor, dir, seeded());
    expect(sim.droplets.some(d => d.ribbon)).toBe(false);
  });

  it('a full 8-pellet shotgun blast fits inside MAX_DROPLETS', () => {
    // 8 simultaneous pellet gouts must not evict each other mid-blast, or
    // the shotgun reads as one gout instead of eight.
    const sim = createBloodSim();
    const rng = seeded();
    for (let i = 0; i < 8; i++) spawnImpactGout(sim, 'pellet', anchor, dir, rng);
    expect(sim.droplets.length).toBe(IMPACT_GOUT.pellet.count * 8);
  });

  it('is deterministic under a fixed seed', () => {
    const a = createBloodSim();
    const b = createBloodSim();
    spawnImpactGout(a, 'slug', anchor, dir, seeded());
    spawnImpactGout(b, 'slug', anchor, dir, seeded());
    expect(a.droplets).toEqual(b.droplets);
  });
});
```

Add `IMPACT_GOUT` and `spawnImpactGout` to the existing `blood-sim` import at the top of the test file, and `Vec3` to the type imports if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npx vitest run src/lab/sdf-zombie/blood-sim.test.ts
```
Expected: FAIL — `spawnImpactGout` is not exported.

- [ ] **Step 3: Add the profile type and table**

In `src/lab/sdf-zombie/blood-sim.ts`, immediately after the `WOUND_BLEED` table, add:

```ts
export interface ImpactGoutProfile {
  /** Droplets emitted in ONE call. Density is the whole point: a stream
   *  spread over time never overlaps enough for the metaball to fuse, and
   *  the same blood fired as one packed pulse does. */
  count: number;
  /** Cone HALF-angle around the BACKWARD axis, radians. */
  coneRad: number;
  /** Head speed — droplet 0. */
  speedMax: number;
  /** Tail speed — the last droplet. */
  speedMin: number;
  lifeMin: number;
  lifeMax: number;
  sizeMin: number;
  sizeMax: number;
}

/**
 * Per-calibre impact gouts (blood-viscosity spec §a). Fired ONCE at the
 * moment a projectile lands, and once per sever — not a rate.
 *
 * Counts are budgeted against MAX_DROPLETS (600): a shotgun lands 8 pellets
 * at one instant, so `pellet.count * 8` must fit or the blast evicts itself
 * mid-spawn and reads as a single gout instead of eight.
 */
export const IMPACT_GOUT: Record<BleedKind, ImpactGoutProfile> = {
  pellet: {
    count: 14, coneRad: 0.9, speedMax: 5.5, speedMin: 1.2,
    lifeMin: 0.35, lifeMax: 0.7, sizeMin: 0.05, sizeMax: 0.1,
  },
  slug: {
    count: 90, coneRad: 0.7, speedMax: 8, speedMin: 1.5,
    lifeMin: 0.4, lifeMax: 0.9, sizeMin: 0.06, sizeMax: 0.14,
  },
  stump: {
    count: 140, coneRad: 1, speedMax: 7, speedMin: 1.5,
    lifeMin: 0.5, lifeMax: 1, sizeMin: 0.07, sizeMax: 0.16,
  },
};
```

- [ ] **Step 4: Add the emitter**

In `src/lab/sdf-zombie/blood-sim.ts`, after `spawnWoundDroplets`, add:

```ts
/**
 * One impact's gout: the whole pulse in a single call, sprayed BACK along
 * the incoming direction (blood comes toward the shooter, which also means
 * toward the camera — the read overlay mode exists to deliver).
 *
 * PURE. Draws exactly 4 rng values per droplet in a fixed order (cone r,
 * cone theta, size, life), so seeded streams pin it.
 *
 * SPEED IS A DETERMINISTIC RAMP, not a random band: droplet 0 leaves at
 * speedMax and the last at speedMin, so the pulse STRETCHES along its axis
 * into an arcing rope. Jittering it collapses the rope back into a ball —
 * in the 2D prototype that was the entire difference between "one pink
 * blob" and the reference look.
 */
export function spawnImpactGout(
  sim: BloodSim, kind: BleedKind, anchor: Vec3, dirN: Vec3, rng: () => number,
): void {
  const p = IMPACT_GOUT[kind];
  // Back along the shot. A zero/degenerate direction falls back to straight
  // up, the same guard spawnWoundDroplets uses for a degenerate normal.
  const back: Vec3 = [-dirN[0], -dirN[1], -dirN[2]];
  const axis = normalize(
    Math.hypot(back[0], back[1], back[2]) < 1e-9 ? [0, 1, 0] as Vec3 : back,
  );
  const { u, v, w } = basisFromAxis(axis);
  for (let i = 0; i < p.count; i++) {
    const r = p.coneRad * Math.sqrt(rng());
    const theta = rng() * Math.PI * 2;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    const dir = normalize(add(add(scale(w, cr), scale(u, Math.cos(theta) * sr)), scale(v, Math.sin(theta) * sr)));
    const size = p.sizeMin + rng() * (p.sizeMax - p.sizeMin);
    const life = p.lifeMin + rng() * (p.lifeMax - p.lifeMin);
    const t = p.count > 1 ? i / (p.count - 1) : 0;
    const speed = p.speedMax + (p.speedMin - p.speedMax) * t;
    push(sim, {
      pos: [anchor[0] + dir[0] * WOUND_SPAWN_OFFSET,
        anchor[1] + dir[1] * WOUND_SPAWN_OFFSET, anchor[2] + dir[2] * WOUND_SPAWN_OFFSET],
      vel: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
      age: 0,
      life,
      size,
      kind: 'drop',
      // NOT ribbon-eligible: at gout speeds a 0.15 s path history is a
      // straight metre of line, which renders as a laser rod, not fluid.
    });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
npx vitest run src/lab/sdf-zombie/blood-sim.test.ts && npx tsc --noEmit
```
Expected: all blood-sim tests PASS, tsc silent.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/blood-sim.ts src/lab/sdf-zombie/blood-sim.test.ts
git commit -m "bleed: IMPACT_GOUT table + pure spawnImpactGout (TDD)

The metaball fuses neighbours whose density peaks overlap, so a stream
spread over time can never fuse -- the same blood fired as one packed
pulse can. This is that pulse: the whole gout in one call, sprayed back
along the shot so it comes toward the camera.

Speed is a deterministic head-fast/tail-slow ramp, not a random band.
That is what makes the pulse stretch into an arcing rope instead of
expanding as a ball, and it is also what makes it testable."
```

---

### Task 6: Fire gouts from the two call sites

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

- [ ] **Step 1: Import the emitter**

In `src/lab/sdf-zombie/webgpu/game-main.ts`, extend the EXISTING blood-sim
import — do not add a second import statement from the same module:

```ts
import type { ImpactGoutProfile } from '../blood-sim';
import {
  createBloodSim, spawnWoundDroplets, spawnImpactGout, emitTrails, stepBlood, IMPACT_GOUT,
} from '../blood-sim';
```

- [ ] **Step 2: Fire the gout inside `registerBleed`**

`registerBleed` is called from both the impact path and the sever path, and it already receives the kind. Firing from inside it covers both sites with one change and cannot drift apart. Replace the function with:

```ts
  function registerBleed(a: ZombieActor, wound: Wound, kind: 'pellet' | 'slug' | 'stump'): void {
    if (!bleedEnabled) return;
    bleed.register(a.id, wound, kind, bleedClock);
    // IMPACT GOUT (blood-viscosity spec §a) — the dense one-tick pulse, at
    // the wound's own anchor so it leaves the body where the hole is. Fired
    // here rather than at each call site because both the impact path and
    // the sever path already funnel through this function, and two copies
    // would drift. Uses the SAME bleedRng, so setBleed(false) freezes gouts
    // and the trickle together and captures stay deterministic.
    const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, wound);
    // The gout sprays back along the incoming shot; spawnImpactGout negates
    // what it is handed, and the wound normal already points OUT of the
    // body, so pass the inward direction.
    spawnImpactGout(bloodSim, kind, anchor, [-normal[0], -normal[1], -normal[2]], bleedRng);
  }
```

- [ ] **Step 3: Add the debug seam**

In the `__sdfGame` object, next to `setGooTuning`, add:

```ts
    /** Sweep gout density/shape without a rebuild. Mutates the shared table,
     *  so it affects every later impact of that kind. */
    setGoutTuning(kind: 'pellet' | 'slug' | 'stump', o: Partial<ImpactGoutProfile>) {
      Object.assign(IMPACT_GOUT[kind], o);
      return { ...IMPACT_GOUT[kind] };
    },
    get gout() {
      return { pellet: { ...IMPACT_GOUT.pellet }, slug: { ...IMPACT_GOUT.slug }, stump: { ...IMPACT_GOUT.stump } };
    },
```

`IMPACT_GOUT` and `ImpactGoutProfile` were imported in Step 1.

- [ ] **Step 4: Verify**

Run:
```bash
npx vitest run && npx tsc --noEmit
```
Expected: all tests PASS, tsc silent.

- [ ] **Step 5: Confirm it fires in the browser**

Serve the page via the Browser pane, then in the console:
```js
__sdfGame.setGoo(true)
```
Shoot a zombie. Expected: a visible burst at the moment of impact, not just the ongoing trickle. Confirm with `__sdfGame.gout` that the table is reachable.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "bleed: fire impact gouts from registerBleed + console tuning seam

Both the projectile-impact path and the sever path already funnel through
registerBleed with the kind in hand, so the gout fires there -- one site,
no drift. Shares bleedRng, so setBleed(false) freezes gouts and trickle
together and hand-stepped captures stay deterministic."
```

---

### Task 7: Gates and bench

Two gates with prior art, plus the cost measurement round 2 never took.

**Files:**
- Modify: `TASKS.md` (final step)

- [ ] **Step 1: Off-state parity gate**

Goo OFF must be pixel-identical to no-goo. Run:
```bash
node scripts/sdf-game-bleed-gate.mjs
```

Read the script's own options first and run it at `setSmear(0)` **against no-toggle control cycles**. A control cycle is mandatory evidence either way, because this scene has two measured noise floors: silhouette-edge AA that jitters with frame index (two captures of the same static scene differ on ~40–120 edge pixels), and a ±1/255 rounding limit cycle in the temporal filter that survives 240 settle steps because it is a cycle, not decay. **Do not assume literal 0 is reachable** — the pass condition is that toggling adds nothing above the control floor.

Expected: toggle delta ≤ control delta.

- [ ] **Step 2: Bench the three extra passes**

Round 2 left density + two blurs + surface unbenched on a ~10 ms frame. Overlay mode does not change that bill. Run:
```bash
bash scripts/sdf-game-bench.sh
```
Capture the goo-off and goo-on numbers and record the delta in the commit message. If the delta exceeds ~2 ms, say so plainly rather than burying it — `densityScale` (currently 0.5) is the knob that buys it back.

- [ ] **Step 3: Per-calibre impact reel**

Produce a capture per kind (pellet, slug, stump) for the record. Freeze the scene **before** aiming — round 1's captures kept missing because wanderers walk into the muzzle and auto-aim picks offscreen bodies.

- [ ] **Step 4: Commit the evidence**

```bash
git add -A
git commit -m "bleed: gates -- off-state parity, cost bench, per-calibre gout reel

<paste the actual gate numbers, control floor, and the goo-on/goo-off
frame-time delta here -- not a summary of them>"
```

- [ ] **Step 5: Owner playtest**

Hand it over with `__sdfGame.setGoo(true)` and the two tuning seams. **The look verdict is the owner playing it**, not a capture: round 1 proved staged captures miss, and past a point the owner's live tab beat them. Ship state stays `setGoo` default OFF until they pass it.

- [ ] **Step 6: Update `TASKS.md`**

Record: what landed, the bench delta, the gate numbers, the owner verdict, and whether `setGoo` flipped to default ON. Commit.

---

## Notes for the implementer

- **Never run the dev server through Bash.** Use the Browser pane's `preview_start`.
- **`MAX_DROPLETS` is 600 and `GOO_TUNING.maxParticles` is 1000.** A stump gout (140) plus an active trickle plus chunk trails can approach the droplet cap; FIFO eviction of the oldest is correct and expected. Only the 8-pellet blast case is pinned by test.
- **Mist must stay visible whenever goo is on.** The goo only draws where droplets overlap, so a sparse pellet hit crosses no threshold and draws nothing; hiding mist too is what produced the "no blood at all" regression. `setGoo` already handles this — do not "tidy" it.
- **The 2D prototype is still running** at the brainstorm server (`.superpowers/brainstorm/*/content/goo-lab-v2.html`) if a tuning value needs sanity-checking before a game-side round trip.
