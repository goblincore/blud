// src/lab/sdf-zombie/webgpu/game-player-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import { moveAim } from './free-aim';
import { PLAYER } from './game-player';
import { ROOMS, enclosureKeyAt } from './game-level';
import { updateHud } from './game-panels-leaves';
import { pushProbeWeight } from './game-probes-leaves';
import { applyUpscaleAbMode } from './game-render-leaves';
import { MAGAZINE_CAPACITY, RELOAD } from './game-viewmodel';
import { startReload, fire } from './game-weapon-leaves';
import { requestSlot, slotForKey } from './game-weapon-slots';
import { type DemoFrame } from './demo-recorder';

/** The mouse delta's effect, extracted so the live handler and the replay
 *  apply the IDENTICAL maths. Free aim moves the reticle (the camera follows
 *  from the tick); otherwise it turns the camera directly. */
export function applyMouseDelta(ctx: GameContext, dx: number, dy: number): void {
  if (ctx.player.freeAimOn) {
    // The mouse moves the RETICLE, not the camera. Turning is a consequence
    // of shoving the reticle past the dead zone, handled in the tick.
    ctx.weapon.aim = moveAim(ctx.weapon.aim, dx, dy);
  } else {
    ctx.player.player.yaw += dx * 0.0022;
    ctx.player.player.pitch = Math.min(PLAYER.pitchLimit,
      Math.max(-PLAYER.pitchLimit, ctx.player.player.pitch - dy * 0.0022));
  }
}

export const ROOM_ID_BY_NAME = new Map(ROOMS.map(r => [r.name, r.id] as const));

/** The player's room id, or -1 in a tunnel / the void. Zombies only notice
 *  a player who shares their room. */
export function playerRoomId(ctx: GameContext): number {
  return ROOM_ID_BY_NAME.get(enclosureKeyAt(ctx.player.player.pos[0], ctx.player.player.pos[2])) ?? -1;
}

/** Every keydown side effect, as RISING EDGES over a held-key snapshot. The
 *  listeners no longer do these inline: doing them here is what lets a
 *  replayed key set toggle slug mode exactly as a live press did. */
export function applyInputEdges(ctx: GameContext, next: Set<string>): void {
  const pressed = (code: string): boolean => next.has(code) && !ctx.player.prevInputKeys.has(code);
  // WEAPON SLOTS. 1 = grapeshot, 2 = dynamite. Refused while a bundle is lit:
  // a player holding a burning bundle cannot put it away, which is the game's
  // own rule (Blood's dynamite FSM has no exit from the armed state) and the
  // one thing that stops slot-mashing being a free overcook cancel.
  //
  // A RISING-EDGE SCAN, not a keydown listener (rebase onto the input-seam
  // refactor, 2026-09-15): the slot switch has to go through the same snapshot
  // every other edge does, or a replayed key set would not switch weapons and
  // the recording would diverge from the live run at the first slot press.
  for (const code of next) {
    if (ctx.player.prevInputKeys.has(code)) continue;
    const wantSlot = slotForKey(code);
    if (wantSlot === null) continue;
    if (ctx.vfx.cook.phase === 'cooking') {
      ctx.telemetry.telemetry.event('weapon-switch-refused', { slot: wantSlot, reason: 'cooking' });
    } else {
      const before = ctx.weapon.slotState;
      ctx.weapon.slotState = requestSlot(ctx.weapon.slotState, wantSlot);
      if (ctx.weapon.slotState !== before) ctx.telemetry.telemetry.event('weapon-switch', { to: wantSlot });
    }
    updateHud(ctx);
  }
  if (pressed('BracketLeft')) pushProbeWeight(ctx, ctx.probes.weight - 0.05);
  if (pressed('BracketRight')) pushProbeWeight(ctx, ctx.probes.weight + 0.05);
  if (pressed('KeyP')) {
    if (ctx.probes.weight > 0) { ctx.player.parked = ctx.probes.weight; pushProbeWeight(ctx, 0); }
    else pushProbeWeight(ctx, ctx.player.parked);
  }
  if (pressed('KeyE')) { ctx.weapon.slugMode = !ctx.weapon.slugMode; updateHud(ctx); }
  // Neural upscale A/B (dev-only, P3): native -> nearest -> model while an
  // upscale config is active. One toggle per rising edge, as before
  // (the old handler's `!e.repeat` guard is the same thing here).
  if (pressed('KeyU') && ctx.render.upscaleAb.config) {
    applyUpscaleAbMode(ctx, ctx.render.upscaleAb.mode === 'native' ? 'nearest' : ctx.render.upscaleAb.mode === 'nearest' ? 'model' : 'native');
  }
  // H hides/shows EVERY tuning panel together. They cover most of the
  // viewport, and until now the only way to dismiss them was to know the
  // console API -- which is no use to someone doing a look pass.
  // G toggles free aim, so the two schemes can be A/B'd back to back.
  if (pressed('KeyG')) {
    ctx.player.freeAimOn = !ctx.player.freeAimOn;
    ctx.weapon.aim = { x: 0, y: 0 };
    updateHud(ctx);
  }
  if (pressed('KeyH')) {
    ctx.panels.hidden = !ctx.panels.hidden;
    ctx.panels.woundPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.gooPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.vhsPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.dynamitePanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.shutterPanel?.setVisible(!ctx.panels.hidden);
  }
  // Manual reload. Dead under unlimited ammo BY CONSTRUCTION (the magazine is
  // never partial), which is why ?ammo=finite is the way to exercise it.
  if (pressed('KeyR') && ctx.weapon.shells < MAGAZINE_CAPACITY && ctx.weapon.reloadAge > RELOAD.totalSec) {
    startReload(ctx);
  }
  if (pressed('KeyT')) {
    ctx.weapon.reloadSpeed = ctx.weapon.reloadSpeed === 1 ? 0.25 : ctx.weapon.reloadSpeed === 0.25 ? 0.1 : 1;
    updateHud(ctx);
  }
}

/** Apply one frame of input. THE single mutation point for player input —
 *  live play and replay both arrive here, so a replay is not a lookalike of
 *  the live path, it IS the live path. `look` is re-pinned last so float
 *  drift in the recorded deltas cannot compound down a run. */
export function applyInputFrame(ctx: GameContext, f: DemoFrame): void {
  const next = new Set(f.keys);
  applyInputEdges(ctx, next);
  if (f.dx !== 0 || f.dy !== 0) applyMouseDelta(ctx, f.dx, f.dy);
  // Anti-drift absolute pin. Skipped in free aim, where the pose is a
  // consequence of the reticle rather than a thing the mouse set directly.
  if (!ctx.player.freeAimOn) {
    ctx.player.player.yaw = f.look[0];
    ctx.player.player.pitch = f.look[1];
  }
  if (f.fire === 1) fire(ctx, 1);
  else if (f.fire === 2) fire(ctx, 2);
  // Slot 3's edge, consumed on the tick like every other verb.
  ctx.weapon.flare?.consumeEdge();
  // The KeyR edge above already covers a live press; this covers a recorded
  // frame whose reload was folded into the flag rather than the keys.
  if (f.reload && ctx.weapon.shells < MAGAZINE_CAPACITY && ctx.weapon.reloadAge > RELOAD.totalSec) startReload(ctx);
  ctx.player.prevInputKeys = next;
}
