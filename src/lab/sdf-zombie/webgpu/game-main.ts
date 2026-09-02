// src/lab/sdf-zombie/webgpu/game-main.ts
//
// sdf-game.html — the grey-box ring the owner walks to judge on-screen enemy
// counts. Four rooms, tunnels with arched mouths, 1/2/3/4 wandering zombies,
// a first-person player, and per-room environment bounce on the SDF bodies.
//
// NOT the lab: no panel, no wounds, no chunks, no dynamite. The combat
// wiring belongs to the grapeshot dispatch that follows; this page owns the
// walkable world and the actors, and exposes them through window.__sdfGame
// (see the bottom of the file — that hook is the seam the weapon builds on).
//
// Renderer stack mirrors bench-main.ts (createLabRenderer + createSdfLayer +
// createPostAa + createOccluderHull), NOT lab-main.ts — the bench is the
// small example of standing this up without the lab's control panel.
//
// BOUNCE. Each zombie's view carries the enclosure of the room it stands in
// (boxMin/boxMax + six wall albedos). practical-hard-key ships probeWeight 0,
// at which ambientAt early-outs to flat fill and the wall albedos do NOTHING
// — so this page parks probeWeight at DEFAULT_PROBE_WEIGHT and exposes it on
// [ and ] (plus __sdfGame.setProbeWeight) for the owner's flat->full slide.
// ambientGain 4 / chromaGain 1 are owner-tuned; left alone.

import * as THREE from 'three/webgpu';
import {
  createLabRenderer, type RenderCap,
} from './lab-renderer';
import {
  initialAdaptiveState, stepAdaptive, scaleForRung, SCALE_LADDER,
} from '../adaptive-scale';
import { createSdfLayer, SDF_LAYER, CONE_LAYER, OCCLUDER_LAYER, SHADOW_HULL_LAYER, SHELL_LAYER, SHELL_EXIT_LAYER } from './sdf-layer';
import { createFlashlight, DUNGEON_RIG, GALLERY_RIG, type AmbientRig } from './dungeon-lighting';
import { dungeonMaterialSet } from '../../../game/level/theme-material-set';
import { createOuterHull } from './shell-hull-outer';
import { createPostAa } from './post-aa';
import { createZombieGpuView, type ZombieGpuView } from './zombie-gpu';
import { createOccluderHull, buildHullInstances, HULL_SHRINK, type HullInstance } from './occluder-hull';
import { translateBody } from '../translate';
import { buildBody, DEFAULT_BUILD_OPTS, type BuildResult } from '../build-body';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette } from '../blob-compile';
import { checkStance } from '../blob-checks';
import { FLESH_PRESETS, LIGHT_PRESETS } from '../material';
import type { Vec3 } from '../types';
import zombieBlobSrc from '../characters/zombie.blob?raw';
import {
  ROOMS, TUNNELS, FURNITURE, levelColliders, levelSurfaces,
  enclosureKeyAt, enclosureOf, wanderBounds, spawnPoints, PLAYER_START,
  type RoomDef,
} from './game-level';
import { stepPlayer, eyeOf, PLAYER, type PlayerState, type MoveInput } from './game-player';
import { createZombieActor, type ZombieActor } from './game-actor';
import { buildFirefight, validateScenario } from './game-bench-scenario';
import { runBench, type BenchDeps } from './game-bench';
import { sdBody } from '../validate';
import {
  GRAPESHOT, SLUG, expired, mulberry32, spawnPellets, spawnSlug,
  stepProjectiles, traceProjectile, woundFromPellet, woundFromSlug, type Projectile,
} from './game-weapon';
import { resolveExplosion, type ExplosionBody } from '../explosion-aoe';
import { woundWorldPos, woundCarveNormal, type Wound } from '../damage';
import type { ImpactGoutProfile, Droplet } from '../blood-sim';
import {
  createBloodSim, spawnWoundDroplets, spawnImpactGout, emitTrails, stepBlood, IMPACT_GOUT,
} from '../blood-sim';
import { BleedRegistry, woundEmitAnchorAndNormal } from '../bleed-registry';
import {
  makeGutChain, pinGutChain, stepGutChain, detachGutChain, type GutChain,
} from '../entrails';
import { shouldSpill, GUT_DROPLET_SIZE, SPILL_CHANCE } from '../entrails-spawn';
import { createBloodView } from './blood-view-gpu';
import { createGooLayer, type GooLayer } from './goo-layer';
import { createGooPanel, type GooPanel } from './goo-panel';
import {
  createWoundPanel, defaultsFrom, WOUND_KEYS,
  type WoundPanel, type WoundTuningValues,
} from './wound-panel';
import { makeChunk, stepChunk } from '../gib-chunks';
import { chunkExtent } from '../extent';
import { createChunkGpuView, createSharedChunkGpuMaterial, type ChunkGpuView } from './zombie-gpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Primitive } from '../types';

/** Low but clearly visible — the owner's slide runs 0..1 from here. Measured
 *  on the room1 A/B (shadow-side px, mean channel shift vs probeWeight 0):
 *  0.5 -> (+12,+5,+2) on 743 px; 0.75 -> (+14,+7,+2) on 1735 px; 1.0 ->
 *  (+18,+10,+5) on 1848 px. Free at any weight: ambientAt is ANALYTIC — zero
 *  mapBody calls, pinned by the ambient tests — so the brief's probe-cost
 *  warning does not apply to the shipped P1 implementation. */
const DEFAULT_PROBE_WEIGHT = 0.75;

/**
 * RESOLUTION RUNGS — the owner picks with ?res=. All 4:3 except the legacy
 * '960' (the old fit-aspect 960x540 cap, kept so before/after numbers are
 * comparable). Default 800x600 per the owner's "capped at 800x600".
 *
 * SDF_SCALE is the SDF pass's fraction OF THE CAPPED BUFFER. Default 1.0:
 * one clean pixel grid — the march renders 1:1 with what gets presented and
 * upscaled once, instead of today's double resample (SDF at 0.7 of a
 * different-sized buffer). Cost table lives in the dispatch report.
 */
const RES_RUNGS = {
  '960': { mode: 'fit', maxW: 960, maxH: 540 },
  '800': { mode: 'fixed', width: 800, height: 600 },
  '640': { mode: 'fixed', width: 640, height: 480 },
} as const satisfies Record<string, RenderCap>;
type ResRung = keyof typeof RES_RUNGS;
const DEFAULT_RES: ResRung = '800';
function resRungFromUrl(): ResRung {
  const v = new URLSearchParams(location.search).get('res');
  return v && v in RES_RUNGS ? (v as ResRung) : DEFAULT_RES;
}

// The zombie's shared flat face sheet (zombie.blob has no `sheet` block) —
// the same registry entry bench-main duplicates from lab-main.
const ZOMBIE_FLAT = {
  url: '/assets/lab/zombie-face.png',
  rect: [0, 0, 64, 64, 64, 64] as [number, number, number, number, number, number],
  mean: 0.406,
};

/** The fattest additive prim in the head cluster — bench-main's headShape,
 *  verbatim: it normalises the face projection. */
function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  for (const p of b.prims.slice(head.start, head.start + head.count)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
    }
  }
  return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
}

async function main() {
  const mount = document.getElementById('app');
  if (!mount) throw new Error('#app not found');
  const resKey = resRungFromUrl();
  const handle = await createLabRenderer(mount, RES_RUNGS[resKey]);
  const { scene, camera } = handle;

  // -----------------------------------------------------------------------
  // The world: grey-box meshes from the same layout that feeds collision.
  // -----------------------------------------------------------------------
  const colliders = levelColliders();
  const surfaces = levelSurfaces();
  const levelGroup = new THREE.Group();
  levelGroup.name = 'ring-level';
  const stoneSet = dungeonMaterialSet();
  const stoneFor = (axis: 0 | 1 | 2, facing: 1 | -1) =>
    axis !== 1 ? stoneSet.wall
      : facing > 0 ? stoneSet.floor
        : stoneSet.perimeterAccent;
  for (const p of surfaces.planes) {
    const axis = p.axis;
    // Walls span (x|z, y); floors/ceilings span (x, z).
    const w = axis === 1 ? p.max[0] - p.min[0] : p.max[axis === 0 ? 2 : 0] - p.min[axis === 0 ? 2 : 0];
    const h = axis === 1 ? p.max[2] - p.min[2] : p.max[1] - p.min[1];
    const geo = new THREE.PlaneGeometry(w, h);
    // Ceilings face AWAY from every light in the stack (sun points down, the
    // hemisphere's ground term is weak), so with pure reflected light they
    // render near-black and the owner reads "void above" — the missing-wall
    // failure pointing up. A small emissive term in their own colour keeps
    // them legible as the room's top surface without flattening the mood.
    const isCeiling = axis === 1 && p.facing < 0;
    const base = stoneFor(axis, p.facing) as THREE.MeshStandardMaterial;
    const mesh = new THREE.Mesh(geo, base.clone());
    const mm = mesh.material as THREE.MeshStandardMaterial;
    mm.color = new THREE.Color(p.color[0], p.color[1], p.color[2]);
    // Ceilings keep a whisper of self-light so they do not read as a void —
    // but far less than the gallery needed, because the flashlight now
    // reaches them.
    if (isCeiling) mm.emissive = new THREE.Color(p.color[0], p.color[1], p.color[2]).multiplyScalar(0.10);
    const mid: Vec3 = [
      (p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2,
    ];
    mesh.position.set(mid[0], mid[1], mid[2]);
    if (axis === 1) mesh.rotation.x = p.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (axis === 0) mesh.rotation.y = p.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (p.facing < 0) mesh.rotation.y = Math.PI;
    levelGroup.add(mesh);
  }
  for (const b of surfaces.boxes) {
    const geo = new THREE.BoxGeometry(
      b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const mesh = new THREE.Mesh(geo, (stoneSet.coverLow as THREE.MeshStandardMaterial).clone());
    (mesh.material as THREE.MeshStandardMaterial).color =
      new THREE.Color(b.color[0], b.color[1], b.color[2]);
    mesh.position.set(
      (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    levelGroup.add(mesh);
  }
  scene.add(levelGroup);

  // CEILING FILL. The sun points down; ceilings (and north-south walls in
  // shadow) have normals pointing away from it, so with only a dim ambient
  // they rendered BLACK — read by the owner as "the same failure pointing
  // up" as the missing walls. A hemisphere light pays normal-dependent fill.
  // This touches ONLY these MeshStandardMaterials — the SDF bodies carry
  // their own lighting uniforms (enclosure bounce), so probe/bounce tuning
  // is untouched.
  const hemi = new THREE.HemisphereLight(0xa39c93, 0x8f8880, 0.8);
  scene.add(hemi);

  // -----------------------------------------------------------------------
  // THE GALLERY RIG (mesh side only). The lab factory ships a warm-sun +
  // dim-purple-ambient default that made the rooms read dark; the owner
  // wants a bright white-wall gallery. We give THIS PAGE its own rig by
  // recolouring/releveling the factory's two lights rather than editing
  // the shared factory (the lab's look must not move).
  // -----------------------------------------------------------------------
  for (const child of [...scene.children]) {
    if (child instanceof THREE.DirectionalLight) {
      child.color.setHex(0xfff8ef); // neutral-warm key, not orange sunset
      child.intensity = 0.9;
    }
    if (child instanceof THREE.AmbientLight) {
      child.color.setHex(0xffffff); // bright WHITE fill, was 0x4a3a40 @ 0.6
      child.intensity = 0.95;
    }
  }
  hemi.color.setHex(0xf5f3f0);   // sky term: near-white
  hemi.groundColor.setHex(0x8f8c86); // floor bounce: mid grey
  hemi.intensity = 0.75;

  // COLOURED ACCENTS as real mesh-side lights, straight from the level data
  // — the same entries litWallAlbedo folded into the bounce albedos, which
  // is what keeps walls and zombies agreeing about the light. Five point
  // lights total (one per room + room3's second): few, on purpose — every
  // real-time light here spends frame time on WALLS, not on what the owner
  // is watching.
  const accentGroup = new THREE.Group();
  accentGroup.name = 'accent-lights';
  const flickerLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  for (const r of ROOMS) {
    for (const a of r.accents) {
      const pl = new THREE.PointLight(
        new THREE.Color(a.color[0], a.color[1], a.color[2]), a.power);
      pl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      accentGroup.add(pl);
      flickerLights.push({ light: pl, base: a.power, phase: a.pos[0] * 3.1 + a.pos[2] * 1.7 });

      // A visible source. Without it the light has no cause and reads as a bug.
      const bowl = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.16, 1),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(a.color[0], a.color[1], a.color[2]),
          emissive: new THREE.Color(a.color[0], a.color[1], a.color[2]),
          emissiveIntensity: 2.2,
          roughness: 0.7,
        }));
      bowl.position.set(a.pos[0], a.pos[1], a.pos[2]);
      accentGroup.add(bowl);
    }
  }
  scene.add(accentGroup);

  // ---------------------------------------------------------------------
  // DUNGEON RIG. Off-state parity matters: with dungeon disabled the gallery
  // must render exactly as before, so the rig is applied, not hard-coded.
  // ---------------------------------------------------------------------
  let dungeonOn = true;
  /** Live beam tuning (panel + console). x is how hard the beam drives the
   *  key; y is the highlight shoulder that keeps WOUNDS readable under direct
   *  light — at 0 a lit body hard-clips and crater, lip and clean skin all
   *  saturate to the same white, so a shot enemy looks unshot exactly when you
   *  are close enough to aim (owner, 2026-09-01). */
  // Owner's tuned values (2026-09-01, second panel pass). The high gain works
  // precisely BECAUSE the shoulder is on: 4.0 would have clipped a body to a
  // featureless white silhouette under the old hard clamp.
  //
  // keyFloor is ZERO, and the earlier worry that zero would make an unlit body
  // vanish was wrong: ambientAt still returns the fill term (lightCfg.y *
  // keyColor), so a body out of the beam keeps a real floor without the preset
  // key. Owner: "higher makes the zombies a bit too bright against ambient
  // when not lit" — which is the point of a carried lamp. What you can see is
  // what you are pointing at.
  const beamTuning = { gain: 4, shoulder: 0.35, keyFloor: 0 };
  const flashlight = createFlashlight();
  // BOOT-TIME shadow ablation (?spotshadow=0), for the dungeon bench legs.
  // castShadow has to be decided BEFORE the first frame: toggling it live
  // crashes three r185 WebGPU (ShadowNode.updateShadow dereferences the
  // disposed map's depthTexture — see the __dungeon note below), and
  // shadow.intensity=0 cannot stand in — it only zeroes the SAMPLING term;
  // the 1024² map still renders every frame, so it would measure the wrong
  // split. At boot, AnalyticLightNode.setup never builds the shadow node at
  // all, so the leg is a true zero-cost ablation.
  flashlight.spot.castShadow = new URLSearchParams(location.search).get('spotshadow') !== '0';
  scene.add(flashlight.spot);
  scene.add(flashlight.spot.target);

  handle.renderer.shadowMap.enabled = true;
  handle.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  levelGroup.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  function applyRig(rig: AmbientRig) {
    hemi.intensity = rig.hemiIntensity;
    hemi.color.setRGB(...rig.hemiSky);
    hemi.groundColor.setRGB(...rig.hemiGround);
    for (const child of scene.children) {
      if (child instanceof THREE.DirectionalLight) child.intensity = rig.sunIntensity;
      if (child instanceof THREE.AmbientLight) {
        child.intensity = rig.ambientIntensity;
        child.color.setRGB(...rig.ambientColor);
      }
    }
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.setRGB(...rig.fogColor);
      fog.near = rig.fogNear;
      fog.far = rig.fogFar;
    }
    handle.renderer.setClearColor(new THREE.Color(...rig.fogColor));
    flashlight.spot.visible = rig === DUNGEON_RIG;
  }
  applyRig(DUNGEON_RIG);

  (globalThis as Record<string, unknown>).__dungeon = {
    setDungeon(on: boolean) { dungeonOn = on; applyRig(on ? DUNGEON_RIG : GALLERY_RIG); },
    get on() { return dungeonOn; },
    /** The weapon light itself, for runtime A/Bs (shadow.intensity 0/1 is the
     *  shadow kill switch — do NOT toggle spot.castShadow live, three r185
     *  WebGPU crashes rebuilding a disposed shadow map). */
    spot: flashlight.spot,
    /** Beam knobs, also on the tuning panel. */
    /** Accepts BOTH the short names and the panel's slider names, because the
     *  panel's COPY button emits the slider names (beamGain, ...) and a line
     *  you paste back must actually do something — it silently did nothing
     *  until 2026-09-01. */
    setBeam(t: {
      gain?: number; shoulder?: number; keyFloor?: number;
      beamGain?: number; beamShoulder?: number; beamKeyFloor?: number;
    }) {
      const gain = t.gain ?? t.beamGain;
      const shoulder = t.shoulder ?? t.beamShoulder;
      const keyFloor = t.keyFloor ?? t.beamKeyFloor;
      if (gain !== undefined) beamTuning.gain = gain;
      if (shoulder !== undefined) beamTuning.shoulder = shoulder;
      if (keyFloor !== undefined) beamTuning.keyFloor = keyFloor;
      return { ...beamTuning };
    },
    get beam() { return { ...beamTuning }; },
  };

  // -----------------------------------------------------------------------
  // The draw chain, exactly as the bench stands it up.
  // -----------------------------------------------------------------------
  const postAa = createPostAa(handle.renderer);
  const sdfLayer = createSdfLayer(handle.renderer);
  postAa.addSink(sdfLayer);
  /** SDF pass scale relative to the capped buffer. 1.0 = 1:1 (default).
   *  Runtime-adjustable for the cost table + adaptive ladder. */
  let sdfScale = 1.0;
  // Declared AHEAD of sizeSdfLayer because that function reads it and runs
  // during init — a `let` further down is a temporal dead zone and the page
  // dies before __sdfGame exists (caught immediately: headless boot found no
  // __sdfGame at all). Assigned once the actors give it a light rig.
  let gooLayer: GooLayer | null = null;
  let gooPanel: GooPanel | null = null;
  /** The wound panel (wound-panel.ts). Ships HIDDEN — unlike the goo panel,
   *  which ships visible because the goo layer ships on — so every existing
   *  look-capture script (gallery-look, shadow-ab, the canary) keeps framing
   *  the room and not another piece of UI. __sdfGame.woundPanel(true) opens
   *  it; that seam is guarded typeof-style in capture scripts like gooPanel. */
  let woundPanel: WoundPanel | null = null;
  // SHIPS ON (owner call, 2026-08-31: "set goo mode to default always to true
  // so i dont have to toggle it on each time"). setGoo(false) stays the kill
  // switch; mode 'depth' vs 'overlay' stays a separate toggle.
  let gooEnabled = true;

  function sizeSdfLayer() {
    const s = postAa.contentSize;
    sdfLayer.setSize(s.width, s.height);
    sdfLayer.setConeGeometry(camera.fov, sdfLayer.targetSize.height);
    // Density follows the SDF layer at GOO_TUNING.densityScale. Called from
    // here rather than a separate resize listener (lab-main's shape) because
    // ADAPTIVE RESOLUTION moves the SDF target at runtime through
    // applySdfScale -> sizeSdfLayer: a listener would never fire and the goo
    // would keep splatting into a stale-sized field.
    const t = sdfLayer.targetSize;
    gooLayer?.setSize(t.width, t.height);
  }
  sdfLayer.setScale(sdfScale);
  sizeSdfLayer();
  window.addEventListener('resize', sizeSdfLayer);
  function applySdfScale(v: number) {
    sdfScale = Math.min(1, Math.max(0.2, v));
    sdfLayer.setScale(sdfScale);
    sizeSdfLayer();
  }

  // -----------------------------------------------------------------------
  // ADAPTIVE RESOLUTION — same pure controller the lab uses (X1.13), wired
  // into the render callback. DEFAULT OFF: the chosen rung is what ships;
  // this is the frame-rate safety net the owner can switch on.
  // -----------------------------------------------------------------------
  // ADAPTIVE ON by default (2026-08-31), and the baseline is why.
  //
  // It lands AFTER the baseline on purpose: adaptive moves the pixel count
  // under load, so measuring with it on would have measured the safety net
  // instead of the cost. __sdfGame.bench suspends it for the same reason.
  //
  // The baseline then made the case for it stronger than expected. Resolution
  // scale is the ONLY lever that moved the frame — 0.7 is -39%/-25% and 0.5 is
  // -58%/-54%, while the occluder, the cone and FXAA all measured inside
  // repeat spread. Adaptive works by walking exactly that ladder, so it is the
  // one safety net with a measured mechanism behind it.
  // (docs/dev-notes/2026-08-31-game-perf-baseline/notes.md)
  //
  // It is still a FLOOR, not an answer: it buys frames by making the flesh
  // coarser during exactly the moments that matter most.
  let adaptiveEnabled = true;
  let adaptiveBudgetMs = 1000 / 30;
  let adaptiveState = initialAdaptiveState(performance.now());
  const ADAPTIVE_WINDOW = 30;
  const PROBE_ABORT_FRAMES = 8;
  const adaptiveFrames: number[] = [];
  function tickAdaptive(nowMs: number): void {
    if (!adaptiveEnabled) return;
    const failingProbe = adaptiveState.probing && adaptiveFrames.length >= PROBE_ABORT_FRAMES
      && (median(adaptiveFrames) > adaptiveBudgetMs * 1.1
        || adaptiveFrames.filter((f) => f > adaptiveBudgetMs * 1.8).length >= 2);
    if (adaptiveFrames.length < ADAPTIVE_WINDOW && !failingProbe) return;
    const recent = adaptiveFrames.slice(-ADAPTIVE_WINDOW);
    const sorted = [...recent].sort((a, b) => a - b);
    const next = stepAdaptive(adaptiveState, {
      nowMs,
      medianFrameMs: median(recent),
      p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      budgetMs: adaptiveBudgetMs,
    });
    if (next.rung !== adaptiveState.rung) {
      applySdfScale(scaleForRung(next.rung));
      // Frames rendered at the OLD scale must not feed the next decision.
      adaptiveFrames.length = 0;
    }
    adaptiveState = next;
  }
  function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    const hi = s[m]!;
    return s.length % 2 ? hi : (s[m - 1]! + hi) / 2;
  }
  // The frame's draw. With the goo layer on, the chain nests exactly as
  // lab-main's does: goo DENSITY (+ blur) first, the whole sdf/cone/occluder/
  // composite flow in the middle, then the goo SURFACE composited on top with
  // its reconstructed depth so the metaball blood interleaves with flesh and
  // floor. gooLayer is assigned further down (it needs a body view's light
  // uniforms, which only exist once the actors are built) — safe in this
  // closure because everything up to the end of main() is synchronous, so no
  // frame can fire against the hole.
  //
  // Goo OFF takes the original single-call path, so the toggle is exact.
  handle.setDrawFn(() => postAa.render(() => {
    flashlight.update(camera);
    // Hand the march the same beam the meshes get. The SDF bodies shade
    // inside the march and cannot see the scene's SpotLight at all (the
    // owner's "characters aren't lit by the light direction" report), so
    // the beam is replayed into per-body uniforms: same lamp pose, same
    // cone maths, per pixel. spotCfg.x gates it — 0 (gallery/lab) makes
    // the shader collapse to the old key exactly.
    {
      const sAxis = new THREE.Vector3();
      flashlight.spot.target.getWorldPosition(sAxis).sub(flashlight.spot.position).normalize();
      // x intensity gate, y cosInner, z cosOuter, w range — the cone edge
      // comes straight off the light so the two systems cannot drift.
      const spotOn = dungeonOn ? 1 : 0;
      const cosInner = Math.cos(flashlight.spot.angle * (1 - flashlight.spot.penumbra));
      const cosOuter = Math.cos(flashlight.spot.angle);
      for (const a of actors) {
        a.view.uniforms.spotPos.value.copy(flashlight.spot.position);
        a.view.uniforms.spotAxis.value.copy(sAxis);
        a.view.uniforms.spotCfg.value.set(spotOn, cosInner, cosOuter, flashlight.spot.distance);
        a.view.uniforms.spotColor.value.copy(flashlight.spot.color);
        a.view.uniforms.spotCfg2.value.set(beamTuning.gain, beamTuning.shoulder, beamTuning.keyFloor, 0);
      }
    }
    // Fire flicker. Cheap and deliberately not random per frame — a smooth
    // two-rate wobble reads as flame; white noise reads as a broken light.
    const ft = performance.now() * 0.001;
    for (const f of flickerLights) {
      const w = Math.sin(ft * 7.3 + f.phase) * 0.5 + Math.sin(ft * 17.1 + f.phase * 2.3) * 0.25;
      f.light.intensity = f.base * (1 + w * 0.14);
    }
    if (gooEnabled && gooLayer) {
      gooLayer.render(camera, () => sdfLayer.render(scene, camera));
    } else {
      sdfLayer.render(scene, camera);
    }
  }));

  const occluderHull = createOccluderHull();
  occluderHull.object.layers.set(OCCLUDER_LAYER);
  scene.add(occluderHull.object);
  // The inflated shadow-casting twin (see occluder-hull.ts). castShadow and
  // the layer are already set in the factory; spelled out here to sit beside
  // the occlusion hull's wiring, where the next reader will look first.
  //
  // NOTE it rides SHADOW_HULL_LAYER, NOT the occluder layer — which is why
  // the pre-pass being switched off below does not cost us character
  // shadows. The two hulls are twins in shape only; they have opposite
  // biases (shrunk to stay inside the body vs inflated to close the gaps
  // between spheres) and now opposite fates.
  occluderHull.shadowObject.layers.set(SHADOW_HULL_LAYER);
  occluderHull.shadowObject.castShadow = true;
  scene.add(occluderHull.shadowObject);

  // OCCLUDER PRE-PASS OFF (2026-09-01). Its tMax clamp is gone from the
  // march -- the distance it rasterises is only accurate in the near field
  // and under-reports badly beyond ~3 m, which shredded bodies at range.
  // The full measurement and the revival conditions are in march.wgsl.ts
  // above tMax. __sdfGame.setOccluder still renders the pass for
  // diagnostics; nothing consumes it.
  sdfLayer.setOccluderEnabled(false);

/**
   * Over-relaxation factor for the game page's march (woundCfg2.y).
   *
   * 1.0 = OFF, which falls through to marchCfg.y = 0.6. X1.10 measured 1.4 as
   * the optimum in the LAB and it is tempting here — it drops mean steps from
   * 18.1 to 10.7 and appears to resolve far more flesh (room 4: 26841 -> 50685
   * hit pixels).
   *
   * IT FAILED ITS VISUAL GATE ON THIS PAGE (2026-08-31). Those extra "hits"
   * are FALSE, and they are box-shaped: large translucent rectangles washing
   * over the walls, exactly the screen extents of the bodies' proxy boxes.
   * Mechanism is the same one that produced the shell halo — above omega 1.0
   * the tracer does `t = tMax; clamped = true` and takes a FINAL CLAMPED
   * SAMPLE, and at the far side of a big proxy box the AA epsilon
   * (t * aaCfg.x, growing with distance) accepts that sample as a surface.
   *
   * Interesting wrinkle worth keeping: the outer-hull shell SUPPRESSES the
   * artifact, because the false hits sit on box pixels outside the hull and
   * the shell discards those before the march runs (room 3 measured 8773
   * fewer hits with the shell on at 1.4, room 4 only 87 — the difference is
   * how much box lies outside the hull). So 1.4 may become available once the
   * shell defaults on, but it is not a free win on its own.
   *
   * Do not raise this without re-running the visual gate.
   */
  const GAME_RELAX = 1.0;

  /** The silhouette-noise amplitude the hull must budget for (marchCfg.z).
   *  Read from the live uniform rather than a constant, so retuning the noise
   *  cannot silently under-size the hull — X1.21.2 was exactly that bug on the
   *  cone and occluder bounds. */
  const shellAmpOf = () => actors[0]?.view.uniforms.marchCfg.value.z ?? 0;

  // The conservative OUTER hull (shell-hull-outer.ts). Default OFF: it is a
  // measurement instrument until the march consumes it, and rasterising it
  // for nothing is pure cost.
  const outerHull = createOuterHull();
  outerHull.entryObject.layers.set(SHELL_LAYER);
  outerHull.exitObject.layers.set(SHELL_EXIT_LAYER);
  scene.add(outerHull.entryObject);
  scene.add(outerHull.exitObject);
  // SHELL ON BY DEFAULT (owner visual pass, 2026-08-31). Worth -40%/-54%
  // frame time (room 4/3) at real-render parity below the same-state noise
  // floor. The hull is populated by the frame loop before the first draw
  // (tick runs ahead of drawFn), so no first-frame dropout. __sdfGame
  // .setShell(false) is the kill switch.
  sdfLayer.setShellEnabled(true);
  // Headless A/B seams (2026-08-27 hull-holes diagnosis): ship defaults stay
  // ON/ON; the driver flips these between captures. Mirrors the lab's
  // __sdfLab.setOccluder.
  let hullExclusionsEnabled = true;
  let occluderDesired = true;

  // -----------------------------------------------------------------------
  // Zombies. One compiled .blob, ten bodies; seeds/headings vary, the
  // character does not (12 prims each — the cheap one, on purpose).
  // -----------------------------------------------------------------------
  const doc = parseBlob(zombieBlobSrc);
  const face = compileFace(doc);
  const flesh = compilePalette(doc) ?? { ...FLESH_PRESETS['henenlotter-latex'] };
  const faceTex = new THREE.TextureLoader().load(ZOMBIE_FLAT.url);
  faceTex.magFilter = THREE.NearestFilter;
  faceTex.minFilter = THREE.NearestFilter;
  faceTex.generateMipmaps = false;
  faceTex.flipY = true;
  const [fx, fy, fw, fh, fsw, fsh] = ZOMBIE_FLAT.rect;
  const faceAtlas = new THREE.Vector4(fw / fsw, fh / fsh, fx / fsw, fy / fsh);

  let probeWeight = DEFAULT_PROBE_WEIGHT;

  /** Sever dispatch indirection — actors are built before the weapon block;
   *  the grapeshot wiring below assigns this once the chunk spawner exists. */
  let onSeverDispatch: ((a: ZombieActor, piece: { limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[] }, stumpWound: Wound | null) => void) | null = null;

  const actors: ZombieActor[] = [];
  const errors: string[] = [];
  let nextId = 1;

  // The wound panel's tuning state (wound-panel.ts). Lives HERE — before the
  // boot loop — because one of its eight keys, boneRatio, shapes buildBody's
  // bone derivation, so applying it is a REBUILD through the same spawn path
  // as boot. defaultsFrom equals the FleshMaterial defaults and surfCfg3's
  // uniform defaults, so an untouched panel is exactly the pre-panel page —
  // EXCEPT the two entrails knobs whose live defaults live in
  // entrails-spawn (task 5 tuned GUT_DROPLET_SIZE to 0.3 after the panel
  // table froze 0.12), so they are re-seeded from the constants just below.
  const woundTuning = defaultsFrom(WOUND_KEYS) as WoundTuningValues;
  // Boot parity: the panel's record must state what the page ACTUALLY does
  // before anyone drags a slider — gut ropes spawn at GUT_DROPLET_SIZE and
  // slug spill rolls at SPILL_CHANCE.slug. Seeding (rather than reading the
  // constants at the use sites) keeps one writer: dragging the slider later
  // overrides the seeded value and every later spawn honours it.
  woundTuning.gutSize = GUT_DROPLET_SIZE;
  woundTuning.spillChance = SPILL_CHANCE.slug;
  /** The owner's explicit bone ratio; null = defer to the doc (absent →
   *  DEFAULT_BONE_RATIO inside buildBody, and a later authored `bones ratio`
   *  would win untouched). Once the owner MOVES the slider their value wins
   *  every later build — an explicit setting clobbering an authored ratio is
   *  the requested semantics, so there is no extra flag machinery. */
  let boneRatioOverride: number | null = null;

  /** Push the panel's tissue ramp into one view's surfCfg3, plus the cavity
   *  pair. Component order is pinned by zombie-gpu's uniform table (x
   *  depthAmp, y fat, z muscle, w visceraAmp) — the same order applyMaterial
   *  writes the material defaults, so this is a re-apply, not a second
   *  writer with its own opinion. visceraDepth is its own uniform. Until
   *  entrails task 7 w stayed where applyMaterial left it; the panel's
   *  viscera knob now owns it, and its default (1) matches the preset, so
   *  an untouched panel still shades identically. */
  function applyWoundRamp(view: ZombieGpuView): void {
    const c = view.uniforms.surfCfg3.value;
    c.x = woundTuning.woundDepthAmp;
    c.y = woundTuning.fatDepth;
    c.z = woundTuning.muscleDepth;
    c.w = woundTuning.visceraAmp;
    view.uniforms.visceraDepth.value = woundTuning.visceraDepth;
  }

  /** The applied tuning record plus body 1's live surfCfg3 — the shader
   *  truth half of the seam's woundTuning getter/setWoundTuning return, so
   *  "did the slider reach the field" is one read, not a hope. */
  function woundTuningNow(): WoundTuningValues & { surfCfg3: number[] | null } {
    const c = actors[0]?.view.uniforms.surfCfg3.value;
    return { ...woundTuning, surfCfg3: c ? [c.x, c.y, c.z, c.w] : null };
  }

  /** The panel → field entry point, exposed on __sdfGame.setWoundTuning.
   *  The ramp trio and the viscera pair write uniforms live; gutSize and
   *  spillChance take effect on the next spawn / next roll (gutSize only
   *  shapes ropes spawned from now on — existing droplets keep their size,
   *  they are MOVED, not resized, by the frame loop); boneRatio rebuilds
   *  the cast. */
  function applyWoundTuning(o: Partial<WoundTuningValues>): void {
    let ramp = false;
    if (o.woundDepthAmp !== undefined) { woundTuning.woundDepthAmp = o.woundDepthAmp; ramp = true; }
    if (o.fatDepth !== undefined) { woundTuning.fatDepth = o.fatDepth; ramp = true; }
    if (o.muscleDepth !== undefined) { woundTuning.muscleDepth = o.muscleDepth; ramp = true; }
    if (o.visceraAmp !== undefined) { woundTuning.visceraAmp = o.visceraAmp; ramp = true; }
    if (o.visceraDepth !== undefined) { woundTuning.visceraDepth = o.visceraDepth; ramp = true; }
    if (ramp) for (const a of actors) applyWoundRamp(a.view);
    if (o.gutSize !== undefined) woundTuning.gutSize = o.gutSize;
    if (o.spillChance !== undefined) {
      woundTuning.spillChance = o.spillChance;
      // The roll reads the shared table (entrails-spawn.shouldSpill), so
      // overriding slug there is the whole override — no second source of
      // truth. blast spill stays 1.0.
      SPILL_CHANCE.slug = o.spillChance;
    }
    if (o.boneRatio !== undefined && o.boneRatio !== woundTuning.boneRatio) {
      boneRatioOverride = o.boneRatio;
      woundTuning.boneRatio = o.boneRatio;
      rebuildCast();
    }
  }

  /** ONE spawn — the boot-loop body, kept as THE actor path so the wound
   *  panel's bone-ratio rebuild cannot drift from boot. Pushes build errors
   *  into errs; the caller decides how to surface them. */
  function spawnZombie(room: RoomDef, start: Vec3, errs: string[]): ZombieActor {
    const enc = enclosureOf(room.name)!;
    const roomFurniture = FURNITURE
      .filter(f => f.room === room.id)
      .map(f => ({ min: [f.minX, 0, f.minZ] as Vec3, max: [f.maxX, f.height, f.maxZ] as Vec3 }));
    const compiled = compileBlob(doc, face);
    // The panel's ratio, once the owner has touched it, overrides whatever
    // the doc would have done (nothing today; an authored ratio from the
    // bones block, later).
    if (boneRatioOverride !== null) compiled.boneRatio = boneRatioOverride;
    const built = buildBody(compiled, DEFAULT_BUILD_OPTS, {});
    errs.push(...built.errors);
    if (doc.stance) errs.push(...checkStance(built.bones, doc.stance));
    // TRANSLATE THE FIELD, NOT THE MESH (translate.ts) — the shader
    // marches world space.
    const placed = translateBody(built, start);
    const view: ZombieGpuView = createZombieGpuView(placed,
      {
        cone: sdfLayer.cone,
        occluder: sdfLayer.occluder,
        // The outer hull's bounds. Passing them unconditionally is safe:
        // the fetch identities (0 / 1e9) make the march bit-identical while
        // sdfLayer.shellEnabled is false, which is the ship default.
        shell: {
          entry: sdfLayer.shellEntry.texture,
          exit: sdfLayer.shellExit.texture,
          uniforms: sdfLayer.shellEntry.uniforms,
        },
      });
    view.applyMaterial(flesh, LIGHT_PRESETS['practical-hard-key']);
    // The panel's ramp rides ON TOP of the material: applyMaterial just
    // wrote the preset defaults, so a tuned panel must re-stamp its values
    // or a rebuild would silently reset the ramp (the silent-reset class
    // of bug this panel exists to kill).
    applyWoundRamp(view);
    // Relaxation, explicit rather than inherited from the uniform default —
    // see GAME_RELAX for why it is 1.0 and what happened when it was 1.4.
    view.uniforms.woundCfg2.value.y = GAME_RELAX;
    view.setFaceTexture(faceTex, faceAtlas, ZOMBIE_FLAT.mean);
    view.uniforms.faceCfg.value.x = 1;
    view.uniforms.faceCfg.value.y = 1.0;
    view.uniforms.faceProj.value.set(0.45, 0.58, 0.5, 0.56);
    const skull = headShape(placed);
    if (skull) view.setHeadShape(skull.centre, skull.axes);
    // The room's enclosure: bounds + albedos, with the page's probeWeight.
    view.uniforms.boxMin.value.set(...enc.box.min);
    view.uniforms.boxMax.value.set(...enc.box.max);
    view.uniforms.wallNegX.value.setRGB(...enc.walls.negX);
    view.uniforms.wallPosX.value.setRGB(...enc.walls.posX);
    view.uniforms.wallNegY.value.setRGB(...enc.walls.negY);
    view.uniforms.wallPosY.value.setRGB(...enc.walls.posY);
    view.uniforms.wallNegZ.value.setRGB(...enc.walls.negZ);
    view.uniforms.wallPosZ.value.setRGB(...enc.walls.posZ);
    view.uniforms.bounceCfg.value.set(probeWeight, 4, 1, 1);
    view.object.layers.set(SDF_LAYER);
    view.coneObject.layers.set(CONE_LAYER);
    scene.add(view.object);
    scene.add(view.coneObject);
    const zombieId = nextId++;
    const actor = createZombieActor({
      id: zombieId, room: room.id, body: placed, view, start,
      seed: 1337 + nextId * 101,
      bounds: wanderBounds(room),
      furniture: roomFurniture,
      onSever: (piece, stumpWound) => onSeverDispatch?.(actor, piece, stumpWound),
    });
    return actor;
  }

  function spawnAll(errs: string[]): void {
    for (const room of ROOMS) {
      for (const start of spawnPoints(room)) {
        actors.push(spawnZombie(room, start, errs));
      }
    }
  }

  spawnAll(errors);
  if (errors.length > 0) {
    console.error('[sdf-game] body errors:', errors.join(' | '));
  }

  /** The wound panel's boneRatio lever (applyWoundTuning calls this). Bones
   *  are derived at BUILD time and packed into the prim data texture — there
   *  is no live repack — so the only honest way to apply a new ratio is to
   *  rebuild the cast through the same spawn path as boot. Wound state on
   *  the old bodies dies with them (the slider's tooltip says so). Ids
   *  continue from nextId, so capture scripts re-query rather than assume.
   *  Both hulls re-arm immediately: the frame-loop hull update is gated on
   *  !wanderFrozen, and a FROZEN bench leg calling setWoundTuning must not
   *  march through a stale hull. */
  function rebuildCast(): void {
    for (const a of actors) {
      scene.remove(a.view.object);
      scene.remove(a.view.coneObject);
      a.view.dispose();
    }
    actors.length = 0;
    const errs: string[] = [];
    spawnAll(errs);
    if (errs.length > 0) {
      console.error('[sdf-game] rebuilt body errors:', errs.join(' | '));
    }
    // The exclusion logic mirrors the refreshHull seam, which lives below
    // this point — object properties do not hoist, so it is restated here.
    occluderHull.update(
      actors.map(a => a.posed()),
      hullExclusionsEnabled
        ? actors.flatMap(a => {
          const prims = a.posed().prims;
          return a.wounds().map(w => ({ centre: woundWorldPos(prims, w, 0), radius: w.radius }));
        })
        : [],
    );
    if (sdfLayer.shellEnabled) {
      outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
    }
  }

  function pushProbeWeight(v: number) {
    probeWeight = Math.min(1, Math.max(0, v));
    for (const a of actors) a.view.uniforms.bounceCfg.value.x = probeWeight;
  }

  // -----------------------------------------------------------------------
  // Player: pointer lock + WASD + gravity + capsule-vs-AABB.
  // -----------------------------------------------------------------------
  const player: PlayerState = {
    pos: [PLAYER_START.x, 0, PLAYER_START.z],
    vel: [0, 0, 0],
    yaw: PLAYER_START.yaw,
    pitch: PLAYER_START.pitch,
    grounded: true,
  };
  const keys = new Set<string>();
  const canvas = handle.canvas;
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    hud.lockHint = document.pointerLockElement !== canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    player.yaw += e.movementX * 0.0022;
    player.pitch = Math.min(PLAYER.pitchLimit,
      Math.max(-PLAYER.pitchLimit, player.pitch - e.movementY * 0.0022));
  });
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'BracketLeft') pushProbeWeight(probeWeight - 0.05);
    if (e.code === 'BracketRight') pushProbeWeight(probeWeight + 0.05);
    if (e.code === 'KeyP') {
      if (probeWeight > 0) { parked = probeWeight; pushProbeWeight(0); }
      else pushProbeWeight(parked);
    }
    if (e.code === 'KeyE') { slugMode = !slugMode; updateHud(); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  let parked = DEFAULT_PROBE_WEIGHT;

  // GRAPESHOT INPUT. Left = one barrel, right = both. The first click only
  // locks the pointer; shots need lock so a stray desktop click cannot fire.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) fire(1);
    else if (e.button === 2) fire(2);
  });

  // The seam for the grapeshot dispatch: a view-model hangs off this group,
  // which rides the camera every frame.
  const viewModelAnchor = new THREE.Group();
  viewModelAnchor.name = 'view-model-anchor';
  // Ride height of the whole view-model (gun + orb hands move together).
  // Owner playtest 2026-08-26: the gun sat high enough to crowd the frame.
  // Captured current / −5 cm / −10 cm from the same spot and compared: −5 cm
  // frees the centre of the frame while the breech and hammers — the detail
  // that chose this model — stay fully in frame; −10 cm starts to sink the
  // grip out of the bottom edge. −5 cm is the shipped height.
  viewModelAnchor.position.y = -0.05;
  camera.add(viewModelAnchor);
  scene.add(camera);

  // -----------------------------------------------------------------------
  // GRAPESHOT — the first weapon. View-model (k3 GLB + green orb hands),
  // travelling pellets, wound/sever wiring through the actors, and ballistic
  // chunks for whatever comes off. Fire model per the spec §2 as trimmed by
  // the dispatch brief: click = one barrel, right-click = both, cooldown +
  // camera kick in; break-open reload animation and muzzle smoke are not.
  // -----------------------------------------------------------------------
  const GUN_GLB = '/assets/lab/grapeshot-gun-k3.glb';
  /** Grip-point origin, muzzles down -Y. Muzzle sits ~0.515 m down-barrel
   *  from the grip centre (model script: natural muzzle Y≈-0.44 minus the
   *  GRIP_NATURAL shift). */
  const MUZZLE_LOCAL: [number, number, number] = [0, -0.515, 0];
  let gunGroup: THREE.Group | null = null;
  let gunReady = false;
  try {
    const gltf = await new GLTFLoader().loadAsync(GUN_GLB);
    // PBR metal is black without something to reflect — this page has no
    // environment and the flesh's hand-written lighting does not apply to a
    // MeshStandardMaterial. Per-material env, kit-overlay style, so the level
    // meshes keep their gallery look.
    const pmrem = new THREE.PMREMGenerator(handle.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        const std = mat as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          std.envMap = env;
          std.envMapIntensity = 0.7;
          std.needsUpdate = true;
        }
      }
    });
    gunGroup = new THREE.Group();
    gunGroup.name = 'grapeshot-k3';
    gunGroup.add(gltf.scene);
    // AXIS NOTE: the model script's "muzzles down -Y" is BLENDER space;
    // Blender's Z-up -> glTF Y-up conversion (x,z,-y) lands them at +Z in
    // GLB space, up stays +Y. rotation.y = PI aims +Z down the camera's -Z
    // (forward) with the hammers still on top. (rotation.x = PI/2 pointed
    // the gun at the sky — first live capture caught it.)
    gunGroup.rotation.y = Math.PI;
    gunGroup.position.set(0.17, -0.2, -0.32);
    viewModelAnchor.add(gunGroup);

    // HANDS ARE GREEN ORBS — deliberate, per the owner: the player is the
    // goblin and its hands were never detailed. One on the grip, one braced
    // under the fore-end. Anchored in VIEW space (not gun space) so the
    // axis convention of the GLB cannot move them.
    const orbGeo = new THREE.SphereGeometry(0.055, 20, 14);
    const orbMat = new THREE.MeshStandardMaterial({ color: 0x5a8f3c, roughness: 0.85 });
    const gripHand = new THREE.Mesh(orbGeo, orbMat);
    gripHand.position.set(0.17, -0.26, -0.30);
    const foreHand = new THREE.Mesh(orbGeo, orbMat);
    foreHand.position.set(0.17, -0.24, -0.62);
    viewModelAnchor.add(gripHand, foreHand);
    gunReady = true;
  } catch (err) {
    console.error('[sdf-game] gun model failed to load — firing still works', err);
  }

  /** Muzzle world position from the current camera pose (independent of the
   *  gun mesh's matrix state — fires identically headless). */
  function muzzleWorld(): Vec3 {
    const eye = eyeOf(player);
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const right: Vec3 = [cy, 0, sy];
    return [
      eye[0] + right[0] * 0.2 - sy * 0.5,
      eye[1] - 0.12,
      eye[2] + right[2] * 0.2 + cy * 0.5,
    ];
  }
  function aimDir(): Vec3 {
    const cp = Math.cos(player.pitch);
    return [Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp];
  }
  /** AIM CONVERGENCE (2026-08-26 defect-2 fix candidate): the muzzle sits
   *  ~20 cm right and ~12 cm low of the EYE, and pellets used to fly PARALLEL
   *  to the camera ray — so at ANY range impacts landed that whole offset off
   *  the crosshair. Standard FPS remedy: every projectile converges on the
   *  point where the camera ray meets AIM_CONVERGE_M. Close shots still group;
   *  the parallel-ray offset is gone by construction. */
  const AIM_CONVERGE_M = 8;
  function convergedDir(origin: Vec3): Vec3 {
    const eye = eyeOf(player);
    const a = aimDir();
    const target: Vec3 = [
      eye[0] + a[0] * AIM_CONVERGE_M,
      eye[1] + a[1] * AIM_CONVERGE_M,
      eye[2] + a[2] * AIM_CONVERGE_M,
    ];
    const d: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  // Pellets: simulated pure (game-weapon.ts), drawn from a mesh pool that
  // grows on demand inside the tick's sync step.
  const pellets: Projectile[] = [];
  const pelletGeo = new THREE.SphereGeometry(GRAPESHOT.radius, 10, 8);
  const pelletMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
  const pelletViews: THREE.Mesh[] = [];

  let nextSeed = 0x5df1;
  let cooldown = 0;
  let recoilPitch = 0;

  /** SLUG MODE — one big projectile, one big crater. Diagnostic first: eight
   *  barely-visible 5.5 cm craters gave no signal about placement or look.
   *  Reachable three ways: ?slug URL param at boot, KeyE in-page toggle, or
   *  __sdfGame.fireSlug(). The HUD shows which mode is live. */
  let slugMode = new URLSearchParams(location.search).has('slug');

  function fire(barrels: 1 | 2): boolean {
    if (!gunReady || cooldown > 0) return false;
    cooldown = GRAPESHOT.fireCooldownSec;
    recoilPitch += GRAPESHOT.kickRadPerBarrel * barrels;
    if (slugMode) {
      // One lump down one known ray instead of a pellet volley.
      pellets.push(spawnSlug(muzzleWorld(), convergedDir(muzzleWorld())));
      nextSeed = (nextSeed * 1664525 + 1013904223) >>> 0;
      return true;
    }
    const muz = muzzleWorld();
    const dir = convergedDir(muz);
    // spawnPellets spreads around `dir`; convergence just re-centres the cone.
    pellets.push(...spawnPellets(muz, dir, barrels, nextSeed));
    nextSeed = (nextSeed * 1664525 + 1013904223) >>> 0;
    return true;
  }

  // Chunks: detached pieces fly ballistically and render through the shared
  // SDF chunk path — the same pipeline the lab gibs with, capped and
  // recycled so a gore party cannot churn views unboundedly.
  const MAX_CHUNKS = 12;
  const chunkMaterial = createSharedChunkGpuMaterial();
  const chunkViews: ChunkGpuView[] = [];
  const liveChunks: { id: number; state: ReturnType<typeof makeChunk>; view: ChunkGpuView }[] = [];
  let nextChunkId = 1;
  function primsLongAxis(prims: Primitive[], origin: Vec3): Vec3 {
    let best: Vec3 = [0, 1, 0];
    let bestLen = 0;
    for (const p of prims) {
      if (p.op === 'sub') continue;
      const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l > bestLen) { bestLen = l; best = d; }
    }
    return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
  }
  function spawnChunkPiece(
    piece: { limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[] },
    template: { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture },
  ) {
    const rng = mulberry32(nextSeed++);
    const vel: Vec3 = [
      (rng() - 0.5) * 4.5,
      2.5 + rng() * 2.5,
      (rng() - 0.5) * 4.5,
    ];
    const state = makeChunk(
      piece.limb as never, piece.origin, vel,
      chunkExtent(piece.prims, piece.origin), primsLongAxis(piece.prims, piece.origin),
      rng, 'limb',
    );
    const oldest = liveChunks.length >= MAX_CHUNKS ? liveChunks.shift() : undefined;
    if (oldest) {
      oldest.view.reset(state, piece.prims, piece.tornAt.length ? piece.tornAt : undefined);
      liveChunks.push({ id: nextChunkId++, state, view: oldest.view });
    } else {
      const view = createChunkGpuView(
        state, piece.prims, template.uniforms,
        piece.tornAt.length ? piece.tornAt : undefined,
        template.volumeTexture, chunkMaterial,
      );
      view.object.layers.set(SDF_LAYER);
      scene.add(view.object);
      chunkViews.push(view);
      liveChunks.push({ id: nextChunkId++, state, view });
    }
  }

  // -----------------------------------------------------------------------
  // BLEED (bleeding-wounds spec, 2026-08-31). Wounds ooze/spurt/gush per
  // calibre; flying chunks trail droplets; everything settles into floor
  // splats. The pure sim lives in blood-sim.ts, the ledger in
  // bleed-registry.ts; this block owns anchors + the seeded stream.
  // Ships ON (it is the feature); __sdfGame.setBleed(false) is the off
  // gate, and OFF must be pixel-identical to the pre-feature page.
  // -----------------------------------------------------------------------
  const bloodSim = createBloodSim();
  const bleed = new BleedRegistry();

  // -----------------------------------------------------------------------
  // GOO — screen-space metaball blood (X1.bleed-look round 2). The owner's
  // brief was "viscous and gooey and shiny blobbys and no hard edges ...
  // kinda like the metablob for the goo system", which is goo-layer.ts's own
  // job description; round 1's ribbons were judged "too thin and
  // uninteresting" because lines cannot be volumes.
  //
  // It shares a body view's light uniform NODES — not copies — so the goo and
  // the flesh stay lit by one rig. That is why it is created HERE, after the
  // actors: those nodes do not exist until a view does.
  // -----------------------------------------------------------------------
  const gooRigView = actors[0]?.view;
  if (gooRigView) {
    gooLayer = createGooLayer(handle.renderer, {
      lightDir: gooRigView.uniforms.lightDir,
      keyColor: gooRigView.uniforms.keyColor,
      lightCfg: gooRigView.uniforms.lightCfg,
    });
    postAa.addSink(gooLayer);
    const t = sdfLayer.targetSize;
    gooLayer.setSize(t.width, t.height);
    // Game defaults. The threshold trades two failure modes against each
    // other and BOTH were hit on the way here:
    //   too low  -> every isolated droplet clears it and draws its own oval
    //               (three rounds of "little oval drops"; the old 0.95 clamp
    //               made this unavoidable, since a lone blob peaks near 1.0)
    //   too high -> only dense overlap draws, so an ordinary pellet hit
    //               renders NOTHING (measured: 10 droplets, zero pixels)
    // 0.6 sits where dense stream sections fuse into connected ropes while a
    // thin hit still reads. Fat blobs and wide blur do the fusing; mist
    // carries the sparse case and the satellite grain the references show.
    // Tune live with __sdfGame.setGooTuning — 1.2+ for heavy ropes, 0.4 for
    // a wetter, beadier read.
    // GAME-PAGE GOO DEFAULTS — the owner's own tuning pass, 2026-08-31,
    // found on the live panel and pasted back verbatim. Set here rather than
    // in GOO_TUNING because that table is shared with the LAB, whose look was
    // tuned separately and must not move.
    //
    // Worth reading as a whole, because it is not where I expected to land:
    // small blobs (0.14), almost NO blur (0.5), stretch at maximum, gloss at
    // maximum, and a nearly stationary gout. That is a sharp, wet, elongated
    // read — the opposite of the round fused mass I kept steering toward.
    gooLayer.setSizeScale(0.14);
    gooLayer.setThreshold(0.65);
    // BLUR OFF (owner, 2026-08-31: "we can remove the blur"). 0 bypasses both
    // blur passes ENTIRELY — not a degenerate copy — so this is also two
    // fewer full-screen passes per frame. The code stays because goo-layer is
    // shared with the LAB, whose look is tuned around blurPx 2.5.
    gooLayer.setBlurPx(0);
    // DEPTH, not overlay. Overlay never depth-tests, so blood paints over the
    // crate it is behind and over the far side of the body it came out of,
    // which reads as a sticker regardless of scale. Overlay was added to
    // route around a depth blocker that turned out not to exist — the real
    // bug was the post-aa sink — so the reconstruction gets to do its job.
    gooLayer.setMode('depth');
    gooLayer.setStretch(4);
    gooLayer.setEdge(2.75);
    gooLayer.setAbsorb(1.6);
    gooLayer.setSpec(2.85);
    gooLayer.setGloss(220);
    gooLayer.setRim(0);
    // shadowRed RETUNED 0.12 -> 0.19 for the dungeon (owner, 2026-09-01).
    // Its whole job is that blood never reads black, and it was calibrated
    // against WHITE gallery walls that this relight deleted — against dark
    // wet stone the old floor was not enough to keep shadowed blood red.
    gooLayer.setShadowRed(0.19);


    // Live tuning panel (owner ask, 2026-08-31: "add a ui i can tune the goo
    // manually"). The look is a five-knob family found by sweeping two at a
    // time and watching; retyping setGooTuning after every reload is not a
    // sweep. Goo ships ON, so the panel ships VISIBLE with it — this is a
    // debug page and the panel is the reason to turn the layer on at all.
    // Dismissable with __sdfGame.gooPanel(false), which is also what the
    // headless look-capture calls so screenshots frame the room, not the UI.
    const L = gooLayer;
    gooPanel = createGooPanel([
      { key: 'sizeScale', group: 'goo', min: 0.05, max: 1.5, step: 0.01,
        hint: 'World-size multiplier per blob. The scale knob: too high and the mass swallows the room.',
        get: () => L.sizeScale, set: v => L.setSizeScale(v) },
      { key: 'threshold', group: 'goo', min: 0.05, max: 4, step: 0.05,
        hint: 'Density needed to be goo. A LONE blob peaks near 1.0, so below 1 every isolated droplet draws its own shape.',
        get: () => L.threshold, set: v => L.setThreshold(v) },
      { key: 'blurPx', group: 'goo', min: 0, max: 16, step: 0.5,
        hint: 'Gaussian sigma. Wider blur fuses neighbouring peaks BEFORE the threshold sees them — the grapes-to-sheets knob.',
        get: () => L.blurPx, set: v => L.setBlurPx(v) },
      { key: 'stretch', group: 'goo', min: 0, max: 4, step: 0.05,
        hint: 'Velocity elongation cap. 0 = round blobs. High values turn a fast gout into a starburst of needles.',
        get: () => L.stretch, set: v => L.setStretch(v) },
      { key: 'edge', group: 'goo', min: 1.05, max: 4, step: 0.05,
        hint: 'Soft-edge band width, as a multiple of threshold.',
        get: () => L.edge, set: v => L.setEdge(v) },
      { key: 'absorb', group: 'goo', min: 0, max: 3, step: 0.05,
        hint: 'Beer-Lambert thickness. Higher = darker crimson core against a brighter thin fringe.',
        get: () => L.absorb, set: v => L.setAbsorb(v) },
      { key: 'spec', group: 'goo', min: 0, max: 4, step: 0.05,
        hint: 'Specular strength — the wet glint.',
        get: () => L.spec, set: v => L.setSpec(v) },
      { key: 'gloss', group: 'goo', min: 8, max: 220, step: 2,
        hint: 'Specular exponent. Low = broad sheen, high = pinpoint.',
        get: () => L.gloss, set: v => L.setGloss(v) },
      { key: 'rim', group: 'goo', min: 0, max: 1, step: 0.02,
        hint: 'Fresnel rim strength.',
        get: () => L.rim, set: v => L.setRim(v) },
      { key: 'shadowRed', group: 'goo', min: 0, max: 0.6, step: 0.01,
        hint: 'Deep-red floor. Stops heavy absorption or a grazing light from driving blood to black. 0 = off.',
        get: () => L.shadowRed, set: v => L.setShadowRed(v) },
      { key: 'count', group: 'gout', min: 10, max: 300, step: 5,
        hint: 'Slug gout droplets per impact. More = denser mass, but MAX_DROPLETS is 600 across the whole sim.',
        get: () => IMPACT_GOUT.slug.count, set: v => { IMPACT_GOUT.slug.count = Math.round(v); } },
      { key: 'speedMax', group: 'gout', min: 0.5, max: 12, step: 0.25,
        hint: 'Head speed. High values scatter the pulse before it can fuse.',
        get: () => IMPACT_GOUT.slug.speedMax, set: v => { IMPACT_GOUT.slug.speedMax = v; } },
      { key: 'speedMin', group: 'gout', min: 0.2, max: 8, step: 0.1,
        hint: 'Tail speed. The head/tail gap is what stretches the pulse into a rope.',
        get: () => IMPACT_GOUT.slug.speedMin, set: v => { IMPACT_GOUT.slug.speedMin = v; } },
      { key: 'beamGain', group: 'beam', min: 0, max: 8, step: 0.05,
        hint: 'How hard the flashlight drives the key on CHARACTERS. Was a fixed 2.2, which blew bodies past white. Raise for punch, lower if faces flatten out.',
        get: () => beamTuning.gain, set: v => { beamTuning.gain = v; } },
      { key: 'beamShoulder', group: 'beam', min: 0, max: 0.9, step: 0.05,
        hint: 'Highlight rolloff. 0 = hard clip, and a lit body loses its WOUNDS (crater, lip and skin all saturate to the same white). Higher keeps them readable under the beam.',
        get: () => beamTuning.shoulder, set: v => { beamTuning.shoulder = v; } },
      { key: 'beamKeyFloor', group: 'beam', min: 0, max: 1, step: 0.05,
        hint: 'How much of the PRESET key survives when the beam is off. 1.0 = the old bug (characters brightly lit in pitch darkness from a fixed direction). 0 = an unlit body vanishes entirely, because bounce carries hue, not level.',
        get: () => beamTuning.keyFloor, set: v => { beamTuning.keyFloor = v; } },
    ], {
      toggles: [
        {
          // The depth cue, and the reason the goo can read as "pasted on".
          // OVERLAY never depth-tests, so blood paints over the crate it is
          // behind and over the far side of the body it came out of — which
          // the eye reads as a sticker, no matter what the scale is. DEPTH
          // writes a reconstructed depth and interleaves with flesh and floor.
          label: () => `mode: ${L.mode}`,
          hint: 'overlay = always on top (no occlusion). depth = interleaves with the scene.',
          onClick: () => L.setMode(L.mode === 'overlay' ? 'depth' : 'overlay'),
        },
        {
          // The other half of "reads pasted on": the gradient normal tilts a
          // flat CAMERA-FACING base, so every blob is lit as though facing
          // you. The surface normal is reconstructed from the field's own
          // view depth and responds to where the blood actually points.
          label: () => `normals: ${L.surfaceNormals ? 'surface' : 'gradient'}`,
          hint: 'surface = world-oriented, reconstructed from depth. gradient = original screen-space tilt.',
          onClick: () => L.setSurfaceNormals(!L.surfaceNormals),
        },
      ],
      presets: [
        { label: 'blobby',
          values: { sizeScale: 0.35, threshold: 1.2, blurPx: 9, stretch: 0, edge: 1.6,
            absorb: 1, spec: 2, gloss: 55, rim: 0.3, shadowRed: 0.12, count: 140, speedMax: 3.5, speedMin: 1 } },
        { label: 'strands',
          values: { sizeScale: 0.22, threshold: 0.8, blurPx: 5, stretch: 0.8, edge: 1.6,
            absorb: 0.55, spec: 1.4, gloss: 80, rim: 0.3, shadowRed: 0.12, count: 90, speedMax: 8, speedMin: 1.5 } },
        { label: 'shipped',
          values: { sizeScale: 0.14, threshold: 0.65, blurPx: 0, stretch: 4, edge: 2.75,
            absorb: 1.6, spec: 2.85, gloss: 220, rim: 0, shadowRed: 0.12,
            count: 85, speedMax: 0.5, speedMin: 0.2 } },
      ],
    });
  }

  // Wound tuning panel (wound pass r2 task 8). One key table (WOUND_KEYS)
  // drives the sliders, the setter and the COPY text, so the panel cannot
  // emit a key the seam ignores — that drift shipped twice before (setBeam,
  // then the goo panel) and both times the tuning LOOKED applied and was
  // not. The four ramp keys are live uniform writes; boneRatio rebuilds the
  // cast (see rebuildCast — bones are derived at build time and there is no
  // live repack), which is why it commits on release instead of per tick.
  // Wounds read best with actual wounds on screen: aim + fire, then sweep.
  woundPanel = createWoundPanel({
    get: () => ({ ...woundTuning }),
    set: (key, v) => applyWoundTuning({ [key]: v }),
    presets: [
      { label: 'shipped', values: { ...woundTuning } },
      {
        // A "what the ramp can do" reference: knees pulled deep. For seeing
        // the fat/muscle bands at a glance, not a look.
        label: 'raw',
        values: { woundDepthAmp: 1, fatDepth: 0.008, muscleDepth: 0.03 },
      },
    ],
  });
  // Visible on boot, for the same reason the goo panel is (owner ask,
  // 2026-09-02: the sliders could not be found). `woundPanel(true)` was the
  // only way in, and a tuning panel nobody can find is a panel that does not
  // exist — the owner played a whole session against defaults without knowing
  // the knobs were there. `__sdfGame.woundPanel(false)` dismisses it, and
  // capture scripts already guard the seam typeof-style.
  woundPanel?.setVisible(true);
  // The lab's droplet renderer, game-tuned: depth-WRITING cutout droplets
  // (the SDF composite's depth test then occludes droplets both ways — see
  // BloodViewOpts.dropletDepthWrite) at sim size (the lab's 0.45 is close-
  // camera compensation; BLOOD_TRAIL.size is already game-camera tuned).
  // Splats keep the lab's soft depthWrite:false — the floor's depth already
  // arbitrates them, and their 0.005 m lift beats z-fighting.
  // dropletViewScale 0.5: the owner's first-look verdict (2026-08-31) was
  // "really big" at FPV range — the lab's own 0.45 compensation exists for
  // exactly this. 0.5 keeps them a hair beefier than the lab since the game
  // wants the blood to READ; the deeper look change (gooey spray + mist
  // instead of sprite blobs) is a tracked exploration, not a scale knob.
  // X1.bleed-look pass 1 (owner: "big oval blood cells"): aggressive filament
  // stretch with volume-conserving thinning (fast spray reads as streaks, slow
  // drips stay beads) + a mist haze mesh (alphaHash so it survives the
  // composite's depth test while reading soft).
  const bloodView = createBloodView({
    dropletDepthWrite: true,
    dropletViewScale: 0.5,
    stretch: { k: 0.5, max: 3.5, thin: true },
    mist: true,
    // Round 2 (owner): "ribbons and blood trails to create cohesive lines of
    // fluid" — beads sweep tapered strips through their path history.
    ribbons: true,
  });
  for (const o of bloodView.objects) {
    o.visible = true; // ships ON (it is the feature); setBleed(false) hides
    scene.add(o);
  }

  // Goo ships ON, so apply the view state setGoo(true) would have set. Placed
  // here rather than beside the goo tuning above because bloodView does not
  // exist yet at that point in main().
  //
  // Beads off: the goo surface replaces them, and drawing both renders the
  // same particles twice. MIST STAYS — it is the sparse-case floor. The goo
  // only draws where droplets OVERLAP, so an ordinary pellet hit crosses no
  // threshold and draws nothing; with mist hidden too the result is a wound
  // with no blood at all (reproduced headless, 2026-08-31).
  if (gooEnabled) {
    bloodView.setBeadsVisible(false);
    bloodView.setMistVisible(true);
    // ...AND show the panel. It used to appear only via setGoo(true), which
    // this boot path deliberately does not call — so the panel that exists to
    // make the goo tunable was invisible on the page where goo ships ON, and
    // the owner had to toggle the layer off and on to get at it (owner ask,
    // 2026-09-01: "it should be default on tbh").
    gooPanel?.setVisible(true);
  }
  // One seeded stream for EVERY bleed decision (spawns, trails, splat
  // stamps) — advanced only while bleed is enabled, so setBleed(false)
  // freezes the subsystem exactly (OFF mid-stream = ON-stream-paused).
  const bleedRng = mulberry32(0x5eedb1e);
  let bleedEnabled = true;

  // GUT ROPES — at most one per body (entrails-spawn.shouldSpill): the first
  // qualifying cavity wound spawns, a second TEARS the rope free instead of
  // growing another, which bounds both the verlet sim and the goo particle
  // count. The chain owns node positions (entrails.ts); the sim only holds
  // this rope's 'gut' droplets — stepBlood skips that kind — so the goo pass
  // draws the rope as fused metaballs riding the wound's emit point.
  const gutRopes = new Map<number, { chain: GutChain; wound: Wound; droplets: Droplet[] }>();
  /** The one spill decision, taken at stamp time where cluster membership is
   *  free. Call for EVERY stamped wound (live fire routes through
   *  registerBleed; the capture twins stamp through stampBlast, so they call
   *  this directly). Rolls bleedRng — see the freeze note on registerBleed. */
  function spillVerdict(a: ZombieActor, wound: Wound): void {
    const entry = gutRopes.get(a.id);
    const verdict = shouldSpill(wound, entry !== undefined, bleedRng);
    if (verdict === 'none') return;
    if (verdict === 'tear') {
      // Keep the entry: the detached chain keeps falling/settling in
      // stepGutRopes, and its presence still blocks a second rope.
      if (entry) gutRopes.set(a.id, { ...entry, chain: detachGutChain(entry.chain) });
      return;
    }
    const { anchor } = woundEmitAnchorAndNormal(a.posed().prims, wound);
    gutRopes.set(a.id, { chain: makeGutChain(anchor), wound, droplets: [] });
  }

  /** Per-frame rope sim, BEFORE the bleed block (so stepBlood sees the same
   *  frame it does): pin to the wound's current emit point — the anchor is
   *  recomputed from the CURRENT posed prims, which is what makes the rope
   *  ride the gait — step the chain, then copy node positions into the
   *  rope's persistent 'gut' droplets. Uses only the actor's already-posed
   *  prims; never re-poses. Runs regardless of bleedEnabled: a hanging gut
   *  is body state, not spray, and stepping spends no RNG. */
  function stepGutRopes(dt: number): void {
    for (const a of actors) {
      let entry = gutRopes.get(a.id);
      if (!entry) continue;
      // Body down (falling or settled) → the rope tears free. It keeps its
      // verlet momentum, falls, settles, freezes (entrails.ts).
      if (entry.chain.attached && a.debug().phase !== 'standing') {
        entry = { ...entry, chain: detachGutChain(entry.chain) };
        gutRopes.set(a.id, entry);
      }
      if (entry.chain.attached) {
        const { anchor } = woundEmitAnchorAndNormal(a.posed().prims, entry.wound);
        entry = { ...entry, chain: pinGutChain(entry.chain, anchor) };
        gutRopes.set(a.id, entry);
      }
      entry = { ...entry, chain: stepGutChain(entry.chain, dt) };
      gutRopes.set(a.id, entry);

      // Keep the rope's droplets in the sim. They are created once and then
      // MOVED (Droplet.pos is mutable by contract; stepBlood skips 'gut'),
      // unless particle pressure evicted them (MAX_DROPLETS shift) — then
      // rebuild at the nodes' current positions.
      const nodes = entry.chain.nodes;
      const live = entry.droplets.length === nodes.length
        && entry.droplets[0] !== undefined
        && bloodSim.droplets.includes(entry.droplets[0]);
      if (!live) {
        const fresh: Droplet[] = nodes.map(n => ({
          pos: [...n.pos] as [number, number, number],
          vel: [0, 0, 0] as [number, number, number],
          age: 0, life: Infinity,
          size: woundTuning.gutSize,
          kind: 'gut',
        }));
        for (const d of fresh) bloodSim.droplets.push(d);
        entry = { ...entry, droplets: fresh };
        gutRopes.set(a.id, entry);
      } else {
        const invDt = dt > 1e-6 ? 1 / dt : 0;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i]!;
          const d = entry.droplets[i]!;
          // Honest velocity — the goo stretch follows node motion, so a
          // swinging rope smears, a settled one doesn't.
          d.vel[0] = (n.pos[0] - n.prev[0]) * invDt;
          d.vel[1] = (n.pos[1] - n.prev[1]) * invDt;
          d.vel[2] = (n.pos[2] - n.prev[2]) * invDt;
          d.pos[0] = n.pos[0];
          d.pos[1] = n.pos[1];
          d.pos[2] = n.pos[2];
        }
      }
    }
  }
  /** Bleed's own sim clock — an accumulator, never wall time, so hand-
   *  stepped captures are deterministic. */
  let bleedClock = 0;
  function registerBleed(a: ZombieActor, wound: Wound, kind: 'pellet' | 'slug' | 'stump'): void {
    if (!bleedEnabled) return;
    bleed.register(a.id, wound, kind, bleedClock);
    // IMPACT GOUT (blood-viscosity spec §a) — the dense one-tick pulse, at
    // the wound's own anchor so it leaves the body where the hole is. Fired
    // here rather than at each call site because both the impact path and
    // the sever path already funnel through this function, and two copies
    // would drift. Uses the SAME bleedRng, so setBleed(false) freezes gouts
    // and the trickle together and captures stay deterministic.
    const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, wound);
    // The gout sprays back along the incoming shot; spawnImpactGout negates
    // what it is handed, and the wound normal already points OUT of the
    // body, so pass the inward direction.
    spawnImpactGout(bloodSim, kind, anchor, [-normal[0], -normal[1], -normal[2]], bleedRng);
    // Gut-rope decision for this stamped wound — placed BELOW the
    // !bleedEnabled guard on purpose: the roll spends bleedRng, and the
    // invariant above (OFF mid-stream = ON-stream-paused) only holds if
    // nothing advances the stream while bleed is frozen. The capture twins
    // (stampWoundAt/explode) call spillVerdict directly instead.
    spillVerdict(a, wound);
  }

  // Wire every actor's severs into the chunk spawner (template = that
  // actor's own look — the chunk shades like the flesh it came from), and
  // each sever's stump wound into the bleed ledger (the gushing emitter —
  // the wound is the actor's own reference, so the anchor rides the body).
  onSeverDispatch = (a, piece, stumpWound) => {
    spawnChunkPiece(piece, { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture });
    if (stumpWound) registerBleed(a, stumpWound, 'stump');
  };

  // -----------------------------------------------------------------------
  // HUD: frame time, bodies on screen, probeWeight, where you are.
  // -----------------------------------------------------------------------
  const hudEl = document.getElementById('hud');
  const hud = { lockHint: true };
  let frameEma = 0;
  const bootTime = performance.now();
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const bodySphere = new THREE.Sphere(new THREE.Vector3(), 1.1);

  function bodiesOnScreen(): number {
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    let n = 0;
    for (const a of actors) {
      const torso = a.posed().clusters.find(c => c.limb === 'torso');
      if (!torso) continue;
      bodySphere.center.set(torso.center[0], torso.center[1], torso.center[2]);
      if (frustum.intersectsSphere(bodySphere)) n++;
    }
    return n;
  }

  function updateHud() {
    if (!hudEl) return;
    const where = enclosureKeyAt(player.pos[0], player.pos[2]);
    hudEl.textContent =
      `${frameEma.toFixed(1)} ms · bodies ${bodiesOnScreen()}/${actors.length}` +
      ` · ${where} · probe ${probeWeight.toFixed(2)}` +
      (slugMode ? ' · ● SLUG (E to switch back)' : ' · PELLETS (E = slug)') +
      (sdfLayer.halfRate
        ? ` · HALF30 ${sdfLayer.halfRateMode === 1 ? 'reproj' : 'hold'}`
        : '') +
      (hud.lockHint ? ' · click to lock' : '') +
      (wanderFrozen ? ' · FROZEN' : '');
  }

  // -----------------------------------------------------------------------
  // Frame loop.
  // -----------------------------------------------------------------------
  let wanderFrozen = false;
  let frameCount = 0;
  /** The __sdfGame.placeMarker debug sphere. */
  let marker: THREE.Mesh | null = null;
  /** Headless driver autopilot: walk toward (x, z) until within 0.25 m. */
  let autopilot: { x: number; z: number } | null = null;
  /** Stuck recovery: a wanderer frozen/standing on the path blocks the line
   *  head-on (the capsule push exactly opposes the intent, no slide). If we
   *  stop making progress, strafe around the obstacle for a beat. */
  let stuckT = 0;
  let strafeT = 0;
  let strafeDir = 1;
  let lastWalkPos: [number, number] | null = null;

  function tick(dt: number) {
    let input: MoveInput = {
      x: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      z: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      jump: keys.has('Space'),
    };
    if (autopilot) {
      const dx = autopilot.x - player.pos[0];
      const dz = autopilot.z - player.pos[2];
      if (Math.hypot(dx, dz) < 0.25) {
        autopilot = null;
        input = { x: 0, z: 0, jump: false };
      } else if (strafeT > 0) {
        strafeT -= dt;
        input = { x: strafeDir, z: 0.2, jump: false };
      } else {
        player.yaw = Math.atan2(dx, -dz);
        input = { x: 0, z: 1, jump: false };
      }
      if (lastWalkPos
        && Math.hypot(player.pos[0] - lastWalkPos[0], player.pos[2] - lastWalkPos[1]) < 0.02) {
        stuckT += dt;
        if (stuckT > 0.5) {
          // Strafe AWAY from whatever is ahead: nearest zombie within 1.2 m
          // in front picks the side; walls just get the fallback flip.
          const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
          let bestLat: number | null = null;
          let bestFwd = Infinity;
          for (const a of actors) {
            const ox = a.pose().pos[0] - player.pos[0];
            const oz = a.pose().pos[2] - player.pos[2];
            const fwdDist = ox * sy - oz * cy;
            const lat = ox * cy + oz * sy;
            if (fwdDist > 0 && fwdDist < 1.2 && Math.abs(lat) < 0.9 && fwdDist < bestFwd) {
              bestFwd = fwdDist;
              bestLat = lat;
            }
          }
          strafeDir = bestLat !== null ? (bestLat > 0 ? -1 : 1) : -strafeDir;
          strafeT = 0.8;
          stuckT = 0;
        }
      } else {
        stuckT = 0;
      }
      lastWalkPos = [player.pos[0], player.pos[2]];
    }
    // Zombies are soft obstacles: one fat AABB each, rebuilt per frame.
    const zombieBoxes = actors.map(a => {
      const p = a.pose().pos;
      return { min: [p[0] - 0.35, 0, p[2] - 0.35] as Vec3, max: [p[0] + 0.35, 1.8, p[2] + 0.35] as Vec3 };
    });
    stepPlayer(player, input, dt, [...colliders, ...zombieBoxes]);

    if (!wanderFrozen) {
      for (const a of actors) a.step(dt);
      const now = performance.now() / 1000;
      for (const a of actors) {
        a.view.setTime(now);
        // Face projection tracks the posed skull through the gait jiggle.
        const skull = headShape(a.posed());
        if (skull) a.view.setHeadShape(skull.centre, skull.axes);
      }
      // Wound exclusion, same contract as the lab's woundSpheres: hull
      // endpoint spheres must not sit inside carve zones, or they render as
      // pale discs inside craters. The carve sphere is centred ON the anchor
      // (depth-slab-clipped in the shader), so the full-radius sphere here is
      // a superset — it can only over-exclude (a slightly looser hull), never
      // expose. The game never passed this before 2026-08-27 because its
      // craters were tangent (the pale-wound defect) and never reached the
      // hull; real craters exposed it within one capture.
      if (sdfLayer.shellEnabled) {
        // Same posed bodies the occluder hull is built from, one line below —
        // this is what makes the hull "posed" at no extra cost.
        outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      }
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
            const prims = a.posed().prims;
            return a.wounds().map(w => ({ centre: woundWorldPos(prims, w, 0), radius: w.radius }));
          })
          : [],
      );
    }

    // ---------------------------------------------------------------
    // GRAPESHOT SIM — pellets fly, land as wounds through actor.hit();
    // detached pieces fly ballistically through the shared chunk path.
    // ---------------------------------------------------------------
    cooldown = Math.max(0, cooldown - dt);
    recoilPitch *= Math.exp(-9 * dt);
    {
      const prevs = pellets.map(p => [...p.pos] as Vec3);
      stepProjectiles(pellets, dt);
      for (let i = pellets.length - 1; i >= 0; i--) {
        const p = pellets[i]!;
        const from = prevs[i]!;
        let dead = expired(p) || p.pos[1] <= 0.02;
        if (!dead) {
          // Level geometry: a point-in-AABB test is enough — pellets are
          // small and the substepped trace already bounds their travel.
          for (const b of colliders) {
            if (p.pos[0] > b.min[0] && p.pos[0] < b.max[0]
              && p.pos[1] > b.min[1] && p.pos[1] < b.max[1]
              && p.pos[2] > b.min[2] && p.pos[2] < b.max[2]) { dead = true; break; }
          }
        }
        if (!dead) {
          // Actors: bounding-sphere reject on the frame segment, then a
          // substepped trace against the posed field. Nearest hit wins.
          let bestDist = Infinity;
          let hitActor: ZombieActor | null = null;
          let hitPoint: Vec3 | null = null;
          const segLen = Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]);
          for (const a of actors) {
            const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
            if (!c) continue;
            // Segment-to-centre distance (clamped closest approach).
            const t = Math.max(0, Math.min(segLen,
              ((c[0]-from[0])*(p.pos[0]-from[0]) + (c[1]-from[1])*(p.pos[1]-from[1]) + (c[2]-from[2])*(p.pos[2]-from[2]))
              / (segLen * segLen || 1)));
            const qx = from[0] + (p.pos[0]-from[0]) * t / (segLen || 1);
            const qy = from[1] + (p.pos[1]-from[1]) * t / (segLen || 1);
            const qz = from[2] + (p.pos[2]-from[2]) * t / (segLen || 1);
            if (Math.hypot(qx-c[0], qy-c[1], qz-c[2]) > 1.35) continue;
            const posedA = a.posed();
            const hp = traceProjectile(from, p.pos, q => sdBody(q, posedA));
            if (!hp) continue;
            const d = Math.hypot(hp[0]-from[0], hp[1]-from[1], hp[2]-from[2]);
            if (d < bestDist) { bestDist = d; hitActor = a; hitPoint = hp; }
          }
          if (hitActor && hitPoint) {
            const l = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) || 1;
            const dirN: Vec3 = [p.vel[0] / l, p.vel[1] / l, p.vel[2] / l];
            // hit/hitSlug RETURN the wound this impact stamped (pre-sever),
            // so the bleed emitter binds the exact wound instead of sniffing
            // the ring tail (a hit that also severs puts a stump there).
            const stamped = p.kind === 'slug'
              ? hitActor.hitSlug(hitPoint, dirN)
              : hitActor.hit(hitPoint, dirN);
            if (stamped) registerBleed(hitActor, stamped, p.kind);
            dead = true;
          }
        }
        if (dead) pellets.splice(i, 1);
      }
      // Sync the mesh pool to the sim list — growing it on demand (the
      // pool is ONLY grown here; fire() must not touch meshes because it
      // runs from an evaluate() with no frame in between).
      while (pelletViews.length < pellets.length) {
        const mesh = new THREE.Mesh(pelletGeo, pelletMat);
        mesh.frustumCulled = false;
        scene.add(mesh);
        pelletViews.push(mesh);
      }
      for (let k = 0; k < pelletViews.length; k++) {
        const v = pelletViews[k]!;
        if (k < pellets.length) {
          v.visible = true;
          v.position.set(pellets[k]!.pos[0], pellets[k]!.pos[1], pellets[k]!.pos[2]);
          // Slug balls are drawn at their own (larger) calibre.
          const s = pellets[k]!.radius / GRAPESHOT.radius;
          v.scale.setScalar(s);
        } else {
          v.visible = false;
        }
      }
      // Chunks: ballistic step + world-space field repack, lab contract.
      const cdt = Math.min(dt, 1 / 30);
      // GUT ROPES first, so stepBlood's skip of 'gut' droplets this frame
      // sees this frame's chain positions (see stepGutRopes).
      stepGutRopes(cdt);
      for (const c of liveChunks) {
        c.state = stepChunk(c.state, cdt);
        c.view.update(c.state);
      }
      // BLEED — emitters spray (anchors recomputed from the CURRENT posed
      // prims, so droplets ride the walking body), flying chunks trail, and
      // the sim settles into splats. Runs even with the wander frozen: it is
      // a cosmetic sim exactly like the pellets and chunks above (a frozen
      // capture that fired still bleeds), and posed() is always current.
      if (bleedEnabled) {
        bleedClock += cdt;
        for (const e of bleed.live(bleedClock)) {
          const a = actors.find(q => q.id === e.bodyId);
          if (!a) { bleed.evictForBody(e.bodyId); continue; }
          const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, e.wound);
          e.acc = spawnWoundDroplets(
            bloodSim, e.kind, bleedClock - e.bornAt, anchor, normal, cdt, e.acc, bleedRng,
          );
        }
        emitTrails(
          bloodSim,
          liveChunks.map(c => ({ id: c.id, pos: c.state.pos, vel: c.state.vel })),
          cdt, bleedRng,
        );
        stepBlood(bloodSim, cdt, bleedRng);
        // Re-pose every instance from sim state (billboards track the camera
        // even frozen — same contract as the lab's always-sync).
        bloodView.sync(bloodSim, camera);
      }
    }

    const eye = eyeOf(player);
    camera.position.set(eye[0], eye[1], eye[2]);
    const cp = Math.cos(player.pitch + recoilPitch);
    camera.lookAt(
      eye[0] + Math.sin(player.yaw) * cp,
      eye[1] + Math.sin(player.pitch + recoilPitch),
      eye[2] - Math.cos(player.yaw) * cp,
    );
    camera.updateMatrixWorld();

    // GOO DENSITY QUADS — pose them from the same sim state, every frame,
    // AFTER the camera is final and before the drawFn composites. The lab
    // has always done this (lab-main: bloodView.sync then gooLayer.sync);
    // the game-page port shipped without it, and that ONE MISSING LINE is
    // why the goo never appeared here.
    //
    // Without sync the InstancedMesh keeps its zeroed instance matrices, so
    // every density quad is degenerate, the field is empty on every frame,
    // and NO threshold can ever be crossed. That is not a look bug with a
    // tuning fix — it is the pass rendering nothing at all, which is exactly
    // what five threshold sweeps and a depth-reconstruction investigation
    // were unknowingly chasing. There is a source tripwire on this call in
    // goo-layer.test.ts; do not remove one without the other.
    //
    // Unconditional, NOT under bleedEnabled like bloodView.sync above: floor
    // splats persist in the sim after bleed is switched off, and the goo
    // draws them. Gating this would freeze the pools mid-frame instead.
    gooLayer?.sync(bloodSim, camera);
  }

  handle.setRenderCallback((dt) => {
    // Wall-clock frame delta (seconds -> ms), EMA'd — what the owner feels.
    // During __sdfGame.step() the dt is the supplied fixed step, not a
    // measurement; the readout only means something with the loop running.
    if (dt < 0.25) {
      const ms = dt * 1000;
      frameEma = frameEma === 0 ? ms : frameEma * 0.95 + ms * 0.05;
      if (adaptiveEnabled) {
        adaptiveFrames.push(ms);
        tickAdaptive(performance.now());
      }
    }
    tick(Math.min(dt, 1 / 20));
    if (frameCount++ % 10 === 0) updateHud();
  });
  updateHud();

  // -----------------------------------------------------------------------
  // __sdfGame — the deterministic driver surface. The grapeshot dispatch
  // builds on this: zombies are addressable by id, the player pose is
  // settable, frames are steppable, wanderers freezable.
  // -----------------------------------------------------------------------
  /** Where a slug fired RIGHT NOW would hit — the shared predictor.
   *  Lifted out of __sdfGame so aimAtNearestSurface can CONFIRM an aim
   *  with the same code the placement gate uses, rather than trusting a
   *  cluster centre. No state mutated. */
  function predictSlugHitNow(): { origin: Vec3; dir: Vec3; actorId: number; hit: Vec3 | null } {
      const origin = muzzleWorld();
      const dir = convergedDir(origin);
      let bestD = Infinity;
      let hitActorId = -1;
      let hitPoint: Vec3 | null = null;
      // Simulate the slug's ACTUAL flight (gravity, like stepProjectiles) —
      // a straight muzzle ray ignores the drop and reads ~4 cm high at 3 m,
      // which the placement gate duly failed (2026-08-27).
      const pos: [number, number, number] = [origin[0], origin[1], origin[2]];
      const d0: [number, number, number] = [dir[0], dir[1], dir[2]];
      const vel: [number, number, number] = [d0[0] * SLUG.speed, d0[1] * SLUG.speed, d0[2] * SLUG.speed];
      const dt = 1 / 120;
      for (const a of actors) {
        const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
        if (!c) continue;
        if (Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]) > 20) continue;
        const posedA = a.posed();
        // Per-actor arc: reset the integrator, march segment-wise for 2 s.
        pos[0] = origin[0]; pos[1] = origin[1]; pos[2] = origin[2];
        vel[0] = d0[0] * SLUG.speed; vel[1] = d0[1] * SLUG.speed; vel[2] = d0[2] * SLUG.speed;
        for (let i = 0; i < 240; i++) {
          const next: Vec3 = [
            pos[0] + vel[0] * dt,
            pos[1] + vel[1] * dt,
            pos[2] + vel[2] * dt,
          ];
          const vNext: Vec3 = [vel[0], vel[1] + SLUG.gravity * dt, vel[2]];
          const hp = traceProjectile(pos, next, q => sdBody(q, posedA));
          if (hp) {
            const d = Math.hypot(hp[0] - origin[0], hp[1] - origin[1], hp[2] - origin[2]);
            if (d < bestD) { bestD = d; hitActorId = a.id; hitPoint = hp; }
            break;
          }
          pos[0] = next[0]; pos[1] = next[1]; pos[2] = next[2];
          vel[0] = vNext[0]; vel[1] = vNext[1]; vel[2] = vNext[2];
        }
      }
      return { origin, dir, actorId: hitActorId, hit: hitPoint };
  }

  /**
   * Aim at a body the ballistic predictor CONFIRMS is hittable.
   *
   * Two things this must not do, both learned by measurement (2026-08-31):
   *
   *   1. Do not stamp at a cluster CENTRE. A torso centre sits INSIDE the
   *      field: it anchors the crater pathologically, and a slug's severRadius
   *      cuts both hip necks into an instant collapse. The centre is used only
   *      to POINT the camera; the shot itself resolves to a surface.
   *   2. Do not aim at whatever is nearest. Room 4 spawns its zombies around
   *      the room centre, so a bench standing at the centre had a body 0.97 m
   *      away — close enough that the aim pitched 26 degrees DOWN into it, the
   *      predictor returned actorId -1, and all eight pellets expired having
   *      hit nothing. The bench then reported "firing" segments that contained
   *      no wounds at all.
   *
   * So: candidates in distance order, skipping anything inside MIN_STANDOFF,
   * and the first one the predictor confirms wins. Returns false if none do,
   * which leaves the aim untouched — a bench that silently re-aimed until it
   * connected would be measuring something the scenario never described.
   */
  const MIN_STANDOFF = 1.5;
  function aimAtNearestSurface(): boolean {
    const eye = eyeOf(player);
    const candidates = actors
      .map((a) => {
        const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
        return c ? { c: [...c] as Vec3, d: Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]) } : null;
      })
      .filter((x): x is { c: Vec3; d: number } => x !== null && x.d >= MIN_STANDOFF)
      .sort((a, b) => a.d - b.d);

    const yaw0 = player.yaw;
    const pitch0 = player.pitch;
    for (const cand of candidates) {
      // YAW CONVENTION: the page's forward is (sin yaw, −cos yaw) — camera
      // lookAt (below), aimDir and muzzleWorld all agree — so facing a target
      // at offset (dx, dz) is atan2(dx, −dz). walkTo (above) already did this
      // right; these two bench sites had the z sign flipped since cdba91f,
      // which mirrored the aim across the player's z plane. It only ever
      // "worked" while bodies happened to sit near that plane; with the group
      // fully on one side the bench faced a wall, benched an empty frustum
      // and fired every shot into it (measured 2026-09-02: census 0, 0
      // wounds, p50 1.5 ms). NOTE the aim search is still needed even with
      // the sign right: the predictor simulates SLUG GRAVITY, so dead-on
      // yaw/pitch at the torso can still miss low — try candidates, keep the
      // first the predictor confirms.
      player.yaw = Math.atan2(cand.c[0] - eye[0], -(cand.c[2] - eye[2]));
      player.pitch = Math.atan2(cand.c[1] - eye[1], Math.hypot(cand.c[0] - eye[0], cand.c[2] - eye[2]));
      if (predictSlugHitNow().actorId >= 0) return true;
    }
    player.yaw = yaw0;
    player.pitch = pitch0;
    return false;
  }

  (window as unknown as { __sdfGame: unknown }).__sdfGame = {
    backend: handle.backend,
    /** Set the player pose. y defaults to 0 (feet on the floor). */
    setPose(x: number, z: number, yaw: number, pitch = 0, y = 0) {
      player.pos = [x, y, z];
      player.vel = [0, 0, 0];
      player.yaw = yaw;
      player.pitch = pitch;
      player.grounded = y === 0;
    },
    pose: () => ({ pos: [...player.pos] as Vec3, yaw: player.yaw, pitch: player.pitch }),
    /** Teleport to a room's centre, facing +z. */
    teleport(roomId: number) {
      const r = ROOMS.find(r => r.id === roomId);
      if (!r) return false;
      player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
      player.vel = [0, 0, 0];
      player.yaw = 0;
      player.pitch = 0;
      return true;
    },
    /** Enclosure key under the player's feet ('room1'..'room4', tunnel, 'void'). */
    room: () => enclosureKeyAt(player.pos[0], player.pos[2]),
    /** Hand-step N frames at dt seconds each; stops the rAF loop first. */
    step(n: number, dt = 1 / 60) {
      handle.setLoopRunning(false);
      for (let i = 0; i < n; i++) {
        handle.step(dt);
        if (frameCount++ % 10 === 0) updateHud();
      }
    },
    setLoopRunning: (on: boolean) => handle.setLoopRunning(on),
    /** Freeze/unfreeze the wanderers (pose, rig and shader clock all pin). */
    freeze: (on: boolean) => { wanderFrozen = on; },
    get frozen() { return wanderFrozen; },
    setProbeWeight: pushProbeWeight,
    get probeWeight() { return probeWeight; },
    /** Every zombie: id, room, live ground pose. */
    zombies: () => actors.map(a => ({ id: a.id, room: a.room, ...a.pose() })),
    /** One zombie's internals — the weapon seam: view (uniforms/wounds),
     *  posed() (raycast target), boundRig() (impulse/recoil entry). */
    zombie: (id: number) => {
      const a = actors.find(a => a.id === id);
      return a ? {
        view: a.view, posed: a.posed, boundRig: a.boundRig, pose: a.pose, room: a.room,
        woundCount: () => a.wounds().length,
        woundList: () => [...a.wounds()],
      } : undefined;
    },
    /** Where every wound of a body sits IN WORLD SPACE right now — the
     *  surface anchor (= the GPU carve sphere's centre) plus the depth-slab
     *  cap, all at the yaw-0 contract. The placement gate diffs the surface
     *  against the fired ray's impact point; carveDepth is the punch-through
     *  guard (0.45 × measured local flesh). */
    debugWounds: (id: number) => {
      const a = actors.find(a => a.id === id);
      if (!a) return undefined;
      const prims = a.posed().prims;
      return a.wounds().map(w => ({
        surface: woundWorldPos(prims, w, 0),
        carveNormal: woundCarveNormal(prims, w, 0),
        carveDepth: w.carveDepth,
        radius: w.radius,
        type: w.type,
        primIdx: w.primIdx,
      }));
    },
    /** Task-8 evidence seam: live gut-rope state per body, read-only. A body
     *  with no rope entry reports {none: true}. droplets is the rope's current
     *  'gut'-kind population in the blood sim (the goo pass's input). */
    guts: () => actors.map(a => {
      const e = gutRopes.get(a.id);
      const nodes = e?.chain.nodes ?? [];
      return {
        id: a.id,
        room: a.room,
        phase: a.debug().phase,
        none: !e,
        attached: e?.chain.attached ?? false,
        settled: e?.chain.settled ?? false,
        nodes: nodes.length,
        head: nodes[0] ? [...nodes[0]!.pos] as Vec3 : null,
        tail: nodes.length ? [...nodes[nodes.length - 1]!.pos] as Vec3 : null,
        droplets: e?.droplets.length ?? 0,
        woundCavity: e ? e.wound.cavity === true : null,
      };
    }),
    /** Walk the player toward (x, z) through the real collision path until
     *  within 0.25 m (or walkCancel). Pairs with step()/setLoopRunning. */
    walkTo: (x: number, z: number) => { autopilot = { x, z }; },
    walkCancel: () => { autopilot = null; },
    get walking() { return autopilot !== null; },
    frameMs: () => frameEma,
    bodiesOnScreen,
    // ---------------------------------------------------------------
    // GRAPESHOT — the weapon surface. fire(1|2) bypasses pointer lock so
    // the headless driver can shoot; aim with setPose(yaw, pitch).
    // ---------------------------------------------------------------
    fire: (barrels: 1 | 2 = 1) => fire(barrels),
    get gunReady() { return gunReady; },
    get cooldown() { return cooldown; },
    // SLUG MODE surface + HUD-truthful flag.
    get slugMode() { return slugMode; },
    setSlugMode(on: boolean) { slugMode = on; updateHud(); },
    fireSlug: () => { const keep = slugMode; slugMode = true; try { return fire(1); } finally { slugMode = keep; } },
    // ---------------------------------------------------------------
    // BLEED seams (bleeding-wounds). Ships ON; setBleed(false) is the
    // off gate — it freezes AND clears the blood sim so OFF is pixel-
    // identical to the pre-feature page (no frozen mid-air droplets).
    // ---------------------------------------------------------------
    setBleed: (on: boolean) => {
      bleedEnabled = on;
      for (const o of bloodView.objects) o.visible = on;
      if (!on) {
        bloodSim.droplets.length = 0;
        bloodSim.splats.length = 0;
      }
    },
    get bleed() {
      return {
        enabled: bleedEnabled,
        emitters: bleed.live(bleedClock).length,
        droplets: bloodSim.droplets.length,
        splats: bloodSim.splats.length,
      };
    },
    /** PLACEMENT GATE (2026-08-26): where a slug fired RIGHT NOW would hit —
     *  computed by exactly the code fire() uses (muzzleWorld + converged
     *  dir) against each actor's CURRENT posed field. No state mutated.
     *  Diff against debugWounds() after firing to assert the crater landed
     *  where the ray struck. */
    predictSlugHit: () => predictSlugHitNow(),
    /** Hull-holes A/B seams (2026-08-27). setOccluder turns the occluder
     *  pre-pass (and its tMax clamp) on/off; setHullExclusions passes an
     *  empty wound list to the hull builder instead of the live one. Both
     *  default to shipped behaviour. */
    setOccluder: (on: boolean) => {
      occluderDesired = on;
      sdfLayer.setOccluderEnabled(on);
    },
    get occluder() { return sdfLayer.occluderEnabled && occluderDesired; },
    setHullExclusions: (on: boolean) => { hullExclusionsEnabled = on; },
    get hullExclusions() { return hullExclusionsEnabled; },

    // -------------------------------------------------------------------
    // BENCH SEAMS (2026-08-31). Everything the ablation legs toggle, plus
    // the fence the harness times against. Ship defaults are unchanged —
    // these only move when a driver moves them.
    // -------------------------------------------------------------------
    /** The GPU completion fence. Trust the fence, never a timestamp value. */
    resolveGpu: () => handle.resolveGpu(),
    // setAdaptive / setSdfScale already exist further down this object and
    // are better than the versions this block first added (they also clear
    // the adaptive sample window and report the whole ladder). Not
    // duplicated here — the driver calls those.
    setCone: (on: boolean) => sdfLayer.setConeEnabled(on),
    get cone() { return sdfLayer.coneEnabled; },
    setFxaa: (on: boolean) => postAa.setFxaa(on),
    get fxaa() { return postAa.fxaa; },
    setSmear: (v: number) => postAa.setSmear(v),
    // ---------------------------------------------------------------
    // C2 HALF-RATE — march every other frame, reproject the held march
    // in between (sdf-layer.ts header). Default OFF; the look verdict is
    // the owner's, from the capture reel.
    // ---------------------------------------------------------------
    setHalfRate: (on: boolean) => sdfLayer.setHalfRate(on),
    get halfRate() { return sdfLayer.halfRate; },
    /** 0 = hold only, 1 = per-pixel depth reproject (default). */
    setHalfRateMode: (n: number) => sdfLayer.setHalfRateMode(n),
    get halfRateMode() { return sdfLayer.halfRateMode; },
    /** Aim at the nearest body's surface. Exposed so a driver can stage a
     *  shot the same way the bench scenario does. */
    aimSurface: () => aimAtNearestSurface(),

    /**
     * Screen-space metaball blood (X1.bleed-look round 2). ON suppresses the
     * bead + ribbon sprites: the goo surface carries the fluid body, and
     * those are the hard-edged shapes it exists to replace (they would also
     * draw the same particles twice). Mist and floor splats stay.
     */
    setGoo(on: boolean) {
      if (!gooLayer) return false;
      gooEnabled = on;
      // Beads and ribbons go: they are the hard-edged shapes the goo
      // replaces, and they would draw the same particles twice.
      bloodView.setBeadsVisible(!on);
      // MIST STAYS. Hiding it (first cut) was a bug with teeth: the goo only
      // draws where droplets OVERLAP, so a sparse hit — an ordinary pellet
      // at range — crosses no threshold and draws NOTHING, and with mist off
      // too the result was a wound with no blood at all. Reproduced headless:
      // pellet at threshold 1.5 spawned 10 droplets and rendered zero pixels.
      // The reference frames want both anyway — connected masses PLUS fine
      // satellite specks — so mist is the sparse-case floor and the grain.
      bloodView.setMistVisible(true);
      gooPanel?.setVisible(on);
      return true;
    },
    get goo() {
      return gooLayer
        ? {
          enabled: gooEnabled,
          threshold: gooLayer.threshold,
          edge: gooLayer.edge,
          blurPx: gooLayer.blurPx,
          sizeScale: gooLayer.sizeScale,
          target: gooLayer.targetSize,
          mode: gooLayer.mode,
          liveCount: gooLayer.liveCount,
          syncCalls: gooLayer.syncCalls,
          absorb: gooLayer.absorb,
          spec: gooLayer.spec,
          gloss: gooLayer.gloss,
          rim: gooLayer.rim,
          stretch: gooLayer.stretch,
          shadowRed: gooLayer.shadowRed,
        }
        : { enabled: false, unavailable: true };
    },
    /** Live tuning for the look pass — threshold/edge/blur are the three
     *  knobs that decide beads-vs-ropes-vs-sheets. */
    /**
     * DIAGNOSTIC: read the density field back off the GPU and report what is
     * actually in it.
     *
     * This exists because "the goo is invisible" has two completely different
     * causes that look identical on screen: an EMPTY field (nothing upstream
     * ever wrote density) versus a FULL field the surface pass is failing to
     * draw. Guessing between them cost several rounds; measuring takes one
     * call. Compare `max` against `threshold`: max below it means no pixel can
     * ever qualify and the fault is upstream in sync/density; max above it
     * with nothing on screen means the fault is the surface or the composite.
     */
    async gooProbe() {
      if (!gooLayer) return { unavailable: true };
      // Half-float decode: WebGPU hands back raw 16-bit patterns, and the
      // density targets are HalfFloatType because additive blending is only
      // guaranteed on 16-bit float in WebGPU core.
      const h2f = (h: number): number => {
        const sign = (h & 0x8000) ? -1 : 1;
        const exp = (h & 0x7c00) >> 10;
        const frac = h & 0x03ff;
        if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
        if (exp === 0x1f) return frac ? NaN : sign * Infinity;
        return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
      };
      const readOne = async (t: THREE.RenderTarget) => {
        const w = t.width;
        const h = t.height;
        const raw = new Uint16Array(
          await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h) as ArrayLike<number>,
        );
        // WebGPU pads each readback row to a 256-byte boundary; at 8 bytes per
        // RGBA16F texel that is not the same as w * 4 shorts, and ignoring it
        // reads garbage from the padding as if it were density.
        const shortsPerRow = Math.ceil((w * 8) / 256) * 256 / 2;
        let max = 0;
        let nonZero = 0;
        let sum = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const r = h2f(raw[y * shortsPerRow + x * 4] ?? 0);
            if (!Number.isFinite(r)) continue;
            if (r > 0) nonZero++;
            if (r > max) max = r;
            sum += r;
          }
        }
        return { w, h, max, nonZero, mean: sum / (w * h) };
      };
      const { density, blurred } = gooLayer.debugTargets;
      return {
        enabled: gooEnabled,
        mode: gooLayer.mode,
        threshold: gooLayer.threshold,
        blurPx: gooLayer.blurPx,
        liveCount: gooLayer.liveCount,
        syncCalls: gooLayer.syncCalls,
        density: await readOne(density),
        blurredBuf: await readOne(blurred),
      };
    },
    /** Show/hide the live tuning panel independently of the layer. */
    gooPanel(on: boolean) {
      gooPanel?.setVisible(on);
      return gooPanel?.visible ?? false;
    },
    /** Show/hide the WOUND tuning panel (ships hidden; see woundPanel's
     *  declaration). Same shape as gooPanel so capture scripts can guard it
     *  the same typeof way. */
    woundPanel(on: boolean) {
      woundPanel?.setVisible(on);
      return woundPanel?.visible ?? false;
    },

    /** Wound pass r2's tuning surface (wound-panel.ts). The key names are
     *  the panel's WOUND_KEYS — the table the COPY button emits from — so a
     *  pasted COPY always round-trips. Partial: only the keys present are
     *  applied (the panel's per-slider set() sends exactly one). The ramp
     *  trio and the viscera pair are live uniform writes; gutSize and
     *  spillChance govern ropes/rolls from now on; boneRatio rebuilds the
     *  cast and drops on-body wounds (documented in rebuildCast and the
     *  slider's tooltip).
     *  Returns the applied record PLUS the live surfCfg3 uniform from body
     *  1, so a caller can confirm the record actually reached the field —
     *  the verify-the-panel-drives-the-shader check, one call, no guessing. */
    setWoundTuning(o: Partial<WoundTuningValues>) {
      applyWoundTuning(o);
      return woundTuningNow();
    },
    get woundTuning() {
      return woundTuningNow();
    },
    setGooTuning(o: {
      threshold?: number; edge?: number; blurPx?: number; sizeScale?: number;
      mode?: 'overlay' | 'depth';
      absorb?: number; spec?: number; gloss?: number; rim?: number;
      stretch?: number;
      shadowRed?: number;
    }) {
      if (!gooLayer) return;
      if (o.threshold !== undefined) gooLayer.setThreshold(o.threshold);
      if (o.edge !== undefined) gooLayer.setEdge(o.edge);
      if (o.blurPx !== undefined) gooLayer.setBlurPx(o.blurPx);
      if (o.sizeScale !== undefined) gooLayer.setSizeScale(o.sizeScale);
      if (o.mode !== undefined) gooLayer.setMode(o.mode);
      if (o.absorb !== undefined) gooLayer.setAbsorb(o.absorb);
      if (o.spec !== undefined) gooLayer.setSpec(o.spec);
      if (o.gloss !== undefined) gooLayer.setGloss(o.gloss);
      if (o.rim !== undefined) gooLayer.setRim(o.rim);
      if (o.stretch !== undefined) gooLayer.setStretch(o.stretch);
      if (o.shadowRed !== undefined) gooLayer.setShadowRed(o.shadowRed);
    },

    /** Sweep gout density/shape without a rebuild. Mutates the shared table,
     *  so it affects every later impact of that kind. */
    setGoutTuning(kind: 'pellet' | 'slug' | 'stump', o: Partial<ImpactGoutProfile>) {
      Object.assign(IMPACT_GOUT[kind], o);
      return { ...IMPACT_GOUT[kind] };
    },
    get gout() {
      return { pellet: { ...IMPACT_GOUT.pellet }, slug: { ...IMPACT_GOUT.slug }, stump: { ...IMPACT_GOUT.stump } };
    },

    /** The outer-hull shell march (shell-hull-outer.ts). Ships ON —
     *  owner-passed 2026-08-31 after the stale-hull mask fix; -40%/-54%
     *  frame time at real-render parity. This is the kill switch. */
    setShell(on: boolean) {
      sdfLayer.setShellEnabled(on);
      if (on) outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
    },
    get shell() {
      return {
        enabled: sdfLayer.shellEnabled,
        instances: outerHull.instanceCount,
        // An overflowed hull leaves flesh uncovered, which under a bounded
        // march is a HOLE, not a slightly worse bound. Never ignore this.
        overflowed: outerHull.overflowed,
        shellAmp: shellAmpOf(),
      };
    },

    /**
     * PER-PIXEL CROSS-TAB of shell OFF vs ON — the diagnostic that competing
     * aggregates could not settle (2026-08-31: one run said the shell added
     * +10k hits, another said zero; both were sums).
     *
     * Renders the occupancy buffer twice on the SAME frozen frame (shell off,
     * then on) and classifies every pixel by (hitOff, hitOn). For pixels that
     * hit ONLY with the shell on, reports what the OFF march did instead:
     * how many steps it burned and whether it hit the 96-step budget — which
     * separates "budget exhausted at grazing incidence" from "terminated on
     * distance and the extra hits are something else".
     */
    async shellDiag() {
      const readGrid = async () => {
        const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
        for (const a of actors) a.view.uniforms.debugCfg.value.x = 4;
        try {
          handle.setLoopRunning(false);
          handle.step(1 / 60);
          await handle.resolveGpu();
          const t = sdfLayer.marchTarget;
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          return { w, h, buf, floatsPerRow };
        } finally {
          for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        }
      };
      const wasOn = sdfLayer.shellEnabled;
      try {
        sdfLayer.setShellEnabled(false);
        const off = await readGrid();
        sdfLayer.setShellEnabled(true);
        outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
        const on = await readGrid();
        const stepsHist = new Array(13).fill(0); // OFF steps/8 for ON-only hits
        const onStepsHist = new Array(13).fill(0); // ON steps at ON-only hits
        let onOnly = 0;
        let offOnly = 0;
        let both = 0;
        let onOnlyOffBudget = 0; // OFF burned >= 90 steps at those pixels
        let onOnlyOffMarched = 0; // OFF actually marched there (vs no fragment)
        let onOnlyFirstSample = 0; // ON hit within 2 steps of shellIn = started in/on flesh
        let tSum = 0;
        // For pixels BOTH hit: does the shell move the hit? Identical means the
        // entry bound is sound for hit rays; a shifted t means shellIn lands
        // past the true surface.
        let bothTOff = 0;
        let bothTOn = 0;
        let bothTMoved = 0; // |tOn - tOff| > 5 mm
        for (let row = 0; row < off.h; row++) {
          const ob = row * off.floatsPerRow;
          const nb = row * on.floatsPerRow;
          for (let col = 0; col < off.w; col++) {
            const o = ob + col * 4;
            const n = nb + col * 4;
            const hitOff = off.buf[o + 2]! > 0.5 && off.buf[o + 1]! > 0.5;
            const hitOn = on.buf[n + 2]! > 0.5 && on.buf[n + 1]! > 0.5;
            if (hitOff && hitOn) {
              both++;
              bothTOff += off.buf[o + 3]!;
              bothTOn += on.buf[n + 3]!;
              if (Math.abs(on.buf[n + 3]! - off.buf[o + 3]!) > 0.005) bothTMoved++;
            }
            else if (hitOff) offOnly++;
            else if (hitOn) {
              onOnly++;
              tSum += on.buf[n + 3]!;
              const onSt = on.buf[n]!;
              onStepsHist[Math.min(12, Math.floor(onSt / 8))]!++;
              if (onSt <= 2) onOnlyFirstSample++;
              if (off.buf[o + 2]! > 0.5) {
                onOnlyOffMarched++;
                const st = off.buf[o]!;
                if (st >= 90) onOnlyOffBudget++;
                stepsHist[Math.min(12, Math.floor(st / 8))]!++;
              }
            }
          }
        }
        return {
          both, offOnly, onOnly,
          onOnlyOffMarched, onOnlyOffBudget,
          onOnlyFirstSample,
          onOnlyMeanT: onOnly ? tSum / onOnly : 0,
          bothMeanTOff: both ? bothTOff / both : 0,
          bothMeanTOn: both ? bothTOn / both : 0,
          bothTMoved,
          // Histograms bucketed by 8 steps.
          offStepsAtOnOnly: stepsHist,
          onStepsAtOnOnly: onStepsHist,
        };
      } finally {
        sdfLayer.setShellEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /**
     * SCREEN COVERAGE of the outer hull, against the proxy boxes it would
     * replace.
     *
     * The decisive number for the shell march, and it can be taken WITHOUT
     * touching the march: occupancy() already reports what fraction of the
     * target the proxy boxes rasterise (75-100%). This reports what fraction
     * the hull covers. The gap between them is the work a bounded march
     * deletes.
     */
    async hullCoverage() {
      const wasOn = sdfLayer.shellEnabled;
      sdfLayer.setShellEnabled(true);
      outerHull.update(actors.map(a => a.posed()), { shellAmp: shellAmpOf() });
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const read = async (t: THREE.RenderTarget) => {
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          // Row padding again — bytesPerRow is aligned to 256. RedFormat, so
          // one float per pixel rather than four.
          const floatsPerRow = Math.ceil((w * 4) / 256) * 256 / 4;
          let covered = 0;
          for (let row = 0; row < h; row++) {
            const base = row * floatsPerRow;
            for (let col = 0; col < w; col++) if (buf[base + col]! > 0) covered++;
          }
          return { w, h, covered, frac: covered / (w * h) };
        };
        const entry = await read(sdfLayer.shellEntryTarget);
        const exit = await read(sdfLayer.shellExitTarget);
        return {
          entry, exit,
          instances: outerHull.instanceCount,
          overflowed: outerHull.overflowed,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        sdfLayer.setShellEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },

    /**
     * March step budget across every body (marchCfg.x, ships at 96).
     *
     * This is a MEASUREMENT seam, and the measurement it exists for is the
     * shell-march decision. Cost decomposes as roughly
     *   cost(budget) ~= hitPixels * (steps to converge) + missPixels * budget
     * because a ray that lands on flesh converges in ~8 steps while a ray that
     * misses runs on toward the budget. Sweeping the budget and fitting the
     * line therefore splits the frame into what HITS cost (the intercept) and
     * what MISSES cost (the slope) — and the misses are exactly the work a
     * bounded entry/exit shell would delete.
     *
     * Lowering this degrades the image (rays give up before converging), so
     * it is for benching only; nothing should ship on a reduced budget without
     * its own visual gate.
     */
    /** Over-relaxation (woundCfg2.y). Ships at GAME_RELAX; <= 1.0 falls back
     *  to marchCfg.y, which is the UNDER-relaxed 0.6 the page used to run. */
    setRelax(v: number) {
      for (const a of actors) a.view.uniforms.woundCfg2.value.y = v;
    },
    get relax() { return actors[0]?.view.uniforms.woundCfg2.value.y ?? 0; },
    setMarchSteps(n: number) {
      for (const a of actors) a.view.uniforms.marchCfg.value.x = n;
    },
    get marchSteps() { return actors[0]?.view.uniforms.marchCfg.value.x ?? 0; },

    /**
     * PROXY-BOX OCCUPANCY — the shell-march decision measurement.
     *
     * How much of the screen area the march actually rasterises is flesh?
     * A bounded entry/exit hull never rasterises the rest, so `1 - occupancy`
     * is the shell march's addressable market. This exists because the step
     * budget sweep showed the spike's "14x fewer evals" counted the CHEAP
     * evals: cost is per-PIXEL, not per-step, so what matters is how many
     * pixels are marched for nothing.
     *
     * Method: march debug mode 4 returns raw counters BEFORE the miss-discard
     * (r = steps, g = hit, b = rasterised, a = t), one frame is rendered, and
     * the float target is read back and summed.
     *
     * Reported occupancy is a LOWER BOUND on the waste: depth-testing means
     * only the front-most body writes each pixel, so overlapping proxy boxes
     * hide extra fragment invocations this cannot see.
     */
    async occupancy() {
      const prevMode = actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of actors) a.view.uniforms.debugCfg.value.x = 4;
      try {
        handle.setLoopRunning(false);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const t = sdfLayer.marchTarget;
        const w = t.width;
        const h = t.height;
        const buf = new Float32Array(
          await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
        );
        // ROW PADDING, and it is not optional: WebGPU aligns bytesPerRow to
        // 256, so the readback is NOT densely packed. Walking it as w*h*4
        // reads progressively misaligned rows and still yields a plausible
        // percentage — the exact shape of wrong number this whole exercise
        // keeps producing. (Same arithmetic as shell-spike-main.ts.)
        const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
        let rasterised = 0;
        let hits = 0;
        let stepsOnHit = 0;
        let stepsOnMiss = 0;
        for (let row = 0; row < h; row++) {
          const base = row * floatsPerRow;
          for (let col = 0; col < w; col++) {
            const o = base + col * 4;
            if (buf[o + 2]! < 0.5) continue;
            rasterised++;
            if (buf[o + 1]! > 0.5) { hits++; stepsOnHit += buf[o]!; }
            else { stepsOnMiss += buf[o]!; }
          }
        }
        const misses = rasterised - hits;
        return {
          targetW: w, targetH: h, screenPx: w * h,
          rasterised, hits, misses,
          /** Fraction of MARCHED pixels that actually hit flesh. */
          occupancy: rasterised ? hits / rasterised : 0,
          /** Fraction of the SDF target the march touched at all. */
          coverage: rasterised / (w * h),
          meanStepsHit: hits ? stepsOnHit / hits : 0,
          meanStepsMiss: misses ? stepsOnMiss / misses : 0,
          /** Share of all marched STEPS spent on rays that hit nothing. */
          missStepShare: (stepsOnHit + stepsOnMiss) > 0
            ? stepsOnMiss / (stepsOnHit + stepsOnMiss) : 0,
          bodiesOnScreen: bodiesOnScreen(),
        };
      } finally {
        for (const a of actors) a.view.uniforms.debugCfg.value.x = prevMode;
        handle.setLoopRunning(true);
      }
    },

    /**
     * Run one bench leg.
     *
     * Parks the result on window.__gameBench as well as returning it: a
     * console call that returns a value can itself hide the page, and a
     * hidden page has no swapchain texture, so its passes do nothing and the
     * fence resolves to ~0.065 ms of nothing. That reads as a 70x speedup.
     * The harness counts hidden frames and invalidates the run, but reading
     * the value back afterwards avoids provoking it in the first place.
     */
    async bench(o: {
      room?: number; mode?: 'throughput' | 'spike';
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      chunkFrames?: number; warmup?: number; label?: string;
    } = {}) {
      const scenario = buildFirefight({
        room: o.room ?? 4,
        walkFrames: o.walkFrames,
        fireFrames: o.fireFrames,
        gibFrames: o.gibFrames,
      });
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);

      handle.setLoopRunning(false);
      const hadAdaptive = adaptiveEnabled;
      adaptiveEnabled = false;
      try {
        const deps: BenchDeps = {
          step: (dt) => handle.step(dt),
          resolveGpu: () => handle.resolveGpu(),
          now: () => performance.now(),
          hidden: () => document.hidden,
          census: () => ({
            bodies: bodiesOnScreen(),
            wounds: actors.reduce((n, a) => n + a.wounds().length, 0),
            chunks: liveChunks.length,
          }),
          perform: (a) => {
            switch (a.kind) {
              case 'teleport': {
                const r = ROOMS.find(x => x.id === a.room);
                if (r) {
                  // Stand back from where the BODIES actually are, facing
                  // them. Two heuristics were tried and both failed against
                  // the census (2026-08-31): the room centre put a zombie
                  // 0.97 m away so every shot pitched down into it and
                  // missed, and an outer corner pointed the camera at a wall
                  // with bodies 1 -> 0 on screen. The room's own actors are
                  // the only thing that reliably says where to look.
                  const mine = actors.filter(x => x.room === a.room);
                  const cx = (r.minX + r.maxX) / 2;
                  const cz = (r.minZ + r.maxZ) / 2;
                  let tx = cx;
                  let tz = cz;
                  if (mine.length) {
                    tx = mine.reduce((n, x) => n + x.pose().pos[0], 0) / mine.length;
                    tz = mine.reduce((n, x) => n + x.pose().pos[2], 0) / mine.length;
                  }
                  // Back off along the direction from the room centre toward
                  // the outer wall, so the whole group stays in front.
                  const away = Math.hypot(tx - cx, tz - cz);
                  let ax = away > 0.2 ? (cx - tx) / away : 0;
                  let az = away > 0.2 ? (cz - tz) / away : 1;
                  // Degenerate group (all at the centre): back off along -z.
                  if (!Number.isFinite(ax) || (ax === 0 && az === 0)) { ax = 0; az = 1; }
                  const STANDOFF = 4.0;
                  const inset = 0.6;
                  const px = Math.min(r.maxX - inset, Math.max(r.minX + inset, tx + ax * STANDOFF));
                  const pz = Math.min(r.maxZ - inset, Math.max(r.minZ + inset, tz + az * STANDOFF));
                  player.pos = [px, 0, pz];
                  player.vel = [0, 0, 0];
                  // atan2(dx, −dz): the page's forward is (sin yaw, −cos
                  // yaw) — see aimAtNearestSurface. Was atan2(dx, +dz)
                  // (z-mirrored) since cdba91f.
                  player.yaw = Math.atan2(tx - px, -(tz - pz));
                  player.pitch = 0;
                  player.grounded = true;
                }
                break;
              }
              case 'freeze': wanderFrozen = a.on; break;
              case 'look': player.yaw = a.yaw; player.pitch = a.pitch; break;
              case 'aimSurface': aimAtNearestSurface(); break;
              case 'fire': fire(a.barrels); break;
              case 'fireSlug': {
                const keep = slugMode;
                slugMode = true;
                try { fire(1); } finally { slugMode = keep; }
                break;
              }
            }
          },
        };
        const result = await runBench(deps, scenario, {
          mode: o.mode ?? 'throughput',
          chunkFrames: o.chunkFrames,
          warmup: o.warmup,
          label: o.label,
        });
        (window as unknown as { __gameBench: unknown }).__gameBench = result;
        return result;
      } finally {
        adaptiveEnabled = hadAdaptive;
        adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
        handle.setLoopRunning(true);
      }
    },
    /**
     * INSIDE-NESS OF THE LIVE, POSED OCCLUDER HULL.
     *
     * occluder-hull.test.ts already asserts every emitted sphere sits inside
     * the flesh — but only for bodies straight out of buildBody, i.e. in the
     * REST pose. This runs the same assertion against the bodies the game is
     * actually rendering, through the same sdBody the raycaster trusts, and
     * reports which primitive authored each sphere that fails.
     */
    hullInsideness(tol = 1e-4) {
      const bad: Array<Record<string, unknown>> = [];
      let total = 0;
      let worst = 0;
      for (let bi = 0; bi < actors.length; bi++) {
        const body = actors[bi]!.posed();
        const spheres = buildHullInstances([body], HULL_SHRINK);
        for (const sph of spheres) {
          total++;
          // Inside means the centre is at least `radius` deep in the flesh.
          const d = sdBody(sph.centre, body);
          const proud = d + sph.radius;
          if (proud > worst) worst = proud;
          if (proud > tol) {
            bad.push({
              actor: actors[bi]!.id, centre: sph.centre.map(v => +v.toFixed(3)),
              radius: +sph.radius.toFixed(4), sdBody: +d.toFixed(4),
              proudMm: +(proud * 1000).toFixed(1),
            });
          }
        }
      }
      return {
        spheres: total, outside: bad.length,
        worstProudMm: +(worst * 1000).toFixed(1),
        sample: bad.slice(0, 12),
      };
    },
    /**
     * Rasterise ONE sphere of known centre and radius and read back what the
     * pre-pass wrote for it, next to the analytic ray-sphere entry for the
     * same pixel. With a single instance there is no ambiguity about which
     * sphere a fragment came from.
     */
    async syntheticSphereCheck(dist = 5, radius = 0.2) {
      const wasOn = sdfLayer.occluderEnabled;
      try {
        handle.setLoopRunning(false);
        // Straight ahead of the camera, `dist` metres away.
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        const c = camera.position.clone().addScaledVector(fwd, dist);
        occluderHull.setSpheres([{ centre: [c.x, c.y, c.z], radius }]);
        sdfLayer.setOccluderEnabled(true);
        handle.step(1 / 60);
        await handle.resolveGpu();
        const ot = sdfLayer.occluderTarget;
        const buf = new Float32Array(
          await handle.renderer.readRenderTargetPixelsAsync(ot, 0, 0, ot.width, ot.height),
        );
        const fpr = Math.ceil((ot.width * 16) / 256) * 256 / 4;
        // The pixel the sphere centre projects to.
        const ndc = c.clone().project(camera);
        const col = Math.round(((ndc.x + 1) / 2) * ot.width - 0.5);
        const rowTop = Math.round(((1 - ndc.y) / 2) * ot.height - 0.5);
        const read = (r: number, cc: number) => buf[r * fpr + cc * 4]!;
        let covered = 0, minV = Infinity, maxV = -Infinity;
        for (let r = 0; r < ot.height; r++) {
          for (let cc = 0; cc < ot.width; cc++) {
            const v = read(r, cc);
            if (v <= 0) continue;
            covered++;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
          }
        }
        return {
          sphereCentreDistFromCam: +camera.position.distanceTo(c).toFixed(4),
          radius,
          /** What it SHOULD read at the centre pixel: centre distance - radius. */
          analyticCentrePixel: +(camera.position.distanceTo(c) - radius).toFixed(4),
          atCentrePixelTopDown: +read(rowTop, col).toFixed(4),
          atCentrePixelBottomUp: +read(ot.height - 1 - rowTop, col).toFixed(4),
          coveredPx: covered,
          minWritten: minV === Infinity ? null : +minV.toFixed(4),
          maxWritten: maxV === -Infinity ? null : +maxV.toFixed(4),
          col, rowTop,
        };
      } finally {
        sdfLayer.setOccluderEnabled(wasOn);
        handle.setLoopRunning(true);
      }
    },
    /** Rebuild the hull NOW (the frame-loop update is gated on !wanderFrozen,
     *  so frozen captures would otherwise shoot through a stale hull). No
     *  simulation steps, so a stamped body stays exactly where it was put. */
    refreshHull: () => {
      occluderHull.update(
        actors.map(a => a.posed()),
        hullExclusionsEnabled
          ? actors.flatMap(a => {
            const prims = a.posed().prims;
            return a.wounds().map(w => ({ centre: woundWorldPos(prims, w, 0), radius: w.radius }));
          })
          : [],
      );
    },
    /** A/B seam: rebuild the SHADOW hull with spanning off (the pre-fix
     *  bead-chain) or on. Pair it with refreshHull() — and use it INSTEAD of
     *  a two-build cross-load A/B, which the wander makes untrustworthy. */
    setShadowSpan: (on: boolean, inflate?: number) => occluderHull.setShadowSpan(on, inflate),
    hullDebug: () => ({
      occluder: sdfLayer.occluderEnabled,
      exclusions: hullExclusionsEnabled,
      instances: occluderHull.instanceCount,
      woundsPerBody: actors.map(a => a.wounds().length),
    }),
    /** A visible sphere in WORLD space, drawn through the normal geometry
     *  pass — so captures can mark predicted impacts vs actual craters.
     *  One marker at a time; pass null coords to remove. */
    placeMarker(x: number | null, y = 0, z = 0, colorHex = 0xff00ff) {
      if (!marker) {
        const geo = new THREE.SphereGeometry(0.03, 12, 8);
        marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex }));
        marker.frustumCulled = false;
        scene.add(marker);
      }
      (marker.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
      if (x === null) { marker.visible = false; return; }
      marker.visible = true;
      marker.position.set(x, y, z);
    },
    projectiles: () => pellets.map(p => ({
      pos: [...p.pos] as Vec3,
      vel: [...p.vel] as Vec3,
      ageSec: p.ageSec,
    })),
    get chunkCount() { return liveChunks.length; },
    /** SDF-pass scale relative to the capped buffer (1.0 = 1:1). */
    setSdfScale: (v: number) => applySdfScale(v),
    get sdfScale() { return sdfScale; },
    get sdfTarget() { return sdfLayer.targetSize; },
    /** Adaptive resolution ladder — default OFF so the chosen rung ships. */
    setAdaptive(on: boolean, budgetMs?: number) {
      adaptiveEnabled = on;
      if (budgetMs !== undefined) adaptiveBudgetMs = budgetMs;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
      adaptiveFrames.length = 0;
    },
    get adaptive() {
      return {
        enabled: adaptiveEnabled,
        budgetMs: adaptiveBudgetMs,
        rung: adaptiveState.rung,
        scale: scaleForRung(adaptiveState.rung),
        ladder: [...SCALE_LADDER],
      };
    },
    /** The active render cap + how it was chosen (?res=). */
    get resolution() {
      const cap = RES_RUNGS[resKey];
      const content = postAa.contentSize;
      return {
        rung: resKey,
        cap: { ...cap },
        content: { ...content },
        letterboxed: cap.mode === 'fixed',
      };
    },
    /** Dev twin of the lab's stampWoundAt (2026-08-27): ONE wound by ray
     *  through the same worldHitToWound path the pellet uses, pushed via
     *  stampBlast — no damage, no shove, no sever. A full grapeshot volley
     *  kills and death-gibs (the weapon works), so a pocked STANDING torso
     *  only exists through this seam. */
    stampWoundAt: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
      kind: 'pellet' | 'slug' = 'pellet', bodyId?: number) => {
      const a = bodyId === undefined ? actors[0] : actors.find(q => q.id === bodyId);
      if (!a) return null;
      const posed = a.posed();
      const hit = traceProjectile(
        [ox, oy, oz],
        [ox + dx * 8, oy + dy * 8, oz + dz * 8],
        q => sdBody(q, posed),
      );
      if (!hit) return null;
      // 'slug' carries the BLAST profile at 0.16 (see SLUG) — the blast-class
      // crater look without resolveExplosion's 16-wound kill-gib.
      const field = (q: Vec3) => sdBody(q, posed);
      const w = kind === 'slug'
        ? woundFromSlug(posed.prims, hit, field)
        : woundFromPellet(posed.prims, hit, 0, field);
      a.stampBlast([w]);
      // Capture twins must spill too — task 8 judges the rope from exactly
      // this seam. Rolls bleedRng deterministically: same command sequence,
      // same rope-or-not.
      spillVerdict(a, w);
      return hit;
    },
    /** Diagnostic detonation: one blast stamped through resolveExplosion
     *  (the SAME worldHitToWound path dynamite uses) with falloff-scaled
     *  blast calibre — wounds only, no shove/sever/gib, so captures are not
     *  displaced by their own impact. Returns what it did. */
    explode: (x: number, y: number, z: number) => {
      const bodies: ExplosionBody[] = actors.map(a => ({ id: String(a.id), body: a.posed() }));
      const fx = resolveExplosion([x, y, z], bodies);
      let totalWounds = 0;
      for (const pb of fx.perBody) {
        if (pb.wounds.length === 0) continue;
        const a = actors.find(q => String(q.id) === pb.bodyId);
        if (!a) continue;
        a.stampBlast(pb.wounds);
        // One decision PER stamped wound: the first cavity wound spawns,
        // the rest tear — a blast blows the gut out rather than growing
        // multiple ropes (shouldSpill's one-rope-per-body rule).
        for (const w of pb.wounds) spillVerdict(a, w);
        totalWounds += pb.wounds.length;
      }
      return { radiusM: fx.radiusM, bodiesHit: fx.perBody.length, totalWounds };
    },
    uptime: () => (performance.now() - bootTime) / 1000,
    get frames() { return frameCount; },
    /** Where a view-model hangs (child of the camera). */
    viewModelAnchor,
    rooms: ROOMS.map(r => ({
      id: r.id, name: r.name, zombies: r.zombies,
      bounds: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ },
    })),
    tunnels: TUNNELS.map(t => t.name),
    furniture: FURNITURE,
    /** Accent lights per room — capture/measurement seam (pair-shot framing). */
    accents: ROOMS.flatMap(r => r.accents.map(a => ({ room: r.id, ...a }))),
  };
}

main().catch((err) => {
  const el = document.getElementById('errors');
  const msg = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  if (el) el.textContent = msg;
  console.error('[sdf-game] bootstrap failed', err);
});
