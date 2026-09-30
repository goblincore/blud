// src/lab/sdf-zombie/webgpu/kit-lights.ts
//
// KIT BEAM PARITY (owner option 1, 2026-09-25). Character kits and held props
// (MeshStandardMaterial) are lit by the SCENE's lights like the level is — but
// the flashlight SpotLight is swapped, for these materials only, for a twin
// whose falloff is fitted to the SDF body beam (../mesh-beam-fit.ts). The level
// keeps the original flashlight (owner judged it right); the flesh keeps its
// analytic beam; clothes and flesh now read at the same exposure.
//
// HOW. three's NodeMaterial takes a per-material `lightsNode` (selective
// lighting). A fixed list would go stale — the scene's light set is decided at
// boot, the rig A/B hides the flashlight, pools exist per feature — so
// KitLightsNode does not own a list: at build time it reads the SCENE's
// LightsNode (builder.lightsNode, the render list's) and returns that list with
// the flashlight replaced by the kit twin. A scene light-set change re-keys every
// render object (the scene LightsNode is in the dynamic cache key), which
// rebuilds kit materials against the new list too.
//
// THE TWIN IS NEVER IN THE SCENE LIST. It lives on KIT_BEAM_LAYER, which no
// camera enables, and the renderer only collects lights whose layers test true
// against the camera (Renderer._projectObject). So the level and everything
// else compiles exactly as before: nothing re-keys, no LightsNode recompile
// (the game-glow.ts / game-burning.ts trap). The twin still has to be IN the
// scene graph so its world matrix updates; it is posed by Flashlight.update.
// Only the RENDERER honours that layer. Anything that finds lights by traversing
// the scene graph must skip KIT_BEAM_LAYER itself: game-lighting-leaves
// levelSceneLights did not, and the twin (ungated by flashlightGate) lit every
// room's walls as a torch before the flashlight pickup (2026-09-30).
//
// NOT covered: the player's FPV hands are SDF (their own beam), and anything
// not routed through applyKitBeam (level props, casings, gibs) keeps the
// original flashlight.
import * as THREE from 'three/webgpu';

/** A layer no camera enables — keeps the kit twin out of the scene light list. */
export const KIT_BEAM_LAYER = 30;

/** `lights` with `from` replaced by `to` (identity if `from` is absent). */
export function swapLight<T>(lights: readonly T[], from: T, to: T): T[] {
  return lights.map(l => (l === from ? to : l));
}

/** A LightsNode that mirrors the scene's lights, with one light swapped. */
export class KitLightsNode extends THREE.LightsNode {
  private source: THREE.LightsNode | null = null;
  private srcList: readonly THREE.Light[] | null = null;
  private mapped: THREE.Light[] = [];

  constructor(readonly from: THREE.Light, readonly to: THREE.Light) {
    super();
  }

  /** Capture the scene's LightsNode from the builder compiling this material. */
  bindSource(builder: object): void {
    const s = (builder as { lightsNode?: THREE.LightsNode | null }).lightsNode;
    if (s && s !== this) this.source = s;
  }

  override getBuiltinLights(): THREE.Light[] {
    const list = this.source ? this.source.getLights() : [];
    if (list !== this.srcList || list.length !== this.mapped.length) {
      this.srcList = list;
      this.mapped = swapLight(list, this.from, this.to);
    }
    return this.mapped;
  }

  override getLights(): THREE.Light[] {
    return this.getBuiltinLights();
  }

  /** NodeMaterial asks before setup; the twin is always there when the beam is. */
  override get hasLights(): boolean {
    return true;
  }

  override setupLightsNode(builder: THREE.NodeBuilder) {
    this.bindSource(builder);
    return super.setupLightsNode(builder);
  }

  override getHash(builder: THREE.NodeBuilder): string {
    this.bindSource(builder);
    return super.getHash(builder);
  }

  override setup(builder: THREE.NodeBuilder) {
    this.bindSource(builder);
    return super.setup(builder);
  }
}

let active: KitLightsNode | null = null;

/** Install (or clear) the kit lights for every kit/prop loaded from now on.
 *  The game registers at boot, before any character spawns; the lab never
 *  registers, so its kits keep plain scene lighting. */
export function setKitBeam(node: KitLightsNode | null): void {
  active = node;
}

export function kitBeam(): KitLightsNode | null {
  return active;
}

/** Route every lit material under `root` to the kit lights. No-op when
 *  nothing is registered. Debris (kit-damage) shares these materials.
 *
 *  glTF materials are CORE MeshStandardMaterials (GLTFLoader imports bare
 *  'three'); the WebGPU renderer converts them per build with
 *  NodeLibrary.fromMaterial, which copies every enumerable key — `lightsNode`
 *  included. So setting it on the core material is enough. */
export function applyKitBeam(root: THREE.Object3D): number {
  if (!active) return 0;
  let n = 0;
  root.traverse(o => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if (!isLitMaterial(mat)) continue;
      const slot = mat as unknown as { lightsNode: THREE.LightsNode | null };
      if (slot.lightsNode === active) continue;
      slot.lightsNode = active;
      mat.needsUpdate = true;
      n++;
    }
  });
  return n;
}

function isLitMaterial(mat: THREE.Material): boolean {
  const f = mat as unknown as Record<string, unknown>;
  if (f.isNodeMaterial === true) return f.lights === true;
  return f.isMeshStandardMaterial === true || f.isMeshLambertMaterial === true || f.isMeshPhongMaterial === true;
}
