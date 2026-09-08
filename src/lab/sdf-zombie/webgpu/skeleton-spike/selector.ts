// src/lab/sdf-zombie/webgpu/skeleton-spike/selector.ts
//
// The ONE experiment selector for the skeleton representation comparison
// (spec: "Expose one experiment selector only through a development
// URL/diagnostic seam"). Dev-only: a production build always resolves
// 'procedural', and the ABSENCE of ?skeleton= preserves the baseline
// exactly. Deferred mode refuses both prototypes: 'mesh' because the
// prototype renderer is lit forward only (mesh-renderer.ts header),
// 'volume' because the atlas sampler is wired into the forward march only
// (volume.wgsl.ts — and as of 2026-09-08 the march integration itself is
// still pending, so game-main warns and stays procedural; see task-3b.md).
import type { SkeletonMode } from './contract';

export function resolveSkeletonMode(search: string, opts: { dev: boolean; deferred: boolean }): SkeletonMode {
  if (!opts.dev) return 'procedural';
  const m = new URLSearchParams(search).get('skeleton');
  if (opts.deferred) return 'procedural';
  if (m === 'mesh' || m === 'volume') return m;
  return 'procedural';
}
