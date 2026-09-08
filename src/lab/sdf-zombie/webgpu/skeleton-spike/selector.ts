// Mesh actor skeletons are the accepted forward default in dev and production.
// Explicit procedural remains the comparison/fallback. Volume is dev-only;
// deferred uses procedural because neither alternate supports its G-buffer.
import type { SkeletonMode } from './contract';

export function resolveSkeletonMode(search: string, opts: { dev: boolean; deferred: boolean }): SkeletonMode {
  if (opts.deferred) return 'procedural';
  const m = new URLSearchParams(search).get('skeleton');
  if (m === 'procedural') return 'procedural';
  if (m === 'volume' && opts.dev) return 'volume';
  return 'mesh';
}
