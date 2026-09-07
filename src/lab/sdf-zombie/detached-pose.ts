import type { BuildResult } from './build-body';
import type { ChunkGroup } from './sever';
import type { Primitive, Vec3 } from './types';
import { add, len, normalize, qRotate, scale, sub } from './vec';
import { segmentQuat } from './rig-frames';
import { applyRigidYaw, fitRestToPose } from './webgpu/game-weapon';

/** Place a sever result against the last visible pose, before replacing the body. */
export function posedDetachedChunk(rest: BuildResult, posed: BuildResult, chunk: ChunkGroup, yaw = 0, legacyYaw = false): ChunkGroup {
  const indices = chunk.sourceIndices ?? chunk.prims.map(p => rest.prims.indexOf(p));
  const restPts: Vec3[] = [], posedPts: Vec3[] = [];
  for (const [n, i] of indices.entries()) {
    const p = chunk.prims[n]!, q = posed.prims[i];
    if (!q) continue;
    restPts.push(p.a, p.b); posedPts.push(q.a, q.b);
  }
  const fit = fitRestToPose(restPts, posedPts);
  const fallback = (p: Vec3) => applyRigidYaw(fit, p);
  if (legacyYaw) return {
    ...chunk, origin: fallback(chunk.origin), tornAt: chunk.tornAt.map(fallback),
    prims: chunk.prims.map(p => ({ ...p, a: fallback(p.a), b: fallback(p.b) })),
    bones: chunk.bones.map(p => ({ ...p, a: fallback(p.a), b: fallback(p.b) })),
  };
  // Flesh takes the exact visible endpoints, including raised arms. Partial
  // bone pieces use their source segment's full 3D transform, not a body yaw.
  const prims = chunk.prims.map((p, n) => {
    const visible = posed.prims[indices[n]!];
    return visible ? { ...visible, dead: false } : { ...p, a: fallback(p.a), b: fallback(p.b) };
  });
  const onSegment = (point: Vec3, source: Primitive, visible: Primitive): Vec3 => {
    const q = visible.orient ?? segmentQuat(normalize(sub(source.b, source.a)), normalize(sub(visible.b, visible.a)), yaw);
    return add(visible.a, qRotate(q, sub(point, source.a)));
  };
  const bones = chunk.bones.map((p, n) => {
    const i = chunk.sourceBoneIndices?.[n] ?? rest.bonePrims.indexOf(p);
    const source = rest.bonePrims[i], visible = posed.bonePrims[i];
    return source && visible
      ? { ...p, a: onSegment(p.a, source, visible), b: onSegment(p.b, source, visible),
        ...(visible.orient ? { orient: visible.orient } : {}) }
      : { ...p, a: fallback(p.a), b: fallback(p.b) };
  });
  const tornAt = chunk.tornAt.map(point => {
    let best = Infinity, selected = -1;
    for (const i of indices) {
      const p = rest.prims[i];
      if (!p) continue;
      const d = Math.min(len(sub(point, p.a)), len(sub(point, p.b)));
      if (d < best) { best = d; selected = i; }
    }
    return selected >= 0 ? onSegment(point, rest.prims[selected]!, posed.prims[selected]!) : fallback(point);
  });
  const origin = prims.length
    ? scale(prims.reduce((sum, p) => add(sum, add(p.a, p.b)), [0, 0, 0] as Vec3), 1 / (prims.length * 2))
    : fallback(chunk.origin);
  return { ...chunk, prims, bones, tornAt, origin };
}
