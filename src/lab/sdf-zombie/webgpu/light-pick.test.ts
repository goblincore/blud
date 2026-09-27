import { describe, expect, it } from 'vitest';
import { buildLightList, type LightSource } from './light-list';
import { LIGHT_PROFILES, PROFILE_ID } from './light-profiles';
import { collectLightSources, pickBodyFor } from './game-light-list-leaves';
import { lightPresence, lightRank, pickLights, unpackPick, type Pick } from './light-pick';
import { BEACON, beaconAxis } from './beacon';

const tube = (x: number, z: number, i = 7): LightSource => ({ kind: 'spot', profile: 'tube', pos: [x, 2.2, z], color: [0.8, 0.9, 1], intensity: i, range: 6, axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45), rooms: [3] });
const body = (x: number, z: number, facing: [number, number] = [0, 1]) => ({ pos: [x, 0.9, z] as [number, number, number], room: 3, facing });

describe('pickLights (spec §4)', () => {
  it('a body under a tube gets it as the dominant light', () => {
    const list = buildLightList([tube(5, 0), tube(0, 0)]);
    const p = pickLights(list, body(0, 0));
    expect(list[p.idx[0]!]!.pos[0]).toBe(0);
  });
  it('two bodies under different tubes get different dominants (the crowd fix)', () => {
    const list = buildLightList([tube(-2, 0), tube(2, 0)]);
    expect(pickLights(list, body(-2, 0)).idx[0]).not.toBe(pickLights(list, body(2, 0)).idx[0]);
  });
  it('coverage is judged at the feet: a body at the pool edge is still lit, well outside it drops to the floor', () => {
    const list = buildLightList([tube(0, 0)]);
    const pool = 2.2 * Math.tan(0.6);
    const edge = lightPresence(list[0]!, body(pool * 0.9, 0));
    const out = lightPresence(list[0]!, body(pool * 2.5, 0));
    expect(edge).toBeGreaterThan(0.2);
    // presentingLamp's floor: outside the cone (still in range) the tube keeps a small share,
    // never zero; so "not lit" means "only the floor", well under the pool edge.
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(edge * 0.25);
  });
  it('facing falloff: back to the light is dimmer, not black', () => {
    const list = buildLightList([{ ...tube(0, 0), kind: 'point', pos: [0, 1.5, 2] }]);
    const front = lightPresence(list[0]!, body(0, 0, [0, 1]));
    const back = lightPresence(list[0]!, body(0, 0, [0, -1]));
    expect(back).toBeLessThan(front);
    expect(back).toBeGreaterThan(0);
  });
  it('skips lights for another room; directional lights reach any body in their room', () => {
    const list = buildLightList([{ ...tube(0, 0), rooms: [9] }, { kind: 'directional', profile: 'window', pos: [1, 0.3, 0], color: [1, 1, 1], intensity: 20, range: 0, rooms: [3] }]);
    const p = pickLights(list, body(0, 0));
    expect(list[p.idx[0]!]!.kind).toBe('directional');
    expect(p.idx.slice(1)).toEqual([-1, -1, -1]);
  });
  it('the window light (a room set) reaches bodies in every windowed carriage, not the windowless tender (Task 6 review)', () => {
    const list = buildLightList([{ kind: 'directional', profile: 'window', pos: [1, 0.3, 0], color: [0.72, 0.82, 1], intensity: 20, range: 0, rooms: [1, 2, 3, 4, 5, 6, 8] }]);
    const at = (room: number) => lightPresence(list[0]!, { ...body(0, 0), room });
    expect(at(2)).toBeGreaterThan(0);
    expect(at(4)).toBeGreaterThan(0);
    expect(at(7)).toBe(0);
    expect(at(-1)).toBeGreaterThan(0);   // a body in no room (a tunnel) matches every light
    expect(pickLights(list, { ...body(0, 0), room: 7 }).idx).toEqual([-1, -1, -1, -1]);
  });
  it('an any-room light (no rooms) reaches every body', () => {
    const list = buildLightList([{ kind: 'point', profile: 'muzzle', pos: [0, 1.4, 1], color: [1, 0.81, 0.58], intensity: 35, range: 8 }]);
    expect(lightPresence(list[0]!, { ...body(0, 0), room: 7 })).toBeGreaterThan(0);
  });
  it('packs index + weight, decodes back, -1 for empty; ties by index', () => {
    const list = buildLightList([tube(0, -1), tube(0, 1)]);
    const p = pickLights(list, body(0, 0, [1, 0]));   // side-on to both: an exact tie
    expect(p.idx.slice(0, 2)).toEqual([0, 1]);
    const d = unpackPick(p.packed);
    expect(d.map(x => x.index)).toEqual([0, 1, -1, -1]);
    expect(d[0]!.weight).toBeGreaterThan(0);
    expect(d[0]!.weight).toBeLessThan(1);
  });
});

describe('lightRank keeps presentingLamp (game-dynamic-light-leaves.ts) rules', () => {
  const tubeProf = LIGHT_PROFILES[PROFILE_ID.tube]!;
  it('the coverage floor: far outside the cone but in range, the cover term is exactly the floor', () => {
    const list = buildLightList([tube(0, 0)]);
    const b = body(4, 0, [-1, 0]);   // facing the tube
    const dist = Math.hypot(4, 1.3);
    const lum = (0.8 * 0.2126 + 0.9 * 0.7152 + 0.0722) * 7;
    const facingDot = 1;
    const facing = tubeProf.backKey + (1 - tubeProf.backKey) * (facingDot * 0.5 + 0.5);
    // Rank is on delivered light: x the profile gain x bodyNorm (1 here: no refIntensity).
    expect(lightRank(list[0]!, b)).toBeCloseTo(tubeProf.coverFloor * lum * tubeProf.gain * facing / (1 + tubeProf.distFall * dist * dist), 6);
  });
  it('the pick reads coverFloor, not the shader wrap floor (review fix, Task 4)', () => {
    const list = buildLightList([tube(0, 0)]);
    const b = body(4, 0, [-1, 0]);
    const w = lightRank(list[0]!, b);
    const dist = Math.hypot(4, 1.3);
    const lum = (0.8 * 0.2126 + 0.9 * 0.7152 + 0.0722) * 7;
    expect(w / (lum * tubeProf.gain / (1 + tubeProf.distFall * dist * dist))).toBeCloseTo(tubeProf.coverFloor, 6);
  });
  it('full cover inside the inner cone, a smoothstep down to zero at the edge angle (outer angle x edge)', () => {
    const list = buildLightList([tube(0, 0)]);
    const at = (a: number) => lightRank(list[0]!, { ...body(Math.tan(a) * (2.2 - 0.05), 0, [0, 1]), pos: [Math.tan(a) * (2.2 - 0.05), 2.2, 0] });
    // pos.y = the lamp's height, so distance is purely horizontal and facing is side-on: only cover varies
    const base = (a: number) => (1 + tubeProf.distFall * (Math.tan(a) * 2.15) ** 2);
    const inner = at(0.44) * base(0.44), edge = at(0.6 * tubeProf.edge + 0.01) * base(0.6 * tubeProf.edge + 0.01);
    const mid = at(0.6) * base(0.6);
    expect(edge / inner).toBeCloseTo(tubeProf.coverFloor, 5);
    expect(mid / inner).toBeGreaterThan(tubeProf.coverFloor);
    expect(mid / inner).toBeLessThan(1);
  });
  it('a light straight overhead counts as side-on for facing (presentingLamp: crown-only reads dark)', () => {
    const list = buildLightList([{ ...tube(0, 0), kind: 'point' }]);
    const a = lightRank(list[0]!, body(0, 0, [0, 1]));
    const side = lightRank(list[0]!, body(0, 0, [1, 0]));
    expect(a).toBeCloseTo(side, 9);
  });
  it('out of range: zero, and the pick leaves the slot empty', () => {
    const list = buildLightList([tube(0, 0)]);
    expect(lightPresence(list[0]!, body(7, 0))).toBe(0);
    expect(lightRank(list[0]!, body(7, 0))).toBe(0);
    expect(pickLights(list, body(7, 0)).packed).toEqual([-1, -1, -1, -1]);
  });
});

describe('pick packing survives the GPU f32 lane', () => {
  it('index 31 + weight 0.999 decodes after Math.fround', () => {
    const v = Math.fround(31 + 0.999);
    expect(Math.floor(v)).toBe(31);
    expect(Math.abs(v - Math.floor(v) - 0.999)).toBeLessThan(1e-4);
    const [d] = unpackPick([v]);
    expect(d!.index).toBe(31);
    expect(d!.weight).toBeCloseTo(0.999, 4);
  });
});

describe('packed weight is absolute presence, not a share of the dominant (review fix, Task 4)', () => {
  it('THE REGRESSION: a body in the pool gets a higher packed weight than a body at the dim floor region of the same tube, even when it is each body\'s only light', () => {
    const list = buildLightList([tube(0, 0)]);
    const pool = 2.2 * Math.tan(0.6);
    const inPool = pickLights(list, body(pool * 0.9, 0));
    const atFloor = pickLights(list, body(pool * 2.5, 0));
    // Old (share) rule: both would pack weight 0.999, since a lone light is always "the dominant".
    expect(inPool.weight[0]).toBeGreaterThan(atFloor.weight[0]!);
    expect(atFloor.weight[0]).toBeLessThan(0.3);
    expect(inPool.weight[0]).toBeGreaterThan(0.2);
  });
  it('weights never exceed 0.999, even when presence hits 1 exactly (directional light aligned with facing)', () => {
    const list = buildLightList([{ kind: 'directional', profile: 'window', pos: [0, 0, 1], color: [1, 1, 1], intensity: 1, range: 0, rooms: [3] }]);
    const b = body(0, 0, [0, 1]);
    expect(lightPresence(list[0]!, b)).toBeCloseTo(1, 9);
    const p = pickLights(list, b);
    expect(p.weight[0]).toBe(0.999);
    // and it still decodes as this light's index, not rolled into the next one.
    const [d] = unpackPick(p.packed);
    expect(d!.index).toBe(0);
  });
  it('ranking still prefers a brighter light over a dimmer one at equal presence', () => {
    const dim: LightSource = { kind: 'point', profile: 'lamp', pos: [0, 0.9, 3], color: [1, 1, 1], intensity: 1, range: 10, rooms: [3] };
    const bright: LightSource = { ...dim, intensity: 50 };
    const list = buildLightList([dim, bright]);   // co-located: identical presence, different luminance
    const b = body(0, 0);
    const bIdx = list.findIndex(l => l.intensity === Math.max(...list.map(x => x.intensity)));
    const p = pickLights(list, b);
    expect(p.idx[0]).toBe(bIdx);
    // presence (and so the packed weight) is the same for both — only the rank differs.
    expect(lightPresence(list[0]!, b)).toBeCloseTo(lightPresence(list[1]!, b), 9);
  });
  it('passing `out` reuses the same object', () => {
    const list = buildLightList([tube(0, 0)]);
    const out: Pick = { idx: [-1, -1, -1, -1], weight: [0, 0, 0, 0], packed: [-1, -1, -1, -1] };
    const p = pickLights(list, body(0, 0), out);
    expect(p).toBe(out);
    expect(p.idx[0]).toBe(0);
  });
});

describe('ranking is on DELIVERED light (Task 10 review: rgb x gain x bodyNorm, not physical rgb)', () => {
  // A lit third-class tube overhead (base power 1, spot 7 = base x TUBE_SPOT_GAIN, the reader's
  // refIntensity) and the player's 35-intensity muzzle flash 1.5 m from the body's chest.
  const sources = () => collectLightSources({
    lamps: [{ pos: [0, 2.2, 0], color: [0.8, 0.9, 1], intensity: 7, ref: 7, range: 6, room: 3, mood: 'steady',
      tube: { axis: [0, -1, 0], cosOuter: Math.cos(0.6), cosInner: Math.cos(0.45) } }],
    window: null, flashlight: null,
    flashes: [{ pos: [0, 1.2, 1.5], intensity: 35 }],
  });
  const b = pickBodyFor([0, 0, 0], 3, [0, 1.6, 4]);
  it('a muzzle flash near a body under a lit tube does not steal slot 0 from the tube', () => {
    const list = buildLightList(sources());
    const tubeIdx = list.findIndex(l => l.profile === PROFILE_ID.tube);
    const muzzleIdx = list.findIndex(l => l.profile === PROFILE_ID.muzzle);
    const p = pickLights(list, b);
    expect(p.idx[0]).toBe(tubeIdx);
    expect(p.idx[1]).toBe(muzzleIdx);
    // Physical rgb alone would have ranked the muzzle first (the bug this pins).
    const lum = (c: readonly number[]) => c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
    expect(lightPresence(list[muzzleIdx]!, b) * lum(list[muzzleIdx]!.color))
      .toBeGreaterThan(lightPresence(list[tubeIdx]!, b) * lum(list[tubeIdx]!.color));
  });
  it('the packed weight stays absolute presence (the delivered scale only ranks)', () => {
    const list = buildLightList(sources());
    const p = pickLights(list, b);
    for (let k = 0; k < 2; k++) expect(p.weight[k]).toBeCloseTo(Math.min(0.999, lightPresence(list[p.idx[k]!]!, b)), 9);
  });
});

describe('a Boiler Room beacon (spec 2026-09-27-boiler-room-beacons-design.md)', () => {
  // Beacon at the ceiling; after the strobe the room's lamps are dead, the firebox still burns.
  const at: [number, number, number] = [0, 3.3, -94];
  const ref = 2.4 * BEACON.spotGain;
  const beaconSource = (axis: [number, number, number]) => collectLightSources({
    lamps: [
      { pos: at, color: [...BEACON.color], intensity: ref, range: BEACON.reach, room: 5, ref, mood: 'dead', beacon: true,
        tube: { axis, cosOuter: Math.cos(BEACON.angle), cosInner: Math.cos(BEACON.angle * (1 - BEACON.penumbra)) } },
      { pos: [1.1, 0.5, -96], color: [1, 0.42, 0.12], intensity: 3, range: 12, room: 5, tube: null, mood: 'fire' },
    ],
    window: null, flashlight: null, flashes: [],
  });
  // Where the swept axis meets the feet (y 0.2): tilt below horizontal from 3.3 m.
  const reach = (3.3 - 0.2) / Math.tan(BEACON.tilt);
  it('a body whose feet the sweep points at gets the beacon as its dominant light', () => {
    const ax = beaconAxis(0, 0.7, 0);   // +x
    const list = buildLightList(beaconSource(ax));
    const b = pickBodyFor([reach, 0, -94], 5, [reach + 2, 1.6, -94]);
    const p = pickLights(list, b);
    expect(list[p.idx[0]!]!.profile).toBe(PROFILE_ID.beacon);
  });
  it('as the sweep moves on, the same body loses it to the coverage floor', () => {
    const b = pickBodyFor([reach, 0, -94], 5, [reach + 2, 1.6, -94]);
    const on = buildLightList(beaconSource(beaconAxis(0, 0.7, 0)));
    const off = buildLightList(beaconSource(beaconAxis(0.5 / 0.7, 0.7, 0)));   // half a turn later: -x
    const w = (l: typeof on) => { const p = pickLights(l, b); const i = p.idx.findIndex(k => k >= 0 && l[k]!.profile === PROFILE_ID.beacon); return i < 0 ? 0 : p.weight[i]!; };
    expect(w(on)).toBeGreaterThan(w(off));
  });
});
