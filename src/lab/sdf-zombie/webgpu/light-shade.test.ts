import { describe, expect, it } from 'vitest';
import { buildLightList, packLightList, type LightSource, type Vec3 } from './light-list';
import { LIGHT_PROFILES, PROFILE_ID, PROFILE_VEC4S } from './light-profiles';
import { pickLights } from './light-pick';
import { BEAM_WHITE_CLIP, BEAM_WHITE_LUM, beamTail, shadeBodyLights } from './light-shade';

// Every rule is judged at the origin with the camera straight down +z (V = [0, 0, 1]).
const P: Vec3 = [0, 0, 0];
const V: Vec3 = [0, 0, 1];
const point = (pos: Vec3, profile: LightSource['profile'] = 'tube', color: Vec3 = [1, 1, 1], intensity = 1): LightSource =>
  ({ kind: 'point', profile, pos, color, intensity, range: 20 });
const packed = (src: LightSource[]) => packLightList(buildLightList(src));
const sum = (v: readonly number[]) => v[0]! + v[1]! + v[2]!;
const EMPTY = [-1, -1, -1, -1];

describe('shadeBodyLights (the CPU reference of bodyLights)', () => {
  it('zero vectors never make NaN: a light exactly at p, and Lb == -V (viewBias 0)', () => {
    const finite = (o: ReturnType<typeof shadeBodyLights>) =>
      [...o.diffuse, ...o.spec, ...o.rim, ...o.domL, ...o.domLb, ...o.domC, o.domFloor].every(Number.isFinite);
    const n: Vec3 = [0, 0, 1];
    // A point light sitting on the shaded point: L = 0, so direction-dependent terms vanish.
    const atP = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], packed([point([0, 0, 0], 'tube')]));
    expect(finite(atP)).toBe(true);
    expect(atP.domL).toEqual([0, 0, 0]);
    // Muzzle (viewBias 0) straight behind the body: L = -V, Lb = -V, Lb + V = 0 so H = 0.
    expect(LIGHT_PROFILES[PROFILE_ID.muzzle]!.viewBias).toBe(0);
    const behind = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], packed([point([0, 0, -5], 'muzzle')]));
    expect(finite(behind)).toBe(true);
    expect(sum(behind.spec)).toBe(0);
    // The flashlight profile too, as the dominant and skipped.
    const flash = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], packed([point([0, 0, -5], 'flashlight')]), true);
    expect(finite(flash)).toBe(true);
  });

  it('the floor keeps a terminator lit: n.L = 0 with floor 0.18 still gives diffuse', () => {
    // Light at +x, normal up: n.L = 0, and the view bias (toward +z) keeps n.Lb = 0 too.
    const n: Vec3 = [0, 1, 0];
    const tube = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([5, 0, 0], 'tube')]));
    expect(LIGHT_PROFILES[PROFILE_ID.tube]!.floor).toBe(0.18);
    expect(sum(tube.diffuse)).toBeGreaterThan(0);
    // wrap = floor / (1 + floor), times c = rgb x weight x gain.
    expect(tube.diffuse[0]).toBeCloseTo((0.18 / 1.18) * 0.5 * LIGHT_PROFILES[PROFILE_ID.tube]!.gain, 5);
    // A floor-0 profile (muzzle) leaves the same terminator black.
    const muzzle = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([5, 0, 0], 'muzzle')]));
    expect(sum(muzzle.diffuse)).toBe(0);
    expect(tube.domFloor).toBeCloseTo(0.18, 6);
  });

  it('beam sums beamShoulder x luminance(c): the flashlight counts (x2), a tube does not (owner 2026-09-27)', () => {
    const n: Vec3 = [0, 0, 1];
    const flash = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([0, 0, 5], 'flashlight', [1, 0.9, 0.8])]));
    const lum = 0.2126 * flash.domC[0] + 0.7152 * flash.domC[1] + 0.0722 * flash.domC[2];
    expect(lum).toBeGreaterThan(0);
    expect(flash.beam).toBeCloseTo(2 * lum, 5);
    const tube = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([0, 0, 5], 'tube')]));
    expect(tube.beam).toBe(0);
    // Two slots: the tube adds nothing, the flashlight its own share (skipFirst does not gate it).
    const both = shadeBodyLights(P, n, V, [0.5, 1.5, -1, -1], packed([point([0, 0, 5], 'tube'), point([0, 0, 5], 'flashlight', [1, 0.9, 0.8])]), true);
    expect(both.beam).toBeCloseTo(flash.beam, 5);
  });

  it('bodyNorm (light v3.z) scales c: a light with refIntensity 4 gives a quarter (Task 10)', () => {
    const n: Vec3 = [0, 0, 1];
    const a = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([point([0, 0, 5], 'lamp')]));
    const b = shadeBodyLights(P, n, V, [0.5, -1, -1, -1], packed([{ ...point([0, 0, 5], 'lamp'), refIntensity: 4 }]));
    expect(sum(b.diffuse)).toBeGreaterThan(0);
    expect(sum(b.diffuse)).toBeCloseTo(sum(a.diffuse) / 4, 6);
    expect(sum(b.rim)).toBeCloseTo(sum(a.rim) / 4, 6);
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
    expect(r.domLb).toEqual([0, 1, 0]);
  });

  it('domLb is slot 0 Lb = normalize(mix(L, V, viewBias)); bias 0 gives domLb == domL', () => {
    const list = packed([point([0.97 * 5, 0, -0.24 * 5], 'tube')]);
    const n: Vec3 = [0, 0, 1];
    const r = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], list);
    const b = LIGHT_PROFILES[PROFILE_ID.tube]!.viewBias;
    expect(b).toBeGreaterThan(0);
    const m = [0, 1, 2].map((i) => r.domL[i]! + (V[i]! - r.domL[i]!) * b);
    const len = Math.hypot(m[0]!, m[1]!, m[2]!);
    for (let i = 0; i < 3; i++) expect(r.domLb[i]).toBeCloseTo(m[i]! / len, 6);
    // The dominant's wrap is taken on Lb: with skipFirst off, diffuse = c x max((n.Lb + floor) / (1 + floor), 0).
    const f = LIGHT_PROFILES[PROFILE_ID.tube]!.floor;
    expect(r.diffuse[0]).toBeCloseTo(r.domC[0] * Math.max((r.domLb[2] + f) / (1 + f), 0), 5);
    const unbiased = list.slice();
    unbiased[PROFILE_ID.tube * PROFILE_VEC4S * 4 + 1] = 0;   // lane a.y = viewBias
    const u = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], unbiased);
    for (let i = 0; i < 3; i++) expect(u.domLb[i]).toBeCloseTo(u.domL[i]!, 6);
    // Lb == -V (muzzle, bias 0, straight behind) is the zero-safe vec3(0), not NaN.
    const behind = shadeBodyLights(P, n, V, [0.9, -1, -1, -1], packed([point([0, 0, -5], 'muzzle')]));
    expect(behind.domLb.every(Number.isFinite)).toBe(true);
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
    expect(skip.domLb).toEqual(all.domLb);
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

describe('beamTail (compose.wgsl.ts beam shoulder, owner 2026-09-27: pink, not white)', () => {
  const KNEE = 0.65;   // 1 - the shipped beamTuning.shoulder 0.35
  const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const chroma = (c: readonly number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  const pink: Vec3 = [1.0, 0.62, 0.6];
  it('identity below the knee (a body the torch keeps in the midtones shades as before)', () => {
    const c: Vec3 = [0.5, 0.3, 0.3];
    expect(beamTail(c, KNEE)).toEqual(c);
  });
  it('keeps the hue: a bright pink body stays pink where the per-channel shoulder whitens it', () => {
    for (const k of [1.2, 1.6, 2.4, 4]) {
      const c: Vec3 = [pink[0] * k, pink[1] * k, pink[2] * k];
      const out = beamTail(c, KNEE, 0);
      // The old per-channel exponential shoulder, for comparison.
      const exp = c.map(x => x <= KNEE ? x : KNEE + (1 - KNEE) * (1 - Math.exp(-(x - KNEE) / (1 - KNEE))));
      // 1.2x: 0.33 vs 0.23; 2.4x: 0.22 vs 0.03 (white); 4x: 0.18 vs 0.00. Red rounds off at 1
      // while green and blue still rise: a gentle desaturation at the very top, never white.
      expect(chroma(out)).toBeGreaterThan(chroma(exp) + 0.09);
      expect(chroma(out)).toBeGreaterThan(0.15);
    }
  });
  it('monotonic in brightness and never over 1 on any channel (the white clip may reach it: pick C)', () => {
    let prev = 0;
    for (let k = 0.2; k < 20; k *= 1.25) {
      const out = beamTail([pink[0] * k, pink[1] * k, pink[2] * k], KNEE);
      expect(lum(out)).toBeGreaterThan(prev);
      prev = lum(out);
      for (const v of out) expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('white clip (owner pick C, 2026-09-27): the hottest luminance whitens, the midtones stay the pink tail', () => {
    expect(BEAM_WHITE_CLIP).toBe(1);
    const exp = (c: Vec3) => c.map(x => x <= KNEE ? x : KNEE + (1 - KNEE) * (1 - Math.exp(-(x - KNEE) / (1 - KNEE))));
    // Below the ramp: exactly the pure tail.
    const mid: Vec3 = [0.9, 0.558, 0.54];   // pink, luminance ~0.63
    expect(lum(mid)).toBeLessThan(BEAM_WHITE_LUM[0]);
    expect(beamTail(mid, KNEE)).toEqual(beamTail(mid, KNEE, 0));
    // Past the ramp: exactly the per-channel shoulder (near-white).
    const hot: Vec3 = [pink[0] * 3, pink[1] * 3, pink[2] * 3];
    expect(lum(hot)).toBeGreaterThan(BEAM_WHITE_LUM[1]);
    beamTail(hot, KNEE).forEach((v, i) => expect(v).toBeCloseTo(exp(hot)[i]!, 9));
    expect(chroma(beamTail(hot, KNEE))).toBeLessThan(0.05);
    // Option 3: the same brightness with the torch only a third of it (a tube doing the rest)
    // stays the pure pink tail.
    expect(beamTail(hot, KNEE, BEAM_WHITE_CLIP, 0.25)).toEqual(beamTail(hot, KNEE, 0));
  });
  it('a white specular glint still goes near-white (the hot-light sparkle)', () => {
    const out = beamTail([6, 6, 6], KNEE);
    expect(Math.min(...out)).toBeGreaterThan(0.9);
    expect(chroma(out)).toBeLessThan(1e-9);
  });
});
