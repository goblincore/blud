// src/lab/sdf-zombie/webgpu/explosion-vfx-spike-main.ts
//
// LOOK-PASS page for the procedural explosion burst. Standalone: it does not
// import game-main, the lab, or anything the SDF march owns.
//
// Its job is to make the material question ANSWERABLE rather than asserted.
// The burst is drawn the way the game must draw it — pass 1 is an opaque
// "composite stand-in" (floor, wall, an occluder box), pass 2 is the effects
// overlay scene with `renderer.autoClear = false`, exactly the routing
// character-effects.ts uses after the SDF composite. So the frame the capture
// driver photographs is the composition the effect will actually live in, not
// a floating burst on a black background where nothing can go wrong.
//
// THE A/B: `?control=hash|test` swaps the fire layer onto the two material
// flags this repo has already been burned by — `alphaHash` (blood-view-gpu
// capture round 3: "unshaped translucent SQUARES on the WebGPU backend") and a
// hard `alphaTest` cutout (which "fixed" the squares but destroyed the glow).
// Same geometry, same node graph, same frame — only the flag differs, so the
// PNGs are directly comparable.
//
// FRAMES ARE DRIVEN EXPLICITLY. A headless or backgrounded tab stops rAF, so
// the page never depends on it: `__explosionSpike.pause()` stops the loop and
// `frame(dt)` advances and renders exactly one frame. The capture driver uses
// that, which is also what makes a capture reproducible.
//
// Everything the driver needs is on `window.__explosionSpike`.

import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import {
  createExplosionLookMaterial, createExplosionVfx, makeExplosionLookUniforms,
  type ExplosionVfx,
} from './explosion-vfx';
import type { BurstVisual } from '../explosion-aoe';

/** The dt clamp the module applies internally; the page's own clock mirrors it
 *  so the control material's noise advection stays in step with the module's. */
const MAX_STEP = 0.05;

/**
 * THE NEW LOOK, in one place. `?curl=1` boots with the shared curl domain-warp
 * and the soft-particle depth fade on these values; the game's default stays 0
 * (explosion-vfx.ts) and the capture driver pins the same numbers through
 * setTuning so a still is reproducible.
 *
 * `curlScale` is the shared 6 m body scale, NOT the 2.2 m the first spike used:
 * at 2.2 the warp's spatial gradient folded the noise lookup and drew a bright
 * cross through the fireball (see `curlWarpGain` and the 2026-09-18 NOTES).
 * 6 m keeps the full `curlStrength` and is cross-free; it changes at least as
 * many pixels as 2.2 did, so the billow is not given up for it.
 */
export const SPIKE_CURL_LOOK = {
  curlStrength: 1.1,
  curlScale: 6,
  softFade: 0.4,
} as const;

interface SpikeApi {
  ready: boolean;
  backend: string;
  /** Stop/start the rAF loop (the default). The driver pauses first. */
  pause(): void;
  resume(): void;
  /** Advance the sim by dt and render one frame. The returned promise resolves
   *  after the render, so a capture driver can screenshot the exact frame. */
  frame(dt: number): Promise<void>;
  /** Render the current state again without advancing. */
  renderOnly(): void;
  /** Spawn one burst. `seed` pins the per-billboard randomness. */
  spawn(o: {
    kind?: 'air' | 'ground'; at: [number, number, number];
    heightM?: number; seed?: number;
  }): number;
  /** The three bursts the default scene poses (air + ground + occluded). */
  spawnDefaultScene(): void;
  reset(): void;
  /** Apply a tuning patch and return the fully-clamped tuning that landed. */
  setTuning(patch: Record<string, number>): Record<string, number>;
  setControl(mode: 'none' | 'hash' | 'test'): void;
  setCamera(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void;
  resize(w: number, h: number): void;
  stats(): {
    activeBursts: number; lightIntensity: number;
    fireQuads: number; smokeQuads: number; emberQuads: number; ringSegments: number;
    drawCalls: number; triangles: number; clock: number; control: string;
    curlStrength: number; curlScale: number; softFade: number;
  };
  measureRender(frames?: number): Promise<{ meanMs: number; minMs: number; maxMs: number; gpuMs: number }>;
}

async function main() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');
  const statusEl = document.getElementById('status');
  const statsEl = document.getElementById('stats');
  const say = (msg: string, bad = false) => {
    if (!statusEl) return;
    const line = document.createElement('div');
    line.textContent = msg;
    if (bad) line.style.color = '#ff6464';
    statusEl.appendChild(line);
  };

  const renderer = new WebGPURenderer({ antialias: false, alpha: false, trackTimestamp: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(new THREE.Color(0x121820));
  mount.appendChild(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu' : 'webgl';
  say(`backend: ${backend}`, backend !== 'webgpu');

  const W = () => Math.max(2, window.innerWidth);
  const H = () => Math.max(2, window.innerHeight);
  renderer.setSize(W(), H(), false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const camera = new THREE.PerspectiveCamera(58, W() / H(), 0.1, 300);
  camera.position.set(1.2, 2.4, 9.5);
  camera.lookAt(-0.3, 1.5, -1);

  // ——— PASS 1: the composite stand-in. Opaque, depth-writing geometry that
  //     the burst must both sit on top of and be occluded by. Deliberately
  //     MID-TONE: additive fire has to add visibly, and normal-blended smoke
  //     has to darken visibly without turning into a black hole.
  const world = new THREE.Scene();
  const addBox = (
    w: number, h: number, d: number,
    x: number, y: number, z: number, color: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.set(x, y, z);
    world.add(mesh);
    return mesh;
  };
  addBox(60, 0.2, 60, 0, -0.1, -6, 0x4a5460);          // floor
  addBox(60, 26, 0.4, 0, 12, -18, 0x7a6a72);           // back wall
  addBox(14, 10, 0.4, -9, 5, -9, 0x8d4b45);            // "SDF flesh quad" stand-in
  addBox(1.6, 3.4, 1.6, 2.8, 1.7, -2.0, 0xc2c8d2);     // occluder
  addBox(0.9, 5.5, 0.9, -3.4, 2.75, -1.2, 0x9aa2ae);   // pillar

  // ——— PASS 2: the effects overlay scene. Added to, never cleared.
  const vfxScene = new THREE.Scene();
  const vfx: ExplosionVfx = createExplosionVfx();
  vfxScene.add(vfx.object);

  // A SECOND set of uniforms for the A/B material. The module owns its own
  // clock; this page mirrors it so the noise advection of a swapped-in
  // control material tracks the real one frame for frame.
  const controlUniforms = makeExplosionLookUniforms();
  let controlMode: 'none' | 'hash' | 'test' = 'none';
  let clock = 0;

  const fireMesh = vfx.object.getObjectByName('ExplosionFire') as THREE.Mesh;
  const realFireMaterial = fireMesh.material;
  function setControl(mode: 'none' | 'hash' | 'test') {
    controlMode = mode;
    const next = mode === 'none'
      ? realFireMaterial
      : createExplosionLookMaterial('fire', controlUniforms, { alphaControl: mode });
    const previous = fireMesh.material;
    fireMesh.material = next;
    if (previous !== realFireMaterial) (previous as THREE.Material).dispose();
  }

  const render = async () => {
    renderer.autoClear = true;
    await renderer.renderAsync(world, camera);
    // THE ROUTING UNDER TEST: the burst is composited over the completed
    // frame with the depth buffer intact, exactly as game-main does it.
    renderer.autoClear = false;
    await renderer.renderAsync(vfxScene, camera);
    renderer.autoClear = true;
  };

  async function frame(dt: number) {
    const step = dt > 0 ? Math.min(dt, MAX_STEP) : 0;
    clock += step;
    // The control material shares the look graph, so it needs the same look
    // switches as the module's own uniforms.
    controlUniforms.time.value = clock;
    controlUniforms.gain.value = vfx.tuning.gain;
    controlUniforms.curlStrength.value = vfx.tuning.curlStrength;
    controlUniforms.curlScale.value = vfx.tuning.curlScale;
    controlUniforms.softFade.value = vfx.tuning.softFade;
    vfx.update(step, camera);
    await render();
  }

  const spawnAt = (o: {
    kind?: 'air' | 'ground'; at: [number, number, number];
    heightM?: number; seed?: number;
  }): number => {
    const visual: BurstVisual = {
      kind: o.kind ?? 'ground',
      at: o.at,
      heightM: o.heightM ?? 2.0,
    };
    vfx.spawn(visual, o.seed);
    return vfx.activeBursts;
  };

  // The default pose exercises all three anchoring cases in one frame:
  // a ground plume at the origin, an airburst to the left and up, and a burst
  // tucked behind the occluder box to prove the depth test still bites.
  const spawnDefaultScene = () => {
    spawnAt({ kind: 'ground', at: [0, 0, 0], heightM: 2.0, seed: 1001 });
    spawnAt({ kind: 'air', at: [-4.6, 3.4, -3.0], heightM: 1.7, seed: 1002 });
    spawnAt({ kind: 'ground', at: [2.8, 0, -6.5], heightM: 1.6, seed: 1003 });
  };

  const reset = () => {
    clock = 0;
    controlUniforms.time.value = 0;
    // Retire everything by fast-forwarding the life out, then clear the pose.
    for (let i = 0; i < 200; i++) vfx.update(0.05, camera);
    vfx.update(0, camera);
  };

  let rafId = 0;
  let last = performance.now();
  let running = false;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    void frame((now - last) / 1000);
    last = now;
    rafId = requestAnimationFrame(loop);
  };
  const pause = () => { running = false; cancelAnimationFrame(rafId); };
  const resume = () => {
    if (running) return;
    running = true;
    last = performance.now();
    rafId = requestAnimationFrame(loop);
  };

  const api: SpikeApi = {
    ready: false,
    backend,
    pause,
    resume,
    frame,
    renderOnly: () => { void render(); },
    spawn: spawnAt,
    spawnDefaultScene,
    reset,
    setTuning: (patch) => {
      vfx.setTuning(patch as never);
      return { ...vfx.tuning };
    },
    setControl,
    setCamera(px, py, pz, tx, ty, tz) {
      camera.position.set(px, py, pz);
      camera.lookAt(tx, ty, tz);
      camera.updateMatrixWorld();
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    },
    stats() {
      const quads = (name: string) => {
        const mesh = vfx.object.getObjectByName(name) as THREE.Mesh | undefined;
        return mesh ? mesh.geometry.drawRange.count / 6 : 0;
      };
      const info = renderer.info as unknown as {
        render?: { drawCalls?: number; calls?: number; triangles?: number };
      };
      return {
        activeBursts: vfx.activeBursts,
        lightIntensity: vfx.lightIntensity,
        fireQuads: quads('ExplosionFire'),
        smokeQuads: quads('ExplosionSmoke'),
        emberQuads: quads('ExplosionEmbers'),
        ringSegments: quads('ExplosionShockwave'),
        drawCalls: info.render?.drawCalls ?? info.render?.calls ?? -1,
        triangles: info.render?.triangles ?? -1,
        clock,
        control: controlMode,
        curlStrength: vfx.tuning.curlStrength,
        curlScale: vfx.tuning.curlScale,
        softFade: vfx.tuning.softFade,
      };
    },
    async measureRender(frames = 40) {
      const times: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        await render();
        times.push(performance.now() - t0);
      }
      let gpuMs = NaN;
      try {
        await (renderer as unknown as { resolveTimestampsAsync: () => Promise<void> })
          .resolveTimestampsAsync();
        const pool = (renderer.backend as unknown as {
          getTimestampPool?: () => Map<string, { timestamps?: { render?: number } }>;
        });
        const resolved = pool.getTimestampPool?.();
        const entry = resolved?.get('render');
        if (entry?.timestamps?.render !== undefined) gpuMs = entry.timestamps.render / 1e6;
      } catch { /* timestamps are a bonus, never a gate */ }
      const sorted = [...times].sort((a, b) => a - b);
      return {
        meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        gpuMs,
      };
    },
  };

  (window as unknown as { __explosionSpike: SpikeApi }).__explosionSpike = api;

  window.addEventListener('resize', () => api.resize(W(), H()));

  // ?control=hash|test boots straight into the A/B so the capture driver does
  // not have to race the page for it.
  const params = new URLSearchParams(location.search);
  const ctrl = params.get('control');
  if (ctrl === 'hash' || ctrl === 'test') setControl(ctrl);
  // ?curl=1 turns on the new look (shared curl domain-warp + soft-particle
  // depth fade). OFF is the game default and the capture baseline.
  if (params.get('curl') === '1') vfx.setTuning(SPIKE_CURL_LOOK);
  // ?spawn=0 boots the scene empty (the background-only control frame).
  if (params.get('spawn') !== '0') spawnDefaultScene();

  api.ready = true;
  say(`backend: ${backend}, ${vfx.activeBursts} bursts posed`);
  say('drive with __explosionSpike.frame(dt) · ?curl=1 · ?paused=1 · ?control=hash|test · ?spawn=0');
  if (statsEl) statsEl.textContent = JSON.stringify(api.stats());
  // ?paused=1 boots stopped so a capture driver owns every frame: the sim clock
  // starts at 0 and only frame(dt) advances it, so two loads are comparable.
  if (params.get('paused') === '1') pause(); else resume();
}

main().catch((err) => {
  const el = document.getElementById('status');
  if (el) {
    const line = document.createElement('div');
    line.style.color = '#ff6464';
    line.textContent = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
    el.appendChild(line);
  }
  console.error('[explosion-vfx-spike] bootstrap failed', err);
});
