// src/lab/sdf-zombie/blob-compile.ts
import type { BlobDoc } from './blob-ast';
import type { BodyDef, BoneDef, PrimDef, Vec3 } from './types';
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';

const RAD = Math.PI / 180;

/**
 * Angles → a direction vector, the ergonomic win borrowed from WAM.
 *
 * `pitch` rotates about world X, carrying `up` toward +z — so the zombie's
 * 7-degree forward hunch is a number you can reason about instead of the
 * opaque `[0, 1, 0.12]`. `tilt` rotates about world Z, carrying `down` toward
 * +x, which is how an arm hangs away from the body.
 *
 * Magnitude is irrelevant: resolveBones normalises `dir` (resolve.ts:26), so
 * only the direction has to be right.
 */
export function dirVector(
  dir: 'up' | 'down' | 'side' | 'fwd', pitchDeg: number, tiltDeg: number,
): Vec3 {
  const base: Record<string, Vec3> = {
    up: [0, 1, 0], down: [0, -1, 0], side: [1, 0, 0], fwd: [0, 0, 1],
  };
  const [x0, y0, z0] = base[dir]!;

  // Pitch about X: y toward z.
  const p = pitchDeg * RAD;
  const y1 = y0 * Math.cos(p) - z0 * Math.sin(p);
  const z1 = y0 * Math.sin(p) + z0 * Math.cos(p);

  // Tilt about Z: y toward x. Negated so a positive tilt on `down` swings +x.
  const t = tiltDeg * RAD;
  const x2 = x0 * Math.cos(t) - y1 * Math.sin(t);
  const y2 = x0 * Math.sin(t) + y1 * Math.cos(t);

  return [x2, y2, z1];
}

/** Merges a `.blob` face block over the tuned defaults. */
export function compileFace(doc: BlobDoc): FaceParams {
  return { ...DEFAULT_FACE, ...(doc.face ?? {}) } as FaceParams;
}

export function compileBlob(doc: BlobDoc, face = compileFace(doc)): BodyDef {
  const bones: BoneDef[] = [
    { name: doc.rootBone, parent: null, dir: [0, 1, 0], length: 0.14 },
    ...doc.bones.map(b => ({
      name: b.name,
      parent: b.parent,
      dir: dirVector(b.dir, b.pitchDeg, b.tiltDeg),
      length: b.len,
      side: b.side,
      mirror: b.mirror,
    } satisfies BoneDef)),
  ];

  const prims: PrimDef[] = doc.parts.map(p => ({
    bone: p.bone,
    at: p.at,
    ...(p.to === null ? {} : { capTo: p.to }),
    radius: p.radius,
    scale: [p.wide, p.tall, p.deep] as Vec3,
    blendK: p.hard ? 0 : p.blend,
    limb: p.limb,
    ...(p.mirror ? { mirror: true } : {}),
    ...(p.kind === 'carve' ? { op: 'sub' as const } : {}),
    ...(p.both ? { mirrorOffset: true } : {}),
    ...(p.offset ? { offset: p.offset as Vec3 } : {}),
  }));

  return {
    name: doc.name,
    root: [0, doc.rootHeight, 0],
    bones,
    prims: [...prims, ...facePrims(face)],
  };
}
