// src/game/level/bake-cosmetic.ts
//
// Cosmetic twin of bakeSimGeometry: it consumes the SAME bakeWallRectsMeters(fp)
// so the visuals exactly match sim collision. This replaces buildArena +
// registerArenaSurfaces in src/game/arena.ts (those stay in place for now;
// main.ts stops calling them in Task 10). The Floorplan is the single source of
// truth — game depends on sim, never the reverse.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { bakeWallRectsMeters, cellToWorld, type Floorplan } from '../../sim/floorplan';
import type { ArenaPlan } from '../../sim/arenagen/types';
import type { StaticSurface } from '../gibs/particles';
import { setArenaSurfaces } from '../gibs/particles';
import { loadTexture } from '../../engine/asset-loader';
import { defaultMaterialSet, resolveRole } from './theme-material-set';

const WALL_HEIGHT = 4;
const TEX_METERS_PER_REPEAT = 2;

/** A built level's cosmetic resources — disposable + rebuildable on reroll. */
export interface LevelCosmetic {
  group: THREE.Group;
  rebuild(fp: Floorplan): void;
  dispose(): void;
}

export function bakeLevelCosmetic(
  fp: Floorplan, scene: THREE.Scene, world: RAPIER.World,
): LevelCosmetic {
  const group = new THREE.Group();
  scene.add(group);
  let colliders: RAPIER.Collider[] = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a2a });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a3a36 });
  // Cover role→material set. Created once like floor/wall mats — teardown
  // disposes geometries only, so materials intentionally live for the level's
  // lifetime (no per-rebuild allocation/leak).
  const coverMats = defaultMaterialSet();
  loadTexture('/assets/arena-placeholder/449.png').then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const ft = t.clone(); ft.needsUpdate = true;
    ft.repeat.set(fp.gridW * fp.cellMeters / TEX_METERS_PER_REPEAT, fp.gridH * fp.cellMeters / TEX_METERS_PER_REPEAT);
    floorMat.map = ft; floorMat.color.set(0xffffff); floorMat.needsUpdate = true;
  }).catch(() => { /* keep solid color */ });
  loadTexture('/assets/arena-placeholder/458.png').then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    wallMat.map = t; wallMat.color.set(0xffffff); wallMat.needsUpdate = true;
  }).catch(() => { /* keep solid color */ });

  function build(plan: Floorplan): void {
    const w = plan.gridW * plan.cellMeters;
    const d = plan.gridH * plan.cellMeters;

    // floor: one slab over the whole footprint (solid areas are hidden by walls)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), floorMat);
    floor.position.y = -0.25;
    group.add(floor);
    colliders.push(world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, 0.25, d / 2).setTranslation(0, -0.25, 0),
    ));

    // Cover-aware pass: re-open cover cells on a copy so the full-height wall
    // loop below (meshes + colliders) skips them; cover pieces get their own
    // SHORT visual mesh here. Rapier colliders for cover stay full-height
    // (WALL_HEIGHT) so movement blocking is unchanged — v1 visuals are
    // height-aware, sim LOS/arcs + Rapier physics still treat cover as solid
    // (spec mixed-height-cover caveat; over-cover physics lands in migration step 2).
    const arenaPlan = plan as Partial<ArenaPlan> & Floorplan;
    let wallPlan: Floorplan = plan;
    if (arenaPlan.cover && arenaPlan.cover.length > 0) {
      const open = new Uint8Array(plan.open);
      for (const p of arenaPlan.cover)
        for (let z = p.cz; z < p.cz + p.h; z++)
          for (let x = p.cx; x < p.cx + p.w; x++) open[z * plan.gridW + x] = 1;
      wallPlan = { ...plan, open };

      const LOW_H = 1.0, MID_H = 2.2; // meters; low = lob-over, mid = sightline breaker
      for (const p of arenaPlan.cover) {
        const ch = p.height === 'low' ? LOW_H : MID_H;
        const coverMesh = new THREE.Mesh(
          new THREE.BoxGeometry(p.w * plan.cellMeters, ch, p.h * plan.cellMeters),
          resolveRole(coverMats, p.height === 'low' ? 'coverLow' : 'coverMid'),
        );
        const c = cellToWorld(plan, p.cx + (p.w - 1) / 2, p.cz + (p.h - 1) / 2);
        coverMesh.position.set(c.x, ch / 2, c.z);
        group.add(coverMesh); // teardown disposes it via group.children
        colliders.push(world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            (p.w * plan.cellMeters) / 2, WALL_HEIGHT / 2, (p.h * plan.cellMeters) / 2,
          ).setTranslation(c.x, WALL_HEIGHT / 2, c.z),
        ));
      }
    }

    // walls: one mesh + one collider per merged wall rect (visuals == sim collision)
    const surfaces: StaticSurface[] = [{
      min: { x: -w / 2, y: -0.5, z: -d / 2 }, max: { x: w / 2, y: 0, z: d / 2 },
      normal: { x: 0, y: 1, z: 0 }, // floor decals
    }];
    for (const r of bakeWallRectsMeters(wallPlan)) {
      const sx = r.maxX - r.minX, sz = r.maxZ - r.minZ;
      const px = (r.minX + r.maxX) / 2, pz = (r.minZ + r.maxZ) / 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), wallMat);
      m.position.set(px, WALL_HEIGHT / 2, pz);
      group.add(m);
      colliders.push(world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, WALL_HEIGHT / 2, sz / 2).setTranslation(px, WALL_HEIGHT / 2, pz),
      ));
    }
    setArenaSurfaces(surfaces);
  }

  function teardown(): void {
    for (const c of colliders) world.removeCollider(c, false);
    colliders = [];
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
  }

  build(fp);

  return {
    group,
    rebuild(next: Floorplan): void { teardown(); build(next); },
    dispose(): void { teardown(); scene.remove(group); },
  };
}
