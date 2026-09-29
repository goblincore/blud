// The juggernaut's PLATE ARMOUR through the real actor (plate-armor.ts,
// spec 2026-09-25-juggernaut-design.md "Damage"): rounds on an intact plate
// stamp nothing, a plate at zero lets the next one through, the helmet guards
// the head, pellets never stagger him, slugs do, and blasts wound through.
import { describe, expect, it } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob, compileFace } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import src from '../characters/juggernaut.blob?raw';
import { JUGGERNAUT_PROFILE } from '../motion-profile';
import { CHAINGUN_TUNING } from '../soldier-brain';
import { JUGGERNAUT_ARMOR } from '../plate-armor';
import { worldHitToWound } from '../damage';
import { makeSoldierMind } from './enemy-mind';
import { createZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import { sdBody } from '../validate';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const hp = (id: string) => JUGGERNAUT_ARMOR.plates.find(p => p.id === id)!.hp;

function jug() {
  const actor = createZombieActor({
    id: 1, room: 1, seed: 7, start: [0, 0, 0],
    bounds: { minX: -30, maxX: 30, minZ: -30, maxZ: 30 }, furniture: [],
    body,
    view: { setRootShift() {}, update() {}, setHeadRotation() {}, setTime() {} } as any,
    profile: JUGGERNAUT_PROFILE, mind: makeSoldierMind(CHAINGUN_TUNING),
    character: { wounds: undefined, releaseProp() {} } as any,
  });
  // The player BEHIND him: no aim, no fire, he stands still.
  const step = (n: number) => { for (let i = 0; i < n; i++) { actor.setBrainInput({ x: 0, z: -20, room: 9 }, false); actor.step(1 / 60); } };
  step(5);
  return { actor, step };
}
type J = ReturnType<typeof jug>;

let shotId = 5000;
const mid = (p: { a: Vec3; b: Vec3 }): Vec3 => [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
const primOn = (j: J, bone: string) => j.actor.posed().prims.find(p => p.bone === bone && p.op !== 'sub' && !p.shell)!;
/** The body's front SURFACE at `bone`'s first prim (the game's trace hands
 *  the actor a surface point, never a point in the air). */
/** `side` -1 = from behind: in the chaingun hold his left forearm crosses
 *  his chest to the top handle, so a frontal chest shot meets the gauntlet. */
function front(j: J, bone: string, side: 1 | -1 = 1): Vec3 {
  const c = mid(primOn(j, bone)), field = j.actor.posed();
  let z = 1.5 * side;
  for (let k = 0; k < 400; k++) { const d = sdBody([c[0], c[1], z], field); if (d < 0.001) break; z -= side * Math.max(d, 0.001); }
  return [c[0], c[1], z];
}
/** One single-pellet trigger pull at `bone`'s first prim. */
function pellet(j: J, bone: string, side: 1 | -1 = bone === 'chest' ? -1 : 1) {
  j.actor.beginHits();
  const w = j.actor.hit(front(j, bone, side), [0, 0, -side], { weapon: 'shotgun', shotId: ++shotId, barrels: 1, barrel: 0 });
  j.actor.endHits();
  return w;
}

describe('juggernaut plate armour (game actor)', () => {
  it('the cuirass stops every round until it breaks; the next one wounds the chest', () => {
    const j = jug();
    for (let i = 0; i < hp('cuirass'); i++) expect(pellet(j, 'chest'), `round ${i}`).toBeNull();
    expect(j.actor.wounds()).toHaveLength(0);
    const view = j.actor.armorView()!;
    expect(view.shed.has('cuirass')).toBe(true);
    expect(view.hits).toHaveLength(hp('cuirass'));
    expect(j.actor.armorView()!.hits).toHaveLength(0); // drained
    expect(pellet(j, 'chest')).not.toBeNull();
    expect(j.actor.wounds().length).toBeGreaterThan(0);
  });

  it('the helmet guards the head until it is shot off', () => {
    const j = jug();
    for (let i = 0; i < hp('helmet'); i++) expect(pellet(j, 'skull')).toBeNull();
    expect(j.actor.armorView()!.shed.has('helmet')).toBe(true);
    expect(pellet(j, 'skull')).not.toBeNull();
  });

  it('in the chaingun hold the left gauntlet shields his chest from the front', () => {
    const j = jug();
    j.actor.beginHits();
    expect(j.actor.hit(front(j, 'chest'), [0, 0, -1], { weapon: 'shotgun', shotId: ++shotId, barrels: 1, barrel: 0 })).toBeNull();
    j.actor.endHits();
  });

  it('the pelvis is bare: the weak spot wounds on the first round', () => {
    expect(pellet(jug(), 'pelvis')).not.toBeNull();
  });

  it('pellets never stagger him, even a dozen on bare flesh', () => {
    const j = jug();
    for (let i = 0; i < 12; i++) pellet(j, 'pelvis');
    j.step(3);
    expect(j.actor.debug().state).not.toBe('stagger');
    expect(j.actor.motionFrame()!.staggerKind).toBeNull();
  });

  it('a slug on armour is absorbed but still rocks him', () => {
    const j = jug();
    j.actor.beginHits();
    expect(j.actor.hitSlug(front(j, 'chest', -1), [0, 0, 1])).toBeNull();
    j.actor.endHits();
    j.step(2);
    expect(j.actor.debug().state).toBe('stagger');
    expect(j.actor.wounds()).toHaveLength(0);
  });

  it('a blast wounds straight through and cracks the plates it reaches', () => {
    const j = jug();
    const posed = j.actor.posed();
    const i = posed.prims.findIndex(p => p.bone === 'chest' && p.op !== 'sub' && !p.shell);
    const w = { ...worldHitToWound([posed.prims[i]!], mid(posed.prims[i]!), 0.13, 'blast'), primIdx: i, shot: { weapon: 'explosion' as const } };
    j.actor.stampBlast([w]);
    expect(j.actor.wounds().length).toBeGreaterThan(0);
    expect(j.actor.armorView()!.hits.length).toBe(1);
    // blastPlateDamage off the cuirass: the remaining rounds break it.
    const left = hp('cuirass') - JUGGERNAUT_ARMOR.blastPlateDamage;
    for (let k = 0; k < left; k++) expect(pellet(j, 'chest')).toBeNull();
    expect(j.actor.armorView()!.shed.has('cuirass')).toBe(true);
  });
});
