import { describe, expect, it } from 'vitest';
import { buildBody } from './build-body';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import src from './characters/soldier.blob?raw';
import { worldHitToWound, type Wound } from './damage';
import { severDistal, severLimb } from './sever';
import { soldierInjury } from './soldier-damage';
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
  it('a head pellet is fatal without removing the head; a heavy head hit detaches it', () => {
    const b = body();
    expect(soldierInjury(b, [hit(b, 'skull', 0.5)]).fatal).toBe(true);
    expect(soldierInjury(b, [hit(b, 'skull', 0.5)]).sever).not.toContain('head');
    expect(soldierInjury(b, [hit(b, 'skull', 0.5, 'blast')]).sever).toContain('head');
  });
  it('a grazed leg limps; four focused pellets remove it despite identical carve coverage', () => {
    const b = body(), w = hit(b, 'thigh.l', 0.5);
    const grazed = soldierInjury(b, [w]);
    expect(grazed.wounded.legL).toBe(true);
    expect(grazed.legHurt).toBe(true);
    expect(grazed.fatal).toBe(false);
    expect(grazed.sever).toEqual([]);
    expect(soldierInjury(b, Array.from({ length: 4 }, () => ({ ...w }))).sever).toContain('legL');
    expect(soldierInjury(b, [w, w, hit(b, 'thigh.r', 0.5), hit(b, 'forearm.l', 0.5)]).sever).toEqual([]);
  });
  it('a heavy elbow hit cuts the arm while a mid-thigh slug causes injury first', () => {
    const b = body();
    expect(soldierInjury(b, [hit(b, 'forearm.r', 0, 'blast')]).sever).toContain('armR');
    expect(soldierInjury(b, [hit(b, 'thigh.l', 0.5, 'blast')]).sever).toEqual([]);
  });
  it('recognizes a distal shin or forearm cut while its proximal cluster stays alive', () => {
    const b = body();
    for (const [limb, bone] of [['legL', 'shin.l'], ['armR', 'forearm.r']] as const) {
      const cut = severDistal(b, { limb, fromPrim: b.prims.findIndex(p => p.bone === bone) });
      expect(cut.body.clusters.find(c => c.limb === limb)!.alive).toBe(true);
      expect(soldierInjury(cut.body, []).missing[limb]).toBe(true);
      expect(soldierInjury(cut.body, []).fatal).toBe(limb === 'legL');
    }
  });
  it('stump wounds cannot become a second injury in the remaining body', () => {
    const b = body(), cut = severLimb(b, 'armL');
    expect(cut.stumpWound!.injuryIgnored).toBe(true);
    expect(soldierInjury(cut.body, Array(8).fill(cut.stumpWound)).sever).toEqual([]);
    expect(soldierInjury(cut.body, Array(8).fill(cut.stumpWound)).fatal).toBe(false);
  });
});
