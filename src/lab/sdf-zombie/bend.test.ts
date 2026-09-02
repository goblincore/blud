// src/lab/sdf-zombie/bend.test.ts
//
// The arc capsule — a primitive swept along a quadratic Bezier instead of a
// straight line, still tapering along its length.
//
// Horns, tusks, tails, claws and hooked noses were all authored as CHAINS of
// straight primitives, and every link in the chain has its own round base,
// which reads as a lump. That failure landed three times on the goblin alone
// before this existed. One bent, tapered primitive replaces the whole chain.
import { describe, it, expect } from 'vitest';
import { sdBody, sdPrimitive } from './validate';
import { assignClusters } from './clusters';
import { placePrims } from './resolve';
import { expandMirror } from './mirror';
import { packBody } from './pack';
import {
  DATA_ROWS, ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_SHAPE,
  ROW_PRIM_BEND,
} from './webgpu/march.wgsl';
import { MAX_PRIMS } from './validate';
import type { ExpandedPrim } from './mirror';
import type { Primitive, Vec3 } from './types';

const prim = (over: Partial<Primitive> = {}): Primitive => ({
  a: [0, 0, 0], b: [0, 1, 0], radius: 0.1, scale: [1, 1, 1],
  blendK: 0, limb: 'torso', cluster: 0, ...over,
});

/** Dense-sampling ground truth for the swept field: min over t of dist-r(t). */
function bruteForce(p: Vec3, pr: Primitive, steps = 8192): number {
  const { a, b, radius: r1, radiusB: r2u } = pr;
  const r2 = r2u ?? pr.radius;
  const c = pr.bend === undefined ? undefined
    : [(a[0] + b[0]) / 2 + pr.bend[0], (a[1] + b[1]) / 2 + pr.bend[1], (a[2] + b[2]) / 2 + pr.bend[2]];
  if (c === undefined) throw new Error('bruteForce needs a bent prim');
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q: Vec3 = [
      (1 - t) * (1 - t) * a[0]! + 2 * (1 - t) * t * c[0]! + t * t * b[0]!,
      (1 - t) * (1 - t) * a[1]! + 2 * (1 - t) * t * c[1]! + t * t * b[1]!,
      (1 - t) * (1 - t) * a[2]! + 2 * (1 - t) * t * c[2]! + t * t * b[2]!,
    ];
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - (r1 + (r2 - r1) * t));
  }
  return best;
}

describe('bent primitive', () => {
  // A control point ON the chord IS the straight primitive — mathematically.
  // The construction must fall back to the exact round-cone expression, not
  // merely something close: authored-straight prims keep the code path they
  // have always had (the zombie pin demands it).
  it('with a zero bend is EXACTLY the straight round cone', () => {
    const straight = prim({ radiusB: 0.03 });
    const zero = prim({ radiusB: 0.03, bend: [0, 0, 0] });
    for (const p of [[0, 0.5, 0], [0.3, 0.5, 0], [0, -0.4, 0], [0.2, 1.3, 0.1]] as Vec3[])
      expect(sdPrimitive(p, zero), `at ${p}`).toBe(sdPrimitive(p, straight));
  });

  // Same guarantee one level up: placePrims DROPS a collinear bend instead of
  // routing the prim through the Bezier path, so even a near-degenerate
  // authored bend cannot put a straight prim on the new code path.
  it('placePrims drops a collinear bend and keeps a real one', () => {
    const bone = new Map([['s', { head: [0, 0, 0] as Vec3, tail: [0, 1, 0] as Vec3 }]]);
    const mk = (offset: Partial<ExpandedPrim>): ExpandedPrim => ({
      bone: 's', at: 0.2, capTo: 1, radius: 0.05, scale: [1, 1, 1],
      blendK: 0, limb: 'head', ...offset,
    });
    const placed = placePrims(
      [
        // Exactly on the chord (x/z both zero) — dropped.
        mk({ bend: [0, 0.3, 0] }),
        // Off the chord — kept.
        mk({ bend: [0.12, 0, 0] }),
      ],
      bone,
    );
    expect(placed[0]?.bend).toBeUndefined();
    expect(placed[1]?.bend).toEqual([0.12, 0, 0]);
  });

  // THE POINT OF THE WHOLE THING. The surface bulges toward the control
  // point: a point off the chord but beside the curve is INSIDE, while the
  // straight primitive leaves the same point in open air.
  it('bulges toward its control side, unlike the straight chord', () => {
    const bent = prim({ bend: [0.5, 0, 0] });
    // Curve apex sits at x 0.25 (halfway out to the ctrl); 50 mm inside it.
    expect(sdPrimitive([0.2, 0.5, 0], bent)).toBeLessThan(0);
    // The straight capsule of the same radius does not reach here.
    expect(sdPrimitive([0.2, 0.5, 0], prim())).toBeGreaterThan(0);
    // And symmetrically OUTSIDE on the far side of the apex.
    expect(sdPrimitive([0.45, 0.5, 0], bent)).toBeGreaterThan(0);
  });

  it('measures true distance beyond the ends', () => {
    // Past b along the chord the nearest curve point IS the end, so the
    // distance is exact air minus the end radius.
    const bent = prim({ radiusB: 0.02, bend: [0.3, 0, 0] });
    expect(sdPrimitive([0, 1.3, 0], bent)).toBeCloseTo(0.28, 9);
  });

  // The taper must survive the sweep: r2=0 on a BENT prim still ends in a
  // TRUE POINT at b, not a rounded nub.
  it('taper composes with bend — r2=0 is a true point at b', () => {
    const hooked = prim({ radiusB: 0, bend: [0.3, 0, 0] });
    expect(sdPrimitive([0, 1, 0], hooked)).toBeCloseTo(0, 9);
  });

  // Degenerate input must not poison the fold. One NaN in a smooth-min takes
  // the entire body with it, and the symptom is a vanished body, not an error.
  it('produces no NaN for collinear control, coincident ends, or zero bend', () => {
    const samples: Vec3[] = [[0, 0.5, 0], [0.4, 0.5, 0.3], [-1, 2, 0.7], [0, 1.3, 0]];
    for (const [name, p] of [
      ['collinear', prim({ bend: [0, 0.44, 0] })],
      ['zero bend', prim({ bend: [0, 0, 0] })],
      ['coincident ends', prim({ b: [0, 0, 0], bend: [0.2, 0.1, 0] })],
      ['all three', prim({ b: [0, 0, 0], bend: [0, 0, 0] })],
    ] as [string, Primitive][]) {
      for (const s of samples) {
        const d = sdPrimitive(s, p);
        expect(Number.isFinite(d), `${name} at ${s} gave ${d}`).toBe(true);
      }
    }
  });

  // The cubic solve claims to be iq's EXACT closest point; this checks the
  // claim against dense sampling rather than trusting the port.
  it('matches a brute-force sweep of the curve parameter', () => {
    const cases: Primitive[] = [
      prim({ radiusB: 0.02, bend: [0.3, 0.05, -0.1] }),
      prim({ bend: [0.5, 0, 0] }),
      prim({ radius: 0.02, radiusB: 0.11, bend: [-0.2, 0.1, 0.15] }),
      prim({ b: [0.3, 1, -0.2], radiusB: 0.004, bend: [0.1, 0.4, 0.05] }),
    ];
    const points: Vec3[] = [
      [0.2, 0.5, 0], [0.4, 0.5, 0], [0, 1.3, 0], [-0.3, 0.1, 0.2],
      [0.1, 0.9, -0.15], [0, 0.5, 0],
    ];
    for (const pr of cases)
      for (const p of points) {
        const got = sdPrimitive(p, pr);
        const want = bruteForce(p, pr);
        // Our candidate set can only sit AT or above the dense minimum, and
        // only by the radius change between neighbouring samples — the
        // documented approximation, pinned here rather than hidden.
        expect(got, `prim ${JSON.stringify(pr.a)} at ${p}`).toBeGreaterThanOrEqual(want - 1e-9);
        expect(got - want, `prim ${JSON.stringify(pr.a)} at ${p}`).toBeLessThan(2e-3);
      }
  });

  // Cluster bounds fitted on endpoints alone let a swung horn escape the
  // sphere the shader culls by — the surface would silently vanish.
  it('is covered by its cluster bounding sphere', () => {
    const built = assignClusters([prim({ bend: [0.5, 0, 0] })]);
    const c = built.clusters[0]!;
    const p = built.prims[0]!;
    const apex: Vec3 = [0.25, 0.5, 0];
    const dist = Math.hypot(apex[0] - c.center[0], apex[1] - c.center[1], apex[2] - c.center[2]);
    expect(dist + p.radius).toBeLessThanOrEqual(c.radius);
  });
});

describe('bend mirroring', () => {
  // A pair of horns has to curve outward, not both lean the same way — the
  // same reason tip.x flips under mirrorOffset.
  it('negates bend.x under mirrorOffset, alongside offset and tip', () => {
    const def = {
      name: 't', root: [0, 0, 0] as Vec3,
      bones: [{ name: 'skull', parent: null, dir: [0, 1, 0] as Vec3, length: 1 }],
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.05, scale: [1, 1, 1] as Vec3,
        blendK: 0, limb: 'head' as const,
        offset: [0.08, 0, 0] as Vec3, tip: [0.04, 0.1, 0] as Vec3, bend: [0.06, 0, 0.02] as Vec3,
        mirrorOffset: true,
      }],
    };
    const out = expandMirror(def);
    expect(out.prims).toHaveLength(2);
    // The AUTHORED copy keeps the authored sign; only its reflection negates.
    // This originally asserted -0.06 on BOTH copies, which is the failure the
    // comment above warns about: the pair leans the same way, and the +x side
    // curves opposite to what the .blob asked for. bend.x must track offset.x
    // side for side, the way tip.x already does.
    const plus = out.prims.find(p => p.offset![0] > 0)!;
    const minus = out.prims.find(p => p.offset![0] < 0)!;
    expect(plus.bend).toEqual([0.06, 0, 0.02]);
    expect(minus.bend).toEqual([-0.06, 0, 0.02]);
    // ...and the flip agrees with tip's, rather than being independent of it.
    expect(Math.sign(plus.bend![0])).toBe(Math.sign(plus.tip![0]));
    expect(Math.sign(minus.bend![0])).toBe(Math.sign(minus.tip![0]));
  });

  // Under plain `mirror` the .r copy reflects its bend in x, exactly as the
  // second copy of a `both` pair does. It did not until 2026-08-22 — the
  // bone mirrored and the prim's own x components did not — which put the
  // mouse's right SDF shoe on the centreline and is why its finger fan had
  // to be bones. The .l copy keeps what the author wrote.
  it('reflects bend x on the .r copy under plain mirror, like tip and offset', () => {
    const def = {
      name: 't', root: [0, 0, 0] as Vec3,
      bones: [{
        name: 'horn', parent: null, dir: [1, 0, 0] as Vec3, length: 0.3,
        side: 0.1, mirror: true,
      }],
      prims: [{
        bone: 'horn', at: 0, capTo: 1, radius: 0.03, scale: [1, 1, 1] as Vec3,
        blendK: 0, limb: 'head' as const, bend: [0.05, 0.1, 0] as Vec3, mirror: true,
      }],
    };
    const out = expandMirror(def);
    expect(out.prims).toHaveLength(2);
    const l = out.prims.find(p => p.bone === 'horn.l')!, r = out.prims.find(p => p.bone === 'horn.r')!;
    expect(l.bend).toEqual([0.05, 0.1, 0]);
    expect(r.bend).toEqual([-0.05, 0.1, 0]);
  });
});

/**
 * Line-for-line TS transcription of the WGSL sdBezierT + coneBend, reading
 * from a Float32Array laid out exactly like the data texture. The string pins
 * in march.wgsl.test.ts prove the shader carries the construction; this
 * proves its semantics match the CPU field, which backs click-to-shoot.
 */
function sdBentWgsl(p: Vec3, i: number, tex: Float32Array): number {
  const load = (row: number): number[] => {
    const o = (row * MAX_PRIMS + i) * 4;
    return [tex[o]!, tex[o + 1]!, tex[o + 2]!, tex[o + 3]!];
  };
  const A = load(ROW_PRIM_A), B = load(ROW_PRIM_B), S = load(ROW_PRIM_SCALE);
  const T = load(ROW_PRIM_SHAPE), CROW = load(ROW_PRIM_BEND);
  const inv: Vec3 = [1 / S[0]!, 1 / S[1]!, 1 / S[2]!];
  const q: Vec3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
  const a: Vec3 = [A[0]! * inv[0], A[1]! * inv[1], A[2]! * inv[2]];
  const b: Vec3 = [B[0]! * inv[0], B[1]! * inv[1], B[2]! * inv[2]];
  const minScale = Math.min(S[0]!, S[1]!, S[2]!);
  const r2 = T[0]!;

  const sub = (x: Vec3, y: Vec3): Vec3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x: Vec3, y: Vec3): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const scale = (x: Vec3, s: number): Vec3 => [x[0] * s, x[1] * s, x[2] * s];

  // fn coneCap's round-cone branches — the WGSL fallback for degenerate
  // curves, transcribed so parity covers those cases too.
  const sdRoundCone = (): number => {
    const ba = sub(b, a);
    const l2 = dot(ba, ba);
    if (l2 < 1e-12) return (Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]) - Math.max(A[3]!, r2)) * minScale;
    const rr = A[3]! - r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const pa = sub(q, a);
    const y = dot(pa, ba);
    const z = y - l2;
    const x = sub(scale(pa, l2), scale(ba, y));
    const x2 = dot(x, x);
    const y2 = y * y * l2;
    const z2 = z * z * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) return (Math.sqrt(x2 + z2) * il2 - r2) * minScale;
    if (Math.sign(y) * a2 * y2 < k) return (Math.sqrt(x2 + y2) * il2 - A[3]!) * minScale;
    return ((Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - A[3]!) * minScale;
  };

  if (T[1]! < 1.5) return sdRoundCone();
  const c: Vec3 = [CROW[0]! * inv[0], CROW[1]! * inv[1], CROW[2]! * inv[2]];

  // fn sdBezierT — WGSL helper args are (p, A = start a, B = control c, C = end b).
  // Op order mirrors validate.ts COMPONENTWISE (a[i] - 2*c[i] + b[i]) so both
  // f64 mirrors take the same side of Cardano's discriminant.
  const aa = sub(c, a);
  const bb2: Vec3 = [
    a[0]! - 2 * c[0]! + b[0]!,
    a[1]! - 2 * c[1]! + b[1]!,
    a[2]! - 2 * c[2]! + b[2]!,
  ];
  const dv = sub(a, q);
  const kk = 1 / dot(bb2, bb2);
  const kx = kk * dot(aa, bb2);
  const ky = (kk * (2 * dot(aa, aa) + dot(dv, bb2))) / 3;
  const kz = kk * dot(dv, aa);
  const pp = ky - kx * kx;
  const qq = kx * (2 * kx * kx - 3 * ky) + kz;
  const h = qq * qq + 4 * pp ** 3;
  const cl01 = (u: number) => Math.max(0, Math.min(1, u));
  let cand: number[];
  if (h >= 0) {
    const h2 = Math.sqrt(h);
    let x1 = (h2 - qq) / 2;
    let x2 = (-h2 - qq) / 2;
    if (Math.abs(pp) < 1e-4 && qq !== 0) {
      const k = pp ** 3 / qq;
      x1 = k; x2 = -k - qq;
    }
    const u1 = Math.sign(x1) * Math.abs(x1) ** (1 / 3);
    const u2 = Math.sign(x2) * Math.abs(x2) ** (1 / 3);
    cand = [cl01(u1 + u2 - kx)];
  } else {
    const z = Math.sqrt(-pp);
    const v = Math.acos(Math.max(-1, Math.min(1, (qq / (pp * z * 2))))) / 3;
    const m = Math.cos(v);
    const n = Math.sin(v) * 1.7320508;
    cand = [cl01((m + n) * z - kx), cl01(-(m + n) * z - kx), cl01((n - m) * z - kx)];
  }

  // fn coneBend
  const cb: Vec3 = [
    a[0]! - 2 * c[0]! + b[0]!,
    a[1]! - 2 * c[1]! + b[1]!,
    a[2]! - 2 * c[2]! + b[2]!,
  ];
  if (dot(cb, cb) < 1e-12) return sdRoundCone();
  if (dot(sub(b, a), sub(b, a)) < 1e-12) return sdRoundCone();
  const e1 = scalev(sub(c, a), 2);
  let best = Infinity;
  let bestT = 0;
  // Same 9-slot layout and skip gate as the WGSL: indices 0-2 are root slots
  // (zero-padded to three; the gate skips only unused ones), 3-8 are the
  // fixed samples. Getting this layout wrong silently drops t=0/t=0.25.
  const ts = [cand[0] ?? 0, cand[1] ?? 0, cand[2] ?? 0, 0, 0.25, 0.5, 0.75, 1, 1];
  for (let k = 0; k < ts.length; k++) {
    if (k >= cand.length && k < 3) continue;
    const t = ts[k]!;
    const pt: Vec3 = [a[0] + e1[0] * t + cb[0] * t * t, a[1] + e1[1] * t + cb[1] * t * t, a[2] + e1[2] * t + cb[2] * t * t];
    const v = Math.hypot(q[0] - pt[0], q[1] - pt[1], q[2] - pt[2]) - (A[3]! + (r2 - A[3]!) * t);
    if (v < best) { best = v; bestT = t; }
  }
  for (const step of [0.125, 0.03125]) {
    for (const dt of [-step, 0, step]) {
      const t = Math.max(0, Math.min(1, bestT + dt));
      const pt: Vec3 = [a[0] + e1[0] * t + cb[0] * t * t, a[1] + e1[1] * t + cb[1] * t * t, a[2] + e1[2] * t + cb[2] * t * t];
      const v = Math.hypot(q[0] - pt[0], q[1] - pt[1], q[2] - pt[2]) - (A[3]! + (r2 - A[3]!) * t);
      if (v < best) { best = v; bestT = t; }
    }
  }
  return best * minScale;
}
const addv = (x: Vec3, y: Vec3): Vec3 => [x[0] + y[0], x[1] + y[1], x[2] + y[2]];
void addv;
const scalev = (x: Vec3, s: number): Vec3 => [x[0] * s, x[1] * s, x[2] * s];
void scalev;

describe('PARITY: CPU sdPrimitive matches the WGSL bezier math on packed data', () => {
  it('agrees to packing precision on random bent prims', () => {
    let seed = 0xbead;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 20; trial++) {
      const centre: Vec3 = [rnd() * 2 - 1, rnd(), rnd() * 2 - 1];
      const primDef: Primitive = {
        a: [centre[0] - 0.2, centre[1], centre[2]],
        b: [centre[0] + 0.2, centre[1] + 0.1, centre[2]],
        radius: 0.03 + rnd() * 0.06,
        radiusB: rnd() < 0.5 ? 0 : 0.01 + rnd() * 0.04,
        scale: [1, 1, 1], blendK: 0.02, limb: 'head', cluster: 0,
        bend: [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.5],
      };
      const packed = packBody({
        prims: [primDef],
        clusters: [{ id: 0, limb: 'head', start: 0, count: 1, center: [0, 0, 0], radius: 10, alive: true }],
        bones: new Map(), bonePrims: [],
      });
      const tex = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
      tex.set(packed.primA, ROW_PRIM_A * MAX_PRIMS * 4);
      tex.set(packed.primB, ROW_PRIM_B * MAX_PRIMS * 4);
      tex.set(packed.primScale, ROW_PRIM_SCALE * MAX_PRIMS * 4);
      tex.set(packed.primShape, ROW_PRIM_SHAPE * MAX_PRIMS * 4);
      tex.set(packed.primBend, ROW_PRIM_BEND * MAX_PRIMS * 4);
      for (let s = 0; s < 12; s++) {
        const p: Vec3 = [
          centre[0] + (rnd() - 0.5) * 1.2,
          centre[1] + (rnd() - 0.5) * 1.2,
          centre[2] + (rnd() - 0.5) * 1.2,
        ];
        // f32 packing rounds the inputs, so tolerance is f32-scale — but
        // COARSER here than the capsule parity test's 1e-4, and on purpose:
        // near h ~= 0 the two mirrors' differing fp op order can flip which
        // side of Cardano's discriminant (and thus which candidate set) the
        // solve lands on, moving the refined minimum by up to ~a refinement
        // step. The construction itself is pinned against brute force above;
        // this pin only catches structural divergence.
        expect(sdPrimitive(p, primDef)).toBeCloseTo(sdBentWgsl(p, 0, tex), 3);
      }
    }
  });
});

describe('bent primitives fold through sdBody', () => {
  it('folds additively without poisoning neighbours', () => {
    const body = {
      prims: [
        prim(),
        prim({ a: [0, 0.9, 0], b: [0, 1.4, 0], radius: 0.04, radiusB: 0.004, bend: [0.12, 0, 0], limb: 'head' }),
      ],
      clusters: [
        { id: 0, limb: 'torso' as const, start: 0, count: 1, center: [0, 0.5, 0] as Vec3, radius: 0.8, alive: true },
        { id: 1, limb: 'head' as const, start: 1, count: 1, center: [0, 1.15, 0] as Vec3, radius: 0.5, alive: true },
      ],
    };
    // Deep inside the straight neighbour: untouched by the bent prim.
    expect(Number.isFinite(sdBody([0, 0.5, 0], body as never))).toBe(true);
    expect(sdBody([0, 0.5, 0], body as never)).toBeCloseTo(-0.1, 6);
    // On the horn's curve: solid.
    expect(sdBody([0.07, 1.15, 0], body as never)).toBeLessThan(0);
  });
});
