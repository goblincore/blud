// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-organ-tubes.ts
//
// ORGANS, LOW-POLY (2026-10-07): an organ segment's mesh as SWEPT TUBES, one closed tube per organ prim, instead of a
// surface-nets extraction of their union. Notes: docs/dev-notes/2026-10-07-organs-lowpoly/NOTES.md.
//
// Owner, 2026-10-07: "i think the vertices can be reduced lol thats alot, tbh you can probably make alot of it via
// normal maps and simplify it (thinking about like the intestines for example)".
//
// WHY A SWEEP. An organ prim is a sphere swept along a straight or quadratic-Bezier axis (validate.ts sdPrimitive: the
// capsule, the round cone, sdBentCone), so its surface is the envelope of those spheres and has a closed form: rings
// about the axis and a spherical cap at each end. The segment's field is the HARD MIN of its prims, and the organ
// material writes depth, so drawing every prim's own closed tube IS that union: the depth test keeps the nearest
// surface, and the crease where two loops meet is exact, with no cell to smear it. What a sweep gives that an
// extraction cannot:
//  - the vertex count is set by the tessellation, not by the surface area over a cell squared;
//  - the normal is analytic (the direction from the axis), so a coarse ring still shades round;
//  - every vertex knows where it is ON ITS TUBE. That is `tube.xyz`, the vertex's place on the same tube pulled
//    straight (x along the axis in metres, yz across it), which is what the organ shader's bump is a function of
//    (mesh-organ.ts meshOrganHeight): rings across the axis read as haustra whatever way the loop bends.
//  - `tube.w` is the crease shade, baked: how near the vertex is to ANOTHER prim of the segment.
//
// A prim a sweep cannot express (a box, a strand, a shell, an oriented prim) makes sweepOrganTubes answer null, and
// the caller extracts the segment by surface nets as before (mesh.ts).
//
// Pure CPU: no three, no DOM.
import type { Primitive, Vec3 } from '../../types';
import { add, bendCtrl, cross, dot, len, normalize, scale as vscale, sub } from '../../vec';
import { sdPrimitive } from '../../validate';

export interface OrganTubeSpec {
  /** Vertices round each ring. */
  around: number;
  /** The largest turn of the axis between two rings, radians: a bent prim gets ceil(its whole turn / this) segments. */
  turnStep: number;
  /** The most segments along one prim. */
  alongMax: number;
  /** Latitude rings on each cap, the pole and the cap's base ring excluded. */
  capLats: number;
}

/** The canonical x of prim k starts at k times this (metres): each tube reads its own stretch of the shader's bump. */
export const ORGAN_TUBE_STRIDE = 0.37;
/** A vertex nearer than this to another prim's surface is in a crease: `tube.w` runs 0 (touching) to 1 (this far). */
export const ORGAN_CREASE_REACH = 0.014;

export interface OrganTubeMesh {
  /** Segment-local metres, 3 a vertex. */
  positions: Float32Array;
  /** Unit, analytic, 3 a vertex. */
  normals: Float32Array;
  /** 4 a vertex: xyz the vertex on its tube pulled straight (metres), w the crease shade (0 in a crease, 1 clear). */
  tube: Float32Array;
  index: number[];
  /** Per prim, in order: its first vertex and its vertex count. */
  ranges: { start: number; count: number }[];
}

/** Can this prim be drawn as a swept tube? Not a box, a strand or a shell, and not oriented (an organ source's prims
 *  never are: contract.ts strips orient). */
export function organTubeable(p: Primitive): boolean {
  if (p.box || p.strand || p.shell) return false;
  const o = p.orient;
  return !o || Math.abs(1 - o[3]) <= 1e-6;
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** A unit vector across `t`, steady (the bone tube's rule, bone-tube-geom.ts frame). */
const acrossOf = (t: Vec3): Vec3 => normalize(cross(Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t));

/**
 * The swept-tube mesh of `prims` (segment-local, as an organ source holds them), or null when one of them cannot be
 * swept. Per prim: (segments + 1) rings of `around` vertices, and on each end `capLats` rings and a pole.
 */
export function sweepOrganTubes(prims: readonly Primitive[], spec: OrganTubeSpec): OrganTubeMesh | null {
  if (prims.length === 0 || !prims.every(organTubeable)) return null;
  const M = Math.max(3, Math.floor(spec.around));
  const capLats = Math.max(0, Math.floor(spec.capLats));
  const P: number[] = [], Nn: number[] = [], Tu: number[] = [], index: number[] = [];
  const ranges: { start: number; count: number }[] = [];
  const mid = (p: Primitive): Vec3 => vscale(add(p.a, p.b), 0.5);

  prims.forEach((prim, k) => {
    const start = P.length / 3;
    const sc = prim.scale, inv: Vec3 = [1 / sc[0], 1 / sc[1], 1 / sc[2]];
    const div = (v: Vec3): Vec3 => [v[0] * inv[0], v[1] * inv[1], v[2] * inv[2]];
    // The scale-divided frame sdPrimitive measures in: the sweep is built there and multiplied back.
    const A = div(prim.a), B = div(prim.b);
    const r1 = prim.radius, r2 = prim.radiusB ?? prim.radius;
    const chord = sub(B, A), chordLen = len(chord);
    // sdBentCone's own degenerate rules: a control point on the chord, or coincident ends, is the straight round cone.
    const C = prim.bend === undefined ? null : div(bendCtrl(prim.a, prim.b, prim.bend));
    const e2: Vec3 = C ? [A[0] - 2 * C[0] + B[0], A[1] - 2 * C[1] + B[1], A[2] - 2 * C[2] + B[2]] : [0, 0, 0];
    const bent = C !== null && dot(e2, e2) >= 1e-12 && chordLen * chordLen >= 1e-12;
    const e1: Vec3 = bent ? vscale(sub(C!, A), 2) : chord;
    const sphere = !bent && chordLen < 1e-9;

    const at = (t: number): Vec3 => bent
      ? [A[0] + e1[0] * t + e2[0] * t * t, A[1] + e1[1] * t + e2[1] * t * t, A[2] + e1[2] * t + e2[2] * t * t]
      : lerp3(A, B, t);
    const vel = (t: number): Vec3 => bent ? [e1[0] + 2 * e2[0] * t, e1[1] + 2 * e2[1] * t, e1[2] + 2 * e2[2] * t] : e1;

    // The axis direction of a sphere is free: toward the nearest other prim, so its rings lie along the crease
    // between it and its neighbour (a row of blobs reads as one segmented loop).
    let pole: Vec3 = [1, 0, 0];
    if (sphere) {
      let best = Infinity;
      prims.forEach((o, j) => {
        if (j === k) return;
        const d = sub(mid(o), mid(prim)), l = len(d);
        if (l > 1e-6 && l < best) { best = l; pole = vscale(d, 1 / l); }
      });
    }
    const tanAt = (t: number): Vec3 => sphere ? pole : normalize(vel(t));

    // A quadratic Bezier is planar: one binormal for the whole curve, so the rings never twist along it.
    let bn: Vec3 | null = null;
    if (bent) {
      const c = cross(vel(0), vel(1));
      if (len(c) > 1e-9) bn = normalize(c);
    }
    const frameAt = (T: Vec3): { n: Vec3; b: Vec3 } => {
      if (bn) return { n: cross(bn, T), b: bn };
      const n = acrossOf(T);
      return { n, b: cross(T, n) };
    };

    const turn = bent ? Math.acos(Math.max(-1, Math.min(1, dot(normalize(vel(0)), normalize(vel(1)))))) : 0;
    const segs = sphere ? 0 : Math.max(1, Math.min(Math.max(1, Math.floor(spec.alongMax)), Math.ceil(turn / Math.max(spec.turnStep, 1e-3) - 1e-9)));
    // Arc length to each ring (the canonical x), by the midpoint rule on the speed.
    const arc: number[] = [0];
    for (let i = 0; i < segs; i++) {
      let s = 0;
      const SUB = 16;
      for (let q = 0; q < SUB; q++) s += len(vel((i + (q + 0.5) / SUB) / segs)) / (SUB * segs);
      arc.push(arc[i]! + s);
    }
    const x0 = k * ORGAN_TUBE_STRIDE;

    /** One vertex: `centre` + r * (along * T + across * (cos th * n + sin th * b)); canonical x = `cx` + r * along. */
    const emit = (centre: Vec3, T: Vec3, f: { n: Vec3; b: Vec3 }, r: number, along: number, across: number, th: number, cx: number): number => {
      const c = Math.cos(th), s = Math.sin(th);
      const dir: Vec3 = [
        along * T[0] + across * (c * f.n[0] + s * f.b[0]),
        along * T[1] + across * (c * f.n[1] + s * f.b[1]),
        along * T[2] + across * (c * f.n[2] + s * f.b[2]),
      ];
      const p = add(centre, vscale(dir, r));
      // Back out of the scale-divided frame: points by the scale, normals by its inverse.
      P.push(p[0] * sc[0], p[1] * sc[1], p[2] * sc[2]);
      const nn = normalize([dir[0] * inv[0], dir[1] * inv[1], dir[2] * inv[2]]);
      Nn.push(nn[0], nn[1], nn[2]);
      Tu.push(x0 + cx + r * along, r * across * c, r * across * s, 1);
      return P.length / 3 - 1;
    };
    const ringOf = (centre: Vec3, T: Vec3, r: number, along: number, cx: number): number[] => {
      const f = frameAt(T), across = Math.sqrt(Math.max(1 - along * along, 0));
      const ring: number[] = [];
      for (let j = 0; j < M; j++) ring.push(emit(centre, T, f, r, along, across, (j / M) * Math.PI * 2, cx));
      return ring;
    };
    /** A band of quads between two rings; `fwd`: `to` is further along +T than `from` (the outward winding). */
    const band = (from: number[], to: number[], fwd: boolean) => {
      for (let j = 0; j < M; j++) {
        const a = from[j]!, b = from[(j + 1) % M]!, c = to[j]!, d = to[(j + 1) % M]!;
        if (fwd) index.push(a, b, c, b, d, c); else index.push(a, c, b, b, c, d);
      }
    };
    const fan = (ring: number[], pole: number, fwd: boolean) => {
      for (let j = 0; j < M; j++) {
        const a = ring[j]!, b = ring[(j + 1) % M]!;
        if (fwd) index.push(a, b, pole); else index.push(a, pole, b);
      }
    };

    // THE BODY: the envelope of the swept spheres. Where the radius changes along the axis the ring sits off its
    // centre by -rho * r along the tangent and narrows to sqrt(1 - rho^2) * r, rho = (dr/dt) / |C'(t)|.
    const rhoAt = (t: number): number => sphere ? 0 : Math.max(-0.999, Math.min(0.999, (r2 - r1) / Math.max(len(vel(t)), 1e-9)));
    const rings: number[][] = [];
    for (let i = 0; i <= segs; i++) {
      const t = segs === 0 ? 0 : i / segs;
      rings.push(ringOf(at(t), tanAt(t), r1 + (r2 - r1) * t, -rhoAt(t), arc[i]!));
    }
    for (let i = 0; i < segs; i++) band(rings[i]!, rings[i + 1]!, true);

    // THE CAPS: the end spheres, from the body's last ring to the pole. end 0 runs back along -T, end 1 on along +T.
    for (const end of [0, 1] as const) {
      const t = end, T = tanAt(t), centre = at(t), r = end === 0 ? r1 : r2, cx = end === 0 ? 0 : arc[segs]!;
      const sgn = end === 0 ? -1 : 1;
      // The latitude the body's ring sits at on this sphere (0 on an untapered tube), then up to the pole.
      const lat0 = Math.asin(-sgn * rhoAt(t));
      let prev = rings[end === 0 ? 0 : segs]!;
      for (let q = 1; q <= capLats; q++) {
        const lat = lat0 + (Math.PI / 2 - lat0) * (q / (capLats + 1));
        const ring = ringOf(centre, T, r, sgn * Math.sin(lat), cx);
        band(prev, ring, end === 1);
        prev = ring;
      }
      fan(prev, emit(centre, T, frameAt(T), r, sgn, 0, 0, cx), end === 1);
    }
    ranges.push({ start, count: P.length / 3 - start });
  });

  // THE CREASE SHADE: how near each vertex is to another prim's surface (a vertex inside one is hidden anyway: 0).
  if (prims.length > 1) {
    ranges.forEach((range, k) => {
      for (let v = range.start; v < range.start + range.count; v++) {
        const p: Vec3 = [P[v * 3]!, P[v * 3 + 1]!, P[v * 3 + 2]!];
        let d = Infinity;
        for (let j = 0; j < prims.length; j++) if (j !== k) d = Math.min(d, sdPrimitive(p, prims[j]!));
        Tu[v * 4 + 3] = Math.max(0, Math.min(1, d / ORGAN_CREASE_REACH));
      }
    });
  }
  return { positions: new Float32Array(P), normals: new Float32Array(Nn), tube: new Float32Array(Tu), index, ranges };
}
