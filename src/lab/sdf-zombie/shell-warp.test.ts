// src/lab/sdf-zombie/shell-warp.test.ts
//
// The shell cloth spike (2026-09-05). `warp=` displaces a shell's base
// distance with a sine triple so the sheet undulates like hanging cloth.
//
// Two things have to hold, and neither is eyeballable:
//
//   1. NOTHING MOVES. Every character shipped before this existed authored
//      its shells without `warp=`, and they must render bit-identically —
//      not "within a tolerance", bit-identically, because the fold is a
//      smooth-min chain where a last-bit difference in one prim propagates.
//   2. THE FIELD IS STILL A BOUND. Domain warping breaks the distance
//      metric; a sphere tracer that trusts an overestimate steps through the
//      surface and punches holes. The warp is divided by its Lipschitz bound
//      so the field under-reports instead, which is the safe direction.
//
// The second is what decides whether a plain-step flag is needed. It is not
// — see the gradient test below — and that is the whole reason this spike
// could re-clothe a character rather than stopping at the primitive.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { sdShellWrap } from './validate';
import { parseBlob } from './blob-parse';
import { compileBlob, compileFace } from './blob-compile';
import { buildBody } from './build-body';
import { sdBody } from './validate';
import { shellReach } from './extent';
import type { Vec3 } from './types';

const CLIP: Vec3 = [0, -1, 0];
// A clip plane 5 m away, on the KEPT side of the sampled cube. Sign matters
// and is easy to get backwards: dPlane = dot(n, p) - clipOffset, so with
// n = (0,-1,0) a NEGATIVE offset puts the plane's distance term at +offset
// and it wins the max() outright — the field goes constant and every test
// downstream measures nothing. That is not hypothetical: written as -1e9,
// the gradient test below passed with the Lipschitz divisor deliberately
// removed. A positive offset leaves dPlane at about -5 and the sheet term
// dominates, which is the thing under test.
const CLIP_FAR = 5;

describe('shell warp — the no-op', () => {
  it('is bit-exact when warpAmp is 0, for every combination that reaches it', () => {
    // Not a tolerance. `lip` is exactly 1.0 on the unwarped branch and IEEE
    // division by 1.0 is exact, so the two expressions are the same bits.
    for (const dBase of [-0.4, -0.006, 0, 0.006, 0.12, 1.7]) {
      for (const p of [[0, 0, 0], [0.31, 1.02, -0.17], [-2, 0.5, 3]] as Vec3[]) {
        for (const thick of [0.006, 0.02]) {
          for (const rim of [0, 0.007]) {
            const off = sdShellWrap(dBase, p, thick, CLIP, -0.72, rim);
            const zeroAmp = sdShellWrap(dBase, p, thick, CLIP, -0.72, rim, 0, [40, 40, 40]);
            const zeroFreq = sdShellWrap(dBase, p, thick, CLIP, -0.72, rim, 0.01, [0, 0, 0]);
            expect(Object.is(zeroAmp, off)).toBe(true);
            expect(Object.is(zeroFreq, off)).toBe(true);
          }
        }
      }
    }
  });

  it('leaves every shipped character bit-identical', () => {
    // The schoolgirl's skirt and sailor collar are the regression case named
    // in the spike brief. Sampling the whole body catches a warp leaking in
    // through a default as well as through the shell itself.
    for (const name of ['schoolgirl', 'schoolgirl-alt']) {
      const doc = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
      const body = buildBody(compileBlob(doc, compileFace(doc)));
      const shells = body.prims.filter(p => p.shell);
      expect(shells.length).toBeGreaterThan(0);
      for (const sh of shells) {
        expect(sh.shell!.warpAmp ?? 0).toBe(0);
        expect(sh.shell!.warpFreq ?? [0, 0, 0]).toEqual([0, 0, 0]);
        expect(shellReach(sh)).toBe(sh.shell!.thickness);
      }
    }
  });
});

describe('shell warp — the field stays a bound', () => {
  it('keeps |grad| <= 1 on a warped sheet, by central differences', () => {
    // The gate the brief calls for: if this failed, the relaxed march would
    // need a plain-step flag the way `nearWound` does. It passes because
    // sdShellWrap divides by 1 + sqrt(3)*|A|*|F|, which bounds the sine
    // triple's gradient exactly.
    //
    // Amplitudes and frequencies here bracket what cloth actually wants:
    // 6 mm wrinkles at 40 rad/m is a fine weave, 25 mm at 12 rad/m is a
    // heavy drape.
    const h = 1e-4;
    const cases: [number, Vec3][] = [
      [0.006, [40, 40, 40]],   // fine weave, isotropic
      [0.025, [12, 12, 12]],   // heavy drape
      [0.012, [26, 0, 26]],    // PLEATS — the y axis frozen, folds run down
      [-0.02, [25, 8, 25]],    // signed amplitude, anisotropic
    ];
    for (const [amp, freq] of cases) {
      let worst = 0;
      // A plain sphere of radius 0.2 as the base — the warp is what is under
      // test, not the base primitive, and a sphere's own field is exact.
      const base = (q: Vec3) => Math.hypot(q[0], q[1], q[2]) - 0.2;
      const f = (q: Vec3) => sdShellWrap(base(q), q, 0.008, CLIP, CLIP_FAR, 0.007, amp, freq);
      for (let i = 0; i < 4000; i++) {
        // Deterministic lattice-ish sampling: a fixed LCG, so a failure is
        // reproducible rather than a flake that vanishes on rerun.
        const s = (n: number) => ((Math.sin(n * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
        const q: Vec3 = [s(1) * 0.9 - 0.45, s(2) * 0.9 - 0.45, s(3) * 0.9 - 0.45];
        const bump = (ax: number, s: number): Vec3 =>
          [q[0] + (ax === 0 ? s : 0), q[1] + (ax === 1 ? s : 0), q[2] + (ax === 2 ? s : 0)];
        const g = [0, 1, 2].map(ax => (f(bump(ax, h)) - f(bump(ax, -h))) / (2 * h));
        worst = Math.max(worst, Math.hypot(g[0]!, g[1]!, g[2]!));
      }
      expect(worst).toBeLessThanOrEqual(1 + 1e-3);
    }
  });

  it('never over-reports the distance to the warped surface', () => {
    // A bound test rather than a gradient one: from a point outside, march
    // the reported distance and confirm the surface was not passed. This is
    // the property a sphere tracer actually consumes.
    const amp = 0.02; const freq: Vec3 = [25, 25, 25];
    const base = (q: Vec3) => Math.hypot(q[0], q[1], q[2]) - 0.2;
    const f = (q: Vec3) => sdShellWrap(base(q), q, 0.008, CLIP, CLIP_FAR, 0.007, amp, freq);
    for (let i = 0; i < 200; i++) {
      const th = (i / 200) * Math.PI * 2;
      const dir: Vec3 = [Math.cos(th), Math.sin(th * 1.7), Math.sin(th)];
      const n = Math.hypot(dir[0], dir[1], dir[2]);
      let t = 0.0;
      const o: Vec3 = [dir[0] / n * 0.6, dir[1] / n * 0.6, dir[2] / n * 0.6];
      for (let s = 0; s < 200; s++) {
        const q: Vec3 = [o[0] - dir[0] / n * t, o[1] - dir[1] / n * t, o[2] - dir[2] / n * t];
        const d = f(q);
        // The step must never carry us to a point INSIDE the surface: if it
        // did, the field over-reported and a tracer would tunnel.
        if (d < 1e-4) break;
        t += d;
        const q2: Vec3 = [o[0] - dir[0] / n * t, o[1] - dir[1] / n * t, o[2] - dir[2] / n * t];
        expect(f(q2)).toBeGreaterThan(-1e-3);
      }
    }
  });
});

describe('shell warp — an OVER-RELAXED tracer does not tunnel', () => {
  it('survives relax 1.4, the setting that banded the cyclops craters', () => {
    // THIS IS THE GATE, and it lives here rather than in blob:render-check
    // because that check cannot see this failure: it compares the rendered
    // SILHOUETTE against the CPU mask, and a ray that tunnels through a 6 mm
    // skirt goes on to hit the hips behind it. The silhouette is identical.
    // Verified, not assumed — with the GPU Lipschitz divisor deliberately
    // removed, `BLOB_RELAX=1.4 blob:render-check -- schoolgirl-described`
    // still reported "0 hole clusters". A garment over a body is invisible
    // to a hole detector, so the tracer is modelled here instead.
    const amp = 0.02; const freq: Vec3 = [26, 0, 26];
    const base = (q: Vec3) => Math.hypot(q[0], q[1], q[2]) - 0.2;
    const f = (q: Vec3) => sdShellWrap(base(q), q, 0.008, CLIP, CLIP_FAR, 0.007, amp, freq);
    const RELAX = 1.4;
    let tunnelled = 0;
    for (let i = 0; i < 400; i++) {
      const th = (i / 400) * Math.PI * 2;
      const dir: Vec3 = [Math.cos(th), Math.sin(th * 2.3) * 0.6, Math.sin(th)];
      const n = Math.hypot(dir[0], dir[1], dir[2]);
      const u: Vec3 = [dir[0] / n, dir[1] / n, dir[2] / n];
      const at = (t: number): Vec3 => [0.6 * u[0] - u[0] * t, 0.6 * u[1] - u[1] * t, 0.6 * u[2] - u[2] * t];
      // iq's over-relaxed sphere tracing: step by relax*d, and when the next
      // sphere does not contain the last one, fall back to the plain step.
      let t = 0, prevR = 0, hit = false;
      for (let s = 0; s < 400 && t < 1.2; s++) {
        const d = f(at(t));
        if (d < 1e-4) { hit = true; break; }
        const stepped = RELAX * d;
        if (prevR > 0 && stepped > d + prevR) { t += d; prevR = 0; continue; }
        prevR = stepped; t += stepped;
      }
      // The ray starts outside and aims through the sphere's centre, so it
      // MUST hit. A miss means the tracer stepped clean through the sheet.
      if (!hit) tunnelled++;
    }
    expect(tunnelled).toBe(0);
  });
});

describe('shell warp — bad input fails loudly, naming the line', () => {
  // Every one of these would otherwise be SILENT: the parser reads the
  // argument, the emitter echoes it back, and the author gets flat cloth or
  // a stalled march with nothing to read. The house rule is that the compile
  // error names the line rather than the value being clamped.
  const wrap = (shellLine: string) => `model t
  height 1.70
  stance humanoid

skeleton
  root pelvis at 0.85 len=0.10
  bone spine1 parent=pelvis dir=up pitch=0 len=0.15
  bone chest  parent=spine1 dir=up pitch=0 len=0.15
  bone spine2 parent=chest  dir=up pitch=0 len=0.06
  bone neck   parent=spine2 dir=up pitch=0 len=0.08
  bone skull  parent=neck   dir=up pitch=2 len=0.22

body
  blob torso on pelvis at=0.45 r=0.098
  ${shellLine}
`;
  const SHELL = 'shell torso on spine1 at=0.50 r=0.10 thick=0.006 clip=(0,-1,0) clipd=-0.74 rim=0.007';
  const build = (line: string) => {
    const doc = parseBlob(wrap(line));
    return buildBody(compileBlob(doc, compileFace(doc)));
  };

  it('accepts a well-formed warp, scalar frequency meaning isotropic', () => {
    const body = build(`${SHELL} warp=0.010 warpFreq=40`);
    const sh = body.prims.find(p => p.shell)!.shell!;
    expect(sh.warpAmp).toBe(0.010);
    expect(sh.warpFreq).toEqual([40, 40, 40]);
  });

  it('accepts a per-axis frequency triple — the pleat spelling', () => {
    // A zero on an axis is LEGAL and is the whole point: it freezes that
    // sine to a constant so the folds run along it. The all-zero triple is
    // the one that is rejected, by the amplitude-without-frequency check.
    const body = build(`${SHELL} warp=0.012 warpFreq=(26,0,26)`);
    expect(body.prims.find(p => p.shell)!.shell!.warpFreq).toEqual([26, 0, 26]);
  });

  it('rejects an amplitude with no frequency — the silent-flat-cloth case', () => {
    expect(() => build(`${SHELL} warp=0.012`)).toThrow(/warpFreq/);
  });

  it('rejects a frequency with no amplitude', () => {
    expect(() => build(`${SHELL} warpFreq=40`)).toThrow(/does nothing/);
  });

  it('rejects a warp on anything that is not a shell', () => {
    expect(() => build('blob torso on spine1 at=0.50 r=0.10 warp=0.01 warpFreq=40'))
      .toThrow(/only supported on a shell/);
  });

  it('rejects deep AND fine — the combination that pinches the sheet', () => {
    // sqrt(3) * 0.02 * 40 = 1.39. Same amplitude at a drape frequency is fine,
    // which is the point of capping the product rather than either factor.
    expect(() => build(`${SHELL} warp=0.020 warpFreq=40`)).toThrow(/pinches/);
    expect(() => build(`${SHELL} warp=0.020 warpFreq=12`)).not.toThrow();
  });
});

describe('shell warp — the wrinkles are WORLD-anchored, and that is a limit', () => {
  it('shifts the fold pattern when the body turns under it', () => {
    // NOT a bug being pinned as correct — a LIMITATION being recorded so it
    // is not rediscovered. The warp is evaluated at the world-space sample
    // point, so the sine lattice is fixed in the world and the character
    // turns underneath it: the folds swim across the cloth as she walks.
    //
    // This is exactly why `noiseLocal` exists for the body's surface noise —
    // its own comment says it undoes the body's yaw "so the noise field wraps
    // the character and turns with it instead of the body rotating under a
    // world-fixed texture". A warped garment needs the same treatment, and
    // that machinery (the rest-space anchor, ROW_REST_A/B) is a separate
    // sub-project. Until it exists, warped shells are for characters that do
    // not turn much, or for amplitudes small enough that the swim is not
    // legible.
    const amp = 0.026; const freq: Vec3 = [17, 0, 17];
    // A sphere on the body axis: a yaw about Y maps its base field exactly
    // onto itself, so any difference is the WARP moving, nothing else.
    const base = (q: Vec3) => Math.hypot(q[0], q[1] - 0.9, q[2]) - 0.15;
    const f = (q: Vec3) => sdShellWrap(base(q), q, 0.006, CLIP, CLIP_FAR, 0.008, amp, freq);
    const rotY = (q: Vec3, a: number): Vec3 =>
      [q[0] * Math.cos(a) - q[2] * Math.sin(a), q[1], q[0] * Math.sin(a) + q[2] * Math.cos(a)];
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const th = (i / 3000) * Math.PI * 2;
      const ph = (((i * 7) % 100) / 100) * Math.PI;
      const q: Vec3 = [0.16 * Math.sin(ph) * Math.cos(th), 0.9 + 0.16 * Math.cos(ph), 0.16 * Math.sin(ph) * Math.sin(th)];
      worst = Math.max(worst, Math.abs(f(q) - f(rotY(q, Math.PI / 4))));
    }
    // 21 mm at a 45 degree yaw, on cloth 6 mm thick: the pattern is not
    // shifted, it is replaced. If this ever drops to ~0, the rest-space
    // anchoring landed and this test should become the assertion that it did.
    expect(worst).toBeGreaterThan(0.015);
  });
});

describe('shell warp — WIND drifts the folds without costing the bound', () => {
  const amp = 0.016; const freq: Vec3 = [20, 0, 20];
  const base = (q: Vec3) => Math.hypot(q[0], q[1], q[2]) - 0.2;
  const f = (q: Vec3, drift: Vec3) =>
    sdShellWrap(base(q), q, 0.006, CLIP, CLIP_FAR, 0.008, amp, freq, drift);

  it('moves the fold pattern and leaves the sheet where it was', () => {
    // The drift belongs to the WRINKLES, not the garment: the sheet's own
    // surface stays put, only the folds travel across it. Sampled well away
    // from the sines' nodes so a real difference is visible.
    let moved = 0;
    for (let i = 0; i < 2000; i++) {
      const th = (i / 2000) * Math.PI * 2;
      const q: Vec3 = [0.2 * Math.cos(th), 0.05 * Math.sin(th * 3), 0.2 * Math.sin(th)];
      moved = Math.max(moved, Math.abs(f(q, [0, 0, 0]) - f(q, [0.05, 0, 0.02])));
    }
    // Comparable to the amplitude: the folds have genuinely travelled, not
    // wobbled a hair.
    expect(moved).toBeGreaterThan(amp * 0.5);
  });

  it('is periodic in the drift, so a breeze never runs out of runway', () => {
    // Drifting by a full wavelength on every axis returns the same field.
    // Nothing accumulates and nothing drifts out of range, however long the
    // lab is left running — the offset is a phase, not a displacement.
    const lambda: Vec3 = [(2 * Math.PI) / freq[0], 0, (2 * Math.PI) / freq[2]];
    for (let i = 0; i < 500; i++) {
      const th = (i / 500) * Math.PI * 2;
      const q: Vec3 = [0.2 * Math.cos(th), 0.05 * Math.sin(th * 5), 0.2 * Math.sin(th)];
      expect(f(q, lambda)).toBeCloseTo(f(q, [0, 0, 0]), 9);
    }
  });

  it('costs the Lipschitz bound NOTHING, at any drift', () => {
    // The reason sway is free: d/dx of sin(F*(x - c)) is F*cos(...), so a
    // constant offset cannot change the SPATIAL gradient. Wind therefore does
    // not buy into the pinch cap and does not shorten the march step — only
    // amplitude and frequency do. If this ever fails, the drift has been
    // wired somewhere it scales the field rather than shifting it.
    const h = 1e-4;
    for (const drift of [[0, 0, 0], [0.05, 0, 0.02], [3.7, 1.1, -2.4]] as Vec3[]) {
      let worst = 0;
      for (let i = 0; i < 1500; i++) {
        const s2 = (n: number) => ((Math.sin(n * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
        const q: Vec3 = [s2(1) * 0.9 - 0.45, s2(2) * 0.9 - 0.45, s2(3) * 0.9 - 0.45];
        const bump = (ax: number, d: number): Vec3 =>
          [q[0] + (ax === 0 ? d : 0), q[1] + (ax === 1 ? d : 0), q[2] + (ax === 2 ? d : 0)];
        const g = [0, 1, 2].map(ax => (f(bump(ax, h), drift) - f(bump(ax, -h), drift)) / (2 * h));
        worst = Math.max(worst, Math.hypot(g[0]!, g[1]!, g[2]!));
      }
      expect(worst).toBeLessThanOrEqual(1 + 1e-3);
    }
  });

  it('is a bit-exact no-op at zero drift', () => {
    // The default. Subtracting a zero vector must not perturb a single bit,
    // or every character in the cast moves the day wind is merged.
    for (let i = 0; i < 500; i++) {
      const th = (i / 500) * Math.PI * 2;
      const q: Vec3 = [0.21 * Math.cos(th), 0.07 * Math.sin(th * 4), 0.21 * Math.sin(th)];
      const withArg = f(q, [0, 0, 0]);
      const without = sdShellWrap(base(q), q, 0.006, CLIP, CLIP_FAR, 0.008, amp, freq);
      expect(Object.is(withArg, without)).toBe(true);
    }
  });
});

describe('shell warp — the bounds grow with it', () => {
  it('shellReach adds the amplitude on top of the thickness', () => {
    expect(shellReach({})).toBe(0);
    expect(shellReach({ shell: { thickness: 0.006, rim: 0, clipNormal: [0, -1, 0], clipOffset: 0 } })).toBe(0.006);
    expect(shellReach({
      shell: { thickness: 0.006, rim: 0, clipNormal: [0, -1, 0], clipOffset: 0, warpAmp: 0.02, warpFreq: [25, 25, 25] },
    })).toBeCloseTo(0.026, 12);
    // A NEGATIVE amplitude reaches just as far — the sine triple is signed.
    expect(shellReach({
      shell: { thickness: 0.006, rim: 0, clipNormal: [0, -1, 0], clipOffset: 0, warpAmp: -0.02, warpFreq: [25, 25, 25] },
    })).toBeCloseTo(0.026, 12);
  });
});
