// src/lab/sdf-zombie/webgpu/game-sector-mesh.ts
//
// SECTOR LEVEL MESHES (spec 2026-10-24-doom-sector-levels-design.md §6.4): floors, ceilings and
// walls from sector-geometry.ts, merged into one mesh per zone and role, room-tagged like level art
// so the per-room light lists light them, and wearing the stone set's materials with WORLD-space
// UVs (one texture tile per TILE_M metres) so the pattern runs on across every wall and floor.
// Sky ceilings are not drawn. Wall quads already run with their sector on the left, so the left
// normal (-dz, 0, dx) faces into the sector the wall is seen from.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { SKY_MATERIAL, type SectorMap, type XZ } from './sector-def';
import { sectorPolygons, wallQuads } from './sector-geometry';

const TILE_M = 2;
type Role = 'floor' | 'ceil' | 'wall';

class Batch {
  pos: number[] = []; uv: number[] = []; nrm: number[] = [];
  /** One triangle; flipped if its normal disagrees with `want`. */
  tri(p: number[][], uv: number[][], want: [number, number, number]) {
    const [a, b, c] = p as [number[], number[], number[]];
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const order = n[0]! * want[0] + n[1]! * want[1] + n[2]! * want[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) { this.pos.push(...p[i]!); this.uv.push(...uv[i]!); this.nrm.push(...want); }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** A clone of a stone material whose textures repeat once per UV unit (the UVs are world/TILE_M). */
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

/** Add the sector level's meshes to the level group; returns how many meshes were added. */
export function addSectorMeshes(ctx: GameContext, map: SectorMap): number {
  const batches = new Map<string, Batch>();
  const batch = (zone: number, role: Role) => {
    const key = `${zone}:${role}`;
    let b = batches.get(key);
    if (!b) batches.set(key, (b = new Batch()));
    return b;
  };

  for (const poly of sectorPolygons(map)) {
    const s = map.sectors[poly.sector]!;
    const contour = poly.outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = poly.holes.map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const pts: XZ[] = [...poly.outer, ...poly.holes.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const faces3: [Role, number, [number, number, number]][] = [['floor', s.floor, [0, 1, 0]], ['ceil', s.ceil, [0, -1, 0]]];
    for (const [role, y, want] of faces3) {
      if (role === 'ceil' && s.materials.ceil === SKY_MATERIAL) continue;
      const b = batch(s.zone, role);
      for (const f of faces) {
        const p = f.map(i => [pts[i]![0], y, pts[i]![1]]);
        b.tri(p, f.map(i => [pts[i]![0] / TILE_M, pts[i]![1] / TILE_M]), want);
      }
    }
  }

  for (const q of wallQuads(map)) {
    const zone = map.sectors[q.sector]!.zone;
    const dx = q.b[0] - q.a[0], dz = q.b[1] - q.a[1], len = Math.hypot(dx, dz);
    const want: [number, number, number] = [-dz / len, 0, dx / len];
    const a0 = [q.a[0], q.y0, q.a[1]], b0 = [q.b[0], q.y0, q.b[1]];
    const b1 = [q.b[0], q.y1, q.b[1]], a1 = [q.a[0], q.y1, q.a[1]];
    const u0 = 0, u1 = len / TILE_M, v0 = q.y0 / TILE_M, v1 = q.y1 / TILE_M;
    const b = batch(zone, 'wall');
    b.tri([a0, b0, b1], [[u0, v0], [u1, v0], [u1, v1]], want);
    b.tri([a0, b1, a1], [[u0, v0], [u1, v1], [u0, v1]], want);
  }

  // Sector `light` and `materials` are not used yet: one stone set for every zone (sector lighting is the next plan).
  const P = ctx.world.level.def!.palette;
  const mats: Record<Role, THREE.MeshStandardMaterial> = {
    floor: worldTiled(ctx.world.stoneSet.floor as THREE.MeshStandardMaterial),
    ceil: worldTiled(ctx.world.stoneSet.perimeterAccent as THREE.MeshStandardMaterial),
    wall: worldTiled(ctx.world.stoneSet.wall as THREE.MeshStandardMaterial),
  };
  mats.floor.color = new THREE.Color(...P.floor);
  mats.ceil.color = new THREE.Color(...P.ceil);
  // The ceilings' whisper of self-light, as the plane path in game-main gives generated ceilings.
  mats.ceil.emissive = new THREE.Color(...P.ceil).multiplyScalar(0.10);
  mats.wall.color = new THREE.Color(...P.wall);

  for (const [key, b] of batches) {
    const [zone, role] = key.split(':') as [string, Role];
    const mesh = new THREE.Mesh(b.geometry(), mats[role]);
    mesh.name = `sector-${role}-zone-${zone}`;
    mesh.userData.room = Number(zone) + 1;                       // the zone's synthesized room id
    ctx.world.levelGroup.add(mesh);
  }
  return batches.size;
}
