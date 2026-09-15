// src/lab/sdf-zombie/gore-parts.ts
//
// PROCEDURAL GORE PARTS: chunky meat and classic bones.
//
// WHY THIS EXISTS. The owner, twice: the gibs "still look rather like weird
// oblong sausages" / "tubes and balls", and then the direction:
//
//   "i would prefer if like upon explosion the whole character became chunky
//    meaty textured and blood stained mesh parts that were then exploded
//    outwards eg it doesnt really have to resemble the SDF body part shapes at
//    all. it would include some skeleton bones too but those could be unrelated
//    to the actual skeleton bones in the body — eg these would look more like
//    classic bone silhouette shaft with knobby heads which our simplified
//    skeletons in the body dont have"
//
// That withdraws the premise `gib-parts.ts` was built on (that the pieces
// reassemble into the body's own silhouette), and with it the objection to mesh
// parts. So these are parts that were never body parts: a chunk of meat, and a
// bone the way a bone is DRAWN rather than the way this body's skeleton happens
// to be authored.
//
// SHAPE IS THE WHOLE JOB. A smooth ellipsoid reads as a tube; what reads as meat
// is FACETS, an irregular silhouette, and a cut face where it left the body.
// Hence: an ico shell displaced by seeded noise, QUANTIZED onto a coarse grid
// (the chunk look), and sliced flat on one side. A bone is a shaft with TWO
// LOBES per end, so its head reads as a condyle rather than a ball on a stick.
//
// This module is deliberately three-free: it emits plain arrays, and
// `webgpu/gore-part-geom.ts` wraps them in a BufferGeometry. Every shape rule is
// therefore testable with no GPU and no scene.
import { bakeChunkAlbedo, fbm, type ChunkFieldEvals, type ChunkLook } from './chunk-bake-field';
import type { Vec3 } from './types';

export type MeatVariant =
  // meat: torn muscle, cut faces, dry-ish
  | 'blob' | 'slab' | 'wedge' | 'gobbet' | 'strip'
  // organs: wet, glossy, and RED/PINK — the owner's note that "some of the ones
  // that look like organs [are okay] but they need to be like specular and
  // red/pink like organs" is why these are their own family rather than a
  // repaint: an organ is a different MATERIAL, not a different shape.
  | 'liver' | 'gut' | 'heart';
export type BoneVariant = 'long' | 'short' | 'rib' | 'knuckle';
export const MEAT_VARIANTS: readonly MeatVariant[] = [
  'blob', 'slab', 'wedge', 'gobbet', 'strip', 'liver', 'gut', 'heart',
];
/** The organ family — painted wet and red instead of through the meat ramp. */
export const ORGAN_VARIANTS: readonly MeatVariant[] = ['liver', 'gut', 'heart'];
export const isOrgan = (v: MeatVariant): boolean => ORGAN_VARIANTS.includes(v);
export const BONE_VARIANTS: readonly BoneVariant[] = ['long', 'short', 'rib', 'knuckle'];

/** A part's mesh: indexed triangles in metres, centred on the origin. */
export interface PartMesh {
  positions: number[];
  indices: number[];
  /** Nominal radius (m) — what the physics gives the chunk. */
  radius: number;
}

/** Deterministic per-part RNG — mulberry32, the repo's own (game-weapon.ts). */
export function partRng(seed: number): () => number {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantize onto a coarse grid: the single cheapest thing that turns a smooth
 *  shell into a CHUNK. Facets are the look; the step is the knob. */
function quant(v: number, step: number): number {
  return Math.round(v / step) * step;
}

// ——— a mesh builder that keeps its own indices ————————————————————————

class Soup {
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number): number {
    const id = this.positions.length / 3;
    this.positions.push(x, y, z);
    return id;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /** A low-poly sphere (subdivision-0 icosahedron: 20 faces). Chunks are small
   *  and gibs fly fast — more facets here is wasted smoothness. */
  sphere(cx: number, cy: number, cz: number, r: number): void {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const ids = raw.map(([x, y, z]) => {
      const l = Math.hypot(x!, y!, z!);
      return this.vertex(cx + (x! / l) * r, cy + (y! / l) * r, cz + (z! / l) * r);
    });
    for (const [a, b, c] of faces) this.tri(ids[a!]!, ids[b!]!, ids[c!]!);
  }

  /** A tapered, CAPPED tube — capped because a gib tumbles and an open end would
   *  show its hollow interior. */
  tube(from: Vec3, to: Vec3, r0: number, r1: number, sides: number): void {
    const ax: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(ax[0], ax[1], ax[2]) || 1e-6;
    const n: Vec3 = [ax[0] / len, ax[1] / len, ax[2] / len];
    const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const c1: Vec3 = [
      n[1] * helper[2] - n[2] * helper[1],
      n[2] * helper[0] - n[0] * helper[2],
      n[0] * helper[1] - n[1] * helper[0],
    ];
    const l1 = Math.hypot(c1[0], c1[1], c1[2]) || 1e-6;
    const u: Vec3 = [c1[0] / l1, c1[1] / l1, c1[2] / l1];
    const v: Vec3 = [
      n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0],
    ];
    const ring = (c: Vec3, r: number): number[] => {
      const ids: number[] = [];
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
        ids.push(this.vertex(
          c[0] + u[0]! * cx + v[0]! * cy,
          c[1] + u[1]! * cx + v[1]! * cy,
          c[2] + u[2]! * cx + v[2]! * cy,
        ));
      }
      return ids;
    };
    const a = ring(from, r0);
    const b = ring(to, r1);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      this.tri(a[s]!, b[s]!, b[s2]!);
      this.tri(a[s]!, b[s2]!, a[s2]!);
    }
    // Caps as fans through a centre vertex.
    const ca = this.vertex(from[0], from[1], from[2]);
    const cb = this.vertex(to[0], to[1], to[2]);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      this.tri(ca, a[s2]!, a[s]!);
      this.tri(cb, b[s]!, b[s2]!);
    }
  }
}

/** Subdivision-1 icosphere: 42 shared vertices, 80 faces — the meat shell. */
function icoShell(): { pos: number[]; idx: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const norm = (v: number[]): number[] => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return [v[0]! / l, v[1]! / l, v[2]! / l];
  };
  const pos: number[] = [];
  for (const p of base) { const n = norm(p); pos.push(n[0]!, n[1]!, n[2]!); }
  const mid = new Map<string, number>();
  const idx: number[] = [];
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = mid.get(key);
    if (hit !== undefined) return hit;
    const m = norm([
      pos[a * 3]! + pos[b * 3]!, pos[a * 3 + 1]! + pos[b * 3 + 1]!, pos[a * 3 + 2]! + pos[b * 3 + 2]!,
    ]);
    const id = pos.length / 3;
    pos.push(m[0]!, m[1]!, m[2]!);
    mid.set(key, id);
    return id;
  };
  for (const [a, b, c] of faces) {
    const ab = midpoint(a!, b!), bc = midpoint(b!, c!), ca = midpoint(c!, a!);
    idx.push(a!, ab, ca, b!, bc, ab, c!, ca, bc, ab, bc, ca);
  }
  return { pos, idx };
}

// ——— the blood and depth FIELDS ——————————————————————————————————————
//
// Pure functions of position, so the same field drives the geometry (the cut),
// the vertex paint and the synthetic `ChunkFieldEvals` below. Sampling a
// per-vertex array by nearest point instead would make the three disagree.

/** Blood, 0..1: pooling toward the cut ends and in the noise's hollows. */
export function bloodField(p: Vec3, seed: number, extra = 0): number {
  const n = fbm([p[0] * 6.2 + seed, p[1] * 6.2, p[2] * 6.2 + seed * 0.7]);
  return Math.min(1, Math.max(0, 0.16 + extra + 0.55 * n));
}

/** Tissue depth beneath the skin, in metres. The meat ramp reads this, so a
 *  deep-cut face shows fat and muscle while the outer skin stays skin. */
export function depthField(p: Vec3, scaleM: number, seed: number, extra = 0): number {
  const n = fbm([p[0] * 9.1 + seed, p[1] * 9.1, p[2] * 9.1]);
  return Math.max(0, (0.2 - n * 0.16) * scaleM + extra);
}

// ——— meat ————————————————————————————————————————————————————————————

interface MeatShape {
  scale: Vec3;
  /** Noise displacement amplitude, as a fraction of the radius. */
  lump: number;
  /** Noise frequency: low = fat lobes, high = grainy. */
  freq: number;
  /** How hard the radius displacement is TERRACED, 0..1. A smooth displacement
   *  gives a rounded lump; quantizing the displacement itself leaves flat
   *  plateaus with hard steps between them, which is what reads as CHUNKY. This
   *  is the knob the owner's "too rounded" note turns. */
  terrace: number;
  /** Quantization step as a fraction of the radius. Coarser = chunkier. */
  chunk: number;
  /** Axis of the CUT plane and how far out it sits (fraction of the radius).
   *  -1 = no cut (a gob, not a severed piece). */
  cutAxis: number;
  cutAt: number;
  /** Push a hole through the middle (the torn-sheet variant). */
  hollow: number;
  /** Bend the part around a circular arc of this radius (fraction of the
   *  scale). 0 = straight. A GUT has to be a LOOP: a straight gut is a sausage,
   *  which is the exact read the owner rejected. */
  arc: number;
}

// EVERY `chunk` AND `terrace` HERE IS COARSE ON PURPOSE. The first version of
// these parts ran 0.14-0.22 quantization and no terracing, and the owner's
// verdict was "too rounded" — which is what a shell with gentle displacement and
// fine quantization IS. Coarse steps and terraced displacement cost nothing and
// are the whole difference.
const MEAT_SHAPES: Record<MeatVariant, MeatShape> = {
  blob: { scale: [1, 0.86, 0.94], lump: 0.42, freq: 2.4, terrace: 0.55, chunk: 0.3, cutAxis: -1, cutAt: 0, hollow: 0, arc: 0 },
  slab: { scale: [1.15, 0.42, 0.95], lump: 0.34, freq: 3.2, terrace: 0.6, chunk: 0.3, cutAxis: 2, cutAt: 0.72, hollow: 0, arc: 0 },
  wedge: { scale: [1.0, 0.8, 1.1], lump: 0.34, freq: 2.8, terrace: 0.7, chunk: 0.32, cutAxis: 0, cutAt: 0.62, hollow: 0, arc: 0 },
  gobbet: { scale: [0.8, 0.78, 0.8], lump: 0.5, freq: 4.6, terrace: 0.8, chunk: 0.34, cutAxis: -1, cutAt: 0, hollow: 0, arc: 0 },
  strip: { scale: [1.3, 0.34, 0.5], lump: 0.36, freq: 3.6, terrace: 0.45, chunk: 0.26, cutAxis: -1, cutAt: 0, hollow: 0.55, arc: 0 },
  // Organs sit SMOOTHER than meat — a liver is a glossy smooth mass, not a
  // broken rock — but they keep a coarse enough silhouette not to read as balls.
  liver: { scale: [1.2, 0.62, 0.85], lump: 0.26, freq: 2.2, terrace: 0.12, chunk: 0.16, cutAxis: -1, cutAt: 0, hollow: 0, arc: 0 },
  gut: { scale: [0.55, 0.55, 1.15], lump: 0.3, freq: 3.0, terrace: 0.1, chunk: 0.18, cutAxis: -1, cutAt: 0, hollow: 0, arc: 1.25 },
  heart: { scale: [0.95, 1.1, 0.8], lump: 0.34, freq: 3.4, terrace: 0.15, chunk: 0.2, cutAxis: -1, cutAt: 0, hollow: 0, arc: 0 },
};

/**
 * WHERE THE CUT PLANE SITS, ON THE QUANTIZATION GRID. This has to be quantized
 * like the vertices are: the mesh snaps every coordinate to `step`, so a limit
 * that is not a multiple of `step` would put the "flat" face a fraction off the
 * plane the blood field samples — the face would be flat but the decal would
 * land beside it. NaN-free sentinel: -1 when the variant has no cut.
 */
/** The quantization step for a variant, at a scale — exported so a test can
 *  assert the lattice the vertices actually land on. */
export function chunkStepOf(variant: MeatVariant, scaleM: number): number {
  return scaleM * MEAT_SHAPES[variant].chunk;
}

export function cutLimitOf(variant: MeatVariant, scaleM: number): number {
  const sh = MEAT_SHAPES[variant];
  if (sh.cutAxis < 0) return -1;
  return quant(scaleM * sh.cutAt, scaleM * sh.chunk);
}

/**
 * ONE chunk of meat. `scaleM` is its radius in metres, so a variant is a SHAPE
 * and the caller decides how big a gob it is. Vertices that land past the cut
 * plane are pulled back onto it, which is what makes a part read as TORN rather
 * than grown; the same plane feeds the blood field, so the sliced face is the
 * bloody one.
 */
export function meatChunkMesh(variant: MeatVariant, scaleM: number, seed: number): PartMesh {
  const sh = MEAT_SHAPES[variant];
  const { pos: shell, idx } = icoShell();
  const positions: number[] = [];
  const step = scaleM * sh.chunk;
  const head = (seed % 97) * 1.13;
  for (let i = 0; i < shell.length; i += 3) {
    const ux = shell[i]!, uy = shell[i + 1]!, uz = shell[i + 2]!;
    const n = fbm([ux * sh.freq + head, uy * sh.freq + head * 1.7, uz * sh.freq + head * 2.3]);
    // TERRACE the displacement: quantize the noise before it becomes a radius, so
    // the surface is plateaus and steps rather than a gentle bulge.
    const t = sh.terrace > 0
      ? n * (1 - sh.terrace) + Math.round(n * 3) / 3 * sh.terrace
      : n;
    const rad = scaleM * (1 + sh.lump * t);
    let x = ux * rad * sh.scale[0]!;
    let y = uy * rad * sh.scale[1]!;
    let z = uz * rad * sh.scale[2]!;
    if (sh.cutAxis >= 0) {
      const own = [x, y, z][sh.cutAxis]!;
      const limit = cutLimitOf(variant, scaleM);
      if (Math.abs(own) > limit) {
        const s = limit / Math.abs(own);
        if (sh.cutAxis === 0) x *= s;
        else if (sh.cutAxis === 1) y *= s;
        else z *= s;
      }
    }
    if (sh.hollow > 0) {
      const d = Math.hypot(x, z);
      const hole = scaleM * sh.hollow;
      if (d < hole && d > 1e-5) { const k = hole / d; x *= k; z *= k; }
    }
    if (sh.arc > 0) {
      // BEND the part around an arc: the long axis becomes an angle and x
      // becomes the radial offset. A loop reads as bowel; a straight run of the
      // same cross-section reads as a sausage, which is the whole difference.
      const R = scaleM * sh.arc;
      const a = z / R;
      const r = R + x;
      x = r * Math.sin(a);
      z = r * Math.cos(a) - R;
    }
    positions.push(quant(x, step), quant(y, step), quant(z, step));
  }
  return {
    positions, indices: idx,
    radius: scaleM * Math.max(sh.scale[0]!, sh.scale[1]!, sh.scale[2]!) * 1.12,
  };
}

/** The meat variant's own blood/depth fields, including the cut-face bonus. */
export function meatFields(
  variant: MeatVariant, scaleM: number, seed: number,
): { blood: (p: Vec3) => number; depth: (p: Vec3) => number } {
  const sh = MEAT_SHAPES[variant];
  const limit = cutLimitOf(variant, scaleM);
  const onPlane = (p: Vec3): boolean => sh.cutAxis >= 0
    && Math.abs(Math.abs([p[0], p[1], p[2]][sh.cutAxis]!) - limit) < 1e-6;
  return {
    blood: (p: Vec3) => bloodField(p, seed, onPlane(p) ? 0.42 : 0),
    depth: (p: Vec3) => depthField(p, scaleM, seed, onPlane(p) ? scaleM * 0.45 : 0),
  };
}

// ——— bones ————————————————————————————————————————————————————————————

/**
 * ONE classic bone: a SHAFT with KNOBBY ENDS, two lobes per end, so the head
 * reads as a condyle instead of a ball. Deliberately NOT the body's own
 * skeleton groups, and deliberately not `bone-tube-geom.ts` — that module's
 * contract is fidelity to an SDF prim within 1 mm, which is the opposite of a
 * classic bone silhouette.
 */
export function classicBoneMesh(variant: BoneVariant, scaleM: number, seed: number): PartMesh {
  const r = partRng(seed * 104729 + variant.length * 977);
  const soup = new Soup();
  if (variant === 'knuckle') {
    const rr = scaleM * 0.4;
    const at: Vec3[] = [[-rr * 0.9, 0, -rr * 0.4], [rr * 0.9, 0, -rr * 0.4], [0, rr * 0.8, rr * 0.5]];
    for (const p of at) soup.sphere(p[0], p[1], p[2], rr);
    return { positions: soup.positions, indices: soup.indices, radius: scaleM * 0.95 };
  }
  const len = variant === 'long' ? scaleM * 2.0 : variant === 'short' ? scaleM * 1.1 : scaleM * 1.6;
  const shaft = scaleM * (variant === 'short' ? 0.32 : 0.2);
  const lobe = shaft * 1.8;
  const bend = variant === 'rib' ? scaleM * 0.5 : 0;
  const from: Vec3 = [0, -len / 2, 0];
  const to: Vec3 = [0, len / 2, 0];
  if (bend > 0) {
    // A bent shaft is two straight runs meeting at a kink — cheap, and the kink
    // is exactly what reads as a rib.
    const mid: Vec3 = [bend * 0.5, 0, bend];
    soup.tube(from, mid, shaft, shaft * 0.93, 7);
    soup.tube(mid, to, shaft * 0.93, shaft, 7);
  } else {
    soup.tube(from, to, shaft, shaft * 0.9, 7);
  }
  for (const end of [from, to]) {
    const side = (r() - 0.5) * shaft * 1.5;
    soup.sphere(end[0] + side, end[1], end[2], lobe);
    soup.sphere(end[0] - side * 0.85, end[1], end[2], lobe * 0.92);
  }
  return { positions: soup.positions, indices: soup.indices, radius: scaleM * (variant === 'long' ? 1.05 : 0.82) };
}

/** The bone's own blood field: dried blood pools at the joints (the ends). */
export function boneBloodField(scaleM: number, seed: number): (p: Vec3) => number {
  return (p: Vec3) => {
    const endness = Math.min(1, Math.abs(p[1]) / (scaleM * 0.9));
    return bloodField(p, seed, 0.34 * endness);
  };
}

// ——— colour, from the game's own meat chain ——————————————————————————

/**
 * Paint a part's vertices with `bakeChunkAlbedo` — the SAME ramp the marched
 * flesh and the baked chunks use, so the parts match the wounds and the goo they
 * land beside. There is no SDF here, so the ramp's two inputs (the wound mask
 * and the depth beneath the skin) come from the part's own procedural fields:
 * that IS the blood decal layer, and it is why a sliced face shows fat and
 * muscle while the outer skin stays skin.
 *
 * Bones do NOT go through the meat ramp: they are painted from the look's fat
 * tone (ivory), darkened where blood clings, because a bone that ramps to
 * viscera is a meat-coloured bone.
 */
export function paintPart(
  mesh: PartMesh, look: ChunkLook, kind: 'meat' | 'bone' | 'organ',
  fields: { blood: (p: Vec3) => number; depth: (p: Vec3) => number },
): Float32Array {
  const count = mesh.positions.length / 3;
  const out = new Float32Array(count * 4);
  if (kind === 'organ') {
    // ORGANS ARE A DIFFERENT MATERIAL, not a repaint of meat: the owner's note
    // was that the organ-ish parts are "okay" but "need to be like specular and
    // red/pink like organs". So they take the viscera/organ tones straight, are
    // pushed a little toward pure red and pink rather than the brownish dermis,
    // and are WET EVERYWHERE (alpha ~0.9) — the material turns alpha into
    // roughness, 0.9 dry against 0.31 wet, so alpha near 1 is the gloss.
    const vis = look.visceraColor;
    const org = look.organColor;
    const pinkOf = (v: Vec3): Vec3 => [
      Math.min(1, v[0] * 0.55 + 0.5),
      Math.min(1, v[1] * 0.45 + 0.12),
      Math.min(1, v[2] * 0.45 + 0.16),
    ];
    const deep: Vec3 = pinkOf(vis);
    const light: Vec3 = pinkOf(org);
    for (let i = 0; i < count; i++) {
      const p: Vec3 = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
      const b = fields.blood(p);
      // Lobule structure: a coarse mottle between the two tones, so a liver is
      // not one flat red — the "flat pale shapes" complaint applies to colour as
      // much as to geometry.
      const lobe = fbm([p[0] * 26 + 3.1, p[1] * 26, p[2] * 26]) * 0.5 + 0.5;
      const t = Math.min(1, Math.max(0, lobe * 0.6 + b * 0.5));
      // Membrane/pale streaks where the noise runs high — the connective tissue
      // that keeps an organ from reading as a red rubber ball.
      const streak = Math.min(0.45, Math.max(0, (lobe - 0.72) * 1.6));
      out[i * 4 + 0] = Math.min(1, (deep[0]! + (light[0]! - deep[0]!) * t) * (1 - streak) + 0.86 * streak);
      out[i * 4 + 1] = Math.min(1, (deep[1]! + (light[1]! - deep[1]!) * t) * (1 - streak) + 0.72 * streak);
      out[i * 4 + 2] = Math.min(1, (deep[2]! + (light[2]! - deep[2]!) * t) * (1 - streak) + 0.68 * streak);
      out[i * 4 + 3] = 0.78 + 0.22 * b;   // wet everywhere; slicker where blood pools
    }
    return out;
  }
  if (kind === 'bone') {
    const ivory: Vec3 = [
      Math.min(1, look.fatColor[0] * 0.92 + 0.24),
      Math.min(1, look.fatColor[1] * 0.9 + 0.22),
      Math.min(1, look.fatColor[2] * 0.86 + 0.16),
    ];
    for (let i = 0; i < count; i++) {
      const p: Vec3 = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
      const b = fields.blood(p);
      out[i * 4 + 0] = ivory[0]! * (1 - 0.4 * b) + 0.15 * b;
      out[i * 4 + 1] = ivory[1]! * (1 - 0.55 * b) + 0.03 * b;
      out[i * 4 + 2] = ivory[2]! * (1 - 0.62 * b) + 0.02 * b;
      // Wetness: blood is wet, the shaft is dry (the material turns alpha into
      // roughness — 0.9 dry against 0.31 wet).
      out[i * 4 + 3] = Math.min(1, b * 0.75);
    }
    return out;
  }
  const ev: ChunkFieldEvals = {
    field: () => 1,
    // The ramp reads depth beneath the ORIGINAL skin, fed as the pre-wound
    // field — hence the negation.
    preWound: (p: Vec3) => -fields.depth(p),
    woundMask: (p: Vec3) => fields.blood(p),
    nearWound: (p: Vec3) => fields.blood(p) > 0.5,
    materialAt: () => 'flesh',
  };
  for (let i = 0; i < count; i++) {
    const p: Vec3 = [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
    const [r, g, b, wm] = bakeChunkAlbedo(p, p, ev, look);
    // DEEPEN the colour. The first pass read as "random pale shapes", and the
    // ramp alone is gentle: `bakeChunkAlbedo` mixes skin toward tissue by the
    // wound mask, so a part whose mask is low stays near the pale dermis
    // everywhere. Two terms fix that without touching the shared ramp:
    //   * a CONTRAST expansion around the ramp's own mid grey, so flesh and clot
    //     separate instead of averaging out;
    //   * CREVICE darkening from the same noise the shape uses, which is what
    //     makes the new flat facets read as bumps — a facet in a hollow is
    //     darker than a facet on a ridge, and the eye takes that as relief.
    const crev = fbm([p[0] * 34 + 7.7, p[1] * 34, p[2] * 34]);          // -1..1
    const relief = 1 - 0.34 * Math.max(0, -crev);
    const mid = 0.5;
    const fx = (c: number): number => Math.min(1, Math.max(0,
      (mid + (c - mid) * 1.34) * relief));
    out[i * 4 + 0] = fx(r); out[i * 4 + 1] = fx(g); out[i * 4 + 2] = fx(b);
    // Wetter where the blood mask is high: the material reads alpha as gloss, so
    // this is what puts a shine on the torn faces.
    out[i * 4 + 3] = Math.min(1, wm * 1.15);
  }
  return out;
}
