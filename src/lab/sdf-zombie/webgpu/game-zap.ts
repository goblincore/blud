// src/lab/sdf-zombie/webgpu/game-zap.ts
//
// THE ZAP IN THE GAME (spec 2026-11-17-tesla-arc-design.md). The zap itself is the actor's
// (game-actor.ts beginZap / setArc, on zap.ts and zap-pose.ts). This file is the game's half: starting
// one on a body (zapActor) and, each tick, copying every body's zap look to its view (stepZapLook).
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import { encodeZapLane, setZapLook, setZapReducedFlashes, zapLook, type ZapLookId } from '../zap-look';
import { reducedFlashes } from './lamp-moods';
import { stepZapFx, zapFxDebug } from './game-zap-fx';

// THE LOOK VARIANT (zap-look.ts, look spike 2026-11-18): `&zapLook=b` in the URL picks it at boot; the console
// seam `__sdfGame.zapLook('b')` switches it live.
if (typeof location !== 'undefined') {
  const search = new URLSearchParams(location.search);
  setZapLook(search.get('zapLook'));
  // `?flashes=reduced`: every variant's strobe drops to single jolts, at most 3 a second (zap-look.ts).
  setZapReducedFlashes(reducedFlashes(search));
}

/** The live look variant; with an id, switch to it first. Bodies under the arc take the new look on their next tick. */
export function zapLookSeam(id?: string): { id: ZapLookId; code: number; fx: ReturnType<typeof zapFxDebug> } {
  if (id !== undefined) setZapLook(id);
  const l = zapLook();
  return { id: l.id, code: l.code, fx: zapFxDebug() };
}

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
 * char rides the view's zapChar holding slot, which writeViewRecord folds into the body's own record with
 * the burn's char (the larger wins). Neither is read from the view by the march: a crowd type's material
 * carries its source view's uniforms, so a value read there is every body's of the type. A body with no
 * zap look (never touched, or reset by endTear) carries no glow and no char. Call after the burn step.
 */
export function stepZapLook(ctx: GameContext, dt = 0): void {
  const code = zapLook().code;
  // A body that left the world while it glowed (gibbed, culled, a new cast) is not walked below: let it go.
  if (glowing.size > 0) for (const a of glowing) if (!ctx.world.actors.includes(a)) glowing.delete(a);
  for (const a of ctx.world.actors) {
    const z = a.zapLook();
    const u = a.view.uniforms;
    if (!z) {
      if (glowing.delete(a)) u.burnCfg.value.w = 0;
      if (u.zapChar.value !== 0) u.zapChar.value = 0;
      continue;
    }
    // The lane (zap-look.ts): the signed glow on the baseline look; the variant's code rides it otherwise.
    u.burnCfg.value.w = encodeZapLane(z.glow, z.invert, code);
    u.zapChar.value = z.char;
    if (z.glow > 0) glowing.add(a); else glowing.delete(a);
  }
  // The overlay of the look variants (crawl arcs, the kit's flash, the halo). Nothing on the baseline look.
  stepZapFx(ctx, glowing, dt);
}

/** True while any body's bones carry a zap glow, and for the one frame after the last one goes out. */
let xrayLive = false;
/** A bone instance's owner's signed glow. An owner is the actor itself (game-main hands update() ctx.world.actors);
 *  the renderer's owner-less fallback slot has no zapLook. Hoisted: the per-frame sync allocates nothing. */
const ownerZap = (owner: unknown): number => {
  const z = (owner as Partial<ZombieActor> | undefined)?.zapLook?.();
  if (!z || !(z.glow > 0)) return 0;
  // A body with no skeleton worth showing (ZapTier.xray false) keeps its bones in its flesh under the look
  // variants; the baseline look x-rays every body, as built.
  const look = zapLook();
  if (look.code > 0 && (owner as Partial<ZombieActor>).zapXray?.() === false) return 0;
  return encodeZapLane(z.glow, z.invert, look.code);
};

/**
 * The skeleton's half of the look: each bone instance takes its owner's signed glow (zap-xray.ts). Call
 * once a frame after the segment renderer's update. Nothing zapped, and nothing to clear: no work.
 * game-main does NOT call it on a half-rate hold frame (the bones hold with the held flesh). `xrayLive` changes
 * only in here, so a clearing pass owed when a frame is skipped is still owed on the next call.
 */
export function syncZapXray(ctx: GameContext): void {
  const any = glowing.size > 0;
  if (!any && !xrayLive) return;
  xrayLive = any;
  ctx.render.segMeshRenderer?.syncZap(ownerZap);
}

/** Console readout: every body the arc has touched. */
export function zaps(ctx: GameContext): { id: number; phase: string; glow: number; invert: boolean; char: number }[] {
  return ctx.world.actors.flatMap(a => {
    const z = a.zapLook();
    return z ? [{ id: a.id, phase: a.zapPhase(), glow: z.glow, invert: z.invert, char: z.char }] : [];
  });
}
