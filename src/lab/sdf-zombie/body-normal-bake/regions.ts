// src/lab/sdf-zombie/body-normal-bake/regions.ts
//
// The bodies a body-normal bake marches, its REGIONS, and the per-row prim cull. Spec:
// docs/superpowers/specs/2026-10-21-body-normal-map-design.md.
//
// WHAT IT BAKES. Two versions of the body in its REST pose: the body the game marches, and the same body with the
// .detail lines folded in (muscle separations, veins, swellings: detail that would cost a prim per pixel to march
// but is only ever seen as shading).
//
// REGIONS. Each region is a cylinder round a REST-space segment head -> tail, baked into its own band of rows:
//   - region 0, the TORSO: a vertical segment through the torso's mean x/z from the top of its prims (head) to
//     the bottom (tail); only the torso cluster is marched, and at runtime only torso-prim hits take it.
//     `torsoAxis` replaces the vertical segment for a body whose torso is NOT upright (the gorehound, a
//     quadruped: its torso lies along z, and a vertical cylinder sees the whole back as one polar cap). Keep the
//     axis a few degrees off exactly +-z: the frame's f is rest +z made perpendicular to the axis (frame.ts and
//     body-normal.wgsl.ts), which is undefined on an axis parallel to z;
//   - an EXTRA TORSO region per `label:hx,hy,hz:tx,ty,tz:rMax:rows` (torso prims only, bounded by rMax: the gamer's
//     joystick and forearms, torso flesh the main cylinder cannot see);
//   - a LIMB region per `bone:t0:t1:rMax:rows`: the bone's segment from t0 to t1, its own limb cluster only, taken
//     at runtime by non-torso hits whose rest point lies along the segment within rMax of it.
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { add, dot, mul, norm, sub, type V } from './frame';

export type Body = ReturnType<typeof buildBody>;
type Prim = Body['prims'][number];

/** Fold the detail lines into the .blob's `body` block (at its end, before the next top-level block). */
export function withDetail(src: string, detail: string, name: string): string {
  const lines = src.split('\n');
  const start = lines.findIndex(l => /^body\s*$/.test(l));
  if (start < 0) throw new Error(`${name}.blob has no body block`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^\S/.test(lines[i]!) && !lines[i]!.startsWith('#')) { end = i; break; }
  const extra = detail.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  return [...lines.slice(0, end), ...extra, ...lines.slice(end)].join('\n');
}

export function buildFromBlob(src: string): Body { const doc = parseBlob(src); return buildBody(compileBlob(doc, compileFace(doc))); }

/** The plain body and the detailed body, both at rest. */
export function bakeBodies(blobSrc: string, detailSrc: string, name: string): { base: Body; detail: Body } {
  return { base: buildFromBlob(blobSrc), detail: buildFromBlob(withDetail(blobSrc, detailSrc, name)) };
}

export interface Region { label: string; limb: string; head: V; tail: V; rMax: number; rows: number; kind: 0 | 1; r0: number; row0: number }

export interface RegionArgs {
  /** Rows of region 0. */
  torsoRows: number;
  /** `hx,hy,hz:tx,ty,tz`, replacing region 0's vertical axis. */
  torsoAxis?: string | null;
  /** `bone:t0:t1:rMax:rows` each. */
  limbs?: string[];
  /** `label:hx,hy,hz:tx,ty,tz:rMax:rows` each. */
  torsoSegs?: string[];
}

/** The regions, in band order, with row0 assigned (row 0 is the header). Throws on a bad argument. */
export function buildRegions(base: Body, args: RegionArgs): { regions: Region[]; height: number } {
  const H = args.torsoRows;
  const bones = base.bones as unknown as Map<string, { head: V; tail: V }>;
  const regions: Region[] = [];
  // Region 0: the torso, a vertical axis through it, the band its prims span.
  {
    const torso = base.prims.filter(p => p.limb === 'torso' && p.op !== 'sub' && p.op !== 'groove');
    let yMin = Infinity, yMax = -Infinity, zSum = 0, xSum = 0;
    for (const p of torso) {
      const ry = p.radius * p.scale[1];
      yMin = Math.min(yMin, p.a[1] - ry, p.b[1] - ry);
      yMax = Math.max(yMax, p.a[1] + ry, p.b[1] + ry);
      zSum += (p.a[2] + p.b[2]) / 2; xSum += (p.a[0] + p.b[0]) / 2;
    }
    const ax = xSum / torso.length, az = zSum / torso.length;
    if (args.torsoAxis) {
      const [h, t] = args.torsoAxis.split(':').map(v => v.split(',').map(Number) as V);
      const A = norm(sub(t!, h!));
      if (Math.abs(A[2]) > 0.9995) throw new Error('--torso-axis: tilt it off +-z (the frame needs rest +z off the axis)');
      regions.push({ label: 'torso', limb: 'torso', head: h!, tail: t!, rMax: 0, rows: H, kind: 0, r0: 0.6, row0: 0 });
    } else {
      regions.push({ label: 'torso', limb: 'torso', head: [ax, yMax, az], tail: [ax, yMin, az], rMax: 0, rows: H, kind: 0, r0: 0.6, row0: 0 });
    }
  }
  for (const arg of args.limbs ?? []) {
    const [bone, t0, t1, rMax, rows] = arg.split(':');
    const b = bones.get(bone!);
    if (!b) throw new Error(`--limb ${arg}: no bone ${bone}`);
    const limb = base.prims.find(p => p.bone === bone)?.limb;
    if (!limb) throw new Error(`--limb ${arg}: no prims on ${bone}`);
    const d = sub(b.tail, b.head);
    regions.push({ label: bone!, limb, head: add(b.head, mul(d, Number(t0))), tail: add(b.head, mul(d, Number(t1))), rMax: Number(rMax), rows: Number(rows), kind: 1, r0: Number(rMax) * 1.5, row0: 0 });
  }
  // EXTRA TORSO REGIONS (rest metres), torso prims only, taken at runtime by torso hits within rMax of the segment
  // (nearest axis wins; region 0 has rMax 0 and takes the rest). For torso flesh the one cylinder round the torso
  // cannot see: a prop standing clear of it, or arms across it.
  for (const arg of args.torsoSegs ?? []) {
    const [label, h, t, rMax, rows] = arg.split(':');
    const [hv, tv] = [h, t].map(v => v!.split(',').map(Number) as V);
    regions.push({ label: label!, limb: 'torso', head: hv!, tail: tv!, rMax: Number(rMax), rows: Number(rows), kind: 0, r0: Number(rMax) * 1.5, row0: 0 });
  }
  let nextRow = 1;   // row 0 is the header
  for (const r of regions) { r.row0 = nextRow; nextRow += r.rows; }
  return { regions, height: nextRow };
}

/** A body of only the prims of `limb` that can reach the ray disc at P (radius r0): one row's march is much cheaper. */
export function nearBody(body: Body, limb: string, P: V, r0: number): Body {
  const keep: Prim[] = [];
  for (const c of body.clusters) {
    if (c.limb !== limb) continue;
    for (const p of body.prims.slice(c.start, c.start + c.count)) {
      const ab = sub(p.b, p.a), L2 = dot(ab, ab);
      const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(P, p.a), ab) / L2)) : 0;
      const q = add(p.a, mul(ab, t));
      const reach = Math.max(p.radius, p.radiusB ?? 0) * Math.max(...p.scale) + (p.blendK ?? 0) * 4 + 0.03;
      if (Math.hypot(...sub(P, q)) - reach < r0) keep.push(p);
    }
  }
  return { ...body, split: undefined, prims: keep, clusters: [{ ...body.clusters[0]!, limb, start: 0, count: keep.length, alive: true }] } as Body;
}
