// src/lab/sdf-zombie/webgpu/game-tesla.ts
//
// WEAPON SLOT 9: THE TESLA ARC'S DEV HARNESS (spec 2026-11-17-tesla-arc-design.md).
//
// A placeholder primitive in hand and ONE verb, in the melter's mould (game-melter.ts): while fire is
// held, the body under the crosshair is zapped (game-zap.ts zapActor), and stays zapped while the aim
// stays near it (tesla-stick.ts). No projectile, no wound. Plan 2 draws the arc between this prop and
// the body; until then there is nothing to see between them.
//
// THE ARC IS RE-DERIVED EVERY TICK. The actor's setArc is sticky (it holds until changed), so this
// harness is the only thing that turns it off. `tick` therefore asks from scratch whether the arc
// should be on a body (fire held, slot 9 live and settled, input not blocked, no demo replaying, the
// body still in the world, zappable, in reach and in sight) and drops the target in every other case;
// nothing here relies on an event arriving.
//
// DEMOS: like the flare's, the rod's and the melter's, this input bypasses the demo recording seam: a
// recorded demo does not replay the zap, and a replay drops the arc.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { zapActor } from './game-zap';
import { arcSticks, TESLA } from './tesla-stick';
import { loopBlocksInput } from './game-loop';
import { slotLowerAmount, slotReady } from './game-weapon-slots';

const TESLA_REST = new THREE.Vector3(0.11, -0.13, -0.42);
/** The centre of a body with no live cluster to read: this far over its feet (m). */
const FALLBACK_CENTRE_M = 1.0;

export interface TeslaHarnessDeps {
  /** A STRAIGHT ray from `origin` along `dir`, capped at `reach` (game-hit-trace's traceMeleeHitFrom): the nearest
   *  body hit, if any. Bodies only: level geometry does not stop it (sightBlocked does that). An arc does not drop
   *  like a slug, so this is not the ballistic march the melter and the flare use. */
  trace(origin: Vec3, dir: Vec3, reach: number): { actorId: number; hit: Vec3 | null };
  /** Is the straight line a → b blocked by level geometry (collider boxes, sector walls)? */
  sightBlocked(a: Vec3, b: Vec3): boolean;
  eye(): Vec3;
  aimDir(): Vec3;
}

export interface TeslaHarness {
  /** A mousedown while slot 9 is live. True = consumed. */
  onMouseDown(button: number): boolean;
  onMouseUp(button: number): void;
  /** Once a tick, on the player's clock, whatever the live slot: finds, holds or drops the target. */
  tick(dt: number): void;
  /** Holster travel, from the same slot state the other rigs read. */
  updateRig(): void;
  /** Hold or release fire (console seam). */
  fire(on: boolean): void;
  /** The body the arc is on, or null. */
  target(): ZombieActor | null;
  /** Fire held, and the id of the body the arc is on (-1: none). Debug / the trace. */
  debug(): { held: boolean; target: number };
  /** Drop the arc and remove the window / document listeners (tests; a teardown). */
  dispose(): void;
}

/** Where the arc aims on `a`: its torso cluster's posed centre, else any live cluster's (a body with no torso left),
 *  else a point over its feet. Read from the posed body, so a short or four-legged body gives its own centre. */
export function teslaCentre(a: ZombieActor): Vec3 {
  const clusters = a.posed().clusters;
  const c = clusters.find(cc => cc.limb === 'torso' && cc.alive) ?? clusters.find(cc => cc.alive);
  if (c) return c.center;
  const p = a.pose().pos;
  return [p[0], p[1] + FALLBACK_CENTRE_M, p[2]];
}

export function createTeslaHarness(ctx: GameContext, deps: TeslaHarnessDeps): TeslaHarness {
  const rig = new THREE.Group();
  rig.name = 'tesla-rig';
  ctx.weapon.aimRig!.add(rig);
  let held = false;
  let target: ZombieActor | null = null;

  // THE PLACEHOLDER PROP: a stubby coil on a grip, a glowing ball on its tip. Primitives only, so there
  // is no asset to be missing; the real weapon replaces this whole group.
  const prop = new THREE.Group();
  prop.name = 'tesla-placeholder';
  {
    const body = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.55, metalness: 0.6 });
    // No envMap here (game-rod.ts): a high metalness would read near black, so the copper is mid-metal.
    const copper = new THREE.MeshStandardMaterial({ color: 0xb8632c, roughness: 0.4, metalness: 0.45 });
    const spark = new THREE.MeshStandardMaterial({
      color: 0xcfe4ff, roughness: 0.2, metalness: 0, emissive: 0x6fa8ff, emissiveIntensity: 1.6,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.2, 14), body);
    core.rotation.x = Math.PI / 2;             // cylinder axis → view -Z
    core.position.set(0, 0, -0.06);
    for (let i = 0; i < 5; i++) {
      // A torus lies in its own XY plane, so its axis is already the view's Z: the rings wrap the core.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 18), copper);
      ring.position.set(0, 0, -0.01 - i * 0.03);
      prop.add(ring);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), spark);
    ball.position.set(0, 0, -0.18);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.1, 0.045), body);
    grip.position.set(0, -0.07, 0.04);
    grip.rotation.x = THREE.MathUtils.degToRad(-18);
    prop.add(core, ball, grip);
  }
  prop.position.copy(TESLA_REST);
  rig.add(prop);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  /** The only place the arc comes off a body. Safe on a body that left the world (setArc on it changes nothing seen). */
  const drop = () => { if (target) { target.setArc(false); target = null; } };
  /** May the arc be on anything this tick? Slot 9 live and settled (lowering counts as away: `live` flips only when
   *  it ends), fire held, the loop not blocking input (dead / done / a sequence), no demo replaying. */
  const wanted = () => held && ctx.weapon.slotState.live === 'tesla' && slotReady(ctx.weapon.slotState)
    && !loopBlocksInput(ctx) && !ctx.demo.replayActive;
  // A button released outside the window, or with the pointer lock or the focus lost, never reaches onMouseUp: do
  // not stay held (the rod's and the flail's resets). The next tick drops the target.
  const release = () => { held = false; };
  const onLockChange = () => { if (document.pointerLockElement !== ctx.boot.canvas) release(); };
  window.addEventListener('blur', release);
  document.addEventListener('pointerlockchange', onLockChange);

  /** Does the arc stay on `t`? `hit` is this tick's trace down the aim. Geometry first, then the body's own word
   *  (beginZap: true on a body already zapping, false for a statue, a corpse, a melt, a tear, a body going down). */
  function holds(t: ZombieActor, eye: Vec3, aim: Vec3, hit: { actorId: number; hit: Vec3 | null }): boolean {
    if (!ctx.world.actors.includes(t)) return false;                 // gibbed, culled, a new cast, a new level
    if (ctx.gibs.pendingGibs.some(q => q.actor === t)) return false; // about to be pieces
    // The crosshair is on the body itself (inside the trace's reach), with no wall before the point it touches...
    const direct = hit.actorId === t.id && hit.hit !== null && !deps.sightBlocked(eye, hit.hit);
    if (!direct) {
      // ...or it has wandered off the flesh but is still near the body's centre, which the eye can still see: no
      // other body nearer along the line to it, and no level geometry across it.
      const centre = teslaCentre(t);
      if (!arcSticks(eye, aim, centre)) return false;
      const d: Vec3 = [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l > 1e-3) {
        const first = deps.trace(eye, [d[0] / l, d[1] / l, d[2] / l], l);
        if (first.actorId >= 0 && first.actorId !== t.id) return false;
        if (deps.sightBlocked(eye, centre)) return false;
      }
    }
    return t.beginZap();
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'tesla') return false;
      if (button === 0) held = true;
      return true;
    },
    onMouseUp(button) { if (button === 0) held = false; },
    tick() {
      if (!wanted()) { drop(); return; }
      ctx.weapon.shotAlert = true;   // it is still a weapon: the arc turns heads (a flag the director clears each tick)
      const eye = deps.eye(), aim = deps.aimDir();
      const hit = deps.trace(eye, aim, TESLA.rangeM);
      if (target) {
        if (holds(target, eye, aim, hit)) { target.setArc(true); return; }
        drop();
      }
      // A new target: the body under the crosshair, within reach, with no wall in front of it.
      if (hit.actorId < 0 || !hit.hit || deps.sightBlocked(eye, hit.hit)) return;
      const a = ctx.world.actors.find(x => x.id === hit.actorId);
      if (a && zapActor(ctx, a)) {
        target = a;
        ctx.telemetry.telemetry.event('tesla-arc', { actorId: a.id });
      }
    },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'tesla');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999;
    },
    fire(on) { held = on; },
    target: () => target,
    debug: () => ({ held, target: target ? target.id : -1 }),
    dispose() {
      drop();
      held = false;
      window.removeEventListener('blur', release);
      document.removeEventListener('pointerlockchange', onLockChange);
    },
  };
}
