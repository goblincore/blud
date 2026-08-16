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
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  wgslFn, positionWorld, cameraPosition, vec4, uniform,
  cameraProjectionMatrix, cameraViewMatrix, normalize, sub, mul, add,
} from 'three/tsl';
import { createLabRenderer } from './lab-renderer';

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

// Deliberately INTERSECTING the sphere. A cube merely next to it would prove
// nothing: two objects can look correct side by side while depth is wrong.
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
);
refCube.position.set(0.28, 1.0, 0.28);
scene.add(refCube);

// --- The raymarched sphere --------------------------------------------------
const SPHERE_CENTRE = new THREE.Vector3(0, 1.0, 0);
const SPHERE_RADIUS = 0.5;

const uCentre = uniform(SPHERE_CENTRE);
const uRadius = uniform(SPHERE_RADIUS);

/**
 * Sphere-trace a single sphere and shade it.
 *
 * WGSL, not TSL nodes, and that is the deliberate choice the spec argues for:
 * the real march.glsl.ts translates to WGSL almost line for line, whereas a
 * node graph would be a redesign wearing a port's clothing — and it would
 * destroy the readability that lets validate.ts's CPU mirror be diffed against
 * the GPU field by eye. Nothing in this repo can check that mirror
 * automatically, and it backs click-to-shoot.
 */
const marchSphere = wgslFn(`
  fn marchSphere(
    worldPos: vec3<f32>,
    camPos: vec3<f32>,
    centre: vec3<f32>,
    radius: f32
  ) -> vec4<f32> {
    let rd = normalize(worldPos - camPos);
    let tMax = length(worldPos - camPos);

    var t = 0.0;
    var hit = false;
    for (var i = 0; i < 96; i = i + 1) {
      let p = camPos + rd * t;
      let d = length(p - centre) - radius;
      if (d < 0.0015) { hit = true; break; }
      t = t + d;
      if (t > tMax) { break; }
    }
    if (!hit) { discard; }

    let p = camPos + rd * t;
    let n = normalize(p - centre);
    let L = normalize(vec3<f32>(0.45, 0.72, 0.53));
    let diff = max(dot(n, L), 0.0);
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    let col = vec3<f32>(0.82, 0.44, 0.46) * (0.08 + diff * 1.6) + vec3<f32>(0.4, 0.2, 0.25) * rim;

    // w carries the hit distance so the depth node can reuse it without
    // marching a second time.
    return vec4<f32>(col, t);
  }
`);

const marched = marchSphere({
  worldPos: positionWorld,
  camPos: cameraPosition,
  centre: uCentre,
  radius: uRadius,
});

const material = new MeshBasicNodeMaterial();
material.side = THREE.BackSide; // survive the camera entering the proxy box
material.colorNode = vec4(marched.xyz, 1.0);

// --- Depth. The whole point of the spike ------------------------------------
//
// Without this the sphere composites at the PROXY BOX's depth, not the hit's,
// so an intersecting cube draws entirely over it. The march already returns
// the hit distance in .w, so reconstruct the hit point and project it rather
// than marching a second time.
//
// NOTE the difference from the GLSL version: WebGPU's clip space is already
// z in [0,1], where OpenGL's is [-1,1]. The GLSL shader ends with
// `(clip.z / clip.w) * 0.5 + 0.5`; that remap must NOT be carried over here or
// everything composites at the wrong depth.
const rayDir = normalize(sub(positionWorld, cameraPosition));
const hitPos = add(cameraPosition, mul(rayDir, marched.w));
const clip = mul(cameraProjectionMatrix, mul(cameraViewMatrix, vec4(hitPos, 1.0)));
material.depthNode = clip.z.div(clip.w);
material.depthWrite = true;

const proxy = new THREE.Mesh(
  new THREE.BoxGeometry(SPHERE_RADIUS * 2.4, SPHERE_RADIUS * 2.4, SPHERE_RADIUS * 2.4),
  material,
);
proxy.position.copy(SPHERE_CENTRE);
proxy.frustumCulled = false; // the proxy IS the bound; don't double-cull
scene.add(proxy);

say('sphere material built');

// --- Orbit, matching the WebGL lab's controls -------------------------------
let camYaw = 0.35;
let camPitch = 0.15;
let camDist = 2.6;
const camTarget = new THREE.Vector3(0, 1.0, 0);
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
