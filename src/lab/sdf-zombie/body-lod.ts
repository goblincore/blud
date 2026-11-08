// src/lab/sdf-zombie/body-lod.ts
//
// DISTANCE MESH LOD — the pure half (spike, 2026-11-08; plan docs/superpowers/plans/2026-09-14-baked-mesh-lod.md L3).
//
// A far, standing, undamaged body leaves the SDF march and is drawn as ONE baked mesh per character type (shared by
// every body of that type), skinned to the rig's per-bone frames (rig-frames.ts boneFrames, the same frames that pose
// the kit), so the mesh walks, turns and swings with the body. Nothing here touches three: the band, the eligibility
// rule, the bake bounds and the skin weights. The rendering half is webgpu/body-lod-view.ts.
//
// DAMAGE RULE ('refine', the default): the mesh is only ever an intact body. The first wound, a burn, a tear or a
// collapse sends it back to the march for good (it never re-enters the mesh tier with damage on it). Hits are tested
// against the CPU body (posed()), never against what is drawn, so wounds, blood, gibs and blow-off all run exactly as
// before: the body is simply on the march again the frame its wound is stamped. 'keep' (?bodylodwound=keep) is the
// A/B for "show nothing until near": a wounded far body stays a clean mesh until it crosses the band; only a sever, a
// burn, a tear or a collapse refines it.
import type { Primitive, Vec3 } from './types';
import { sdPrimitive } from './validate';

export type BodyLodWoundRule = 'refine' | 'keep';

export interface BodyLodConfig {
  on: boolean;
  /** Camera distance (m, torso centre) beyond which a body is meshed. */
  switchM: number;
  /** Total width of the hysteresis band around switchM (m). */
  hysteresisM: number;
  wound: BodyLodWoundRule;
  /** Debug: tint meshed bodies so a sheet shows which tier each body is on. */
  tint: boolean;
}

export const BODY_LOD_DEFAULTS: BodyLodConfig = { on: true, switchM: 10, hysteresisM: 1, wound: 'refine', tint: false };

/** `?bodylod=0` off (today's march for every body); `?bodylodm=<m>` switch distance; `?bodylodh=<m>` hysteresis;
 *  `?bodylodwound=refine|keep`; `?bodylodtint=1`. */
export function bodyLodConfigFrom(search: string): BodyLodConfig {
  const q = new URLSearchParams(search);
  const num = (k: string, d: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) && v >= 0 ? v : d;
  };
  const w = q.get('bodylodwound');
  return {
    on: q.get('bodylod') !== '0',
    switchM: num('bodylodm', BODY_LOD_DEFAULTS.switchM),
    hysteresisM: num('bodylodh', BODY_LOD_DEFAULTS.hysteresisM),
    wound: w === 'keep' ? 'keep' : 'refine',
    tint: q.get('bodylodtint') === '1',
  };
}

/** Hysteretic band: a meshed body stays meshed until it comes nearer than switchM - h/2; a marched one is meshed
 *  only beyond switchM + h/2. A body walking along the edge cannot flicker. */
export function inMeshBand(wasMeshed: boolean, distM: number, cfg: Pick<BodyLodConfig, 'switchM' | 'hysteresisM'>): boolean {
  const half = cfg.hysteresisM / 2;
  return wasMeshed ? distM > cfg.switchM - half : distM > cfg.switchM + half;
}

export interface BodyLodFacts {
  standing: boolean;
  burning: boolean;
  tearing: boolean;
  /** Any wound on the body now. */
  wounded: boolean;
  /** Any cluster dead that is alive in the rest body (a limb off, the head popped). */
  severed: boolean;
}

/** May this body be drawn as the type mesh at all (the band decides whether it is)? */
export function bodyLodEligible(f: BodyLodFacts, rule: BodyLodWoundRule): boolean {
  if (!f.standing || f.burning || f.tearing || f.severed) return false;
  return rule === 'keep' || !f.wounded;
}

/** 'refine' is sticky: once damaged, a body stays on the march even after it walks back out past the band. */
export function stickyRefine(rule: BodyLodWoundRule, f: BodyLodFacts): boolean {
  return rule === 'refine' && (f.wounded || f.severed || f.burning);
}

/** The rest body's bake box: every live additive prim, inflated by its radius, blend and bend (soldierCorpseSnapshot's
 *  rule). */
export function restBakeBounds(prims: readonly Primitive[]): { centre: Vec3; halfExtent: Vec3 } | null {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const p of prims) {
    if (p.dead || p.op === 'sub') continue;
    any = true;
    const r = Math.max(p.radius, p.radiusB ?? 0) * Math.max(...p.scale) + p.blendK * 2 + 0.025 + Math.hypot(...(p.bend ?? [0, 0, 0]));
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p.a[k]! - r, p.b[k]! - r);
      hi[k] = Math.max(hi[k]!, p.a[k]! + r, p.b[k]! + r);
    }
  }
  if (!any) return null;
  return {
    centre: [0, 1, 2].map(k => (lo[k]! + hi[k]!) / 2) as unknown as Vec3,
    halfExtent: [0, 1, 2].map(k => (hi[k]! - lo[k]!) / 2) as unknown as Vec3,
  };
}

/** Width (m) of the distance falloff that blends neighbouring bones at a joint. */
export const SKIN_FALLOFF_M = 0.025;

/**
 * Four-influence skin weights for a baked rest mesh: each vertex is weighted to the bones whose prims lie nearest it
 * (distance to the prim's surface, so a vertex in a joint's blend weights both sides), w ∝ exp(-(d - dmin)/falloff),
 * top four kept and normalised. `bones` lists the skeleton's bone names in order; a prim whose bone is not in it is
 * ignored. A vertex no prim claims gets bone 0 (the caller orders the root/torso bone first).
 */
export function skinWeights(positions: Float32Array, prims: readonly Primitive[], bones: readonly string[],
  falloff = SKIN_FALLOFF_M): { index: Uint16Array; weight: Float32Array } {
  const n = positions.length / 3;
  const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
  const boneOf = new Map(bones.map((b, i) => [b, i]));
  const live = prims.map((p, i) => ({ p, b: p.bone !== undefined ? boneOf.get(p.bone) : undefined, i }))
    .filter((e): e is { p: Primitive; b: number; i: number } => e.b !== undefined && !e.p.dead && e.p.op !== 'sub');
  const best = new Float64Array(bones.length);
  const p: [number, number, number] = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    p[0] = positions[v * 3]!; p[1] = positions[v * 3 + 1]!; p[2] = positions[v * 3 + 2]!;
    best.fill(Infinity);
    for (const e of live) {
      const d = sdPrimitive(p, e.p);
      if (d < best[e.b]!) best[e.b] = d;
    }
    let dmin = Infinity;
    for (let b = 0; b < bones.length; b++) dmin = Math.min(dmin, best[b]!);
    if (!Number.isFinite(dmin)) { weight[v * 4] = 1; continue; }
    const cand: { b: number; w: number }[] = [];
    for (let b = 0; b < bones.length; b++) {
      const d = best[b]!;
      if (!Number.isFinite(d)) continue;
      const w = Math.exp(-(d - dmin) / falloff);
      if (w > 1e-3) cand.push({ b, w });
    }
    cand.sort((x, y) => y.w - x.w);
    const top = cand.slice(0, 4);
    const sum = top.reduce((s, c) => s + c.w, 0);
    top.forEach((c, k) => { index[v * 4 + k] = c.b; weight[v * 4 + k] = c.w / sum; });
  }
  return { index, weight };
}
