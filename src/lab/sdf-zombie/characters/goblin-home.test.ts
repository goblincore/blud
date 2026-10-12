// src/lab/sdf-zombie/characters/goblin-home.test.ts
//
// The goblin at home: goblin.blob plus a block of `shell` cloth (a vest, shorts). The file is a COPY, so a guard keeps the two in step:
// remove the home-clothes block and rename the model, and it must equal goblin.blob.
import { describe, it, expect } from 'vitest';
import goblinSrc from './goblin.blob?raw';
import homeSrc from './goblin-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig, applyRig } from '../rig-bind';
import { jointNamesForBody } from '../gait';
import { makePoseRig, poseJoints } from '../pose';
import { GOBLIN_POSES } from './goblin-poses';

const BEGIN = '  # --- home clothes begin ---', END = '  # --- home clothes end ---';

describe('goblin-home.blob', () => {
  it('is goblin.blob plus one marked cloth block (and its own model name)', () => {
    const a = homeSrc.indexOf(BEGIN), b = homeSrc.indexOf(END);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const stripped = homeSrc.slice(0, a) + homeSrc.slice(b + END.length + 1);
    expect(stripped.replace('model goblin-home', 'model goblin')).toBe(goblinSrc);
  });

  it('compiles and validates clean, at the same scale as the goblin', () => {
    const doc = parseBlob(homeSrc);
    expect(doc.scale).toBe(parseBlob(goblinSrc).scale);
    expect(buildBody(compileBlob(doc, compileFace(doc))).errors).toEqual([]);
  });

  it('the cloth is shells, few enough to stay cheap (a vest and shorts)', () => {
    const doc = parseBlob(homeSrc);
    const shells = doc.parts.filter(p => p.kind === 'shell');
    expect(shells.length).toBeGreaterThanOrEqual(2);
    expect(shells.length).toBeLessThanOrEqual(5);
    expect(shells.every(p => p.bone === 'spine1' || p.bone === 'chest' || p.bone === 'pelvis' || p.bone === 'thigh')).toBe(true);
  });

  it('stands on bare feet: the soles reach the floor (y 0) standing and in every standing or chair pose clip, seated included', () => {
    // goblin.blob's ankle is 0.157 m (authored) up and has no flesh foot (the kit's boots were the feet); the home block's feet reach down
    // from it. The pose layer holds the ankle at its rest height, so the sole must stay on the floor through every clip.
    const doc = parseBlob(homeSrc);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    const names = jointNamesForBody(body);
    const lowestFoot = (joints: readonly (readonly number[])[] | null) => {
      const bound = bindRig(body);
      if (joints) bound.rig.points = bound.rig.points.map((p, i) => ({ ...p, pos: joints[i] as never, prev: joints[i] as never }));
      const posed = joints ? applyRig(body, bound, 0) : body;
      let lo = Infinity;
      for (const p of posed.prims) {
        if (!p.bone || !/^(foot|shin)\.[lr]$/.test(p.bone)) continue;
        const r = Math.max(p.radius, p.radiusB ?? p.radius) * p.scale[1];
        lo = Math.min(lo, p.a[1] - r, p.b[1] - r);
      }
      return lo;
    };
    expect(Math.abs(lowestFoot(null))).toBeLessThan(0.005);
    const rig = makePoseRig(doc, names, bindRig(body).rig.restPose);
    // The FLOOR clips (lock off: he sits on a cushion at the kotatsu) are checked against the floor and the cushion in goblin-poses.test.ts.
    for (const clip of Object.values(GOBLIN_POSES).filter(c => !c.keys.every(k => k.groundLock === false))) {
      const end = clip.keys[clip.keys.length - 1]!.t;
      for (let k = 0; k <= 4; k++) expect(Math.abs(lowestFoot(poseJoints(rig, clip, (end * k) / 4))), `${clip.name} k=${k}`).toBeLessThan(0.005);
    }
  });
});
