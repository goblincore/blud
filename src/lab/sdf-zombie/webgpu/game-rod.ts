// src/lab/sdf-zombie/webgpu/game-rod.ts
//
// WEAPON SLOT 6: THE ROD (cut wounds M1, spec docs/superpowers/specs/2026-10-03-cut-wounds-design.md §5). A stand-in blade:
// hold the left button and sweep the crosshair across a body; the rod swings with the sweep; on release the sweep's hits
// on each body become cut wounds (cut-wound.ts cutsFromSweep → stampCut). The real axe / sword / chainsaw call the same
// `cut`. Built like the flare harness (game-flare.ts): its own rig on aimRig, edges consumed by the tick.
//
// DEMOS: rod input (press / release / the sweep samples) bypasses the input-frame / demo recording seam, as the flare's and
// the flail's do: a recorded demo does not replay the rod's cuts.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import { rotateYaw } from '../gait';
import { loopBlocksInput } from './game-loop-leaves';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import { CUT, ROD_CALIBRE, cutsFromSweep, stampCut, unwarpCutSeg, type CutCalibre, type CutSeg, type SweepSample } from '../cut-wound';

export const ROD = {
  /** Only hits within this of the eye count (a melee reach). The trace is a straight ray capped at it (traceMeleeHitFrom),
   *  which ignores level geometry (as the flare's trace does): a wall between the eye and a body does not block the rod. */
  reach: 2.2,
  /** Rest pose in view (m), the swing's radians of rod rotation per radian of sweep, and the sweep angle clamp (rad). */
  rest: new THREE.Vector3(0.12, -0.16, -0.36),
  swingGain: 1.6,
  swingClamp: 0.6,
  /** Swing easing rate (1/s): 1 - exp(-rate dt), 0.35 per frame at 60 fps. */
  swingRate: 26,
  /** Sweep samples are kept at least this far apart in TIME (s), per body: 1/64 s keeps every frame up to 60 fps and every
   *  other frame at 120 fps, so a whole maxHoldS hold is ~128 samples at any frame rate (a frame-counted cap covered only
   *  1.5 s at 60 fps and 0.75 s at 120). */
  sampleSpacingS: 1 / 64,
  /** Safety cap on the samples kept per body: sampleSpacingS keeps a full hold (maxHoldS / sampleSpacingS = 128) under it. */
  maxSamples: 140,
  /** A gap in a body's samples longer than this (s) starts a new pass: one missed frame at 60 fps is slack, two or more
   *  (2.5 / 60) is not. In time, so it does not depend on the frame rate. */
  passGapS: 2.5 / 60,
  /** A held sweep finishes on its own after this (s). */
  maxHoldS: 2,
} as const;

/** A sweep sample in the body's own frame (so a body that moves between the sweep and the release is still cut where the
 *  blade crossed it) and the sweep-clock time it was taken at (a long gap is a separate pass). */
interface LocalSample { t: number; point: Vec3; view: Vec3 }

export interface RodDeps {
  /** A STRAIGHT ray from `origin` along `dir`, capped at `reach` (traceMeleeHitFrom): the nearest body hit, if any. */
  traceMelee(origin: Vec3, dir: Vec3, reach: number): { actorId: number; hit: Vec3 | null };
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
  /** Remove the window / document listeners (tests; a teardown). */
  dispose(): void;
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
  let heldS = 0, lastDt = 1 / 60;
  /** Per body: its runs of consecutive-frame samples, in the body's frame. */
  const runs = new Map<number, LocalSample[][]>();
  let lastCuts = 0;

  /** The rod may act: it is the live slot, settled (not lowering / raising) and the loop is not blocking input. */
  const armed = () => ctx.weapon.slotState.live === 'rod' && slotReady(ctx.weapon.slotState) && !loopBlocksInput(ctx);
  const abandon = () => { held = false; release = false; runs.clear(); };
  // A button released outside the window or with the lock lost never reaches us: do not stay held (the flail's resets).
  const onLockChange = () => { if (document.pointerLockElement !== ctx.boot.canvas) abandon(); };
  window.addEventListener('blur', abandon);
  document.addEventListener('pointerlockchange', onLockChange);

  function cutActor(a: ZombieActor, segs: CutSeg[], calibre: CutCalibre): number {
    if (!segs.length) return 0;
    const posed = a.posed();
    const yaw = a.pose().yaw;
    // Each segment is stamped in the un-warped head (cut-wound.ts unwarpCutSeg); the blood below keeps the world segment.
    const wounds = segs.map((s) => {
      const u = unwarpCutSeg(posed, s);
      return stampCut(posed.prims, u.seg, calibre, yaw, u.field);
    });
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
      // The per-slash cap keeps the LONGEST segments across runs (cutsFromSweep's own rule, which only sees one run), in
      // sweep order.
      const cands: { seg: CutSeg; len: number; order: number }[] = [];
      for (const run of list) {
        for (const seg of cutsFromSweep(prims, run.map((s): SweepSample => {
          const p = rotateYaw(s.point, yaw), v = rotateYaw(s.view, yaw);
          return { point: [pos[0] + p[0], pos[1] + p[1], pos[2] + p[2]], view: v };
        }))) cands.push({ seg, len: Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1], seg.b[2] - seg.a[2]), order: cands.length });
      }
      const segs = cands.sort((x, y) => y.len - x.len).slice(0, CUT.maxPerSlash).sort((x, y) => x.order - y.order).map(c => c.seg);
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
      // Switching away (lowering counts: `live` flips only when it ends), the loop blocking input: the sweep is gone.
      if (held && !armed()) { held = false; runs.clear(); }
      if (held) {
        heldS += lastDt;
        const eye = deps.eye(), dir = deps.aimDir();
        const h = deps.traceMelee(eye, dir, ROD.reach);
        const a = h.actorId >= 0 && h.hit ? ctx.world.actors.find(x => x.id === h.actorId) : undefined;
        if (a && h.hit) {
          const { pos, yaw } = a.pose();
          const rel: Vec3 = [h.hit[0] - pos[0], h.hit[1] - pos[1], h.hit[2] - pos[2]];
          const list = runs.get(a.id) ?? [];
          let run = list[list.length - 1];
          const last = run?.[run.length - 1];
          // Time-spaced, not per frame (ROD.sampleSpacingS); the safety cap counts across passes.
          if ((!last || heldS - last.t >= ROD.sampleSpacingS) && list.reduce((m, r) => m + r.length, 0) < ROD.maxSamples) {
            // One missed frame is slack (a crosshair jitter off a thin limb); a longer gap is a new pass.
            if (!run || heldS - last!.t > ROD.passGapS) { run = []; list.push(run); }
            run.push({ t: heldS, point: rotateYaw(rel, -yaw), view: rotateYaw(dir, -yaw) });
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
      // An explicit `undefined` field must not overwrite a default (it would reach the stamp as NaN).
      const set = Object.fromEntries(Object.entries(calibre ?? {}).filter(([, v]) => v !== undefined));
      lastCuts = cutActor(actor, [{ a, b, view }], { ...ROD_CALIBRE, ...set });
      return lastCuts;
    },
    dispose() {
      window.removeEventListener('blur', abandon);
      document.removeEventListener('pointerlockchange', onLockChange);
    },
    debug: () => ({ held, samples: [...runs.values()].reduce((m, l) => m + l.reduce((k, r) => k + r.length, 0), 0), lastCuts }),
  };
}
