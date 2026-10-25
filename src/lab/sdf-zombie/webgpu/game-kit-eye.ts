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
//   * the eyeball: a sphere whose vertex colours are a glowing yellow iris over most of its front, a vertical black
//     slit pupil and a torn red back; emissive in the iris's yellow so it still burns;
//   * the stalk: a tube rebuilt each frame along the rope's nodes (6 nodes, a dozen rings: nothing).
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { characterEntry, hasCharacter } from '../character-registry';
import { EYE_FLY, eyeFlyLaunch, makeStalk, stepStalk, type StalkState } from '../head-eye';
import { danglingKitEye, hitsKitEye, kitEyeCentre, kitEyeForward, kitEyeSocket, kitEyeStalkRadii, type KitEyeSpec } from '../kit-eye';
import { rngStreams } from './rng';
import { actorSpawnCentre } from './game-hit-trace';

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
  color: [0.55, 0.5, 0.5] as const,
  emissiveIntensity: 0.55,
  roughness: 0.2,
  cord: [0.35, 0.12, 0.12] as const,
} as const;

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

/** The eyeball, looking down +z: vertex colours for iris / slit / torn back. */
function eyeGeometry(r: number, iris: Vec3): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 28, 20);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / r, y = pos.getY(i) / r, z = pos.getZ(i) / r;
    let c: [number, number, number];
    if (z > 0.35 && Math.abs(x) < 0.09 * Math.max(0, 1 - (y / 0.7) ** 2) + 0.02 && Math.abs(y) < 0.72) c = [0.01, 0.005, 0];   // slit
    else if (z > -0.15) c = [iris[0], iris[1] * (0.75 + 0.25 * z), iris[2]];                                                     // iris
    else c = [0.42, 0.04, 0.04];                                                                                                   // torn back
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function createKitEye(ctx: GameContext, deps: KitEyeDeps): KitEyeLeaf {
  const eyes = new Map<ZombieActor, EyeState>();
  const geoms = new Map<string, THREE.BufferGeometry>();
  const mats = new Map<string, THREE.MeshPhysicalNodeMaterial>();
  const listIds = new Map<THREE.LightsNode, number>();

  function material(kind: 'eye' | 'cord', pos: Vec3, iris: Vec3): THREE.Material {
    const list = ctx.boot.deferredMode ? null : deps.lightsAt(pos);
    if (list && !listIds.has(list)) listIds.set(list, listIds.size + 1);
    const key = `${kind}:${iris.join(',')}:${list ? listIds.get(list) : 0}`;
    let m = mats.get(key);
    if (!m) {
      m = kind === 'eye'
        ? new THREE.MeshPhysicalNodeMaterial({
          color: new THREE.Color(...KIT_EYE_LOOK.color), vertexColors: true, roughness: KIT_EYE_LOOK.roughness,
          clearcoat: 0.8, clearcoatRoughness: 0.1,
          emissive: new THREE.Color(iris[0], iris[1], iris[2]), emissiveIntensity: KIT_EYE_LOOK.emissiveIntensity,
        })
        : new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(...KIT_EYE_LOOK.cord), roughness: 0.3, clearcoat: 0.6 });
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
    if (!g) { g = eyeGeometry(spec.popRadius, spec.iris); geoms.set(key, g); }
    return g;
  }

  const _look = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
  function poseDangling(st: EyeState, spec: KitEyeSpec, fwd: Vec3): void {
    if (!st.stalk || !st.eye) return;
    const d = danglingKitEye(st.stalk, spec, fwd);
    st.eye.position.set(d.eye[0], d.eye[1], d.eye[2]);
    st.eye.quaternion.setFromUnitVectors(_z, _look.set(d.look[0], d.look[1], d.look[2]));
    // The stalk: a fresh tube along the nodes (a curve through them), ending at the eyeball's back.
    const curve = new THREE.CatmullRomCurve3(d.nodes.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const [r0, r1] = kitEyeStalkRadii(spec);
    const tube = new THREE.TubeGeometry(curve, 12, (r0 + r1) / 2, 8, false);
    if (st.cord) { st.cord.geometry.dispose(); st.cord.geometry = tube; }
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
    st.cord = new THREE.Mesh(new THREE.BufferGeometry(), material('cord', socket, spec.iris));
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
    ctx.boot.spawnMeshGib(flying, [p.x, p.y, p.z], l.vel, l.angVel, spec.popRadius,
      { restitution: EYE_FLY.restitution, tag: 'eye', from: actorSpawnCentre(ctx, a) });
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
