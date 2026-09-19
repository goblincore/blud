// src/lab/sdf-zombie/webgpu/game-weapon-slots.ts
//
// WEAPON SLOTS for sdf-game.html — numbers and state only, no Three.js import,
// for the same reason game-viewmodel.ts is pure: the switch is a timing
// question, and timing is what is worth testing without a renderer.
//
// One three-phase machine, deliberately:
//
//   lowering   the LIVE model drops out of frame (down 0→1)
//   raising    the frame has been handed over; the new model rises (up 0→1)
//   up         settled — the live weapon is the only one in frame and may fire
//
// `live` is what may fire; `target` is what the player asked for. They differ
// only while `lowering`. Firing is refused for the WHOLE switch (the Doom rule,
// and the reason a player cannot cancel a bad throw by mashing a slot key).
//
// Picking the weapon already in hand CANCELS a switch instead of completing it
// (the third phase, entered backwards): the model comes back up from wherever
// its drop had reached, so a mis-keyed slot is free. Retargeting mid-switch
// keeps the travel already spent, so the model never teleports back to the top
// of its drop and falls again.
//
// `slotLowerAmount` is the whole rendering contract, and it is total: in every
// phase exactly one slot is at 0 (in frame) or on its way there, and every
// OTHER slot is at 1 (fully holstered). No caller needs to know which phase it
// is in.

/** Which weapon the player is holding. `shotgun` is the grapeshot double.
 *  `flare` is the 2026-09-18 in-game burning-test harness: slot 3, no
 *  projectile, no damage — its only verb is igniting the actor it hits. */
export type WeaponSlot = 'shotgun' | 'dynamite' | 'flare';

/** Slot order, which is ALSO the number-key order (1 → shotgun, 2 → dynamite,
 *  3 → flare). */
export const WEAPON_SLOTS: readonly WeaponSlot[] = ['shotgun', 'dynamite', 'flare'];

/** `event.code` → slot. Only these keys select a weapon; every other key falls
 *  through to the existing handlers untouched. */
export const SLOT_BY_KEY: Readonly<Record<string, WeaponSlot>> = {
  Digit1: 'shotgun',
  Digit2: 'dynamite',
  Digit3: 'flare',
};

/** Slot for a keydown code, or null when the key is not a slot key. */
export function slotForKey(code: string): WeaponSlot | null {
  return SLOT_BY_KEY[code] ?? null;
}

export const WEAPON_SWITCH = {
  /** Seconds for the outgoing model to drop out of frame. Short — these guns
   *  are small and the player is usually mid-fight. */
  lowerSec: 0.18,
  /** Seconds for the incoming model to rise. Slightly longer than the drop so
   *  the raise reads as deliberate rather than as a snap. */
  raiseSec: 0.24,
} as const;

export type WeaponSwitchPhase = 'lowering' | 'raising' | 'up';

export interface WeaponSlotState {
  /** Selected slot — the one that will be up when the switch completes. */
  target: WeaponSlot;
  /** The slot that is up right now — the ONLY one that may fire. Equals
   *  `target` in every phase except `lowering`. */
  live: WeaponSlot;
  /** 0..1 lower travel of the LIVE model. Only meaningful while `lowering`. */
  down: number;
  /** 0..1 raise travel of the LIVE model. Only meaningful while `raising`. */
  up: number;
  phase: WeaponSwitchPhase;
}

export function makeWeaponSlotState(current: WeaponSlot = 'shotgun'): WeaponSlotState {
  return { target: current, live: current, down: 0, up: 1, phase: 'up' };
}

/**
 * Select a slot.
 *
 *  - the slot already selected: no-op.
 *  - the slot already IN HAND while switching: cancels — it comes back up from
 *    wherever its drop had reached (fully down during `raising`, part-way
 *    during `lowering`).
 *  - the other slot: retargets, keeping the travel already spent.
 */
export function requestSlot(state: WeaponSlotState, slot: WeaponSlot): WeaponSlotState {
  if (slot === state.target) return state;
  if (slot === state.live) {
    // Reached only while `lowering` (in the other two phases live === target,
    // which the guard above already returned on). Continuous: the cancelled
    // model comes back up from its own current height.
    const up = 1 - state.down;
    return { target: slot, live: slot, down: 0, up, phase: up >= 1 ? 'up' : 'raising' };
  }
  if (state.phase === 'raising') {
    // Retarget while the incoming weapon is rising: the model in hand now
    // drops again FROM WHERE IT IS, then the newly picked one rises. Without
    // the 1 − up hand-off the rising model would pop fully up and re-drop.
    return { target: slot, live: state.live, down: 1 - state.up, up: 0, phase: 'lowering' };
  }
  // Retarget mid-lower: `live` is untouched, so the drop keeps its progress.
  return { ...state, target: slot, phase: state.phase === 'up' ? 'lowering' : state.phase };
}

/** One frame of the switch. Frame-rate independent by construction: travel is
 *  integrated against fixed durations, not against per-frame constants. */
export function stepWeaponSlot(state: WeaponSlotState, dt: number): WeaponSlotState {
  const d = dt > 0 ? dt : 0;
  const S = WEAPON_SWITCH;

  switch (state.phase) {
    case 'up':
      return state;

    case 'lowering': {
      const down = Math.min(1, state.down + d / S.lowerSec);
      if (down < 1) return { ...state, down };
      // Fully down: hand the frame over, and spend the REMAINDER of this frame
      // on the raise so a slow frame does not stall an extra one at the bottom.
      const spent = (1 - state.down) * S.lowerSec;
      const up = Math.min(1, Math.max(0, d - spent) / S.raiseSec);
      return { target: state.target, live: state.target, down: 0, up, phase: up < 1 ? 'raising' : 'up' };
    }

    case 'raising': {
      const up = Math.min(1, state.up + d / S.raiseSec);
      return up < 1
        ? { ...state, up }
        : { target: state.target, live: state.target, down: 0, up: 1, phase: 'up' };
    }
  }
}

/** True only when the live weapon is fully up — the single gate for firing. */
export function slotReady(state: WeaponSlotState): boolean {
  return state.phase === 'up';
}

/**
 * 0 = fully up and at rest, 1 = fully lowered out of frame, for ONE slot.
 * TOTAL over the phases — see the header: one slot is always at 1.
 */
export function slotLowerAmount(state: WeaponSlotState, slot: WeaponSlot): number {
  switch (state.phase) {
    case 'up': return slot === state.live ? 0 : 1;
    case 'lowering': return slot === state.live ? state.down : 1;
    case 'raising': return slot === state.live ? 1 - state.up : 1;
  }
}
