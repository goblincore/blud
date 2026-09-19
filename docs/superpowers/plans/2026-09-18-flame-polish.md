# Flame Polish Implementation Plan

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Take the flame-card look from "closest to the reference" to "shipping quality": no card seams, flame down the whole body including kit-covered limbs, bones that read as bone, and a burning death that ends in a charred corpse in a pile of flame.

**Architecture:** Cards are the chosen technique (owner call, 2026-09-18): additive camera-facing quads playing the Blood FIRE01 flipbook, anchored to posed prims, drawn in the character-effects scene over the SDF surface fire. Screen-space tongues stay in the build as a switchable option but are not the look being polished. The volumetric shell was skipped. Everything here is look-only — no AI, no weapon, no damage.

**Tech stack:** TypeScript, three.js WebGPU with TSL, WGSL string modules, Vitest, headless-Chrome capture script.

**Judged by captures, not tests.** `npm run flame:capture -- --technique cards`, compared against the Blood reference tiles composited into each frame.

## What the verified cards run measured (the brief for this plan)

From `docs/dev-notes/2026-09-17-flame-lab/NOTES.md`, "Flame cards (plan task 3, verified 2026-09-18)":

- Stand/walk/run **read as fire, not particles** — crisp ragged licks with dark gaps, rising past the silhouette. Upper body is the strongest part.
- **`close` shows hard card seams**: atlas cells read as rectangular pixel blocks where a card crosses the body edge.
- **The soldier's lower legs are bare.** Root cause: his MESH greaves write depth several centimetres outside the SDF shin, and `depthTest` must stay on, so the shin and boot cards are occluded. A per-slot camera-bias experiment was tried and abandoned because cross-run camera drift made the A/B unjudgeable.
- Collapsed poses keep flame on the body; legs sparse there too. Distant is unaffected.

Two other known gaps, from earlier passes: the **skeleton show-through reads as pale patches rather than bone** (ribs never appear), and there is **no burn-death look** — a killed burning body just collapses.

---

## Task 1: Kill the card seams

**Files:** modify `src/lab/sdf-zombie/webgpu/flame-cards.ts`, `scripts/build-flame-atlas.mjs`, their tests

Two independent causes are likely, and the cheap one is first.

**Cause A — atlas UV bleed.** Rectangular blocks at cell edges is the classic
signature of sampling across a cell boundary: with cells packed edge-to-edge and
a Nearest mag filter, any UV rounding at the seam picks up the neighbouring
frame, which is a hard-edged rectangle of a different flame.

**Cause B — hard depth clipping.** A card that intersects the body is cut by the
depth test along a straight line, which reads as a rectangular edge.

- [ ] **Step 1: Write the failing test.** In `flame-cards.test.ts`:

```ts
  it('insets cell UVs so a frame cannot sample its neighbour', () => {
    const { u0, u1 } = cardCellUv(0, 8, 256);   // frame 0 of 8, 256px atlas
    const { u0: n0 } = cardCellUv(1, 8, 256);
    expect(u0).toBeGreaterThan(0);              // inset from the left edge
    expect(u1).toBeLessThan(1 / 8);             // inset from its own right edge
    expect(u1).toBeLessThan(n0);                // a gap exists between cells
  });
```

- [ ] **Step 2: Run it, watch it fail.** `npm test -- flame-cards`

- [ ] **Step 3: Inset the UVs.** Export `cardCellUv(frame, frames, atlasWidth)`
  returning the cell's UV range inset by half a texel on each side, and use it
  wherever the card material picks its frame. Also pad the atlas: give
  `build-flame-atlas.mjs` a 2px transparent gutter around every cell and record
  the padding in its JSON sidecar.

- [ ] **Step 4: Re-capture and judge.** `npm run flame:atlas` then
  `npm run flame:capture -- --technique cards`. Look at `cards-close-fresh.png`.
  **If the rectangular blocks are gone, stop here and skip to Step 6** — Cause A
  was it, and Cause B costs more than it is worth.

- [ ] **Step 5: Add the soft-particle depth fade (do this regardless).** Fade
  each card's alpha as its fragment approaches the scene depth behind it, so a
  card that intersects the body ends in a gradient instead of a straight cut.
  This is what the wildfire teardown
  (`docs/dev-notes/2026-09-18-wildfire-fire-teardown.md`) shows that game doing,
  and it is the standard fix — do it even if the UV inset already cleaned up the
  blocks, because it also softens cards against walls and against the other body.

  The effects scene renders after the composite with the depth buffer intact, so
  bind scene depth as a texture; do NOT turn `depthTest` off, which would let
  flame draw through walls. Add `cardSoftFade` to `BurnTuning` (bounds
  `[0, 0.5]` metres, default 0.08) so it is tunable from the panel.

  **The trap, straight from their bundle:** if you feed the fade the CURRENT
  fragment's depth instead of the scene depth, it computes
  `saturate((d - d) / fade) = 0` and the entire effect renders transparent black
  with no error and no warning. That game ships a runtime guard for exactly this.
  In three's TSL the scene depth is `linearDepth(viewportDepthTexture())` /
  `viewportLinearDepth`, never a bare `depth()`. After wiring it, prove flame
  still renders before tuning anything.

- [ ] **Step 6: Verify and commit.** `npm test -- flame-cards` and
  `npx tsc --noEmit`. Commit with a message saying which cause it actually was.

---

## Task 2: Curl-noise volume drives the flame motion

**Files:** create `src/lab/sdf-zombie/webgpu/curl-volume.ts` + test; modify `flame-cards.ts`

Today each card plays the FIRE01 flipbook at its own phase and that is all the
motion there is. The wildfire teardown's most portable idea is a small
**curl-noise 3D texture**: curl noise is divergence-free, so it reads as *flow*
rather than as drift, which is what makes flame look alive.

Build our own — this is a standard technique, not their data.

- [ ] **Step 1: Write the failing test.** Create `curl-volume.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCurlVolume, CURL_VOLUME_SIZE } from './curl-volume';

describe('curl volume', () => {
  it('packs a 64-cubed RGBA8 volume deterministically from a seed', () => {
    expect(CURL_VOLUME_SIZE).toBe(64);
    const a = buildCurlVolume(1234);
    const b = buildCurlVolume(1234);
    expect(a.length).toBe(64 * 64 * 64 * 4);
    expect(a).toEqual(b);                       // seeded, no Math.random
    expect(buildCurlVolume(9999)).not.toEqual(a);
  });

  it('is centred so the decoded vector spans both signs', () => {
    const v = buildCurlVolume(7);
    let lo = 255, hi = 0;
    for (let i = 0; i < v.length; i += 4) { lo = Math.min(lo, v[i]!); hi = Math.max(hi, v[i]!); }
    expect(lo).toBeLessThan(110);               // decodes below 0
    expect(hi).toBeGreaterThan(145);            // and above 0
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** `npm test -- curl-volume`

- [ ] **Step 3: Build it.** `buildCurlVolume(seed)` returns a `Uint8Array` for a
  64³ RGBA8 volume:
  - Generate four seeded scalar noise lattices over 64³ (reuse the repo's
    existing value/fbm noise rather than inventing one; several octaves).
  - Take the **curl** of three of them by finite differences with **wraparound**
    indexing (`(x + 1) & 63`), which is what makes the field divergence-free and
    the texture tileable.
  - Normalise by the largest component magnitude, store the vector as
    `rgb = v * 0.5 + 0.5`, and put the fourth noise scalar in `a`.
  - Also export `createCurlTexture(seed)` returning a `THREE.Data3DTexture` with
    `LinearFilter`, `RepeatWrapping` on all three axes, no mipmaps.
  - Decode in the shader as `rgb * 2 - 1`, sampling at `position / scale` with a
    scale around 6 metres.

- [ ] **Step 4: Drive the cards with it.** Offset each card's UV lookup and its
  world position by the curl vector sampled at the card's anchor, scaled by a new
  `flameFlow` tuning field (bounds `[0, 1]`, default 0.35) and by time, so
  neighbouring cards swirl together rather than each flickering alone. Keep the
  flipbook — the curl adds motion to it, it does not replace it.

- [ ] **Step 5: Capture and judge.** **Required outcome:** the flame mass moves
  as one flowing body rather than as N independently flickering quads. Sweep
  `flameFlow` from 0 to 1 and report where it stops helping.

- [ ] **Step 6: Verify and commit.**

---

## Task 3: Flame down the whole body

**Files:** modify `src/lab/sdf-zombie/webgpu/flame-cards.ts` and its test

The soldier's greaves occlude his shin and boot cards. The fix is to place cards
outside whatever actually covers the limb, not to disable the depth test.

- [ ] **Step 1: Make the A/B judgeable first.** The previous run abandoned this
  because camera and pose drifted between runs. Before changing anything, add a
  fixed-pose capture mode: a `--frozen` flag (or reuse the page's existing pose
  hold) that pins the bodies and the camera so two runs are pixel-comparable.
  Confirm it by capturing twice with no code change and diffing the PNGs — they
  should be identical or near-identical. Say in your report what the diff was.

- [ ] **Step 2: Write the failing test.** In `flame-cards.test.ts`:

```ts
  it('pushes cards out past a kit that covers the limb', () => {
    const bare = cardStandoff('shin', { kitRadius: 0 });
    const clad = cardStandoff('shin', { kitRadius: 0.06 });
    expect(clad).toBeGreaterThan(bare);
    expect(clad).toBeGreaterThanOrEqual(0.06);   // outside the armour
  });
```

- [ ] **Step 3: Implement.** Export `cardStandoff(slot, opts)` giving each card's
  distance from its anchor along the limb's outward normal, driven by the
  covering geometry's radius where one exists. Feed it the soldier's kit extent —
  the kit is a known mesh (`soldier-kit.gltf`) loaded by the character view, so
  take its per-limb bounds rather than hardcoding numbers; if that is not
  reachable, take a per-character constant and say so in your report.

- [ ] **Step 4: Capture and judge** with the frozen mode from Step 1.
  **Required outcome:** the soldier's shins and boots carry flame comparable to
  his torso, and the zombie's legs are unchanged or better. Watch for the card
  now floating visibly off the leg — that is the failure mode of this fix, and if
  you cannot get coverage without float, say so and leave it.

- [ ] **Step 5: Verify and commit.**

---

## Task 4: Make bone read as bone

**Files:** modify `src/lab/sdf-zombie/webgpu/march.wgsl.ts`, `march.wgsl.test.ts`, `burn-profiles.ts`

Today the skeleton show-through tints the flesh albedo toward a pale colour,
which reads as pale patches, and ribs never appear because the chest flesh is
deeper than the 8 cm reveal (pushing the reveal to 10 cm over-pales whole limbs
into looking like fresh flesh, which is worse).

- [ ] **Step 1: Write the failing test.** In `march.wgsl.test.ts`:

```ts
  it('shades the bone probe as bone, not as a pale tint of flesh', () => {
    // The probe already finds bone; the look failed because the result was
    // mixed into albedo as a flat colour, so it read as pale skin rather than
    // as a hard, shaped surface under the flesh.
    expect(MARCH_BODY).toContain('boneProbe');
    expect(MARCH_BODY).toContain('boneShade');
    expect(MARCH_BODY).toContain('gloss = mix(gloss');
  });
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement.** Where the probe finds bone near the surface, shade
  that fragment with the bone material the `isBone` path already uses — its
  albedo, its gloss, and a normal biased toward the bone's own gradient — rather
  than lerping flesh albedo toward a constant. Keep it gated on
  `charAmt * burnSkeleton`. Add a `skeletonDepth` field to `BurnTuning`
  (bounds `[0, 0.15]`, default the current 0.08) so the reveal depth is tunable
  from the panel instead of being a shader constant; the panel picks it up
  automatically from `BURN_BOUNDS` and needs only a `LABELS` entry.

- [ ] **Step 4: Capture and judge.** **Required outcome:** on
  `cards-close-charred` and `cards-collapsed-charred` the skull and forearm bones
  read as *bone* — hard, shaped, distinct from flesh — not as pale blotches. Try
  a deeper `skeletonDepth` now that bone is shaded rather than tinted, and report
  whether ribs come through at any setting that does not ruin the limbs.

- [ ] **Step 5: Verify and commit.**

---

## Task 5: Burning death

**Files:** modify `src/lab/sdf-zombie/webgpu/flame-lab-main.ts`, `flame-cards.ts`, `burn-profiles.ts`; capture script and NOTES

A body killed while burning should end as a charred corpse lying in a pile of
flame that burns down and goes out, rather than simply collapsing. This is the
look only — no AI, no damage, driven by the lab's existing kill key.

- [ ] **Step 1: Write the failing test.** In a suitable pure module (extend
  `burn-state.ts` or add to `flame-cards.ts`, your call — say which and why):

```ts
  it('burns down after death and goes out', () => {
    // A corpse keeps burning briefly, then the fire dies while the char stays.
    const s = createBurnState();
    igniteBurn(s); stepBurn(s, 2, RATES);
    killBurning(s);                       // death starts the burn-down
    stepBurn(s, BURN_TUNING.corpseBurnSec / 2, RATES);
    expect(s.burn).toBeGreaterThan(0);
    stepBurn(s, BURN_TUNING.corpseBurnSec, RATES);
    expect(s.burn).toBe(0);
    expect(s.char).toBe(1);               // fully charred corpse
  });
```

- [ ] **Step 2: Run it, watch it fail.**

- [ ] **Step 3: Implement.** Add `corpseBurnSec` to `BurnTuning` (bounds
  `[0, 20]`, default 6) and a `killBurning(state)` that switches a body to
  burn-down: char drives to 1 over the burn-down, then the fire fades out. Wire
  the lab's existing kill key so killing a burning body enters it, and have the
  cards collapse toward a ground-level pile as the body settles — NotBlood's burn
  death is a flame column that collapses into a burning heap, and the retired
  game's `GroundFlame` (`src/game/gibs/ground-flame.ts`) is the reference for the
  heap, though that was a Blud invention rather than source-accurate.

- [ ] **Step 4: Capture and judge.** Add a `death` pose to the capture set that
  ignites, kills, and settles, capturing mid-burn-down and after. **Required
  outcome:** the corpse reads as charred and the flame visibly dies down to
  nothing rather than snapping off.

- [ ] **Step 5: Update NOTES.md** with a dated section covering all four tasks:
  what each changed, what the captures show, and what is still not right. Be
  blunt about anything you could not achieve.

- [ ] **Step 6: Verify and commit.**

---

## Notes for the implementer

- **Run TARGETED tests only** — `npm test -- flame-cards march.wgsl burn-profiles
  burn-state flame-lab-main` plus what you touch. **Never the bare full suite**:
  it takes over two minutes and running it killed two runs in this family.
- **Kill anything you start** (vite, Chrome) in the same step. A previous run
  leaked probe servers and then spent its remaining time hunting them.
- **The in-app browser pane loses the WebGPU device on this page.** Verify only
  through the headless capture script.
- **Known pre-existing failures**, unrelated: 12 files / 15 tests (blob-measure,
  blob-compile, gnasher/soldier/zombie-blob, gib-rupture, game-actor-torso-slug,
  march-step-soundness, three skeleton-spike files, surface-nets-cpu).
- **Extracted Blood assets are dev placeholders.** The flame atlas lives at an
  ignored `*-placeholder*` path and must never be committed; check
  `git status --porcelain public/assets` is empty before every commit.
- **Positional uniform binding:** any new uniform goes last in both the WGSL
  parameter list and every binding object, in the same order.
- **WebGPU transparency:** alpha in `colorNode.w`, additive for fire, never
  `alphaHash`, never `alphaTest`.
- If a step's code does not match the file, trust the file, adapt, and say so.
