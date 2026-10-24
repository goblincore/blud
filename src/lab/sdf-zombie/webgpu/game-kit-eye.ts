// src/lab/sdf-zombie/webgpu/game-kit-eye.ts
//
// THE POPPING KIT EYE, in the game (kit-eye.ts has the rules and the shape). For a character whose profile declares
// `eye` (the teratoma): a shot through the eye POPS it (the kit eyeball hidden; a MESH eyeball dangles out of the
// socket on a thick optic stalk), and the next hit anywhere, or death, SNAPS it (the eyeball flies off as a mesh gib
// with the comic flight of head-eye.ts EYE_FLY, the stalk drops away).
//
// MESH, NOT SDF. The zombie head damage hangs its eye as an SDF piece riding the actor (boot.attachPiece); for this
// eye that piece reported visible and drew nothing (arena, 2026-10-24). A plain mesh, lit like the level (the meat
// chunks' and the brain's way, game-meat-gib.ts), is reliable and costs nothing in the march:
//   * the eyeball: a sphere with GENERATED maps (kit-eye-texture.ts; owner 2026-10-24: it read as "a yellow ball on a
//     lollipop stick"): a fibrous iris with a limbal ring and a black slit, a bloodshot sclera with raised veins, a torn
//     clotted back; a normal map from the same height field; an emissive mask so only the iris burns;
//   * the stalk: a tapered tube rebuilt in place each frame along the rope's nodes (kit-eye.ts stalkTubePositions), pink
//     wet flesh with striations and veins, blood-soaked toward the eye, swelling into a torn cuff where it meets it.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { characterEntry, hasCharacter } from '../character-registry';
import { EYE_FLY, eyeFlyLaunch, makeStalk, stepStalk, type StalkState } from '../head-eye';
import { danglingKitEye, hitsKitEye, kitEyeCentre, kitEyeForward, kitEyeSocket, kitEyeStalkRadii, stalkTubeLayout, stalkTubePositions, type KitEyeSpec } from '../kit-eye';
import { eyeTextures, stalkTextures } from '../kit-eye-texture';
import { rngStreams } from './rng';

interface EyeState {
  phase: 'dangling' | 'gone';
  stalk: StalkState | null;
  eye: THREE.Mesh | null;
  cord: THREE.Mesh | null;
}

export interface KitEyeLeaf {
  /** A gun hit on `a` at `point`, travelling `dir`: pops the eye if the shot goes through it, snaps a dangling one. */
  hit(a: ZombieActor, point: Vec3, dir: Vec3): void;
  /** Swing the dangling eyes; snap the dead bodies' ones; forget removed bodies. */
  step(dt: number): void;
  /** Drop everything (a cast rebuild). */
  clear(): void;
}

export interface KitEyeDeps {
  /** The level's light list for the room at `pos` (forward path), or null (deferred / no level lists). */
  lightsAt(pos: Vec3): THREE.LightsNode | null;
}

/** The meshes' look: darkened like every three material under the SDF-calibrated lights (game-meat-gib MEAT_LOOK). */
export const KIT_EYE_LOOK = {
  color: [0.6, 0.55, 0.55] as const,
  emissiveIntensity: 0.9,
  roughness: 0.22,
  cord: [0.55, 0.45, 0.45] as const,
  /** Texture sizes: the eye's equirectangular map, the stalk's along x round. */
  eyeTex: [512, 256] as const,
  stalkTex: [256, 64] as const,
  /** The stalk tube: rings along it and vertices round each. */
  stalkSegs: 24,
  stalkRadial: 12,
} as const;

/** RGBA bytes as a texture. Rows are reversed: the generators put the eye's front pole (v = 0) in row 0, and a
 *  SphereGeometry's front-pole vertices carry uv.y = 1. */
function dataTexture(rgba: Uint8ClampedArray, w: number, h: number, srgb: boolean, flipRows: boolean): THREE.DataTexture {
  let data = rgba;
  if (flipRows) {
    data = new Uint8ClampedArray(rgba.length);
    for (let y = 0; y < h; y++) data.set(rgba.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function specOf(a: ZombieActor): KitEyeSpec | null {
  const name = a.characterName();
  return hasCharacter(name) ? characterEntry(name).profile.eye ?? null : null;
}

/** Show or hide the actor's kit meshes drawn in `material`. */
function setKitMaterialVisible(a: ZombieActor, material: string, visible: boolean): void {
  a.character?.kit?.object.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some(x => x.name === material)) m.visible = visible;
  });
}

/** The eyeball, looking down +z: a sphere whose +y pole (the texture's front) is turned onto +z. */
function eyeGeometry(r: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, 48, 32).rotateX(Math.PI / 2);
}

export function createKitEye(ctx: GameContext, deps: KitEyeDeps): KitEyeLeaf {
  const eyes = new Map<ZombieActor, EyeState>();
  const geoms = new Map<string, THREE.BufferGeometry>();
  const mats = new Map<string, THREE.MeshPhysicalNodeMaterial>();
  const listIds = new Map<THREE.LightsNode, number>();

  // The generated maps, made once per iris colour (a few ms; at the first pop, not at boot).
  const texCache = new Map<string, { eye: THREE.DataTexture; eyeN: THREE.DataTexture; eyeG: THREE.DataTexture; cord: THREE.DataTexture; cordN: THREE.DataTexture }>();
  function textures(iris: Vec3) {
    const key = iris.join(',');
    let t = texCache.get(key);
    if (!t) {
      const [ew, eh] = KIT_EYE_LOOK.eyeTex, [sw, sh] = KIT_EYE_LOOK.stalkTex;
      const e = eyeTextures(ew, eh, iris), c = stalkTextures(sw, sh);
      t = {
        eye: dataTexture(e.albedo, ew, eh, true, true), eyeN: dataTexture(e.normal, ew, eh, false, true),
        eyeG: dataTexture(e.glow!, ew, eh, false, true),
        cord: dataTexture(c.albedo, sw, sh, true, false), cordN: dataTexture(c.normal, sw, sh, false, false),
      };
      texCache.set(key, t);
    }
    return t;
  }

  function material(kind: 'eye' | 'cord', pos: Vec3, iris: Vec3): THREE.Material {
    const list = ctx.boot.deferredMode ? null : deps.lightsAt(pos);
    if (list && !listIds.has(list)) listIds.set(list, listIds.size + 1);
    const key = `${kind}:${iris.join(',')}:${list ? listIds.get(list) : 0}`;
    let m = mats.get(key);
    if (!m) {
      const t = textures(iris);
      m = kind === 'eye'
        ? new THREE.MeshPhysicalNodeMaterial({
          color: new THREE.Color(...KIT_EYE_LOOK.color), map: t.eye, normalMap: t.eyeN, roughness: KIT_EYE_LOOK.roughness,
          clearcoat: 0.9, clearcoatRoughness: 0.08,
          emissive: new THREE.Color(iris[0], iris[1], iris[2]), emissiveMap: t.eyeG, emissiveIntensity: KIT_EYE_LOOK.emissiveIntensity,
        })
        : new THREE.MeshPhysicalNodeMaterial({
          color: new THREE.Color(...KIT_EYE_LOOK.cord), map: t.cord, normalMap: t.cordN, roughness: 0.32,
          clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide,
        });
      m.name = kind === 'eye' ? 'kit-eye-pop' : 'kit-eye-cord';
      if (list) { m.lightsNode = list; ctx.world.levelNodeMaterials.push(m); }
      mats.set(key, m);
    }
    return m;
  }

  function addToScene(o: THREE.Object3D): void {
    ctx.boot.handle.scene.add(o);
    ctx.boot.deferredApi?.router.register(o, 'mesh', 'level-only');
  }
  function removeFromScene(o: THREE.Mesh | null, disposeGeometry = false): void {
    if (!o) return;
    ctx.boot.deferredApi?.router.unregister(o);
    o.removeFromParent();
    if (disposeGeometry) o.geometry.dispose();
  }

  function eyeGeom(spec: KitEyeSpec): THREE.BufferGeometry {
    const key = `${spec.popRadius}:${spec.iris.join(',')}`;
    let g = geoms.get(key);
    if (!g) { g = eyeGeometry(spec.popRadius); geoms.set(key, g); }
    return g;
  }

  const _look = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
  function poseDangling(st: EyeState, spec: KitEyeSpec, fwd: Vec3): void {
    if (!st.stalk || !st.eye) return;
    const d = danglingKitEye(st.stalk, spec, fwd);
    st.eye.position.set(d.eye[0], d.eye[1], d.eye[2]);
    st.eye.quaternion.setFromUnitVectors(_z, _look.set(d.look[0], d.look[1], d.look[2]));
    // The stalk: the tapered, cuffed tube rebuilt IN PLACE along the nodes (positions and normals; uvs and indices are
    // fixed), its cuff where the rope enters the eyeball's back.
    if (st.cord) {
      const [r0, r1] = kitEyeStalkRadii(spec);
      const geo = st.cord.geometry;
      const attr = geo.getAttribute('position') as THREE.BufferAttribute;
      const len = Math.max(1e-3, d.nodes.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - d.nodes[i]![0], p[1] - d.nodes[i]![1], p[2] - d.nodes[i]![2]), 0));
      const cuffAt = Math.max(0.3, 1 - spec.popRadius / len);
      stalkTubePositions(d.nodes, r0, r1, KIT_EYE_LOOK.stalkSegs, KIT_EYE_LOOK.stalkRadial, cuffAt, attr.array as Float32Array);
      attr.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }
  }

  function stalkGeometry(): THREE.BufferGeometry {
    const { uv, index } = stalkTubeLayout(KIT_EYE_LOOK.stalkSegs, KIT_EYE_LOOK.stalkRadial);
    const g = new THREE.BufferGeometry();
    const n = (KIT_EYE_LOOK.stalkSegs + 1) * (KIT_EYE_LOOK.stalkRadial + 1);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
  }

  function pop(a: ZombieActor, spec: KitEyeSpec, centre: Vec3, dir: Vec3): void {
    setKitMaterialVisible(a, spec.material, false);
    const fwd = kitEyeForward(a.posed().prims, a.pose().yaw);
    const socket = kitEyeSocket(centre, fwd, spec);
    // Kicked out of the socket along the face and back along the shot, a little down; then gravity takes it.
    const kick: Vec3 = [fwd[0] * 0.8 - dir[0] * 0.4, fwd[1] * 0.8 - dir[1] * 0.4 - 0.3, fwd[2] * 0.8 - dir[2] * 0.4];
    const st: EyeState = { phase: 'dangling', stalk: makeStalk(socket, kick, 2.0), eye: null, cord: null };
    st.eye = new THREE.Mesh(eyeGeom(spec), material('eye', socket, spec.iris));
    st.eye.name = 'kit-eye-pop';
    st.cord = new THREE.Mesh(stalkGeometry(), material('cord', socket, spec.iris));
    st.cord.name = 'kit-eye-cord';
    for (const m of [st.eye, st.cord]) { m.castShadow = false; m.receiveShadow = false; addToScene(m); }
    poseDangling(st, spec, fwd);
    eyes.set(a, st);
  }

  function snap(a: ZombieActor, st: EyeState, spec: KitEyeSpec, dir: Vec3): void {
    const eye = st.eye, s = st.stalk;
    removeFromScene(st.cord, true);
    st.cord = null; st.stalk = null; st.eye = null; st.phase = 'gone';
    if (!eye || !s) return;
    removeFromScene(eye);
    if (!ctx.boot.spawnMeshGib) return;
    const fwd = kitEyeForward(a.posed().prims, a.pose().yaw);
    const l = eyeFlyLaunch(dir, fwd, [fwd[2], 0, -fwd[0]], rngStreams.misc);
    const flying = new THREE.Mesh(eye.geometry, eye.material);
    flying.name = 'kit-eye-gib';
    const p = eye.position;
    ctx.boot.spawnMeshGib(flying, [p.x, p.y, p.z], l.vel, l.angVel, spec.popRadius, { restitution: EYE_FLY.restitution, tag: 'eye' });
  }

  return {
    hit(a, point, dir) {
      const spec = specOf(a);
      if (!spec) return;
      const st = eyes.get(a);
      if (st?.phase === 'dangling') { snap(a, st, spec, dir); return; }
      if (st) return;   // gone
      const centre = kitEyeCentre(a.posed().prims, spec, a.pose().yaw);
      if (centre && hitsKitEye(point, dir, centre, spec)) pop(a, spec, centre, dir);
    },
    step(dt) {
      for (const [a, st] of eyes) {
        if (!ctx.world.actors.includes(a)) { removeFromScene(st.cord, true); removeFromScene(st.eye); eyes.delete(a); continue; }
        if (st.phase !== 'dangling' || !st.stalk) continue;
        const spec = specOf(a);
        const centre = spec ? kitEyeCentre(a.posed().prims, spec, a.pose().yaw) : null;
        if (!spec || !centre) continue;
        // Death snaps it: a corpse does not keep an eye swinging on a body that is no longer animated.
        if (a.motionFrame()?.collapsed) { snap(a, st, spec, [0, 1, 0]); continue; }
        const fwd = kitEyeForward(a.posed().prims, a.pose().yaw);
        st.stalk = stepStalk(st.stalk, kitEyeSocket(centre, fwd, spec), dt);
        poseDangling(st, spec, fwd);
      }
    },
    clear() {
      for (const [a, st] of eyes) {
        removeFromScene(st.cord, true); removeFromScene(st.eye);
        const spec = specOf(a);
        if (spec) setKitMaterialVisible(a, spec.material, true);
      }
      eyes.clear();
    },
  };
}
