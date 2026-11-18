// src/lab/sdf-zombie/webgpu/game-zap.ts
//
// THE ZAP IN THE GAME (spec 2026-11-17-tesla-arc-design.md). The zap itself is the actor's
// (game-actor.ts beginZap / setArc, on zap.ts and zap-pose.ts). This file is the game's half: starting
// one on a body (zapActor) and, each tick, copying every body's zap look to its view (stepZapLook).
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';

/**
 * Start the zap on `a` and put the arc on it. False, and nothing done, when the body cannot be zapped
 * (melting, tearing, a corpse, a statue) or is queued to gib.
 */
export function zapActor(ctx: GameContext, a: ZombieActor): boolean {
  if (ctx.gibs.pendingGibs.some(q => q.actor === a)) return false;
  if (!a.beginZap()) return false;
  a.setArc(true);
  ctx.telemetry.telemetry.event('zap', { actor: a.id });
  return true;
}

/** The bodies whose view carries a zap glow this tick: the only ones stepZapLook has to clear. */
const glowing = new Set<ZombieActor>();

/**
 * Actor zap look -> view uniforms. The glow rides burnCfg.w (signed: negative = bones inverted) and the
 * char rides burnCfg.z, where the burn's own char may already be larger. A body the arc has never
 * touched is skipped after one null check. Call after the burn step, which writes x, y and z.
 */
export function stepZapLook(ctx: GameContext): void {
  for (const a of ctx.world.actors) {
    const z = a.zapLook();
    if (!z) {
      if (glowing.delete(a)) a.view.uniforms.burnCfg.value.w = 0;
      continue;
    }
    const v = a.view.uniforms.burnCfg.value;
    v.w = z.invert ? -z.glow : z.glow;
    if (z.char > v.z) v.z = z.char;
    if (z.glow > 0) glowing.add(a); else glowing.delete(a);
  }
}

/** Console readout: every body the arc has touched. */
export function zaps(ctx: GameContext): { id: number; phase: string; glow: number; invert: boolean; char: number }[] {
  return ctx.world.actors.flatMap(a => {
    const z = a.zapLook();
    return z ? [{ id: a.id, phase: a.zapPhase(), glow: z.glow, invert: z.invert, char: z.char }] : [];
  });
}
