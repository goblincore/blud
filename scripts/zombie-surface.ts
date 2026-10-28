// scripts/zombie-surface.ts
//
// Probe zombie.blob's skin for the Blender kit (assets-source/zombie-kit/): straps, cuffs, trousers and boots are
// laid on the PROBED skin, not round a bone (biomech-style.md, "Lay the kit on the PROBED skin").
//
//   npx tsx scripts/zombie-surface.ts [name]  ->  assets-source/zombie-kit/surface.json (surface-<name>.json for any
//   other body: the fat zombie's refit kit reads surface-zombie-fat.json, make_kit.py --body zombie-fat)
//
// torso: rings[y] of skin points at 6 deg steps (0 = +z front, +90 = the body's left, +x).
// limbs: per bone, rings at t steps of 0.04 of skin RADII round the bone at 15 deg steps in the bake's frame
//        (f = rest +z off the bone axis, s = f x axis; ph 0 front, +90 outward).
// Coordinates are the .blob's rest frame (metres, Y up, +Z forward); the Blender side converts with bv().
//
// THE POSED ENVELOPE (owner, 2026-10-26: the trousers clipped). Kit rides ONE bone rigidly, but the flesh under it
// is folded from several: the thighs swing under the seat, the knee bends under the shin cloth. Laid on the REST skin
// the trousers had flesh coming through at the crotch whenever the zombie walked. So every table is the OUTERMOST
// flesh over the real motion (the shamble at three speeds, through makeActorMotion / applyRig, the game's own path),
// each measured in the frame of the bone its cloth rides (kitFrames, what the kit is posed with) and including the
// clusters that can reach it: torso rings below the pelvis tail take the legs too (in the pelvis frame), torso rings
// above it the torso alone (spine frame), legs their own leg. The arms stay at rest:
// the forearm cuffs ride a single rigid flesh capsule.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody } from '../src/lab/sdf-zombie/validate';
import { makeActorMotion, stepActorMotion, emptyActorSignals } from '../src/lab/sdf-zombie/actor';
import { ZOMBIE_PROFILE } from '../src/lab/sdf-zombie/motion-profile';
import { applyRig, kitFrames } from '../src/lab/sdf-zombie/rig-bind';
import { makeRng } from '../src/lab/sdf-zombie/wander';
import { qRotate } from '../src/lab/sdf-zombie/vec';

type V = [number, number, number];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = process.argv[2] ?? 'zombie';
const doc = parseBlob(readFileSync(resolve(ROOT, `src/lab/sdf-zombie/characters/${NAME}.blob`), 'utf8'));
const built = buildBody(compileBlob(doc, compileFace(doc)));
const bones = built.bones as unknown as Map<string, { head: V; tail: V }>;

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V): V => mul(a, 1 / Math.hypot(...a));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** March from `o + dir * r0` inward along -dir to the field's surface; the distance from o, or -1. */
function radius(field: (p: V) => number, o: V, dir: V, r0 = 0.6) {
  let r = r0;
  for (let i = 0; i < 500; i++) {
    const d = field(add(o, mul(dir, r)));
    if (Math.abs(d) < 1e-4) return r;
    r -= Math.max(Math.abs(d) * 0.9, 2e-4) * Math.sign(d);
    if (r < 0) return -1;
  }
  return r;
}

// The poses: the rest body, then the shamble sampled every 6th frame at three speeds (standing still, cruise, a
// lurch at 1.4x cruise), after a second of settling at each.
type Pose = { body: typeof built; frames: Map<string, { pos: V; quat: [number, number, number, number] }> };
const poses: Pose[] = [];
{
  const restFrames = new Map<string, { pos: V; quat: [number, number, number, number] }>();
  for (const [k, b] of bones) restFrames.set(k, { pos: b.head, quat: [0, 0, 0, 1] });
  poses.push({ body: built, frames: restFrames });
  for (const speed of [0, ZOMBIE_PROFILE.cruise, ZOMBIE_PROFILE.cruise * 1.4]) {
    const m = makeActorMotion(built, { seed: 11 });
    const rng = makeRng(11);
    for (let i = 0; i < 60 + 150; i++) {
      stepActorMotion(m, {
        current: built, dt: 1 / 60, wander: true, armStyle: undefined, headingFollow: 1, gazeFollow: 1,
        bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, rng, signals: emptyActorSignals(), profile: ZOMBIE_PROFILE,
        forceSpeed: speed,
      });
      if (i < 60 || i % 6) continue;
      poses.push({ body: applyRig(built, m.bound, m.lastBodyYaw), frames: kitFrames(built, m.bound, m.lastBodyYaw) as Pose['frames'] });
    }
  }
}
/** The field of `limbs` in pose P, read at a point given in the REST frame of `bone` (where its kit is authored). */
function inFrame(P: Pose, bone: string, limbs: string[]) {
  const f = P.frames.get(bone)!, head = bones.get(bone)!.head;
  const field = { ...P.body, clusters: P.body.clusters.map(c => ({ ...c, alive: c.alive && limbs.includes(c.limb) })) } as typeof built;
  return (p: V) => sdBody(add(f.pos, qRotate(f.quat, sub(p, head))), field);
}
/** The envelope: the outermost surface along the ray over every pose, at most CAP past the rest surface. Uncapped,
 *  a forward-swung thigh lies ALONG a seat ray and the seat grew 35 cm; past the cap the flesh is a swinging limb,
 *  and that limb's own cloth piece swings with it and covers it (cloth through cloth of one colour does not show;
 *  flesh through cloth does). */
const CAP = 0.025;
function envelope(bone: string, limbs: string[], o: V, dir: V, r0 = 0.6) {
  const rest = radius(inFrame(poses[0]!, bone, limbs), o, dir, r0);
  let r = rest;
  for (const P of poses) r = Math.max(r, radius(inFrame(P, bone, limbs), o, dir, r0));
  return rest < 0 ? r : Math.min(r, rest + CAP);
}

const torso: { y: number; pts: V[] }[] = [];
for (let y = 0.84; y <= 1.481; y += 0.01) {
  const pts: V[] = [];
  // Below the pelvis tail the seat rides the pelvis. The thighs swing under it, so the legs count in the band just
  // under the hip (y 0.95-1.06) and nowhere lower: below 0.95 the thigh pieces cover the legs, and counting them there
  // flared the seat's bottom into a skirt.
  const low = y < 1.06, hip = y >= 0.95 && low;
  for (let th = 0; th < 360; th += 6) {
    const a = th * Math.PI / 180, dir: V = [Math.sin(a), 0, Math.cos(a)], o: V = [0, y, 0.02];
    const r = envelope(low ? 'pelvis' : 'spine', hip ? ['torso', 'legL', 'legR'] : ['torso'], o, dir);
    pts.push((r < 0 ? o : add(o, mul(dir, r))).map(r4) as V);
  }
  torso.push({ y: r4(y), pts });
}

const limbs: Record<string, { head: V; tail: V; t: number[]; ph: number[]; r: number[][] }> = {};
for (const b of ['upperArm', 'foreArm', 'thigh', 'shin', 'foot']) for (const sd of ['l', 'r']) {
  const name = `${b}.${sd}`, { head, tail } = bones.get(name)!;
  const arm = b === 'upperArm' || b === 'foreArm', leg = sd === 'l' ? 'legL' : 'legR';
  const reach = arm ? [sd === 'l' ? 'armL' : 'armR'] : [leg];   // a thigh's cloth wraps its own leg; the seat takes the hip
  const u = norm(sub(tail, head));
  // The bake's frame; a foot points along +z, so take its front as down (-y) instead.
  const fw = Math.abs(u[2]) > 0.9 ? [0, -1, 0] as V : norm(sub([0, 0, 1], mul(u, u[2])));
  const s = cross(fw, u), o = sd === 'r' ? -1 : 1;
  const T: number[] = [], PH: number[] = [], R: number[][] = [];
  for (let ph = 0; ph < 360; ph += 15) PH.push(ph);
  for (let t = -0.12; t <= 1.121; t += 0.04) {
    T.push(r4(t));
    const axis = add(head, mul(sub(tail, head), t));
    R.push(PH.map(ph => {
      const a = ph * Math.PI / 180, dir = norm(add(mul(fw, Math.cos(a)), mul(s, o * Math.sin(a))));
      // The arms ride one rigid capsule each: rest. Everything else: the posed envelope.
      return r4(arm ? radius(inFrame(poses[0]!, name, reach), axis, dir, 0.3) : envelope(name, reach, axis, dir, 0.3));
    }));
  }
  limbs[name] = { head: head.map(r4) as V, tail: tail.map(r4) as V, t: T, ph: PH, r: R };
}

const path = resolve(ROOT, `assets-source/zombie-kit/${NAME === 'zombie' ? 'surface' : `surface-${NAME}`}.json`);
writeFileSync(path, JSON.stringify({ name: NAME, torso, limbs }) + '\n');
console.log(`zombie-surface: ${path} (${torso.length} torso rings, ${Object.keys(limbs).length} limbs, envelope of ${poses.length} poses)`);
