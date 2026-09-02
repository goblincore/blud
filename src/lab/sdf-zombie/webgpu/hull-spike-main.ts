// src/lab/sdf-zombie/webgpu/hull-spike-main.ts
//
// Hull-refine phase 0 spike (spec §7). One walking zombie actor, shootable,
// severable, gibbable; drawn through the shipped march OR the surface-nets
// hull, toggled in-page. Exposes window.__hullSpike so
// scripts/perf-r2-parity.mjs --url /sdf-hull-spike.html --seam __hullSpike
// can freeze, stamp a wound, toggle, and capture.
import * as THREE from 'three/webgpu';
import { createLabRenderer } from './lab-renderer';
import { createZombieGpuView, createChunkGpuView, type ZombieGpuView, type ChunkGpuView } from './zombie-gpu';
import { wrapHullRefine, type HullRefineView, type HullRenderer, type HullKnobs } from './hull-refine-view';
import { createZombieActor, type ZombieActor, type DetachedPiece } from './game-actor';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import { DEFAULT_FACE } from '../face';
import { makeChunk, stepChunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { sdBody } from '../validate';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import zombieBlobSrc from '../characters/zombie.blob?raw';

const MAX_CHUNKS = 8;

async function main() {
  const mount = document.getElementById('app')!;
  const hud = document.getElementById('hud')!;
  const handle = await createLabRenderer(mount, { mode: 'fixed', width: 960, height: 540 });
  const { renderer, scene, camera } = handle;
  camera.position.set(0, 1.6, 3.2);
  camera.lookAt(0, 1.0, 0);

  // Floor so the reel has a ground contact to judge.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardNodeMaterial({ color: 0x2a2226 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ---- body + actor -----------------------------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = { ...DEFAULT_FACE, ...compileFace(doc) };
  const body = buildBody(compileBlob(doc, face), DEFAULT_BUILD_OPTS);
  const innerView = createZombieGpuView(body);
  const view: HullRefineView<ZombieGpuView> = wrapHullRefine(innerView, { renderer });
  scene.add(innerView.object);
  scene.add(view.hullObject);

  // The actor drives setRootShift/setHeadRotation DIRECTLY on its view
  // (game-actor.ts:390,421), which HullRefineView deliberately does not
  // implement. Hand it the inner view with `update` funnelled through the
  // wrapper, so uploads still trigger the hull extraction.
  const actorView: ZombieGpuView = {
    ...innerView,
    update: (posed, rest) => view.update(posed, rest),
  };

  const pieces: DetachedPiece[] = [];
  const actor: ZombieActor = createZombieActor({
    id: 1, room: 0, body, view: actorView,
    start: [0, 0, 0], seed: 7,
    bounds: { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 },
    furniture: [],
    onSever: (piece) => { pieces.push(piece); spawnChunk(piece); },
  });

  // ---- chunks -----------------------------------------------------------
  type Live = { state: ReturnType<typeof makeChunk>; view: HullRefineView<ChunkGpuView> };
  const live: Live[] = [];
  let seed = 1;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  function spawnChunk(piece: DetachedPiece) {
    const vel: Vec3 = [(rng() - 0.5) * 4.5, 2.5 + rng() * 2.5, (rng() - 0.5) * 4.5];
    const state = makeChunk(piece.limb, piece.origin, vel, chunkExtent(piece.prims, piece.origin), [0, 1, 0], rng, 'limb');
    const oldest = live.length >= MAX_CHUNKS ? live.shift() : undefined;
    if (oldest) {
      oldest.view.inner.reset(state, piece.prims, piece.tornAt.length ? piece.tornAt : undefined, piece.bones);
      live.push({ state, view: oldest.view });
      return;
    }
    const inner = createChunkGpuView(state, piece.prims, innerView.uniforms,
      piece.tornAt.length ? piece.tornAt : undefined, innerView.volumeTexture, undefined, piece.bones);
    const wrapped = wrapHullRefine(inner, { renderer });
    wrapped.setRenderer(view.renderer);
    wrapped.setKnobs(view.knobs());
    scene.add(inner.object); scene.add(wrapped.hullObject);
    live.push({ state, view: wrapped });
  }

  // ---- shooting: ray vs the CPU field of the POSED body -----------------
  const raycaster = new THREE.Raycaster();
  function aimWorld(ndcX: number, ndcY: number): { hit: Vec3; dir: Vec3 } | null {
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    const posed = actor.posed();
    let t = 0;
    for (let i = 0; i < 128; i++) {
      const p: Vec3 = [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
      const f = sdBody(p, posed);
      if (f < 0.002) return { hit: p, dir: [d.x, d.y, d.z] };
      t += Math.max(f, 0.002);
      if (t > 20) break;
    }
    return null;
  }
  const canvas = handle.canvas;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect();
    const a = aimWorld(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    if (!a) return;
    if (e.button === 2) actor.hitSlug(a.hit, a.dir); else actor.hit(a.hit, a.dir);
  });

  // ---- knobs + keys -----------------------------------------------------
  let frozen = false;
  function setRenderer(r: HullRenderer) { view.setRenderer(r); for (const c of live) c.view.setRenderer(r); }
  function setKnobs(k: Partial<HullKnobs>) { view.setKnobs(k); for (const c of live) c.view.setKnobs(k); }
  window.addEventListener('keydown', e => {
    const k = view.knobs();
    if (e.key === 'h' || e.key === 'H') setRenderer(view.renderer === 'hull' ? 'march' : 'hull');
    if (e.key === '[') setKnobs({ steps: Math.max(1, k.steps - 1) });
    if (e.key === ']') setKnobs({ steps: k.steps + 1 });
    if (e.key === '-') setKnobs({ band: Math.max(0.005, k.band - 0.005) });
    if (e.key === '=') setKnobs({ band: k.band + 0.005 });
    if (e.key === ',') setKnobs({ cell: Math.max(0.01, k.cell - 0.005) });
    if (e.key === '.') setKnobs({ cell: k.cell + 0.005 });
    if (e.key === 'f' || e.key === 'F') frozen = !frozen;
    if (e.key === 's' || e.key === 'S') { const a = aimWorld(0, 0.2); if (a) actor.hitSlug(a.hit, a.dir); }
    if (e.key === 'g' || e.key === 'G') { for (let i = 0; i < 4; i++) { const a = aimWorld((rng() - 0.5) * 0.4, 0.1 + (rng() - 0.5) * 0.6); if (a) actor.hitSlug(a.hit, a.dir); } }
  });

  // ---- frame ------------------------------------------------------------
  let frameMs = 0, tPrev = performance.now();
  handle.setRenderCallback((dt) => {
    const now = performance.now(); frameMs = now - tPrev; tPrev = now;
    if (!frozen) {
      actor.step(dt);
      for (const c of live) { c.state = stepChunk(c.state, dt); c.view.update(c.state); }
    } else if (view.renderer === 'hull') {
      // Frozen: still re-extract so knob changes show without motion.
      view.update(actor.posed(), actor.body);
    }
    const k = view.knobs();
    const x = view.lastExtract();
    hud.textContent =
      `renderer ${view.renderer}  ${frameMs.toFixed(1)} ms\n` +
      `cell ${k.cell.toFixed(3)}  band ${k.band.toFixed(3)}  steps ${k.steps}\n` +
      (x ? `grid ${x.grid.dims.join('x')}  blocks ${x.blockCount}${x.grid.clamped ? '  CLAMPED' : ''}\n` : '') +
      `wounds ${actor.wounds().length}  chunks ${live.length}${frozen ? '  FROZEN' : ''}`;
  });

  // ---- seams (perf-r2-parity.mjs contract; unknown setters are no-ops) --
  (window as unknown as { __hullSpike: unknown }).__hullSpike = {
    backend: handle.backend,
    resolveGpu: () => handle.resolveGpu(),
    freeze: (on: boolean) => { frozen = on; },
    teleport: (_room: number) => {},
    setAdaptive: () => {}, setSdfScale: () => {}, setFxaa: () => {}, setSmear: () => {},
    setCone: () => {}, setOccluder: () => {},
    get shell() { return false; }, get occluder() { return false; }, get cone() { return false; },
    get fxaa() { return false; }, get relax() { return innerView.uniforms.woundCfg2.value.y; },
    get sdfScale() { return 1; }, get adaptive() { return { enabled: false }; }, get halfRate() { return false; },
    get sdfTarget() { return { w: 960, h: 540 }; },
    setRenderer, setKnobs, knobs: () => view.knobs(), get renderer() { return view.renderer; },
    aimSurface: () => aimWorld(0, 0.15),
    fireSlug: () => { const a = aimWorld(0, 0.15); if (a) actor.hitSlug(a.hit, a.dir); return !!a; },
    firePellet: () => { const a = aimWorld(0, 0.15); if (a) actor.hit(a.hit, a.dir); return !!a; },
    gib: () => { for (let i = 0; i < 4; i++) { const a = aimWorld((rng() - 0.5) * 0.4, 0.1 + (rng() - 0.5) * 0.6); if (a) actor.hitSlug(a.hit, a.dir); } },
    wounds: (): readonly Wound[] => actor.wounds(),
    async stats() {
      const r = await view.compute.readback(renderer);
      return { overflow: r.meta[0] === 1, cellVerts: r.meta[1], soupVerts: r.meta[2], dropped: r.meta[3], extract: view.lastExtract(), frameMs };
    },
    /** GPU-vs-CPU parity on the current posed, UNWOUNDED-field body: every
     *  GPU cell vertex must sit within one cell of iso+band by the CPU field. */
    async checkParity() {
      const r = await view.compute.readback(renderer);
      const posed = actor.posed();
      const k = view.knobs();
      const origin = view.hullObject.position;
      let bad = 0;
      for (let v = 0; v < r.meta[1]!; v++) {
        const p: Vec3 = [r.cellPos[v * 3]! + origin.x, r.cellPos[v * 3 + 1]! + origin.y, r.cellPos[v * 3 + 2]! + origin.z];
        if (Math.abs(sdBody(p, posed) - k.band) > k.cell) bad++;
      }
      return { cellVerts: r.meta[1], bad, badFrac: r.meta[1] ? bad / r.meta[1]! : 0, dropped: r.meta[3], overflow: r.meta[0] === 1 };
    },
  };
  hud.textContent = 'ready';
}

main().catch(e => { document.getElementById('hud')!.textContent = String(e?.stack ?? e); console.error(e); });
