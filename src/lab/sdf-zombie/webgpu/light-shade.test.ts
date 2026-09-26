import { describe, expect, it } from 'vitest';
import { buildLightList, packLightList, type LightSource, type Vec3 } from './light-list';
import { LIGHT_PROFILES, PROFILE_ID, PROFILE_VEC4S } from './light-profiles';
import { pickLights } from './light-pick';
import { shadeBodyLights } from './light-shade';

// Every rule is judged at the origin with the camera straight down +z (V = [0, 0, 1]).
const P: Vec3 = [0, 0, 0];
const V: Vec3 = [0, 0, 1];
const point = (pos: Vec3, profile: LightSource['profile'] = 'tube', color: Vec3 = [1, 1, 1], intensity = 1): LightSource =>
  ({ kind: 'point', profile, pos, color, intensity, range: 20 });
const packed = (src: LightSource[]) => packLightList(buildLightList(src));
const sum = (v: readonly number[]) => v[0]! + v[1]! + v[2]!;
const EMPTY = [-1, -1, -1, -1];

describe('shadeBodyLights (the CPU reference of bodyLights)', () => {
  it('the floor keeps a terminator lit: n.L = 0 with floor 0.18 still gives diffuse', () => {
    // Light at +x, normal up: n.L = 0, and the view bias (toward +z) keeps n.Lb = 0 too.
    const n: Vec3 = [0, 1, 0];
    const tube = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([5, 0, 0], 'tube')]));
    expect(LIGHT_PROFILES[PROFILE_ID.tube]!.floor).toBe(0.18);
    expect(sum(tube.diffuse)).toBeGreaterThan(0);
    // wrap = floor / (1 + floor), times c = rgb x weight x gain.
    expect(tube.diffuse[0]).toBeCloseTo((0.18 / 1.18) * 0.5 * 1.3, 5);
    // A floor-0 profile (muzzle) leaves the same terminator black.
    const muzzle = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([5, 0, 0], 'muzzle')]));
    expect(sum(muzzle.diffuse)).toBe(0);
    expect(tube.domFloor).toBeCloseTo(0.18, 6);
  });

  it('view bias: a light behind the body still wraps onto the front; bias 0 gives less', () => {
    // Light behind and to the side (n.L < 0): the 0.3 bias bends it toward the camera.
    const n: Vec3 = [0, 0, 1];
    const list = packed([point([0.97 * 5, 0, -0.24 * 5], 'tube')]);
    const biased = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], list);
    const unbiased = list.slice();
    unbiased[PROFILE_ID.tube * PROFILE_VEC4S * 4 + 1] = 0;   // lane a.y = viewBias
    const flat = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], unbiased);
    expect(sum(biased.diffuse)).toBeGreaterThan(0);
    expect(sum(flat.diffuse)).toBeLessThan(sum(biased.diffuse));
  });

  it('rim: backlit + grazing normal gives rim; a normal facing the camera gives none', () => {
    const list = packed([point([0, 0, -5], 'tube')]);
    const grazing = shadeBodyLights(P, [1, 0, 0], V, [0.8, -1, -1, -1], list);
    const facing = shadeBodyLights(P, [0, 0, 1], V, [0.8, -1, -1, -1], list);
    expect(sum(grazing.rim)).toBeGreaterThan(0);
    // backRim x (1 - 0)^4 x max(side 0, back 1 x 0.5) x rimTint x c
    const t = LIGHT_PROFILES[PROFILE_ID.tube]!;
    expect(grazing.rim[0]).toBeCloseTo(t.backRim * 0.5 * t.rimTint[0] * 0.8 * t.gain, 5);
    expect(sum(facing.rim)).toBeCloseTo(0, 6);
  });

  it('empty slots add nothing', () => {
    const r = shadeBodyLights(P, [0, 0, 1], V, EMPTY, packed([point([0, 0, 5])]));
    expect([...r.diffuse, ...r.spec, ...r.rim, ...r.domC, r.domFloor]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.domL).toEqual([0, 1, 0]);
  });

  it('weight scales linearly: half the weight gives half the output', () => {
    const list = packed([point([2, 1, 5], 'lamp', [1, 0.8, 0.6])]);
    const n: Vec3 = [0.6, 0, 0.8];
    const full = shadeBodyLights(P, n, V, [0.6, -1, -1, -1], list);
    const half = shadeBodyLights(P, n, V, [0.3, -1, -1, -1], list);
    for (const k of ['diffuse', 'spec', 'rim', 'domC'] as const) {
      for (let i = 0; i < 3; i++) expect(half[k][i]).toBeCloseTo(full[k][i]! * 0.5, 6);
    }
    expect(sum(full.spec)).toBeGreaterThan(0);
  });

  it('skipFirst drops slot 0 from diffuse and spec only: rim and dom* are unchanged', () => {
    const list = packed([point([3, 1, 4], 'tube', [0.9, 1, 1], 2), point([-4, 2, 3], 'lamp', [1, 0.7, 0.4], 1)]);
    const n: Vec3 = [0.3, 0.2, 0.93];
    const picks = [0.7, 1.4, -1, -1];
    const all = shadeBodyLights(P, n, V, picks, list);
    const only0 = shadeBodyLights(P, n, V, [0.7, -1, -1, -1], list);
    const skip = shadeBodyLights(P, n, V, picks, list, true);
    for (let i = 0; i < 3; i++) {
      expect(skip.diffuse[i]).toBeCloseTo(all.diffuse[i]! - only0.diffuse[i]!, 6);
      expect(skip.spec[i]).toBeCloseTo(all.spec[i]! - only0.spec[i]!, 6);
      expect(skip.rim[i]).toBeCloseTo(all.rim[i]!, 6);
    }
    expect(skip.domL).toEqual(all.domL);
    expect(skip.domC).toEqual(all.domC);
    expect(skip.domFloor).toBe(all.domFloor);
    expect(sum(only0.diffuse)).toBeGreaterThan(0);
  });

  it('reads the packed list: slot 0 returns L toward the light and c = rgb x weight x gain; directional L is its direction', () => {
    const src: LightSource[] = [
      point([0, 3, 4], 'lamp', [1, 0.5, 0.25], 2),
      { kind: 'directional', profile: 'window', pos: [0, 0, 2], color: [0.5, 0.5, 1], intensity: 1.5, range: 0 },
    ];
    const list = packed(src);   // ranked by effective intensity: the lamp (2) is index 0, the window (1.5) index 1
    const a = shadeBodyLights(P, [0, 0, 1], V, [0.5, -1, -1, -1], list);
    expect(a.domL[1]).toBeCloseTo(0.6, 6);
    expect(a.domL[2]).toBeCloseTo(0.8, 6);
    const gl = LIGHT_PROFILES[PROFILE_ID.lamp]!.gain;
    expect(a.domC[0]).toBeCloseTo(1 * 2 * 0.5 * gl, 5);
    expect(a.domC[2]).toBeCloseTo(0.25 * 2 * 0.5 * gl, 5);
    const d = shadeBodyLights([9, 9, 9], [0, 0, 1], V, [1.25, -1, -1, -1], list);
    expect(d.domL).toEqual([0, 0, 1]);
    expect(d.domFloor).toBeCloseTo(LIGHT_PROFILES[PROFILE_ID.window]!.floor, 6);
  });

  it('agrees with pickLights output end to end (picks are index + absolute weight)', () => {
    const src: LightSource[] = [{ kind: 'spot', profile: 'tube', pos: [0, 2.2, 0], color: [0.8, 0.9, 1], intensity: 7, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45) }];
    const ll = buildLightList(src);
    const pick = pickLights(ll, { pos: [0, 0.9, 0], room: -1, facing: [0, 1] });
    const r = shadeBodyLights([0, 0.9, 0.2], [0, 0.3, 0.95], V, pick.packed, packLightList(ll));
    expect(r.domC[1]).toBeCloseTo(0.9 * 7 * pick.weight[0]! * LIGHT_PROFILES[PROFILE_ID.tube]!.gain, 4);
    expect(sum(r.diffuse)).toBeGreaterThan(0);
  });
});
