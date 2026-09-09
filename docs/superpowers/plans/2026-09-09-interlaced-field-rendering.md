# Interlaced Field Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** March half the scanlines each frame into a half-height target and interleave them, cutting the dominant GPU pass ~50% while producing a deliberate interlacing artifact.

**Architecture:** Pure parity/jitter math in a new `field-render.ts` (unit-tested, no GPU), wired into `sdf-layer.ts` as a half-height march target plus an interleaving composite with a tunable comb strength.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-interlaced-field-rendering-design.md`

---

## READ THIS BEFORE YOU WRITE ANY CODE

**THE TRAP THAT MAKES THIS FEATURE DO NOTHING.** You cannot save GPU time by
`discard`ing alternate pixels in a full-resolution pass. GPUs shade in 2x2
quads; a scanline discard leaves live pixels in every quad, so every quad still
executes and you pay nearly full cost. **The saving exists only because the
render target is physically HALF HEIGHT.** If at any point you find yourself
writing a discard or an `if (row % 2)` inside the march fragment shader,
you have implemented the useless version. Stop and re-read this paragraph.

**RULES FOR THIS PLAN — these are not negotiable:**

1. **Never commit a failing test.** If a test you wrote fails and you cannot
   make it pass, STOP and say so in your report. Do not delete the test, do not
   weaken the assertion to make it green, do not `skip` it.
2. **Never claim a command passed that you did not run.** Paste what you
   actually saw.
3. `src/lab/sdf-zombie/webgpu/surface-nets.wgsl.test.ts` **ALREADY FAILS** on
   this base. That one is not yours. Every OTHER failure is yours.
4. Line numbers in this plan are hints. Always locate code by its text.

---

### Task 1: The field math, as a pure module

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/field-render.ts`
- Test: `src/lab/sdf-zombie/webgpu/field-render.test.ts`

This is the part most likely to be wrong, so it is pure and pinned by tests
before anything touches the GPU.

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/field-render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fieldParity, fieldTargetHeight, fieldJitterNdcY, fieldRowSource } from './field-render';

describe('fieldParity', () => {
  it('alternates every frame', () => {
    expect([0, 1, 2, 3, 4].map(fieldParity)).toEqual([0, 1, 0, 1, 0]);
  });
});

describe('fieldTargetHeight', () => {
  it('is half the full height, rounded up so no row is lost', () => {
    expect(fieldTargetHeight(600)).toBe(300);
    expect(fieldTargetHeight(601)).toBe(301);
    expect(fieldTargetHeight(1)).toBe(1);
  });
});

describe('fieldJitterNdcY', () => {
  // Full-res rows are 2/H apart in NDC. The two fields must land exactly one
  // full-res row apart, so each is offset half that from centre: +/- 1/H.
  it('separates the two fields by exactly one full-res row in NDC', () => {
    const H = 600;
    const a = fieldJitterNdcY(0, H), b = fieldJitterNdcY(1, H);
    expect(Math.abs(b - a)).toBeCloseTo(2 / H, 12);
  });
  it('is symmetric about zero, so neither field is the biased one', () => {
    const H = 600;
    expect(fieldJitterNdcY(0, H)).toBeCloseTo(-fieldJitterNdcY(1, H), 12);
  });
  it('scales with resolution', () => {
    expect(Math.abs(fieldJitterNdcY(1, 300))).toBeCloseTo(2 * Math.abs(fieldJitterNdcY(1, 600)), 12);
  });
});

describe('fieldRowSource — the coverage guarantee', () => {
  // THE INVARIANT THIS FEATURE LIVES OR DIES ON: across two consecutive
  // frames every output row must be sourced exactly once from a FRESH field
  // and once from the HELD field. A row sampled twice fresh is a wasted march;
  // a row never sampled fresh never updates.
  const H = 600;
  it('covers every output row exactly once per parity', () => {
    for (const parity of [0, 1] as const) {
      const fresh = new Set<number>();
      for (let y = 0; y < H; y++) if (fieldRowSource(y, parity).fresh) fresh.add(y);
      expect(fresh.size).toBe(H / 2);
      for (const y of fresh) expect(y % 2).toBe(parity);
    }
  });
  it('the two parities together cover every row exactly once', () => {
    const seen = new Map<number, number>();
    for (const parity of [0, 1] as const)
      for (let y = 0; y < H; y++)
        if (fieldRowSource(y, parity).fresh) seen.set(y, (seen.get(y) ?? 0) + 1);
    expect(seen.size).toBe(H);
    for (const [, n] of seen) expect(n).toBe(1);
  });
  it('maps an output row to the right half-height target row', () => {
    expect(fieldRowSource(0, 0)).toEqual({ fresh: true, targetRow: 0 });
    expect(fieldRowSource(2, 0)).toEqual({ fresh: true, targetRow: 1 });
    expect(fieldRowSource(1, 1)).toEqual({ fresh: true, targetRow: 0 });
    expect(fieldRowSource(1, 0).fresh).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/field-render.test.ts`
Expected: FAIL — `Failed to resolve import "./field-render"`.

- [ ] **Step 3: Implement**

Create `src/lab/sdf-zombie/webgpu/field-render.ts`:

```ts
// src/lab/sdf-zombie/webgpu/field-render.ts
//
// INTERLACED FIELD RENDERING — the pure math. See
// docs/superpowers/specs/2026-09-09-interlaced-field-rendering-design.md
//
// The march is 75-83% of the GPU frame and its cost is covered PIXELS (fill
// bound, 18.6 ms + 0.237 ms per 1k px). Marching alternate scanlines halves
// that. Unlike half-rate, every pixel drawn this frame is drawn NOW at the
// current camera, so there is no held camera and no reprojection — which is
// the error class that made half-rate desync from the full-rate skeleton
// meshes whenever the player strafed.
//
// THE SAVING COMES FROM THE TARGET BEING HALF HEIGHT, NOT FROM A DISCARD.
// GPUs shade in 2x2 quads, so discarding alternate rows inside a full-res
// pass still executes every quad and saves nothing. Nothing in this module or
// its callers may reintroduce a per-pixel row test in the march.
//
// Pure on purpose (no three, no GPU) so the coverage invariant — every output
// row fresh exactly once per two frames — is pinned in vitest.

/** Which field this frame renders. Field 0 owns even output rows. */
export function fieldParity(frameIndex: number): 0 | 1 {
  return (frameIndex % 2 === 0 ? 0 : 1);
}

/** Half height, rounded UP: an odd full height must not drop its last row. */
export function fieldTargetHeight(fullHeight: number): number {
  return Math.max(1, Math.ceil(fullHeight / 2));
}

/**
 * Vertical projection jitter, in NDC, for a field.
 *
 * Full-res rows are 2/H apart in NDC. The two fields must land exactly one
 * full-res row apart, so each sits half that from centre: -1/H and +1/H.
 * Symmetric so neither field is the biased one — an asymmetric jitter makes
 * the image crawl vertically as the fields alternate.
 */
export function fieldJitterNdcY(parity: 0 | 1, fullHeight: number): number {
  return (parity === 0 ? -1 : 1) / fullHeight;
}

/**
 * Where output row `y` reads from this frame.
 * `fresh` = sample this frame's half-height target at `targetRow`.
 * `!fresh` = sample the retained previous field at `targetRow`.
 */
export function fieldRowSource(y: number, parity: 0 | 1): { fresh: boolean; targetRow: number } {
  return { fresh: (y % 2) === parity, targetRow: Math.floor(y / 2) };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/field-render.test.ts`
Expected: PASS, 9 tests. If any fail, fix the CODE, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/field-render.ts src/lab/sdf-zombie/webgpu/field-render.test.ts
git commit -m "feat(field-render): pure parity, jitter and row-source math"
```

---

### Task 2: Report the plan's remaining work and STOP

**This plan intentionally ends here for the dispatch worker.**

Tasks 3+ (half-height target allocation in `sdf-layer.ts`, the projection
jitter, the interleaving composite, the `combStrength` uniform, the
`__sdfGame` seams, telemetry fields and the bench leg) touch the live WebGPU
render path. They cannot be verified without a GPU and a browser, which this
worker does not have — and an unverifiable render change is exactly how this
repo previously shipped a skeleton standing outside its own body.

- [ ] **Step 1: Verify the whole suite still passes**

Run: `npx vitest run`
Expected: every test passes EXCEPT `surface-nets.wgsl.test.ts`, which already
failed before you started.

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 2: Write your report**

State:
- the exact output of both commands above
- that Task 1 is committed and Tasks 3+ are deliberately not attempted
- anything in Task 1 you found wrong or ambiguous

Do NOT begin the `sdf-layer.ts` work. Do NOT stub it. Do NOT leave dead code
behind for it.

## Done when

- `field-render.ts` and its 9 tests exist and pass.
- `npx tsc --noEmit` is clean.
- The full suite is green apart from the pre-existing `surface-nets` failure.
- The report states plainly what was and was not done.
