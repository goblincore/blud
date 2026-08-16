// src/lab/sdf-zombie/webgpu/spike-main.ts
//
// WebGPU Phase 0 spike — the go/no-go for the whole migration.
//
// Deliberately minimal: a proxy box sphere-tracing ONE hardcoded sphere in
// WGSL, writing depth so it composites against ordinary polygonal geometry.
// No body, no clusters, no wounds. The point is to prove the four things that
// the real port depends on, in the order they can fail:
//
//   1. WebGPURenderer initialises and is actually on the WebGPU backend
//      (it falls back to WebGL2 silently, and "it worked" on the fallback is
//      not evidence the WebGPU path works).
//   2. A WGSL fragment function can be attached to a material at all.
//   3. It can sphere-trace and shade.
//   4. It can write depth, and that depth INTERLEAVES correctly with a floor
//      and a reference cube.
//
// Step 4 is the one that matters and the one that was skipped last time. The
// original lab's task 2 existed precisely to prove depth write visually, was
// never checked, and three render bugs then survived eight consecutive green
// tasks while the fragment shader failed to link and the page drew nothing.

// From 'three/webgpu', never 'three' — see the note in lab-renderer.ts.
// Two copies of three means the node system cannot see the lights.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createZombieGpuView } from './zombie-gpu';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { DEFAULT_FACE, type FaceParams } from '../face';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';

// Everything lives inside an async bootstrap rather than using top-level
// await. WebGPURenderer needs `await renderer.init()`, and the project's build
// target predates top-level await — raising it would be a project-wide change
// for a lab-only spike. This is the "module top-level work moves inside an
// async bootstrap" consequence the WebGPU spec called out.
async function main() {
const mount = document.getElementById('app');
if (!mount) throw new Error('#app not found');

const statusEl = document.getElementById('status');
const say = (msg: string, bad = false) => {
  if (!statusEl) return;
  const line = document.createElement('div');
  line.textContent = msg;
  if (bad) line.style.color = '#ff6464';
  statusEl.appendChild(line);
};

const handle = await createLabRenderer(mount);
const { scene, camera } = handle;
say(`backend: ${handle.backend}`, handle.backend !== 'webgpu');

// --- Polygonal reference geometry, so depth interleaving is visible ---------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Kept from the sphere spike: depth compositing against real polygonal
// geometry is the property most likely to break silently in the port.
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
);
refCube.position.set(0.6, 0.25, 0.3);
scene.add(refCube);

// --- The real zombie --------------------------------------------------------
// Built by the SAME pure modules the WebGL lab uses — build-body, clusters,
// pack, validate, face. Only the rendering tail differs, so the field maths
// cannot diverge between the two paths.
const face: FaceParams = { ...DEFAULT_FACE };
const body = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS);
say(`body: ${body.prims.length} prims, ${body.clusters.length} clusters`);
if (body.errors.length) say(body.errors.join(' | '), true);

const view = createZombieGpuView(body);
view.applyMaterial(FLESH_PRESETS['henenlotter-latex'], LIGHT_PRESETS['practical-hard-key']);
scene.add(view.object);
say('body material built');

// --- Orbit, matching the WebGL lab's controls -------------------------------
let camYaw = 0.35;
let camPitch = 0.12;
let camDist = 2.4;
const camTarget = new THREE.Vector3(0, 1.05, 0);
let dragging = false;
let lastX = 0;
let lastY = 0;

const canvas = handle.canvas;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false; canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.008;
  camPitch = Math.max(-0.4, Math.min(1.2, camPitch + (e.clientY - lastY) * 0.006));
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  camDist = Math.max(0.9, Math.min(8, camDist + Math.sign(e.deltaY) * 0.2));
}, { passive: true });

handle.setRenderCallback(() => {
  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(camTarget);
});

say('running');

(window as unknown as { __sdfSpike: unknown }).__sdfSpike = {
  backend: handle.backend,
  setCam(yaw: number, pitch: number, dist: number) {
    camYaw = yaw; camPitch = pitch; camDist = dist;
  },
};
}

// A rejected bootstrap would otherwise be an unhandled promise and the page
// would just sit blank — the exact failure mode this spike exists to avoid.
main().catch((err) => {
  const el = document.getElementById('status');
  if (el) {
    const line = document.createElement('div');
    line.style.color = '#ff6464';
    line.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
    el.appendChild(line);
  }
  console.error('[sdf-spike] bootstrap failed', err);
});
