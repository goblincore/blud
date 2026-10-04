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
import { rotateYaw } from '../gait';
import { loopBlocksInput } from './game-loop-leaves';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { CUT, ROD_CALIBRE, cutsFromSweep, stampCut, type CutCalibre, type CutSeg, type SweepSample } from '../cut-wound';

export const ROD = {
  /** Only hits within this of the eye count (a melee reach). The trace is traceSlugHitFrom, which ignores level
   *  geometry within this reach (as the flare's does): a wall between the eye and a body does not block the rod. */
  reach: 2.2,
  /** Rest pose in view (m), the swing's radians of rod rotation per radian of sweep, and the sweep angle clamp (rad). */
  rest: new THREE.Vector3(0.12, -0.16, -0.36),
  swingGain: 1.6,
  swingClamp: 0.6,
  /** Swing easing rate (1/s): 1 - exp(-rate dt), 0.35 per frame at 60 fps. */
  swingRate: 26,
  /** Sweep samples kept per body (one per frame). */
  maxSamples: 90,
  /** A held sweep finishes on its own after this (s). */
  maxHoldS: 2,
} as const;

/** A sweep sample in the body's own frame (so a body that moves between the sweep and the release is still cut where the
 *  blade crossed it) and the frame it was taken on (non-adjacent frames are separate passes). */
interface LocalSample { frame: number; point: Vec3; view: Vec3 }

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
  // No envMap here (the flail's PMREM room is private to its closure and a generator per weapon is not free), so a
  // high metalness would read near black in forward mode: a mid metalness and rougher steel instead.
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.3 });
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
  let heldS = 0, frameNo = 0, lastDt = 1 / 60;
  /** Per body: its runs of consecutive-frame samples, in the body's frame. */
  const runs = new Map<number, LocalSample[][]>();
  let lastCuts = 0;

  /** The rod may act: it is the live slot, settled (not lowering / raising) and the loop is not blocking input. */
  const armed = () => ctx.weapon.slotState.live === 'rod' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
  const abandon = () => { held = false; release = false; runs.clear(); };
  // A button released outside the window or with the lock lost never reaches us: do not stay held (the flail's resets).
  window.addEventListener('blur', abandon);
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== ctx.boot.canvas) abandon();
  });

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
      deps.bleed(a, wounds[i]!, mid, s.view);
    }
    return wounds.length;
  }

  function finishSweep(): void {
    let n = 0;
    for (const [id, list] of runs) {
      const a = ctx.world.actors.find(x => x.id === id);
      if (!a) continue;
      // Back to world through the body's CURRENT pose; each run is its own sweep (a gap is two passes, never one chord).
      const { pos, yaw } = a.pose();
      const prims = a.posed().prims;
      const segs = list.flatMap(run => cutsFromSweep(prims, run.map((s): SweepSample => {
        const p = rotateYaw(s.point, yaw), v = rotateYaw(s.view, yaw);
        return { point: [pos[0] + p[0], pos[1] + p[1], pos[2] + p[2]], view: v };
      }))).slice(0, CUT.maxPerSlash);
      n += cutActor(a, segs, ROD_CALIBRE);
    }
    runs.clear();
    lastCuts = n;
    if (n) ctx.telemetry.telemetry.event('rod-cut', { cuts: n });
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'rod') return false;
      if (button === 0 && armed()) {
        held = true; heldS = 0; runs.clear();
        yaw0 = ctx.player.player.yaw; pitch0 = ctx.player.player.pitch;
      }
      return true;
    },
    onMouseUp(button) { if (button === 0 && held) { held = false; release = true; } },
    tick(dt) {
      lastDt = dt > 0 ? dt : 1 / 60;
      frameNo++;
      // Switching away (lowering counts: `live` flips only when it ends), the loop blocking input: the sweep is gone.
      if (held && !armed()) { held = false; runs.clear(); }
      if (held) {
        heldS += lastDt;
        const eye = deps.eye(), dir = deps.aimDir();
        const h = deps.traceSlugHitFrom(eye, dir);
        const a = h.actorId >= 0 && h.hit && Math.hypot(h.hit[0] - eye[0], h.hit[1] - eye[1], h.hit[2] - eye[2]) <= ROD.reach
          ? ctx.world.actors.find(x => x.id === h.actorId) : undefined;
        if (a && h.hit) {
          const { pos, yaw } = a.pose();
          const rel: Vec3 = [h.hit[0] - pos[0], h.hit[1] - pos[1], h.hit[2] - pos[2]];
          const list = runs.get(a.id) ?? [];
          if (list.reduce((m, r) => m + r.length, 0) < ROD.maxSamples) {
            let run = list[list.length - 1];
            if (!run || run[run.length - 1]!.frame !== frameNo - 1) { run = []; list.push(run); }
            run.push({ frame: frameNo, point: rotateYaw(rel, -yaw), view: rotateYaw(dir, -yaw) });
          }
          runs.set(a.id, list);
        }
        if (heldS >= ROD.maxHoldS) { held = false; release = true; }
      }
      if (release) {
        release = false;
        if (armed()) finishSweep(); else runs.clear();
      }
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'rod');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999;
      // The swing follows the sweep while held; it eases back to rest otherwise.
      const clamp = (v: number) => Math.max(-ROD.swingClamp, Math.min(ROD.swingClamp, v));
      const dy = held ? clamp(ctx.player.player.yaw - yaw0) : 0, dp = held ? clamp(ctx.player.player.pitch - pitch0) : 0;
      const k = 1 - Math.exp(-ROD.swingRate * lastDt);
      pivot.rotation.z += (-dy * ROD.swingGain - pivot.rotation.z) * k;
      pivot.rotation.x += (dp * ROD.swingGain - pivot.rotation.x) * k;
    },
    cut(actorId, a, b, view, calibre) {
      const actor = ctx.world.actors.find(x => x.id === actorId);
      if (!actor) return 0;
      lastCuts = cutActor(actor, [{ a, b, view }], { ...ROD_CALIBRE, ...calibre });
      return lastCuts;
    },
    debug: () => ({ held, samples: [...runs.values()].reduce((m, l) => m + l.reduce((k, r) => k + r.length, 0), 0), lastCuts }),
  };
}
