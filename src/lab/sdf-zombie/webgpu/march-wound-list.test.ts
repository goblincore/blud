// src/lab/sdf-zombie/webgpu/march-wound-list.test.ts
//
// Per-ray wound list (2026-09-07, perf). Built ONCE per pixel at the march
// entry — the set of wounds whose REACH sphere the pixel's ray can enter —
// so every march step (and every post-hit probe inside RAY_CULL_SLACK) folds
// only those instead of all sixteen. Gated on counts2.w so OFF is
// bit-identical to the shipped shader.
//
// This file guards three things from TEXT (nothing here compiles WGSL):
//   1. The list branch EXISTS in both APPLY_WOUNDS (the fold) and MARCH_BODY
//      (the preload). If the seam is ever removed, this fails loudly.
//   2. The existing union-reach early return STAYS FIRST in APPLY_WOUNDS —
//      a far sample must keep paying a single sphere test, not a list fold.
//   3. The preload uses the SAME reach formula the loop uses, pinned by
//      text so the two cannot drift. A preload reach smaller than the loop's
//      drops a wound the ray could reach -> a hole. Both strings carry the
//      base formula; MARCH_BODY appends RAY_CULL_SLACK for the off-ray
//      probes, so the base substring must match in both.
//   4. The wgslFn parse contract on MARCH_BODY's parameter list: no parens
//      and no colons inside any comment there (a paren truncates the parsed
//      inputs and every body renders unlit-black; a colon shifts every
//      binding by one slot).

import { describe, it, expect } from 'vitest';
import { APPLY_WOUNDS, MARCH_BODY, RAY_CULL_SLACK } from './march.wgsl';

/** The shared reach formula. Both APPLY_WOUNDS (the per-step cull) and
 *  MARCH_BODY (the preload) must carry it verbatim; MARCH_BODY may append
 *  RAY_CULL_SLACK after it for the off-ray probes. */
const REACH_FORMULA =
  'w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25';

describe('per-ray wound list', () => {
  it('APPLY_WOUNDS carries the list branch (gWoundListOn + gWoundList[])', () => {
    expect(APPLY_WOUNDS).toContain('gWoundListOn');
    expect(APPLY_WOUNDS).toContain('gWoundList[');
  });

  it('keeps the union-reach early return BEFORE the loop (the cull must stay first)', () => {
    const iBound = APPLY_WOUNDS.indexOf(
      'if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }');
    const iLoop = APPLY_WOUNDS.indexOf('for (var k = 0; k < 16; k = k + 1)');
    expect(iBound).toBeGreaterThan(-1);
    expect(iLoop).toBeGreaterThan(iBound);
  });

  it('MARCH_BODY sets the gate from counts2.w', () => {
    expect(MARCH_BODY).toContain('gWoundListOn = select(0.0, 1.0, gInstCounts2.w > 0.5);');
  });

  it('pins the reach formula text in BOTH the fold and the preload (they cannot drift)', () => {
    expect(APPLY_WOUNDS).toContain(REACH_FORMULA);
    // MARCH_BODY carries the SAME base reach, plus RAY_CULL_SLACK for the
    // off-ray probes. If the preload missing RAY_CULL_SLACK, the post-hit
    // probes could sample a wound the preload already dropped — pin that
    // append here too, so it cannot silently disappear.
    const iFormula = MARCH_BODY.indexOf(REACH_FORMULA);
    expect(iFormula).toBeGreaterThan(-1);
    expect(MARCH_BODY.slice(iFormula)).toContain(`+ ${RAY_CULL_SLACK}`);
  });

  it('MARCH_BODY parameter list has no parens or colons inside any comment', () => {
    const start = MARCH_BODY.indexOf('fn marchBody(');
    const end = MARCH_BODY.indexOf(') -> vec4<f32>');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const sig = MARCH_BODY.slice(start, end + 1);
    for (const line of sig.split('\n')) {
      const c = line.indexOf('//');
      if (c < 0) continue;
      const comment = line.slice(c);
      expect(comment, `paren in ${comment.trim()}`).not.toMatch(/\(/);
      expect(comment, `colon in ${comment.trim()}`).not.toMatch(/:/);
    }
  });
});
