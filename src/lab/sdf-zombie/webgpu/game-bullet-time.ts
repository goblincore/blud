// src/lab/sdf-zombie/webgpu/game-bullet-time.ts
//
// BULLET TIME's in-game looks (bullet-time.ts holds the state and the math),
// lifted beside game-tick.ts rather than into it. game-tick.ts owns the time
// split itself; this is what the mode turns UP while it is on:
//   * the projectiles' AIR WAKE — each near pellet / rocket / bile glob pushes
//     a ring into post-aa's burn-distort slots (re-pushed every frame, like a
//     burning body's heat band), so a slowed shot visibly bends the air; the
//     player's own pellets only faintly (BULLET_TIME.ownWakeMul);
//   * the GORE — blood-sim's boost (more, fatter, longer-lived droplets);
//   * a cold vignette, so the mode reads at a glance.
//   * ADRENALINE (adrenaline.ts), the automatic rush: its trigger, and a faint warm edge vignette.
import { goreBoostAt, pickWakes, type WakeSource } from '../bullet-time';
import { ADRENALINE, adrenalineFeedbackAt, triggerAdrenaline } from '../adrenaline';
import { type GameContext } from './game-context';
import { eyeOf } from './game-player';

/** ADRENALINE's trigger: game-tick.ts's pellet loop (a round landed on an actor) and game-flail.ts's strike. */
export function triggerAdrenalineRush(ctx: GameContext, by: 'shot' | 'flail'): void {
  if (by === 'flail' && !ADRENALINE.flail) return;
  if (triggerAdrenaline(ctx.player.adrenaline, ctx.player.bulletTime.on) && ctx.telemetry.telemetry.active) {
    ctx.telemetry.telemetry.event('adrenaline', { by, phase: ctx.player.adrenaline.phase });
  }
}

function stepAdrenalineFx(ctx: GameContext): void {
  const o = adrenalineFeedbackAt(ctx.player.adrenaline.level);
  if (!ctx.player.adrenalineEl) {
    if (!(o > 0)) return;
    const el = document.createElement('div');
    el.setAttribute('style',
      'position:fixed; inset:0; z-index:33; pointer-events:none; opacity:0;'
      + ' background:radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(70,8,4,0.9) 100%);'
      + ' mix-blend-mode:multiply;');
    document.body.appendChild(el);
    ctx.player.adrenalineEl = el;
  }
  ctx.player.adrenalineEl.style.opacity = String(o);
}

export function stepBulletTimeFx(ctx: GameContext): void {
  const bt = ctx.player.bulletTime;
  ctx.vfx.bloodSim.boost = goreBoostAt(bt.intensity);
  if (bt.intensity > 0) {
    const w = ctx.weapon;
    const sources: WakeSource[] = [];
    for (const p of w.pellets) sources.push({ pos: p.pos, heavy: false, own: true });
    for (const p of w.soldierPellets) sources.push({ pos: p.pos, heavy: false });
    for (const r of w.rockets) sources.push({ pos: r.pos, heavy: true });
    for (const b of w.bile) sources.push({ pos: b.pos, heavy: true });
    for (const k of pickWakes(sources, eyeOf(ctx.player.player), bt.intensity)) {
      ctx.render.postAa.pushBurnDistort(k.pos, k.radiusM, k.strength);
    }
  }
  if (typeof document === 'undefined') return;
  stepAdrenalineFx(ctx);
  if (!ctx.player.bulletTimeEl) {
    if (!(bt.intensity > 0)) return;
    const el = document.createElement('div');
    el.setAttribute('style',
      'position:fixed; inset:0; z-index:33; pointer-events:none; opacity:0;'
      + ' background:radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(10,40,30,0.85) 100%);'
      + ' mix-blend-mode:multiply;');
    document.body.appendChild(el);
    ctx.player.bulletTimeEl = el;
  }
  ctx.player.bulletTimeEl.style.opacity = String(bt.intensity * 0.8);
}
