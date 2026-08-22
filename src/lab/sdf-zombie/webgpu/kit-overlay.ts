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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Vec3 } from '../types';

/**
 * How each WAM material should actually look in the lab.
 *
 * WAM hardcodes `metallicFactor: 0, roughnessFactor: 0.9` on every material it
 * exports (gltf.py) — every surface comes out matte, which is why the first
 * kit read as dull grey plastic on a shiny creature. The look is decided here
 * rather than upstream anyway: the lighting lives in the lab, and a material
 * tuned against WAM's own software renderer would not survive the trip.
 *
 * The house rule this is serving: everything in Blud is shiny, fleshy, or
 * some combination. Plate that does not catch the key light reads as neither.
 *
 * `metalness` is deliberately BELOW 1 even on the iron. A physically metallic
 * surface has no diffuse response at all, so under this lab's single hard key
 * it would be black everywhere the highlight is not — the env map below is
 * what makes metal legible, and leaning entirely on it would make the plate
 * a mirror of a room that is not the game's room. Around 0.7 keeps a little
 * diffuse so the form still reads in shadow.
 */
const LOOK: Record<string, {
  metalness: number; roughness: number; envIntensity: number;
  /**
   * Linear RGB self-illumination, and its strength. Used only by the sunglass
   * lens, to fake the goblin's glowing eyes reading THROUGH the shades — a
   * lens that hides them entirely is a blindfold.
   *
   * A FAKE, and worth knowing why rather than reaching for real transparency
   * again. `transparent: true` alone does nothing useful here, because the SDF
   * layer composites its flesh as a fullscreen quad that depth-tests against
   * the polygon depth buffer: with `depthWrite: false` the lens leaves no
   * depth, the composite passes, and the flesh is drawn straight over it — the
   * shades disappear entirely wherever the face is behind them. With
   * `depthWrite: true` the lens does survive, but then the composite is
   * rejected there and the "transparent" lens shows the BACKGROUND through it
   * rather than the face. Neither is transparency.
   *
   * Doing it properly means drawing transparent kit geometry in a third pass
   * AFTER the composite, which is a change to sdf-layer.ts's pass structure,
   * not a material flag.
   */
  emissive?: [number, number, number];
  emissiveIntensity?: number;
}> = {
  iron: { metalness: 0.72, roughness: 0.16, envIntensity: 1.15 },
  brass: { metalness: 0.78, roughness: 0.22, envIntensity: 1.25 },
  // Not metal, but not matte either — oiled leather catches a broad sheen.
  leather: { metalness: 0.05, roughness: 0.48, envIntensity: 0.55 },
  // Sunglass lens. The lowest roughness and the highest env intensity in the
  // kit, because a lens is almost entirely what it reflects — its near-black
  // base colour contributes nearly nothing. Metalness stays moderate: a real
  // lens is dielectric, and pushing it metallic kills the dark body of the
  // glass and leaves only a chrome smear.
  // Solid, not smoked. An emissive tint to fake the eyes glowing through was
  // tried and rejected on this character — it reads as a lit visor, which is a
  // different and much less goblin note. See the emissive field's docstring for
  // why real transparency is not a material flag here.
  glass: { metalness: 0.35, roughness: 0.04, envIntensity: 2.0 },

  // ---- clown ----
  // "Everything in this game is either shiny or fleshy or some combination."
  // These are all dielectric — cloth and painted rubber, not metal — so the
  // sheen comes from LOW ROUGHNESS and a strong env, not from metalness.
  // Pushing metalness on a coloured material eats its albedo and leaves a
  // tinted mirror, which is how the goblin's first brass read.
  nose:    { metalness: 0.10, roughness: 0.08, envIntensity: 2.2 },
  red:     { metalness: 0.08, roughness: 0.14, envIntensity: 1.7 },
  royal:   { metalness: 0.06, roughness: 0.26, envIntensity: 1.1 },
  blue:    { metalness: 0.06, roughness: 0.26, envIntensity: 1.1 },
  pink:    { metalness: 0.06, roughness: 0.28, envIntensity: 1.0 },
  purple:  { metalness: 0.06, roughness: 0.24, envIntensity: 1.1 },
  yellow:  { metalness: 0.06, roughness: 0.24, envIntensity: 1.1 },
  white:   { metalness: 0.04, roughness: 0.30, envIntensity: 0.9 },
  grey:    { metalness: 0.10, roughness: 0.28, envIntensity: 1.1 },
  gold:    { metalness: 0.70, roughness: 0.22, envIntensity: 1.3 },
};

/**
 * Anything not named above still gets an environment and a modest sheen.
 *
 * It used to get NOTHING — the apply below was gated on `if (look)`, so an
 * unlisted material kept three's default `roughness: 1, metalness: 0` and no
 * envMap, which is fully matte. Every material in the clown kit was unlisted,
 * which is the whole reason that character read as flat poster paint. A kit
 * should not have to enumerate itself to look like it belongs in the scene.
 */
const LOOK_DEFAULT = { metalness: 0.05, roughness: 0.35, envIntensity: 0.9 };

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
export async function loadKit(
  url: string, renderer: THREE.WebGPURenderer, root: Vec3 = [0, 0, 0],
): Promise<KitOverlay> {
  const gltf = await new GLTFLoader().loadAsync(url);

  // A specular-only environment for the KIT ALONE, not `scene.environment`.
  //
  // The lab lights with one directional key and a dim ambient and has no
  // environment at all, which is fine for the flesh — that is a hand-written
  // shader with its own specular term — and fatal for PBR metal, which gets
  // its brightness almost entirely from what it reflects. Without this the
  // armour is black except for a single highlight dot.
  //
  // Assigned per-material rather than to the scene so the floor and the
  // reference cube, which are MeshStandardMaterial too, keep the look every
  // previous capture was judged against.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
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
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      mat.side = THREE.DoubleSide;
      const std = mat as THREE.MeshStandardMaterial;
      const look = LOOK[mat.name] ?? LOOK_DEFAULT;
      if (std.isMeshStandardMaterial) {
        std.metalness = look.metalness;
        std.roughness = look.roughness;
        std.envMap = env;
        std.envMapIntensity = look.envIntensity;
        const em = (look as { emissive?: [number, number, number] }).emissive;
        if (em) {
          std.emissive.setRGB(...em);
          std.emissiveIntensity =
            (look as { emissiveIntensity?: number }).emissiveIntensity ?? 1;
        }
        std.needsUpdate = true;
      }
    }
  });

  return {
    object,
    bones,
    dispose() {
      env.dispose();
      object.traverse(o => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.dispose();
      });
    },
  };
}
