// src/lab/sdf-zombie/webgpu/game-melter.ts
//
// THE MELT IN THE GAME (2026-11-14), and WEAPON SLOT 8: THE MELTER TEST HARNESS.
//
// The melt itself is the actor's (game-actor.ts beginMelt / stepMelt, on
// melt.ts and melt-bones.ts). This file is the game's half: starting one on a
// body (meltActor), the tick's clock for every body that is melting
// (stepMelts), and the bone groups it lets go of, which become ordinary
// bone-only chunk pieces (spawnMeltBone).
//
// The melter is a dev harness in the flare's mould (game-flare.ts): a
// placeholder primitive in hand and ONE verb, melting the body it hits. No
// projectile, no damage, no wound. There is no weapon in the design that melts
// yet; when there is, it calls meltActor and this slot can go.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { LimbId, Primitive, Vec3 } from '../types';
import { spawnChunkPiece } from './game-chunk-pieces';
import { meltGroupOf } from '../melt-bones';
import { actorSpawnCentre, seatBurstSpawn } from './game-hit-trace';
import { spawnWoundDroplets } from '../blood-sim';
import { eyeballPrims, type GorePiece } from '../head-pop';
import { rngStreams } from './rng';
import { slotLowerAmount, slotReady } from './game-weapon-slots';

/** Seconds between melter shots. Melting is idempotent; this is feel only. */
const MELTER_COOLDOWN_SEC = 0.3;
/** The tumbling eyeballs' iris (linear RGB): the zombie's red. */
const MELT_EYE_IRIS: Vec3 = [1, 0.12, 0.05];
const MELTER_REST = new THREE.Vector3(0.11, -0.13, -0.42);

/**
 * Start melting `a`. False, and nothing done, when it is already melting, is
 * mid-rupture or is queued to gib (a body is pieces or a puddle, not both).
 */
export function meltActor(ctx: GameContext, a: ZombieActor, hit?: Vec3 | null): boolean {
  if (a.melting() || a.tearing() || ctx.gibs.pendingGibs.some(q => q.actor === a)) return false;
  // `hit`: where the shot landed. The melt opens there as well as at the feet (game-actor beginMelt).
  if (!a.beginMelt(hit)) return false;
  // A burning body that melts goes out: burn-down mark, cards released.
  ctx.vfx.burning.retire(a);
  ctx.telemetry.telemetry.event('melt', { actor: a.id });
  return true;
}

/** How long a pulse of the wound emitter one drip is (spawnMeltDrip), seconds. */
const MELT_DRIP_PULSE_SEC = 0.2;
/** Melt progress at which a body's kit and held prop come off it (dropKit). */
const MELT_KIT_DROP_AT = 0.22;
/** The bodies whose kit has already been dropped. */
const kitDropped = new WeakSet<ZombieActor>();

/**
 * KIT AND PROP DO NOT MELT (owner, 2026-11-14: armour should fall like the bones, not vanish). The same hand-over a
 * gib makes (character-view surrenderEquipment, kit-remains.ts), on a small outward launch instead of a blast's: the
 * plates and the gun slide off the body as the flesh under them goes, and lie in the pool.
 */
function dropKit(ctx: GameContext, a: ZombieActor): void {
  kitDropped.add(a);
  const at = a.pose().pos;
  const torso: Vec3 = [at[0], at[1] + 1.1, at[2]];
  if (ctx.gibs.kitDebris) {
    const left = a.character?.surrenderEquipment((_key, c) => {
      const dx = c[0] - at[0], dz = c[2] - at[2];
      const r = Math.hypot(dx, dz) || 1;
      return [dx / r * 0.5, 0.2, dz / r * 0.5];
    }, torso, ctx.demo.seed ^ a.id);
    if (left) ctx.gibs.kitRemains.add(left);
  }
  // Whatever was not handed over (kit debris off) goes: it cannot follow a melt.
  a.character?.retireEquipment();
}

/** The tick's melt clock: every melting body, stepped or not (a frozen cast never steps). Returns how many are
 *  still running (a set puddle costs nothing and is not counted). */
export function stepMelts(ctx: GameContext, dt: number): number {
  let running = 0;
  for (const a of ctx.world.actors) {
    if (!a.melting() || a.meltDone()) continue;
    a.stepMelt(dt);
    if (!kitDropped.has(a) && a.meltProgress() >= MELT_KIT_DROP_AT) dropKit(ctx, a);
    running++;
  }
  return running;
}

/** Goo running off a melting body (ZombieActor opts.onMeltDrip): a small downward gout in the blood sim, on its own
 *  emitter stream so it never fuses with a wound's. Nothing when the bleed is off. */
export function spawnMeltDrip(ctx: GameContext, a: ZombieActor, at: Vec3): void {
  if (!ctx.vfx.bleedEnabled) return;
  const seat = seatBurstSpawn(ctx, a, at);
  // THE WOUND BLEED'S DROPLETS, not a gout (owner, 2026-11-15: the gout's ropes were too big; "use the particle
  // blood like in other places"). One short pulse of a fresh pellet wound's emitter, aimed down, tight and slow.
  spawnWoundDroplets(ctx.vfx.bloodSim, 'pellet', 0, seat.pos, [0, -1, 0], MELT_DRIP_PULSE_SEC, 0, rngStreams.bleed,
    ctx.boot.nextEmitterStream++, { coneScale: 0.5, speedMul: 0.35 }, seat.floorY);
}

/** A gob of flesh dropping off a melting body (ZombieActor opts.onMeltGob): one small flesh bit (flesh-bits.ts:
 *  capped, and the first thing evicted, so it never costs the melt its bone pieces), let go with almost no throw. */
export function spawnMeltGob(ctx: GameContext, a: ZombieActor, at: Vec3, radius: number): void {
  const r = Math.max(0.02, radius);
  spawnChunkPiece(ctx, {
    limb: 'torso', origin: at, tag: 'flesh', kind: 'gob', tornAt: [], bones: [],
    prims: [{
      limb: 'torso', cluster: 0, op: 'add', a: at, b: [at[0], at[1] - r * 1.4, at[2]], radius: r,
      scale: [1, 1, 1], blendK: 0.008,
    } as unknown as Primitive],
  }, { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture }, [0, -0.3, 0], actorSpawnCentre(ctx, a));
}

/** A bone group the melt let go of (ZombieActor opts.onMeltBone): a bone-only chunk piece, launched with the
 *  melt's gentle outward clatter instead of a gib's throw. */
export function spawnMeltBone(
  ctx: GameContext, a: ZombieActor,
  piece: { group: string; limb: LimbId; origin: Vec3; bones: Primitive[] }, vel: Vec3,
): void {
  // THE MESH SKELETON FALLS AS ITSELF (owner, 2026-11-15: it started as the textured mesh and turned into the SDF
  // tube bones as it dropped). Each segment of the group leaves the body as a loose mesh on the gib physics; only a
  // page with no mesh skeleton falls back to the bone-only SDF chunk.
  const sources = ctx.render.skeletonSources.get(a)?.sources.filter(s => s.kind !== 'organ' && meltGroupOf(s.prims?.[0]?.bone) === piece.group) ?? [];
  const dropped = sources.length ? ctx.render.segMeshRenderer?.dropSegments(a, sources, vel) ?? 0 : 0;
  if (!dropped) {
    spawnChunkPiece(ctx,
      { limb: piece.limb, origin: piece.origin, prims: [], tornAt: [], bones: piece.bones, kind: 'bone' },
      { uniforms: a.view.uniforms, volumeTexture: a.view.volumeTexture }, vel, actorSpawnCentre(ctx, a));
  }
  // THE EYES GO WITH THE SKULL'S FLESH (owner, 2026-11-15): the mesh skull and its eyes leave the body with this
  // group, and two eyeballs tumble out where they were, toward whoever is looking.
  if (piece.group === 'skull') {
    const pl = ctx.player.player.pos;
    const fx = pl[0] - piece.origin[0], fz = pl[2] - piece.origin[2];
    const fl = Math.hypot(fx, fz) || 1;
    const f: Vec3 = [fx / fl, 0, fz / fl], side: Vec3 = [-f[2], 0, f[0]];
    const eyes: GorePiece[] = [-1, 1].map(s => {
      const c: Vec3 = [
        piece.origin[0] + f[0] * 0.07 + side[0] * 0.032 * s, piece.origin[1] + 0.03, piece.origin[2] + f[2] * 0.07 + side[2] * 0.032 * s,
      ];
      return {
        limb: 'head', origin: c, prims: eyeballPrims(c, f, MELT_EYE_IRIS), tornAt: [], bones: [], kind: 'gob', tag: 'eye',
        vel: [f[0] * 0.5 + side[0] * 0.25 * s, 0.4, f[2] * 0.5 + side[2] * 0.25 * s],
        angVel: [3 * s, 2, 4],
      };
    });
    ctx.boot.onGoreDispatch?.(a, eyes);
  }
}

export interface MelterHarnessDeps {
  /** The ballistic slug march, from an arbitrary ray (game-main's traceSlugHitFrom). */
  traceSlugHitFrom(origin: Vec3, dir: Vec3): { actorId: number; hit: Vec3 | null };
  eye(): Vec3;
  aimDir(): Vec3;
}

export interface MelterHarness {
  /** A mousedown while slot 8 is live. True = consumed. */
  onMouseDown(button: number): boolean;
  /** The tick's edge consumer (slot 8 is not a recorded DemoFrame verb). */
  consumeEdge(): void;
  tickCooldown(dt: number): void;
  /** Holster travel, from the same slot state the other rigs read. */
  updateRig(): void;
  /** Fire now (console seam). */
  fire(): boolean;
}

export function createMelterHarness(ctx: GameContext, deps: MelterHarnessDeps): MelterHarness {
  const rig = new THREE.Group();
  rig.name = 'melter-rig';
  ctx.weapon.aimRig!.add(rig);
  let pending = false;
  let cooldown = 0;

  // THE PLACEHOLDER PROP: a squat sprayer, a glowing green tank on its back. Primitives only, so there is no asset to
  // be missing; whatever weapon ends up melting things replaces this whole group.
  const prop = new THREE.Group();
  prop.name = 'melter-placeholder';
  {
    const body = new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 0.6, metalness: 0.4 });
    const goo = new THREE.MeshStandardMaterial({
      color: 0x7dff3a, roughness: 0.25, metalness: 0, emissive: 0x2f8a0a, emissiveIntensity: 1.4,
    });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.2, 14), body);
    barrel.rotation.x = Math.PI / 2;           // cylinder axis → view -Z
    barrel.position.set(0, 0, -0.06);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.018, 0.035, 14), goo);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0, -0.175);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), goo);
    tank.position.set(0, 0.04, 0.0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.1, 0.045), body);
    grip.position.set(0, -0.07, 0.04);
    grip.rotation.x = THREE.MathUtils.degToRad(-18);
    prop.add(barrel, nozzle, tank, grip);
  }
  prop.position.copy(MELTER_REST);
  rig.add(prop);
  if (ctx.boot.deferredApi) ctx.boot.deferredApi.router.register(rig, 'mesh', 'level-only');

  /** Slot 8's only verb: the grapeshot slug's hit test from the eye, and the body it names melts. */
  function fire(): boolean {
    if (ctx.weapon.slotState.live !== 'melter' || !slotReady(ctx.weapon.slotState)) return false;
    if (cooldown > 0) return false;
    cooldown = MELTER_COOLDOWN_SEC;
    ctx.weapon.shotAlert = true;   // it is still a weapon: the shot turns heads
    const hit = deps.traceSlugHitFrom(deps.eye(), deps.aimDir());
    ctx.telemetry.telemetry.event('melter-shot', { actorId: hit.actorId });
    if (hit.actorId >= 0) {
      const a = ctx.world.actors.find(x => x.id === hit.actorId);
      if (a) meltActor(ctx, a, hit.hit);
    }
    return true;
  }

  return {
    onMouseDown(button) {
      if (ctx.weapon.slotState.live !== 'melter') return false;
      if (button === 0) pending = true;
      return true;
    },
    consumeEdge() {
      if (pending) { pending = false; fire(); }
    },
    tickCooldown(dt) { cooldown = Math.max(0, cooldown - dt); },
    updateRig() {
      const lower = slotLowerAmount(ctx.weapon.slotState, 'melter');
      rig.position.set(0, -0.42 * lower, 0.06 * lower);
      rig.rotation.set(THREE.MathUtils.degToRad(38) * lower, 0, 0);
      rig.visible = lower < 0.999;
    },
    fire,
  };
}
