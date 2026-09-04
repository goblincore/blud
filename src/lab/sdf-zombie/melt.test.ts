import { describe, it, expect } from 'vitest';
import {
  MELT_TUNING,
  MELT_TUNING_BODY,
  meltInit,
  meltInitBody,
  stepMelt,
  endpointProgress,
  applyMelt,
  applyMeltOrgans,
  endpointHeights,
  remeltClusters,
} from './melt';
import type { ClusterInfo, Primitive } from './types';

const REST_Y = [0.02, 0.45, 0.95, 1.55]; // foot, knee, chest, crown

describe('melt state machine', () => {
  it('starts at zero progress with nothing melted', () => {
    const s = meltInit(REST_Y, 0);
    expect(s.t).toBe(0);
    for (let i = 0; i < REST_Y.length; i++) {
      expect(endpointProgress(s, i)).toBe(0);
    }
  });

  it('advances progress at the tuned rate', () => {
    const s = stepMelt(meltInit(REST_Y, 0), 1);
    expect(s.t).toBeCloseTo(MELT_TUNING.rate, 6);
  });

  it('freezes at 1 and is idempotent past it', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    expect(s.t).toBe(1);
    const frozen = stepMelt(s, 1 / 60);
    expect(frozen.t).toBe(1);
    expect(frozen).toEqual(s);
  });

  it('melts low endpoints before high ones', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 20; i++) s = stepMelt(s, 1 / 60);
    const u = REST_Y.map((_, i) => endpointProgress(s, i));
    for (let i = 1; i < u.length; i++) expect(u[i]!).toBeLessThanOrEqual(u[i - 1]!);
    expect(u[0]!).toBeGreaterThan(u[3]!); // foot strictly ahead of crown
  });

  it('brings every endpoint to full melt by progress 1', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    for (let i = 0; i < REST_Y.length; i++) {
      expect(endpointProgress(s, i)).toBeCloseTo(1, 6);
    }
  });

  it('endpoint progress never decreases', () => {
    let s = meltInit(REST_Y, 0);
    let prev = REST_Y.map((_, i) => endpointProgress(s, i));
    for (let f = 0; f < 200; f++) {
      s = stepMelt(s, 1 / 60);
      const now = REST_Y.map((_, i) => endpointProgress(s, i));
      for (let i = 0; i < now.length; i++) expect(now[i]!).toBeGreaterThanOrEqual(prev[i]!);
      prev = now;
    }
  });

  it('is deterministic — identical dt sequences give identical states', () => {
    const run = () => {
      let s = meltInit(REST_Y, 0);
      for (let i = 0; i < 100; i++) s = stepMelt(s, 1 / 60);
      return s;
    };
    expect(run()).toEqual(run());
  });
});

function prim(a: [number, number, number], b: [number, number, number]): Primitive {
  return {
    a, b, radius: 0.08, scale: [1, 1, 1], blendK: 0.02, limb: 'legL', cluster: 0,
  } as Primitive;
}

const BODY: Primitive[] = [
  prim([0.1, 0.02, 0], [0.1, 0.45, 0]),   // shin
  prim([0.1, 0.45, 0], [0.1, 0.90, 0]),   // thigh
  prim([0, 0.90, 0], [0, 1.35, 0]),       // torso
  prim([0, 1.35, 0], [0, 1.55, 0]),       // head
];

function meltedAt(t: number): Primitive[] {
  let s = meltInitBody(BODY, 0);
  const step = 1 / 240;
  while (s.t < t - 1e-9) s = stepMelt(s, step);
  return applyMelt(BODY, s);
}

describe('applyMelt', () => {
  it('is the identity at progress zero', () => {
    const out = applyMelt(BODY, meltInitBody(BODY, 0));
    expect(out).toEqual(BODY);
  });

  it('never raises an endpoint', () => {
    let prev = BODY;
    for (let i = 1; i <= 20; i++) {
      const now = meltedAt(i / 20);
      for (let p = 0; p < now.length; p++) {
        expect(now[p]!.a[1]).toBeLessThanOrEqual(prev[p]!.a[1] + 1e-9);
        expect(now[p]!.b[1]).toBeLessThanOrEqual(prev[p]!.b[1] + 1e-9);
      }
      prev = now;
    }
  });

  it('conserves r^2 * yScale within 25% — volume goes sideways, not away', () => {
    for (let i = 0; i <= 10; i++) {
      const out = meltedAt(i / 10);
      for (let p = 0; p < out.length; p++) {
        const rest = BODY[p]!;
        const now = out[p]!;
        const v0 = rest.radius ** 2 * rest.scale[1];
        const v1 = now.radius ** 2 * now.scale[1];
        expect(v1 / v0).toBeGreaterThan(0.75);
        expect(v1 / v0).toBeLessThan(1.25);
      }
    }
  });

  it('crushes yScale and grows radius as it melts', () => {
    const end = meltedAt(1)[0]!;
    expect(end.scale[1]).toBeLessThan(0.3);
    expect(end.radius).toBeGreaterThan(BODY[0]!.radius * 1.5);
  });

  it('ramps blendK monotonically up to the fuse value', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const k = meltedAt(i / 20)[0]!.blendK;
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = k;
    }
    expect(prev).toBeCloseTo(MELT_TUNING_BODY.fuseK, 3);
  });

  it('stretches capsules — the head prim gets longer before it pools', () => {
    // 0.75 is chosen, not arbitrary: the head prim spans normalised heights
    // 0.87..1.0, and the front (t * frontLead) has to sit BETWEEN those two
    // endpoints' softness bands for the capsule to be mid-stretch. At 0.75 the
    // lower end is ~0.72 melted and the upper end ~0.28 — maximum draw.
    const len = (p: Primitive) => Math.abs(p.b[1] - p.a[1]);
    const rest = len(BODY[3]!);
    const mid = len(meltedAt(0.75)[3]!);
    expect(mid).toBeGreaterThan(rest * 2);
  });

  it('ends with everything within the pool height', () => {
    const out = meltedAt(1);
    for (const p of out) {
      expect(p.a[1]).toBeLessThan(MELT_TUNING_BODY.poolHeight + 1e-6);
      expect(p.b[1]).toBeLessThan(MELT_TUNING_BODY.poolHeight + 1e-6);
    }
  });

  it('spreads outward — the puddle is wider than the body was', () => {
    const width = (ps: Primitive[]) => {
      let w = 0;
      for (const p of ps) w = Math.max(w, Math.abs(p.a[0]), Math.abs(p.b[0]));
      return w;
    };
    expect(width(meltedAt(1))).toBeGreaterThan(width(BODY) * 1.5);
  });

  it('does not mutate the input prims', () => {
    const copy = JSON.parse(JSON.stringify(BODY));
    meltedAt(0.7);
    expect(BODY).toEqual(copy);
  });
});

// Organs sit inside the torso: they ride bonePrims but are soft, so they
// melt — at roughly half the flesh rate, so they slop out of the draining
// torso and are briefly distinct before the goo takes them (spec, task 7).
const ORGANS: Primitive[] = [
  prim([-0.045, 0.95, 0.03], [0.09, 0.96, 0.036]),  // gut coil, torso height
  prim([0.042, 1.02, 0.03], [-0.086, 1.01, 0.022]), // second coil, just above
];

function organsAt(t: number, rateScale = 0.5): Primitive[] {
  let s = meltInitBody(BODY, 0);
  const step = 1 / 240;
  while (s.t < t - 1e-9) s = stepMelt(s, step);
  return applyMeltOrgans(ORGANS, s, rateScale);
}

describe('applyMeltOrgans', () => {
  it('is the identity at progress zero', () => {
    expect(applyMeltOrgans(ORGANS, meltInitBody(BODY, 0))).toEqual(ORGANS);
  });

  it('lags the flesh at the same progress', () => {
    const t = 0.5;
    const flesh = meltedAt(t)[2]!; // the torso prim the organs live inside
    const organs = organsAt(t);
    for (const o of organs) {
      // Less melted = higher. Every organ endpoint is still above where the
      // surrounding flesh has already sagged to.
      expect(o.a[1]).toBeGreaterThan(flesh.a[1]);
      expect(o.b[1]).toBeGreaterThan(flesh.a[1]);
    }
    // ...and it is a REAL lag, not a rounding difference: the organ centroid
    // sits measurably above its rest-vs-pool midpoint while the flesh
    // centroid is below its own.
    const organMid = organs.reduce((s, o) => s + (o.a[1] + o.b[1]) / 2, 0) / organs.length;
    expect(organMid).toBeGreaterThan((0.95 + MELT_TUNING_BODY.poolHeight) / 2);
  });

  it('still reaches the pool by progress 1 — the goo takes them in the end', () => {
    const end = organsAt(1);
    for (const o of end) {
      expect(o.a[1]).toBeLessThan(MELT_TUNING_BODY.poolHeight + 1e-6);
      expect(o.b[1]).toBeLessThan(MELT_TUNING_BODY.poolHeight + 1e-6);
    }
  });

  it('at rateScale 1 organs melt exactly like flesh at the same height', () => {
    // An organ and a flesh prim with identical geometry must transform
    // identically when the lag is switched off — the lag is the ONLY
    // difference between the two paths.
    const geom: Primitive[] = [prim([0, 0.9, 0], [0, 1.35, 0])];
    let s = meltInitBody(geom, 0);
    const step = 1 / 240;
    while (s.t < 0.6) s = stepMelt(s, step);
    expect(applyMeltOrgans(geom, s, 1)).toEqual(applyMelt(geom, s));
  });

  it('does not mutate the input prims', () => {
    const copy = JSON.parse(JSON.stringify(ORGANS));
    organsAt(0.7);
    expect(ORGANS).toEqual(copy);
  });
});

describe('freeze is geometric, not just a stopped scalar', () => {
  it('applyMelt is a fixed point once the melt is done', () => {
    let s = meltInitBody(BODY, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    const end = applyMelt(BODY, s);
    // Stepping a frozen melt returns the same state, and the transform of
    // that state is the same GEOMETRY — the puddle does not creep.
    expect(applyMelt(BODY, stepMelt(s, 1 / 60))).toEqual(end);
    expect(applyMelt(BODY, stepMelt(stepMelt(s, 1), 1))).toEqual(end);
  });

  it('organs freeze with the flesh', () => {
    let s = meltInitBody(BODY, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    const end = applyMeltOrgans(ORGANS, s);
    expect(applyMeltOrgans(ORGANS, stepMelt(s, 1 / 60))).toEqual(end);
  });
});

describe('endpointHeights', () => {
  it('emits two entries per prim, a then b', () => {
    const h = endpointHeights(BODY);
    expect(h).toHaveLength(BODY.length * 2);
    expect(h[0]).toBe(BODY[0]!.a[1]);
    expect(h[1]).toBe(BODY[0]!.b[1]);
  });
});

describe('remeltClusters', () => {
  const CLUSTERS: ClusterInfo[] = [
    { id: 0, limb: 'legL', start: 0, count: 2, center: [0.1, 0.5, 0], radius: 0.6, alive: true },
    { id: 1, limb: 'torso', start: 2, count: 2, center: [0, 1.2, 0], radius: 0.5, alive: true },
  ];

  it('contains every melted endpoint of its own cluster, radius included', () => {
    const melted = meltedAt(1);
    const out = remeltClusters(CLUSTERS, melted);
    for (const c of out) {
      for (let i = c.start; i < c.start + c.count; i++) {
        const p = melted[i]!;
        const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
        for (const e of [p.a, p.b]) {
          const d = Math.hypot(e[0] - c.center[0], e[1] - c.center[1], e[2] - c.center[2]);
          expect(d + r).toBeLessThanOrEqual(c.radius + 1e-9);
        }
      }
    }
  });

  it('carries id, limb, start, count and alive through unchanged', () => {
    const out = remeltClusters(CLUSTERS, meltedAt(0.7));
    for (let i = 0; i < CLUSTERS.length; i++) {
      expect(out[i]!.id).toBe(CLUSTERS[i]!.id);
      expect(out[i]!.limb).toBe(CLUSTERS[i]!.limb);
      expect(out[i]!.start).toBe(CLUSTERS[i]!.start);
      expect(out[i]!.count).toBe(CLUSTERS[i]!.count);
      expect(out[i]!.alive).toBe(CLUSTERS[i]!.alive);
    }
  });

  it('moves the sphere — a melted cluster is not where it stood', () => {
    const out = remeltClusters(CLUSTERS, meltedAt(1));
    expect(out[0]!.center[1]).toBeLessThan(CLUSTERS[0]!.center[1]);
  });

  it('returns an empty cluster untouched', () => {
    const empty: ClusterInfo = { id: 9, limb: 'head', start: 4, count: 0, center: [1, 2, 3], radius: 0.4, alive: true };
    expect(remeltClusters([empty], BODY)[0]).toBe(empty);
  });
});
