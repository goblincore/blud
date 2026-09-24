// src/lab/sdf-zombie/translate.ts
import type { BuildResult } from './build-body';
import type { Vec3 } from './types';

/**
 * A copy of `body` with every primitive endpoint, cluster centre AND BONE
 * joint shifted.
 *
 * This is how a raymarched body MOVES. The shader marches in world space and
 * the packed primitives ARE the field, so setting mesh.position shifts only the
 * proxy BOX — the flesh stays put and the displaced box then clips it into
 * slices. Shared by both renderer paths so the mistake is only possible once.
 *
 * BONES TOO (game-page displacement bug): bindRig derives its rig points,
 * constraints, rest pose and per-endpoint offsets from body.bones. A body
 * translated with bones left behind rigged itself near the ORIGIN while its
 * flesh sat in the room — every endpoint offset carried a spawn-sized delta,
 * so the moment motion pulled the rig toward world targets the posed body
 * rendered at ~2× its spawn (and the rigid-head path, which uses pivot-relative
 * offsets, landed heads NEAR the right spot while bodies did not: the floating
 * detached heads). Only ever harmless for bodies that are never rigged —
 * static crowd/bench/spike instances. Translating bones keeps every consumer
 * self-consistent.
 */
export function translateBody(body: BuildResult, offset: Vec3): BuildResult {
  const sh = (v: Vec3): Vec3 => [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]];
  return {
    ...body,
    // SHELL CLIP PLANES TOO (cultist, 2026-09-24). A shell's plane is an
    // absolute half-space, dot(p, n) < clipOffset, so moving the sheet by
    // `offset` moves the plane's offset by dot(n, offset). Left behind, every
    // garment in the GAME was cut by a plane still at the origin — the
    // cultist's hood rendered CLOSED over his face (the lab never translates
    // its body, so it never showed there), and the schoolgirl's collar was
    // cut in the wrong place in any room but the one at the origin.
    prims: body.prims.map(p => ({ ...p, a: sh(p.a), b: sh(p.b),
      ...(p.shell ? { shell: { ...p.shell, clipOffset: p.shell.clipOffset
        + p.shell.clipNormal[0] * offset[0] + p.shell.clipNormal[1] * offset[1] + p.shell.clipNormal[2] * offset[2] } } : {}) })),
    clusters: body.clusters.map(c => ({ ...c, center: sh(c.center) })),
    bones: new Map([...body.bones].map(([k, b]) => [k, { ...b, head: sh(b.head), tail: sh(b.tail) }])),
    // BONE PRIMS TOO (wound pass r2): they ride the rig like flesh, so leaving
    // them at rest space would re-create the origin-space bind bug above the
    // moment a translated body is rigged — bones floating at spawn while the
    // flesh moved. bend is midpoint-relative and follows untouched.
    bonePrims: body.bonePrims.map(p => ({ ...p, a: sh(p.a), b: sh(p.b) })),
  };
}
