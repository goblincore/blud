// src/lab/sdf-zombie/lab-main.ts
import * as THREE from 'three';
import { createRenderer } from '../../engine/renderer';
import { buildBody, DEFAULT_BUILD_OPTS } from './build-body';
import { makeZombie } from './body';
import { DEFAULT_FACE, type FaceParams } from './face';
import { createZombieView } from './zombie';
import {
  FLESH_PRESETS, LIGHT_PRESETS,
  type FleshMaterial, type FleshPresetName, type LightPresetName,
} from './material';
import {
  MAX_WOUNDS, pushWound, woundWorldPos, worldHitToWound,
  type Wound, type WoundType,
} from './damage';
import { sdBody } from './validate';
import { severLimb, gibAll } from './sever';
import { bindRig, applyRig, impulseAt } from './rig-bind';
import { stepRig } from './rig';
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';
import { chunkExtent, createChunkView, type ChunkView } from './zombie';
import type { LimbId, Vec3 } from './types';
import {
  addButton, addSection, addSelect, addSlider, clearOverride,
  loadOverride, saveOverride, serializeOverride, MATERIAL_SLIDERS, FACE_SLIDERS,
} from './panel';
import { createPostFxComposer } from '../../vfx/post-fx/composer';
import { PostFxBus } from '../../vfx/post-fx/post-fx-bus';
import { DEFAULT_POST_FX } from '../../vfx/post-fx/config';

const mount = document.getElementById('app');
if (!mount) throw new Error('#app not found');

const handle = createRenderer(mount);
const { renderer, scene, camera } = handle;

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

// ---------------------------------------------------------------------------
// Post-FX. The lab ran WITHOUT this until 2026-08-15: createRenderer exposes
// setDrawFn to swap in an EffectComposer and only src/main.ts ever called it,
// so the lab drew straight to the screen with no Bayer dither, no BLOOD.PAL
// snap, no scanlines. The lab spec promised the opposite and warned that a
// raymarcher judged in a clean viewport would lie about how it looks in Blud.
// It did — every look judgment recorded before this date was made through the
// wrong chain.
//
// `postCfg` is re-read by the composer every frame, so live mutation works.
// ---------------------------------------------------------------------------
const postCfg = structuredClone(DEFAULT_POST_FX);
const postBus = new PostFxBus(postCfg.ca.baseline);
const composer = createPostFxComposer(renderer, scene, camera, postBus, postCfg);
// Defaults OFF. The chain is correct, but every flesh preset in material.ts
// was hand-tuned to compensate for the missing gamma encode described above,
// so through the correct pipeline they read far too bright. Until the presets
// are retuned, judging surface work with this on would compare new geometry
// against a knowingly-wrong material. Toggle it in the panel to check the
// palette look.
let postEnabled = false;

function installDrawFn() {
  handle.setDrawFn(
    postEnabled
      ? () => composer.render(0, performance.now() / 1000)
      : () => renderer.render(scene, camera),
  );
}
installDrawFn();

// createRenderer's own resize handler knows nothing about the composer.
function sizeComposer() {
  composer.setSize(renderer.domElement.width, renderer.domElement.height);
}
sizeComposer();
window.addEventListener('resize', sizeComposer);

let override = loadOverride();
let face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
const body = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
const errorsEl = document.getElementById('errors');
if (errorsEl) errorsEl.textContent = body.errors.join('\n');

let flesh: FleshMaterial = { ...FLESH_PRESETS['henenlotter-latex'] };
let light: LightPresetName = 'practical-hard-key';

const view = createZombieView(body);
view.applyMaterial(flesh, LIGHT_PRESETS[light]);
scene.add(view.object);
// Chunks clone this at sever time so they shade like the body did when cut.
const viewMaterialTemplate = view.material;

/** The live body — replaced on sever and on any override edit. */
let current = body;

let bound = bindRig(current);
// Rebind whenever the body itself changes (sever, override edit).
function rebind() { bound = bindRig(current); }

// ---------------------------------------------------------------------------
// Wounds
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Orbit camera. EITHER button drags to orbit; a left press that does not travel
// far enough to count as a drag fires a shot instead (see the pointerup handler
// under "Shooting"). Binding orbit to right-drag alone left the lab effectively
// undriveable on a trackpad, where right-drag is a two-finger contortion.
// ---------------------------------------------------------------------------
let camYaw = 0.35;
let camPitch = 0.12;
let camDist = 2.4;
const camTarget = new THREE.Vector3(0, 1.05, 0);
let dragging = false;
let lastX = 0;
let lastY = 0;
/** Cursor travel since pointerdown, in px. Under the threshold, it was a click. */
let dragTravel = 0;
const DRAG_SLOP = 5;
// Slow auto-spin until the first interaction, so the silhouette reads without
// the viewer having to discover the controls.
let autoSpin = true;

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  autoSpin = false;
  if (e.button !== 0 && e.button !== 2) return;
  dragging = true;
  dragTravel = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  dragTravel += Math.hypot(dx, dy);
  // Below the slop threshold the press is still a candidate shot, so don't
  // swing the camera out from under the shooter's aim.
  if (dragTravel < DRAG_SLOP) return;
  camYaw -= dx * 0.008;
  camPitch = Math.max(-0.5, Math.min(1.3, camPitch + dy * 0.006));
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener(
  'wheel',
  (e) => { camDist = Math.max(0.8, Math.min(8, camDist + Math.sign(e.deltaY) * 0.2)); },
  { passive: true },
);

handle.setRenderCallback((dt) => {
  // Gib physics: step every chunk, then re-pack its world-space uniforms.
  // NOTE: this lives in the SAME callback as the camera — setRenderCallback
  // replaces rather than appends, so a second call would silently kill one.
  for (const c of chunks) {
    c.state = stepChunk(c.state, dt);
    c.view.update(c.state);
  }

  // Drive the flesh: settle the rig toward its rest pose, push the result back
  // into the primitives, and re-upload. This is what makes the body deform —
  // and what makes rest-space wounds observable, since they ride the flesh.
  bound = {
    ...bound,
    rig: stepRig(bound.rig, Math.min(dt, 1 / 30), {
      gravity: [0, -2.2, 0],
      damping: 0.06,
      iterations: 4,
      restStiffness: 0.18,
    }),
  };
  const posed = applyRig(current, bound);
  view.update(posed);
  view.setWounds(
    wounds.map(w => woundWorldPos(posed.prims, w)),
    wounds.map(w => w.radius),
    wounds.map(w => TYPE_ID[w.type]),
    wounds.map(w => w.ageSec),
  );

  if (autoSpin) camYaw += dt * 0.35;
  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(camTarget);
});

// ---------------------------------------------------------------------------
// Shooting — left button only. Shift = blast, Alt = burn.
//
// Fires on pointerUP rather than down, because the same button also orbits:
// a press that travelled further than DRAG_SLOP was a camera drag and must not
// also put a hole in the zombie.
// ---------------------------------------------------------------------------
canvas.addEventListener('pointerup', (ev: PointerEvent) => {
  if (dragging) {
    dragging = false;
    canvas.releasePointerCapture(ev.pointerId);
  }
  if (ev.button !== 0 || dragTravel >= DRAG_SLOP) return;
  const rect = canvas.getBoundingClientRect();
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
  // A hit shoves the nearest joint along the shot direction — the rest-pose
  // pull springs it back, so the limb visibly recoils and lags.
  const push = type === 'blast' ? 0.10 : 0.04;
  bound = impulseAt(bound, hit, [d.x * push, d.y * push, d.z * push]);
  refreshWounds();
});

// Sever keys: clear a cluster's alive flag; the field and proxy re-fit on the
// next view.update(). 2 is deliberately absent — torso must never sever.
const SEVER_KEYS: Record<string, LimbId> = {
  '1': 'head', '3': 'armL', '4': 'armR', '5': 'legL', '6': 'legR',
};

const chunks: { state: Chunk; view: ChunkView }[] = [];

/** Chunks are disposed oldest-first past this, so a long session can't leak. */
const MAX_CHUNKS = 24;

/** The endpoint of `prims` nearest `toward` — i.e. where the limb tore away. */
function attachPoint(prims: typeof current.prims, toward: Vec3): Vec3 {
  let best: Vec3 = prims[0]!.a;
  let bestD = Infinity;
  for (const p of prims)
    for (const e of [p.a, p.b]) {
      const dx = e[0] - toward[0], dy = e[1] - toward[1], dz = e[2] - toward[2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    }
  return best;
}

function torsoCentre(): Vec3 {
  return current.clusters.find(c => c.limb === 'torso')?.center ?? [0, 1.1, 0];
}

function spawnChunk(
  limb: LimbId, origin: Vec3, prims: typeof current.prims,
  vel?: Vec3, tornAt?: Vec3,
) {
  if (prims.length === 0) return;
  const v: Vec3 = vel ?? [
    (Math.random() - 0.5) * 3.2,
    1.8 + Math.random() * 2.2,
    (Math.random() - 0.5) * 3.2,
  ];
  // Collision radius = the limb's real visual extent (the plan's hardcoded
  // 0.14 is smaller than any limb and would bury it half-way into the floor).
  const state = makeChunk(limb, origin, v, chunkExtent(prims, origin));
  const view = createChunkView(state, prims, viewMaterialTemplate, tornAt);
  scene.add(view.object);
  chunks.push({ state, view });

  while (chunks.length > MAX_CHUNKS) {
    const oldest = chunks.shift();
    if (!oldest) break;
    scene.remove(oldest.view.object);
    oldest.view.dispose();
  }
}

/** Blows the whole body apart — every live cluster becomes a chunk. */
function gibEverything() {
  const centre = torsoCentre();
  const { body: next, chunks: groups } = gibAll(current);
  for (const g of groups) {
    // Radial launch from the body centre, so the pile spreads instead of
    // every piece going the same way.
    const dx = g.origin[0] - centre[0];
    const dy = g.origin[1] - centre[1];
    const dz = g.origin[2] - centre[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    const speed = 2.4 + Math.random() * 2.0;
    const vel: Vec3 = [
      (dx / l) * speed + (Math.random() - 0.5) * 1.2,
      2.2 + Math.random() * 2.4,
      (dz / l) * speed + (Math.random() - 0.5) * 1.2,
    ];
    spawnChunk(g.limb, g.origin, g.prims, vel, attachPoint(g.prims, centre));
  }
  current = next;
  wounds = [];
  view.update(current);
  refreshWounds();
  rebind();
}

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'g' || ev.key === 'G') { gibEverything(); return; }
  const limb = SEVER_KEYS[ev.key];
  if (!limb) return;
  const { body: next, chunk, stumpWound } = severLimb(current, limb);
  if (chunk.prims.length === 0) return;
  current = next;
  if (stumpWound) wounds = pushWound(wounds, stumpWound, MAX_WOUNDS);
  spawnChunk(limb, chunk.origin, chunk.prims, undefined, attachPoint(chunk.prims, torsoCentre()));
  view.update(current);
  refreshWounds();
  rebind();
});

// ---------------------------------------------------------------------------
// Tuning panel
// ---------------------------------------------------------------------------
const panelEl = document.getElementById('panel')!;

function reapply() {
  view.applyMaterial(flesh, LIGHT_PRESETS[light]);
}

function rebuildBody() {
  override = { ...override, faceParams: face };
  saveOverride(override);
  current = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
  if (errorsEl) errorsEl.textContent = current.errors.join('\n');
  view.update(current);
  refreshWounds();
  rebind();
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
  label: 'global blendK', min: 0.004, max: 0.05, step: 0.001,
  get: () => current.prims[0]?.blendK ?? 0.012,
  set: (v) => {
    override = { ...override, primBlendK: Object.fromEntries(current.prims.map((_, i) => [i, v])) };
    rebuildBody();
  },
});

// Face. Sliders regenerate the face primitives and rebuild the body, so a
// param change alters which primitives exist rather than just their values.
const faceBox = addSection(panelEl, 'face');
for (const s of FACE_SLIDERS)
  addSlider(faceBox, {
    label: s.key, min: s.min, max: s.max, step: 0.001,
    get: () => face[s.key],
    set: (v) => { (face[s.key] as number) = v; rebuildBody(); },
  });

/** Locked three-quarter close-up on the skull, so face work needs no orbiting. */
function focusHead() {
  const skull = current.bones.get('skull');
  autoSpin = false;
  camTarget.set(0, skull ? (skull.head[1] + skull.tail[1]) / 2 : 1.55, 0);
  camYaw = 0.62;
  camPitch = 0.06;
  camDist = 0.52;
}

function focusBody() {
  autoSpin = false;
  camTarget.set(0, 1.05, 0);
  camYaw = 0.35;
  camPitch = 0.12;
  camDist = 2.4;
}

addButton(faceBox, 'focus head', focusHead);
addButton(faceBox, 'focus body', focusBody);

// Crater shape. Kept out of FleshMaterial because these describe damage
// geometry, not the surface — they change the field, not the shading.
const dmgBox = addSection(panelEl, 'damage');
const rimUniform = (name: string) =>
  view.material.uniforms[name] as { value: number };
for (const [key, label, min, max] of [
  ['uWoundBlendK', 'wound blendK', 0.002, 0.06],
  ['uRimSplay', 'rim splay', 0, 1.5],
  ['uRimOffset', 'rim offset', 0.8, 2.0],
  ['uRimWidth', 'rim width', 0.15, 1.2],
] as const)
  addSlider(dmgBox, {
    label, min, max, step: 0.005,
    get: () => rimUniform(key).value,
    set: (v) => { rimUniform(key).value = v; },
  });

const actionBox = addSection(panelEl, 'actions');
addButton(actionBox, 'respawn', () => {
  wounds = [];
  override = loadOverride();
  rebuildBody();
});
addButton(actionBox, 'copy override JSON', () => {
  void navigator.clipboard.writeText(serializeOverride(override));
});
addButton(actionBox, 'reset overrides', () => {
  clearOverride();
  override = {};
  rebuildBody();
});
// Without a bypass, debugging a surface bug means guessing whether an artifact
// came from the flesh shader or from the palette snap on top of it.
const postBtn = addButton(actionBox, `post-fx: ${postEnabled ? 'on' : 'off'}`, () => {
  postEnabled = !postEnabled;
  installDrawFn();
  postBtn.textContent = `post-fx: ${postEnabled ? 'on' : 'off'}`;
});

reapply();

// Dev handle for inspecting lab state from the console, and for driving the
// camera during automated visual checks. Lab-only; nothing in the game reads it.
(window as unknown as { __sdfLab: unknown }).__sdfLab = {
  get wounds() { return wounds; },
  get current() { return current; },
  /** Live post-fx config — mutate to isolate which pass causes an artifact. */
  postCfg,
  focusHead,
  focusBody,
  setPostEnabled(on: boolean) { postEnabled = on; installDrawFn(); },
  setCam(yaw: number, pitch: number, dist: number) {
    autoSpin = false;
    camYaw = yaw;
    camPitch = pitch;
    camDist = dist;
  },
};
