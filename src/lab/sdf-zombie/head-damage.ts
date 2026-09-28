// src/lab/sdf-zombie/head-damage.ts
//
// THE MELEE HEAD DAMAGE LADDER (spec docs/superpowers/specs/2026-09-28-melee-head-damage-design.md §4).
// Pure: a head hit in, events out. The leaf (webgpu/game-head-damage.ts) turns events into wounds,
// deformation, the dangling eye, gore and the kill. Every head hit wobbles; then by count:
//   1 EYE    the eye on the hit side pops and dangles on its stalk
//   2 CAVE   a lasting dent and a face crater; the dangling eye snaps off
//   3 SCALP  the crown tears open to the skull
//   4 BRAIN  the crown bursts, the brain flies out, the zombie dies
//   5+       dent and face crater only
export type EyeSide = 'L' | 'R';

export interface HeadDamageState {
  hits: number;
  eye: { side: EyeSide; state: 'dangling' | 'gone' } | null;
  dead: boolean;
}

export type HeadEvent =
  | { kind: 'wobble' }
  | { kind: 'eye-pop'; side: EyeSide }
  | { kind: 'eye-snap' }
  | { kind: 'dent' }
  | { kind: 'face-crater' }
  | { kind: 'scalp' }
  | { kind: 'brain' }
  | { kind: 'kill' };

export function makeHeadDamage(): HeadDamageState {
  return { hits: 0, eye: null, dead: false };
}

/** One head-region hit. `eyeSide`: the eye nearer the hit point (the leaf measures it). */
export function headHit(s: HeadDamageState, hit: { eyeSide: EyeSide }): { state: HeadDamageState; events: HeadEvent[] } {
  const hits = s.hits + 1;
  const events: HeadEvent[] = [{ kind: 'wobble' }];
  let eye = s.eye, dead = s.dead;
  if (hits === 1) {
    events.push({ kind: 'eye-pop', side: hit.eyeSide });
    eye = { side: hit.eyeSide, state: 'dangling' };
  } else if (hits === 2) {
    events.push({ kind: 'dent' }, { kind: 'face-crater' });
    if (eye?.state === 'dangling') { events.push({ kind: 'eye-snap' }); eye = { ...eye, state: 'gone' }; }
  } else if (hits === 3) {
    events.push({ kind: 'scalp' });
  } else if (hits === 4) {
    events.push({ kind: 'brain' }, { kind: 'kill' });
    dead = true;
  } else {
    events.push({ kind: 'dent' }, { kind: 'face-crater' });
  }
  return { state: { hits, eye, dead }, events };
}

/** The zombie died some other way (collapse, dynamite): a dangling eye snaps off. */
export function headDeath(s: HeadDamageState): { state: HeadDamageState; events: HeadEvent[] } {
  if (s.eye?.state !== 'dangling') return { state: s, events: [] };
  return { state: { ...s, eye: { ...s.eye, state: 'gone' } }, events: [{ kind: 'eye-snap' }] };
}
