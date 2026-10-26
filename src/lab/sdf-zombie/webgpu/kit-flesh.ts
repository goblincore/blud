// src/lab/sdf-zombie/webgpu/kit-flesh.ts
//
// KIT FLESH: polygon kit parts that stand in for a character's FLESH (the goblin's bony hands, 2026-10-24) drawn with
// the flesh shader's own lighting instead of three's PBR.
//
// WHY. The kit overlay lights its meshes with MeshStandardMaterial under a room environment -- right for plate, brass
// and leather, wrong for skin: beside the marched body the hands never matched however their colour was tuned (owner,
// 2026-10-26: "hard to match the mesh hands with the sdf body ... the lighting"). The settled-chunk bake already solved
// this for gibs: `createBakedChunkMaterial` shades a mesh with `chunkShade`, the march's own key + flashlight + wrapped
// diffuse + specular + fresnel, from a per-vertex albedo baked through the march's albedo chain. So a kit's flesh
// parts get exactly that: the character's own palette baked onto each vertex (bakeChunkAlbedo with no wound, the
// chain's intact-skin branch: base colour and mottle), its surface response (gibSurfaceFromMaterial: wetness,
// roughness, spec, the noise amplitude), anchored in the kit's bind (rest) frame as the march anchors its detail, and
// ONE shared lit material (albedo is per-vertex, so sharing costs nothing).
//
// Pure geometry here; the game owns the material (registerLitChunkMaterial) and the per-mesh light picks.
import * as THREE from 'three/webgpu';
import { bakeChunkAlbedo, fbm, type ChunkFieldEvals } from '../chunk-bake-field';
import type { FleshMaterial } from '../material';
import type { Vec3 } from '../types';
import { gibLookFromMaterial, gibSurfaceFromMaterial } from './gib-asset-archetypes';

/** Kit material names whose parts are FLESH (kit-overlay.ts LOOK carries their standard-material fallback). */
export const KIT_FLESH_MATERIALS: ReadonlySet<string> = new Set(['goblinskin', 'zombieskin']);

/** Intact skin: no wound, no torn end, flesh everywhere -- bakeChunkAlbedo's skin branch. */
const INTACT: ChunkFieldEvals = {
  field: () => 0, preWound: () => 0, woundMask: () => 0, nearWound: () => false, materialAt: () => 'flesh',
};

/**
 * The chunk material's per-vertex inputs for a flesh kit part, from the character's flesh material: `bakeColor`
 * (albedo, wound mask 0), `bakeAnchor` (the bind-space point the micro-detail rides, w = noise amplitude) and
 * `bakeResponse` (legacy gamma, wetness, shininess, spec), laid out exactly as chunk-bake-geometry.ts writes them.
 */
export function kitFleshAttributes(positions: ArrayLike<number>, flesh: FleshMaterial): {
  bakeColor: Float32Array; bakeAnchor: Float32Array; bakeResponse: Float32Array;
} {
  // goreStrength 0: a clean body's lodCfg.w (the gore layer is for torn chunks, not skin).
  const look = { ...gibLookFromMaterial(flesh), goreStrength: 0 };
  const surf = gibSurfaceFromMaterial(flesh);
  const n = positions.length / 3;
  const bakeColor = new Float32Array(n * 4), bakeAnchor = new Float32Array(n * 4), bakeResponse = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    bakeColor.set(bakeChunkAlbedo(p, p, INTACT, look), i * 4);
    bakeAnchor.set([p[0], p[1], p[2], surf.noiseAmp], i * 4);
    const mottle = Math.min(1, Math.max(0, fbm([p[0] * 6, p[1] * 6, p[2] * 6]) * 0.5 + 0.5));
    const gore = Math.min(1, mottle * 0.55) * look.goreStrength;
    bakeResponse.set([1 + surf.legacyGamma, surf.wetness * (1 + 0.6 * gore), 128 + (4 - 128) * surf.roughness, surf.specIntensity], i * 4);
  }
  return { bakeColor, bakeAnchor, bakeResponse };
}

/**
 * Dress a loaded kit's flesh parts: every mesh whose material is in KIT_FLESH_MATERIALS gets the chunk attributes for
 * `flesh` and `material`. Returns the dressed meshes (the game picks their lights per frame). A skinned mesh keeps its
 * skinning: the node material skins `positionLocal` as any node material does.
 */
export function dressKitFlesh(root: THREE.Object3D, material: THREE.Material, flesh: FleshMaterial): THREE.Mesh[] {
  const dressed: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !KIT_FLESH_MATERIALS.has(mesh.material?.name ?? '')) return;
    // Kit geometry is SHARED by every actor wearing the kit (kit-overlay.ts loadKitSource): bake once per geometry and
    // flesh, not once per zombie.
    if (mesh.geometry.userData['kitFleshOf'] !== flesh) {
      const pos = mesh.geometry.getAttribute('position');
      const a = kitFleshAttributes(pos.array as ArrayLike<number>, flesh);
      mesh.geometry.setAttribute('bakeColor', new THREE.BufferAttribute(a.bakeColor, 4));
      mesh.geometry.setAttribute('bakeAnchor', new THREE.BufferAttribute(a.bakeAnchor, 4));
      mesh.geometry.setAttribute('bakeResponse', new THREE.BufferAttribute(a.bakeResponse, 4));
      mesh.geometry.userData['kitFleshOf'] = flesh;
    }
    const old = mesh.material;
    mesh.material = material;
    old.dispose();
    mesh.userData['kitFlesh'] = true;
    dressed.push(mesh);
  });
  return dressed;
}
