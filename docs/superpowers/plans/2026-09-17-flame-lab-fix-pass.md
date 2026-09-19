# Flame Lab Fix Pass Implementation Plan

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a burning body actually read as the engulfed Blood look — dark char patches between moving flames, a charred body that reads burnt — and add flesh that thins as it chars so the skeleton shows through.

**Architecture:** All of this is surface shading in the SDF march, driven by the per-body burn state already plumbed in the foundation pass (`burnCfg` per view, `REC_BURN` per crowd instance, combined with `max()`). The fire noise already rides the rest-space `anchor`; this pass makes the *same* noise drive the dark patches, so flame and char are two sides of one field instead of two unrelated terms. The skeleton show-through folds the existing bone capsules (`applyBones`) as a distance probe at the shading point, so bones near the skin bleed through as the flesh chars — no new geometry, no second march.

**Tech stack:** TypeScript, three.js WebGPU with TSL, WGSL string modules, Vitest, headless-Chrome capture script.

**Why this pass exists:** the foundation pass shipped and its tests pass, but the captures in `docs/dev-notes/2026-09-17-flame-lab/` do not match the reference. The zombie reads as a glowing white-pink statue rather than fire; at char 0.6 it is still pink rather than burnt; fire appears as isolated hot patches on the soldier's limbs instead of covering the body. The owner's verdict on the mesh kit (`soldier-kit.gltf`) is that it does **not** need its own burning surface — the flame tongues in the later plans will envelop it — so nothing here touches the kit.

**Owner decisions carried into this plan:**
- The skeleton show-through **builds with char**: opaque when freshly lit, clearest just before collapse.
- The surface look is judged against the Blood reference tiles in the capture frames, not against a test.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/burn-profiles.ts` (modify) | Two new tuning fields + bounds. |
| `src/lab/sdf-zombie/webgpu/burn-profiles.test.ts` (modify) | Table-driven test already covers new fields; add the semantic ones. |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (modify) | Two new scalar uniforms, bound positionally last. |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (modify) | Noise-driven char, fire coverage, skeleton show-through. |
| `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` (modify) | Shader-string contracts for both. |
| `src/lab/sdf-zombie/webgpu/flame-panel.ts` (modify) | Labels/steps for the new fields (ranges come from `BURN_BOUNDS`). |
| `src/lab/sdf-zombie/webgpu/flame-lab-main.ts` (modify) | Feed the new uniforms; a key to hold char at a value. |
| `scripts/flame-capture.mjs` (modify) | A close framing and a contact sheet against the reference tiles. |
| `docs/dev-notes/2026-09-17-flame-lab/NOTES.md` (rewrite) | Honest verdict, written from the new captures. |

---

## Task 1: Two new tuning fields

**Files:** modify `burn-profiles.ts`, `burn-profiles.test.ts`, `flame-panel.ts`

`fireCoverage` controls how much of the surface carries flame at any instant — the knob that decides "hot statue" versus "engulfed". `skeletonShow` is the strength of the show-through at full char.

- [ ] **Step 1: Write the failing test.** Add to `burn-profiles.test.ts`:

```ts
  it('carries the coverage and skeleton knobs', () => {
    expect(BURN_TUNING.fireCoverage).toBeGreaterThan(0);
    expect(BURN_TUNING.skeletonShow).toBeGreaterThan(0);
    expect(BURN_BOUNDS.fireCoverage).toEqual([0, 1]);
    expect(BURN_BOUNDS.skeletonShow).toEqual([0, 1]);
  });
```

The existing table-driven bounds test walks every field automatically, so it will
cover the new ones with no edit. `flame-panel.test.ts` asserts every `BurnTuning`
field has a slider, so it will go red until Step 3 — that is expected.

- [ ] **Step 2: Run it and watch it fail.** `npm test -- burn-profiles` → FAIL on `fireCoverage` undefined.

- [ ] **Step 3: Add the fields.** In `burn-profiles.ts`:
  - `BurnTuning`: `/** Fraction of the surface carrying flame at once, 0..1. */ fireCoverage: number;` and `/** How far the flesh thins to show bone at full char, 0..1. */ skeletonShow: number;`
  - `BURN_TUNING`: `fireCoverage: 0.75, skeletonShow: 0.5`.
  - `BURN_BOUNDS`: both `[0, 1]`.
  - Presets: `ember` gets `fireCoverage: 0.5, skeletonShow: 0.8` (late-stage, more bone); `inferno` gets `fireCoverage: 0.95, skeletonShow: 0.35`.
  - In `flame-panel.ts`'s `LABELS`: `fireCoverage: { label: 'coverage', step: 0.02 }`, `skeletonShow: { label: 'skeleton', step: 0.02 }`.

- [ ] **Step 4: Verify.** `npm test -- burn-profiles flame-panel` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit.** `git commit -m "Add fire coverage and skeleton show-through tuning"`

---

## Task 2: Char patches and fire coverage in the shader

**Files:** modify `march.wgsl.ts`, `march.wgsl.test.ts`, `zombie-gpu.ts`, `flame-lab-main.ts`

**The defect.** Today the shader is:

```wgsl
  let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);
  let charAmt = clamp(max(burnCfg.z, gInstBurn.z), 0.0, 1.0);
  albedo = mix(albedo, charColor, charAmt);
  if (burnAmt > 0.0) {
    ...
    let fire = clamp(fireN * 1.45 - 0.22, 0.0, 1.0) * burnAmt * (1.0 - charAmt * burnCharPatch);
    gBurnEmit = fireRamp(fire) * fire * burnFireGain;
```

Two things are wrong. **Char is only time-driven**, so a freshly lit body has no
dark anywhere and reads as a uniformly glowing statue; in the reference sprites
dark char shows *between* the flames from the first frame. And **the noise
threshold is fixed**, so coverage cannot be tuned — the body is either sparsely
patched or blown out, which is why the zombie reads white-pink while the
soldier shows isolated hot spots.

**The fix.** One noise field decides both: where it is high there is flame, where
it is low there is char. Time-based char then deepens the dark and suppresses the
fire, rather than being the only source of dark.

- [ ] **Step 1: Write the failing test.** Add to `march.wgsl.test.ts`:

```ts
  it('drives char from the same noise as the fire, not from time alone', () => {
    // The reference sprites show dark char BETWEEN the flames from the first
    // frame. Char that only comes from charAmt makes a freshly lit body a
    // uniformly glowing statue, which is what the first captures showed.
    expect(MARCH_BODY).toContain('let fireN = fbm(');
    expect(MARCH_BODY).toContain('let coverBias = mix(0.85, -0.15, burnFireCoverage);');
    expect(MARCH_BODY).toContain('let fire = clamp(fireN - coverBias, 0.0, 1.0)');
    // Dark where the noise is LOW, deepened by time-based char.
    expect(MARCH_BODY).toContain('let sootMask = clamp((1.0 - fire) * burnCharPatch + charAmt, 0.0, 1.0);');
    expect(MARCH_BODY).toContain('albedo = mix(albedo, charColor, sootMask);');
    // A charred body must stop looking like wet latex.
    expect(MARCH_BODY).toContain('gloss = gloss * (1.0 - sootMask');
  });
```

- [ ] **Step 2: Run it and watch it fail.** `npm test -- march.wgsl` → FAIL.

- [ ] **Step 3: Add the uniform.** In `zombie-gpu.ts` `defaultUniforms`, after the
  existing burn scalars: `burnFireCoverage: uniform(0.75)`. Append
  `burnFireCoverage: u.burnFireCoverage,` **last** in every march binding object
  (find them with `grep -n "burnFireGain: u.burnFireGain" src/lab/sdf-zombie/webgpu/zombie-gpu.ts`),
  and append `burnFireCoverage: f32,` **last** in `MARCH_BODY_PARAMS`. The binding
  is positional — a key in the wrong slot silently hands the shader a different
  uniform. No colons in any comment inside the parameter list.

- [ ] **Step 4: Replace the burn block.** In the surface prep, replace the whole
  existing burn block (from `let burnAmt =` through the closing brace of
  `if (burnAmt > 0.0) { ... }`, including the current
  `albedo = mix(albedo, charColor, charAmt);` line) with:

```wgsl
  // BURNING BODY. One noise field decides both halves of the look: where it is
  // high there is flame, where it is low there is soot. That is what the Blood
  // sprites do -- dark char shows BETWEEN the flames from the first frame, so
  // char cannot come from elapsed time alone or a freshly lit body reads as a
  // uniformly glowing statue.
  let burnAmt = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);
  let charAmt = clamp(max(burnCfg.z, gInstBurn.z), 0.0, 1.0);
  if (burnAmt > 0.0 || charAmt > 0.0) {
    let burnPhase = max(burnCfg.y, gInstBurn.y) * burnRiseSpeed;
    let fireN = fbm(anchor * burnNoiseScale + vec3<f32>(0.0, -burnPhase, 0.0));
    // coverBias slides the threshold: at coverage 1 almost the whole surface is
    // above it, at 0 almost none is.
    let coverBias = mix(0.85, -0.15, burnFireCoverage);
    let fire = clamp(fireN - coverBias, 0.0, 1.0) * burnAmt * (1.0 - charAmt * 0.55);
    let sootMask = clamp((1.0 - fire) * burnCharPatch + charAmt, 0.0, 1.0);
    albedo = mix(albedo, charColor, sootMask);
    // Burnt meat is not wet latex. Killing gloss and metal is most of what
    // makes a charred body read as charred rather than as a dark body.
    gloss = gloss * (1.0 - sootMask * 0.9);
    metal = metal * (1.0 - sootMask * 0.9);
    gBurnEmit = fireRamp(fire) * fire * burnFireGain;
    faceGlow = faceGlow * (1.0 - burnAmt);
    primGlow = primGlow * (1.0 - burnAmt);
  }
```

  If `gloss` or `metal` is a `let` at that point, change its declaration to `var`.
  If they are named differently in the file, use the real names and say so in your
  report. Keep the block AFTER the existing wound-char line
  (`albedo = mix(albedo, charColor, cm);`).

- [ ] **Step 5: Feed the uniform.** In `flame-lab-main.ts`'s per-body loop, beside
  the other burn uniforms: `u.burnFireCoverage.value = tuning.fireCoverage;`

- [ ] **Step 6: Verify.** `npm test` (the flame files must pass; note any
  pre-existing failures, which are 12 files / 15 tests unrelated to this work)
  and `npx tsc --noEmit` clean.

- [ ] **Step 7: Capture and look.** `npm run flame:capture`, then compare
  `stand-fresh.png` and `stand-charred.png` against the Blood tiles composited in
  the corner of each frame. **Required outcome:** a freshly lit body shows dark
  char between flames rather than a uniform glow, and the charred body is visibly
  blackened rather than tinted. If it is not there, tune `fireCoverage`,
  `charPatch` and `fireGain` in `BURN_TUNING` and re-capture until it is, or stop
  and report what you could not achieve. **Do not claim a look you have not seen
  in a capture.**

- [ ] **Step 8: Commit.** `git commit -m "Drive char patches from the fire noise"`

---

## Task 3: Skeleton show-through

**Files:** modify `march.wgsl.ts`, `march.wgsl.test.ts`, `zombie-gpu.ts`, `flame-lab-main.ts`

As the flesh chars it thins, and the bones nearest the skin — skull, ribs,
forearms, shins — start to show through. The bone capsules already exist in the
field: `applyBones` folds them with a hard `min`, and they sit at least 4 mm
inside the flesh, which is exactly why they are invisible today.

**The mechanism.** At the shading point, evaluate the bone field alone by folding
bones into an empty distance (`applyBones(1e9, p, ...)` returns the bone
distance, since `min(1e9, bone) == bone`). Where a bone is within a few
centimetres of the surface, blend toward the bone's pale shading, scaled by
`charAmt * skeletonShow`. Gated on the body actually burning, so no non-burning
pixel pays for it.

- [ ] **Step 1: Write the failing test.** Add to `march.wgsl.test.ts`:

```ts
  it('shows bone through charring flesh, gated on burn', () => {
    // Bones sit >= 4 mm inside the flesh and are hidden by flesh depth alone
    // (validate.ts's checkBoneContainment enforces that), so the only way to
    // see them is to probe the bone field at the shading point. Gated, so a
    // body that is not burning pays nothing.
    expect(MARCH_BODY).toContain('let boneProbe = applyBones(1e9');
    expect(MARCH_BODY).toContain('burnSkeleton');
    // Builds with char, per the owner's decision: opaque when freshly lit.
    expect(MARCH_BODY).toContain('charAmt * burnSkeleton');
  });
```

- [ ] **Step 2: Run it and watch it fail.** `npm test -- march.wgsl` → FAIL.

- [ ] **Step 3: Add the uniform.** `burnSkeleton: uniform(0.5)` in
  `defaultUniforms`, appended **last** in every binding object and **last** in
  `MARCH_BODY_PARAMS` as `burnSkeleton: f32,` — same positional rule as Task 2.

- [ ] **Step 4: Add the probe.** Inside the burn block from Task 2, after the
  `albedo` mix and before `gBurnEmit`:

```wgsl
    // SKELETON SHOW-THROUGH. The bone capsules are already in the field but sit
    // inside the flesh, so probe the bone field alone at the shading point: a
    // bone within revealDepth of the surface bleeds through as the flesh chars.
    // Builds with char, so a freshly lit body is still opaque.
    let skelK = charAmt * burnSkeleton;
    if (skelK > 0.0) {
      let boneProbe = applyBones(1e9, p, data, counts, counts2.x, gBand, segVolumeAtlas, segVolumeMeta);
      let revealDepth = 0.045;
      let nearBone = 1.0 - smoothstep(0.0, revealDepth, max(boneProbe, 0.0));
      let showBone = clamp(nearBone * skelK, 0.0, 1.0);
      albedo = mix(albedo, boneColor, showBone);
      gloss = gloss * (1.0 - showBone * 0.5);
    }
```

  `applyBones`'s real parameter list is at `march.wgsl.ts` — read it and pass what
  it actually takes; the names above are from the fold's own call site and may
  differ at the shading point. `boneColor` is whatever the file already uses for
  bone albedo (the `isBone` shading path near the `bonePaleU` lines); if there is
  no such uniform, use the pale constant that path uses and say so in your report.
  If `applyBones` is not callable at the shading point (wrong scope, missing
  bindings), **stop and report** rather than restructuring the shader.

- [ ] **Step 5: Feed the uniform.** `u.burnSkeleton.value = tuning.skeletonShow;`
  in `flame-lab-main.ts`'s per-body loop.

- [ ] **Step 6: Verify.** `npm test`, `npx tsc --noEmit`.

- [ ] **Step 7: Capture and look.** `npm run flame:capture`. In
  `stand-charred.png` and `collapsed-charred.png` the skull, ribs and forearm
  bones should be discernible through the darkened flesh; in `*-fresh.png` they
  should not be visible at all. Tune `skeletonShow` and `revealDepth` until that
  is true, and say in your report what values you landed on.

- [ ] **Step 8: Commit.** `git commit -m "Show the skeleton through charring flesh"`

---

## Task 4: Judge it against the reference

**Files:** modify `scripts/flame-capture.mjs`, rewrite `docs/dev-notes/2026-09-17-flame-lab/NOTES.md`

- [ ] **Step 1: Add a close framing.** The first pass's own notes concluded the
  gap against the reference is widest at close and mid range. Add a `close` pose
  to the capture set — a single body filling most of the frame — keeping the
  existing five, so the set becomes six poses × two stages.

- [ ] **Step 2: Add a contact sheet.** Have the script also write
  `contact.png`: the `close-fresh`, `stand-fresh` and `stand-charred` frames in a
  row with the three Blood reference tiles (3321, 3323, 3325 from
  `public/assets/blood-tiles/`) scaled to the same body height beside them, so the
  comparison is one image rather than a folder.

- [ ] **Step 3: Re-capture.** `npm run flame:capture` → all frames plus
  `contact.png`.

- [ ] **Step 4: Rewrite NOTES.md.** Replace it. Say what the surface look now
  does and does not achieve, judged from `contact.png`. **Be blunt about the
  remaining gap** — the previous notes claimed the bodies "read unambiguously as
  on fire" when the captures showed a glowing statue, and that overstatement is
  what this pass had to correct. State what is still missing for the tongue
  plans, and record the tuning values you landed on.

- [ ] **Step 5: Commit.** `git commit -m "Capture the fixed surface look against the reference"`

---

## Notes for the implementer

- **Positional uniform binding is the sharpest edge.** Every new uniform goes
  last in both the WGSL parameter list and every binding object, in the same
  order. A misplaced key silently feeds the shader a different value.
- **No colons in comments inside `MARCH_BODY_PARAMS`** — the parser reads
  name-colon-type pairs, comments included.
- **The Browser pane loses the WebGPU device on this page** (`Instance dropped in
  popErrorScope`). Do not try to verify in an interactive pane; the headless
  capture script is the verification path.
- **Known pre-existing test failures**, unrelated to this work: 12 files / 15
  tests (blob-measure, blob-compile, gnasher/soldier/zombie-blob, gib-rupture,
  game-actor-torso-slug, march-step-soundness, three skeleton-spike files,
  surface-nets-cpu). Do not try to fix them; do not let them mask a new failure.
- **The mesh kit is out of scope.** `soldier-kit.gltf` stays unburnt; the flame
  tongues in the later plans envelop it.
- If a step's code does not match the file, trust the file, adapt, and say so.
