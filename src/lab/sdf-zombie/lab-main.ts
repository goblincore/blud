// src/lab/sdf-zombie/lab-main.ts
import * as THREE from 'three';
import { createRenderer } from '../../engine/renderer';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { createZombieView } from './zombie';
import {
  MAX_WOUNDS,
  pushWound,
  woundWorldPos,
  worldHitToWound,
  type Wound,
  type WoundType,
} from './damage';
import { sdBody } from './validate';
import { severLimb } from './sever';
import { CLUSTER_ORDER, type LimbId } from './types';
import type { Vec3 } from './types';

const mount = document.getElementById('app');
if (!mount) throw new Error('#app not found');

const { renderer, scene, camera } = createRenderer(mount);

// Ground plane — a polygonal surface the raymarched blobs must composite against.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x3a2a30, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// A reference cube so depth interleaving is obvious by eye.
const refCube = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x7080a0 }),
);
refCube.position.set(0.6, 0.2, 0.3);
scene.add(refCube);

camera.position.set(0, 1.4, 3.2);
camera.lookAt(0, 0.9, 0);

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS);
const errorsEl = document.getElementById('errors');
if (errorsEl) errorsEl.textContent = body.errors.join('\n');

const view = createZombieView(body);
scene.add(view.object);

let wounds: Wound[] = [];

const TYPE_ID: Record<WoundType, number> = { pellet: 0, blast: 1, burn: 2 };
const RADIUS: Record<WoundType, number> = { pellet: 0.055, blast: 0.13, burn: 0.08 };

/** Marches the CPU-side field along a ray to find where a shot lands. */
function raycastBody(origin: Vec3, dir: Vec3): Vec3 | null {
  let t = 0;
  for (let i = 0; i < 128 && t < 20; i++) {
    const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const d = sdBody(p, current);
    if (d < 0.002) return p;
    t += Math.max(d, 0.002);
  }
  return null;
}

function refreshWounds() {
  view.setWounds(
    wounds.map(w => woundWorldPos(current.prims, w)),
    wounds.map(w => w.radius),
    wounds.map(w => TYPE_ID[w.type]),
    wounds.map(w => w.ageSec),
  );
}

renderer.domElement.addEventListener('pointerdown', (ev: PointerEvent) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;

  const hit = raycastBody([o.x, o.y, o.z], [d.x, d.y, d.z]);
  if (!hit) return;

  const type: WoundType = ev.shiftKey ? 'blast' : ev.altKey ? 'burn' : 'pellet';
  wounds = pushWound(wounds, worldHitToWound(current.prims, hit, RADIUS[type], type), MAX_WOUNDS);
  refreshWounds();
});

// Sever keys: clear a cluster's alive flag; the field and proxy re-fit on the
// next view.update(). 2 is deliberately absent — torso must never sever.
let current = body;
const SEVER_KEYS: Record<string, LimbId> = { '1': 'head', '3': 'armL', '4': 'armR', '5': 'legL', '6': 'legR' };

window.addEventListener('keydown', (ev) => {
  const limb = SEVER_KEYS[ev.key];
  if (!limb) return;
  const { body: next, stumpWound } = severLimb(current, limb);
  current = next;
  if (stumpWound) wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
  view.update(current);
  refreshWounds();
});
