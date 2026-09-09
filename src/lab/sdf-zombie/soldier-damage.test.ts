import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import src from './characters/soldier.blob?raw';
import { worldHitToWound, type Wound } from './damage';
import { severDistal, severLimb } from './sever';
import { soldierInjury, soldierArmCutAllowed } from './soldier-damage';
import type { Vec3 } from './types';
import { lerp, add } from './vec';

const body = () => buildBody(compileBlob(parseBlob(src)));
function hit(b: ReturnType<typeof body>, bone: string, t: number, type: Wound['type'] = 'pellet'): Wound {
  const p = b.prims.find(p => p.bone === bone)!;
  const joint = b.bones.get(bone)!;
  const at: Vec3 = add(lerp(joint.head, joint.tail, t), [0, 0, p.radius]);
  return worldHitToWound(b.prims, at, type === 'blast' ? 0.16 : 0.055, type);
}

describe('soldier regional injury on authored anatomy', () => {
  it('a head pellet and slug survive; repeated head damage is fatal', () => {
    const b = body();
    expect(soldierInjury(b, [hit(b, 'skull', 0.5)]).fatal).toBe(false);
    expect(soldierInjury(b, Array(8).fill(hit(b, 'skull', 0.5))).fatal).toBe(false);
    expect(soldierInjury(b, Array(12).fill(hit(b, 'skull', 0.5))).fatal).toBe(true);
    expect(soldierInjury(b, [hit(b, 'skull', 0.5)]).sever).not.toContain('head');
    expect(soldierInjury(b, [hit(b, 'skull', 0.5, 'blast')])).toMatchObject({fatal: false, sever: []});
  });
  it('a grazed leg limps; eight focused pellets remove it despite identical carve coverage', () => {
    const b = body(), w = hit(b, 'thigh.l', 0.5);
    const grazed = soldierInjury(b, [w]);
    expect(grazed.wounded.legL).toBe(true);
    expect(grazed.legHurt).toBe(true);
    expect(grazed.fatal).toBe(false);
    expect(grazed.sever).toEqual([]);
    expect(soldierInjury(b, Array(6).fill(w))).toMatchObject({ downed: true, fatal: false, sever: [] });
    expect(soldierInjury(b, Array.from({ length: 8 }, () => ({ ...w }))).sever).toContain('legL');
    expect(soldierInjury(b, [w, w, hit(b, 'thigh.r', 0.5), hit(b, 'forearm.l', 0.5)]).sever).toEqual([]);
  });
  it.each([['pelvis', 'both'], ['thigh.l', 'L'], ['thigh.r', 'R']] as const)('tracks persistent mobility injury on authored %s', (bone, side) => {
    const b = body(), wound = hit(b, bone, .5);
    expect(b.prims[wound.primIdx]!.bone).toBe(bone);
    expect(soldierInjury(b, [wound])).toMatchObject({
      downed: false, fatal: false, mobilityInjury: { side, severity: 1 / 3 },
    });
    expect(soldierInjury(b, Array(4).fill(wound))).toMatchObject({
      downed: false, mobilityInjury: { side, severity: 1 },
    });
    expect(soldierInjury(b, Array(6).fill(wound)).downed).toBe(true);
  });
  it('does not label chest injury as pelvis damage; both injured thighs affect both sides', () => {
    const b = body();
    expect(soldierInjury(b, [hit(b, 'chest', .5)]).mobilityInjury).toBeUndefined();
    expect(soldierInjury(b, [hit(b, 'thigh.l', .5), hit(b, 'thigh.r', .5)]).mobilityInjury)
      .toEqual({ side: 'both', severity: 1 / 3 });
  });
  it.each([0, 1])('a single thigh joint slug at %i injures mobility before disabling support', t => {
    const b = body();
    const wound = hit(b, 'thigh.l', t, 'blast');
    expect(soldierInjury(b, [wound])).toMatchObject({ downed: false, fatal: false, sever: [] });
  });

  it('a single elbow or mid-thigh slug causes injury before severing', () => {
    const b = body();
    expect(soldierInjury(b, [hit(b, 'forearm.r', 0, 'blast')]).sever).toEqual([]);
    expect(soldierInjury(b, [hit(b, 'thigh.l', 0.5, 'blast')]).sever).toEqual([]);
  });
  it('requires a localized budget at the cut, not damage elsewhere on the arm', () => {
    const b = body(), elbow = b.bones.get('forearm.r')!.head;
    const near = hit(b, 'forearm.r', 0, 'blast');
    expect(soldierArmCutAllowed(b, [near], 'armR', elbow)).toBe(false);
    expect(soldierArmCutAllowed(b, [near, near], 'armR', elbow)).toBe(true);
    expect(soldierArmCutAllowed(b, Array(6).fill(hit(b, 'upperarm.r', .1)), 'armR', elbow)).toBe(false);
  });
  it('requires more scattered arm damage while retaining repeated focused damage', () => {
    const b = body(), focused = hit(b, 'forearm.r', .5);
    const scattered = ['upperarm.r', 'forearm.r'].flatMap(bone => [.05, .35, .65, .95].map(t => hit(b, bone, t)));
    expect(soldierInjury(b, scattered).sever).not.toContain('armR');
    expect(soldierInjury(b, [...scattered, ...scattered]).sever).toContain('armR');
    expect(soldierInjury(b, Array(8).fill(focused)).sever).toContain('armR');
  });
  it('a concentrated joint double volley needs both barrels of the same shot', () => {
    const b = body();
    const volley = Array.from({ length: 4 }, (_, i) => ({ ...hit(b, 'forearm.r', 0),
      shot: { weapon: 'shotgun' as const, shotId: 99, barrels: 2 as const, barrel: (i < 2 ? 0 : 1) as 0 | 1 } }));
    expect(soldierInjury(b, volley).sever).toContain('armR');
    expect(soldierInjury(b, volley.map(w => ({ ...w, shot: { ...w.shot, barrel: 0 as const } }))).sever).not.toContain('armR');
    expect(soldierInjury(b, volley.map((w, i) => ({ ...w, shot: { ...w.shot, shotId: i } }))).sever).not.toContain('armR');
  });

  it('recognizes a distal shin or forearm cut while its proximal cluster stays alive', () => {
    const b = body();
    for (const [limb, bone] of [['legL', 'shin.l'], ['armR', 'forearm.r']] as const) {
      const cut = severDistal(b, { limb, fromPrim: b.prims.findIndex(p => p.bone === bone) });
      expect(cut.body.clusters.find(c => c.limb === limb)!.alive).toBe(true);
      expect(soldierInjury(cut.body, []).missing[limb]).toBe(true);
      expect(soldierInjury(cut.body, []).downed).toBe(limb === 'legL');
      expect(soldierInjury(cut.body, []).fatal).toBe(false);
    }
  });
  it('survives a scattered body blast but repeated focused torso damage remains fatal', () => {
    const b = body(), wound = hit(b, 'chest', .5);
    expect(soldierInjury(b, Array(8).fill(wound)).fatal).toBe(false);
    expect(soldierInjury(b, Array(16).fill(wound)).fatal).toBe(false);
    expect(soldierInjury(b, Array(24).fill(wound)).fatal).toBe(true);
  });
  it('stump wounds cannot become a second injury in the remaining body', () => {
    const b = body(), cut = severLimb(b, 'armL');
    expect(cut.stumpWound!.injuryIgnored).toBe(true);
    expect(soldierInjury(cut.body, Array(8).fill(cut.stumpWound)).sever).toEqual([]);
    expect(soldierInjury(cut.body, Array(8).fill(cut.stumpWound)).fatal).toBe(false);
  });
});

it('full loss of either or both arms leaves a Soldier standing', () => {
  for (const limbs of [['armL'], ['armR'], ['armL', 'armR']] as const) {
    let b = body();
    for (const limb of limbs) b = severLimb(b, limb).body;
    expect(soldierInjury(b, [])).toMatchObject({fatal: false, downed: false});
  }
});

it('explicit explosion head injury retains its catastrophic outcome', () => {
  const b = body(), w = hit(b, 'skull', 0.5, 'blast');
  w.shot = { weapon: 'explosion' };
  expect(soldierInjury(b, [w])).toMatchObject({fatal: true, sever: ['head']});
});
