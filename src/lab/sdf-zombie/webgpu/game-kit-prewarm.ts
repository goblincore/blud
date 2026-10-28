// src/lab/sdf-zombie/webgpu/game-kit-prewarm.ts
//
// KIT PRE-WARM: every cast kit mesh is drawn once, one build a step, before the player first sees it (teratoma
// first-sight hitch, 2026-10-28). A character kit (kit-overlay.ts) is a set of skinned glTF
// meshes, frustum-culled like anything else, so three built each kit material's node material and pipeline the first
// frame it entered the view: on E1M1, turning toward the room-1 floaters built horn, iron, cacoeye, chrome, led and
// ventglow in one 0.8 s frame.
//
// THE REAL MESH, NOT A STAND-IN. The game-kit-eye / game-meat-gib warm draws a degenerate copy, which works because
// those materials are the game's own. A kit's render key is the glTF's: its geometry's attribute set (skin indices and
// weights, vertex colours, `_glow`), the skeleton, the material, KitLightsNode. A copy that missed any of those would
// warm a pipeline nothing draws. So the step turns off frustum culling on ONE real kit mesh, the renderer draws it where
// it stands (off-screen; the shadow pass skips it, a kit casts none), and the next step turns culling back on. Drawn
// out of view at real scale is still invisible: nothing in the frustum changes, and a mesh in the frustum was being
// drawn anyway. renderer.compileAsync is not an option in r186: it builds against a default render context whose keys
// do not match the real pass (3079ce7d).
//
// ONE BUILD A STEP keeps each frame to one material build (30-80 ms CPU each, headless, E1M1). The kits share one environment (kit-overlay.ts
// kitEnvironment), so every instance of a character shares the builds its first instance made: a character's meshes are
// warmed one a step (keyed by character + mesh + material name), then each instance is drawn whole in one step, which
// costs only draws, and catches any material that does not share. Kits that finish loading later, and actors spawned
// later, are picked up the same way.
//
// NOT IN BOOT'S WARM FRAME (game-main warmPipelines, behind the loader). Tried: every loaded kit forced into that one
// draw built its materials there, and every one was built AGAIN at first sight (E1M1, 2026-10-28): the warm frame's
// builder key is not play's (likely its flipped-visible objects change the scene light list). Warm in play.
import type * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';

export interface KitPrewarm {
  /** Restore the meshes forced last step; force the next unwarmed kit mesh (or instance) to draw this frame. True when
   *  it forced a NEW mesh (a build this frame), so the level pre-warm (game-level-prewarm.ts) holds its own. */
  step(): boolean;
  /** Kit meshes not drawn yet, plus kits still loading (0 = all warm). */
  readonly pending: number;
  /** Forget everything (a cast rebuild). */
  clear(): void;
}

export function createKitPrewarm(ctx: GameContext): KitPrewarm {
  /** Character + mesh + material keys whose first build has been drawn. */
  const warmed = new Set<string>();
  /** Kit instances drawn whole once their character's keys were warm. */
  const done = new WeakSet<THREE.Object3D>();
  let forced: THREE.Object3D[] = [];
  let pending = 0;
  function restore(): void {
    for (const m of forced) m.frustumCulled = true;
    forced = [];
  }
  return {
    get pending() { return pending; },
    step() {
      restore();
      pending = 0;
      let budget = true;   // one unit a step: ONE new mesh, or one whole instance of an already-warm character
      let built = false;
      for (const a of ctx.world.actors) {
        const view = a.character;
        if (!view) continue;
        if (!view.kit) { if (view.entry.kit) pending++; continue; }
        const kit = view.kit.object;
        if (done.has(kit) || !kit.visible) continue;
        const name = a.characterName();
        const meshes: THREE.Mesh[] = [], fresh: { mesh: THREE.Mesh; key: string }[] = [];
        kit.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.visible || !mesh.frustumCulled) return;
          meshes.push(mesh);
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const key = `${name}|${mesh.name}|${mats.map(m => m.name).join(',')}`;
          if (!warmed.has(key)) fresh.push({ mesh, key });
        });
        // Then the whole instance, in one step: its builds are shared with the first instance's, so it costs draws,
        // unless a material of it is not shared after all, which then builds here and not at first sight.
        pending += fresh.length + 1;
        if (!budget) continue;
        budget = false;
        pending--;
        if (fresh.length > 0) {
          warmed.add(fresh[0]!.key);
          forced = [fresh[0]!.mesh];
          built = true;
        } else {
          done.add(kit);
          forced = meshes;
        }
        for (const m of forced) m.frustumCulled = false;
      }
      return built;
    },
    clear() {
      restore();
      warmed.clear();
      pending = 0;
    },
  };
}
