// src/lab/sdf-zombie/characters/tallow-blob.test.ts
//
// Pins the tallow's DESIGN INTENT. Authored from the brief (no mesh, no plate), so these are STRUCTURAL PINS, not
// mesh-derived thresholds. Each names a beat from the .blob header and fails if it is quietly undone:
//
//   * THE MASS: a gut wider than the chest, an apron hanging below the crotch, short legs;
//   * THE ARMS: forearm sleeves the cannons grow out of, with daylight between each muzzle and the gut;
//   * THE HEAD: his own face, clear of the shoulders (the first render buried it);
//   * a small marched budget (the biomech rule: detail is normal map and kit).
//
// What this file cannot check is whether he reads. That took the turntable frames.
import { describe, it, expect } from 'vitest';
import src from './tallow.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compilePalette, compileSheet } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { characterEntry } from '../character-registry';
import type { Vec3 } from '../types';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
type Built = ReturnType<typeof built>;
const only = (b: Built, limbs: string[]) => ({ ...b, prims: b.prims.filter(p => limbs.includes(p.limb)) }) as Built;

/** Distance from `from` along `dir` to where the CPU field first leaves flesh. */
function reach(b: Built, from: Vec3, dir: Vec3): number {
  for (let t = 0; t <= 1.2; t += 0.004) {
    if (sdBody([from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t], b) > 0) return t;
  }
  return Infinity;
}

describe('tallow.blob', () => {
  it('compiles and validates clean', () => {
    expect(built().errors).toEqual([]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compileFace(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
    expect(() => compilePalette(doc)).not.toThrow();
  });

  // The machinery is the Blender kit, the walk is the heavy STOMP, and the attack is the two-cannon volley: the imp's
  // fireball from each muzzle (the hand bones' tails), right and left in turn.
  it('is registered with his kit, a heavy walk and the two-cannon volley', () => {
    const e = characterEntry('tallow');
    expect(e.kit).toBe('/assets/lab/tallow-kit.gltf');
    expect(e.kitSheds).toBe(true);
    expect(e.profile.name).toBe('tallow');
    expect(e.profile.gait.walk.name).toBe('tallow-stomp');
    // Reach arms: the brace's arm pivot runs only for the reach style (gait.ts TALLOW_STOMP).
    expect(e.profile.gait.walk.armStyle).toBe('reach');
    expect(e.profile.throws).toBe('volley');
    expect(e.profile.spit?.from).toBe('handTipR');
    expect(e.profile.spitL?.from).toBe('handTipL');
  });

  // The torso's 13 masses plus the boiler's 8-prim flesh rim stay under the twinhead's 35, and flesh + bone stay
  // within 128, the size that costs nothing new (MAX_PRIMS; past it the body's data texture widens). The prim-built
  // face (brow, eyes, bags, nose, ears, lips) is what took it from ~90 to ~122.
  it('keeps the marched budget small', () => {
    const b = built();
    expect(b.prims.filter(p => p.limb === 'torso').length).toBeLessThanOrEqual(24);
    expect(b.prims.length + b.bonePrims.length).toBeLessThanOrEqual(128);
  });

  // BEAT 1 — THE MASS, on the torso's own field, at heights read off the skeleton (the legs have been cut once
  // already): the gut (7 cm over the hip line) is at least 15 cm wider a side than the chest (the chest bone's top),
  // stands at least 55 cm in front of the spine, and its apron is still flesh 25 cm below the crotch in front of the
  // legs: it hangs to the knees (owner, fifth look: "doesnt quite read as corpulent").
  it('is corpulent: a gut past the chest, an apron hanging to the knees', () => {
    const b = built(), t = only(b, ['torso']);
    const hip = b.bones.get('pelvis')!.tail[1], chestTop = b.bones.get('chest')!.tail[1];
    const gut = reach(t, [0, hip + 0.07, 0], [1, 0, 0]);
    const chest = reach(t, [0, chestTop, 0], [1, 0, 0]);
    expect(gut).toBeGreaterThan(0.58);
    expect(gut - chest).toBeGreaterThan(0.15);
    expect(reach(t, [0, hip + 0.07, 0], [0, 0, 1])).toBeGreaterThan(0.55);
    const crotch = b.bones.get('thigh.l')!.head[1];
    expect(sdBody([0, crotch - 0.25, 0.30], t)).toBeLessThan(0);
  });

  // STUMPS under a long trunk: the hip line under a third of his height (it was 43% before the owner asked for
  // shorter legs), and the ankle low enough to sit inside the iron boot's cuff (make_boots.py: cuff top y 0.285).
  it('stands on stumps, the ankles inside the boots', () => {
    const b = built();
    const hip = b.bones.get('thigh.l')!.head[1];
    const crown = b.bones.get('skull')!.tail[1];
    expect(hip / crown).toBeLessThan(0.40);
    expect(b.bones.get('shin.l')!.tail[1]).toBeLessThan(0.20);
  });

  // BEAT 2 — THE ARMS (the Cronenberg pass): each forearm is a sleeve of meat the cannon (kit, make_cannons.py) grows
  // out of. The sleeve must cover the breech (r ~0.11 to forearm t 0.62, then the block) and stop short of the barrel,
  // and the arm must still read as an arm: air between the cannon's 0.15 m muzzle and the gut.
  it('grows cannons out of forearm sleeves held clear of the gut', () => {
    const b = built();
    const arm = only(b, ['armL']);
    const fa = b.bones.get('forearm.l')!;
    const at = (t: number): Vec3 => [0, 1, 2].map(i => fa.head[i]! + (fa.tail[i]! - fa.head[i]!) * t) as unknown as Vec3;
    // Breech covered: the sleeve's flesh reaches past the breech's radius all round at t 0.45.
    const u: Vec3 = [fa.tail[0] - fa.head[0], fa.tail[1] - fa.head[1], fa.tail[2] - fa.head[2]];
    const L = Math.hypot(...u); const un = u.map(x => x / L) as unknown as Vec3;
    const side = [1, 0, 0].map((x, i) => x - un[i]! * un[0]);
    const sl = Math.hypot(...side); const sn = side.map(x => x / sl) as unknown as Vec3;
    const inner = sn.map(x => -x) as unknown as Vec3;
    expect(reach(arm, at(0.45), sn)).toBeGreaterThan(0.128);
    // Past the lip (t 1.0) only the tendons and the thin core: the barrel is kit, not flesh. Probed on the INNER
    // side, where no tendon runs. (A bar's end cap carries the meat its radius past `to=`: authored to t 0.56, the
    // sleeve ran to t ~0.93 and hid the chamber.)
    expect(reach(arm, at(1.0), inner)).toBeLessThan(0.11);
    // Daylight: the muzzle (forearm t 1.55, r 0.15) clears the gut at its height and depth.
    const t = only(b, ['torso']);
    const muzzle = at(1.55);
    expect(muzzle[0] - 0.15 - reach(t, [0, muzzle[1], muzzle[2]], [1, 0, 0])).toBeGreaterThan(0.0);
  });

  // BEAT 3 — THE HEAD, his own (not the zombie's face sheet). Its widest slice stands clear above the shoulder mounds:
  // at the head's centre height the field is head only (under 0.25 m a side), where the first render had the yoke's
  // fat out to 0.6 m. And the cranium is the head prim the mouth decal projects from (lab-main.ts headShape: the
  // biggest r x max scale among unpainted head prims); on the first look the jaw won and the teeth landed under the lip.
  it('carries his head clear of the shoulders', () => {
    const b = built();
    const sk = b.bones.get('skull')!;
    const cy = sk.head[1] + (sk.tail[1] - sk.head[1]) * 0.55;
    const half = reach(b, [0, cy, 0.05], [1, 0, 0]);
    expect(half).toBeGreaterThan(0.15);
    expect(half).toBeLessThan(0.25);
    const heads = b.prims.filter(p => p.limb === 'head' && p.op === 'add' && (p as { color?: unknown }).color === undefined);
    const size = (p: typeof heads[number]) => p.radius * Math.max(...(p.scale ?? [1, 1, 1]));
    const top = heads.reduce((m, p) => (size(p) > size(m) ? p : m));
    expect(top.bone).toBe('skull');
    expect(top.a[1] - sk.head[1], 'the cranium, high on the skull bone').toBeGreaterThan(0.15);
  });

  it('wears his own mouth decal, not the zombie face', () => {
    expect(characterEntry('tallow').face.url).toBe('/assets/lab/faces/tallow-face.png');
  });
});
