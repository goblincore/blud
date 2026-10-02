// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-material.ts
//
// D3: a `frag_depth, greater` shader PROMISES the written depth is at or beyond the
// fragment's raster depth; breaking it is undefined behaviour. The written depth is
// therefore max(marched, reconstructed raster depth). `depth` is three's
// viewZToPerspectiveDepth(positionView.z) of the FRONT face (ViewportDepthNode.DEPTH): a
// reconstruction within a few ulps of the hardware raster depth, not the hardware value
// itself. The proxy box is padded by maxBlendK*4 + 5 cm
// per side, so a real hit sits centimetres behind it and the clamp bites only on rounding.
//
// `depth` reconstructs the raster depth from positionView.z, which equals the rasterised
// depth only when clip = projection * positionView. A material with a vertexNode (the
// full-screen quad dispatch) breaks that, so it is refused.
// The opt-in property is dropped by `material.clone()`; a clone degrades safely to plain
// `frag_depth` (no early-Z, still correct). Re-apply on the clone to opt in again.
import { max, depth } from 'three/tsl';
import type { MeshBasicNodeMaterial } from 'three/webgpu';

export function applyConservativeDepth(material: MeshBasicNodeMaterial): void {
  const flagged = material as unknown as { conservativeDepth?: string };
  if (flagged.conservativeDepth === 'greater') return; // idempotent: never wrap max() twice
  if (material.vertexNode != null) {
    throw new Error('[earlyz] applyConservativeDepth: material has a vertexNode; raster depth is not projection * positionView');
  }
  if (material.depthNode == null) {
    throw new Error('[earlyz] applyConservativeDepth: material has no depthNode');
  }
  material.depthNode = max(material.depthNode as never, depth) as never;
  flagged.conservativeDepth = 'greater';
}
