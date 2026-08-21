// src/lab/sdf-zombie/blob-compile.ts
import { type BlobDoc, BlobError } from './blob-ast';
import type { BodyDef, BoneDef, PrimDef, Vec3 } from './types';
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';

/**
 * The only valid `.blob` face parameter names — every key of `FaceParams`,
 * read off `DEFAULT_FACE` rather than duplicated by hand so the two can never
 * drift apart.
 */
const FACE_KEYS = Object.keys(DEFAULT_FACE) as (keyof FaceParams)[];
const FACE_KEY_SET = new Set<string>(FACE_KEYS);

const RAD = Math.PI / 180;

/**
 * Angles → a direction vector, the ergonomic win borrowed from WAM.
 *
 * Both angles are AUTHOR-FACING conventions, and neither depends on which
 * base direction they're applied to: positive `pitch` always tips the
 * direction toward +z, and positive `tilt` always swings it toward +x. An
 * author writing `pitch=5` means "tip it forward" whether that's a spine
 * pointing `up` or a forearm pointing `down` — so the zombie's 7-degree
 * forward hunch is a number you can reason about instead of the opaque
 * `[0, 1, 0.12]`, and the SAME number means the same thing lower down the
 * skeleton.
 *
 * Magnitude is irrelevant: resolveBones normalises `dir` (resolve.ts:26), so
 * only the direction has to be right.
 */
export function dirVector(
  dir: 'up' | 'down' | 'side' | 'fwd', pitchDeg: number, tiltDeg: number,
): Vec3 {
  const base: Record<'up' | 'down' | 'side' | 'fwd', Vec3> = {
    up: [0, 1, 0], down: [0, -1, 0], side: [1, 0, 0], fwd: [0, 0, 1],
  };
  const [x0, y0, z0] = base[dir];

  // Pitch: y toward z, tipping toward +z regardless of the sign of y0.
  //
  // A plain rotation about X — y1 = y0 cos p - z0 sin p, z1 = y0 sin p + z0
  // cos p — carries `up` (y0 = +1) toward +z but `down` (y0 = -1) toward -z,
  // because the rotation's direction is fixed in world space while the base
  // it's rotating away from is not. That is the bug this function used to
  // have: `pitch=5` tipped a spine forward and a forearm backward.
  //
  // Scaling the rotation angle by sign(y0) — equivalently, always rotating
  // the same way RELATIVE TO the base's own vertical direction rather than
  // relative to world +y — cancels that dependency. Expanded out, the
  // y0-toward-z contribution becomes `|y0| * sin(p)`: positive for both `up`
  // and `down`. `side` has y0 = 0, so `sign(y0) = 0` and pitch is correctly a
  // no-op there — there is no vertical component for it to act on.
  const p = pitchDeg * RAD;
  const ySign = Math.sign(y0);
  const y1 = y0 * Math.cos(p) - ySign * z0 * Math.sin(p);
  const z1 = Math.abs(y0) * Math.sin(p) + z0 * Math.cos(p);

  // Tilt about Z: y toward x. Negated so a positive tilt on `down` swings +x.
  const t = tiltDeg * RAD;
  const x2 = x0 * Math.cos(t) - y1 * Math.sin(t);
  const y2 = x0 * Math.sin(t) + y1 * Math.cos(t);

  return [x2, y2, z1];
}

/**
 * Merges a `.blob` face block over the tuned defaults.
 *
 * Validates every key against `FaceParams` rather than trusting the blanket
 * spread that used to sit here. `doc.face` is a `Record<string, number>` —
 * `blob-parse.ts` never checks the parameter NAME, only that its value is a
 * number — so a typo (`headRadus` for `headRadius`) used to be silently
 * accepted: the bad key rode along as an inert extra property while
 * `headRadius` quietly kept `DEFAULT_FACE`'s default, with no error anywhere.
 * That is exactly the silent-shadowing class already fixed several times in
 * `blob-parse.ts`, and it bites hardest here: Task 5 hand-types all 14 face
 * parameter names into `zombie.blob`, where a typo would produce a subtly
 * wrong face with nothing to catch it.
 */
export function compileFace(doc: BlobDoc): FaceParams {
  const face: FaceParams = { ...DEFAULT_FACE };
  for (const [key, value] of Object.entries(doc.face ?? {})) {
    if (!FACE_KEY_SET.has(key)) {
      // Every entry in `doc.face` was written by `parseFaceLine`, which
      // pushes the SAME line into `faceTrivia` with that key as `words[0]`
      // (blob-parse.ts) — so this lookup always finds a real line. The `!`
      // records that invariant rather than inventing a fake location on a
      // lookup miss. `doc.face` is last-write-wins on a repeated key, but
      // `.find()` reports the FIRST line with that key — a key typo'd twice
      // points at the earlier occurrence. Low-stakes: it's the same bad key
      // text either way, just not always the exact line that "won".
      const line = doc.faceTrivia.find(l => l.words[0] === key)!;
      throw new BlobError(
        `unknown face parameter "${key}" — expected one of ${FACE_KEYS.join(', ')}`,
        line.line, line.indent + 1,
      );
    }
    face[key as keyof FaceParams] = value;
  }
  return face;
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
