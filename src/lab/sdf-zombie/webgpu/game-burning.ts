// src/lab/sdf-zombie/webgpu/game-burning.ts
//
// IN-GAME BURNING (2026-09-18 flare test harness), lifted beside game-main.ts
// rather than into its closure (the decomposition's rule for new features).
// Slot 3 ignites an actor; this is the flame lab's per-body burn loop
// (flame-lab-main.ts) ported onto the game's actors.
//
// LAZY BY DESIGN: the registry allocates no BurnState until the first ignite,
// and the flame cards are not even created until then, so a session that never
// selects slot 3 and never calls igniteAll() pays for none of it.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { ZombieActor } from './game-actor';
import type { Vec3 } from '../types';
import type { BurnState } from '../burn-state';
import { BURN_TUNING, resolveBurnTuning, type BurnTuning } from './burn-profiles';
import { createBurnRegistry, type BurnRegistry } from './burn-registry';
import { burnLightAnchor, burnLightIntensity, burnLightFlicker } from './burn-light';
import { limbAnchors } from './flame-anchors';
import {
  createFlameCards, SOLDIER_LEG_KIT_RADIUS,
  type FlameCardFrame, type FlameCards,
} from './flame-cards';
import { resolveTongueTuning, type TongueTuning } from './tongue-tuning';

/** Card-pool body cap. One draw call for N bodies; bounded so an igniteAll()
 *  over a big crowd cannot size an unbounded quad buffer. */
const FLAME_CARD_BODY_CAP = 32;

export interface GameBurning {
  readonly registry: BurnRegistry<ZombieActor>;
  readonly tuning: BurnTuning;
  /** The pool, or null while nothing has ever ignited. */
  flameCards(): FlameCards | null;
  /** Slot 3's one verb: set this actor alight. Idempotent. */
  igniteActor(a: ZombieActor): void;
  /** A body leaving the world (gibbed/retired). */
  retire(a: ZombieActor): void;
  /** One tick of the burn sim, after the bodies have stepped. */
  step(dt: number): void;
  /** The draw-side half: pose the card pool against the frame's camera. */
  updateCards(camera: THREE.Camera): void;
  /** Push each alight body into the bodyFlash source list. */
  pushFlashes(out: { pos: Vec3; intensity: number }[]): void;
  igniteAll(): number;
  extinguishAll(): void;
  activeCount(): number;
}

export function createGameBurning(ctx: GameContext): GameBurning {
  const burning = createBurnRegistry<ZombieActor>();
  const tuning: BurnTuning = resolveBurnTuning(BURN_TUNING);
  const tongue: TongueTuning = resolveTongueTuning();
  let cards: FlameCards | null = null;
  /** Per-body card input, rebuilt each draw from the posed body. The array is
   *  reused; only its entries are re-pushed. */
  const cardFrames: FlameCardFrame[] = [];
  const cardLastPos = new Map<ZombieActor, Vec3>();
  /** Last tick's dt, so the cards' lean velocity is metres per SIM second. */
  let frameDt = 1 / 60;

  /** The flicker clock: the practicals' clock, so a frozen-light capture
   *  freezes fire too. */
  const clock = (): number => (ctx.lighting.clockFrozen
    ? ctx.lighting.flickerClockFrozenAt : performance.now() * 0.001);

  function ensureCards(): FlameCards {
    if (cards) return cards;
    const c = createFlameCards({ maxBodies: FLAME_CARD_BODY_CAP });
    cards = c;
    ctx.vfx.characterEffects.scene.add(c.object);
    c.setTuning(tongue);
    c.setSoftFade(tuning.cardSoftFade);
    c.setFlow(tuning.flameFlow);
    // Best-effort FIRE01 atlas (a gitignored dev placeholder; absent in a fresh
    // clone). Without it the cards run their procedural shader — the module's
    // shipped fallback. The swap needs no recompile, same as the lab.
    fetch('/assets/flame-placeholder/fire01.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))))
      .then((info: { frames: number; cellW: number; cellH: number; pad?: number }) => {
        new THREE.TextureLoader().load('/assets/flame-placeholder/fire01.png', (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = THREE.LinearFilter;
          tex.minFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          tex.flipY = true;   // v = 0 is the flame's base
          c.setAtlas(tex, info.frames, info.cellW, info.cellH, info.pad ?? 0);
        }, undefined, () => { /* no atlas png: keep the procedural look */ });
      })
      .catch(() => { /* no atlas manifest: keep the procedural look */ });
    return c;
  }

  /** Burn-state → the actor view's uniforms. Burn/char ride burnCfg (which the
   *  crowd copies into the per-instance record), the look scalars ride the
   *  view. */
  function writeUniforms(a: ZombieActor, s: BurnState): void {
    const u = a.view.uniforms;
    u.burnCfg.value.set(s.burn, s.burnSec, s.char, 0);
    u.burnNoiseScale.value = tuning.noiseScale;
    u.burnRiseSpeed.value = tuning.riseSpeed;
    u.burnCharPatch.value = tuning.charPatch;
    u.burnFireGain.value = tuning.fireGain;
    u.burnFireCoverage.value = tuning.fireCoverage;
    u.burnSkeleton.value = tuning.skeletonShow;
    u.burnSkeletonDepth.value = tuning.skeletonDepth;
  }

  /** A crowd shares one material, so its look scalars are per TYPE while
   *  burn/char ride each instance's record. Written only while something burns. */
  function writeCrowdScalars(): void {
    for (const t of ctx.crowd.types.values()) {
      const u = t.uniforms;
      u.burnNoiseScale.value = tuning.noiseScale;
      u.burnRiseSpeed.value = tuning.riseSpeed;
      u.burnCharPatch.value = tuning.charPatch;
      u.burnFireGain.value = tuning.fireGain;
      u.burnFireCoverage.value = tuning.fireCoverage;
      u.burnSkeleton.value = tuning.skeletonShow;
      u.burnSkeletonDepth.value = tuning.skeletonDepth;
    }
  }

  function activeCount(): number {
    let n = 0;
    burning.forEachActive(() => { n++; });
    return n;
  }

  return {
    registry: burning,
    tuning,
    flameCards: () => cards,
    igniteActor(a) {
      burning.ignite(a);
      ensureCards();
    },
    retire(a) {
      // Mark it killed-while-burning (the lab's burn-down verb) and release its
      // cards. The shipped game has no health, so the only exit today is a
      // dynamite gib, where the body becomes pieces — the burn-down wiring is
      // here for the real weapon pass.
      if (burning.has(a)) burning.kill(a);
      burning.release(a);
      cardLastPos.delete(a);
    },
    step(dt) {
      // An empty registry is a single size check: nothing stepped or written.
      if (burning.size === 0) return;
      frameDt = dt;
      burning.step(Math.min(dt, 1 / 30), tuning);
      let any = false;
      burning.forEachActive((a, s) => { any = true; writeUniforms(a, s); });
      if (any) writeCrowdScalars();
    },
    updateCards(camera) {
      // An uncreated pool (nothing has ever ignited) skips this entirely.
      const c = cards;
      if (!c) return;
      cardFrames.length = 0;
      const inv = frameDt > 1e-4 ? 1 / frameDt : 0;
      burning.forEachActive((a, s) => {
        const p = a.pose();
        const pos: Vec3 = [p.pos[0], 0, p.pos[2]];
        const last = cardLastPos.get(a) ?? pos;
        cardFrames.push({
          yaw: p.yaw,
          anchors: limbAnchors(a.posed()),
          burn: s.burn,
          vel: [(pos[0] - last[0]) * inv, 0, (pos[2] - last[2]) * inv],
          // The soldier's greaves cover his SDF shins; the cards stand off.
          kitRadius: a.kind === 'soldier' ? SOLDIER_LEG_KIT_RADIUS : 0,
          // Burn-down pile, exactly as the lab's death capture reads it.
          settle: s.dying
            ? Math.min(1, s.corpseSec / Math.max(1e-3, tuning.corpseBurnSec))
            : 0,
          groundY: 0,
        });
        cardLastPos.set(a, pos);
      });
      c.object.visible = cardFrames.length > 0;
      c.update(cardFrames, camera, clock());
    },
    pushFlashes(out) {
      // Each body already takes the strongest source by I/d^2, so an alight
      // actor lights itself and its neighbours. No new light object, therefore
      // nothing to toggle (the `.visible` recompile trap).
      if (burning.size === 0) return;
      const t = clock();
      burning.forEachActive((a, s) => {
        if (s.burn <= 0.02) return;
        const p = a.pose().pos;
        out.push({
          pos: burnLightAnchor([p[0], p[1], p[2]]),
          intensity: burnLightIntensity(
            s.burn, s.char, tuning.lightPeak, tuning.lightFlicker,
            burnLightFlicker(t, tuning.lightFlicker, a.id * 2.7),
          ),
        });
      });
    },
    igniteAll() {
      for (const a of ctx.world.actors) { burning.ignite(a); ensureCards(); }
      return burning.size;
    },
    extinguishAll() { burning.extinguishAll(); },
    activeCount,
  };
}
