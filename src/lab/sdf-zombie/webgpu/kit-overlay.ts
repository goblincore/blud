// src/lab/sdf-zombie/webgpu/kit-overlay.ts
//
// The POLYGON half of a character: armour, clothing, and hard props, authored
// in WAM (a text→glTF mesh compiler) and laid over the raymarched flesh.
//
// WHY POLYGONS AT ALL, when the whole point of .blob is that everything is an
// SDF. Smooth-min rounds every edge it touches, which is exactly what makes
// flesh read and exactly what ruins a buckle, a plate lip, a tusk or a blade.
// A `hard` carve gets a crisp edge back but fights the aesthetic everywhere
// else. Meshes are the other half of that trade, and they bring a second win
// for free: all the flesh shares ONE material (per-part colour in the SDF path
// needs a data-texture row and a second weighted fold at every hit pixel to
// avoid Voronoi seams mid-limb), whereas a separate mesh simply has its own.
//
// DEPTH COMPOSITING NEEDED NO NEW PLUMBING, which is the thing that makes this
// viable. The march writes its depth into the colour target's ALPHA and the
// composite quad feeds that to `depthNode` with depth testing left on (see
// sdf-layer.ts's header), so the hardware already compares raymarched flesh
// against whatever the polygonal pass wrote. The kit goes on the DEFAULT
// layer, with the floor and the reference cube — not SDF_LAYER — and
// interleaves correctly with no work here.
//
// The one visible cost: the SDF layer renders at a fraction of full resolution
// and upscales pixelated, while polygons rasterise at full. So the seam where
// plate meets flesh is quantised to the SDF layer's resolution, not the mesh's.
//
// WHAT THIS DOES NOT DO YET — and it is the whole difference between an
// experiment and a feature. The kit is placed ONCE, at the body's root, and
// never moved again. In the lab's rest pose that lines up, because the .wam
// skeleton is a transcription of the .blob one and the glTF renders at bind
// pose; the moment the rig moves, the flesh walks out of its armour. The fix
// is not speculative — `HeadRigid` in rig-bind.ts already derives one rigid
// transform from two rig points and applies it to a set of prims, and a mesh
// is strictly easier than that because an Object3D takes a transform directly.
// It just is not built, so judge these renders with motion FROZEN (which is
// what scripts/blob-turntable.mjs does anyway).
//
// NOTE THE INVERTED RULE. Everywhere else in this directory, moving a body
// means translating the FIELD and never the mesh — translate.ts exists because
// setting object.position on a raymarched body moves only the proxy box and
// leaves the flesh behind. That warning does NOT apply here. This is a real
// mesh; moving the object is the correct and only way to move it.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '../types';

export interface KitOverlay {
  /** Add to the scene on the DEFAULT layer. Parent of the loaded glTF scene. */
  object: THREE.Object3D;
  /** Bone nodes from the .wam skeleton, by name — the seam a future rig bind
   *  will drive. Exposed now so the shape of that work is visible, and so a
   *  render can be sanity-checked against the .blob skeleton by name. */
  bones: Map<string, THREE.Bone>;
  dispose(): void;
}

/**
 * Loads a WAM-compiled glTF and returns it ready to place.
 *
 * The .gltf is self-contained — WAM base64s both the buffer and the texture
 * atlas into the JSON — so there is one request and no sidecar files to keep
 * in step with it.
 *
 * Deliberately NOT hash-pinned, unlike dynamite-prop.ts. That prop's
 * dimensions are a contract (six hand poses were authored against the exact
 * geometry, and seating a differently-sized proxy in an authored grip is
 * forbidden by its spec). A kit has no such contract: nothing is gripping it,
 * and it is regenerated from the .wam whenever the art changes.
 */
export async function loadKit(url: string, root: Vec3 = [0, 0, 0]): Promise<KitOverlay> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const object = new THREE.Group();
  object.add(gltf.scene);
  object.position.set(root[0], root[1], root[2]);

  const bones = new Map<string, THREE.Bone>();
  gltf.scene.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    // Both sides matter: a pauldron is a shell seen from outside AND from
    // under the arm, and a kilt authored with open caps has no back face at
    // all, so a single-sided material makes it vanish from half the turntable.
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.side = THREE.DoubleSide;
  });

  return {
    object,
    bones,
    dispose() {
      object.traverse(o => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.dispose();
      });
    },
  };
}
