// src/lab/sdf-zombie/gib-tear.ts
//
// THE PRE-TEAR WINDOW — the shockwave bending the flesh BEFORE the body comes
// apart. This is the owner's own idea, from the review that started the gib
// pass: *"the SDF flesh potentially allows us to distort the flesh from the
// shockwave and jiggle and then rip away"*.
//
// WHY IT IS A JS PRIM DISPLACEMENT AND NOT A SHADER TERM. The design note
// claimed "the march already supports per-prim displacement (wounds carve, the
// rig re-solves, bodyFlash/impulse paths exist), so a pre-tear window is a
// per-frame uniform plus a shader term". Checked against the source: `wounds
// carve` is per-WOUND (radial around a crater, and a gibbing blast stamps none),
// `the rig re-solves` is true and per-frame, `bodyFlash` is colour-only, and
// there is NO uniform anywhere that displaces the marched field per prim — a
// new one would have to be threaded through `mapBody`'s 19-parameter positional
// signature, its 13 call sites, the material binding order and the chunk-view
// copy list. The pose path, by contrast, ALREADY re-packs every prim row and
// recomputes every cull bound every frame (rig-bind.applyRig -> view.update ->
// pack.ts), so displacing the POSED prims costs one pure function and nothing
// else: the pack, the proxy box, the cluster spheres and the hull all follow by
// construction. That is the same idiom fpv-mode's hand jiggle has shipped since
// the goblin arms.
//
// IT IS VIEW-ONLY, ON PURPOSE. `tearPosed` returns a COPY; the actor's own
// `posed()` stays clean, so everything that reads the body for real — the
// resolver's traces, the wound ring, and the gib's own piece set — sees the
// body as it actually is. The distortion is what the MARCH draws for the length
// of the window, and nothing else. That also makes the hand-off exact: the
// pieces are spawned from the clean posed body, so the frame the body
// disappears is the frame the pieces are, in the same pose.
import type { BuildResult } from './build-body';
import type { Primitive, Vec3 } from './types';
import { refitClusters } from './rig-bind';
import { add, len, scale, sub } from './vec';

/**
 * The window's shape. ALL of it is in one place so a look pass has one place to
 * look, and every value is a `number` rather than a literal: the page retunes
 * this per actor (`ZombieActor.setTearTuning`), and `as const` would have made
 * `{ sec: 0.08 }` a type error against a field typed as `0.1`.
 */
export interface TearTuning {
  /** Seconds the body is bent by the blast before it becomes pieces. */
  sec: number;
  /** Peak displacement, metres, at the surface facing the blast. */
  amplitudeM: number;
  /** Distance over which the displacement decays, metres: e^{-d/falloff}. */
  falloffM: number;
  /** Shudder rate. The window is ~0.1 s, so ~2 cycles read as a shudder;
   *  much more than that reads as a buzz. */
  jiggleHz: number;
  /** Shudder depth as a fraction of the displacement. Under 1 so the push is
   *  never inward: the flesh is driven OUT from the blast and wobbles on the
   *  way, it does not pump. */
  jiggleAmp: number;
}

export const TEAR_TUNING: TearTuning = {
  /** Seconds the body is bent by the blast before it becomes pieces. */
  sec: 0.1,
  /** Peak displacement, metres, at the surface facing the blast. */
  amplitudeM: 0.035,
  /** Distance over which the displacement decays, metres: e^{-d/falloff}. */
  falloffM: 0.6,
  /** Shudder rate. The window is ~0.1 s, so ~2 cycles read as a shudder and
   *  more than that reads as a buzz. */
  jiggleHz: 20,
  /** Shudder depth as a fraction of the displacement. Under 1 so the push is
   *  never inward: the flesh is driven OUT from the blast and wobbles on the
   *  way, it does not pump. */
  jiggleAmp: 0.4,
};

const TAU = Math.PI * 2;
/** Golden angle, in radians — spreads consecutive prims' shudder phases as
 *  evenly as any constant can, with no RNG (this path must stay deterministic:
 *  the capture rigs compare runs). */
const PHASE_STEP = 2.399963229728653;

/**
 * The window's envelope, 0..1. Snaps OUT over the first fifth — a blast arrives
 * as an impulse, not a fade — and then relaxes linearly to nothing at the end,
 * so the last frame of the window is the body's own shape and the hand-off to
 * the pieces has no snap to hide.
 *
 * `t` is seconds since the tear began; anything outside the window is 0, so a
 * caller that forgets to stop calling this is inert rather than wrong.
 */
export function tearAmount(t: number, sec: number = TEAR_TUNING.sec): number {
  if (!(sec > 0) || !(t > 0)) return 0;
  if (t >= sec) return 0;
  const u = t / sec;
  // smoothstep(0, 0.2, u): 0 at the blast, 1 by a fifth of the window.
  const rise = u <= 0 ? 0 : u >= 0.2 ? 1 : (u / 0.2) * (u / 0.2) * (3 - 2 * (u / 0.2));
  return rise * (1 - u);
}

/** A live tear: where the blast was, how hard it hit, how long it has run. */
export interface TearState {
  at: Vec3;
  /** The resolver's falloff at this body, 0..1 — a grazing blast barely bends. */
  falloff: number;
  age: number;
}

/**
 * Bend a POSED body away from the blast. Pure: `posed` is not mutated, and the
 * returned body's cluster spheres are refitted so the march's outer bound still
 * covers the displaced flesh (an under-covering bound CULLS — see
 * refitClusters).
 *
 * Every prim is translated along its own outward direction by
 * `amplitude × e^{-dist/falloffM} × shudder`, so the flesh nearest the blast
 * moves most and the body is stretched away from it — which is what a
 * shockwave does to a body it is passing through, and what the shudder then
 * makes read as meat rather than as a slide.
 */
export function tearPosed(
  posed: BuildResult,
  tear: TearState,
  tuning: TearTuning = TEAR_TUNING,
): BuildResult {
  const amount = tearAmount(tear.age, tuning.sec);
  if (amount <= 0) return posed;
  const amp = tuning.amplitudeM * Math.max(0, Math.min(1, tear.falloff)) * amount;
  if (amp <= 0) return posed;

  const phase0 = TAU * tuning.jiggleHz * tear.age;
  let index = 0;
  const displace = (p: Primitive): Primitive => {
    const centre: Vec3 = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    const off = sub(centre, tear.at);
    const dist = len(off);
    // A prim sitting exactly ON the blast point has no outward direction. The
    // body's up is the only axis that means anything there, and it only has to
    // be stable — a division by zero here would put a NaN in the prim rows and
    // blank the body rather than bend it.
    const dir: Vec3 = dist < 1e-5 ? [0, 1, 0] : scale(off, 1 / dist);
    const weight = Math.exp(-dist / tuning.falloffM);
    const shudder = 1 + tuning.jiggleAmp * Math.sin(phase0 + index * PHASE_STEP);
    const d = amp * weight * shudder;
    index++;
    if (d <= 0) return p;
    const shift = scale(dir, d);
    return { ...p, a: add(p.a, shift), b: add(p.b, shift) };
  };

  const prims = posed.prims.map(displace);
  // Bones ride the same push, each by its own weight: leave them behind and a
  // femur pokes out of a thigh that has just moved 3.5 cm.
  const bonePrims = (posed.bonePrims ?? []).map(displace);
  return { ...posed, prims, bonePrims, clusters: refitClusters(prims, posed.clusters) };
}
