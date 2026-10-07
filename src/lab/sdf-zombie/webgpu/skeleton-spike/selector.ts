// Mesh actor skeletons are the accepted forward default in dev and production.
// Explicit procedural remains the comparison/fallback. Volume is dev-only;
// deferred uses procedural because neither alternate supports its G-buffer.
import type { SkeletonMode } from './contract';

/** How a mesh-skeleton actor's organs are drawn (organs as mesh, 2026-10-06). 'mesh': segment meshes, and the body
 *  packs no inside-flesh row. 'sdf': organ rows folded by the march (applyBones), as before. */
export type OrganMode = 'mesh' | 'sdf';

/** `?organs=sdf` keeps SDF organs on the mesh skeleton (the A/B reference). Mesh organs exist only with the mesh
 *  skeleton: procedural, volume and deferred bodies keep their organ rows whatever the query says. */
export function resolveOrganMode(search: string, skeleton: SkeletonMode): OrganMode {
  if (skeleton !== 'mesh') return 'sdf';
  return new URLSearchParams(search).get('organs') === 'sdf' ? 'sdf' : 'mesh';
}

export function resolveSkeletonMode(search: string, opts: { dev: boolean; deferred: boolean }): SkeletonMode {
  if (opts.deferred) return 'procedural';
  const m = new URLSearchParams(search).get('skeleton');
  if (m === 'procedural') return 'procedural';
  if (m === 'volume' && opts.dev) return 'volume';
  return 'mesh';
}
