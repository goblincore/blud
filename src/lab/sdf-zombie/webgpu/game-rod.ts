// src/lab/sdf-zombie/webgpu/game-rod.ts
//
// WEAPON SLOT 6: THE ROD (cut wounds M1, spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §5). A stand-in blade:
// hold the left button and sweep the crosshair across a body; the rod swings with the sweep; on release the sweep's hits
// on each body become cut wounds (cut-wound.ts cutsFromSweep → stampCut). The real axe / sword / chainsaw call the same
// `cut`. Built like the flare harness (game-flare.ts): its own rig on aimRig, edges consumed by the tick.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import { sdBody } from '../validate';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { ROD_CALIBRE, cutsFromSweep, stampCut, type CutCalibre, type CutSeg, type SweepSample } from '../cut-wound';

export const ROD = {
  /** Only hits within this of the eye count (a melee reach). */
  reach: 2.2,
  /** Rest pose in view (m) and the swing's degrees per radian of sweep. */
  rest: new THREE.Vector3(0.12, -0.16, -0.36),
  swingGain: 1.6,
  /** Sweep samples kept (one per frame). */
  maxSamples: 90,
} as const;

export interface RodDeps {
  traceSlugHitFrom(origin: Vec3, dir: Vec3): { actorId: number; hit: Vec3 | null };
  eye(): Vec3;
  aimDir(): Vec3;
  /** registerBleed for a cut's midpoint. */
  bleed(a: ZombieActor, w: Wound, point: Vec3, dir: Vec3): void;
}

export interface RodHarness {
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Per frame: sample the sweep while held, cut on release, pose the rod. */
  tick(dt: number): void;
  updateRig(): void;
  /** Cut `actorId` along a→b (world), seen along `view` (the anchor is found from the viewer's side; console seam / gates).
   *  Returns the wounds stamped. */
  cut(actorId: number, a: Vec3, b: Vec3, view: Vec3, calibre?: Partial<CutCalibre>): number;
  /** The last sweep's samples (debug / gates). */
  debug(): { held: boolean; samples: number; lastCuts: number };
}

export function createRodHarness(ctx: GameContext, deps: RodDeps): RodHarness {
  const rig = new THREE.Group();
  rig.name = 'rod-rig';
  ctx.weapon.aimRig!.add(rig);
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.9 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 12), steel);
  rod.rotation.x = Math.PI / 2;            // cylinder axis → view -Z
  rod.position.set(0, 0, -0.25);
  const pivot = new THREE.Group();
  pivot.add(rod);
  pivot.position.copy(ROD.rest);
  rig.add(pivot);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  let held = false, release = false;
  let yaw0 = 0, pitch0 = 0;
  const samples = new Map<number, SweepSample[]>();
  let lastCuts = 0;

  function cutActor(a: ZombieActor, segs: CutSeg[], calibre: CutCalibre): number {
    if (!segs.length) return 0;
    const posed = a.posed();
    const field = (q: Vec3) => sdBody(q, posed);
    const yaw = a.pose().yaw;
    const wounds = segs.map(s => stampCut(posed.prims, s, calibre, yaw, field));
    a.blast({ wounds, meterCredit: 0, impulse: null, reaction: 'flinch' });
    for (let i = 0; i < wounds.length; i++) {
      const s = segs[i]!;
      const mid: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
      deps.bleed(a, wounds[i]!, mid, deps.aimDir());
    }
    return wounds.length;
  }

  function finishSweep(): void {
    let n = 0;
    for (const [id, list] of samples) {
      const a = ctx.world.actors.find(x => x.id === id);
      if (!a) continue;
      n += cutActor(a, cutsFromSweep(a.posed().prims, list), ROD_CALIBRE);
    }
    samples.clear();
    lastCuts = n;
    if (n) ctx.telemetry.telemetry.event('rod-cut', { cuts: n });
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'rod') return false;
      if (button === 0 && slotReady(ctx.weapon.slotState)) {
        held = true; samples.clear();
        yaw0 = ctx.player.player.yaw; pitch0 = ctx.player.player.pitch;
      }
      return true;
    },
    onMouseUp(button) { if (button === 0 && held) { held = false; release = true; } },
    tick() {
      // Switching away mid-sweep abandons it (no cut from a holstered rod).
      if (held && ctx.weapon.slotState.live !== 'rod') { held = false; samples.clear(); }
      if (held) {
        const eye = deps.eye(), dir = deps.aimDir();
        const h = deps.traceSlugHitFrom(eye, dir);
        if (h.actorId >= 0 && h.hit && Math.hypot(h.hit[0] - eye[0], h.hit[1] - eye[1], h.hit[2] - eye[2]) <= ROD.reach) {
          const list = samples.get(h.actorId) ?? [];
          if (list.length < ROD.maxSamples) list.push({ point: h.hit, view: dir });
          samples.set(h.actorId, list);
        }
      }
      if (release) { release = false; finishSweep(); }
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'rod');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999;
      // The swing follows the sweep while held; it eases back to rest otherwise.
      const dy = held ? ctx.player.player.yaw - yaw0 : 0, dp = held ? ctx.player.player.pitch - pitch0 : 0;
      pivot.rotation.z += (-dy * ROD.swingGain - pivot.rotation.z) * 0.35;
      pivot.rotation.x += (dp * ROD.swingGain - pivot.rotation.x) * 0.35;
    },
    cut(actorId, a, b, view, calibre) {
      const actor = ctx.world.actors.find(x => x.id === actorId);
      if (!actor) return 0;
      return cutActor(actor, [{ a, b, view }], { ...ROD_CALIBRE, ...calibre });
    },
    debug: () => ({ held, samples: [...samples.values()].reduce((m, l) => m + l.length, 0), lastCuts }),
  };
}
