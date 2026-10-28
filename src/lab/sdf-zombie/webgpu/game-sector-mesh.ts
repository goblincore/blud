// src/lab/sdf-zombie/webgpu/game-sector-mesh.ts
//
// SECTOR LEVEL MESHES (spec 2026-10-24-doom-sector-levels-design.md §6.4): floors, ceilings and
// walls from sector-geometry.ts, merged into one mesh per zone and role, room-tagged like level art
// so the per-room light lists light them, and wearing the stone set's materials with WORLD-space
// UVs (one texture tile per SurfaceLook.tileM metres) so the pattern runs on across every wall and floor.
// Sky ceilings are not drawn. Wall quads already run with their sector on the left, so the left
// normal (-dz, 0, dx) faces into the sector the wall is seen from.
//
// SECTOR LIGHT AND GLOW (spec 2026-10-24 §7–§8): every vertex carries its `sectorIndex`, and every
// mesh owns a MeshStandardNodeMaterial whose emissive is albedo × levels[sectorIndex] (the level
// array is game-sector-light.ts's). A glowing sector's floor (nukage, lava, acid) leaves the stone
// batches for an unlit WGSL surface (sector-glow.wgsl.ts) on meshes added to the scene, outside the
// level group, so the per-room light lists and the deferred router never touch it.
//
// GLOW BOUNCE (hand-off item 2b): every stone vertex also carries a baked `glowBounce` RGB
// (sector-bounce.ts: the pools' colour by distance, facing and line-of-sight), added to the
// emissive as albedo × glowBounce × bounceGain × glowGain. The mesh is built from a copy of the map
// whose lines near pools are split (refineNearGlow), and walls are cut in height on a world grid
// (wallRows), so the bounce has vertices to vary across.
//
// MATERIALS (2026-10-25): each surface wears its converter family (sector-materials.ts → the
// procedural panel-textures.ts kinds; a wall quad its own line side's family when the file has one),
// batched by (zone, role, kind), UVs at the kind's own tile size. Unknown families and `?sectormat=0`
// keep the old stone set, so the batches are then exactly the old (zone, role) ones. A light panel
// adds its glow map to the emissive.
//
// EMITTERS (hand-off item 2g, part A): screen banks, the viewscreen, fluorescents and exit signs add an
// ANIMATED glow (emitter-glow.wgsl.ts on the sim clock, masked by the kind's glow map) × the kind's gain
// seam × max(level / full, k): it follows its sector's light partly and stays lit in the dark. Their
// walls fit whole cells (sector-materials.ts wallFit), fluorescent ceilings whole troffers over their
// polygon's box (flatFit). `?emitters=0` draws the old kinds.
//
// EMITTER BOUNCE (item 2g, part B1): every vertex also carries the emitters' baked bounce
// (sector-emitters.ts) in two attributes split by gain class, `emitScreen` (RGB) and `emitFS`
// (fluorescent, sign scalars of FLUORO_RGB and SIGN_RGB), added to the emissive as albedo ×
// emitBounceGain × (emitScreen × screenGain + FLUORO_RGB × fluoro × fluoroGain + SIGN_RGB × sign × signGain).
// Lines and walls near emitters are refined like those near pools.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, exp, float, fwidth, materialColor, max, min, positionWorld, texture, uniform, uniformArray, uv, vec3, vec4, wgslFn } from 'three/tsl';
import { blankPanel, fillPanel, generatePanel, mottleTexture, panelTextures, wrapPanel, type PanelKind, type PanelMaps, type PanelTextureSet } from '../../../game/level/panel-textures';
import { runPool, type PoolWorker } from './panel-pool';
import { emittersOn, flatFit, isStone, lineSeedTiles, polyBox, sectorMaterialsOn, surfaceKind, SURFACE_LOOKS, wallFit, wallU, type SurfaceKind, type SurfaceLook } from './sector-materials';
import { createEmitterBounce, emitterReach, emitterSurfaces, type EmitBake, type EmitterBounce } from './sector-emitters';
import { FLUORO_RGB, SIGN_RGB } from '../../../game/level/emitter-layout';
import { EM_HASH, EM_RAND, EMITTER_FN, type EmitterKind } from './emitter-glow.wgsl';
import type { GameContext } from './game-context';
import { createSectorFx, CEIL_WHISPER, type SectorFxRuntime } from './game-sector-light';
import { reducedFlashes } from './lamp-moods';
import { SKY_MATERIAL, type GlowKind, type SectorMap, type XZ } from './sector-def';
import { BOUNCE_CUTOFF_M, createGlowBounce, glowSources, nearAny, refineFaces, refineNear, wallRows, wallStrip, type GlowBounce, type Reach, type RGB } from './sector-bounce';
import { sectorPolygons, wallQuads } from './sector-geometry';
import { GLOW_KIND_INDEX, SECTOR_GLOW, SECTOR_GLOW_HASH, SECTOR_GLOW_NOISE } from './sector-glow.wgsl';

/** Flats get interior vertices (refineFaces) this close to an emitter's box, at most this far apart:
 *  where the bake changes fastest (E1M1: 4855 triangles plain, ~ +40 % with these). */
const FLAT_REFINE_REACH_M = 4;
const FLAT_REFINE_M = 2.5;
/** Glow floors sit this far above the sector floor, so they never z-fight a neighbour's riser edge. */
const GLOW_LIFT_M = 0.002;
type Role = 'floor' | 'ceil' | 'wall';

const bounceScratch: RGB = [0, 0, 0];
const emitScratch: EmitBake = [0, 0, 0, 0, 0];
const NO_BAKE: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0];
/** Baked bounces by position and normal: the mesh is unindexed, so a vertex recurs in every triangle round it.
 *  Eight floats: the pools' RGB, then the emitters' screen RGB, fluorescent, sign. */
type BounceCache = Map<string, readonly number[]>;
/** Bake cost, logged once per level build ([sector-bounce]). */
const bakeStats = { ms: 0, vertices: 0 };

class Batch {
  pos: number[] = []; uv: number[] = []; muv: number[] = []; nrm: number[] = []; sec: number[] = []; bnc: number[] = [];
  esc: number[] = []; efs: number[] = [];
  constructor(private readonly bounce: GlowBounce | null, private readonly cache: BounceCache = new Map(),
    private readonly emit: EmitterBounce | null = null) {}
  /** One triangle of sector `sector`; flipped if its normal disagrees with `want`. Each vertex's glow
   *  bounce is baked with its ray starting inside its own sector: off a wall along the wall's normal,
   *  off a floor or ceiling toward the triangle's centre. */
  tri(p: number[][], uv: number[][], want: [number, number, number], sector: number, wall = false, muv: number[][] = uv) {
    const [a, b, c] = p as [number[], number[], number[]];
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const order = n[0]! * want[0] + n[1]! * want[1] + n[2]! * want[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
    const cx = (a[0]! + b[0]! + c[0]!) / 3, cz = (a[2]! + b[2]! + c[2]!) / 3;
    for (const i of order) {
      const q = p[i]!;
      this.pos.push(...q); this.uv.push(...uv[i]!); this.muv.push(...muv[i]!); this.nrm.push(...want); this.sec.push(sector);
      let g = NO_BAKE;
      if (this.bounce || this.emit) {
        const key = `${q[0]},${q[1]},${q[2]},${want[0]},${want[1]},${want[2]}`;
        const hit = this.cache.get(key);
        if (hit) g = hit;
        else {
          const t0 = performance.now();
          const p3: [number, number, number] = [q[0]!, q[1]!, q[2]!];
          const into: XZ = wall ? [want[0], want[2]] : [cx - q[0]!, cz - q[2]!];
          const r = this.bounce ? this.bounce.at(p3, want, into, bounceScratch) : [0, 0, 0];
          const e = this.emit ? this.emit.at(p3, want, into, emitScratch) : emitScratch.fill(0);
          this.cache.set(key, (g = [r[0]!, r[1]!, r[2]!, e[0], e[1], e[2], e[3], e[4]]));
          bakeStats.ms += performance.now() - t0; bakeStats.vertices++;
        }
      }
      this.bnc.push(g[0]!, g[1]!, g[2]!); this.esc.push(g[3]!, g[4]!, g[5]!); this.efs.push(g[6]!, g[7]!);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // The grime mottle's coordinates: the world-projected uv even where `uv` is laid per line (doors).
    g.setAttribute('mottleUv', new THREE.Float32BufferAttribute(this.muv, 2));
    g.setAttribute('sectorIndex', new THREE.Float32BufferAttribute(this.sec, 1));
    g.setAttribute('glowBounce', new THREE.Float32BufferAttribute(this.bnc, 3));
    g.setAttribute('emitScreen', new THREE.Float32BufferAttribute(this.esc, 3));
    g.setAttribute('emitFS', new THREE.Float32BufferAttribute(this.efs, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** A clone of a stone material whose textures repeat once per UV unit (the UVs are world/tileM). */
function worldTiled(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  for (const k of ['map', 'normalMap', 'roughnessMap'] as const) {
    const t = m[k];
    if (!t) continue;
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(1, 1);
    c.needsUpdate = true;
    m[k] = c;
  }
  return m;
}

/** The panel kinds' textures, built once per page. Their pixels (~2 s of CPU for all eight) are
 *  generated in workers (panel-textures.worker.ts) so the level boots without waiting: each set is
 *  made blank at once and filled when its worker answers. Without Worker (tests, old browsers) it is
 *  built in place. `[sector-mat]` logs the cost once per level build. Each kind is 2.25 MB before
 *  mips (albedo + normal RGBA, roughness one channel). */
const panelCache = new Map<PanelKind, PanelTextureSet>();
const PANEL_SEEDS: Record<PanelKind, number> = {
  techPanel: 101, metalSheet: 103, door: 107, rustBrick: 109, lightPanel: 113, concreteSlab: 127, metalPlate: 131, floorTile: 137,
  screenBank: 139, viewscreen: 149, fluorescent: 151, exitSign: 157,
};
interface PanelJob { kind: PanelKind; set: PanelTextureSet }
let pendingJobs: PanelJob[] = [];
let syncMs = 0;
function panelSet(kind: PanelKind): PanelTextureSet {
  let t = panelCache.get(kind);
  if (t) return t;
  if (typeof Worker === 'undefined') {
    const t0 = performance.now();
    t = panelTextures(kind, PANEL_SEEDS[kind]);
    syncMs += performance.now() - t0;
  } else {
    t = wrapPanel(blankPanel(kind), kind);
    pendingJobs.push({ kind, set: t });
  }
  panelCache.set(kind, t);
  return t;
}
/** Send this build's pending kinds to a small worker pool (panel-pool.ts: a failing or missing
 *  worker falls back to building in place); log once every kind has arrived. */
function flushPanelJobs(): void {
  if (syncMs > 0) { console.info(`[sector-mat] built panel kinds on the main thread in ${syncMs.toFixed(0)} ms`); syncMs = 0; }
  const jobs = pendingJobs;
  pendingJobs = [];
  if (jobs.length === 0) return;
  let cpu = 0;
  runPool(jobs, {
    size: Math.min(4, (navigator.hardwareConcurrency || 2) - 1),
    spawn: () => new Worker(new URL('../../../game/level/panel-textures.worker.ts', import.meta.url), { type: 'module' }) as unknown as PoolWorker,
    message: job => ({ kind: job.kind, seed: PANEL_SEEDS[job.kind] }),
    onResult: (job, data) => {
      const m = data as Omit<PanelMaps, 'height'> & { ms: number };
      fillPanel(job.set, m);
      cpu += m.ms;
    },
    inPlace: job => fillPanel(job.set, generatePanel(job.kind, PANEL_SEEDS[job.kind])),
    label: job => job.kind,
    warn: msg => console.warn(msg),
    done: st => console.info(`[sector-mat] ${jobs.length} panel kinds filled in ${st.ms.toFixed(0)} ms: ${st.offThread} off-thread (${cpu.toFixed(0)} ms worker CPU, ${st.workers} workers), ${st.inPlace} in place${st.failures ? `, ${st.failures} worker failures` : ''}`),
  });
}
/** A panel kind's shared texture set — the walls' own, built once per page (filled off-thread when it is new).
 *  Props that wear the level's materials (the barrels' metalSheet normal and roughness) share it, so it costs no
 *  texture memory of its own. */
export function sectorPanelSet(kind: PanelKind): PanelTextureSet {
  const t = panelSet(kind);
  flushPanelJobs();
  return t;
}
/** The light panels' glow strength (`?panelglow=` overrides). */
export const panelGlow = uniform(1);
/** Grime weights for the panel kinds (stone is untouched, so ?sectormat=0 stays the old look). */
const GRIME = {
  /** The large-scale mottle's UV scale: one mottle repeat per 4 / 0.231 ≈ 17 m, unrelated to the 4 m tile. */
  mottleScale: 0.231,
  /** Albedo × mix(lo, hi, mottle); roughness × mix(roughLo, roughHi, mottle). */
  lo: 0.62, hi: 1.12, roughLo: 0.8, roughHi: 1.15,
  /** Walls darken toward their sector's floor: 1 - base × exp(-(y - floor) / falloff). */
  base: 0.5, falloffM: 0.9,
  /** Panel glow follows the sector light, never quite out: × max(level, glowFloor). */
  glowFloor: 0.04,
};
let mottle: THREE.DataTexture | null = null;

interface SurfaceSource { base: THREE.MeshStandardMaterial; look: SurfaceLook; glowMap: THREE.Texture | null; roughness: THREE.Texture | null; emit: EmitterKind | null }

/** The emitter glow fns, one node per WGSL fn shared by every material (the builder emits a shared
 *  include once per shader). */
type WgslFnNode = ReturnType<typeof wgslFn>;
let emitterFns: Record<EmitterKind, WgslFnNode> | null = null;
function emitterFn(kind: EmitterKind): WgslFnNode {
  if (!emitterFns) {
    const inc = (fn: WgslFnNode) => fn as unknown as NonNullable<Parameters<typeof wgslFn>[1]>[number];
    const hash = wgslFn(EM_HASH);
    const rand = wgslFn(EM_RAND, [inc(hash)]);
    const deps = new Map<string, WgslFnNode>();
    const dep = (src: string) => { let d = deps.get(src); if (!d) deps.set(src, (d = wgslFn(src, [inc(rand)]))); return d; };
    emitterFns = Object.fromEntries((Object.keys(EMITTER_FN) as EmitterKind[]).map(k => {
      const e = EMITTER_FN[k];
      return [k, wgslFn(e.src, [inc(rand), ...e.deps.map(d => inc(dep(d)))])];
    })) as Record<EmitterKind, WgslFnNode>;
  }
  return emitterFns[kind];
}

/** One mesh's own node material (a NodeMaterial is reused as is by the light-list loop, so meshes
 *  never share one): the surface's textures and the palette colour, plus the sector term — the
 *  albedo times the sector's current level — for ceilings plan 1's whisper, and a light panel's glow. */
function sectorMaterial(src: SurfaceSource, color: readonly [number, number, number], fx: SectorFxRuntime, ceil: boolean,
  wallFloors: ReturnType<typeof uniformArray<'float'>> | null): MeshStandardNodeMaterial {
  const role = src.base;
  const nm = new MeshStandardNodeMaterial();
  nm.map = role.map; nm.normalMap = role.normalMap; nm.roughnessMap = role.roughnessMap;
  nm.roughness = role.roughness; nm.metalness = role.metalness; nm.normalScale.copy(role.normalScale);
  nm.color = new THREE.Color(...color).multiplyScalar(src.look.gain);
  // The deferred router copies `emissive` and drops emissiveNode: ceilings keep plan 1's whisper
  // there. Forward is unchanged (NodeMaterial uses emissiveNode INSTEAD of `emissive` when set).
  if (ceil) nm.emissive = new THREE.Color(...color).multiplyScalar(CEIL_WHISPER);
  // The sector's self-lit level (sector-light.ts via game-sector-light.ts), times the albedo.
  // +0.5 before the cast: the interpolated index may arrive as 2.9999998, which truncates to 2.
  const lvl = fx.levels.element(attribute('sectorIndex', 'float').add(0.5).toInt());
  const base = ceil ? vec3(...color).mul(fx.ceilWhisper) : vec3(0);
  // The pools' baked bounce (sector-bounce.ts), scaled with the pools' own brightness (glowGain).
  const bounce = attribute('glowBounce', 'vec3').mul(fx.bounceGain.mul(fx.glowGain));
  // The emitters' baked bounce (sector-emitters.ts) under their own gain seams and emitBounceGain.
  const fs = attribute('emitFS', 'vec2');
  const emitBounce = attribute('emitScreen', 'vec3').mul(fx.emitGains.screenGain)
    .add(vec3(...FLUORO_RGB).mul(fs.x.mul(fx.emitGains.fluoroGain)))
    .add(vec3(...SIGN_RGB).mul(fs.y.mul(fx.emitGains.signGain)))
    .mul(fx.emitBounceGain);
  let albedo = materialColor.rgb;
  if (src.roughness) {
    // GRIME (panel kinds only): a large mottle breaks the 4 m repeat in albedo and roughness, and walls
    // darken toward their sector's floor (the per-sector floor height, read like the level).
    mottle ??= mottleTexture(977);
    const m = texture(mottle, attribute('mottleUv', 'vec2').mul(GRIME.mottleScale)).r;
    let k = m.mul(GRIME.hi - GRIME.lo).add(GRIME.lo);
    if (wallFloors) {
      const floorY = wallFloors.element(attribute('sectorIndex', 'float').add(0.5).toInt());
      k = k.mul(float(1).sub(exp(positionWorld.y.sub(floorY).max(0).div(-GRIME.falloffM)).mul(GRIME.base)));
    }
    albedo = albedo.mul(k);
    nm.colorNode = vec4(albedo, 1);
    nm.roughnessNode = texture(src.roughness).r.mul(src.look.roughness).mul(m.mul(GRIME.roughHi - GRIME.roughLo).add(GRIME.roughLo)).clamp(0.04, 1);
  }
  const lit = albedo.mul(vec3(lvl).add(bounce).add(emitBounce)).add(base);
  if (src.emit && src.glowMap && src.look.emit) {
    // An emitter: the animated glow (sim clock, per-sector seed, calm under ?flashes=reduced), its gain
    // seam, and max(level / full, k) so it stays lit in a dark sector and dims with a flickering one.
    const sec = attribute('sectorIndex', 'float');
    const fw = fwidth(uv().mul(512));
    const glow = emitterFn(src.emit)({
      uv: uv(), mask: texture(src.glowMap), t: fx.glowTime, sec, calm: float(fx.reducedFlashes ? 1 : 0), fw: max(fw.x, fw.y),
    }) as unknown as ReturnType<typeof vec3>;
    const factor = max(min(lvl.div(max(fx.fullLevel, 1e-4)), 1), src.look.emit.floor);
    nm.emissiveNode = lit.add(glow.mul(fx.emitGains[src.look.emit.gain]).mul(factor));
    return nm;
  }
  // A light panel's glow follows its sector's light (dark, flicker and strobe sectors dim their panels).
  nm.emissiveNode = src.glowMap
    ? lit.add(texture(src.glowMap).rgb.mul(panelGlow.mul(src.look.glow)).mul(max(lvl, GRIME.glowFloor)))
    : lit;
  return nm;
}

/** Add the sector level's meshes: stone to the level group, glow floors to the scene. Creates the
 *  sector light runtime on ctx.world.sectorFx. Returns how many level-group meshes were added. */
export function addSectorMeshes(ctx: GameContext, map: SectorMap): number {
  const search = new URLSearchParams(location.search);
  const fx = createSectorFx(map.sectors.length, search, reducedFlashes(search));
  ctx.world.sectorFx = fx;
  // The bounce rays test the real lines; the mesh uses the refined copy (same sectors, more vertices).
  const sources = glowSources(map);
  const bounce = sources.length > 0 ? createGlowBounce(map, sources) : null;
  const matsOn = sectorMaterialsOn(search);
  const emitOn = emittersOn(search);
  // The emitters as light sources (none with ?emitters=0 or ?sectormat=0: the old kinds do not glow).
  const tEmit = performance.now();
  const emitSurfs = emitterSurfaces(map, emitOn && matsOn);
  const emitBounce = emitSurfs.length > 0 ? createEmitterBounce(emitSurfs) : null;
  const emitSurfMs = performance.now() - tEmit;
  const emitReach = emitterReach(emitSurfs);
  const flatReach = emitReach.map(r => ({ ...r, reach: FLAT_REFINE_REACH_M }));
  const reach: Reach[] = [...sources.map(s => ({ min: s.min, max: s.max, reach: BOUNCE_CUTOFF_M })), ...emitReach];
  const meshMap = refineNear(map, reach);
  const cache: BounceCache = new Map();
  bakeStats.ms = 0; bakeStats.vertices = 0;
  const batches = new Map<string, Batch>();
  const batch = (zone: number, role: Role, kind: SurfaceKind) => {
    const key = `${zone}:${role}:${kind}`;
    let b = batches.get(key);
    if (!b) batches.set(key, (b = new Batch(bounce, cache, emitBounce)));
    return b;
  };
  const glowBatches = new Map<GlowKind, Batch>();
  const glowBatch = (kind: GlowKind) => {
    let b = glowBatches.get(kind);
    if (!b) glowBatches.set(kind, (b = new Batch(null)));
    return b;
  };

  for (const poly of sectorPolygons(meshMap)) {
    const s = map.sectors[poly.sector]!;
    const contour = poly.outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = poly.holes.map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
    // Near an emitter the flat's triangles get interior vertices (refineFaces), so the floor in front of
    // a screen wall can catch its bake (a vertex at the wall's foot lies in its plane and catches none).
    const flat = refineFaces([...poly.outer, ...poly.holes.flat()], THREE.ShapeUtils.triangulateShape(contour, holes),
      FLAT_REFINE_M, (x, z) => nearAny(flatReach, x, z));
    const pts = flat.pts, faces = flat.faces;
    const faces3: [Role, number, [number, number, number]][] = [['floor', s.floor, [0, 1, 0]], ['ceil', s.ceil, [0, -1, 0]]];
    for (const [role, y0, want] of faces3) {
      if (role === 'ceil' && s.materials.ceil === SKY_MATERIAL) continue;
      const glow = role === 'floor' && s.glow !== null;
      const kind = surfaceKind(role === 'floor' ? s.materials.floor : s.materials.ceil, role, matsOn, emitOn);
      const look = SURFACE_LOOKS[kind];
      const tile = look.tileM;
      const b = glow ? glowBatch(s.glow!) : batch(s.zone, role, kind);
      const y = glow ? y0 + GLOW_LIFT_M : y0;
      // A fitted flat (a fluorescent ceiling): whole troffers over the polygon's box; the grime keeps world uv.
      const box = look.fit && role === 'ceil' ? polyBox(poly.outer) : null;
      const fuv = (i: number): number[] => box ? flatFit(look.fit!, pts[i]![0], pts[i]![1], box) : [pts[i]![0] / tile, pts[i]![1] / tile];
      for (const f of faces) {
        const p = f.map(i => [pts[i]![0], y, pts[i]![1]]);
        b.tri(p, f.map(fuv), want, poly.sector, false, f.map(i => [pts[i]![0] / tile, pts[i]![1] / tile]));
      }
    }
  }

  // Walls cut in height on the world grid only on levels with pools (the bounce is all it is for).
  for (const q of wallQuads(meshMap)) {
    const zone = map.sectors[q.sector]!.zone;
    const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], len = Math.hypot(dx, dz);
    const want: [number, number, number] = [-dz / len, 0, dx / len];
    const kind = surfaceKind(q.mat, 'wall', matsOn, emitOn);
    const look = SURFACE_LOOKS[kind];
    const tile = look.tileM;
    const [u0, u1] = wallU(kind, q.a, q.along, dx, dz, len, tile);
    // A fitted (emitter) wall: whole cells along the line and up the quad, seeded per line.
    const fit = look.fit;
    const seedTiles = fit ? lineSeedTiles(q.a[0] - (dx / len) * q.along[0], q.a[1] - (dz / len) * q.along[0]) : 0;
    const [m0, m1] = wallU('techPanel', q.a, q.along, dx, dz, len, tile);   // the world-projected u, for the mottle
    const b = batch(zone, 'wall', kind);
    // Each vertical edge is cut by its own end (nearGlow), so walls meeting at a corner cut it alike.
    const cuts = (p: XZ) => (nearAny(reach, p[0], p[1]) ? wallRows(q.y0, q.y1) : [q.y0, q.y1]);
    const cols = [cuts(q.a), cuts(q.b)] as const;
    const ends = [q.a, q.b] as const, us = [u0, u1] as const, ms = [m0, m1] as const;
    const wuv = (side: number, y: number): number[] => fit
      ? wallFit(fit, q.along[side]!, q.along[2], y, q.y0, q.y1, seedTiles)
      : [us[side]!, y / tile];
    for (const t of wallStrip(cols[0], cols[1])) {
      b.tri(t.map(([side, r]) => [ends[side]![0], cols[side]![r]!, ends[side]![1]]),
        t.map(([side, r]) => wuv(side, cols[side]![r]!)), want, q.sector, true,
        t.map(([side, r]) => [ms[side]!, cols[side]![r]! / tile]));
    }
  }

  // The world-tiled stone clones and the panel materials are made ONCE per kind; their textures are
  // shared by every mesh's own node material.
  const P = ctx.world.level.def!.palette;
  const surfaces = new Map<SurfaceKind, SurfaceSource>();
  const sourceOf = (kind: SurfaceKind): SurfaceSource => {
    let src = surfaces.get(kind);
    if (src) return src;
    const look = SURFACE_LOOKS[kind];
    if (isStone(kind)) {
      const set = ctx.world.stoneSet;
      const m = kind === 'stoneFloor' ? set.floor : kind === 'stoneCeil' ? set.perimeterAccent : set.wall;
      src = { base: worldTiled(m as THREE.MeshStandardMaterial), look, glowMap: null, roughness: null, emit: null };
    } else {
      const t = panelSet(kind);
      // No roughnessMap: panel roughness is one channel, read as .r by the roughnessNode. The deferred
      // path (?renderer=deferred, deferred-mesh.ts) copies roughnessMap only, so it draws panels at the
      // flat look.roughness, and drops the grime nodes (colorNode, emissiveNode) like every node term.
      const base = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap,
        roughness: look.roughness, metalness: look.metalness, normalScale: new THREE.Vector2(look.normalScale, look.normalScale) });
      src = { base, look, glowMap: t.emissiveMap, roughness: t.roughness, emit: look.emit && kind in EMITTER_FN ? kind as EmitterKind : null };
    }
    surfaces.set(kind, src);
    return src;
  };
  const glowParam = search.get('panelglow');
  if (glowParam !== null && Number.isFinite(Number(glowParam)) && Number(glowParam) >= 0) panelGlow.value = Number(glowParam);
  const colors: Record<Role, readonly [number, number, number]> = { floor: P.floor, ceil: P.ceil, wall: P.wall };
  const wallFloors = uniformArray<'float'>(map.sectors.map(s => s.floor), 'float');

  for (const [key, b] of batches) {
    const [zone, role, kind] = key.split(':') as [string, Role, SurfaceKind];
    const mesh = new THREE.Mesh(b.geometry(), sectorMaterial(sourceOf(kind), colors[role], fx, role === 'ceil', role === 'wall' ? wallFloors : null));
    mesh.name = isStone(kind) ? `sector-${role}-zone-${zone}` : `sector-${role}-${kind}-zone-${zone}`;
    mesh.userData.sectorKind = kind;
    mesh.userData.room = Number(zone) + 1;                       // the zone's synthesized room id
    ctx.world.levelGroup.add(mesh);
  }

  flushPanelJobs();
  let tris = 0;
  for (const b of batches.values()) tris += b.pos.length / 9;
  console.info(`[sector-bounce] ${emitSurfs.length} emitter surfaces (${emitSurfs.reduce((n, e) => n + e.patches.length, 0)} patches, ${emitSurfMs.toFixed(0)} ms), `
    + `${bakeStats.vertices} vertices baked in ${bakeStats.ms.toFixed(0)} ms, ${tris} triangles, ${meshMap.lines.length} lines (map ${map.lines.length})`);

  if (glowBatches.size > 0) {
    // WGSL has no nested fn: the noise helpers ride along as includes (game-void.ts's pattern).
    const include = (fn: ReturnType<typeof wgslFn>) => fn as unknown as NonNullable<Parameters<typeof wgslFn>[1]>[number];
    const glowFn = wgslFn(SECTOR_GLOW, [include(wgslFn(SECTOR_GLOW_NOISE, [include(wgslFn(SECTOR_GLOW_HASH))]))]);
    const group = new THREE.Group();
    group.name = 'sector-glow';
    for (const [kind, b] of glowBatches) {
      const mat = new MeshBasicNodeMaterial();
      mat.colorNode = vec4((glowFn({ wpos: positionWorld, t: fx.glowTime, kind: float(GLOW_KIND_INDEX[kind]) }) as unknown as ReturnType<typeof vec3>).mul(fx.glowGain), 1);
      mat.fog = false;
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.name = `sector-glow-${kind}`;
      mesh.userData.shadow = false;
      mesh.userData.skipLevelLights = true;
      group.add(mesh);
    }
    ctx.boot.handle.scene.add(group);
  }
  return batches.size;
}
