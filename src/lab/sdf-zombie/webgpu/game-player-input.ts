// src/lab/sdf-zombie/webgpu/game-player-input.ts
//
// Player input helpers: mouse look, key-edge handling, per-frame input application and the player's current room.
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { ownsSlot } from './game-loop';
import { type GameContext } from './game-context';
import { moveAim } from './free-aim';
import { PLAYER } from './game-player';
import { roomIdAt } from './game-level-rooms';
import { updateHud } from './game-hud';
import { toggleFlashlight } from './game-dynamic-light';
import { pushProbeWeight } from './game-probe-weight';
import { applyUpscaleAbMode } from './game-render-controls';
import { MAGAZINE_CAPACITY, RELOAD } from './game-viewmodel';
import { startReload, fire } from './game-weapon-rig';
import { requestSlot, slotForKey } from './game-weapon-slots';
import { type DemoFrame } from './demo-recorder';
import { arenaRespawn } from './game-arena';
import { toggleBulletTime } from '../bullet-time';
import { freeAimFor, mouselookTurn, pinLook } from './aim-style';

/** The mouse delta's effect, extracted so the live handler and the replay
 *  apply the IDENTICAL maths. Free aim moves the reticle (the camera follows
 *  from the tick); otherwise it turns the camera directly. */
export function applyMouseDelta(ctx: GameContext, dx: number, dy: number): void {
  if (ctx.player.freeAimOn) {
    // The mouse moves the RETICLE, not the camera. Turning is a consequence
    // of shoving the reticle past the dead zone, handled in the tick.
    ctx.weapon.aim = moveAim(ctx.weapon.aim, dx, dy);
  } else {
    const t = mouselookTurn(ctx.player.player.yaw, ctx.player.player.pitch, dx, dy, PLAYER.pitchLimit);
    ctx.player.player.yaw = t.yaw;
    ctx.player.player.pitch = t.pitch;
  }
}

/** PER-WEAPON AIM STYLE (aim-style.ts): when the selected slot changes, free aim follows that weapon's style (the
 *  shotgun is mouselook, the rest free aim) unless the session override (G / setFreeAim) is set. Only on a CHANGE,
 *  so a replay or bench run that set freeAimOn from its recording keeps it. A reticle left off-centre by a switch
 *  into mouselook eases home in the tick (easeAimToCentre); the camera does not move. */
export function syncAimStyle(ctx: GameContext): void {
  const slot = ctx.weapon.slotState.target;
  if (slot === ctx.player.aimStyleSlot) return;
  ctx.player.aimStyleSlot = slot;
  const on = freeAimFor(slot, ctx.player.freeAimOverride);
  if (on !== ctx.player.freeAimOn) { ctx.player.freeAimOn = on; updateHud(ctx); }
}

/** Set (true/false) or clear (null) the session free-aim override, and apply it now. */
export function setFreeAimOverride(ctx: GameContext, on: boolean | null): boolean {
  ctx.player.freeAimOverride = on;
  ctx.player.freeAimOn = freeAimFor(ctx.weapon.slotState.target, on);
  ctx.player.aimStyleSlot = ctx.weapon.slotState.target;
  updateHud(ctx);
  return ctx.player.freeAimOn;
}

/** The player's room id, or -1 in a tunnel / the void. Zombies only notice
 *  a player who shares their room. */
export function playerRoomId(ctx: GameContext): number {
  return roomIdAt(ctx, ctx.player.player.pos[0], ctx.player.player.pos[2]);
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
    if (!ownsSlot(ctx, wantSlot)) continue;   // the game loop: only weapons the player has found
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
  // G toggles free aim, so the two schemes can be A/B'd back to back. It is a SESSION override of the per-weapon
  // style (aim-style.ts): after a press every weapon uses the toggled scheme until the page reloads (or
  // __sdfGame.setFreeAim(null) hands it back to the weapons). The reticle eases home rather than snapping.
  if (pressed('KeyG')) setFreeAimOverride(ctx, !ctx.player.freeAimOn);
  // C hides/shows the crosshair and the strafe steering cursor (aiming is
  // unchanged; only the markers go).
  if (pressed('KeyC')) ctx.player.reticleHidden = !ctx.player.reticleHidden;
  if (pressed('KeyH')) {
    ctx.panels.hidden = !ctx.panels.hidden;
    ctx.panels.woundPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.gooPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.vhsPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.lightLayersPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.dynamitePanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.shutterPanel?.setVisible(!ctx.panels.hidden);
    ctx.panels.bulletTimePanel?.setVisible(!ctx.panels.hidden);
  }
  // Launcher R demonstrates a live-round reload; its reserve is unlimited.
  // Shotgun R still requires a partial finite magazine.
  if (pressed('KeyR')) {
    if (ctx.weapon.slotState.live === 'launcher') ctx.weapon.launcher?.reload();
    else if (ctx.weapon.slotState.live === 'shotgun' && ctx.weapon.shells < MAGAZINE_CAPACITY && ctx.weapon.reloadAge > RELOAD.totalSec) startReload(ctx);
  }
  if (pressed('KeyF')) toggleFlashlight(ctx);          // the flashlight, once the player has it
  // THE TEST ARENA (game-arena.ts; a level with "arena": true): ` respawns the enemy, - / = step to another character.
  if (ctx.world.level.def?.arena) {
    if (pressed('Backquote')) arenaRespawn(ctx, 0);
    if (pressed('Minus')) arenaRespawn(ctx, -1);
    if (pressed('Equal')) arenaRespawn(ctx, 1);
  }
  // BULLET TIME (bullet-time.ts), dev trigger: the world slows to a crawl, the player does not.
  if (pressed('KeyQ')) {
    toggleBulletTime(ctx.player.bulletTime);
    ctx.telemetry.telemetry.event('bullet-time', { on: ctx.player.bulletTime.on });
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
  if (!ctx.demo.replayActive) syncAimStyle(ctx);
  if (f.dx !== 0 || f.dy !== 0) applyMouseDelta(ctx, f.dx, f.dy);
  // Anti-drift absolute pin. Skipped in free aim, where the pose is a
  // consequence of the reticle rather than a thing the mouse set directly.
  // LIVE, the frame's look was snapshotted (readInputFrame) BEFORE this
  // frame's delta, so pinning to it undid every mouselook turn — the G bug
  // ("turned off free aim but also normal aiming"). Live, the pose the delta
  // produced IS the frame's look (written back, so the recorder logs it);
  // replaying, the recorded look wins (pinLook).
  if (!ctx.player.freeAimOn) {
    const look = pinLook(ctx.demo.replayActive, f.look, ctx.player.player);
    ctx.player.player.yaw = look[0];
    ctx.player.player.pitch = look[1];
    f.look = look;
  }
  if (f.fire === 1) fire(ctx, 1);
  else if (f.fire === 2) fire(ctx, 2);
  // Prototype slot edges are consumed on the tick like every other verb.
  ctx.weapon.flare?.consumeEdge();
  ctx.weapon.launcher?.consumeEdge();
  // The KeyR edge above already covers a live press; this covers a recorded
  // frame whose reload was folded into the flag rather than the keys.
  if (f.reload && ctx.weapon.shells < MAGAZINE_CAPACITY && ctx.weapon.reloadAge > RELOAD.totalSec) startReload(ctx);
  ctx.player.prevInputKeys = next;
}
