# Flame Tongues Implementation Plan

> **For agentic workers:** implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build all three flame-tongue techniques — screen-space, flame cards, volumetric band — switchable live on the same burning body, so the owner can pick the look by eye.

**Architecture:** The foundation pass already paints fire and soot on the body surface and reads as *molten*. Tongues are what make it *aflame*: ragged flame rising off the silhouette, independent of the pose. All three techniques consume the same per-body burn state (`burnCfg` per view, `REC_BURN` per instance) and the same tuning record, and each is a separate module switched by one `TongueTechnique` value, so they can be A/B'd on one frame without a rebuild.

**Tech stack:** TypeScript, three.js WebGPU with TSL, WGSL string modules, Vitest, headless-Chrome capture script.

**How this is judged:** by captures against the Blood reference tiles, at the `close` framing, where the foundation notes say the gap is widest. Tests pin contracts only. `distant` already reads acceptably from emissive and light alone — a technique that wrecks distant readability is a failure even if close looks good.

**Owner context:** the engulfed look (spec option A) is chosen; "flamelike" crispness is the quality that matters and generic particle blobs are explicitly rejected. The soldier's mesh kit does not burn on its own — tongues are expected to envelop it, which is a thing to check in the captures. The skeleton show-through is deferred and untouched here.

**Prior art in this repo:** `explosion-vfx.ts` (procedural fire in TSL, the transparency rules), `goo-layer.ts` (screen-space pass over the SDF composite), `tracer-sprite.ts` (additive quads), `post-glow.ts` / `post-aa.ts` (fullscreen pass shape, capture-stage ordering).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/tongue-tuning.ts` (create) | `TongueTechnique` union, shared tongue tuning fields + bounds. |
| `src/lab/sdf-zombie/webgpu/tongue-tuning.test.ts` (create) | Its tests. |
| `src/lab/sdf-zombie/webgpu/post-tongues.ts` (create) | Screen-space pass: WGSL + CPU mirror of the tongue shaping. |
| `src/lab/sdf-zombie/webgpu/post-tongues.test.ts` (create) | Shaping contract. |
| `src/lab/sdf-zombie/webgpu/flame-cards.ts` (create) | Card placement (pure) + the billboard group. |
| `src/lab/sdf-zombie/webgpu/flame-cards.test.ts` (create) | Placement contract. |
| `scripts/build-flame-atlas.mjs` (create) | Packs FIRE01 tiles into an untracked placeholder atlas. |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (modify) | Fourth MRT attachment: the per-pixel burn mask. |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (modify) | Publish the burn mask; the volumetric shell. |
| `src/lab/sdf-zombie/webgpu/post-aa.ts` (modify) | Run the tongue pass in the capture stage. |
| `src/lab/sdf-zombie/webgpu/flame-lab-main.ts` (modify) | Technique switch, wiring, key, console API. |
| `src/lab/sdf-zombie/webgpu/flame-panel.ts` (modify) | Technique buttons + tongue sliders. |
| `scripts/flame-capture.mjs` (modify) | Capture per technique; comparison contact sheet. |

---

## Task 1: Technique switch and shared tongue tuning

**Files:** create `tongue-tuning.ts`, `tongue-tuning.test.ts`; modify `flame-panel.ts`, `flame-lab-main.ts`

- [ ] **Step 1: Write the failing test.** Create `tongue-tuning.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TONGUE_TECHNIQUES, TONGUE_TUNING, TONGUE_BOUNDS, resolveTongueTuning, isTongueTechnique,
} from './tongue-tuning';

describe('tongue tuning', () => {
  it('offers exactly the three techniques plus off', () => {
    expect(TONGUE_TECHNIQUES).toEqual(['none', 'screen', 'cards', 'volume']);
    expect(isTongueTechnique('cards')).toBe(true);
    expect(isTongueTechnique('sparkles')).toBe(false);
  });

  it('resolves to defaults and clamps every field at both rails', () => {
    expect(resolveTongueTuning()).toEqual(TONGUE_TUNING);
    for (const key of Object.keys(TONGUE_TUNING) as (keyof typeof TONGUE_TUNING)[]) {
      const [min, max] = TONGUE_BOUNDS[key];
      expect(resolveTongueTuning({ [key]: min - 1 })[key], `${key} min`).toBe(min);
      expect(resolveTongueTuning({ [key]: max + 1 })[key], `${key} max`).toBe(max);
      expect(resolveTongueTuning({ [key]: Number.NaN })[key], `${key} NaN`).toBe(TONGUE_TUNING[key]);
    }
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** `npm test -- tongue-tuning`

- [ ] **Step 3: Write the module.** `tongue-tuning.ts`, mirroring `burn-profiles.ts`
  exactly (frozen defaults, `*_BOUNDS` as data, one `resolve*` that non-finite
  input cannot pass):

```ts
export const TONGUE_TECHNIQUES = ['none', 'screen', 'cards', 'volume'] as const;
export type TongueTechnique = (typeof TONGUE_TECHNIQUES)[number];
export function isTongueTechnique(v: string): v is TongueTechnique { /* includes check */ }

export interface TongueTuning {
  /** Flame height off the silhouette, in metres at the body. */
  length: number;
  /** How ragged the tongue edge is, 0 smooth .. 1 torn. */
  ragged: number;
  /** Metres per second the flame shape climbs. */
  rise: number;
  /** Emissive gain on the tongues themselves. */
  gain: number;
  /** How much the tongues lean with body motion, 0..1. */
  lean: number;
}
export const TONGUE_TUNING: TongueTuning = Object.freeze({
  length: 0.45, ragged: 0.6, rise: 2.2, gain: 1.8, lean: 0.4,
});
export const TONGUE_BOUNDS = Object.freeze({
  length: [0, 1.5], ragged: [0, 1], rise: [0, 8], gain: [0, 4], lean: [0, 1],
});
```

- [ ] **Step 4: Wire the switch.** In `flame-lab-main.ts`: hold
  `let technique: TongueTechnique` (default `'screen'`, overridable by
  `?tongue=<name>` via `isTongueTechnique`) and `let tongue = resolveTongueTuning()`.
  Add key `t` to cycle through `TONGUE_TECHNIQUES`, and extend `__flameLab` with
  `setTechnique(name)` (validated, returns the applied value) and
  `technique()`. Nothing consumes it yet — the three techniques land in Tasks 2-4.

- [ ] **Step 5: Panel.** In `flame-panel.ts`, add a row of technique buttons (one
  per `TONGUE_TECHNIQUES` entry, the active one marked) and sliders for the five
  tongue fields, ranges read from `TONGUE_BOUNDS`. Extend `copyText` to emit the
  technique and the tongue values alongside the burn values. Update
  `flame-panel.test.ts` so it asserts every `TongueTuning` field has a slider,
  the same way it already does for `BurnTuning`.

- [ ] **Step 6: Verify.** `npm test -- tongue-tuning flame-panel flame-lab-main`, `npx tsc --noEmit`.

- [ ] **Step 7: Commit.** `git commit -m "Add the tongue technique switch and shared tuning"`

---

## Task 2: Screen-space tongues

**Files:** modify `sdf-layer.ts`, `march.wgsl.ts`, `post-aa.ts`, `flame-lab-main.ts`; create `post-tongues.ts`, `post-tongues.test.ts`

A fullscreen pass grows flame upward out of a per-pixel burn mask. Cost is fixed
per screen no matter how many bodies burn, and the shape is crisp pixel flame
rather than a blob — which is what the reference sprites are.

**The burn mask.** The march's output alpha is already depth (`vec4(lit, t)`) and
`marchNormal.w` already carries a body key, so neither is free. Add a fourth MRT
attachment. In `sdf-layer.ts` the attachment count is gated in one place
(`count: marchNormals ? 3 : 1`, attachments named `output` / `marchNormal` /
`marchAnchor`, mapped by name through `mrt({...})`).

- [ ] **Step 1: Write the failing test.** Create `post-tongues.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tongueProfile, tonguePixelLength, POST_TONGUES_WGSL } from './post-tongues';

describe('screen-space tongues', () => {
  it('falls off from the body and dies at the tip', () => {
    expect(tongueProfile(0, 1)).toBeCloseTo(1, 6);   // at the silhouette
    expect(tongueProfile(1, 1)).toBe(0);             // at full length
    expect(tongueProfile(1.5, 1)).toBe(0);           // past the tip
    expect(tongueProfile(0.5, 1)).toBeGreaterThan(0);
    expect(tongueProfile(0.5, 1)).toBeLessThan(tongueProfile(0.25, 1));
  });

  it('keeps flames a constant WORLD size, so distance shortens them in pixels', () => {
    const near = tonguePixelLength(0.45, 2, 540, 1.0);
    const far = tonguePixelLength(0.45, 8, 540, 1.0);
    expect(near).toBeGreaterThan(far * 3);
    expect(tonguePixelLength(0, 2, 540, 1)).toBe(0);
  });

  it('mirrors the profile in the shader and reads the burn mask, not the colour', () => {
    expect(POST_TONGUES_WGSL).toContain('fn tongueProfile(');
    expect(POST_TONGUES_WGSL).toContain('burnTex');
    expect(POST_TONGUES_WGSL).toContain('depthTex');
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** `npm test -- post-tongues`

- [ ] **Step 3: Publish the burn mask.** In `march.wgsl.ts`, set a private
  `gBurnOut` in the burn block (`vec4(burnAmt, charAmt, fire, 1.0)`), declared
  beside `gBurnEmit`, and add a `MARCH_BURN_OUT` reader in the same shape as the
  existing `marchAnchorRead` / `MARCH_ANCHOR_READ` pair (which reads a private
  declared in `MARCH_NORMAL_OUT` — include that node, never redeclare the var).
  In `sdf-layer.ts` add a `marchBurn` option: when on, `count` becomes 4,
  `target.textures[3]!.name = 'marchBurn'`, the `mrt({...})` map gains
  `marchBurn: marchBurnRead({ dep: output as never })`, and the layer exposes
  `marchBurnTexture`. When off, everything is exactly as today — assert that in a
  test (`count` stays 3 with `marchNormals` alone).

- [ ] **Step 4: Write the pass.** `post-tongues.ts` exports:
  - `tongueProfile(t: number, ragged: number): number` — flame intensity at
    normalised distance `t` from the body, 1 at the silhouette, 0 at and past 1.
  - `tonguePixelLength(lengthM, depthM, viewportH, fovScale): number` — world
    length projected to pixels, 0 when length is 0.
  - `POST_TONGUES_WGSL` — the pass. Per pixel: walk a bounded number of taps
    (16) DOWN the projected world-up direction, sample `burnTex`; on finding
    burning body take that pixel's depth from `depthTex`, compute `t` from taps
    walked over `tonguePixelLength`, shape by `tongueProfile` times upward-
    scrolling fbm domain-warped by `ragged`, phase-keyed per body so bodies
    flicker independently, colour by the same `fireRamp` ramp the surface uses,
    and additively blend. Take the SOURCE body's depth so scene geometry in
    front still occludes the flame. Interior pixels (burn found at zero taps)
    contribute nothing — the surface pass already owns them.

- [ ] **Step 5: Run it in the chain.** In `post-aa.ts` add
  `setTongues(on: boolean, uniforms: {...})` and a `setBurnMaskTexture(tex)`,
  and run the pass inside the capture stage **before** the shutter capture and
  before the glow extract, so tongues both blur and bloom. Add it to the
  `active` gate. In `flame-lab-main.ts`, enable the `marchBurn` attachment and
  the pass only when `technique === 'screen'`, and feed the tongue tuning each
  frame.

- [ ] **Step 6: Verify.** `npm test`, `npx tsc --noEmit`. No new failures beyond
  the 12 known pre-existing files.

- [ ] **Step 7: Capture and look.** `npm run flame:capture -- --technique screen`.
  **Required outcome:** in `close-fresh` the body has ragged flame rising off its
  outline, past the silhouette, not merely brighter skin; in `distant-fresh` the
  body is still readable and has not become a blob. Iterate on `length`,
  `ragged` and `gain` until the close frame is closer to the Blood tiles than the
  molten baseline is. Report what you saw, per frame, honestly.

- [ ] **Step 8: Commit.** `git commit -m "Add screen-space flame tongues"`

---

## Task 3: Flame cards

**Files:** create `flame-cards.ts`, `flame-cards.test.ts`, `scripts/build-flame-atlas.mjs`; modify `flame-lab-main.ts`

Additive camera-facing quads on the body, playing a flame flipbook. This is the
technique that can later use *baked* frames, and it is how Blood itself did flame
licks.

**Assets.** Blood's FIRE01 frames are tiles 3532-3539 in the untracked
extraction at `/Users/donny/Projects/blud/assets-source/blood-extracted/tiles013_tiles/0353x.png`.
They are dev placeholders: the atlas is written to
`public/assets/flame-placeholder/fire01.png`, which `.gitignore` already covers
via `public/assets/**/*-placeholder*`. **Never commit the atlas or the frames.**
The lab must still run when the atlas is absent — fall back to a procedural card
shader and say so in the panel.

- [ ] **Step 1: Write the failing test.** Create `flame-cards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { placeFlameCards, cardFrame, FLAME_CARD_SLOTS } from './flame-cards';

describe('flame cards', () => {
  it('places cards on the body, more of them as burn rises', () => {
    const few = placeFlameCards(0.3, 1234);
    const many = placeFlameCards(1, 1234);
    expect(few.length).toBeLessThan(many.length);
    expect(many.length).toBeLessThanOrEqual(FLAME_CARD_SLOTS.length);
    expect(placeFlameCards(0, 1234)).toEqual([]);
  });

  it('is deterministic for a seed and varied across cards', () => {
    expect(placeFlameCards(1, 7)).toEqual(placeFlameCards(1, 7));
    const a = placeFlameCards(1, 7);
    expect(new Set(a.map(c => c.phase)).size).toBeGreaterThan(1);
  });

  it('advances the flipbook and wraps', () => {
    expect(cardFrame(0, 0, 8, 15)).toBe(0);
    expect(cardFrame(1 / 15, 0, 8, 15)).toBe(1);
    expect(cardFrame(8 / 15, 0, 8, 15)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** `npm test -- flame-cards`

- [ ] **Step 3: Write the atlas script.** `scripts/build-flame-atlas.mjs`: read
  tiles 3532-3539 from the extraction path, pack into one row, write
  `public/assets/flame-placeholder/fire01.png` plus a small JSON with frame count
  and cell size. Exit 2 with a clear message if the extraction is not present
  (a fresh clone has no placeholders). Add `"flame:atlas"` to `package.json`.

- [ ] **Step 4: Write the module.** `flame-cards.ts` exports `FLAME_CARD_SLOTS`
  (anchor points as body-local offsets: torso front/back/sides, head, each upper
  and lower arm, each thigh and shin — roughly 16), `placeFlameCards(burn, seed)`
  (returns active slots with per-card scale, phase and start frame from a seeded
  RNG — no `Math.random()`), `cardFrame(time, phase, frames, fps)`, and a
  `createFlameCards(...)` that builds an instanced additive `MeshBasicNodeMaterial`
  group for the effects scene. Cards face the camera but keep their up axis
  world-vertical. Follow the transparency rules: alpha in `colorNode.w`,
  `AdditiveBlending`, `depthWrite = false`, **no `alphaHash`, no `alphaTest`**.

- [ ] **Step 5: Wire it.** Add the group to `characterEffects.scene` in
  `flame-lab-main.ts`; update per frame from each body's pose and burn; visible
  only when `technique === 'cards'`.

- [ ] **Step 6: Verify.** `npm test`, `npx tsc --noEmit`.

- [ ] **Step 7: Capture and look.** `npm run flame:atlas` then
  `npm run flame:capture -- --technique cards`. **Required outcome:** flame
  visibly rises off the body including over the soldier's armour (cards do not
  care that the kit is mesh). Watch for the two known failure modes and report
  on both: cards clipping into the body leaving hard seams, and the effect
  reading as sparse blobs rather than fire.

- [ ] **Step 8: Commit.** `git commit -m "Add flame card tongues"` (verify the
  atlas is NOT staged: `git status --porcelain public/assets` must be empty).

---

## Task 4: Volumetric band

**Files:** modify `march.wgsl.ts`, `zombie-gpu.ts`, `flame-lab-main.ts`, `march.wgsl.test.ts`

The march accumulates emissive fire in a shell just outside the body surface, so
tongues genuinely wrap the body in 3D and occlude correctly. Expected to be the
expensive one; built deliberately simply to answer whether true 3D fire looks
better.

- [ ] **Step 1: Write the failing test.** Add to `march.wgsl.test.ts`:

```ts
  it('accumulates a bounded emissive shell outside a burning body', () => {
    expect(MARCH_BODY).toContain('burnShellSteps');
    expect(MARCH_BODY).toContain('let shellK = clamp(max(burnCfg.x, gInstBurn.x), 0.0, 1.0);');
    // Bounded: a fixed step count, never a while-loop on distance.
    expect(MARCH_BODY).toMatch(/for \(var s: i32 = 0; s < 8; s\+\+\)/);
  });
```

- [ ] **Step 2: Run it, watch it fail.** `npm test -- march.wgsl`

- [ ] **Step 3: Implement.** Add uniforms `burnShellSteps` (default 8) and
  `burnShellDepth` (default 0.25 m), appended **last** in `MARCH_BODY_PARAMS` and
  in every binding object, positional order matching. In the march, when the ray
  misses the body but passes within `burnShellDepth` of it, take a fixed 8 samples
  along the ray through the band, evaluate the same rest-space fire noise warped
  upward in world space, accumulate emission weighted by proximity to the surface
  and by `burn`, and add it to the returned colour without touching the returned
  depth. Where the ray hits the body, the surface pass already owns the pixel.
  If the march's structure makes this genuinely impossible without restructuring,
  **stop and report** — do not rewrite the march.

- [ ] **Step 4: Verify.** `npm test`, `npx tsc --noEmit`.

- [ ] **Step 5: Capture and look.** `npm run flame:capture -- --technique volume`.
  **Required outcome:** flame wraps around the body's edges with real depth, and
  bodies still occlude each other's flame correctly. Also record the frame cost
  (the lab's own timing readout) against the `none` technique, since this is the
  one where cost is expected to matter.

- [ ] **Step 6: Commit.** `git commit -m "Add the volumetric flame shell"`

---

## Task 5: The comparison

**Files:** modify `scripts/flame-capture.mjs`, `docs/dev-notes/2026-09-17-flame-lab/NOTES.md`

- [ ] **Step 1: Capture every technique.** Extend the capture script so
  `--technique all` walks `none`, `screen`, `cards`, `volume`, writing
  `<technique>-<pose>-<stage>.png` for the `close`, `stand` and `distant` poses
  at both stages.

- [ ] **Step 2: Build the judging sheet.** Write `tongues-contact.png`: the four
  techniques' `close-fresh` frames in a row, with the three Blood reference tiles
  scaled to matched body height at the end. This single image is what the owner
  decides from.

- [ ] **Step 3: Measure.** For each technique record the lab's frame time with
  two bodies burning, and note it. Looks decide first, but the owner asked for
  numbers once a look is chosen.

- [ ] **Step 4: Write it up.** Append a dated section to `NOTES.md`: per
  technique, what it actually looks like, where it fails, its cost, and which
  one you would pick and why. **Be blunt.** An honest "none of them match the
  reference yet, here is the closest and what it still lacks" is the most useful
  possible outcome.

- [ ] **Step 5: Commit.** `git commit -m "Capture the three tongue techniques for judging"`

---

## Notes for the implementer

- **Positional uniform binding:** every new uniform goes last in both the WGSL
  parameter list and every binding object, same order. A misplaced key silently
  feeds the shader a different value.
- **No colons in comments inside `MARCH_BODY_PARAMS`.**
- **WebGPU transparency:** alpha in `colorNode.w`, additive for fire, normal for
  smoke, never `alphaHash` (renders as solid squares), never `alphaTest` (kills
  soft glow). `explosion-vfx.ts:28-57` has the measured details.
- **Never toggle a light's `.visible`** — it recompiles every lit material.
- **The Browser pane loses the WebGPU device on this page.** Verify through the
  headless capture script only.
- **Known pre-existing failures:** 12 files / 15 tests (blob-measure,
  blob-compile, gnasher/soldier/zombie-blob, gib-rupture, game-actor-torso-slug,
  march-step-soundness, three skeleton-spike files, surface-nets-cpu). Do not fix
  them; do not let them mask a new failure.
- **Extracted Blood assets are dev placeholders**: the flame atlas is untracked
  and must never be committed.
- If a step's code does not match the file, trust the file, adapt, and say so.
