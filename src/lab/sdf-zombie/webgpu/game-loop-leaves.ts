// src/lab/sdf-zombie/webgpu/game-loop-leaves.ts
//
// THE GAME LOOP in the game (docs/superpowers/plans/2026-09-26-game-loop.md): health and
// damage, death and restart, pickups and loadout, finite ammo, trigger events, gates and
// level completion. The rules are pure (player-vitals.ts, pickups.ts, level-events.ts); this
// leaf holds the runtime on ctx.world.loop, draws the status bar and overlays, and applies
// the rules each tick. Authored levels get pickups and events; the ring owns every weapon
// with unlimited ammo, as before, but can still be hurt. `?god` turns damage off.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { openGate } from './game-level-leaves';
import { PLAYER } from './game-player';
import { MAGAZINE_CAPACITY } from './game-viewmodel';
import { requestSlot, type WeaponSlot } from './game-weapon-slots';
import { commandsFor, gatesOpenedBy, makeTriggerState, stepTriggers, type LevelCommand, type TriggerState } from './level-events';
import { collectPickups, makeInventory, reloadFromReserve, type Inventory } from './pickups';
import { VITALS, applyDamage, bitesInReach, makeVitals, stepVitals, type DamageKind, type Vitals } from './player-vitals';

export interface LoopRuntime {
  god: boolean;
  /** Pickups, events and finite ammo apply (an authored level). */
  authored: boolean;
  finite: boolean;
  vitals: Vitals;
  inventory: Inventory;
  taken: ReadonlySet<string>;
  triggers: TriggerState;
  pending: string[];
  done: boolean;
  /** Actors that fight with a weapon (the bride's sword) and so never bite. */
  biteExempt: Set<number>;
  meshes: Map<string, THREE.Mesh>;
  el: { status: HTMLDivElement; hurt: HTMLDivElement; death: HTMLDivElement; complete: HTMLDivElement };
}

function overlay(title: string, hint: string): HTMLDivElement {
  const d = document.createElement('div');
  d.setAttribute('style', 'position:fixed; inset:0; z-index:45; display:none; place-items:center; background:rgba(0,0,0,.6);'
    + ' font:700 42px/1.2 ui-monospace,Menlo,monospace; color:#f2e6d0; text-align:center; cursor:pointer;');
  d.innerHTML = `<div>${title}<small style="display:block; font-size:16px; margin-top:12px; opacity:.8">${hint}</small></div>`;
  d.addEventListener('click', () => location.reload());
  document.body.appendChild(d);
  return d;
}

/** Simple spinning stand-ins until real pickup models exist. */
const LOOK: Record<string, { geo: () => THREE.BufferGeometry; color: number }> = {
  shotgun: { geo: () => new THREE.BoxGeometry(0.7, 0.08, 0.12), color: 0x8a6a4a },
  shells: { geo: () => new THREE.BoxGeometry(0.18, 0.12, 0.12), color: 0xc23a2a },
  health: { geo: () => new THREE.OctahedronGeometry(0.16), color: 0xe8e0d0 },
  cd: { geo: () => new THREE.CylinderGeometry(0.12, 0.12, 0.012, 32), color: 0xd8e4ff },
  melee: { geo: () => new THREE.BoxGeometry(0.08, 0.8, 0.08), color: 0x6b5a45 },
  dynamite: { geo: () => new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), color: 0xb0302a },
};

export function createLoop(ctx: GameContext): LoopRuntime {
  const q = new URLSearchParams(location.search);
  const def = ctx.world.level.def;
  const authored = def !== null;
  const finite = authored && def.ammo === 'finite' && q.get('ammo') !== 'infinite';
  if (finite) ctx.weapon.infiniteAmmo = false;
  const status = document.createElement('div');
  status.setAttribute('style', 'position:fixed; left:16px; bottom:48px; z-index:33; pointer-events:none;'
    + ' font:700 18px/1.2 ui-monospace,Menlo,monospace; color:#f2e6d0; text-shadow:0 2px 0 #000; letter-spacing:.06em;');
  document.body.appendChild(status);
  const hurt = document.createElement('div');
  hurt.setAttribute('style', 'position:fixed; inset:0; z-index:34; pointer-events:none; opacity:0;'
    + ' background:radial-gradient(ellipse at center, transparent 40%, rgba(160,0,0,.55) 100%);');
  document.body.appendChild(hurt);
  const rt: LoopRuntime = {
    god: q.has('god'),
    authored,
    finite,
    vitals: makeVitals(),
    inventory: authored ? makeInventory(def.loadout) : makeInventory(['shotgun', 'dynamite', 'flare']),
    taken: new Set(),
    triggers: makeTriggerState(),
    pending: [],
    done: false,
    biteExempt: new Set(),
    meshes: new Map(),
    el: { status, hurt, death: overlay('YOU DIED', 'click to restart'), complete: overlay('LEVEL COMPLETE', 'click to play again') },
  };
  if (authored) {
    for (const p of def.pickups) {
      const l = LOOK[p.item];
      if (!l) continue;
      const mesh = new THREE.Mesh(l.geo(), new THREE.MeshStandardMaterial({
        color: l.color, emissive: l.color, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4,
      }));
      mesh.position.set(p.pos[0], Math.max(0.25, p.pos[1]), p.pos[2]);
      if (p.item === 'cd') mesh.rotation.x = Math.PI / 2;
      mesh.name = `pickup:${p.id}`;
      ctx.boot.handle.scene.add(mesh);
      rt.meshes.set(p.id, mesh);
    }
  }
  ctx.world.loop = rt;
  updateStatus(ctx);
  return rt;
}

export function updateStatus(ctx: GameContext): void {
  const rt = ctx.world.loop;
  if (!rt) return;
  const low = rt.vitals.health <= 25 ? ' style="color:#ff5a3c"' : '';
  const ammo = rt.finite && rt.inventory.weapons.includes('shotgun')
    ? `&nbsp;&nbsp; SHELLS ${ctx.weapon.shells} | ${rt.inventory.shellsReserve}` : '';
  rt.el.status.innerHTML = `<span${low}>HEALTH ${rt.vitals.health}</span>${ammo}${rt.god ? '&nbsp;&nbsp; GOD' : ''}`;
}

export function damagePlayer(ctx: GameContext, amount: number, kind: DamageKind): void {
  const rt = ctx.world.loop;
  if (!rt || rt.god || rt.done) return;
  const before = rt.vitals;
  rt.vitals = applyDamage(rt.vitals, amount, kind);
  if (rt.vitals === before) return;
  ctx.telemetry.telemetry.event('player-hurt', { amount, kind, health: rt.vitals.health });
  if (rt.vitals.dead) {
    rt.el.death.style.display = 'grid';
    document.exitPointerLock?.();
  }
  updateStatus(ctx);
}

/** Dead or finished: movement, firing and reloads stop. */
export function loopBlocksInput(ctx: GameContext): boolean {
  const rt = ctx.world.loop;
  return !!rt && (rt.vitals.dead || rt.done);
}

/** May the player select or fire this slot? (The flare is a dev harness: always.) */
export function ownsSlot(ctx: GameContext, slot: WeaponSlot): boolean {
  const rt = ctx.world.loop;
  return !rt || slot === 'flare' || rt.inventory.weapons.includes(slot);
}

/** A finite level with an empty reserve cannot reload (a dry click). */
export function reloadBlocked(ctx: GameContext): boolean {
  const rt = ctx.world.loop;
  return !!rt && (loopBlocksInput(ctx) || (rt.finite && rt.inventory.shellsReserve <= 0));
}

/** The magazine after a finished reload: from the reserve on finite levels. */
export function refillMagazine(ctx: GameContext): void {
  const rt = ctx.world.loop;
  if (!rt?.finite) { ctx.weapon.shells = MAGAZINE_CAPACITY; return; }
  const r = reloadFromReserve(ctx.weapon.shells, MAGAZINE_CAPACITY, rt.inventory);
  ctx.weapon.shells = r.shells;
  rt.inventory = r.inventory;
  updateStatus(ctx);
}

export function emitLevelEvent(ctx: GameContext, event: string): void {
  ctx.world.loop?.pending.push(event);
}

function runLevelCommand(ctx: GameContext, cmd: LevelCommand): void {
  const rt = ctx.world.loop!;
  if (cmd.kind === 'complete') {
    rt.done = true;
    rt.el.complete.style.display = 'grid';
    document.exitPointerLock?.();
  }
  // 'wave' and 'alert-room' come with the encounter work (Wake Plan 3 Task 5).
}

/** Per sim step: vitals, zombie bites, pickups, triggers, events, gates, completion. */
export function stepLoop(ctx: GameContext, dt: number): void {
  const rt = ctx.world.loop;
  if (!rt) return;
  rt.vitals = stepVitals(rt.vitals, dt);
  rt.el.hurt.style.opacity = String(Math.max(0, 0.9 - rt.vitals.hurtAge * 2.5));
  // The gun hides while the live slot is a weapon the player doesn't own yet.
  if (ctx.weapon.gunGroup) ctx.weapon.gunGroup.visible = ownsSlot(ctx, ctx.weapon.slotState.live);
  for (const m of rt.meshes.values()) m.rotation.y += dt * 1.6;
  if (rt.vitals.dead || rt.done) return;
  const feet = ctx.player.player.pos;
  // ZOMBIE BITES. The zombie mind never reports melee contact; a live zombie in reach
  // bites, rate-limited by the melee invulnerability window. Frozen AI never bites.
  if (!ctx.demo.wanderFrozen) {
    const zombies = ctx.world.actors.filter(a => a.kind === 'zombie' && !rt.biteExempt.has(a.id))
      .map(a => ({ id: a.id, pos: a.pose().pos, down: !!a.motionFrame()?.collapsed }));
    if (bitesInReach(feet, zombies, VITALS.biteReach).length > 0) damagePlayer(ctx, VITALS.zombieBite, 'melee');
  }
  const def = ctx.world.level.def;
  if (!def) return;
  const hadShotgun = rt.inventory.weapons.includes('shotgun');
  const picked = collectPickups(def.pickups, rt.taken, feet, rt.inventory, rt.vitals);
  if (picked.collected.length > 0) {
    rt.taken = picked.taken;
    rt.inventory = picked.inventory;
    rt.vitals = picked.vitals;
    for (const p of picked.collected) {
      rt.meshes.get(p.id)?.removeFromParent();
      emitLevelEvent(ctx, `pickup.${p.item}`);
      ctx.telemetry.telemetry.event('pickup', { id: p.id, item: p.item });
      if (p.item === 'shotgun' && !hadShotgun) {
        ctx.weapon.shells = MAGAZINE_CAPACITY;   // it comes loaded
        ctx.weapon.slotState = requestSlot(ctx.weapon.slotState, 'shotgun');
      }
    }
    updateStatus(ctx);
  }
  const t = stepTriggers(def.triggers, rt.triggers, feet);
  rt.triggers = t.state;
  for (const ev of t.events) emitLevelEvent(ctx, ev);
  if (rt.pending.length > 0) {
    const events = rt.pending.splice(0);
    const open = gatesOpenedBy(def.gates, ctx.world.openGates, events);
    for (const id of open) if (!ctx.world.openGates.has(id)) openGate(ctx, id);
    for (const ev of events) {
      ctx.telemetry.telemetry.event('level-event', { event: ev });
      for (const cmd of commandsFor(ev, def.completeOn)) runLevelCommand(ctx, cmd);
    }
  }
}

/** After the camera is placed: dead, it drops to the floor and rolls. */
export function applyDeathCamera(ctx: GameContext, camera: THREE.Camera): void {
  const rt = ctx.world.loop;
  if (!rt?.vitals.dead) return;
  const k = Math.min(1, rt.vitals.hurtAge / 0.6);
  camera.position.y -= (PLAYER.height - 0.35) * k;
  camera.rotateZ(0.5 * k);
}

/** Seams: `__sdfGame.vitals()`, `damagePlayer(n, kind)`, `inventory()`, `pickupsLeft()`,
 *  `emitLevelEvent(e)`, `levelComplete()`. */
export function createLoopSeams(ctx: GameContext) {
  return {
    vitals: () => (ctx.world.loop ? { ...ctx.world.loop.vitals } : null),
    damagePlayer: (amount: number, kind: DamageKind = 'pellet') => {
      damagePlayer(ctx, amount, kind);
      return ctx.world.loop ? { ...ctx.world.loop.vitals } : null;
    },
    inventory: () => {
      const inv = ctx.world.loop?.inventory;
      return inv ? { ...inv, weapons: [...inv.weapons], cds: [...inv.cds], shells: ctx.weapon.shells } : null;
    },
    pickupsLeft: () => {
      const rt = ctx.world.loop, def = ctx.world.level.def;
      return rt && def ? def.pickups.filter(p => !rt.taken.has(p.id)).map(p => p.id) : [];
    },
    emitLevelEvent: (event: string) => { emitLevelEvent(ctx, event); },
    levelComplete: () => !!ctx.world.loop?.done,
  };
}
