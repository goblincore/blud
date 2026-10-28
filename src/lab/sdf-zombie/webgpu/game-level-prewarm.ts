// src/lab/sdf-zombie/webgpu/game-level-prewarm.ts
//
// LEVEL PRE-WARM: every level mesh is drawn once, one material build a step, nearest the player first, before the
// player first sees it (E1M1 first-sight hitch, 2026-10-28). Turning into an unseen room built its sector materials
// (sector-<role>-<kind>-zone-<n>, 10-20 ms each), its barrels' zone set and the first pickup of each item (25-60 ms)
// in one frame: 23-27 builds, 475-770 ms.
//
// WHY EVERY ZONE BUILDS (and why they cannot share). game-sector-mesh.ts gives every (zone, role, kind) batch its own
// MeshStandardNodeMaterial, and game-main stamps each with its zone room's light list. three r186 keys a node build
// on the material's node graph, where a node's key is its id (Node.customCacheKey), and on the light list, where a
// light's key is its id (LightsNode.customCacheKey): every zone room lists its own point lights and its own probe
// and level-list nodes. Sharing the node graph between zones would leave the light list differing, and the build
// state holds the bindings of exactly those lights, so two zones cannot share one build without lighting one zone
// with the other's lights. So the builds stay one per batch, and are made early.
//
// THE REAL MESH, like game-kit-prewarm.ts: the step turns off frustum culling on one real mesh, the renderer draws it
// where it stands (off-screen when it is out of view; nothing in view changes), and the next step turns culling back
// on. renderer.compileAsync builds against a default render context whose keys do not match play's (3079ce7d), and
// boot's warm frame keys differ from play's too (db14ad19), so this warms in play.
//
// ONE BUILD A STEP, and none in a step where the kit pre-warm built (`build` false), so the two never stack in one
// frame. A mesh whose warm key is already warm (another pickup of the same item, another barrel of the zone) is drawn
// along in a later step for draws only, a few a step. Meshes added later (a level-group mesh) are picked up when the
// level group's child count changes; hidden meshes (a taken pickup, an exploded drum, a barrel's stub) wait.
import type * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { nearestSite, type WarmSite } from './prewarm-order';

/** Draw-only meshes (warm key already built) forced along per step. */
const FREE_PER_STEP = 6;

export interface LevelPrewarm {
  /** Restore last step's meshes; force the nearest unwarmed mesh (only when `build`) and a few already-warm ones. */
  step(build?: boolean): void;
  /** Visible level meshes not drawn by the pre-warm yet (0 = all warm). */
  readonly pending: number;
  /** Milliseconds from the first step to the step that left nothing pending (null until then). */
  readonly doneMs: number | null;
}

interface Candidate { mesh: THREE.Mesh; key: string; site: WarmSite; done: boolean }

/** What a mesh's first draw builds: a node material's graph is its own (node ids key it), a classic material is
 *  converted by its properties, so meshes of one classic material type, name and attribute set share. */
function warmKey(mesh: THREE.Mesh): string {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const attrs = Object.keys(mesh.geometry.attributes).sort().join(',');
  return mats.map(m => ((m as THREE.Material & { isNodeMaterial?: boolean }).isNodeMaterial
    ? m.uuid : `${m.type}|${m.name}|${(m as THREE.MeshStandardMaterial).map ? 'map' : ''}`)).join('+') + '|' + attrs;
}

function shown(o: THREE.Object3D): boolean {
  for (let q: THREE.Object3D | null = o; q; q = q.parent) if (!q.visible) return false;
  return true;
}

export function createLevelPrewarm(ctx: GameContext): LevelPrewarm {
  const cands: Candidate[] = [];
  const known = new Set<THREE.Object3D>();
  const warmed = new Set<string>();
  let forced: THREE.Mesh[] = [];
  let seenChildren = -1;
  let pending = 0;
  let t0: number | null = null, doneMs: number | null = null;

  function add(o: THREE.Object3D): void {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || known.has(mesh) || !mesh.frustumCulled || !mesh.geometry) return;
    known.add(mesh);
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    mesh.updateWorldMatrix(true, false);
    const c = g.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
    const r = g.boundingSphere!.radius * mesh.matrixWorld.getMaxScaleOnAxis();
    cands.push({ mesh, key: warmKey(mesh), site: { x: c.x, y: c.y, z: c.z, r }, done: false });
  }
  function sync(): void {
    const group = ctx.world.levelGroup;
    if (group.children.length === seenChildren) return;
    seenChildren = group.children.length;
    group.traverse(add);
    ctx.boot.handle.scene.getObjectByName('sector-glow')?.traverse(add);
    for (const m of ctx.world.loop?.meshes.values() ?? []) add(m);
  }
  function restore(): void {
    for (const m of forced) m.frustumCulled = true;
    forced = [];
  }
  function force(c: Candidate): void {
    c.done = true;
    c.mesh.frustumCulled = false;
    forced.push(c.mesh);
  }
  const sites: WarmSite[] = [];
  return {
    get pending() { return pending; },
    get doneMs() { return doneMs; },
    step(build = true) {
      restore();
      sync();
      if (sites.length !== cands.length) for (let i = sites.length; i < cands.length; i++) sites.push(cands[i]!.site);
      t0 ??= performance.now();
      const fresh = new Set<string>();
      if (build) {
        const pos = ctx.player.player.pos;
        const i = nearestSite(sites, [pos[0], pos[1] + 1.6, pos[2]], j => {
          const c = cands[j]!;
          return c.done || warmed.has(c.key) || !shown(c.mesh);
        });
        if (i >= 0) {
          const c = cands[i]!;
          warmed.add(c.key);
          fresh.add(c.key);
          force(c);
        }
      }
      let free = FREE_PER_STEP;
      pending = 0;
      for (const c of cands) {
        if (c.done || !shown(c.mesh)) continue;
        if (free > 0 && warmed.has(c.key) && !fresh.has(c.key)) { force(c); free--; continue; }
        pending++;
      }
      if (pending === 0 && doneMs === null && cands.length > 0) doneMs = performance.now() - t0;
    },
  };
}
