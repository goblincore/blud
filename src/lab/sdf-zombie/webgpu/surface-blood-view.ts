// src/lab/sdf-zombie/webgpu/surface-blood-view.ts
//
// Persistent surface blood (opt-in, `?surfaceblood=1`): sweeps the blood sim's droplets against the level's meshes, keeps the stains as per-receiver decal geometry, and draws them lit.
//
import * as THREE from 'three/webgpu';
import { attribute, normalLocal, transformNormalToView, uniform, uv, wgslFn, vec4, float, output } from 'three/tsl';
import type { Vec3 } from '../types';
import type { BloodSim, Droplet } from '../blood-sim';
import { createStains, clearStains, depositStain, indexTriangles, projectStain, sweepTriangles,
  type SurfaceHit, type StainLook, type TriangleIndex, type DecalSoup } from '../blood-surface';
import { SBHASH_WGSL, SBMASK_WGSL, SBSURFACE_WGSL, SBROUGHNESS_WGSL, SBNORMAL_WGSL, SBFINISH_WGSL } from './surface-blood.wgsl';

const hashFn = wgslFn(SBHASH_WGSL);
const maskFn = wgslFn(SBMASK_WGSL, [hashFn] as never);
const surfaceFn = wgslFn(SBSURFACE_WGSL, [maskFn] as never);
const roughFn = wgslFn(SBROUGHNESS_WGSL);
const normalFn = wgslFn(SBNORMAL_WGSL, [maskFn] as never);
const finishFn = wgslFn(SBFINISH_WGSL);
const MAX_VERTICES = 65536;

interface Receiver {
  id: number; mesh: THREE.Mesh; index: TriangleIndex; inverse: THREE.Matrix4;
  bounds: THREE.Box3; decal: THREE.Mesh; room: number;
}
export interface SurfaceBloodView {
  enabled: boolean;
  look: StainLook;
  group: THREE.Group;
  setEnabled(on: boolean): void;
  setLook(look: StainLook): void;
  clear(): void;
  advance(dt: number): void;
  sync(): void;
  sweep(from: Vec3, to: Vec3): SurfaceHit | null;
  deposit(hit: SurfaceHit, d: Pick<Droplet, 'vel' | 'size'>): void;
  burst(from: Vec3, to: Vec3, count?: number): boolean;
  stats(): { enabled: boolean; stains: number; vertices: number; receivers: number; triangles: number; merged: number; evicted: number; clipped: number; clock: number; look: StainLook };
  snapshot(): { id: number; receiver: string; pos: Vec3; normal: Vec3; look: string }[];
  precompile(camera: THREE.Camera): Promise<void>;
  panelVisible(on: boolean): void;
  dispose(): void;
}

function soup(mesh: THREE.Mesh): Float32Array {
  const g = mesh.geometry, p = g.getAttribute('position'), ix = g.index;
  if (!p) return new Float32Array();
  const instanced = mesh as THREE.InstancedMesh;
  const instances = instanced.isInstancedMesh ? instanced.count : 1;
  const count = ix?.count ?? p.count;
  const out = new Float32Array(count * instances * 3), v = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (let instance = 0; instance < instances; instance++) {
    if (instanced.isInstancedMesh) instanced.getMatrixAt(instance, matrix); else matrix.identity();
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(p, ix ? ix.getX(i) : i).applyMatrix4(matrix);
      v.toArray(out, (instance * count + i) * 3);
    }
  }
  return out;
}
function geometry(data: DecalSoup, tangents: number[], params: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  g.setAttribute('stainTangent', new THREE.Float32BufferAttribute(tangents, 3));
  g.setAttribute('stainData', new THREE.Float32BufferAttribute(params, 4));
  return g;
}

/** The only Three boundary: extract local triangles, transform queries, upload
 * pure projected geometry and bind WGSL to the room's existing light list. */
export function createSurfaceBloodView(opts: {
  scene: THREE.Scene; level: THREE.Group; sim: BloodSim; renderer: THREE.WebGPURenderer;
  lightsFor(mesh: THREE.Mesh): THREE.MeshStandardNodeMaterial['lightsNode'];
  roomFor(mesh: THREE.Mesh): number;
}): SurfaceBloodView {
  const state = createStains(), receivers: Receiver[] = [], group = new THREE.Group();
  group.name = 'persistent-surface-blood'; group.visible = false; opts.scene.add(group);
  const clock = uniform(0), drySeconds = uniform(120);
  const materials = new Map<number, THREE.MeshStandardNodeMaterial>();
  let built = false, revision = -1, vertices = 0, clipped = 0;
  const cached = new Map<number, { signature: string; soup: DecalSoup }>();
  const worldBox = new THREE.Box3(), fromV = new THREE.Vector3(), toV = new THREE.Vector3(), normalV = new THREE.Vector3();
  function material(receiver: THREE.Mesh, room: number): THREE.MeshStandardNodeMaterial {
    const old = materials.get(room); if (old) return old;
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    m.name = 'surface-blood-wetness';
    const data = attribute('stainData', 'vec4');
    const colour = vec4(surfaceFn({ p: uv(), data, clock, drySeconds }) as never);
    m.colorNode = colour;
    m.roughnessNode = float(roughFn({ data, clock, drySeconds }) as never);
    m.normalNode = transformNormalToView(normalFn({ p: uv(), data, n: normalLocal, tangent: attribute('stainTangent', 'vec3') }));
    m.outputNode = finishFn({ lit: output });
    m.lightsNode = opts.lightsFor(receiver);
    // A small dark-red readability floor, consistent with the airborne goo.
    m.emissive.setRGB(0.018, 0.0007, 0.0012);
    materials.set(room, m); return m;
  }
  function build() {
    if (built) return; built = true;
    opts.level.updateMatrixWorld(true);
    opts.level.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.skipLevelLights || mesh.userData.sway || !mesh.visible) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some(m => m.transparent || m.opacity < 0.99)) return;
      const positions = soup(mesh); if (!positions.length) return;
      const index = indexTriangles(positions), room = opts.roomFor(mesh);
      const decal = new THREE.Mesh(geometry({ positions: [], normals: [], uvs: [] }, [], []), material(mesh, room));
      decal.name = `surface-blood:${mesh.name || receivers.length}`;
      decal.matrixAutoUpdate = false; decal.frustumCulled = false; decal.renderOrder = 2;
      decal.receiveShadow = mesh.receiveShadow;
      decal.visible = false; group.add(decal);
      receivers.push({ id: receivers.length, mesh, index, inverse: new THREE.Matrix4(), bounds: new THREE.Box3(), decal, room });
    });
    transforms();
  }
  function transforms() {
    for (const r of receivers) {
      r.mesh.updateWorldMatrix(true, false);
      r.inverse.copy(r.mesh.matrixWorld).invert();
      r.bounds.min.fromArray(r.index.root.min); r.bounds.max.fromArray(r.index.root.max);
      r.bounds.applyMatrix4(r.mesh.matrixWorld);
      r.decal.matrix.copy(r.mesh.matrixWorld);
      r.decal.matrixWorldNeedsUpdate = true;
      r.decal.visible = r.decal.geometry.getAttribute('position').count > 0 && r.mesh.visible;
    }
  }
  const panel = document.createElement('details');
  panel.style.cssText = 'position:fixed;left:12px;bottom:85px;z-index:30;background:#171416e8;color:#ddd;padding:8px 10px;font:12px monospace;border:1px solid #653039;max-width:245px';
  panel.innerHTML = '<summary>Surface blood · candidate</summary><label style="display:block;margin:8px 0"><input type="checkbox"> Persistent stains</label><label>Look <select><option value="auto">Impact-driven</option><option value="wet">Wet splatter</option><option value="dry">Dry stain</option><option value="smear">Smear</option></select></label><div style="margin-top:8px"><button>Clear stains</button></div>';
  document.body.append(panel);
  const checkbox = panel.querySelector('input')!, select = panel.querySelector('select')!;
  const view: SurfaceBloodView = {
    enabled: false, look: 'auto', group,
    setEnabled(on) {
      view.enabled = on; checkbox.checked = on;
      if (on) build(); group.visible = on;
    },
    setLook(look) { view.look = look; select.value = look; },
    clear() { clearStains(state); clock.value = state.clock; cached.clear(); view.sync(); },
    advance(dt) {
      if (view.enabled) { state.clock += Math.max(0, dt); clock.value = state.clock; transforms(); }
    },
    sweep(from, to) {
      if (!view.enabled) return null;
      worldBox.setFromPoints([fromV.fromArray(from), toV.fromArray(to)]).expandByScalar(1e-5);
      let best: SurfaceHit | null = null;
      for (const r of receivers) {
        if (!r.mesh.visible || !worldBox.intersectsBox(r.bounds)) continue;
        const a = fromV.fromArray(from).applyMatrix4(r.inverse).toArray() as unknown as Vec3;
        const b = toV.fromArray(to).applyMatrix4(r.inverse).toArray() as unknown as Vec3;
        const hit = sweepTriangles(r.index, a, b, r.id);
        if (!hit || (best && hit.t >= best.t)) continue;
        best = { ...hit, pos: fromV.fromArray(hit.pos).applyMatrix4(r.mesh.matrixWorld).toArray() as unknown as Vec3,
          normal: normalV.fromArray(hit.normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(r.mesh.matrixWorld)).normalize().toArray() as unknown as Vec3 };
      }
      return best;
    },
    deposit(hit, d) {
      const r = receivers[hit.receiver]; if (!r) return;
      const at = fromV.fromArray(hit.pos).applyMatrix4(r.inverse).toArray() as unknown as Vec3;
      const normal = normalV.fromArray(hit.normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(r.inverse)).normalize().toArray() as unknown as Vec3;
      // Linear velocity transformed without normalising away impact speed.
      const velocity = toV.fromArray(d.vel).applyMatrix3(new THREE.Matrix3().setFromMatrix4(r.inverse)).toArray() as unknown as Vec3;
      depositStain(state, { ...hit, pos: at, normal }, velocity, d.size, view.look);
    },
    burst(from, to, count = 24) {
      if (!view.enabled || ![...from, ...to].every(Number.isFinite)) return false;
      transforms(); const hit = view.sweep(from, to); if (!hit) return false;
      const n = new THREE.Vector3().fromArray(hit.normal), u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const v = new THREE.Vector3().crossVectors(n, u);
      for (let i = 0; i < Math.max(1, Math.min(80, count)); i++) {
        const angle = i * 2.399963, spread = Math.sqrt(i / count) * 0.35;
        const p = new THREE.Vector3().fromArray(hit.pos).addScaledVector(n, 0.18).addScaledVector(u, Math.cos(angle) * spread).addScaledVector(v, Math.sin(angle) * spread);
        const vel = n.clone().multiplyScalar(-3.5).addScaledVector(u, view.look === 'smear' ? 6 : 0);
        opts.sim.droplets.push({ pos: p.toArray() as [number, number, number], vel: vel.toArray() as [number, number, number], age: 0, life: 2, size: 0.05, kind: 'drop' });
      }
      // Same cap as emission, including a developer preview.
      while (opts.sim.droplets.length > 600) opts.sim.droplets.shift();
      return true;
    },
    sync() {
      if (!built || revision === state.revision) return;
      revision = state.revision; vertices = 0; clipped = 0;
      const ids = new Set(state.stains.map(s => s.id)); for (const id of cached.keys()) if (!ids.has(id)) cached.delete(id);
      for (const r of receivers) {
        const data: DecalSoup = { positions: [], normals: [], uvs: [] }, tangents: number[] = [], params: number[] = [];
        for (const d of state.stains) {
          if (d.receiver !== r.id) continue;
          const signature = `${d.width},${d.height}`;
          let entry = cached.get(d.id);
          if (!entry || entry.signature !== signature) { entry = { signature, soup: projectStain(r.index, d) }; cached.set(d.id, entry); }
          const count = entry.soup.positions.length / 3;
          if (count === 0 || vertices + count > MAX_VERTICES) { clipped++; continue; }
          data.positions.push(...entry.soup.positions); data.normals.push(...entry.soup.normals); data.uvs.push(...entry.soup.uvs);
          for (let i = 0; i < count; i++) { tangents.push(...d.tangent); params.push(d.seed, d.born, d.look === 'dry' ? 1 : d.look === 'smear' ? 2 : 0, 1); }
          vertices += count;
        }
        const old = r.decal.geometry; r.decal.geometry = geometry(data, tangents, params); old.dispose();
        r.decal.visible = data.positions.length > 0;
      }
    },
    stats: () => ({ enabled: view.enabled, stains: state.stains.length, vertices, receivers: receivers.length,
      triangles: receivers.reduce((n, r) => n + r.index.triangles, 0), merged: state.merged, evicted: state.evicted, clipped, clock: state.clock, look: view.look }),
    snapshot: () => state.stains.map(d => {
      const r = receivers[d.receiver]!;
      return { id: d.id, receiver: r.mesh.name, pos: new THREE.Vector3().fromArray(d.pos).applyMatrix4(r.mesh.matrixWorld).toArray() as unknown as Vec3,
        normal: new THREE.Vector3().fromArray(d.normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(r.mesh.matrixWorld)).normalize().toArray() as unknown as Vec3, look: d.look };
    }),
    async precompile(camera) {
      if (!view.enabled) return;
      const warmScene = new THREE.Scene();
      const data = { positions: [-0.1, 0, 0, 0.1, 0, 0, 0, 0.1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], uvs: [-1, -1, 1, -1, 0, 1] };
      const g = geometry(data, [1, 0, 0, 1, 0, 0, 1, 0, 0], [0.5, 0, 0, 1, 0.5, 0, 0, 1, 0.5, 0, 0, 1]);
      for (const m of materials.values()) {
        const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; warmScene.add(mesh);
      }
      try { await opts.renderer.compileAsync(warmScene, camera); } finally { g.dispose(); }
    },
    panelVisible(on) { panel.style.display = on ? '' : 'none'; },
    dispose() {
      panel.remove(); group.removeFromParent(); for (const r of receivers) r.decal.geometry.dispose();
      for (const m of materials.values()) m.dispose(); receivers.length = 0; materials.clear(); cached.clear();
    },
  };
  checkbox.onchange = () => view.setEnabled(checkbox.checked);
  select.onchange = () => view.setLook(select.value as StainLook);
  panel.querySelector('button')!.onclick = () => view.clear();
  return view;
}
