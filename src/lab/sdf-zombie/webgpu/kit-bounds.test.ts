// @vitest-environment happy-dom
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { precomputeKitBounds, updateKitBounds } from './kit-bounds';

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Write a random RIGID world matrix into every bone, the way kit-overlay's
 *  pose does (matrixWorld.compose with unit scale), perturbed about the bind
 *  pose so the result stays a plausible body. */
function poseRandom(bones: THREE.Bone[], bind: THREE.Matrix4[], rand: () => number, spread = 0.6) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const axis = new THREE.Vector3();
  bones.forEach((b, i) => {
    bind[i]!.decompose(p, q, s);
    axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, (rand() - 0.5) * Math.PI * 2);
    p.x += (rand() - 0.5) * spread; p.y += (rand() - 0.5) * spread; p.z += (rand() - 0.5) * spread;
    b.matrixWorld.compose(p, turn.multiply(q), one);
  });
}

/** Every vertex, skinned by three itself (mesh-local, i.e. the space
 *  computeBoundingSphere and the frustum test use), must lie in the sphere. */
function expectContainsAll(mesh: THREE.SkinnedMesh): number {
  const pos = mesh.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  const sphere = mesh.boundingSphere!;
  let worst = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    worst = Math.max(worst, v.distanceTo(sphere.center) - sphere.radius);
  }
  expect(worst).toBeLessThanOrEqual(1e-6);
  return worst;
}

function exactRadius(mesh: THREE.SkinnedMesh): number {
  const saved = mesh.boundingSphere;
  (mesh as { boundingSphere: THREE.Sphere | null }).boundingSphere = null;
  mesh.computeBoundingSphere();
  const r = mesh.boundingSphere!.radius;
  mesh.boundingSphere = saved;
  return r;
}

/** Synthetic rig: a 5-bone chain with a NON-identity bindMatrix (the mesh is
 *  offset and rotated in its parent) and vertices weighted to up to four bones. */
function syntheticMesh(): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[] } {
  const rand = rng(7);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Bone();
    b.position.set(i === 0 ? 0 : 0.1, i === 0 ? 1 : 0.4, 0.05 * i);
    if (i > 0) bones[i - 1]!.add(b);
    bones.push(b);
  }
  const n = 400;
  const position = new Float32Array(n * 3), skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    // Bone heads sit at y = 1.0, 1.4, … 2.6 (in the bind frame); weight each
    // vertex to up to four bones NEAR its height, as a real skin would.
    const y = 0.8 + rand() * 2;
    position.set([(rand() - 0.5) * 0.8, y, (rand() - 0.5) * 0.8], v * 3);
    const near = Math.min(4, Math.max(0, Math.round((y - 1) / 0.4)));
    const k = 1 + Math.floor(rand() * 4);
    const w = Array.from({ length: 4 }, (_, j) => (j < k ? rand() + 0.05 : 0));
    const sum = w.reduce((a, b) => a + b, 0);
    for (let j = 0; j < 4; j++) {
      skinIndex[v * 4 + j] = Math.min(4, Math.max(0, near + Math.floor(rand() * 3) - 1));
      skinWeight[v * 4 + j] = w[j]! / sum;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.position.set(3, 0, -2);
  root.rotation.y = 0.7;
  root.add(mesh, bones[0]!);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
  return { mesh, bones };
}

/** The real bride kit, parsed in node with its texture stripped (the loader
 *  would need a DOM for the image; geometry and skin are all we need). */
async function brideKit(): Promise<{ mesh: THREE.SkinnedMesh; bones: THREE.Bone[] }> {
  const json = JSON.parse(readFileSync('public/assets/lab/bride-kit.gltf', 'utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture;
  }
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  let mesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
  gltf.scene.updateMatrixWorld(true);
  return { mesh: mesh!, bones: mesh!.skeleton.bones as THREE.Bone[] };
}

describe('kit bone sphere', () => {
  for (const [name, make] of [['synthetic rig', async () => syntheticMesh()], ['bride kit', brideKit]] as const) {
    it(`${name}: contains every three-skinned vertex under random rigid poses`, async () => {
      const { mesh, bones } = await make();
      const pre = precomputeKitBounds(mesh);
      expect(pre.boneIdx.length).toBeGreaterThan(0);
      const bind = bones.map(b => b.matrixWorld.clone());
      // Rest pose first: tight enough to be useful.
      updateKitBounds(mesh, pre);
      expectContainsAll(mesh);
      expect(mesh.boundingSphere!.radius).toBeLessThanOrEqual(2 * exactRadius(mesh));
      const rand = rng(1234);
      for (let trial = 0; trial < 8; trial++) {
        poseRandom(bones, bind, rand);
        updateKitBounds(mesh, pre);
        expectContainsAll(mesh);
      }
    });
  }

  it('bride kit: skin weights are a convex combination (the containment argument needs it)', async () => {
    const { mesh } = await brideKit();
    const w = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < w.count; i++) {
      const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
      expect(Math.abs(s - 1)).toBeLessThan(1e-3);
    }
  });

  it('follows a walked-away soldier: the sphere moves with the bones', async () => {
    const { mesh, bones } = await brideKit();
    const pre = precomputeKitBounds(mesh);
    updateKitBounds(mesh, pre);
    const before = mesh.boundingSphere!.center.clone();
    const radius = mesh.boundingSphere!.radius;
    const walk = new THREE.Matrix4().makeTranslation(40, 0, -25);
    for (const b of bones) b.matrixWorld.premultiply(walk);
    updateKitBounds(mesh, pre);
    const moved = mesh.boundingSphere!.center.clone().sub(before);
    expect(moved.distanceTo(new THREE.Vector3(40, 0, -25))).toBeLessThan(1e-4);
    expect(mesh.boundingSphere!.radius).toBeCloseTo(radius, 5);
    expectContainsAll(mesh);
  });
});
