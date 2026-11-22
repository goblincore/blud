// src/lab/sdf-zombie/webgpu/game-zone-cull.ts
//
// ZONE / PORTAL CULL AND ENEMY UPDATE LOD IN PLAY (occlusion pass, 2026-10-28). The pure cores are
// sector-portals.ts (the portal flood: which sectors the camera can possibly see) and actor-lod.ts (which enemies
// step every frame, at a quarter rate, or not at all). This module wires them:
//
// - DRAW (updateZoneCull, once per frame before the polygon render, from the real camera): the flood, then every
//   level mesh it can place is taken off the render by `layers.mask = 0` (restored when seen again): sector batches
//   (sector-<role>-<kind>-zone-<n>) by zone, small things (barrels, pickups, door leaves and frames, decals) by the
//   sectors under their bounding circle. Layers, not `.visible`: game logic owns `.visible` (a taken pickup, an
//   exploded drum) and the level pre-warm reads it; a mask of 0 also leaves the shadow passes (lights do not cross
//   zones, and the only shadow casters are the flashlight and its twin at the eye). A mesh the pre-warm is forcing
//   this step (frustumCulled false) is always left on, so culling never fights the pre-warm.
// - TICK (zoneCullTick, before the visual set, from the player's eye): an omni flood (every direction), which
//   pre-tests the visual set's sight rays (bodyMaySee: a body whose flesh reaches no flooded sector cannot be in
//   sight, so its ray tests are skipped) and feeds the LOD: a tier per actor (actor-lod.ts, lodStepDts) and the dt
//   its step() gets. The draw's march cull pre-tests the same way against the camera flood. The kit / prop pose (character-view pose) is skipped for a body in
//   neither the visual set nor the last march set: its kit is hidden then (syncKitVisibility), so nothing reads it.
//
// `?cull=0` (or __sdfGame.setZoneCull(false)) turns all of it off: every mesh on, every actor full. Room levels have
// no sectors: ctx.world.zoneCull stays null and nothing here runs.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { EncounterOrder } from './encounter-director';
import type { SectorGround } from './sector-ground';
import { buildPortalGraph, createFloodScratch, discVisible, floodSectors, frustumHalfAngle, visibleZones, type FloodStats, type PortalGraph, type FloodScratch } from './sector-portals';
import { ACTOR_LOD, countTiers, lodStepDt, lodTier, type LodClock, type LodTier } from './actor-lod';

/** A mesh this small (bounding radius, metres) is placed by the sectors under it; bigger ones only by a zone name. */
const SMALL_M = 4;

interface Cullable { mesh: THREE.Object3D; zone: number; sectors: number[]; mask: number; hidden: boolean }

export interface ZoneCullRuntime {
  on: boolean;
  readonly graph: PortalGraph;
  readonly ground: SectorGround;
  /** This frame's draw flood (camera). */
  readonly sectors: Uint8Array;
  readonly zones: Uint8Array;
  /** This tick's LOD flood (player eye). */
  readonly lodSectors: Uint8Array;
  readonly scratch: FloodScratch;
  cullables: Cullable[];
  seenCount: number;
  eyeSector: number;
  stats: FloodStats;
  floodUs: number;
  culled: number;
  frame: number;
  readonly clocks: Map<number, LodClock>;
  readonly tiers: Map<number, LodTier>;
}

/** Zone batches: sector-<role>-<kind>-zone-<n>, and the barrels' per-zone merges barrels-<part>-zone-<n>. */
const ZONE_MESH = /^(?:sector|barrels)-.*-zone-(\d+)$/;

export function createZoneCull(ctx: GameContext): ZoneCullRuntime | null {
  const map = ctx.world.level.def?.sectors;
  if (!map) return null;
  const graph = buildPortalGraph(map);
  return {
    on: new URLSearchParams(location.search).get('cull') !== '0',
    graph, ground: ctx.world.level.ground as SectorGround,
    sectors: new Uint8Array(graph.sectorCount).fill(1), zones: new Uint8Array(graph.zoneCount).fill(1),
    lodSectors: new Uint8Array(graph.sectorCount).fill(1),
    scratch: createFloodScratch(graph),
    cullables: [], seenCount: -1, eyeSector: -1, stats: { steps: 0, failOpen: false }, floodUs: 0, culled: 0, frame: 0,
    clocks: new Map(), tiers: new Map(),
  };
}

function closedFor(ground: SectorGround): (line: number) => boolean {
  const f = ground.doors;
  return (line) => { const d = f.lineDoor[line]!; return d >= 0 && f.open[d]! <= 0; };
}

function flood(z: ZoneCullRuntime, x: number, y: number, zz: number, dx: number, dy: number, dz: number,
  fovYDeg: number, aspect: number, out: Uint8Array, forceHalf?: number): number {
  void y;
  const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
  const hl = Math.hypot(dx, dz);
  const half = forceHalf ?? (hl < 1e-4 ? Math.PI : frustumHalfAngle(fovYDeg, aspect, pitch));
  const eye = z.ground.sectorAt(x, zz);
  z.stats = floodSectors(z.graph, { x, z: zz, fx: hl < 1e-4 ? 1 : dx, fz: hl < 1e-4 ? 0 : dz, half }, eye, out,
    { closed: closedFor(z.ground) }, z.scratch);
  return eye;
}

/** The sectors under a bounding circle (its centre, and 8 points on the rim and at half radius): how the cull
 *  places a small thing. Empty when it is over no sector. */
export function sectorsUnder(ground: SectorGround, x: number, zz: number, r: number): number[] {
  const set = new Set<number>();
  const probe = (px: number, pz: number) => { const s = ground.sectorAt(px, pz); if (s >= 0) set.add(s); };
  probe(x, zz);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    probe(x + Math.cos(a) * r, zz + Math.sin(a) * r);
    probe(x + Math.cos(a) * r * 0.5, zz + Math.sin(a) * r * 0.5);
  }
  return [...set];
}

/** Re-gather the placed meshes on the next draw (a mesh left or joined the scene without changing the counts). */
export function resyncZoneCull(ctx: GameContext): void {
  if (ctx.world.zoneCull) ctx.world.zoneCull.seenCount = -1;
}

/** The draw flood's sectors this frame (1 = may be seen), or null with the cull off or on a room level. */
export function drawSectorsSeen(ctx: GameContext): Uint8Array | null {
  const z = ctx.world.zoneCull;
  return z && z.on ? z.sectors : null;
}

const camDir = new THREE.Vector3();
const sphere = new THREE.Sphere();

/** Gather the meshes the cull can place: on first use and whenever the level group, the pickups or the scene grow. */
function syncCullables(ctx: GameContext, z: ZoneCullRuntime): void {
  const loopMeshes = ctx.world.loop?.meshes;
  const count = ctx.world.levelGroup.children.length + (loopMeshes?.size ?? 0);
  if (count === z.seenCount) return;
  z.seenCount = count;
  for (const c of z.cullables) if (c.hidden) { c.mesh.layers.mask = c.mask; c.hidden = false; }
  const out: Cullable[] = [];
  const add = (o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    // A parentless mesh is not drawn (a batched pickup's logical mesh, a taken one): nothing to place.
    if (!mesh.isMesh || !mesh.geometry || !mesh.parent) return;
    const m = ZONE_MESH.exec(mesh.name);
    if (m) { out.push({ mesh, zone: +m[1]!, sectors: [], mask: 0, hidden: false }); return; }
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere) return;
    mesh.updateWorldMatrix(true, false);
    sphere.copy(g.boundingSphere).applyMatrix4(mesh.matrixWorld);
    if (!(sphere.radius < SMALL_M)) return;
    const sectors = sectorsUnder(z.ground, sphere.center.x, sphere.center.z, sphere.radius);
    // Over no sector at all (a mesh parked at the origin, a pool not placed yet): never culled.
    if (sectors.length === 0) return;
    out.push({ mesh, zone: -1, sectors, mask: 0, hidden: false });
  };
  ctx.world.levelGroup.traverse(add);
  for (const m of loopMeshes?.values() ?? []) add(m);
  z.cullables = out;
}

/** DRAW: flood from the camera and put each placed level mesh on or off the render. */
export function updateZoneCull(ctx: GameContext): void {
  const z = ctx.world.zoneCull;
  if (!z) return;
  syncCullables(ctx, z);
  const t0 = performance.now();
  if (z.on) {
    const cam = ctx.boot.handle.camera;
    cam.getWorldDirection(camDir);
    z.eyeSector = flood(z, cam.position.x, cam.position.y, cam.position.z, camDir.x, camDir.y, camDir.z, cam.fov, cam.aspect, z.sectors);
  } else {
    z.sectors.fill(1);
  }
  visibleZones(z.graph, z.sectors, z.zones);
  let culled = 0;
  for (const c of z.cullables) {
    let vis = true;
    if (z.on && (c.mesh as THREE.Mesh).frustumCulled !== false) {
      if (c.zone >= 0) vis = z.zones[c.zone] === 1;
      else { vis = false; for (const s of c.sectors) if (z.sectors[s]) { vis = true; break; } }
    }
    if (vis) {
      if (c.hidden) { c.mesh.layers.mask = c.mask; c.hidden = false; }
    } else {
      if (!c.hidden) { c.mask = c.mesh.layers.mask; c.mesh.layers.mask = 0; c.hidden = true; }
      if (c.mesh.visible) culled++;
    }
  }
  z.culled = culled;
  z.floodUs = (performance.now() - t0) * 1000;
}

/** Flesh round a torso (metres): the body cull's sphere radius plus a margin. */
const BODY_DISC_M = 1.4;

/** TICK, before the visual set: an OMNI flood from the player's eye (sight does not depend on where the player
 *  looks, and the visual set's cone is nearly a hemisphere), for the visual set's sight pre-test and the LOD. */
export function zoneCullTick(ctx: GameContext, eye: readonly [number, number, number]): void {
  const z = ctx.world.zoneCull;
  if (!z || !z.on) return;
  const cam = ctx.boot.handle.camera;
  flood(z, eye[0], eye[1], eye[2], 1, 0, 0, cam.fov, cam.aspect, z.lodSectors, Math.PI);
}

/** Whether a body round `center` can be in sight at all: false only when no sector its flesh reaches is in the
 *  flood (`which`: the tick's omni flood or the draw's camera flood). Always true with the cull off. */
export function bodyMaySee(ctx: GameContext, center: readonly number[], which: 'tick' | 'draw'): boolean {
  const z = ctx.world.zoneCull;
  if (!z || !z.on) return true;
  const s = z.ground.sectorAt(center[0]!, center[2]!);
  return discVisible(z.graph, s, center[0]!, center[2]!, BODY_DISC_M, which === 'tick' ? z.lodSectors : z.sectors, discScratch);
}
const discScratch: number[] = [];

/** TICK: this frame's LOD tier per actor (ctx.world.zoneCull.tiers) and the dt each actor's step() gets. With the
 *  cull off (or a room level) every actor is full and gets `dt`. Reads zoneCullTick's flood. */
export function lodStepDts(ctx: GameContext, dt: number,
  orders: ReadonlyMap<number, EncounterOrder> | null): Map<ZombieActor, number> {
  const out = new Map<ZombieActor, number>();
  const z = ctx.world.zoneCull;
  if (!z || !z.on) {
    for (const a of ctx.world.actors) out.set(a, dt);
    z?.tiers.clear();
    return out;
  }
  z.frame++;
  const p = ctx.player.player;
  const march = new Set(ctx.render.visibleActors);
  z.tiers.clear();
  for (const a of ctx.world.actors) {
    const pos = a.pose().pos;
    const order = orders?.get(a.id) ?? null;
    const md = a.mind().debug();
    const tier = lodTier({
      inView: ctx.render.visualActors.has(a) || march.has(a),
      sectorVisible: discVisible(z.graph, z.ground.sectorAt(pos[0], pos[2]), pos[0], pos[2], BODY_DISC_M, z.lodSectors, discScratch),
      distM: Math.hypot(pos[0] - p.pos[0], pos[2] - p.pos[2]),
      mode: order?.mode ?? null,
      orderVisible: order?.visible ?? false,
      alert: md.alert,
      restless: !(a.settled?.() ?? false),
    }, ACTOR_LOD);
    z.tiers.set(a.id, tier);
    let clock = z.clocks.get(a.id);
    if (!clock) z.clocks.set(a.id, clock = { owed: 0 });
    out.set(a, lodStepDt(tier, clock, dt, a.id, z.frame));
  }
  return out;
}

/** Whether the tick may skip this actor's kit / prop pose (its kit is hidden this frame). */
export function kitPoseSkippable(ctx: GameContext, a: ZombieActor, march: ReadonlySet<ZombieActor>): boolean {
  const z = ctx.world.zoneCull;
  if (!z || !z.on) return false;
  if (ctx.render.visualActors.has(a) || march.has(a)) return false;
  // A released prop falls inside the pose (and a dying body's kit follows its fall): only a settled body skips.
  if (!(a.settled?.() ?? false) || a.character?.prop?.released) return false;
  const warm = ctx.boot.kitPrewarm?.forcedRoot ?? null;
  if (warm && (a.character?.kit?.object === warm || a.character?.prop?.object === warm)) return false;
  return true;
}

/** HIDDEN KITS SKIP THE MATRIX WALK. three's updateMatrixWorld walks every object, shown or not, and a kit is a
 *  skinned glTF tree of bones and pieces: at ~100 bodies the walk cost ~2.6 ms a draw, mostly kits syncKitVisibility
 *  had hidden. With the zone cull on, a hidden kit or prop root (`visible` false) is not walked; shown again, the
 *  next walk updates it before it is drawn (its pose writes mark the matrices). Installed once per root. */
const guarded = new WeakSet<THREE.Object3D>();
export function guardHiddenMatrices(ctx: GameContext, root: THREE.Object3D): void {
  if (guarded.has(root)) return;
  guarded.add(root);
  const walk = root.updateMatrixWorld.bind(root);
  root.updateMatrixWorld = (force?: boolean) => {
    if (!root.visible && ctx.world.zoneCull?.on) return;
    walk(force);
  };
}

export function setZoneCullOn(ctx: GameContext, on: boolean): boolean {
  const z = ctx.world.zoneCull;
  if (!z) return false;
  z.on = on;
  if (!on) { z.sectors.fill(1); z.lodSectors.fill(1); for (const c of z.clocks.values()) c.owed = 0; }
  return z.on;
}

/** The debug seam's plain-data report. */
export function zoneCullReport(ctx: GameContext) {
  const z = ctx.world.zoneCull;
  if (!z) return null;
  const vis: number[] = [];
  z.zones.forEach((v, i) => { if (v) vis.push(i); });
  let sectors = 0;
  for (const v of z.sectors) sectors += v;
  return {
    on: z.on, eyeSector: z.eyeSector, visibleZones: vis, zoneCount: z.graph.zoneCount,
    visibleSectors: sectors, visibleSectorList: [...z.sectors].flatMap((v, i) => (v ? [i] : [])), sectorCount: z.graph.sectorCount, floodSteps: z.stats.steps, failOpen: z.stats.failOpen,
    floodUs: +z.floodUs.toFixed(1), culledMeshes: z.culled, placedMeshes: z.cullables.length,
    lod: countTiers(z.tiers.values()),
    tiers: Object.fromEntries(z.tiers),
  };
}
