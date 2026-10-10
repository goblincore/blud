import { describe, it, expect } from 'vitest';
import { damageSkull, explodeSkull, intactSkull, skullRayCast, skullRayHit, skullPieceLaunch, type SkullPieceSurface } from './skull-fracture';
const plate = (id: string, z: number): SkullPieceSurface => ({ id,
  positions: [-.05,-.05,z, .05,-.05,z, 0,.05,z], indices: [0,1,2],
  min:[-.05,-.05,z], max:[.05,.05,z], pivot:[0,0,z] });
describe('anatomical skull fracture', () => {
  it('hits the first actual bone surface, skips missing pieces, and respects penetration', () => {
    const pieces = [plate('front', .05),plate('back', -.03)];
    expect(skullRayHit(pieces,intactSkull(2),[0,0,.1],[0,0,-1])).toBe(0);
    expect(skullRayHit(pieces,{missing:1,hits:[3,0]},[0,0,.1],[0,0,-1])).toBe(1);
    expect(skullRayHit(pieces,intactSkull(2),[0,0,.3],[0,0,-1])).toBeNull();
  });
  it('does not count the empty part of a bone bounding box as bone', () => {
    expect(skullRayHit([plate('rim',0)],intactSkull(1),[.045,.04,.1],[0,0,-1])).toBeNull();
    expect(skullRayHit([plate('rim',0)],intactSkull(1),[0,0,.1],[0,0,0])).toBeNull();
  });
  it('skullRayCast is the same hit with its distance, and skullRayHit its plate', () => {
    const pieces = [plate('front', .05),plate('back', -.03)];
    expect(skullRayCast(pieces,intactSkull(2),[0,0,.1],[0,0,-2])).toEqual({plate:0,distance:expect.closeTo(.05,12)});
    expect(skullRayCast(pieces,{missing:1,hits:[3,0]},[0,0,.1],[0,0,-1])).toEqual({plate:1,distance:expect.closeTo(.13,12)});
    expect(skullRayCast(pieces,intactSkull(2),[0,0,.3],[0,0,-1])).toBeNull();
    expect(skullRayCast(pieces,intactSkull(2),[0,0,.3],[0,0,-1],.3)).toEqual({plate:0,distance:expect.closeTo(.25,12)});
    for (const [origin,direction] of [[[0,0,.1],[0,0,-1]],[[.01,-.02,.12],[.05,.02,-1]],[[.045,.04,.1],[0,0,-1]],[[0,0,-.1],[0,0,1]]] as const)
      expect(skullRayHit(pieces,intactSkull(2),[...origin],[...direction])).toBe(skullRayCast(pieces,intactSkull(2),[...origin],[...direction])?.plate ?? null);
  });
  it('a hit the predicate refuses is skipped, and the ray carries on to the next surface', () => {
    const pieces = [plate('front', .05),plate('back', -.03)];
    const asked: [number,number][] = [];
    // Refuse whatever lies in front of z = 0: the front plate is not bone there.
    const behind = (point: readonly number[], index: number) => { asked.push([+point[2]!.toFixed(9),index]); return point[2]! < 0; };
    expect(skullRayCast(pieces,intactSkull(2),[0,0,.1],[0,0,-1],.14,behind)).toEqual({plate:1,distance:expect.closeTo(.13,12)});
    // It is asked about the hit POINT (origin + distance x the unit ray), with the plate.
    expect(asked).toEqual([[.05,0],[-.03,1]]);
    // A refused hit does not shorten the reach either: the far plate is found from the other side, past a refused near one.
    expect(skullRayCast(pieces,intactSkull(2),[0,0,-.1],[0,0,3],.2,p=>p[2]! > 0)).toEqual({plate:0,distance:expect.closeTo(.15,12)});
    // Everything refused: no bone. Everything accepted: the plain test.
    expect(skullRayCast(pieces,intactSkull(2),[0,0,.1],[0,0,-1],.14,()=>false)).toBeNull();
    expect(skullRayCast(pieces,intactSkull(2),[0,0,.1],[0,0,-1],.14,()=>true)).toEqual(skullRayCast(pieces,intactSkull(2),[0,0,.1],[0,0,-1]));
  });
  it('accumulates pellets, detaches once, and isolates actors', () => {
    const original = intactSkull(2);
    let result = damageSkull(original,0,'pellet');
    expect(result.detached).toEqual([]);
    result = damageSkull(result.state,0,'pellet');
    expect(result.detached).toEqual([]);
    result = damageSkull(result.state,0,'pellet');
    expect(result.detached).toEqual([0]);
    expect(damageSkull(result.state,0,'slug').detached).toEqual([]);
    expect(original).toEqual({missing:0,hits:[0,0]});
  });
  it('a slug detaches the hit plate; explosion detaches the rest exactly once', () => {
    const slug = damageSkull(intactSkull(3),1,'slug');
    expect(slug.detached).toEqual([1]);
    const burst = explodeSkull(slug.state);
    expect(burst.detached).toEqual([0,2]);
    expect(burst.state.missing).toBe(7);
    expect(explodeSkull(burst.state).detached).toEqual([]);
  });
  it('launches outward with deterministic, finite tumble', () => {
    const a = skullPieceLaunch([.03,0,0],[0,0,0],[0,0,-1],2);
    expect(a).toEqual(skullPieceLaunch([.03,0,0],[0,0,0],[0,0,-1],2));
    expect(a.velocity[0]).toBeGreaterThan(0);
    expect(a.velocity[2]).toBeLessThan(0);
    expect(skullPieceLaunch([0,0,0],[0,0,0],[0,0,0],0).velocity.every(Number.isFinite)).toBe(true);
  });
});
