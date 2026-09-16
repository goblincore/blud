// src/lab/sdf-zombie/chunk-bake-field.ts
//
// The CPU field and albedo baker for settled gib chunks (close-up task 5).
// When a chunk settles it stops being marched and is extracted ONCE into a
// static triangle mesh; this module is the field that extraction samples and
// the per-vertex colour the baked mesh carries instead of the march's
// shading chain.
//
// WHAT IS MIRRORED, and how faithfully. The marched chunk's field is
// HELPERS' mapBody + APPLY_CARVES + APPLY_WOUNDS + APPLY_BONES (near-wound
// gate). This file mirrors that composition on the CPU reference
// (validate.ts sdBody/smin/smax/sdPrimitive):
//
//   flesh smin fold ........ sdBody over the chunk's WORLD-space flesh prims
//   torn-end carve ......... smax(d, depth - r, woundCfg.y) per torn end —
//                            APPLY_WOUNDS with NO depth-slab cap, which is
//                            exactly what chunk views upload (writeWounds
//                            gets no caps → capEff = 1e5 → the min is the
//                            bare sphere), and no rim bump (sub-cm lip, a
//                            shading-scale detail the bake consciously
//                            drops — noted in the task report).
//   bones/organs ........... hard min, ONLY where some wound's r < depth*2 —
//                            the applyBones nearWound gate verbatim. A bone
//                            that won the min shades AS PLAIN MEAT in the
//                            march (the bone albedo branch was deleted when
//                            bone tubes landed; isBone only feeds the melt
//                            ramp), so the bake paints it as meat too — the
//                            bone matters here for the crater's SILHOUETTE
//                            and crease, not its colour. Organs DO tint
//                            (the isOrgan branch is alive) and are handled.
//
// The march's silhouette noise and the melt's volume displacement are NOT
// mirrored — the baked surface is the clean field. On the game page the melt
// is a transient owner-driven effect and the noise is sub-cm roughness; both
// are noted in the report rather than ported.
//
// The colour baker mirrors the ALBEDO chain only (march.wgsl.ts ~2640-2760):
// tissue ramp by pre-wound depth, the wound mask mix, organ tint, mottle
// blotch, and the chunk gore mask (lodCfg.w = 1). Spec/fresnel/AO/scatter/
// wound-shadow are LIVE lighting, owned by the baked mesh's shader
// (baked-chunks.ts), not baked. fbm/noise3/hash13 are transliterations of
// the WGSL constants so the mottle pattern matches character, and with the
// same anchor convention (chunk-local rest frame) even phase.
import type { Primitive, Vec3 } from './types';
import { sdBody, sdPrimitive, smax, type Body } from './validate';
import { dot, len, normalize, qRotate, type Quat } from './vec';
import { HEAD_EXTERIOR_GORE_KEEP } from './gib-look-tuning';

/** CPU mirrors of the march's hash/noise/fbm (march.wgsl.ts HASH13/NOISE3/FBM).
 *  Same constants, same smoothstep fade — the mottle field the bake paints
 *  is the same field the march would have sampled. */
export function hash13(pIn: Vec3): number {
  const fr = (x: number) => x - Math.floor(x);
  let p: Vec3 = [fr(pIn[0] * 0.1031), fr(pIn[1] * 0.1031), fr(pIn[2] * 0.1031)];
  // dot(p, p.yzx + 33.33) — the bias is INSIDE the second operand.
  const d = p[0] * (p[1] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33);
  p = [p[0] + d, p[1] + d, p[2] + d];
  return fr((p[0] + p[1]) * p[2]);
}

/** Trilinear value noise in [-1, 1] — NOISE3 verbatim. */
export function noise3(pIn: Vec3): number {
  const i: Vec3 = [Math.floor(pIn[0]), Math.floor(pIn[1]), Math.floor(pIn[2])];
  const fx = pIn[0] - i[0], fy = pIn[1] - i[1], fz = pIn[2] - i[2];
  const f: Vec3 = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)];
  const c = (di: number, dj: number, dk: number) =>
    hash13([i[0] + di, i[1] + dj, i[2] + dk]);
  const mixN = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = mixN(
    mixN(mixN(c(0, 0, 0), c(1, 0, 0), f[0]), mixN(c(0, 1, 0), c(1, 1, 0), f[0]), f[1]),
    mixN(mixN(c(0, 0, 1), c(1, 0, 1), f[0]), mixN(c(0, 1, 1), c(1, 1, 1), f[0]), f[1]),
    f[2],
  );
  return n * 2 - 1;
}

/** Two octaves at 0.6/0.3 — FBM verbatim. */
export function fbm(p: Vec3): number {
  return noise3([p[0] * 4, p[1] * 4, p[2] * 4]) * 0.6 + noise3([p[0] * 9, p[1] * 9, p[2] * 9]) * 0.3;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};

/** Everything the field and the colour bake need from a settled chunk view. */
export interface ChunkBakeParts {
  /** WORLD-space flesh prims (post chunk-transform; squash is 1 at settle). */
  flesh: Primitive[];
  /** Optional clustered corpse field; chunks retain their one-cluster fold. */
  body?: Body;
  /** WORLD-space bone + organ prims (the view's bonePrims array). */
  bones: Primitive[];
  /** Torn ends: world anchor + the view's girth radius (tornEndRadius). */
  torn: { at: Vec3; radius: number; normal?: Vec3; depth?: number; owner?: Body }[];
  /** The smax fillet width — the view's woundCfg.y at bake time. */
  carveK: number;
}

export interface ChunkFieldEvals {
  /** The full field: flesh + carves + near-wound bones. The extraction
   *  sampler. Negative inside. */
  field(p: Vec3): number;
  /** Flesh WITHOUT the torn-end carves — the pre-wound field the tissue
   *  ramp's depth term reads (march: mapBody's .w, "the PRE-wound field"). */
  preWound(p: Vec3): number;
  /** max over torn ends of (1 - smoothstep(0, 1.6r, dist)) — WOUND_MASK. */
  woundMask(p: Vec3): number;
  /** True when any torn end sits within 2x its radius — applyBones' gate. */
  nearWound(p: Vec3): boolean;
  /** Which material owns the surface: 'organ' when an organ prim wins the
   *  near-wound min, 'bone' when a bone does (painted as meat — see the
   *  header), 'flesh' otherwise. */
  materialAt(p: Vec3): 'flesh' | 'bone' | 'organ';
}

const bodyOf = (prims: Primitive[]): Body => ({
  prims,
  clusters: [{
    id: 0, limb: 'gob' as never, start: 0, count: prims.length,
    center: [0, 0, 0], radius: 1e3, alive: true,
  }],
});

/** Compose the settled chunk's field evaluators. Pure: no three, no GPU —
 *  everything a vitest can assert on. */
export function chunkBakeField(parts: ChunkBakeParts): ChunkFieldEvals {
  const body = parts.body ?? bodyOf(parts.flesh);
  const boneMin = (p: Vec3): { d: number; organ: boolean } | null => {
    if (parts.bones.length === 0) return null;
    let best = Infinity;
    let organ = false;
    for (const b of parts.bones) {
      const d = sdPrimitive(p, b);
      if (d < best) { best = d; organ = b.op === 'organ'; }
    }
    return { d: best, organ };
  };
  const wounds = parts.torn;
  const nearWound = (p: Vec3): boolean => {
    for (const w of wounds) {
      const r = len([p[0] - w.at[0], p[1] - w.at[1], p[2] - w.at[2]]);
      if (r < w.radius * 2) return true;
    }
    return false;
  };
  const woundMask = (p: Vec3): number => {
    let m = 0;
    for (const w of wounds) {
      const r = len([p[0] - w.at[0], p[1] - w.at[1], p[2] - w.at[2]]);
      m = Math.max(m, 1 - smoothstep(0, w.radius * 1.6, r));
    }
    return m;
  };

  return {
    field(p: Vec3): number {
      let d = sdBody(p, body);
      for (const w of wounds) {
        const r = len([p[0] - w.at[0], p[1] - w.at[1], p[2] - w.at[2]]);
        // APPLY_WOUNDS uncapped: smax(d, -(r - depth), k). The depth-slab
        // term is 1e5 for chunk views and drops out of the min.
        if (w.owner && sdBody(p, w.owner) > sdBody(p, body) + .005) continue;
        const slab = w.normal ? (w.depth ?? 1e5) - dot([p[0]-w.at[0], p[1]-w.at[1], p[2]-w.at[2]], w.normal) : 1e5;
        d = smax(d, Math.min(w.radius - r, slab), parts.carveK);
      }
      // applyBones: hard min, gated on nearWound (bones are contained in
      // flesh, so skipping the fold where no wound is near is EXACT — the
      // same proof the shader states).
      if (wounds.length > 0 && nearWound(p)) {
        const b = boneMin(p);
        if (b && b.d < d) d = b.d;
      }
      return d;
    },
    preWound(p: Vec3): number {
      return sdBody(p, body);
    },
    woundMask,
    nearWound,
    materialAt(p: Vec3): 'flesh' | 'bone' | 'organ' {
      // Ownership at a surface point (field = 0): the fold runs bones/organs
      // AFTER the carve, and a prim claims the surface when its own distance
      // at the hit is BELOW the field it joined — i.e. its iso was crossed
      // first. At a zero of the full field that is exactly "the point is
      // INSIDE the bone/organ". Bone shades as plain meat in the march (the
      // isBone branch only feeds the melt ramp), so the bake only ACTS on
      // 'organ' — but the attribution itself is kept honest for tests.
      if (!nearWound(p)) return 'flesh';
      const b = boneMin(p);
      if (b && b.d < 0) return b.organ ? 'organ' : 'bone';
      return 'flesh';
    },
  };
}

/**
 * The settled chunk's face frame, in the SAME world values the march's
 * `gInstHeadCentre`/`gInstHeadQuat`/`headAxes`/`faceCfg.z` hold. Carried into
 * the bake so a detached head's vertex albedo can keep the face clean instead
 * of baking the gore mask over it (2026-09-16 playtest follow-ups task 2).
 */
export interface BakeFaceFrame {
  centre: Vec3;
  quat: Quat;
  axes: Vec3;
  /** faceCfg.z — the head's forward sign. */
  forward: number;
  /** The march's `reach`: 1 for a sheet, 1.5 for a decal. */
  reach?: number;
}

/**
 * Coverage of the head's face projection at a surface point, mirroring the
 * FACE_LAYER facing/head-confine terms. APPROXIMATION, stated: the bake runs
 * per vertex before its normals are needed elsewhere, so the surface normal is
 * taken as the radial direction from the head centre. A head is locally convex
 * and that is the direction the face projection faces, so the coverage front
 * matches; the exact march value uses the interpolated normal.
 */
export function bakeFaceCover(p: Vec3, face: BakeFaceFrame): number {
  const d: Vec3 = [p[0] - face.centre[0], p[1] - face.centre[1], p[2] - face.centre[2]];
  const dl = len(d);
  const n: Vec3 = dl > 1e-6 ? [d[0] / dl, d[1] / dl, d[2] / dl] : [0, 0, 0];
  // Un-rotate into the head's rest frame (conjugate), then normalise per axis.
  const c: Quat = [-face.quat[0], -face.quat[1], -face.quat[2], face.quat[3]];
  const hrot = qRotate(c, d);
  const hs: Vec3 = [
    hrot[0] / Math.max(face.axes[0], 1e-4),
    hrot[1] / Math.max(face.axes[1], 1e-4),
    hrot[2] / Math.max(face.axes[2], 1e-4),
  ];
  const hfw: Vec3 = [0, 0, face.forward];
  const hfr = qRotate(face.quat, hfw);
  const reach = face.reach ?? 1;
  const region = 1 - smoothstep(1.30 * reach, 1.70 * reach, len(hs));
  const facing = smoothstep(0.28, 0.66, dot(n, hfr)) * region;
  // Mirror FACE_LAYER exactly: the frontal face is fully protected, the rest of
  // the head keeps HEAD_EXTERIOR_GORE_KEEP of the piece's gore.
  return Math.min(1, Math.max(0, facing + region * HEAD_EXTERIOR_GORE_KEEP));
}

/** The look values the albedo bake reads off the view's uniform set at bake
 *  time — the same VALUES the marched chunk would have shaded with (copied
 *  from the body template at cut time). Plain number/vec3 records so this
 *  module stays three-free and testable. */
export interface ChunkLook {
  baseColor: Vec3;
  deepColor: Vec3;
  fatColor: Vec3;
  mottleColor: Vec3;
  organColor: Vec3;
  visceraColor: Vec3;
  /** surfCfg3 = (woundDepthAmp, fatDepth, muscleDepth, visceraAmp). */
  woundDepthAmp: number;
  fatDepth: number;
  muscleDepth: number;
  visceraAmp: number;
  visceraDepth: number;
  /** surfCfg2 = (wetness, noiseAmp, mottleAmp, mottleScale). */
  mottleAmp: number;
  mottleScale: number;
  organAmp: number;
  /** lodCfg.w — 1 for chunk views (torn meat), 0 for clean bodies. */
  goreStrength: number;
}

/**
 * Per-vertex albedo, mirroring the march's albedo chain in its shipped
 * order. `p` is the surface point (world), `anchor` the SAME point in the
 * chunk's rest-local frame — the frame the march's fbm samples so mottle
 * rides the chunk instead of swimming over it.
 *
 * Returns [r, g, b, wm] — wm is the wound mask, carried out-of-band as the
 * albedo's alpha so the baked mesh's shader can boost wetness/fresnel near
 * the torn ends exactly where the march would have.
 */
export function bakeChunkAlbedo(
  p: Vec3, anchor: Vec3, ev: ChunkFieldEvals, look: ChunkLook,
  /** Face coverage at this vertex (0..1). The gore mask is attenuated by
   *  `(1 - faceCover)` so a detached head keeps its authored face — the march
   *  does the identical attenuation in FACE_LAYER + gore. Defaults to 0, which
   *  is every non-head piece and every pre-task-2 call site. */
  faceCover = 0,
): [number, number, number, number] {
  const wm = ev.woundMask(p);
  // Tissue ramp by depth beneath the ORIGINAL skin. The march reads
  // max(0, -preWoundField.w) * woundDepthAmp at the hit; the extraction
  // vertices stand on the CARVED surface, so the un-carved field there is
  // negative exactly inside the crater wall — the same quantity.
  const tissueDepth = Math.max(0, -ev.preWound(p)) * look.woundDepthAmp;
  const dermis: Vec3 = [
    look.baseColor[0] * 0.5 + look.deepColor[0] * 0.5,
    look.baseColor[1] * 0.5 + look.deepColor[1] * 0.5,
    look.baseColor[2] * 0.5 + look.deepColor[2] * 0.5,
  ];
  const clot: Vec3 = [look.deepColor[0] * 0.45, look.deepColor[1] * 0.45, look.deepColor[2] * 0.45];
  const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
  ];
  let tissue: Vec3;
  if (look.woundDepthAmp > 0) {
    const toFat = smoothstep(0, look.fatDepth, tissueDepth);
    const toMuscle = smoothstep(look.fatDepth, look.muscleDepth, tissueDepth);
    const toClot = smoothstep(look.muscleDepth, look.muscleDepth * 2.5, tissueDepth);
    // Viscera lumps with low-frequency fbm over the rest anchor, only where
    // a cavity is — the march amplitude-guards the fbm itself; the bake
    // runs per-VERTEX once, so the guard is a perf note, not a cost.
    let viscera = look.visceraColor;
    if (look.visceraAmp > 0 && wm > 0) {
      const lump = fbm([anchor[0] * 2.5, anchor[1] * 2.5, anchor[2] * 2.5]) * 0.5 + 0.5;
      viscera = [
        look.visceraColor[0] * (0.75 + 0.5 * lump),
        look.visceraColor[1] * (0.75 + 0.5 * lump),
        look.visceraColor[2] * (0.75 + 0.5 * lump),
      ] as Vec3;
    }
    const toViscera = smoothstep(look.muscleDepth, look.visceraDepth, tissueDepth) * (wm > 0 ? 1 : 0) * look.visceraAmp;
    tissue = mix3(dermis, look.fatColor, toFat);
    tissue = mix3(tissue, look.deepColor, toMuscle);
    tissue = mix3(tissue, clot, toClot);
    tissue = mix3(tissue, viscera, toViscera);
  } else {
    tissue = look.deepColor;
  }
  let albedo = mix3(look.baseColor, tissue, wm);

  // Organ tint (the isOrgan branch): only when an organ prim owns the
  // surface — inside a cavity by construction.
  if (ev.materialAt(p) === 'organ') {
    albedo = mix3(albedo, look.organColor, look.organAmp);
  }

  // Colour mottle: smoothstep on the fbm blotch (the shipped mapping, NOT
  // the 0.5+0.5 remap that read as a flat tint), over the rest anchor.
  if (look.mottleAmp > 0) {
    const blotch = smoothstep(-0.35, 0.35, fbm([anchor[0] * look.mottleScale, anchor[1] * look.mottleScale, anchor[2] * look.mottleScale]));
    albedo = mix3(albedo, look.mottleColor, blotch * look.mottleAmp);
  }

  // Gore mask (gobs-and-goo spec §2) — chunks are torn meat. Direct mirror
  // of the shipped block including its fbm-at-6.0 mottle and the clot mix.
  // ATTENUATED BY FACE COVERAGE (task 2): the march moved this pass after the
  // face layer for the same reason — a head must not bake its face under 85%
  // clot. faceCover is 0 off the face and on every non-head piece, so those
  // vertices are unchanged.
  const goreStrength = look.goreStrength * (1 - faceCover);
  if (goreStrength > 0) {
    const mottle = Math.min(1, Math.max(0, fbm([anchor[0] * 6, anchor[1] * 6, anchor[2] * 6]) * 0.5 + 0.5));
    const gore = Math.min(1, mottle * 0.55 + wm * 0.65) * goreStrength;
    const goreTarget = mix3(look.deepColor, [look.deepColor[0] * 0.55, look.deepColor[1] * 0.55, look.deepColor[2] * 0.55], mottle);
    albedo = mix3(albedo, goreTarget, gore * 0.85);
    // Broad dark clots on torn meat, including capped blast pieces whose
    // torn-end list is intentionally empty. Same mask as MARCH_BODY.
    const stain = smoothstep(0.40, 0.68, mottle) * goreStrength;
    albedo = mix3(albedo, [look.deepColor[0] * 0.22, look.deepColor[1] * 0.22, look.deepColor[2] * 0.22], stain * 0.85);
  }

  return [albedo[0], albedo[1], albedo[2], wm];
}

/** World dir -> chunk-local unit axis helper re-exported for tests. */
/**
 * BAKED AMBIENT OCCLUSION — the term a baked chunk cannot compute at runtime.
 *
 * The march has cheap AO from the field ("so creases and the insides of joints
 * stay dark") and `chunkShade` cannot: a mesh fragment shader has no field to
 * sample. Without it a settled piece shades at ao = 1.0 and NOTHING on it can be
 * in shadow, which is most of the owner's "way too light and dont follow the
 * lighting" beside the marched piece next to it.
 *
 * iq's five-tap occlusion along the surface normal, against the piece's OWN
 * field — a gib is a separate object, so occlusion by the body it came from
 * would be a shadow cast by something no longer there. The normal is the field
 * gradient by central differences rather than the triangulation's, because it is
 * the surface's own and is available before `computeVertexNormals` has run.
 */
export function bakeAoAt(field: (p: Vec3) => number, p: Vec3, cell: number): number {
  const e = cell * 0.5;
  const gx = field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]);
  const gy = field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]);
  const gz = field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]);
  const gl = Math.hypot(gx, gy, gz) || 1;
  const n: Vec3 = [gx / gl, gy / gl, gz / gl];
  let occ = 0;
  let sca = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.01 + 0.11 * (i / 5);
    const d = field([p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h]);
    occ += (h - d) * sca;
    sca *= 0.92;
  }
  return Math.max(0, Math.min(1, 1 - 2.4 * occ));
}

export const worldToLocalAxis = (v: Vec3): Vec3 => normalize(v);

/** Squared distance, the pellet test's inner loop. */
export const dist2 = (a: Vec3, b: Vec3): number => {
  const d: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return dot(d, d);
};
