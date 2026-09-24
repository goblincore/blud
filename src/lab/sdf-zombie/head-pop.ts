// src/lab/sdf-zombie/head-pop.ts
//
// HEAD POP (cultist, owner 2026-09-24). The reference is the Scanners head
// explosion: the head SWELLS for a beat (0.3-0.5 s, `inflateHead`), then
// bursts from its whole volume. v1 (the head vanished into a 10-bead point
// burst) read as "the head disappears and a pinpoint mist replaces it".
//
// DEBRIS: a soft target's head shot is
// "the radial spray, but with other elements ... ripped flesh and
// tissue/brain matter — and pronounced eyeballs that fly out egregiously in a
// comedic way". The spray is the blood sim's gib burst (game-main); THIS
// module builds the solid bits as SDF gib pieces for the chunk system
// (spawnChunkPiece: floor bounce, spin, the bake):
//   * two EYEBALLS, 2.5x life size, white with the character's own glowing
//     iris (its `glow=` eye prims' colour), a pupil and a dangling optic
//     nerve — launched fastest, highest and spinning hardest;
//   * the head ITSELF, shattered (`shatterHead`): its small painted features
//     (teeth, nose, brow, sockets) fly as they are; its big masses (the face
//     ellipsoid, the jaw, the hood peak) break into lumps in their own paint
//     (unpainted = the palette's skin); the hood sheet tears into rags; brain
//     and raw meat lumps from the inside. Grouped by direction from the head
//     centre into ~6 flying clumps, so a pop costs ~8 gib views, not 30.
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

  out.push(...shatterHead(head, shot, rand));
  return out;
}

/** Swell curve: 1 at the hit, ~1 + SWELL_MAX at the pop, accelerating. */
export const SWELL_MAX = 0.6;
export function swellScale(u: number): number {
  const x = Math.min(Math.max(u, 0), 1);
  return 1 + SWELL_MAX * x * x;
}

/**
 * The swelling head: every live head prim pushed out from the head centre and
 * grown by the swell, each with its own lumpy wobble (a strained, uneven
 * bulge, not a balloon) and a shared tremor. Shell clip planes scale with
 * their sheet (dot(p, n) < d about centre c: d' = k d + (1 - k) n.c), so the
 * hood's opening stays where the hood is. `u` 0..1 through the swell, `t` a
 * clock for the wobble. Non-head prims are untouched (the same objects).
 */
export function inflateHead<B extends { prims: Primitive[] }>(body: B, u: number, t: number): B {
  const head = body.prims.filter(p => p.limb === 'head' && !p.dead);
  if (head.length === 0 || u <= 0) return body;
  let cx = 0, cy = 0, cz = 0;
  for (const p of head) { cx += (p.a[0] + p.b[0]) / 2; cy += (p.a[1] + p.b[1]) / 2; cz += (p.a[2] + p.b[2]) / 2; }
  const c: Vec3 = [cx / head.length, cy / head.length, cz / head.length];
  const base = swellScale(u) - 1;
  const x = Math.min(Math.max(u, 0), 1);
  const shake: Vec3 = [Math.sin(t * 61) * 0.006 * x, Math.sin(t * 47 + 1) * 0.004 * x, Math.sin(t * 53 + 2) * 0.006 * x];
  let i = 0;
  return {
    ...body,
    prims: body.prims.map(p => {
      if (p.limb !== 'head' || p.dead) return p;
      const k = 1 + base * (1 + 0.3 * Math.sin(t * 29 + i++ * 1.7));
      const mv = (v: Vec3): Vec3 => [c[0] + (v[0] - c[0]) * k + shake[0], c[1] + (v[1] - c[1]) * k + shake[1], c[2] + (v[2] - c[2]) * k + shake[2]];
      const out: Primitive = { ...p, a: mv(p.a), b: mv(p.b), radius: p.radius * k,
        ...(p.radiusB !== undefined ? { radiusB: p.radiusB * k } : {}) };
      if (p.shell) {
        const n = p.shell.clipNormal;
        const nc = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
        const ns = n[0] * shake[0] + n[1] * shake[1] + n[2] * shake[2];
        out.shell = { ...p.shell, clipOffset: k * p.shell.clipOffset + (1 - k) * nc + ns };
      }
      return out;
    }),
  };
}

/** Raw meat inside the head, and brain. */
const MEAT: Vec3 = [0.32, 0.03, 0.03];

/**
 * Shatter a popped head into flying clumps (see the header). World space in,
 * world space out. `shot` is the horizontal shot direction; eyes (glowing
 * prims) are left out — headPopDebris makes eyeballs of them.
 */
export function shatterHead(head: { origin: Vec3; prims: Primitive[] }, shot: Vec3, rand: () => number): GorePiece[] {
  const c = head.origin;
  const items: Primitive[] = [];
  const lump = (at: Vec3, r: number, color: Vec3 | undefined, o: Partial<Primitive> = {}): void => {
    items.push({ a: at, b: at, radius: r, scale: [1, 1, 1], blendK: r * 0.35, limb: 'head', cluster: 0,
      ...(color ? { color } : {}), ...o });
  };
  const onSurface = (p: Primitive): Vec3 => {
    const m: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const d = spray(rand, [0, 0, 0], 0);
    const r = p.radius * Math.max(...p.scale) * (0.5 + 0.4 * rand());
    return [m[0] + d[0] * r, m[1] + d[1] * r * 0.6, m[2] + d[2] * r];
  };
  for (const p of head.prims) {
    if (p.dead || p.op === 'sub' || p.op === 'groove' || p.op === 'bone' || p.op === 'organ') continue;
    if ((p.glow ?? 0) > 0) continue;
    if (p.shell) {
      // The hood tears into rags in its own paint.
      for (let i = 0; i < 3; i++) lump(onSurface(p), 0.05 + 0.02 * rand(), p.color, { scale: [1.5, 0.22, 1.2], blendK: 0.004 });
      continue;
    }
    const size = Math.max(p.radius, p.radiusB ?? 0) * Math.max(...p.scale);
    if (size > 0.045) {
      for (let i = 0; i < 3; i++) lump(onSurface(p), 0.026 + 0.012 * rand(), p.color);
      lump(onSurface(p), 0.024, MEAT, { gloss: 0.4 });
    } else {
      items.push({ ...p });
    }
  }
  for (let i = 0; i < 3; i++) lump(add(c, scale(spray(rand, [0, 0, 0], 0), 0.04 * rand())), 0.028 + 0.01 * rand(), GORE_COLORS.brain, { gloss: 0.5 });
  // Six clumps by direction from the centre.
  const axes: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const groups: Primitive[][] = axes.map(() => []);
  for (const it of items) {
    const m: Vec3 = [(it.a[0] + it.b[0]) / 2 - c[0], (it.a[1] + it.b[1]) / 2 - c[1], (it.a[2] + it.b[2]) / 2 - c[2]];
    let best = 0, bd = -Infinity;
    axes.forEach((ax, i) => { const d = ax[0] * m[0] + ax[1] * m[1] + ax[2] * m[2]; if (d > bd) { bd = d; best = i; } });
    groups[best]!.push(it);
  }
  const out: GorePiece[] = [];
  groups.forEach((g, i) => {
    if (g.length === 0) return;
    let ox = 0, oy = 0, oz = 0;
    for (const p of g) { ox += (p.a[0] + p.b[0]) / 2; oy += (p.a[1] + p.b[1]) / 2; oz += (p.a[2] + p.b[2]) / 2; }
    const origin: Vec3 = [ox / g.length, oy / g.length, oz / g.length];
    const out0 = norm(add(axes[i]!, scale(spray(rand, [0, 0, 0], 0), 0.5)));
    out.push({
      limb: 'head', origin, prims: g, kind: 'gob', tornAt: [], bones: [],
      vel: add(add(scale(out0, 3 + rand() * 2.5), scale(shot, 1.5)), [0, 1.2 + rand(), 0]),
      angVel: [(rand() - 0.5) * 24, (rand() - 0.5) * 24, (rand() - 0.5) * 24],
    });
  });
  return out;
}
