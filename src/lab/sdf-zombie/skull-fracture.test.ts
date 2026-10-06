import { describe, it, expect } from 'vitest';
import { damageSkull, explodeSkull, intactSkull, skullRayHit, skullPieceLaunch, type SkullPieceSurface } from './skull-fracture';
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
