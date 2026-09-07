import { describe, expect, it } from 'vitest';
import { createTorsoWounds } from './torso';
import { PRESETS } from './presets';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { makeZombie } from '../body';
import { worldHitToWound, woundWorldPos, type Wound } from '../damage';
import { rotateYaw } from '../gait';

const body = buildBody(makeZombie(), DEFAULT_BUILD_OPTS, {});
const torso = body.prims.findIndex(p => p.limb === 'torso' && p.op === 'add');
const arm = body.prims.findIndex(p => p.limb === 'armL' && p.op === 'add');
const wound = (primIdx = torso): Wound => ({ primIdx, local: [0, 0, .16], radius: .055, type: 'pellet', ageSec: 0, carveN: [0, 0, -1], carveDepth: .09 });

describe('bounded torso visual state', () => {
  const hits = [[0, 1.3, .17], [0, 1.09, .17], [0, 1.3, -.17], [0, 1.09, -.17]] as const;
  const regionWounds = () => hits.map(p => worldHitToWound(body.prims, [...p], .055, 'pellet'));

  it('opens independent upper/lower front/back cavities and saturates at eight cutters', () => {
    const a = createTorsoWounds(), wounds = regionWounds();
    expect(wounds.map(w => body.prims[w.primIdx]!.limb)).toEqual(['torso', 'torso', 'torso', 'torso']);
    wounds.forEach(w => a.record(w, body)); a.advance(.4);
    const first = a.visual(body);
    expect(first).toHaveLength(4);
    expect(first.map(w => w.radius)).toEqual([.075, .075, .075, .075]);
    for (let i = 0; i < 100; i++) wounds.forEach(w => a.record(w, body));
    for (let i = 0; i < 20; i++) a.record(wound(arm), body);
    a.advance(.4);
    const result = a.visual(body);
    expect(result.filter(w => w.presetCut)).toHaveLength(8);
    expect(result.filter(w => !w.presetCut)).toHaveLength(8);
    const centres = result.filter(w => w.presetCut).map(w => woundWorldPos(body.prims, w));
    for (const hit of hits) expect(Math.min(...centres.map(c => Math.hypot(...c.map((v, i) => v - hit[i]!))))).toBeLessThan(.02);
  });

  it('classifies a turned body hit against the rest body into the same region', () => {
    const a = createTorsoWounds(), first = regionWounds()[0]!;
    a.record(first, body); a.advance(.4);
    const yaw = 1.6;
    const posed = body.prims.map(p => ({ ...p, a: rotateYaw(p.a, yaw), b: rotateYaw(p.b, yaw) }));
    const again = worldHitToWound(posed, rotateYaw([...hits[0]], yaw), .055, 'pellet', yaw);
    a.record(again, body); a.advance(.4);
    expect(a.visual(body)).toHaveLength(2);
    expect(a.visual(body).map(w => w.radius)).toEqual([.12, .07]);
  });

  it('saturates at two shared cutters without moving the first anchor', () => {
    const a = createTorsoWounds();
    a.record(wound(), body);
    a.advance(.16);
    expect(a.visual(body)).toHaveLength(1);
    expect(a.visual(body)[0]!.radius).toBe(PRESETS[1]![0]!.radius);
    for (let i = 0; i < 100; i++) a.record({ ...wound(), local: [.001 * (i % 4), 0, .16] }, body);
    a.advance(.32);
    const result = a.visual(body);
    expect(result).toHaveLength(2);
    expect(result.map(w => w.radius)).toEqual(PRESETS[2]!.map(c => c.radius));
    expect(result[0]!.local).toEqual([-.018, 0, .16]);
    expect(result[0]!.carveDepth).toBe(.09);
  });

  it('grows continuously when another hit arrives mid-transition', () => {
    const a = createTorsoWounds();
    a.record(wound(), body); a.advance(.08);
    const before = a.visual(body)[0]!.radius;
    a.record(wound(), body);
    expect(a.visual(body)[0]!.radius).toBe(before);
    let previous = before;
    for (let i = 0; i < 30; i++) {
      a.advance(.01);
      const radius = a.visual(body)[0]!.radius;
      expect(radius).toBeGreaterThanOrEqual(previous);
      previous = radius;
    }
    expect(previous).toBe(.12);
  });

  it('keeps burns, limbs and explicit stumps as stock wounds within the upload budget', () => {
    const a = createTorsoWounds();
    const burn = { ...wound(), type: 'burn' as const };
    a.record(burn, body); a.record(wound(arm), body); a.record(wound(), body, false);
    expect(a.visual(body).every(w => !w.presetCut)).toBe(true);
    a.record(wound(), body); a.advance(.32);
    for (let i = 0; i < 100; i++) a.record({ ...wound(arm), radius: i / 100 }, body);
    const result = a.visual(body);
    expect(result.length).toBeLessThanOrEqual(16);
    expect(result.filter(w => w.presetCut)).toHaveLength(1);
    expect(result.filter(w => !w.presetCut).at(-1)!.radius).toBe(.99);
  });

  it('rides the wound frame under a body turn and translation', () => {
    const a = createTorsoWounds(); a.record(wound(), body); a.advance(.16);
    const cut = a.visual(body)[0]!;
    const original = woundWorldPos(body.prims, cut);
    const moved = body.prims.map(p => ({ ...p, a: rotateYaw(p.a, .7), b: rotateYaw(p.b, .7) }));
    const expected = rotateYaw(original, .7);
    const actual = woundWorldPos(moved, cut, .7);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 10));
  });

  it('isolates actor state and drops a region whose owner is removed', () => {
    const a = createTorsoWounds(), b = createTorsoWounds();
    a.record(wound(), body); a.advance(1);
    expect(b.visual(body)).toEqual([]);
    const removed = { ...body, prims: body.prims.map((p, i) => i === torso ? { ...p, dead: true } : p) };
    expect(a.visual(removed)).toEqual([]);
    expect(createTorsoWounds().visual(body)).toEqual([]);
  });
});
