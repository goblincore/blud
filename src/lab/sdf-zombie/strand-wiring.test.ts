// src/lab/sdf-zombie/strand-wiring.test.ts
//
// The gates the hairlock dispatch specified and did not write. It shipped
// with ZERO test files, and what that hid was total: the GPU half was never
// connected. `CONE_STRAND`, `STRAND_HASH4` and `STRAND_LIPSCHITZ` were
// exported and referenced nowhere — absent from HELPERS, so not even present
// in the shader — `sdPrim` never tested profile bit 5, and `ROW_PRIM_STRAND`
// was packed by pack.ts and never uploaded by zombie-gpu.ts. A `strand=` prim
// grew strands on the CPU and rendered as a plain capsule on the GPU.
//
// WHY blob:render-check CANNOT CATCH THAT, which is the part worth
// remembering: it compares the rendered SILHOUETTE against the CPU mask and
// reports HOLES — places the GPU left empty that the CPU says are solid.
// Losing the strands makes the GPU draw the parent capsule, which is SOLID
// and covers strictly MORE than the bundle inside it. Extra material is not a
// hole. Verified rather than assumed: with the strand branch removed from
// sdPrim again, `blob:render-check -- strand-fixture` still reported "0 hole
// clusters" at both relax 1.0 and 1.4.
//
// So the wiring is asserted structurally here, and the Lipschitz bound — for
// which the render gate IS valid evidence, since an over-reporting field
// tunnels and a tunnel IS a hole — is asserted numerically below.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import {
  HELPERS, SD_PRIM, SD_PRIM_ORIENTED, CONE_STRAND, STRAND_HASH4, STRAND_LIPSCHITZ,
  ROW_PRIM_STRAND, DATA_ROWS,
} from './webgpu/march.wgsl';
import { sdStrand, strandLipschitz, strandReach, STRAND_WAVE_MAX } from './strand';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { packBody } from './pack';
import type { StrandParams, Vec3 } from './types';

describe('strand — the GPU half is actually connected', () => {
  it('registers all three strand helpers in HELPERS, ahead of sdPrim', () => {
    // HELPERS' own comment: "forgetting this list entirely is the quieter
    // failure — the ordering test below only checks what is IN the list, so
    // an omitted helper passes every unit test and fails at pipeline creation
    // with a bare WGSL parse error". Here it did not even reach that, because
    // nothing called the function either.
    for (const h of [STRAND_HASH4, STRAND_LIPSCHITZ, CONE_STRAND]) {
      expect(HELPERS).toContain(h);
    }
    // coneStrand calls strandHash4 and strandLip, and sdPrim calls
    // coneStrand: all three must be declared before it.
    expect(HELPERS.indexOf(STRAND_HASH4)).toBeLessThan(HELPERS.indexOf(CONE_STRAND));
    expect(HELPERS.indexOf(STRAND_LIPSCHITZ)).toBeLessThan(HELPERS.indexOf(CONE_STRAND));
    expect(HELPERS.indexOf(CONE_STRAND)).toBeLessThan(HELPERS.indexOf(SD_PRIM));
  });

  it('branches on the strand bit and calls coneStrand in BOTH prim paths', () => {
    // sdPrimO too: the oriented twin is what a posed head runs, so wiring
    // only sdPrim would leave strands working on a T-pose and vanishing the
    // moment the character turned its head.
    for (const src of [SD_PRIM, SD_PRIM_ORIENTED]) {
      expect(src).toContain('if ((i32(prof) & 32) != 0)');
      expect(src).toContain('coneStrand(');
      expect(src).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_STRAND} + band), 0)`);
      // STRAND FIRST, mirroring sdPrimitive in validate.ts — box and shell
      // are rejected on a strand at compile time, so it belongs to no branch
      // below and must not fall through into one.
      expect(src.indexOf('if ((i32(prof) & 32) != 0)'))
        .toBeLessThan(src.indexOf('if ((i32(prof) & 8) != 0)'));
    }
  });

  it('uploads the strand row wherever it uploads the other prim rows', () => {
    // The failure this pins is the one the meltCfg note in zombie-gpu.ts
    // exists for: data the shader reads and nothing ever writes. Read as
    // source because the upload is inside a closure with no seam to call.
    const src = readFileSync('src/lab/sdf-zombie/webgpu/zombie-gpu.ts', 'utf8') as string;
    const warp = (src.match(/writeRow\(ROW_PRIM_WARP,/g) ?? []).length;
    const strand = (src.match(/writeRow\(ROW_PRIM_STRAND,/g) ?? []).length;
    expect(strand).toBeGreaterThan(0);
    // Both prim-row sets are written at every site, or one path renders
    // strands and another does not.
    expect(strand).toBe(warp);
  });

  it('gives the strand row an index of its own', () => {
    // hairlock and the shell cloth spike both added "the next row" on their
    // own branch and both picked 20. A textual merge reports success and the
    // two names alias one row.
    expect(ROW_PRIM_STRAND).not.toBe(20);
    expect(ROW_PRIM_STRAND).toBeLessThan(DATA_ROWS);
  });
});

describe('strand — the field is safe for an over-relaxed tracer', () => {
  // WHAT IS ACTUALLY TRUE, measured rather than asserted. strand.ts claims
  // the field is divided by a Lipschitz bound "restoring |grad| <= 1". It
  // very nearly is, and the exception matters more than the claim:
  //
  //   * Away from its seams the gradient is comfortably under 1 (0.61 worst
  //     over 20k samples at h = 1e-6).
  //   * The field has ISOLATED DISCONTINUITIES — 9 steps in 1.2 million
  //     along densely walked lines. They are the strand-grid seams, the same
  //     class as coneBend's documented medial-axis jump.
  //   * Every jump measured is sub-millimetre (worst 0.441 mm) and lands
  //     where the field reads ~16 mm, so a tracer has an order of magnitude
  //     more room than the error.
  //
  // A naive `|grad| <= 1 everywhere` test therefore FAILS (24.8 at h = 1e-5,
  // on the one sample in 5000 that straddles a seam) while the primitive is
  // perfectly usable. So the property pinned here is the one that actually
  // protects the renderer: an over-relaxed march must not tunnel.
  const STRAND: StrandParams = { count: 6, wave: 0.18, cycles: 4, fat: 0.72 };
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0.01, -0.15, 0.02];
  const f = (q: Vec3, c?: Vec3) =>
    sdStrand(q, a, b, c, 0.026, 0.010, STRAND) / strandLipschitz(a, b, c, 0.026, 0.010, STRAND);

  it('never jumps more than a fraction of a strand across a seam', () => {
    // The seams are real; their SIZE is what makes them harmless. If a change
    // to the fold or the jitter widens them, an over-relaxed step can clear a
    // whole strand and hair goes see-through.
    const STEP = 2e-6;
    let worstJump = 0;
    let seams = 0;
    for (let line = 0; line < 3000; line++) {
      const s = (n: number) => ((Math.sin(n * 7.13 + line * 51.7) * 38211.4) % 1 + 1) % 1;
      const o: Vec3 = [s(1) * 0.16 - 0.08, s(2) * 0.22 - 0.19, s(3) * 0.16 - 0.08];
      const d: Vec3 = [s(4) - 0.5, s(5) - 0.5, s(6) - 0.5];
      const n = Math.hypot(d[0], d[1], d[2]) || 1;
      let prev = f(o);
      for (let k = 1; k <= 300; k++) {
        const q: Vec3 = [o[0] + (d[0] / n) * STEP * k, o[1] + (d[1] / n) * STEP * k, o[2] + (d[2] / n) * STEP * k];
        const cur = f(q);
        const jump = Math.abs(cur - prev);
        if (jump / STEP > 1.05) { seams++; worstJump = Math.max(worstJump, jump); }
        prev = cur;
      }
    }
    // Measured 0.441 mm. A strand is millimetres across, so half a
    // millimetre cannot clear one.
    expect(worstJump).toBeLessThan(0.001);
    // And they stay RARE. A regression that made the whole field seamy would
    // pass the magnitude check above while wrecking the surface.
    expect(seams).toBeLessThan(3000 * 300 * 0.0001);
  });

  it('an over-relaxed tracer at 1.4 reaches the bundle without stepping through it', () => {
    // The property blob:render-check cannot test for strands (see this
    // file's header: losing the bundle draws the parent capsule, which is
    // MORE material, and extra material is not a hole). Modelled here on the
    // real field instead, both straight and bent.
    for (const c of [undefined, [0.020, -0.07, 0.026] as Vec3]) {
      let missed = 0;
      let tested = 0;
      for (let i = 0; i < 600; i++) {
        // Aim at a point ON the bundle axis from outside, so every ray has
        // something solid to find.
        const u = (i % 20) / 19;
        const target: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
        const th = (i / 600) * Math.PI * 2;
        const ph = ((i * 7) % 100) / 100 * Math.PI;
        const dir: Vec3 = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
        const o: Vec3 = [target[0] - dir[0] * 0.3, target[1] - dir[1] * 0.3, target[2] - dir[2] * 0.3];
        tested++;
        let t = 0, prevR = 0, hit = false;
        for (let k = 0; k < 600 && t < 0.6; k++) {
          const q: Vec3 = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
          const d = f(q, c);
          if (d < 2e-4) { hit = true; break; }
          const stepped = 1.4 * d;
          if (prevR > 0 && stepped > d + prevR) { t += d; prevR = 0; continue; }
          prevR = stepped; t += stepped;
        }
        if (!hit) missed++;
      }
      // A ray aimed at the axis passes through the bundle; between the
      // strands there is genuine empty space, so a miss is not automatically
      // a tunnel. What would be alarming is MOST rays missing — that is the
      // signature of a tracer walking through the field.
      expect(missed / tested).toBeLessThan(0.35);
    }
  });
});

describe('strand — hair ripples in the wind, for free', () => {
  const STRAND: StrandParams = { count: 6, wave: 0.18, cycles: 4, fat: 0.72 };
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0.01, -0.15, 0.02];
  const f = (q: Vec3, windPhase: number) =>
    sdStrand(q, a, b, undefined, 0.026, 0.010, STRAND, windPhase)
    / strandLipschitz(a, b, undefined, 0.026, 0.010, STRAND);

  it('moves the strands when the wind phase advances', () => {
    let moved = 0;
    for (let i = 0; i < 3000; i++) {
      const s2 = (n: number) => ((Math.sin(n * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
      const q: Vec3 = [s2(1) * 0.1 - 0.05, s2(2) * 0.18 - 0.16, s2(3) * 0.1 - 0.05];
      moved = Math.max(moved, Math.abs(f(q, 0) - f(q, 0.25)));
    }
    // SCALE CHECK, not a round number. The wobble amplitude is
    // wave * cell = wave * 2r/count, so at the fat end of this bundle it is
    // 0.18 * 2*0.026/6 = 1.56 mm, and the field is then divided by the
    // Lipschitz bound. A quarter turn therefore cannot move the field more
    // than about that, and measures 1.60 mm. An earlier threshold of 2 mm
    // was above the wobble's own amplitude and so unreachable by
    // construction — the test was impossible, not the feature broken.
    const wobble = STRAND.wave * 2 * 0.026 / STRAND.count;
    expect(moved).toBeGreaterThan(wobble * 0.5);
  });

  it('is exactly periodic in the phase, so a breeze never runs out of runway', () => {
    // The phase is a CYCLE COUNT, so a whole turn returns the same field —
    // the drift can accumulate for hours without drifting out of range.
    for (let i = 0; i < 400; i++) {
      const s2 = (n: number) => ((Math.sin(n * 3.71 + i * 51.3) * 21031.7) % 1 + 1) % 1;
      const q: Vec3 = [s2(1) * 0.1 - 0.05, s2(2) * 0.18 - 0.16, s2(3) * 0.1 - 0.05];
      expect(f(q, 1)).toBeCloseTo(f(q, 0), 9);
      expect(f(q, 7)).toBeCloseTo(f(q, 0), 9);
    }
  });

  it('costs the bound NOTHING — the seams stay the same size at any phase', () => {
    // The claim that makes this free: a constant added to a phase changes
    // neither the wobble amplitude nor its slope along t, so strandReach and
    // strandLipschitz are untouched and no bound site moves. If the ripple
    // were ever wired somewhere that scales the field rather than sliding it,
    // the seams would widen and this would catch it.
    const STEP = 2e-6;
    for (const phase of [0, 0.37, 2.6]) {
      let worstJump = 0;
      for (let line = 0; line < 1200; line++) {
        const s2 = (n: number) => ((Math.sin(n * 7.13 + line * 51.7) * 38211.4) % 1 + 1) % 1;
        const o: Vec3 = [s2(1) * 0.16 - 0.08, s2(2) * 0.22 - 0.19, s2(3) * 0.16 - 0.08];
        const d: Vec3 = [s2(4) - 0.5, s2(5) - 0.5, s2(6) - 0.5];
        const n = Math.hypot(d[0], d[1], d[2]) || 1;
        let prev = f(o, phase);
        for (let k = 1; k <= 250; k++) {
          const q: Vec3 = [o[0] + (d[0] / n) * STEP * k, o[1] + (d[1] / n) * STEP * k, o[2] + (d[2] / n) * STEP * k];
          const cur = f(q, phase);
          const jump = Math.abs(cur - prev);
          if (jump / STEP > 1.05) worstJump = Math.max(worstJump, jump);
          prev = cur;
        }
      }
      // The same sub-millimetre seam budget the no-wind field holds to.
      expect(worstJump).toBeLessThan(0.001);
    }
  });

  it('is a bit-exact no-op at phase 0', () => {
    for (let i = 0; i < 400; i++) {
      const s2 = (n: number) => ((Math.sin(n * 9.17 + i * 12.7) * 9311.3) % 1 + 1) % 1;
      const q: Vec3 = [s2(1) * 0.1 - 0.05, s2(2) * 0.18 - 0.16, s2(3) * 0.1 - 0.05];
      const withArg = sdStrand(q, a, b, undefined, 0.026, 0.010, STRAND, 0);
      const without = sdStrand(q, a, b, undefined, 0.026, 0.010, STRAND);
      expect(Object.is(withArg, without)).toBe(true);
    }
  });
});

describe('strand — nothing that lacks it moves', () => {
  it('packs the strand row as zeros for every shipped character', () => {
    for (const name of ['zombie-blob', 'goblin', 'soldier', 'female', 'schoolgirl', 'schoolgirl-alt', 'clown', 'mouse']) {
      let src: string;
      try {
        src = readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8') as string;
      } catch { continue; }
      const doc = parseBlob(src);
      const body = buildBody(compileBlob(doc, compileFace(doc)));
      for (const p of body.prims) expect(p.strand).toBeUndefined();
      const packed = packBody(body);
      expect(Array.from(packed.primStrand).every(v => v === 0)).toBe(true);
      // strandReach is a MULTIPLIER, so its no-strand value must be exactly
      // 1 — not 0, which would collapse every bound to nothing.
      for (const p of body.prims) expect(strandReach(p.strand)).toBe(1);
    }
  });

  it('the fixture really does carry strands, or the gate above proves nothing', () => {
    const src = readFileSync('src/lab/sdf-zombie/characters/strand-fixture.blob', 'utf8') as string;
    const doc = parseBlob(src);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const stranded = body.prims.filter(p => p.strand);
    // The fringe, plus the mirrored pair of locks.
    expect(stranded.length).toBe(3);
    // One straight (clamped projection for t*) and one bent (cubic roots) —
    // the two code paths the field has.
    expect(stranded.some(p => p.bend === undefined)).toBe(true);
    expect(stranded.some(p => p.bend !== undefined)).toBe(true);
    const packed = packBody(body);
    expect(Array.from(packed.primStrand).some(v => v !== 0)).toBe(true);
  });
});
