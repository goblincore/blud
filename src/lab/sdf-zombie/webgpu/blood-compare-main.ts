// src/lab/sdf-zombie/webgpu/blood-compare-main.ts
//
// THE HONEST SYNCHRONIZED COMPARISON PAGE (blood-surface comparison task,
// 2026-09-13).
//
// One canvas, one BloodSim, one blood state per frame. Variants are re-renders
// of the SAME simulation frame under different renderer settings, so a
// difference on screen cannot come from the two sides having simulated
// different droplets:
//
//   original              the shipped floored-nearest goo surface
//   original-connections  shipped surface + derived strands (sheets opt-in)
//   smooth                continuous reconstruction + AA silhouette coverage
//   smooth-connections    both candidates together
//
// Single view shows one variant full-frame. WIPE view renders two variants
// into two full-size offscreen targets and wipes B over A with a scissor at a
// chosen fraction — both sides keep full output resolution and equal aspect
// pixel sizes (an earlier scissored side-by-side squashed each 800x600 frame
// into half the canvas). The sim never advances between the two.
//
// It reuses the PRODUCTION functions — createGooLayer, createBloodSim, burst,
// spawnWoundDroplets, spawnImpactGout, stepBlood, connectionBlobsForSim,
// createBloodView — and applies the GAME defaults via goo-presets (which a
// source test keeps in sync with game-main). The blood VIEW is the game's own
// configuration: mist sprites and floor splats visible, beads/ribbons hidden
// while the goo carries the body. Only the scene is a fixture (grey-box floor,
// body proxy, obstacle), because booting the real dungeon here would add a
// second scene to keep in sync for no comparison value.
//
// RESOLUTION IS SPLIT, not conflated: the output canvas is a fixed 800x600,
// but the goo density grid is sized from a SEPARATE source grid (default
// 400x300, the game's march size) at the game's 0.5 density scale, so the
// reconstructed grid matches the game rather than the canvas.
//
// STARTS PAUSED: the animation loop is stopped after one present, and no GPU
// work happens again until Play or Step. WebGPU compile, visual parity and
// performance are NOT verified by this page's existence — it has to be looked
// at by a human on a GPU that is not busy training.

import * as THREE from 'three/webgpu';
import { uniform, texture, vec4 } from 'three/tsl';
import { createLabRenderer, type LabRendererHandle } from './lab-renderer';
import {
  createGooLayer, type GooLayer, type GooDensityBlob, type GooReconstruction,
} from './goo-layer';
import { applyGameGooDefaults } from './goo-presets';
import {
  createBloodSim, burst, spawnWoundDroplets, spawnImpactGout, stepBlood,
  type BloodSim,
} from '../blood-sim';
import { connectionBlobsForSim } from './blood-connections';
import { createBloodView, type BloodView } from './blood-view-gpu';

// -------------------------------------------------------------------------
// Variants
// -------------------------------------------------------------------------

export type VariantId = 'original' | 'original-connections' | 'smooth' | 'smooth-connections';

export interface Variant {
  id: VariantId;
  label: string;
  reconstruction: GooReconstruction;
  connections: boolean;
}

export const VARIANTS: Variant[] = [
  { id: 'original', label: 'Original', reconstruction: 'original', connections: false },
  { id: 'original-connections', label: 'Original + connections', reconstruction: 'original', connections: true },
  { id: 'smooth', label: 'Smooth', reconstruction: 'smooth', connections: false },
  { id: 'smooth-connections', label: 'Smooth + connections', reconstruction: 'smooth', connections: true },
];

function variantById(id: VariantId): Variant {
  return VARIANTS.find(v => v.id === id) ?? VARIANTS[0]!;
}

// -------------------------------------------------------------------------
// Sizes and the per-variant render order (both exported for CPU tests)
// -------------------------------------------------------------------------

/** The fixed output canvas. The goo surface composites here at full res. */
export const COMPARE_OUTPUT = { width: 800, height: 600 } as const;

export interface SourcePreset { id: string; label: string; width: number; height: number }

/**
 * The MARCH/SOURCE grid the goo density target is derived from. The game
 * marches at 400x300 and the density scale is 0.5, i.e. a 200x150 density
 * field; sizing this from the 800x600 canvas instead doubles the field and
 * makes every silhouette twice as fine as the game's. Exposed as a control so
 * the mismatch is visible rather than hidden.
 */
export const COMPARE_SOURCE_PRESETS: SourcePreset[] = [
  { id: '400x300', label: '400x300 (game march)', width: 400, height: 300 },
  { id: '200x150', label: '200x150 (half march)', width: 200, height: 150 },
  { id: '800x600', label: '800x600 (output size, NOT the game)', width: 800, height: 600 },
];

export interface VariantFrameDeps {
  gooLayer: GooLayer;
  sim: BloodSim;
  camera: THREE.PerspectiveCamera;
  /** Renders the fixture scene into `target` (null = canvas). Invoked from
   *  inside gooLayer.render()'s `between` hook, i.e. after density/blur and
   *  before the surface composite. */
  renderScene: (target: THREE.RenderTarget | null) => void;
}

/**
 * Apply one variant and render it. THE ORDER IS THE FIX for the empty-field
 * blocker: the variant's reconstruction and extra blobs are set FIRST, then
 * the camera's world matrices are refreshed, then the density instancer is
 * synced from the SAME sim + camera (no simulation step), and only then does
 * the goo layer render. Without the sync the instance matrices stay zeroed,
 * the density field is empty, and NO blood is drawn — for every variant.
 *
 * Exported so a mock test can pin the call order and object identity without
 * a GPU; the page calls this for every variant, single and wipe.
 */
export function renderVariantFrame(
  deps: VariantFrameDeps, v: Variant, extras: readonly GooDensityBlob[],
  target: THREE.RenderTarget | null,
): void {
  const { gooLayer, sim, camera, renderScene } = deps;
  gooLayer.setReconstruction(v.reconstruction);
  gooLayer.setExtraBlobs(extras);
  gooLayer.setOutputTarget(target);
  camera.updateMatrixWorld();
  gooLayer.sync(sim, camera);
  gooLayer.render(camera, () => { renderScene(target); });
}

type ScenarioId = 'burst' | 'jet' | 'overlap' | 'landing';
const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: 'burst', label: 'burst (moving droplets)' },
  { id: 'jet', label: 'jet (sustained wound)' },
  { id: 'overlap', label: 'overlap (two close gouts)' },
  { id: 'landing', label: 'landing (floor pools)' },
];

/** Local seeded RNG — the sim's own draw source on this page, so a seed
 *  reproduces the whole scenario. Not a rendering function; kept explicit
 *  rather than importing a heavy module for four lines. */
function makeSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// -------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  const mount = document.getElementById('app');
  const errEl = document.getElementById('errors');
  const diagEl = document.getElementById('diag');
  const controlsEl = document.getElementById('controls');
  const pausedEl = document.getElementById('paused');
  if (!mount || !controlsEl || !diagEl) throw new Error('comparison page DOM is incomplete');

  const fail = (err: unknown): void => {
    const msg = errorMessage(err);
    console.error('[blood-compare] bootstrap failed', err);
    if (errEl) errEl.textContent = `FAILED: ${msg}`;
  };

  let handle: LabRendererHandle;
  try {
    handle = await createLabRenderer(mount, {
      mode: 'fixed', width: COMPARE_OUTPUT.width, height: COMPARE_OUTPUT.height,
    });
  } catch (err) {
    fail(err);
    return;
  }
  if (handle.backend !== 'webgpu') {
    fail(new Error(`backend is '${handle.backend}' — this page is WebGPU-only (a fallback frame is not evidence)`));
    return;
  }

  const { renderer, scene, camera } = handle;
  scene.fog = null;
  const bgDark = new THREE.Color(0x1a1116);
  const bgNeutral = new THREE.Color(0x8a8a8a);
  let background = bgDark;
  renderer.setClearColor(background);

  // --- fixture scene -----------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x37262c, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const bodyProxy = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.9, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x6a5a55, roughness: 0.9, metalness: 0 }),
  );
  bodyProxy.position.set(0, 1.35, 0);
  scene.add(bodyProxy);

  const obstacle = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.2, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 1, metalness: 0 }),
  );
  obstacle.position.set(0.75, 1.0, -0.35);
  scene.add(obstacle);

  // --- goo layer with the GAME defaults ----------------------------------
  // The rig is the page's own light, matching the handle's sun; the goo and
  // the fixture are lit by the same direction and key colour.
  const rig = {
    lightDir: uniform(new THREE.Vector3(4, 10, 6).normalize()),
    keyColor: uniform(new THREE.Color(0xffeccd)),
    lightCfg: uniform(new THREE.Vector2(1.1, 0.45)),
  };
  const gooLayer: GooLayer = createGooLayer(renderer, rig);
  applyGameGooDefaults(gooLayer);
  // Mode 'depth' is the game default (goo-presets) — depth-tested against the
  // fixture so the obstacle fixture actually occludes.

  // --- production blood view, GAME visibility ----------------------------
  // Identical options to game-main's createBloodView: depth-writing cutout
  // droplets, game droplet scale, volume-conserving filament stretch, mist
  // and ribbons enabled. Visibility is the game's too: the goo surface
  // replaces the hard-edged beads/ribbons, MIST STAYS (the sparse-case floor),
  // and floor splats stay (the goo does not draw decals). Blanking mist would
  // flatter the candidate by deleting real blood the game shows.
  const bloodView: BloodView = createBloodView({
    dropletDepthWrite: true,
    dropletViewScale: 0.5,
    stretch: { k: 0.5, max: 3.5, thin: true },
    mist: true,
    ribbons: true,
  });
  for (const o of bloodView.objects) scene.add(o);
  bloodView.setBeadsVisible(false);
  bloodView.setMistVisible(true);

  // --- render targets for the wipe view ----------------------------------
  const targetOpts = { depthBuffer: true, type: THREE.HalfFloatType } as const;
  let contentW = renderer.domElement.width;
  let contentH = renderer.domElement.height;
  const rtA = new THREE.RenderTarget(contentW, contentH, targetOpts);
  const rtB = new THREE.RenderTarget(contentW, contentH, targetOpts);
  // Same first-initialisation discipline the goo layer and sdf-layer use: a
  // lazily-created target texture sampled inside the encoder that first
  // samples it gets the whole submit rejected, so the targets are explicitly
  // rendered once (cleared) after every allocation.
  let rtTargetsNeedInit = true;

  const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  blitCam.position.z = 1;
  function makeBlit(tex: THREE.Texture): THREE.Mesh {
    const m = new THREE.MeshBasicNodeMaterial();
    const t = texture(tex);
    m.colorNode = vec4(t.r, t.g, t.b, 1.0) as never;
    m.depthTest = false;
    m.depthWrite = false;
    m.fog = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.frustumCulled = false;
    return mesh;
  }
  const blitA = makeBlit(rtA.texture);
  const blitB = makeBlit(rtB.texture);
  const blitSceneA = new THREE.Scene(); blitSceneA.add(blitA);
  const blitSceneB = new THREE.Scene(); blitSceneB.add(blitB);

  // SOURCE grid (march grid), separate from the fixed output canvas.
  let sourceW = COMPARE_SOURCE_PRESETS[0]!.width;
  let sourceH = COMPARE_SOURCE_PRESETS[0]!.height;

  function applySizes(): void {
    contentW = renderer.domElement.width;
    contentH = renderer.domElement.height;
    rtA.setSize(contentW, contentH);
    rtB.setSize(contentW, contentH);
    rtTargetsNeedInit = true;
    // Density target = sourceGrid * densityScale (game 0.5), NOT the output
    // size. The surface composite still runs at the output resolution.
    gooLayer.setSize(sourceW, sourceH);
  }
  applySizes();
  window.addEventListener('resize', applySizes);

  /** Explicit one-time clear of the wipe targets after (re)allocation. */
  function initRenderTargets(): void {
    if (!rtTargetsNeedInit) return;
    rtTargetsNeedInit = false;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(rtA); renderer.clear(true, true, true);
    renderer.setRenderTarget(rtB); renderer.clear(true, true, true);
    renderer.setRenderTarget(null);
    renderer.autoClear = prevAutoClear;
  }

  // --- simulation --------------------------------------------------------
  const sim: BloodSim = createBloodSim();
  let seed = 12345;
  let rng = makeSeededRng(seed);
  let scenario: ScenarioId = 'burst';
  let frame = 0;
  let emitterAge = 0;
  let emitterAcc = 0;
  let eventTimer = 0;
  let speed = 1;
  let playing = false;
  // STABLE EMITTER STREAMS: every emission site gets a real id, never a
  // proximity guess. Each burst/gout is its own stream; a sustained wound
  // keeps one stream for its whole life. The connection builder refuses
  // untagged droplets, so a bug here shows up as missing connections rather
  // than a false bridge between two wounds.
  let streamSeq = 1;
  let scenarioStream = 1;

  function clearSim(): void {
    sim.droplets.length = 0;
    sim.splats.length = 0;
    for (const key of Object.keys(sim.clocks)) delete sim.clocks[Number(key)];
  }

  function fireBurst(): void {
    burst(sim, [0, 1.35, 0], rng, streamSeq++);
  }

  function fireGout(x: number, y: number, z: number): void {
    // dirN is the incoming shot direction; the gout sprays back along -dirN
    // (toward the camera at +z).
    spawnImpactGout(sim, 'slug', [x, y, z], [0, 0, -1], rng, streamSeq++);
  }

  function resetScenario(): void {
    clearSim();
    rng = makeSeededRng(seed);
    frame = 0;
    emitterAge = 0;
    emitterAcc = 0;
    eventTimer = 0;
    streamSeq = 1;
    scenarioStream = streamSeq++;
    if (scenario === 'burst') fireBurst();
    if (scenario === 'overlap') { fireGout(-0.28, 1.25, 0); fireGout(0.28, 1.35, 0); }
  }

  function advance(dt: number): void {
    const sdt = Math.min(dt, 1 / 30) * speed;
    frame++;
    switch (scenario) {
      case 'burst':
        eventTimer += sdt;
        if (eventTimer >= 1.6) { eventTimer = 0; fireBurst(); }
        break;
      case 'jet':
        emitterAcc = spawnWoundDroplets(
          sim, 'slug', emitterAge, [0, 1.35, 0], [0, 1, 0], sdt, emitterAcc, rng, scenarioStream,
        );
        emitterAge += sdt;
        break;
      case 'overlap':
        eventTimer += sdt;
        if (eventTimer >= 1.2) { eventTimer = 0; fireGout(-0.28, 1.25, 0); fireGout(0.28, 1.35, 0); }
        break;
      case 'landing':
        emitterAcc = spawnWoundDroplets(
          sim, 'pellet', emitterAge, [0, 0.6, 0], [0, 1, 0], sdt, emitterAcc, rng, scenarioStream,
        );
        emitterAge += sdt;
        break;
    }
    stepBlood(sim, sdt, rng);
  }

  // --- render ------------------------------------------------------------
  let variant: VariantId = 'original';
  let wipe = false;
  let wipeA: VariantId = 'original';
  let wipeB: VariantId = 'smooth';
  let wipePos = 0.5;
  let enableStrands = true;
  // Sheets are EXPERIMENTAL and off by default; the toggle is attribution.
  let enableSheets = false;
  // Per-layer attribution toggles. Beads/ribbons stay hidden exactly as the
  // game hides them while goo is on; goo and mist are independently visible.
  let gooVisible = true;
  let mistVisible = true;

  function extrasFor(connections: boolean): readonly GooDensityBlob[] {
    return connections
      ? connectionBlobsForSim(sim.droplets, { enableStrands, enableSheets })
      : [];
  }

  function applyLayerToggles(): void {
    gooLayer.setPassGate({ density: gooVisible, blur: gooVisible, surface: gooVisible });
    bloodView.setMistVisible(mistVisible);
  }
  applyLayerToggles();

  function renderVariant(v: Variant, target: THREE.RenderTarget | null): void {
    renderVariantFrame({
      gooLayer,
      sim,
      camera,
      renderScene: (t) => { renderer.setRenderTarget(t); renderer.render(scene, camera); },
    }, v, extrasFor(v.connections), target);
  }

  function draw(): void {
    // The blood view is variant-independent: pose it once per presented frame
    // from the SAME sim, after the camera's world matrices are current.
    camera.updateMatrixWorld();
    bloodView.sync(sim, camera);
    renderer.setClearColor(background);
    if (!wipe) {
      renderVariant(variantById(variant), null);
    } else {
      initRenderTargets();
      renderVariant(variantById(wipeA), rtA);
      renderVariant(variantById(wipeB), rtB);
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      // B wipes over A from the left at `wipePos`. Both are FULL-SIZE frames:
      // no squashing, equal aspect, equal pixel size.
      const cut = Math.max(1, Math.min(w - 1, Math.round(w * wipePos)));
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      renderer.setClearColor(background);
      renderer.clear(true, true, true);
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, w, h);
      renderer.render(blitSceneA, blitCam);
      renderer.setScissor(0, 0, cut, h);
      renderer.render(blitSceneB, blitCam);
      renderer.setScissorTest(false);
      renderer.autoClear = true;
    }
    updateDiag();
  }

  // --- camera orbit ------------------------------------------------------
  const orbit = { yaw: 0, pitch: 0.18, distance: 3.4, tx: 0, ty: 1.15, tz: 0 };
  function applyCamera(): void {
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      orbit.tx + Math.sin(orbit.yaw) * cp * orbit.distance,
      orbit.ty + Math.sin(orbit.pitch) * orbit.distance,
      orbit.tz + Math.cos(orbit.yaw) * cp * orbit.distance,
    );
    camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
    camera.updateMatrixWorld();
  }
  function attachOrbit(canvas: HTMLCanvasElement): void {
    let dragging = false; let lastX = 0; let lastY = 0;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', e => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      if (!playing) handle.drawOnce();
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX; const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      orbit.yaw -= dx * 0.008;
      orbit.pitch = Math.max(-0.4, Math.min(1.2, orbit.pitch + dy * 0.006));
      applyCamera();
      if (!playing) handle.drawOnce();
    });
    canvas.addEventListener('wheel', (e) => {
      orbit.distance = Math.max(1.2, Math.min(9, orbit.distance + Math.sign(e.deltaY) * 0.25));
      applyCamera();
      if (!playing) handle.drawOnce();
    }, { passive: true });
  }

  // --- diagnostics + capture API ----------------------------------------
  function candidateState(): Record<string, unknown> {
    return {
      seed, frame, scenario, playing, speed,
      variant, wipe, wipeA, wipeB, wipePos,
      strands: enableStrands, sheets: enableSheets,
      goo: gooVisible, mist: mistVisible,
      reconstruction: gooLayer.reconstruction,
      connections: variantById(variant).connections,
      extraBlobs: gooLayer.extraBlobCount,
      droplets: sim.droplets.length,
      splats: sim.splats.length,
      density: gooLayer.densityDiagnostics,
      source: { width: sourceW, height: sourceH },
      output: { width: renderer.domElement.width, height: renderer.domElement.height },
      camera: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance },
      backend: handle.backend,
    };
  }

  function updateDiag(): void {
    const d = gooLayer.densityDiagnostics;
    const v = variantById(variant);
    const lines = [
      `seed ${seed}  frame ${frame}  scenario ${scenario}`,
      `playing ${playing}  speed ${speed.toFixed(2)}`,
      wipe
        ? `wipe at ${wipePos.toFixed(2)}: left=B(${wipeB}) right=A(${wipeA})`
        : `variant ${v.id} (recon=${v.reconstruction} conns=${v.connections ? 'on' : 'off'})`,
      `strands ${enableStrands ? 'on' : 'off'}  sheets ${enableSheets ? 'on' : 'off'} (experimental)  extras ${gooLayer.extraBlobCount}`,
      `goo ${gooVisible ? 'on' : 'off'}  mist ${mistVisible ? 'on' : 'off'} (beads/ribbons hidden as in game)`,
      `source ${sourceW}x${sourceH}  output ${contentW}x${contentH}`,
      `density ${d.densityWidth}x${d.densityHeight}  densityScale ${d.densityScale.toFixed(2)} of source`,
      `density texels/source px ${d.texelsPerSourcePixelX.toFixed(2)},${d.texelsPerSourcePixelY.toFixed(2)}  /output px ${d.texelsPerOutputPixelX.toFixed(2)},${d.texelsPerOutputPixelY.toFixed(2)}`,
      `sim droplets ${sim.droplets.length}  splats ${sim.splats.length}  backend ${handle.backend}`,
    ];
    diagEl.textContent = lines.join('\n');
    if (pausedEl) pausedEl.style.display = playing ? 'none' : '';
  }

  // --- controls ----------------------------------------------------------
  function row(label: string, el: HTMLElement): void {
    const div = document.createElement('div');
    div.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = label;
    div.appendChild(lab); div.appendChild(el);
    controlsEl.appendChild(div);
  }
  function select<T extends string>(values: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLSelectElement {
    const s = document.createElement('select');
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v.id; o.textContent = v.label;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value as T));
    return s;
  }
  function checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
    const l = document.createElement('label');
    l.style.flex = '0 0 auto'; l.style.color = '#e8e8e8';
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = value;
    c.addEventListener('change', () => onChange(c.checked));
    l.appendChild(c); l.appendChild(document.createTextNode(' ' + label));
    return l;
  }

  let wipeASelect: HTMLSelectElement | null = null;
  let wipeBSelect: HTMLSelectElement | null = null;

  row('variant', select(VARIANTS.map(v => ({ id: v.id, label: v.label })), variant, (v) => {
    variant = v; if (!playing) handle.drawOnce();
  }));
  const wipeToggle = checkbox('wipe A/B', wipe, (on) => {
    wipe = on;
    if (wipeASelect) wipeASelect.style.display = on ? '' : 'none';
    if (wipeBSelect) wipeBSelect.style.display = on ? '' : 'none';
    if (!playing) handle.drawOnce();
  });
  row('view', wipeToggle);
  wipeASelect = select(VARIANTS.map(v => ({ id: v.id, label: v.label })), wipeA, (v) => {
    wipeA = v; if (!playing) handle.drawOnce();
  });
  wipeASelect.style.display = wipe ? '' : 'none';
  row('wipe A (right)', wipeASelect);
  wipeBSelect = select(VARIANTS.map(v => ({ id: v.id, label: v.label })), wipeB, (v) => {
    wipeB = v; if (!playing) handle.drawOnce();
  });
  wipeBSelect.style.display = wipe ? '' : 'none';
  row('wipe B (left)', wipeBSelect);

  const wipePosInput = document.createElement('input');
  wipePosInput.type = 'range'; wipePosInput.min = '0.05'; wipePosInput.max = '0.95'; wipePosInput.step = '0.01';
  wipePosInput.value = String(wipePos);
  wipePosInput.addEventListener('input', () => { wipePos = Number(wipePosInput.value); if (!playing) handle.drawOnce(); });
  row('wipe pos', wipePosInput);

  row('scenario', select(SCENARIOS, scenario, (s) => {
    scenario = s; resetScenario(); if (!playing) handle.drawOnce();
  }));

  const seedInput = document.createElement('input');
  seedInput.type = 'number'; seedInput.value = String(seed); seedInput.style.width = '90px';
  seedInput.addEventListener('change', () => {
    const n = Number(seedInput.value);
    if (Number.isFinite(n)) { seed = Math.floor(n); resetScenario(); if (!playing) handle.drawOnce(); }
  });
  row('seed', seedInput);

  const replayBtn = document.createElement('button');
  replayBtn.textContent = 'Replay';
  replayBtn.addEventListener('click', () => { resetScenario(); if (!playing) handle.drawOnce(); });
  row('', replayBtn);

  const playBtn = document.createElement('button');
  const pauseBtn = document.createElement('button');
  const stepBtn = document.createElement('button');
  playBtn.textContent = 'Play'; pauseBtn.textContent = 'Pause'; stepBtn.textContent = 'Step';
  playBtn.addEventListener('click', () => {
    playing = true; handle.setLoopRunning(true); updateDiag();
  });
  pauseBtn.addEventListener('click', () => {
    playing = false; handle.setLoopRunning(false); handle.drawOnce(); updateDiag();
  });
  stepBtn.addEventListener('click', () => {
    playing = false; handle.setLoopRunning(false); handle.step(1 / 60); updateDiag();
  });
  const transport = document.createElement('div');
  transport.style.display = 'flex'; transport.style.gap = '4px';
  transport.appendChild(playBtn); transport.appendChild(pauseBtn); transport.appendChild(stepBtn);
  row('', transport);

  const speedInput = document.createElement('input');
  speedInput.type = 'range'; speedInput.min = '0.1'; speedInput.max = '2'; speedInput.step = '0.05';
  speedInput.value = String(speed);
  speedInput.addEventListener('input', () => { speed = Number(speedInput.value); if (!playing) handle.drawOnce(); });
  row('speed', speedInput);

  const strandsToggle = checkbox('strands', enableStrands, (v) => { enableStrands = v; if (!playing) handle.drawOnce(); });
  row('connections', strandsToggle);
  const sheetsToggle = checkbox('sheets (exp.)', enableSheets, (v) => { enableSheets = v; if (!playing) handle.drawOnce(); });
  row('', sheetsToggle);

  const gooToggle = checkbox('goo', gooVisible, (v) => { gooVisible = v; applyLayerToggles(); if (!playing) handle.drawOnce(); });
  row('layers', gooToggle);
  const mistToggle = checkbox('mist', mistVisible, (v) => { mistVisible = v; applyLayerToggles(); if (!playing) handle.drawOnce(); });
  row('', mistToggle);

  const obstacleToggle = checkbox('obstacle', obstacle.visible, (v) => {
    obstacle.visible = v; if (!playing) handle.drawOnce();
  });
  row('occlusion', obstacleToggle);

  const bgToggle = checkbox('neutral bg', false, (v) => {
    background = v ? bgNeutral : bgDark;
    scene.background = background;
    if (!playing) handle.drawOnce();
  });
  row('background', bgToggle);

  const sourceSelect = select(
    COMPARE_SOURCE_PRESETS.map(p => ({ id: p.id, label: p.label })),
    COMPARE_SOURCE_PRESETS[0]!.id,
    (id) => {
      const p = COMPARE_SOURCE_PRESETS.find(q => q.id === id) ?? COMPARE_SOURCE_PRESETS[0]!;
      sourceW = p.width; sourceH = p.height;
      gooLayer.setSize(sourceW, sourceH);
      if (!playing) handle.drawOnce();
    },
  );
  row('source grid', sourceSelect);

  const densityInput = document.createElement('input');
  densityInput.type = 'range'; densityInput.min = '0.25'; densityInput.max = '1'; densityInput.step = '0.05';
  densityInput.value = String(gooLayer.densityScale);
  densityInput.addEventListener('input', () => {
    gooLayer.setDensityScale(Number(densityInput.value));
    if (!playing) handle.drawOnce();
  });
  row('density scale', densityInput);

  const hint = document.createElement('div');
  hint.id = 'hint';
  hint.textContent = [
    'drag orbit · wheel zoom',
    'starts paused; Play or Step to advance',
    'capture: pick variant (+wipe), Play, Pause, then screenshot the canvas;',
    '__bloodCompare.state() records seed/frame/source/output/density for the shot.',
  ].join('\n');
  controlsEl.appendChild(hint);

  // --- global API --------------------------------------------------------
  const api = {
    state: candidateState,
    play: () => { playing = true; handle.setLoopRunning(true); },
    pause: () => { playing = false; handle.setLoopRunning(false); handle.drawOnce(); },
    step: () => { playing = false; handle.setLoopRunning(false); handle.step(1 / 60); },
    replay: (nextSeed?: number) => {
      if (nextSeed !== undefined && Number.isFinite(nextSeed)) { seed = Math.floor(nextSeed); seedInput.value = String(seed); }
      resetScenario(); if (!playing) handle.drawOnce();
    },
    setVariant: (v: VariantId) => { variant = v; if (!playing) handle.drawOnce(); },
    setWipe: (on: boolean, a?: VariantId, b?: VariantId, pos?: number) => {
      wipe = on; if (a) wipeA = a; if (b) wipeB = b;
      if (pos !== undefined && Number.isFinite(pos)) wipePos = Math.max(0.05, Math.min(0.95, pos));
      if (!playing) handle.drawOnce();
    },
    setScenario: (s: ScenarioId) => { scenario = s; resetScenario(); if (!playing) handle.drawOnce(); },
    setDensityScale: (v: number) => { gooLayer.setDensityScale(v); if (!playing) handle.drawOnce(); },
    setSource: (w: number, h: number) => {
      sourceW = Math.max(16, Math.round(w)); sourceH = Math.max(16, Math.round(h));
      gooLayer.setSize(sourceW, sourceH);
      if (!playing) handle.drawOnce();
    },
    setLayers: (o: { goo?: boolean; mist?: boolean }) => {
      if (o.goo !== undefined) gooVisible = o.goo;
      if (o.mist !== undefined) mistVisible = o.mist;
      applyLayerToggles();
      if (!playing) handle.drawOnce();
    },
    captureInstructions: () => [
      '1. npm run dev and open /sdf-blood-compare.html (WebGPU required).',
      '2. Choose a scenario and variant, or enable the full-size wipe A/B.',
      '3. Press Play, let the frame reach the wanted moment, press Pause.',
      '4. Record __bloodCompare.state() (seed, frame, source, output, density) beside the image.',
      '5. Screenshot the canvas region; compare only shots at the same source grid, output size and seed.',
      'Visual acceptance is PENDING: not verified during the training window.',
    ],
  };
  (globalThis as unknown as { __bloodCompare?: typeof api }).__bloodCompare = api;

  // --- wiring ------------------------------------------------------------
  handle.setRenderCallback((dt) => { advance(dt); });
  handle.setDrawFn(() => { draw(); });
  attachOrbit(handle.canvas);
  applyCamera();
  scene.background = background;
  resetScenario();
  handle.setLoopRunning(false);
  handle.drawOnce();

  window.addEventListener('pagehide', () => {
    bloodView.dispose();
    gooLayer.dispose();
    rtA.dispose(); rtB.dispose();
    blitA.geometry.dispose(); blitB.geometry.dispose();
    (blitA.material as THREE.Material).dispose();
    (blitB.material as THREE.Material).dispose();
  }, { once: true });
}

bootstrap().catch((err) => {
  const errEl = document.getElementById('errors');
  if (errEl) errEl.textContent = `FAILED: ${errorMessage(err)}`;
  console.error('[blood-compare] unhandled', err);
});
