// src/lab/sdf-zombie/webgpu/game-level-batch.ts
//
// LEVEL BATCHING, THE RENDERER SIDE (draw-count pass, 2026-10-28; the pure core is level-batch.ts): pickup batches
// and the static level matrices. (Barrels merge per zone in game-barrel-view.ts; casing pools in shotgun-casings.ts.)
//
// PICKUP BATCHES (draw-count pass, 2026-10-28): the level's pickups drawn as ONE instanced draw per item type
// (E1M1: 53 pickups, 17-23 drawn per frame before, each its own render object) instead of a mesh each. The grouping
// and the packing are level-batch.ts's; this module owns the meshes.
//
// - Every pickup keeps its own LOGICAL mesh (game-loop.ts rt.meshes): its position, the spin stepLoop writes, the cd's
//   tilt, what the debris seam reads. It is no longer in the scene: each frame its matrix is copied into its batch's
//   row, and the rows of the shown pickups (not taken; in a sector the zone cull's camera flood reaches) are packed to
//   the front, so the draw's instance count is the shown count. Taken pickups and culled ones are simply not drawn.
// - A batch is a plain THREE.Mesh on an InstancedBufferGeometry with the instance matrix as named attributes, the
//   skeleton's pattern (skeleton-spike/segment-instance.ts: three r186 keys an InstancedMesh's build by its uuid and
//   names its matrix buffer per node, so InstancedMeshes never share a build). The material is the old one's node
//   twin (same colour, emissive, metalness, roughness), lit by the scene's light list as the pickups always were (they
//   are not level-group meshes, so no room list), so one item is one material is one batch.
// - The batch covers the whole level: frustumCulled false (its instances are everywhere; a pickup is 30-300 vertices),
//   so it draws from the first frame and builds at boot, never on first sight; the level pre-warm skips it.
//   With nothing to show it leaves the render (`visible` false) once it has been drawn once.
import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { GameContext } from './game-context';
import { anySectorSeen, groupPickups, levelBatchOn, packShown, ROW_FLOATS } from './level-batch';
import { ensureSegmentMatrices, useSegmentInstance } from './skeleton-spike/segment-instance';
import { drawSectorsSeen, resyncZoneCull, sectorsUnder } from './game-zone-cull';
import { setCasingGate } from './shotgun-casings';
import type { SectorGround } from './sector-ground';

interface Batch {
  item: string;
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, MeshStandardNodeMaterial>;
  ids: string[];
  logical: THREE.Mesh[];
  /** Each member's sectors (the zone cull's placement), filled on the first update with a sector ground. */
  sectors: number[][] | null;
  src: Float32Array;
  rows: THREE.InstancedInterleavedBuffer;
  drawn: boolean;
}

export interface PickupBatches {
  readonly batches: readonly Batch[];
  /** After the zone cull, before the render: copy, pack, count. */
  update(): void;
  /** The debug seam: per item, members and instances drawn. */
  report(): { item: string; members: number; taken: number; drawn: number; visible: boolean }[];
  /** In-boot A/B (setLevelBatchLive): false puts every untaken pickup mesh back in the scene (the old path) and
   *  takes the batches off; true batches again. */
  setLive(on: boolean): void;
}

export interface PickupLook { geo: () => THREE.BufferGeometry; color: number }

export function createPickupBatches(ctx: GameContext, pickups: readonly { id: string; item: string }[],
  logical: ReadonlyMap<string, THREE.Mesh>, look: (item: string) => PickupLook | undefined): PickupBatches {
  const batches: Batch[] = [];
  for (const g of groupPickups(pickups.filter(p => logical.has(p.id)))) {
    const l = look(g.item);
    if (!l) continue;
    const geo = new THREE.InstancedBufferGeometry().copy(l.geo() as unknown as THREE.InstancedBufferGeometry);
    geo.instanceCount = 0;
    const rows = ensureSegmentMatrices(geo, g.members.length);
    const mat = new MeshStandardNodeMaterial({
      color: l.color, emissive: l.color, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4,
    });
    mat.name = `pickup-${g.item}`;
    useSegmentInstance(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `pickups-${g.item}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    const b: Batch = {
      item: g.item, mesh, ids: g.members.map(m => m.id), logical: g.members.map(m => logical.get(m.id)!), sectors: null,
      src: new Float32Array(g.members.length * ROW_FLOATS), rows, drawn: false,
    };
    mesh.onBeforeRender = () => { b.drawn = true; };
    ctx.boot.handle.scene.add(mesh);
    batches.push(b);
  }

  function placeSectors(b: Batch, ground: SectorGround): number[][] {
    return b.logical.map((m) => {
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      return sectorsUnder(ground, m.position.x, m.position.z, g.boundingSphere!.radius);
    });
  }

  let live = true;
  return {
    batches,
    setLive(on) {
      live = on;
      const taken = ctx.world.loop?.taken;
      for (const b of batches) {
        if (!on) b.mesh.visible = false;
        b.logical.forEach((m, i) => {
          if (on) m.removeFromParent();
          else if (!taken?.has(b.ids[i]!)) ctx.boot.handle.scene.add(m);
        });
      }
    },
    update() {
      if (!live) return;
      const taken = ctx.world.loop?.taken;
      const seen = drawSectorsSeen(ctx);
      const ground = ctx.world.zoneCull?.ground ?? null;
      for (const b of batches) {
        if (ground && !b.sectors) b.sectors = placeSectors(b, ground);
        for (let i = 0; i < b.logical.length; i++) {
          const m = b.logical[i]!;
          m.updateMatrix();
          m.matrix.toArray(b.src, i * ROW_FLOATS);
        }
        const { count, changed } = packShown(b.src, b.logical.length, (i) =>
          !(taken?.has(b.ids[i]!)) && (!seen || !b.sectors || anySectorSeen(b.sectors[i]!, seen)), b.rows.array as Float32Array);
        if (changed) b.rows.needsUpdate = true;
        b.mesh.geometry.instanceCount = count;
        b.mesh.visible = count > 0 || !b.drawn;
      }
    },
    report() {
      const taken = ctx.world.loop?.taken;
      return batches.map(b => ({ item: b.item, members: b.ids.length, taken: b.ids.filter(id => taken?.has(id)).length,
        drawn: b.mesh.geometry.instanceCount, visible: b.mesh.visible }));
    },
  };
}

/** STATIC LEVEL MATRICES: every sector level object in the level group (zone batches, barrel merges and stubs, door
 *  leaves and frames — a door slides its leaves in the vertex shader, never by its transform) has a fixed transform,
 *  so its matrix is composed once and three's per-render walk (several a frame) stops recomposing and multiplying
 *  it. Re-run when the level group's children change; a no-op once settled. Sector levels only (a room level's art
 *  may move: the train sways). */
const frozenCount = new WeakMap<THREE.Object3D, number>();
const frozen = new WeakSet<THREE.Object3D>();
/** The batching switch: `?batch=0` at boot, then setLevelBatchLive (the in-boot A/B). */
const live = { on: typeof location !== 'undefined' && levelBatchOn(location.search) };
export function freezeLevelMatrices(ctx: GameContext): void {
  const group = ctx.world.levelGroup;
  if (!live.on || !ctx.world.level.def?.sectors || frozenCount.get(group) === group.children.length) return;
  frozenCount.set(group, group.children.length);
  group.traverse((o) => {
    if (!o.matrixAutoUpdate) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    o.matrixWorldNeedsUpdate = true;
    frozen.add(o);
  });
}

/** IN-BOOT A/B (the `setLevelBatch` seam): switch batching off and on again in a booted level, so a measurement can
 *  alternate legs in one boot. Off: pickups back to a mesh each, barrels to a drum and lid each, empty casing pools
 *  drawn again, level matrices composed every walk. (Casing pools stay plain meshes on shared materials either way: the
 *  boot's `?batch=0` keeps the old InstancedMeshes.) Only a level that booted batched can switch; returns the state. */
export function setLevelBatchLive(ctx: GameContext, on: boolean): boolean {
  if (!ctx.world.loop?.batches && !ctx.world.barrels?.batches()) return live.on;   // booted with ?batch=0
  live.on = on;
  ctx.world.loop?.batches?.setLive(on);
  ctx.world.barrels?.setBatchLive(on);
  setCasingGate(on);
  if (on) frozenCount.delete(ctx.world.levelGroup);
  else ctx.world.levelGroup.traverse((o) => { if (frozen.has(o)) { o.matrixAutoUpdate = true; frozen.delete(o); } });
  resyncZoneCull(ctx);
  return live.on;
}
export const levelBatchLive = (): boolean => live.on;

