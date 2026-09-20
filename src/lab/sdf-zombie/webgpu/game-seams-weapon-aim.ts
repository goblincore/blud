// src/lab/sdf-zombie/webgpu/game-seams-weapon-aim.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { updateHud } from './game-panels-leaves';
import { MAGAZINE_CAPACITY, RELOAD } from './game-viewmodel';
import { aimAtNearestSurface, convergedDir, fire, muzzleWorld } from './game-weapon-leaves';
import { WEAPON_SLOTS, requestSlot, type WeaponSlot } from './game-weapon-slots';
import { BOB, FREE_AIM } from './free-aim';
import { predictSlugHitNow } from './game-world-leaves';

export function createWeaponAimSeams(ctx: GameContext) {
  return {
    // ---------------------------------------------------------------
    // GRAPESHOT — the weapon surface. fire(1|2) bypasses pointer lock so
    // the headless driver can shoot; aim with setPose(yaw, pitch).
    // ---------------------------------------------------------------
    fire: (barrels: 1 | 2 = 1) => fire(ctx, barrels),
    setFreeAim(on: boolean) { ctx.player.freeAimOn = on; ctx.weapon.aim = { x: 0, y: 0 }; updateHud(ctx); return ctx.player.freeAimOn; },
    setInfiniteAmmo: (on: boolean) => {
      ctx.weapon.infiniteAmmo = on;
      // Turning it OFF with 0 shells in the gun must not leave the player
      // holding a weapon that can only click: refill so the first dry state is
      // one the player creates by firing.
      if (!on) ctx.weapon.shells = MAGAZINE_CAPACITY;
      updateHud(ctx);
      return ctx.weapon.infiniteAmmo;
    },
    /** The muzzle locators in world space right now (chunk-bake gate: lets a
     *  driver SOLVE for the player stance that puts the slug's spawn point
     *  where it wants — the muzzle offset is ~0.6 m of view-space rig, which
     *  no hand-derived stance reproduces). Read-only. */
    muzzleWorld: () => muzzleWorld(ctx),
    /** The EXACT ray a slug fired right now would take (chunk-bake gate):
     *  origin = muzzleWorld(), dir = convergedDir(muzzleWorld()) — the same
     *  two calls fire() makes. A driver can measure a ray-to-target miss
     *  BEFORE spending the shot. Read-only. */
    slugRay: () => {
      const o = muzzleWorld(ctx);
      const d = convergedDir(ctx, o);
      return { origin: o, dir: d };
    },
    setReloadSpeed(x: number) { ctx.weapon.reloadSpeed = Math.max(0.01, x); updateHud(ctx); },
    setSlugMode(on: boolean) { ctx.weapon.slugMode = on; updateHud(ctx); },
    fireSlug: () => { const keep = ctx.weapon.slugMode; ctx.weapon.slugMode = true; try { return fire(ctx, 1); } finally { ctx.weapon.slugMode = keep; } },
    /** PLACEMENT GATE (2026-08-26): where a slug fired RIGHT NOW would hit —
     *  computed by exactly the code fire() uses (muzzleWorld + converged
     *  dir) against each actor's CURRENT posed field. No state mutated.
     *  Diff against debugWounds() after firing to assert the crater landed
     *  where the ray struck. */
    predictSlugHit: () => predictSlugHitNow(ctx),
    /** Aim at the nearest body's surface. Exposed so a driver can stage a
     *  shot the same way the bench scenario does. Optional `limb` aims at
     *  that cluster's centre instead of the torso (same confirm gate). */
    aimSurface: (limb?: string, actorId?: number) => aimAtNearestSurface(ctx, limb, actorId),
    /** aimSurface('head') — the bone-tubes reel's head-shot staging. */
    aimHead: () => aimAtNearestSurface(ctx, 'head'),
    /** P3 capture: a full magazine, so scripted wound shots never click empty. */
    refillShells: () => { ctx.weapon.shells = MAGAZINE_CAPACITY; updateHud(ctx); return ctx.weapon.shells; },
    /** AUTOMATION: select a slot without synthesising a key event. */
    selectSlot: (slot: WeaponSlot) => {
      if (ctx.vfx.cook.phase === 'cooking') return { ok: false, reason: 'cooking' };
      // VALIDATED, because a bad argument here does not fail — it POISONS.
      // `WeaponSlot` is the string union 'shotgun' | 'dynamite' and the slot
      // machine only ever compares against those, so a caller passing the
      // NUMBER 2 (the obvious mistake for a driving script: the key is 2, the
      // HUD says 2) gets a state whose `live`/`target` are 2 — the switch runs,
      // reports `phase: 'up'`, makes NOTHING live, and every later press is
      // dropped by `liveDyn` with no error anywhere. That cost a soak rig an
      // hour of "the throws never detonate". A refusal is cheap; a silently
      // inert weapon slot is not.
      if (!WEAPON_SLOTS.includes(slot)) {
        return { ok: false, reason: `unknown-slot:${String(slot)}` };
      }
      ctx.weapon.slotState = requestSlot(ctx.weapon.slotState, slot);
      updateHud(ctx);
      return { ok: true, live: ctx.weapon.slotState.live, target: ctx.weapon.slotState.target, phase: ctx.weapon.slotState.phase };
    },
    /** Live free-aim / bob knobs. Every one of these is a feel number that has
     *  to be played rather than reasoned about:
     *    __sdfGame.setAimTuning({ deadzoneX: 0.5, turnRateX: 1.4 })
     *    __sdfGame.setAimTuning({ amountX: 0.03, amountY: 0.02 })   // bob
     */
    setAimTuning(t: Partial<Record<string, number>>) {
      for (const [k, v] of Object.entries(t)) {
        if (v === undefined) continue;
        if (k in FREE_AIM) (FREE_AIM as unknown as Record<string, number>)[k] = v;
        else if (k in BOB) (BOB as unknown as Record<string, number>)[k] = v;
      }
      return { ...FREE_AIM, bob: { ...BOB } };
    },
    /** The reload's total length, seconds. Exposed so hand-stepping gates can
     *  DERIVE their wait budget instead of hardcoding a tick count: the shorty
     *  gate carried `57 ticks` against a 0.95 s reload, was still carrying it
     *  when the reload became 1.05 s, and failed a correct build the moment it
     *  became 1.30 s. A gate that has to be edited every time a constant moves
     *  will eventually be edited wrongly, or not at all. */
    get reloadTotalSec() { return RELOAD.totalSec; },
  };
}
