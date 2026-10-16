// src/lab/sdf-zombie/characters/goblin-cinematic-home.test.ts
//
// The cinematic goblin at home (emergence in the Flat, plan Task 4): goblin-cinematic.blob (the face rig: jaw, mouth, morphs, the
// expression clips) plus goblin-home.blob's block of `shell` cloth (vest, shorts) and bare feet. The file is a COPY, so a guard keeps it in
// step with BOTH sources: remove the home-clothes block, put the cinematic's 1.30 m header back in place of the marked home-scale block, and
// rename the model, and it must equal goblin-cinematic.blob; and its home-clothes block must be goblin-home.blob's, line for line.
//
// THE SCALE. goblin-cinematic.blob is still authored AND built at 1.30 m (its kit and mesh teeth were built there), while goblin and
// goblin-home are the 1.70 m body (`scale 1.3077`). The screen emergence set and the Flat are fitted to the 1.70 m goblin (the seat measured
// off him, the Flat's kotatsu, the cushion), so the home variant carries the goblin's own header in a marked block.
import { describe, it, expect } from 'vitest';
import cinematicSrc from './goblin-cinematic.blob?raw';
import goblinSrc from './goblin.blob?raw';
import homeSrc from './goblin-home.blob?raw';
import src from './goblin-cinematic-home.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { bindRig, applyRig } from '../rig-bind';
import { jointNamesForBody } from '../gait';
import { makePoseRig, poseJoints } from '../pose';
import { GOBLIN_POSES } from './goblin-poses';

const BEGIN = '  # --- home clothes begin ---', END = '  # --- home clothes end ---';
const SCALE_BEGIN = '  # --- home scale begin ---', SCALE_END = '  # --- home scale end ---';
/** The marked block [begin, end] inclusive of its trailing newline. */
const block = (s: string, b: string, e: string) => {
  const i = s.indexOf(b), j = s.indexOf(e);
  return { i, j, end: j + e.length + 1, text: i >= 0 && j > i ? s.slice(i, j + e.length + 1) : '' };
};

describe('goblin-cinematic-home.blob', () => {
  it('is goblin-cinematic.blob plus goblin-home\'s cloth block, the goblin\'s 1.70 m header and its own model name', () => {
    const clothes = block(src, BEGIN, END);
    expect(clothes.i).toBeGreaterThan(0);
    expect(clothes.j).toBeGreaterThan(clothes.i);
    expect(clothes.text).toBe(block(homeSrc, BEGIN, END).text);
    let stripped = src.slice(0, clothes.i) + src.slice(clothes.end);
    const sc = block(stripped, SCALE_BEGIN, SCALE_END);
    expect(sc.i).toBeGreaterThan(0);
    stripped = stripped.slice(0, sc.i) + '  height 1.30\n' + stripped.slice(sc.end);
    expect(stripped.replace('model goblin-cinematic-home', 'model goblin-cinematic')).toBe(cinematicSrc);
  });

  it('compiles and validates clean, at the goblin\'s (and goblin-home\'s) 1.70 m scale', () => {
    const doc = parseBlob(src);
    expect(doc.scale).toBe(parseBlob(goblinSrc).scale);
    expect(doc.scale).toBe(parseBlob(homeSrc).scale);
    expect(doc.height).toBe(parseBlob(goblinSrc).height);
    expect(buildBody(compileBlob(doc, compileFace(doc))).errors).toEqual([]);
  });

  it('has the cinematic face rig (the jaw bone, morph words) and the cloth is 2-5 shells on the torso and thighs', () => {
    const doc = parseBlob(src);
    expect(doc.bones.some(b => b.name === 'jaw')).toBe(true);
    expect(doc.parts.some(p => (p as { morphs?: unknown[] }).morphs?.length)).toBe(true);
    const shells = doc.parts.filter(p => p.kind === 'shell');
    expect(shells.length).toBeGreaterThanOrEqual(2);
    expect(shells.length).toBeLessThanOrEqual(5);
    expect(shells.every(p => p.bone === 'spine1' || p.bone === 'chest' || p.bone === 'pelvis' || p.bone === 'thigh')).toBe(true);
  });

  it('stands on bare feet: the soles reach the floor (y 0) at rest and in every standing or chair pose clip', () => {
    const doc = parseBlob(src);
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
    for (const clip of Object.values(GOBLIN_POSES).filter(c => !c.keys.every(k => k.groundLock === false))) {
      const end = clip.keys[clip.keys.length - 1]!.t;
      for (let k = 0; k <= 4; k++) expect(Math.abs(lowestFoot(poseJoints(rig, clip, (end * k) / 4))), `${clip.name} k=${k}`).toBeLessThan(0.005);
    }
  });
});
