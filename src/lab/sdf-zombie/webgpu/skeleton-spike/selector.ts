// src/lab/sdf-zombie/webgpu/skeleton-spike/selector.ts
//
// The ONE experiment selector for the skeleton representation comparison
// (spec: "Expose one experiment selector only through a development
// URL/diagnostic seam"). Dev-only: a production build always resolves
// 'procedural', and the ABSENCE of ?skeleton= preserves the baseline
// exactly. Deferred mode refuses 'mesh' (the prototype renderer is lit
// forward only — mesh-renderer.ts header) so an unsupported combination
// can never silently render the wrong path.
import type { SkeletonMode } from './contract';

export function resolveSkeletonMode(search: string, opts: { dev: boolean; deferred: boolean }): SkeletonMode {
  if (!opts.dev) return 'procedural';
  const m = new URLSearchParams(search).get('skeleton');
  if (m === 'mesh' && !opts.deferred) return 'mesh';
  return 'procedural';
}
