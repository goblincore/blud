// src/lab/sdf-zombie/webgl-bench.ts
//
// WebGL twin of the WebGPU spike, existing ONLY so the two renderers can be
// compared fairly.
//
// It deliberately does NOT run the verlet rig, wounds, gibs, the face texture
// or the tuning panel — the WebGPU port has none of those yet, and comparing
// the full lab against the spike would measure the feature gap rather than the
// renderer. Same scene, same body, same spawner, same timing. Only the renderer
// differs.

import * as THREE from 'three';
import { createRenderer } from '../../engine/renderer';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';
import { createZombieView } from './zombie';
import { translateBody } from './translate';
import { FLESH_PRESETS, LIGHT_PRESETS } from './material';

const mount = document.getElementById('app');
if (!mount) throw new Error('#app not found');

const statusEl = document.getElementById('status');
const line = (t: string) => {
  const d = document.createElement('div');
  d.textContent = t;
  statusEl?.appendChild(d);
  return d;
};

const handle = createRenderer(mount);
const { renderer, scene, camera } = handle;
line('backend: webgl');

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.5, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
);
refCube.position.set(0.6, 0.25, 0.3);
scene.add(refCube);

const body = buildBody(makeZombie({ ...DEFAULT_FACE }), DEFAULT_BUILD_OPTS);
line(`body: ${body.prims.length} prims, ${body.clusters.length} clusters`);

const views: ReturnType<typeof createZombieView>[] = [];
const countEl = line('bodies: 0');
const fpsEl = line('');

function setBodyCount(n: number) {
  while (views.length > n) {
    const v = views.pop();
    if (v) scene.remove(v.object);
  }
  while (views.length < n) {
    const i = views.length;
    const col = i % 5;
    const row = Math.floor(i / 5);
    // Translate the FIELD, not the mesh — see translate.ts.
    const v = createZombieView(translateBody(body, [(col - 2) * 0.62, 0, -row * 0.85]));
    v.applyMaterial(FLESH_PRESETS['henenlotter-latex'], LIGHT_PRESETS['practical-hard-key']);
    scene.add(v.object);
    views.push(v);
  }
  countEl.textContent = `bodies: ${views.length}`;
}
setBodyCount(Number(new URLSearchParams(location.search).get('n') ?? 1));

// Camera fixed to the spike's starting view, so both benches cover the same
// screen area — coverage is the cost driver, so an unequal framing would
// invalidate the comparison outright.
const camYaw = 0.35;
const camPitch = 0.12;
const camDist = 2.4;
const camTarget = new THREE.Vector3(0, 1.05, 0);

const frames: number[] = [];
let lastStamp = performance.now();

handle.setRenderCallback(() => {
  const now = performance.now();
  frames.push(now - lastStamp);
  lastStamp = now;
  if (frames.length > 120) frames.shift();
  if (frames.length > 20) {
    const s = [...frames].sort((a, b) => a - b);
    const med = s[Math.floor(s.length * 0.5)]!;
    const p95 = s[Math.floor(s.length * 0.95)]!;
    fpsEl.textContent = `${med.toFixed(1)} / ${p95.toFixed(1)} ms  (${(1000 / med).toFixed(0)} fps)`;
  }

  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(camTarget);
});

void renderer;

(window as unknown as { __sdfBench: unknown }).__sdfBench = {
  backend: 'webgl',
  setBodyCount,
  stats() {
    const s = [...frames].sort((a, b) => a - b);
    return s.length < 20 ? null : {
      median: +s[Math.floor(s.length * 0.5)]!.toFixed(2),
      p95: +s[Math.floor(s.length * 0.95)]!.toFixed(2),
      bodies: views.length,
    };
  },
};
