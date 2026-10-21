// src/lab/sdf-zombie/webgpu/level-bridge.ts
//
// THE BRIDGE BETWEEN LEVELS (spec 2026-10-21-night-train-to-flat-design.md §3.1): a level's `onComplete` says where the player goes when the level
// completes (`goto`, a level id; `params`, a query string; `bridge`, what plays while the next page loads). Pure: no DOM, no three.js. The runtime is
// game-bridge.ts. The bridge is a slot: a `card` now (a colour, a line of text, a hold), a rendered movie or a title later (a new `kind`).
export type RGB = readonly [number, number, number];
export type BridgeSpec = { kind: 'card'; rgb: RGB; text: string; holdS: number };
export interface OnComplete { goto: string; params: string; bridge: BridgeSpec | null }

const LEVEL_ID = /^[a-z0-9-]+$/;
export const isLevelId = (s: string): boolean => LEVEL_ID.test(s);
/** A hold longer than this is a typo, not a design. */
export const HOLD_MAX_S = 30;
const DEFAULT_HOLD_S = 2;
/** The query params that belong to the level being left: dropped from the carried-over search (the new level's own params replace them). */
const OWN_PARAMS = ['level', 'emergence', 'from'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseBridge(v: unknown, errors: string[]): BridgeSpec | null {
  if (!isObject(v)) { errors.push('onComplete.bridge: expected an object'); return null; }
  if (v.kind !== 'card') { errors.push(`onComplete.bridge.kind: unknown kind ${String(v.kind)} (known: card)`); return null; }
  const rgb = v.rgb === undefined ? [0, 0, 0] : v.rgb;
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(c => typeof c === 'number' && c >= 0 && c <= 1)) {
    errors.push('onComplete.bridge.rgb: expected [3 numbers from 0 to 1]');
    return null;
  }
  const text = v.text === undefined ? '' : v.text;
  if (typeof text !== 'string') { errors.push('onComplete.bridge.text: expected a string'); return null; }
  const holdS = v.holdS === undefined ? DEFAULT_HOLD_S : v.holdS;
  if (typeof holdS !== 'number' || !Number.isFinite(holdS) || holdS < 0 || holdS > HOLD_MAX_S) {
    errors.push(`onComplete.bridge.holdS: expected seconds from 0 to ${HOLD_MAX_S}`);
    return null;
  }
  return { kind: 'card', rgb: rgb as unknown as RGB, text, holdS };
}

/** `undefined` is no onComplete (null, no errors); anything else is validated. */
export function parseOnComplete(v: unknown, errors: string[]): OnComplete | null {
  if (v === undefined) return null;
  if (!isObject(v)) { errors.push('onComplete: expected an object'); return null; }
  for (const k of Object.keys(v)) if (k !== 'goto' && k !== 'params' && k !== 'bridge') errors.push(`onComplete: unknown key ${k}`);
  if (typeof v.goto !== 'string' || !isLevelId(v.goto)) { errors.push('onComplete.goto: must match [a-z0-9-]+'); return null; }
  let params = '';
  if (v.params !== undefined) {
    if (typeof v.params === 'string') params = v.params;
    else errors.push('onComplete.params: expected a string');
  }
  const bridge = v.bridge === undefined ? null : parseBridge(v.bridge, errors);
  return { goto: v.goto, params, bridge };
}

/** The seconds the bridge holds before the page hops. */
export function bridgeHoldS(b: BridgeSpec | null): number {
  return b ? Math.min(HOLD_MAX_S, Math.max(0, b.holdS)) : 0;
}

/** The next level's URL on the same page: `level`, then the level's own params, then whatever else the player booted with (`res`, `graphics`,
 *  `upscale`...). Null for a goto that is not a level id. */
export function targetUrl(pathname: string, onc: Pick<OnComplete, 'goto' | 'params'>, currentSearch: string): string | null {
  if (!isLevelId(onc.goto)) return null;
  const carried = new URLSearchParams(currentSearch);
  for (const k of OWN_PARAMS) carried.delete(k);
  const out = new URLSearchParams();
  out.set('level', onc.goto);
  for (const [k, v] of new URLSearchParams(onc.params)) out.set(k, v);
  for (const [k, v] of carried) if (!out.has(k)) out.set(k, v);
  return `${pathname}?${out.toString()}`;
}

export interface BridgeState { t: number; holdS: number; navigated: boolean }
/** One sim step of the bridge: navigates exactly once, on the step whose clock reaches the hold. */
export function stepBridge(s: BridgeState, dt: number): { state: BridgeState; navigate: boolean } {
  if (s.navigated) return { state: s, navigate: false };
  const t = s.t + dt;
  if (t >= s.holdS - 1e-9) return { state: { ...s, t, navigated: true }, navigate: true };
  return { state: { ...s, t }, navigate: false };
}
