// src/lab/sdf-zombie/lab-main.ts
import * as THREE from 'three';
import { createRenderer } from '../../engine/renderer';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { ZOMBIE } from './body';
import { createZombieView } from './zombie';
import { FLESH_PRESETS, LIGHT_PRESETS, type FleshMaterial, type FleshPresetName, type LightPresetName } from './material';
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

const body = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, loadOverride());
const errorsEl = document.getElementById('errors');
if (errorsEl) errorsEl.textContent = body.errors.join('\n');

const view = createZombieView(body);
view.applyMaterial(FLESH_PRESETS['henenlotter-latex'], LIGHT_PRESETS['practical-hard-key']);
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

import {
  addButton, addSection, addSelect, addSlider, clearOverride,
  loadOverride, saveOverride, serializeOverride, MATERIAL_SLIDERS,
} from './panel';

const panelEl = document.getElementById('panel')!;
let override = loadOverride();
let flesh: FleshMaterial = { ...FLESH_PRESETS['henenlotter-latex'] };
let light: LightPresetName = 'practical-hard-key';

function reapply() {
  view.applyMaterial(flesh, LIGHT_PRESETS[light]);
}

const presetBox = addSection(panelEl, 'presets');
addSelect(presetBox, 'flesh', Object.keys(FLESH_PRESETS), 'henenlotter-latex', (v) => {
  flesh = { ...FLESH_PRESETS[v as FleshPresetName] };
  reapply();
  rebuildMaterialSliders();
});
addSelect(presetBox, 'light', Object.keys(LIGHT_PRESETS), light, (v) => {
  light = v as LightPresetName;
  reapply();
});

const matBox = addSection(panelEl, 'material');
function rebuildMaterialSliders() {
  matBox.textContent = '';
  for (const s of MATERIAL_SLIDERS)
    addSlider(matBox, {
      label: s.key, min: s.min, max: s.max, step: 0.005,
      get: () => flesh[s.key] as number,
      set: (v) => { (flesh[s.key] as number) = v; reapply(); },
    });
}
rebuildMaterialSliders();

const bodyBox = addSection(panelEl, 'body');
addSlider(bodyBox, {
  label: 'global blendK', min: 0.005, max: 0.2, step: 0.001,
  get: () => current.prims[0]?.blendK ?? 0.06,
  set: (v) => {
    override = { ...override, primBlendK: Object.fromEntries(current.prims.map((_, i) => [i, v])) };
    rebuildBody();
  },
});

const actionBox = addSection(panelEl, 'actions');
addButton(actionBox, 'respawn', () => { wounds = []; override = loadOverride(); rebuildBody(); });
addButton(actionBox, 'copy override JSON', () => {
  void navigator.clipboard.writeText(serializeOverride(override));
});
addButton(actionBox, 'reset overrides', () => { clearOverride(); override = {}; rebuildBody(); });

function rebuildBody() {
  saveOverride(override);
  current = buildBody(ZOMBIE, DEFAULT_BUILD_OPTS, override);
  if (errorsEl) errorsEl.textContent = current.errors.join('\n');
  view.update(current);
  refreshWounds();
}

reapply();
