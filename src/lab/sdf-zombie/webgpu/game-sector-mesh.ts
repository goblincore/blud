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

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, materialColor, positionWorld, texture, uniform, vec3, vec4, wgslFn } from 'three/tsl';
import { panelTextures, type PanelKind, type PanelTextureSet } from '../../../game/level/panel-textures';
import { isStone, sectorMaterialsOn, surfaceKind, SURFACE_LOOKS, type SurfaceKind, type SurfaceLook } from './sector-materials';
import type { GameContext } from './game-context';
import { createSectorFx, CEIL_WHISPER, type SectorFxRuntime } from './game-sector-light';
import { reducedFlashes } from './lamp-moods';
import { SKY_MATERIAL, type GlowKind, type SectorMap, type XZ } from './sector-def';
import { createGlowBounce, glowSources, nearGlow, refineNearGlow, wallRows, wallStrip, type GlowBounce, type RGB } from './sector-bounce';
import { sectorPolygons, wallQuads } from './sector-geometry';
import { GLOW_KIND_INDEX, SECTOR_GLOW, SECTOR_GLOW_HASH, SECTOR_GLOW_NOISE } from './sector-glow.wgsl';

/** Glow floors sit this far above the sector floor, so they never z-fight a neighbour's riser edge. */
const GLOW_LIFT_M = 0.002;
type Role = 'floor' | 'ceil' | 'wall';

const bounceScratch: RGB = [0, 0, 0];
/** Baked bounces by position and normal: the mesh is unindexed, so a vertex recurs in every triangle round it. */
type BounceCache = Map<string, readonly [number, number, number]>;

class Batch {
  pos: number[] = []; uv: number[] = []; nrm: number[] = []; sec: number[] = []; bnc: number[] = [];
  constructor(private readonly bounce: GlowBounce | null, private readonly cache: BounceCache = new Map()) {}
  /** One triangle of sector `sector`; flipped if its normal disagrees with `want`. Each vertex's glow
   *  bounce is baked with its ray starting inside its own sector: off a wall along the wall's normal,
   *  off a floor or ceiling toward the triangle's centre. */
  tri(p: number[][], uv: number[][], want: [number, number, number], sector: number, wall = false) {
    const [a, b, c] = p as [number[], number[], number[]];
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const order = n[0]! * want[0] + n[1]! * want[1] + n[2]! * want[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
    const cx = (a[0]! + b[0]! + c[0]!) / 3, cz = (a[2]! + b[2]! + c[2]!) / 3;
    for (const i of order) {
      const q = p[i]!;
      this.pos.push(...q); this.uv.push(...uv[i]!); this.nrm.push(...want); this.sec.push(sector);
      if (this.bounce) {
        const key = `${q[0]},${q[1]},${q[2]},${want[0]},${want[1]},${want[2]}`;
        let g = this.cache.get(key);
        if (!g) {
          const r = this.bounce.at([q[0]!, q[1]!, q[2]!], want, wall ? [want[0], want[2]] : [cx - q[0]!, cz - q[2]!], bounceScratch);
          this.cache.set(key, (g = [r[0], r[1], r[2]]));
        }
        this.bnc.push(g[0], g[1], g[2]);
      } else this.bnc.push(0, 0, 0);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('sectorIndex', new THREE.Float32BufferAttribute(this.sec, 1));
    g.setAttribute('glowBounce', new THREE.Float32BufferAttribute(this.bnc, 3));
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

/** The panel kinds' textures, built once per page (each is ~0.1 s of CPU and 4 × 1 MB before mips). */
const panelCache = new Map<PanelKind, PanelTextureSet>();
const PANEL_SEEDS: Record<PanelKind, number> = {
  techPanel: 101, metalSheet: 103, door: 107, rustBrick: 109, lightPanel: 113, concreteSlab: 127, metalPlate: 131, floorTile: 137,
};
function panelSet(kind: PanelKind): PanelTextureSet {
  let t = panelCache.get(kind);
  if (!t) panelCache.set(kind, (t = panelTextures(kind, PANEL_SEEDS[kind])));
  return t;
}
/** The light panels' glow strength (`?panelglow=` overrides). */
export const panelGlow = uniform(1);

interface SurfaceSource { base: THREE.MeshStandardMaterial; look: SurfaceLook; glowMap: THREE.Texture | null }

/** One mesh's own node material (a NodeMaterial is reused as is by the light-list loop, so meshes
 *  never share one): the surface's textures and the palette colour, plus the sector term — the
 *  albedo times the sector's current level — for ceilings plan 1's whisper, and a light panel's glow. */
function sectorMaterial(src: SurfaceSource, color: readonly [number, number, number], fx: SectorFxRuntime, ceil: boolean): MeshStandardNodeMaterial {
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
  const lit = materialColor.rgb.mul(vec3(lvl).add(bounce)).add(base);
  nm.emissiveNode = src.glowMap ? lit.add(texture(src.glowMap).rgb.mul(panelGlow.mul(src.look.glow))) : lit;
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
  const meshMap = refineNearGlow(map, sources);
  const cache: BounceCache = new Map();
  const matsOn = sectorMaterialsOn(search);
  const batches = new Map<string, Batch>();
  const batch = (zone: number, role: Role, kind: SurfaceKind) => {
    const key = `${zone}:${role}:${kind}`;
    let b = batches.get(key);
    if (!b) batches.set(key, (b = new Batch(bounce, cache)));
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
    const pts: XZ[] = [...poly.outer, ...poly.holes.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const faces3: [Role, number, [number, number, number]][] = [['floor', s.floor, [0, 1, 0]], ['ceil', s.ceil, [0, -1, 0]]];
    for (const [role, y0, want] of faces3) {
      if (role === 'ceil' && s.materials.ceil === SKY_MATERIAL) continue;
      const glow = role === 'floor' && s.glow !== null;
      const kind = surfaceKind(role === 'floor' ? s.materials.floor : s.materials.ceil, role, matsOn);
      const tile = SURFACE_LOOKS[kind].tileM;
      const b = glow ? glowBatch(s.glow!) : batch(s.zone, role, kind);
      const y = glow ? y0 + GLOW_LIFT_M : y0;
      for (const f of faces) {
        const p = f.map(i => [pts[i]![0], y, pts[i]![1]]);
        b.tri(p, f.map(i => [pts[i]![0] / tile, pts[i]![1] / tile]), want, poly.sector);
      }
    }
  }

  // Walls cut in height on the world grid only on levels with pools (the bounce is all it is for).
  for (const q of wallQuads(meshMap)) {
    const zone = map.sectors[q.sector]!.zone;
    const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], len = Math.hypot(dx, dz);
    const want: [number, number, number] = [-dz / len, 0, dx / len];
    // u runs along the wall from the projection of `a` on its direction, so the pieces of a split line tile on.
    const kind = surfaceKind(q.mat, 'wall', matsOn);
    const tile = SURFACE_LOOKS[kind].tileM;
    const u0 = (q.a[0] * dx + q.a[1] * dz) / len / tile, u1 = u0 + len / tile;
    const b = batch(zone, 'wall', kind);
    // Each vertical edge is cut by its own end (nearGlow), so walls meeting at a corner cut it alike.
    const cuts = (p: XZ) => (bounce && nearGlow(sources, p[0], p[1]) ? wallRows(q.y0, q.y1) : [q.y0, q.y1]);
    const cols = [cuts(q.a), cuts(q.b)] as const;
    const ends = [q.a, q.b] as const, us = [u0, u1] as const;
    for (const t of wallStrip(cols[0], cols[1])) {
      b.tri(t.map(([side, r]) => [ends[side]![0], cols[side]![r]!, ends[side]![1]]),
        t.map(([side, r]) => [us[side]!, cols[side]![r]! / tile]), want, q.sector, true);
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
      src = { base: worldTiled(m as THREE.MeshStandardMaterial), look, glowMap: null };
    } else {
      const t = panelSet(kind);
      const base = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
        roughness: look.roughness, metalness: look.metalness, normalScale: new THREE.Vector2(look.normalScale, look.normalScale) });
      src = { base, look, glowMap: t.emissiveMap };
    }
    surfaces.set(kind, src);
    return src;
  };
  const glowParam = search.get('panelglow');
  if (glowParam !== null && Number.isFinite(Number(glowParam)) && Number(glowParam) >= 0) panelGlow.value = Number(glowParam);
  const colors: Record<Role, readonly [number, number, number]> = { floor: P.floor, ceil: P.ceil, wall: P.wall };

  for (const [key, b] of batches) {
    const [zone, role, kind] = key.split(':') as [string, Role, SurfaceKind];
    const mesh = new THREE.Mesh(b.geometry(), sectorMaterial(sourceOf(kind), colors[role], fx, role === 'ceil'));
    mesh.name = isStone(kind) ? `sector-${role}-zone-${zone}` : `sector-${role}-${kind}-zone-${zone}`;
    mesh.userData.sectorKind = kind;
    mesh.userData.room = Number(zone) + 1;                       // the zone's synthesized room id
    ctx.world.levelGroup.add(mesh);
  }

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
