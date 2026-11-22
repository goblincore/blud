// FLESH JIGGLE: a hit makes a soft mass on a rigid frame QUIVER, violently and out of shape (the cerebrax: owner,
// 2026-11-09, "the wobble when hit should be a bit more violent and distorted ... right now it just wobbles in place
// and is easy to miss"). Its frame is rigid (MotionProfile.rigidFrame), so the rig's flinch moves nothing; this moves
// the FLESH instead, as a post-pose deform of the posed prims (game-actor.ts repose, beside head-pop.ts inflateHead):
//
//   - BULK: the whole mass shoves along the shot and rings back, a damped spring (`bulk` m at a kick of gain 1).
//   - LOCAL: the lobes near the hit (gaussian over `reach` m) shove along the shot AND sideways, each at its own phase,
//     so neighbours pull apart and pile together: the shape distorts instead of scaling. Their radii squash and stretch
//     out of phase with their shove (`squash`, a share of the radius).
//
// Craters ride it for free: wounds are placed from the posed prims (damage.ts woundWorldPos), so a moved lobe carries
// its crater. Kit that sits on the flesh rides the BULK (jiggleBulk, laid on the kit's own bone by the caller); the
// prims within `calmReach` of `calmAt` (the face, where the eyes and teeth sit) take only a share of the LOCAL motion,
// so the kit eyes stay in their sockets.
//
// Pure: kicks in, prims out, world space. No kicks (or all rung out) returns the body untouched.
import type { Primitive, Vec3 } from './types';

export interface FleshJiggleSpec {
  /** Peak local shove of the struck lobes at a kick of gain 1 (m). */
  amp: number;
  /** Peak shove of the whole mass at a kick of gain 1 (m). Keep it under the clamp's clearance. */
  bulk: number;
  /** Ring frequency (Hz). */
  freq: number;
  /** Seconds for a kick to fall to 1/e. */
  decay: number;
  /** Gaussian reach of a kick's local shove (m). */
  reach: number;
  /** Radius squash and stretch at the struck lobes, a share of the radius at gain 1. */
  squash: number;
  /** Share of the LOCAL motion the calm zone (the face) takes, 0..1. */
  calm: number;
  /** The calm zone's radius (m). */
  calmReach: number;
}

export interface JiggleKick { at: Vec3; dir: Vec3; gain: number; t: number }

/** Kicks older than this many decays are dropped. */
const DEAD_DECAYS = 5;
/** At most this many kicks ring at once (a double barrel lands ~16 pellets in a frame). */
const MAX_KICKS = 6;
/** Their summed gain is capped here, so a point-blank volley is violent but stays in the clamp. */
const MAX_GAIN = 2.2;

/** A kick at `at` (world) along `dir` (world, any length; normalised here). */
export function kickJiggle(kicks: JiggleKick[], at: Vec3, dir: Vec3, gain: number): void {
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const d: Vec3 = l > 1e-9 ? [dir[0] / l, dir[1] / l, dir[2] / l] : [0, 0, 0];
  // Pellets of one volley land in the same frame: fold them into the newest kick when they are close.
  const last = kicks[kicks.length - 1];
  if (last && last.t === 0 && Math.hypot(last.at[0] - at[0], last.at[1] - at[1], last.at[2] - at[2]) < 0.35) {
    last.gain += gain;
  } else {
    kicks.push({ at: [...at] as Vec3, dir: d, gain, t: 0 });
    if (kicks.length > MAX_KICKS) kicks.shift();
  }
  let sum = 0;
  for (const k of kicks) sum += k.gain;
  if (sum > MAX_GAIN) for (const k of kicks) k.gain *= MAX_GAIN / sum;
}

/** Age every kick by `dt` and drop the rung-out ones. */
export function ageJiggle(kicks: JiggleKick[], dt: number, spec: FleshJiggleSpec): void {
  for (const k of kicks) k.t += dt;
  for (let i = kicks.length - 1; i >= 0; i--) if (kicks[i]!.t > spec.decay * DEAD_DECAYS) kicks.splice(i, 1);
}

/** A kick's ring at its age: a damped sine that starts at 0 (no pop on the frame it lands). */
function ring(k: JiggleKick, spec: FleshJiggleSpec, phase = 0): number {
  return k.gain * Math.exp(-k.t / spec.decay) * Math.sin(2 * Math.PI * spec.freq * k.t + phase);
}

/** The whole mass's shove now (world), for the kit that rides the flesh. */
export function jiggleBulk(kicks: readonly JiggleKick[], spec: FleshJiggleSpec): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const k of kicks) {
    const s = spec.bulk * ring(k, spec);
    x += k.dir[0] * s; y += k.dir[1] * s; z += k.dir[2] * s;
  }
  return [x, y, z];
}

/** A fixed per-prim phase and a sideways direction (a cheap hash of its index): neighbours ring out of step. */
function primPhase(i: number): number { return ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 2 * Math.PI; }
function sideways(i: number, d: Vec3): Vec3 {
  const a = primPhase(i + 7);
  // Any vector not along d, crossed with d, turned by the prim's own angle about d.
  const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u0: Vec3 = [d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]];
  const ul = Math.hypot(u0[0], u0[1], u0[2]) || 1;
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const c = Math.cos(a), s = Math.sin(a);
  return [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
}

/**
 * The posed body with its jiggling prims (`select`) moved and squashed. World space in and out. `calmAt` is the face
 * (world), or null for no calm zone.
 */
export function jiggleFlesh<B extends { prims: Primitive[] }>(
  body: B, kicks: readonly JiggleKick[], spec: FleshJiggleSpec,
  select: (p: Primitive) => boolean, calmAt: Vec3 | null,
): B {
  if (kicks.length === 0) return body;
  const bulk = jiggleBulk(kicks, spec);
  return {
    ...body,
    prims: body.prims.map((p, i) => {
      if (p.dead || !select(p)) return p;
      const c: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      const calm = calmAt && Math.hypot(c[0] - calmAt[0], c[1] - calmAt[1], c[2] - calmAt[2]) < spec.calmReach ? spec.calm : 1;
      let mx = bulk[0], my = bulk[1], mz = bulk[2];
      let sq = 0;
      const ph = primPhase(i);
      for (const k of kicks) {
        const r = Math.hypot(c[0] - k.at[0], c[1] - k.at[1], c[2] - k.at[2]) / spec.reach;
        const w = Math.exp(-r * r) * calm;
        if (w < 1e-3) continue;
        const along = spec.amp * w * ring(k, spec, ph);
        const side = sideways(i, k.dir), across = 0.6 * spec.amp * w * ring(k, spec, ph * 1.7 + 1.1);
        mx += k.dir[0] * along + side[0] * across;
        my += k.dir[1] * along + side[1] * across;
        mz += k.dir[2] * along + side[2] * across;
        sq += spec.squash * w * ring(k, spec, ph + Math.PI / 2);
      }
      const mv: Vec3 = [mx, my, mz];
      const ks = Math.max(0.6, 1 + sq);
      const out: Primitive = {
        ...p,
        a: [p.a[0] + mv[0], p.a[1] + mv[1], p.a[2] + mv[2]],
        b: [p.b[0] + mv[0], p.b[1] + mv[1], p.b[2] + mv[2]],
        radius: p.radius * ks,
        ...(p.radiusB !== undefined ? { radiusB: p.radiusB * ks } : {}),
      };
      if (p.shell) {
        const n = p.shell.clipNormal;
        out.shell = { ...p.shell, clipOffset: p.shell.clipOffset + n[0] * mv[0] + n[1] * mv[1] + n[2] * mv[2] };
      }
      return out;
    }),
  };
}

/** The rig point indices of a bone's head and tail: bindRig's own dedup (rest positions, `body.bones` order). */
export function boneEndPoints(bones: ReadonlyMap<string, { head: Vec3; tail: Vec3 }>, name: string): [number, number] | null {
  const pos: Vec3[] = [];
  const at = (p: Vec3): number => {
    for (let i = 0; i < pos.length; i++) if (Math.hypot(pos[i]![0] - p[0], pos[i]![1] - p[1], pos[i]![2] - p[2]) < 1e-4) return i;
    pos.push(p); return pos.length - 1;
  };
  let out: [number, number] | null = null;
  for (const [n, b] of bones) {
    const h = at(b.head), t = at(b.tail);
    if (n === name) out = [h, t];
  }
  return out;
}
