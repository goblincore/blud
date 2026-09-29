// The warbull through the real actor (spec 2026-09-27-warbull-design.md):
// the launcher is his one plate and shooting it off DISARMS him; the bull
// charge (charge.ts) through the warbull mind; the brawl once disarmed.
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import src from '../characters/warbull.blob?raw';
import { WARBULL_PROFILE } from '../motion-profile';
import { ROCKET_TUNING } from '../soldier-brain';
import { WARBULL_ARMOR } from '../plate-armor';
import { STATUS_LIGHTS } from '../status-lights';
import { makeSoldierMind, makeWarbullMind } from './enemy-mind';
import { CHARGE } from '../charge';
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
  it('his chest is flesh from the first round (only the launcher is a plate)', () => {
    const b = bull();
    expect(pelletAtRest(b, [0, 1.55, 0.25])).not.toBeNull();
    expect(b.actor.armorView()!.hits).toHaveLength(0);
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

describe('warbull charge (game actor, warbull mind)', () => {
  function charger(playerZ: number) {
    const contacts: string[] = [];
    const fired = { n: 0 };
    const actor = createZombieActor({
      id: 2, room: 1, seed: 11, start: [0, 0, 0],
      bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
      body,
      view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
      profile: WARBULL_PROFILE, mind: makeWarbullMind(ROCKET_TUNING),
      character: { wounds: undefined, releaseProp() {} } as any,
      onMeleeContact: ({ variant }) => contacts.push(variant),
      onFire: () => { fired.n++; },
    });
    const states: string[] = [], pos: number[] = [];
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        actor.setBrainInput({ x: 0, z: playerZ, room: 1 }, true);
        actor.step(1 / 60);
        states.push(actor.debug().state); pos.push(actor.pose().pos[2]);
      }
    };
    return { actor, step, states, pos, contacts, fired };
  }

  it('a player who closes in gets charged: windup, a real run, one hit', () => {
    const c = charger(3.8);
    c.step(60 * 6);
    const w = c.states.indexOf('windup'), r = c.states.indexOf('charge');
    expect(w).toBeGreaterThanOrEqual(0);
    expect(r).toBeGreaterThan(w);
    // The run is a RUN: over some 0.25 s of it the root covers >= 2 m/s.
    let best = 0;
    for (let i = r; i + 15 < c.states.length && c.states[i + 15] === 'charge'; i++) best = Math.max(best, (c.pos[i + 15]! - c.pos[i]!) / 0.25);
    expect(best).toBeGreaterThan(2);
    expect(best).toBeLessThan(CHARGE.speed * 1.3);
    expect(c.contacts.length).toBeGreaterThanOrEqual(1);
    expect(c.contacts[0]).toBe('shove');
  });

  it('armed, a player out at rocket range is shelled, not charged', () => {
    const c = charger(8);
    c.step(60 * 4);
    expect(c.states).not.toContain('charge');
  });

  it('disarmed, he brawls: closes in and swings, claiming melee tokens, and never fires', () => {
    const c = charger(1.6);
    c.step(5);
    for (let i = 0; i < hp('launcher'); i++) {
      const prim = c.actor.posed().prims.find(p => p.bone === 'forearm.r' && p.op !== 'sub' && !p.shell)!;
      const x = (prim.a[0] + prim.b[0]) / 2, y = (prim.a[1] + prim.b[1]) / 2;
      let z = 3, field = c.actor.posed();
      for (let k = 0; k < 600; k++) { const d = sdBody([x, y, z], field); if (d < 0.001) break; z -= Math.max(d, 0.001); }
      c.actor.beginHits(); c.actor.hit([x, y, z], [0, 0, -1], { weapon: 'shotgun', shotId: ++shotId, barrels: 1, barrel: 0 }); c.actor.endHits();
    }
    expect(c.actor.disarmed()).toBe(true);
    c.actor.setRingInput(true, 0);
    const firedBefore = c.fired.n;
    for (let i = 0; i < 60 * 4; i++) { c.actor.setRingInput(true, 0); c.step(1); }
    expect(c.actor.mind().meleeCapable).toBe(true);
    expect(c.states.slice(-60 * 4)).toContain('attack');
    expect(c.contacts).toContain('hook');
    expect(c.fired.n).toBe(firedBefore);
  });
});
