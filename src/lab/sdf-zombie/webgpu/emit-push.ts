// src/lab/sdf-zombie/webgpu/emit-push.ts
//
// EMITTER PUSH (owner 2026-10-29, after the B1 sheet: "push the screens and exit signs harder"). Three steps,
// each its own toggle so it can be judged alone: `?emitpush=spill,exit,key` (no param: all three; `none`: the
// B1 look; `all`; or any comma list).
//  - spill: the screen banks light the room around them. The converter places one light per facing group of
//    bank walls (scripts/levels/doom_map.py SPILL_*) and the baked bounce from screen banks runs SPILL_SCREEN_BAKE.
//  - exit: a red pool at each exit sign. The converter hangs the sign's light under it, stronger (EXIT_*), and
//    dims fluorescent lights near it; the bake runs signs at EXIT_SIGN_BAKE and fluorescent surfaces within
//    EXIT_DIM_BAKE_M of a sign (same zone) at EXIT_FLUORO_BAKE.
//  - key: a body's lights are ranked by what they actually deliver, power included (keyRankScale): the light
//    list normalises every lamp by its own power (bodyNorm), so a 1.5 sign and a 10 screen bank ranked alike
//    and the nearest won the key.
// The converter writes the lights of every placement combo (PUSH_COMBOS) and tags a light that is not in all
// of them with the combos it is in; keepPushedLight picks the booted combo's.
// Pure: no three.js, no DOM.

export type EmitPushStep = 'spill' | 'exit' | 'key';
export const EMIT_PUSH_STEPS: readonly EmitPushStep[] = ['spill', 'exit', 'key'];

/** The converter's placement combos (doom_map.py PUSH_COMBOS): which of spill / exit are on. */
export const PUSH_COMBOS = ['none', 'spill', 'exit', 'spill+exit'] as const;
export type PushCombo = typeof PUSH_COMBOS[number];

/** The steps a `?emitpush=` value turns on: absent or '' = all, 'none', 'all', or a comma list (unknown names ignored). */
export function parseEmitPush(param: string | null): ReadonlySet<EmitPushStep> {
  if (param === null || param.trim() === '' || param === 'all') return new Set(EMIT_PUSH_STEPS);
  if (param === 'none') return new Set();
  const known = new Set<string>(EMIT_PUSH_STEPS);
  return new Set(param.split(',').map(s => s.trim()).filter((s): s is EmitPushStep => known.has(s)));
}

/** The placement combo the steps boot. */
export function pushCombo(steps: ReadonlySet<EmitPushStep>): PushCombo {
  const s = steps.has('spill'), e = steps.has('exit');
  return s && e ? 'spill+exit' : s ? 'spill' : e ? 'exit' : 'none';
}

/** A converter light tagged `push` (the combos it is in) lives only in those; an untagged one is in all. */
export function keepPushedLight(push: readonly string[] | undefined, steps: ReadonlySet<EmitPushStep>): boolean {
  return push === undefined || push.includes(pushCombo(steps));
}

// --- the bake -------------------------------------------------------------------------------------------

/** spill: the screen banks' baked bounce, × the B1 bake (sector-emitters.ts EMIT_CLASS_BAKE screen 4). */
export const SPILL_SCREEN_BAKE = 3;
/** exit: the signs' baked bounce, × the B1 bake (EMIT_CLASS_BAKE sign 2). */
export const EXIT_SIGN_BAKE = 6;
/** exit: a fluorescent surface this near a sign (xz, its box to the sign's middle, same zone) bakes at EXIT_FLUORO_BAKE. */
export const EXIT_DIM_BAKE_M = 5;
export const EXIT_FLUORO_BAKE = 0.6;

type V3 = readonly [number, number, number];
/** The fields of sector-emitters.ts EmitterSurface the push reads. */
export interface PushSurface {
  kind: string;
  cls: 'screen' | 'fluoro' | 'sign';
  zone: number;
  centre: V3;
  min: readonly [number, number];
  max: readonly [number, number];
}

/** xz distance from a point to a box (0 inside). */
const boxDist = (p: V3, min: readonly [number, number], max: readonly [number, number]): number =>
  Math.hypot(Math.max(min[0] - p[0], 0, p[0] - max[0]), Math.max(min[1] - p[2], 0, p[2] - max[1]));

/** The bake multipliers, tunable at boot (?spillbake= ?exitbake= ?exitdim=, game-sector-mesh.ts). */
export interface PushBakeTune { spill: number; sign: number; fluoroDim: number }
export const DEFAULT_PUSH_BAKE: Readonly<PushBakeTune> = { spill: SPILL_SCREEN_BAKE, sign: EXIT_SIGN_BAKE, fluoroDim: EXIT_FLUORO_BAKE };

/** Per surface, the push's multiplier on its baked bounce (1 = the B1 bake). */
export function pushBakeGains(surfaces: readonly PushSurface[], steps: ReadonlySet<EmitPushStep>,
  tune: Readonly<PushBakeTune> = DEFAULT_PUSH_BAKE): number[] {
  const spill = steps.has('spill'), exit = steps.has('exit');
  const signs = exit ? surfaces.filter(s => s.cls === 'sign') : [];
  return surfaces.map(s => {
    if (spill && s.kind === 'screenBank') return tune.spill;
    if (exit && s.cls === 'sign') return tune.sign;
    if (exit && s.cls === 'fluoro' && signs.some(g => g.zone === s.zone && boxDist(g.centre, s.min, s.max) < EXIT_DIM_BAKE_M)) return tune.fluoroDim;
    return 1;
  });
}

// --- the key --------------------------------------------------------------------------------------------

/** keyRankScale's clamp: a light never ranks more than 4× or less than 0.1× its power-blind rank. */
export const KEY_SCALE_MIN = 0.1;
export const KEY_SCALE_MAX = 4;

/** The level's reference lamp power for the key: the median of its lamps' positive powers (0 when none). A level
 *  whose lamps share one power then ranks exactly as without the step. */
export function keyPowerRef(powers: readonly number[]): number {
  const p = powers.filter(v => v > 0).sort((a, b) => a - b);
  if (p.length === 0) return 0;
  const m = p.length >> 1;
  return p.length % 2 ? p[m]! : (p[m - 1]! + p[m]!) / 2;
}

/** A lamp's rank multiplier: its power over the level's reference, clamped. 1 without a reference. */
export function keyRankScale(power: number, ref: number): number {
  if (!(ref > 0) || !(power > 0)) return 1;
  return Math.min(KEY_SCALE_MAX, Math.max(KEY_SCALE_MIN, power / ref));
}
