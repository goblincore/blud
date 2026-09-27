// The warbull's MACHINERY PLATES through the real actor (plate-armor.ts
// WARBULL_ARMOR, spec 2026-09-27-warbull-design.md "Damage" and "Disarm"):
// rounds on the metal stamp nothing, rounds on the flesh around it wound at
// once (region plates), and shooting the launcher off DISARMS him.
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import src from '../characters/warbull.blob?raw';
import { WARBULL_PROFILE } from '../motion-profile';
import { ROCKET_TUNING } from '../soldier-brain';
import { WARBULL_ARMOR } from '../plate-armor';
import { STATUS_LIGHTS } from '../status-lights';
import { makeSoldierMind } from './enemy-mind';
import { createZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const hp = (id: string) => WARBULL_ARMOR.plates.find(p => p.id === id)!.hp;

function bull() {
  const actor = createZombieActor({
    id: 1, room: 1, seed: 7, start: [0, 0, 0],
    bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: WARBULL_PROFILE, mind: makeSoldierMind(ROCKET_TUNING),
    character: { wounds: undefined, releaseProp() {} } as any,
  });
  // The player BEHIND him: no aim, no fire, he stands still.
  const step = (n: number) => { for (let i = 0; i < n; i++) { actor.setBrainInput({ x: 0, z: -20, room: 9 }, false); actor.step(1 / 60); } };
  step(5);
  return { actor, step };
}
type B = ReturnType<typeof bull>;

let shotId = 9000;
/** Where a REST-body point is now: the nearest rest prim's rigid motion
 *  (its segment's translation plus the body yaw about the root), the
 *  inverse of plate-armor.ts restHitPoint for a prim that moved rigidly. */
function posedOf(b: B, restPt: Vec3): Vec3 {
  const posed = b.actor.posed();
  let best = 0, bd = Infinity;
  body.prims.forEach((p, i) => {
    if (p.op === 'sub' || p.shell) return;
    const m = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const d = Math.hypot(m[0]! - restPt[0], m[1]! - restPt[1], m[2]! - restPt[2]);
    if (d < bd) { bd = d; best = i; }
  });
  const r = body.prims[best]!, q = posed.prims[best]!;
  const { yaw } = b.actor.pose();
  // rest offset from the prim's a, carried by the prim's rotation: its
  // orient quat for a rigid head prim, else the body yaw.
  const o = [restPt[0] - r.a[0], restPt[1] - r.a[1], restPt[2] - r.a[2]] as [number, number, number];
  const orient = (q as { orient?: readonly number[] }).orient;
  if (orient) {
    const [x, y, z, w] = orient as [number, number, number, number];
    const t = [2 * (y * o[2] - z * o[1]), 2 * (z * o[0] - x * o[2]), 2 * (x * o[1] - y * o[0])];
    return [q.a[0] + o[0] + w * t[0]! + (y * t[2]! - z * t[1]!), q.a[1] + o[1] + w * t[1]! + (z * t[0]! - x * t[2]!), q.a[2] + o[2] + w * t[2]! + (x * t[1]! - y * t[0]!)];
  }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [q.a[0] + o[0] * c + o[2] * s, q.a[1] + o[1], q.a[2] - o[0] * s + o[2] * c];
}
/** The body's SURFACE along a horizontal ray through world (x, y), fired
 *  from in front (side 1, travelling -z) or behind (side -1): the point the
 *  game's trace would hand the actor. */
function surface(b: B, x: number, y: number, side: 1 | -1 = 1): Vec3 {
  const field = b.actor.posed();
  let z = 1.5 * side;
  for (let k = 0; k < 600; k++) { const d = sdBody([x, y, z], field); if (d < 0.001) break; z -= side * Math.max(d, 0.001); }
  expect(Math.abs(z)).toBeLessThan(1.5);
  return [x, y, z];
}
/** A pellet at the posed place of a REST-body point, from the front/back. */
function pelletAtRest(b: B, restPt: Vec3, side: 1 | -1 = 1) {
  const p = posedOf(b, restPt);
  return pelletAt(b, surface(b, p[0], p[1], side), side);
}
function pelletAt(b: B, p: Vec3, side: 1 | -1 = 1) {
  b.actor.beginHits();
  const w = b.actor.hit(p, [0, 0, -side], { weapon: 'shotgun', shotId: ++shotId, barrels: 1, barrel: 0 });
  b.actor.endHits();
  return w;
}
/** A pellet on the middle of a posed bone's first prim, fired from +z. */
function pelletOnBone(b: B, bone: string) {
  const prim = b.actor.posed().prims.find(p => p.bone === bone && p.op !== 'sub' && !p.shell)!;
  return pelletAt(b, surface(b, (prim.a[0] + prim.b[0]) / 2, (prim.a[1] + prim.b[1]) / 2));
}

describe('warbull machinery plates (game actor)', () => {
  it('the reactor stops rounds until it breaks; a pec beside it is flesh from the first round', () => {
    const b = bull();
    for (let i = 0; i < hp('reactor'); i++) expect(pelletAtRest(b, [0, 1.53, 0.36]), `round ${i}`).toBeNull();
    expect(b.actor.wounds()).toHaveLength(0);
    expect(b.actor.armorView()!.shed.has('reactor')).toBe(true);
    expect(pelletAtRest(b, [0, 1.53, 0.36])).not.toBeNull();
    const c = bull();
    expect(pelletAtRest(c, [0.14, 1.76, 0.3])).not.toBeNull();
  });

  it('the spine rack guards his back; the rack is not his chest', () => {
    const b = bull();
    expect(pelletAtRest(b, [0, 1.70, -0.38], -1)).toBeNull();
    expect(b.actor.armorView()!.shed.size).toBe(0);
  });

  it('the left side of the head is flesh; the optic side is steel', () => {
    const b = bull();
    // The left eye (the glowing bead) is flesh; the optic sits at its mirror.
    expect(pelletAtRest(b, [0.06, 2.22, 0.23])).not.toBeNull();
    const c = bull();
    expect(pelletAtRest(c, [-0.06, 2.22, 0.23])).toBeNull();
  });

  it('shooting the launcher off DISARMS him and turns his core red', () => {
    const b = bull();
    expect(b.actor.disarmed()).toBe(false);
    expect(b.actor.statusLights().coreRgb).toEqual(STATUS_LIGHTS.amber);
    for (let i = 0; i < hp('launcher'); i++) expect(pelletOnBone(b, 'forearm.r'), `round ${i}`).toBeNull();
    expect(b.actor.armorView()!.shed.has('launcher')).toBe(true);
    expect(b.actor.disarmed()).toBe(true);
    expect(b.actor.statusLights().coreRgb).toEqual(STATUS_LIGHTS.red);
    // With the casing gone the forearm is flesh.
    expect(pelletOnBone(b, 'forearm.r')).not.toBeNull();
  });

  it('his left arm is bare flesh: the first round wounds', () => {
    expect(pelletOnBone(bull(), 'upperarm.l')).not.toBeNull();
  });
});
