// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-material.ts
//
// D3: a `frag_depth, greater` shader PROMISES the written depth is at or beyond the
// fragment's raster depth; breaking it is undefined behaviour. The written depth is
// therefore max(marched, raster). `depth` is three's interpolated perspective depth of
// the FRONT face (ViewportDepthNode.DEPTH). The proxy box is padded by maxBlendK*4 + 5 cm
// per side, so a real hit sits centimetres behind it and the clamp bites only on rounding.
import { max, depth } from 'three/tsl';
import type { MeshBasicNodeMaterial } from 'three/webgpu';

export function applyConservativeDepth(material: MeshBasicNodeMaterial): void {
  if (material.depthNode == null) {
    throw new Error('[earlyz] applyConservativeDepth: material has no depthNode');
  }
  material.depthNode = max(material.depthNode as never, depth) as never;
  (material as unknown as { conservativeDepth: string }).conservativeDepth = 'greater';
}
