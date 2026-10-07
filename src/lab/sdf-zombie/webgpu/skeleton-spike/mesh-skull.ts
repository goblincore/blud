import type { BoneFieldSource, Point3 } from './contract';
import { sculptSkull2, skull2JawOf } from './mesh-skull-2';
import type { SculptShape } from './sculpt-variant';

/** Mesh art revision is independent of the shared anatomy/volume contract. */
export const MESH_SKULL_REVISION = 'skull-sculpt-1';
export const SOLDIER_MESH_SKULL_REVISION = 'soldier-skull-sculpt-1';
/** The second sculpt's revisions (mesh-skull-2.ts), per character as the first's are. */
export const MESH_SKULL_2_REVISION = 'skull-sculpt-2';
export const SOLDIER_MESH_SKULL_2_REVISION = 'soldier-skull-sculpt-2';

/** Subtractive sculpt: every surviving point is inside the authored bone.
 * Coordinates are head-rigid AABB coordinates, +z forward. Finite-depth
 * recesses preserve a closed dark floor and the rear cranium; flat jaw planes
 * cut the round chin into a narrow mandible with distinct gonial corners.
 * Never pass this adapter to procedural or volume renderers.
 * `shape` 2 is the second sculpt (mesh-skull-2.ts: the same bone and frame, carved toward a human skull); omitted,
 * the first, as ever. */
export function meshBoneSource(source: BoneFieldSource, shape: SculptShape = 1): BoneFieldSource {
  const zombie = source.character === 'zombie', soldier = source.character === 'soldier';
  const revision = shape === 2
    ? (zombie ? MESH_SKULL_2_REVISION : soldier ? SOLDIER_MESH_SKULL_2_REVISION : null)
    : (zombie ? MESH_SKULL_REVISION : soldier ? SOLDIER_MESH_SKULL_REVISION : null);
  if (!revision || source.segment !== 'head' || source.revision.endsWith(`:${revision}`)) return source;
  if (shape === 2) return sculptSkull2(source, revision, skull2JawOf(source.character)!);
  const { min, max } = source.bounds;
  const half = max.map((v, i) => (v - min[i]!) * 0.5);
  const scale = Math.min(...half);
  const ellipsoid = (q: number[], x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
    (Math.hypot((q[0]! - x) / rx, (q[1]! - y) / ry, (q[2]! - z) / rz) - 1) * Math.min(rx, ry, rz) * scale;
  return {
    ...source,
    revision: `${source.revision}:${revision}`,
    distance(p: Point3): number {
      const q = p.map((v, i) => (v - min[i]!) / half[i]! - 1);
      const [x, y, z] = q as [number, number, number];
      let d = source.distance(p);
      // A flat chin and diagonal sides, blended into the untouched upper head.
      d = Math.max(d, (-0.83 - y) * half[1]!);
      const jawWidth = 0.30 + Math.max(0, y + 0.83) * 0.95;
      d = Math.max(d, (Math.abs(x) - jawWidth) * scale);
      // Flatten the projecting chin below the lower dental ledge.
      d = Math.max(d, -Math.max(y + 0.53, 0.70 - z) * scale);
      // Deep sockets under an inward-sloping brow, with retained orbital rim.
      for (const side of [-1, 1]) {
        d = Math.max(d, -ellipsoid(q, side * 0.36, 0.22, 0.85, 0.27, 0.23, 0.52));
        d = Math.max(d, -ellipsoid(q, side * 0.55, -0.19, 0.68, 0.23, 0.22, 0.55));
      }
      // Narrow triangular nasal aperture; a broad low nose would merge the eyes.
      const noseWidth = 0.12 - (y + 0.10) * 0.24;
      const nose = Math.max(Math.abs(x) - noseWidth, Math.abs(y + 0.06) - 0.19, 0.30 - z);
      d = Math.max(d, -nose * scale);
      // Raised bite plane; dental crowns are painted on the two actual ledges,
      // with a deep mouth slit between them rather than teeth on a round chin.
      const mouth = Math.max(Math.abs(x) - 0.49, Math.abs(y + 0.38) - 0.038, 0.25 - z);
      d = Math.max(d, -mouth * scale);
      return d;
    },
  };
}
