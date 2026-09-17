// src/lab/sdf-zombie/webgpu/gib-asset-head.ts
//
// THE MOVING ASSET HEAD'S FACE FRAME (2026-09-16 offline-gib-assets task 4).
//
// Task 3 excluded the face-carrying head from the mesh path (`'head-face'`)
// because the face layer projects from `headCentre`/`headQuat`/`headAxes` — the
// SAME uniforms the marched chunk path re-uploads from its POSED primitives
// every frame, but which the shared asset material had no way to move. So an
// asset head would have drawn as bare flesh. This module is the missing half:
//
//   * the world-space frame a face projection needs, computed from the chunk
//     state EXACTLY as `ChunkGpuView.apply` computes it for a marched piece
//     (`chunkPoint` + `qMul(c.quat, restQuat)` + per-world-axis squash), so the
//     asset head and a marched head agree to the float;
//   * a small REGISTRY that owns one per-instance face material per head spawn.
//     "No shared mutable face uniforms across actors" is a property of the
//     data structure, not a promise: every `acquire` builds a NEW handle, and
//     the handle's `dispose` is idempotent so a reset racing a piece eviction
//     cannot double-free.
//
// WHY A PER-INSTANCE MATERIAL AND NOT A SHARED ONE. The face uniforms are
// world-space and each head is at a different place at a different angle, so one
// material with one uniform set can only ever be right for one actor. The
// settled-head bake already accepts the same cost (`finishChunkBake` builds a
// face material per retained head); this makes it explicit and returns it to a
// registry so it is finite and disposable.
//
// NO THREE, NO DOM. The registry is generic over a `GibAssetHeadMaterial`
// handle, so its ownership/lifecycle is testable with a fake and the renderer
// supplies the real `createBakedChunkMaterial` handle.
import { qMul, type Quat } from '../vec';
import type { Vec3 } from '../types';
import { chunkPoint, squashFactors, type Chunk } from '../gib-chunks';

/** The head frame relative to the chunk pivot (piece-local, already deformed
 *  by the pose/slough at spawn). `quat`/`axes` are the REST head frame that
 *  rides the chunk's own rotation and squash. */
export interface GibAssetHeadLocal {
  centre: Vec3;
  quat: Quat;
  axes: Vec3;
}

/** The world-space frame `FACE_LAYER` projects from. */
export interface GibAssetHeadFrame {
  centre: Vec3;
  quat: Quat;
  axes: Vec3;
}

/**
 * World head frame for a chunk at `state`. Mirrors `ChunkGpuView.apply`'s
 * face block line for line: the centre follows `chunkPoint` (rotate, squash in
 * world axes, translate), the quaternion is the chunk's own composed with the
 * rest head rotation, and the semi-axes take the SAME world-axis squash. That
 * is what keeps the projection welded to the skull as the piece tumbles.
 */
export function gibAssetHeadFrame(state: Chunk, local: GibAssetHeadLocal): GibAssetHeadFrame {
  const { sx, sy, sz } = squashFactors(state);
  return {
    centre: chunkPoint(state, local.centre, sx, sy, sz),
    quat: qMul(state.quat, local.quat),
    axes: [local.axes[0] * sx, local.axes[1] * sy, local.axes[2] * sz],
  };
}

/** The renderer-side handle a head instance owns. `material` is opaque to this
 *  module so the registry stays three-free. */
export interface GibAssetHeadMaterial {
  readonly material: unknown;
  setFrame(frame: GibAssetHeadFrame): void;
  dispose(): void;
}

/** Builds ONE NEW per-instance face material. `source` is the live actor's
 *  face uniform set (or any renderer-specific payload); the registry never
 *  inspects it. */
export interface GibAssetHeadFactory {
  create(source: unknown): GibAssetHeadMaterial;
}

export interface GibAssetHeadResource {
  readonly part: string;
  readonly local: GibAssetHeadLocal;
  readonly material: unknown;
  /** Re-project the face from the chunk's current transform. */
  setFrameFromState(state: Chunk): void;
  /** Idempotent: returns the material and removes it from the registry. */
  release(): void;
}

export interface GibAssetHeadCounters {
  live: number;
  created: number;
  disposed: number;
}

/**
 * Owns every live head face material. A `null` factory (the default) means the
 * mesh path cannot carry a face: `acquire` returns null and the caller keeps the
 * marched `'head-face'` fallback. There is no shared mutable state between
 * resources — that is the whole reason this exists as a registry rather than a
 * single material.
 */
export class GibAssetHeadRegistry {
  private readonly live = new Set<GibAssetHeadResource>();
  private created = 0;
  private disposed = 0;

  constructor(private readonly factory: GibAssetHeadFactory | null) {}

  /** True when a face material can be built at all. */
  get available(): boolean { return this.factory !== null; }

  acquire(part: string, local: GibAssetHeadLocal, source?: unknown): GibAssetHeadResource | null {
    const factory = this.factory;
    if (!factory) return null;
    const handle = factory.create(source);
    // SNAPSHOT the locals: the caller's object may be a live actor's reused
    // Vector3s, and a resource must not alias them.
    const captured: GibAssetHeadLocal = {
      centre: [local.centre[0], local.centre[1], local.centre[2]],
      quat: [local.quat[0], local.quat[1], local.quat[2], local.quat[3]],
      axes: [local.axes[0], local.axes[1], local.axes[2]],
    };
    let released = false;
    const res: GibAssetHeadResource = {
      part,
      local: captured,
      material: handle.material,
      setFrameFromState(state: Chunk): void {
        handle.setFrame(gibAssetHeadFrame(state, captured));
      },
      release: () => {
        if (released) return;
        released = true;
        if (this.live.delete(res)) this.disposed++;
        handle.dispose();
      },
    };
    this.created++;
    this.live.add(res);
    return res;
  }

  counters(): GibAssetHeadCounters {
    return { live: this.live.size, created: this.created, disposed: this.disposed };
  }

  /** Drop every live head material. Safe to call while pieces still hold a
   *  reference: their later `release` is a no-op (see `release`). */
  dispose(): void {
    for (const r of [...this.live]) r.release();
  }
}
