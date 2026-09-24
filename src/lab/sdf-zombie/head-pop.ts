// src/lab/sdf-zombie/head-pop.ts
//
// HEAD POP DEBRIS (cultist, owner 2026-09-24): a soft target's head shot is
// "the radial spray, but with other elements ... ripped flesh and
// tissue/brain matter — and pronounced eyeballs that fly out egregiously in a
// comedic way". The spray is the blood sim's gib burst (game-main); THIS
// module builds the solid bits as SDF gib pieces for the chunk system
// (spawnChunkPiece: floor bounce, spin, the bake):
//   * two EYEBALLS, 2.5x life size, white with the character's own glowing
//     iris (its `glow=` eye prims' colour), a pupil and a dangling optic
//     nerve — launched fastest, highest and spinning hardest;
//   * brain lumps, flesh chunks, a skull shard and a rag of hood cloth.
// Pure: randomness comes in as a function; world-space prims around each
// piece's origin, exactly as posedDetachedChunk hands the sever path.
import type { LimbId, Primitive, Vec3 } from './types';

export interface GorePiece {
  limb: LimbId;
  origin: Vec3;
  prims: Primitive[];
  tornAt: Vec3[];
  bones: Primitive[];
  kind: 'gob';
  vel: Vec3;
  angVel: Vec3;
}

/** Linear-RGB paint for the debris. Eyeballed on the game capture. */
export const GORE_COLORS = {
  eyeWhite: [0.80, 0.76, 0.66] as Vec3,
  pupil: [0.02, 0.01, 0.01] as Vec3,
  nerve: [0.36, 0.04, 0.04] as Vec3,
  brain: [0.58, 0.38, 0.40] as Vec3,
  flesh: [0.30, 0.03, 0.03] as Vec3,
  bone: [0.72, 0.66, 0.52] as Vec3,
};

/** Eyeball radius: a real eye is ~12 mm; comedy wants it READ from 5 m. */
export const EYEBALL_R = 0.030;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function prim(a: Vec3, b: Vec3, radius: number, color: Vec3, o: Partial<Primitive> = {}): Primitive {
  return { a, b, radius, scale: [1, 1, 1], blendK: 0.003, limb: 'head', cluster: 0, color, ...o };
}

/** A random unit vector biased into the hemisphere around `bias`. */
function spray(rand: () => number, bias: Vec3, biasW: number): Vec3 {
  const th = rand() * Math.PI * 2, z = rand() * 2 - 1, r = Math.sqrt(1 - z * z);
  return norm(add([Math.cos(th) * r, Math.abs(z) * 0.8 + 0.2, Math.sin(th) * r], scale(bias, biasW)));
}

/**
 * The debris for one popped head. `head` is the popped chunk (world-space
 * prims, origin at the head); `dir` the shot. Eyeballs sit where the head's
 * glowing prims were (their colour becomes the iris); a head with none gets
 * two at +-3 cm, amber.
 */
export function headPopDebris(head: { origin: Vec3; prims: Primitive[] }, dir: Vec3, rand: () => number): GorePiece[] {
  const out: GorePiece[] = [];
  const shot = norm([dir[0], 0, dir[2]]);
  const glows = head.prims.filter(p => (p.glow ?? 0) > 0).slice(0, 2);
  const eyes = glows.length === 2
    ? glows.map(p => ({ at: scale(add(p.a, p.b), 0.5), iris: p.color ?? [1, 0.35, 0.05] as Vec3 }))
    : [-0.03, 0.03].map(x => ({ at: add(head.origin, [x, 0.02, 0.06]) as Vec3, iris: [1, 0.35, 0.05] as Vec3 }));

  for (const e of eyes) {
    // Local frame: the iris faces `look`, the nerve trails out of the back.
    const look = spray(rand, shot, 0.3);
    const o = e.at;
    out.push({
      limb: 'head', origin: o, kind: 'gob', tornAt: [], bones: [],
      prims: [
        prim(o, o, EYEBALL_R, GORE_COLORS.eyeWhite, { gloss: 0.6 }),
        prim(add(o, scale(look, EYEBALL_R * 0.72)), add(o, scale(look, EYEBALL_R * 0.72)), EYEBALL_R * 0.50, e.iris, { glow: 1.0, blendK: 0.001 }),
        prim(add(o, scale(look, EYEBALL_R * 1.05)), add(o, scale(look, EYEBALL_R * 1.05)), EYEBALL_R * 0.24, GORE_COLORS.pupil, { blendK: 0.001 }),
        prim(add(o, scale(look, -EYEBALL_R * 0.8)), add(o, scale(look, -EYEBALL_R * 3.2)), EYEBALL_R * 0.24, GORE_COLORS.nerve,
          { radiusB: EYEBALL_R * 0.10, bend: [0, -0.015, 0] }),
      ],
      // Highest and spinning hardest — the joke is the eyes, so they must be
      // SEEN: a big slow arc (apex ~0.5-0.8 m over the head, 1-2 m out), not
      // a bullet. The first cut (5-8 m/s + 3-5.5 up) left frame in 0.1 s.
      vel: add(scale(spray(rand, shot, 0.6), 1.5 + rand() * 1.5), [0, 3.2 + rand() * 0.8, 0]),
      angVel: [(rand() - 0.5) * 50, (rand() - 0.5) * 50, (rand() - 0.5) * 50],
    });
  }

  const gob = (color: Vec3, r: number, n: number, o: Partial<Primitive> = {}, speed = 3.5): void => {
    const origin = add(head.origin, scale(spray(rand, shot, 0), 0.04));
    const prims: Primitive[] = [];
    for (let i = 0; i < n; i++) {
      const off = scale(spray(rand, [0, 0, 0], 0), r * 0.8 * rand());
      prims.push(prim(add(origin, off), add(origin, off), r * (0.6 + 0.5 * rand()), color, { blendK: r * 0.4, ...o }));
    }
    out.push({
      limb: 'head', origin, prims, kind: 'gob', tornAt: [], bones: [],
      vel: add(scale(spray(rand, shot, 0.8), speed * (0.7 + 0.6 * rand())), [0, 1.5 + rand() * 1.5, 0]),
      angVel: [(rand() - 0.5) * 20, (rand() - 0.5) * 20, (rand() - 0.5) * 20],
    });
  };
  gob(GORE_COLORS.brain, 0.030, 3, { gloss: 0.5 });
  gob(GORE_COLORS.brain, 0.022, 2, { gloss: 0.5 });
  gob(GORE_COLORS.flesh, 0.026, 2, { gloss: 0.4 });
  gob(GORE_COLORS.flesh, 0.020, 2, { gloss: 0.4 });
  gob(GORE_COLORS.bone, 0.030, 1, { scale: [1.6, 0.35, 1.1] }, 4.5);
  // A rag of the hood, in the hood's paint when the head carried a shell.
  const hood = head.prims.find(p => p.shell && p.color);
  if (hood) gob(hood.color!, 0.045, 1, { scale: [1.5, 0.25, 1.2] }, 2.5);
  return out;
}
