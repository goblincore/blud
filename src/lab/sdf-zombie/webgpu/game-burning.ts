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
import { fireGatherLights, assignFirePool, type FireLightSource } from './burn-room-light';
import type { DynLightInput } from '../probe-dynamic';
import type { RoomDef } from './game-level';
import { limbAnchors } from './flame-anchors';
import {
  createFlameCards, SOLDIER_LEG_KIT_RADIUS,
  type FlameCardFrame, type FlameCards,
} from './flame-cards';
import { resolveTongueTuning, type TongueTuning } from './tongue-tuning';
import { fireCapsules, capsuleVelocities, type FireCapsule } from './fire-capsules';
import {
  packFireVolume, FIRE_CAPSULE_STRIDE, FIRE_VOLUME_MAX_CAPSULES, type FireVolumeBody,
} from './fire-volume-pack';
import { resolveFireVolumeTuning, type FireVolumeTuning } from './fire-volume-tuning';
import type { FireVolumeFrame } from './fire-volume.wgsl';

/** How a burning body's flame is drawn in the game. 'volume' (the owner's
 *  pick, 2026-09-19) is the volumetric fire + smoke pass with a few flame cards
 *  as accents; 'cards' is the flame-card-only look it replaced. */
export type GameFireTechnique = 'cards' | 'volume';

/** Card-pool body cap. One draw call for N bodies; bounded so an igniteAll()
 *  over a big crowd cannot size an unbounded quad buffer. */
const FLAME_CARD_BODY_CAP = 32;

/** The always-visible mesh-side PointLight pool. Four is the brazier-scale
 *  budget (spec A1); slots beyond the active burner count sit at intensity 0. */
const FIRE_LIGHT_POOL = 4;

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
  /** Push the ROOM's gather light slots for the burning bodies in `room`.
   *  Merges surplus burners into the nearest slot (see burn-room-light.ts). */
  pushGatherLights(
    out: DynLightInput[], eye: Vec3,
    nearRoomPoint: (q: Vec3, r: RoomDef, margin?: number) => boolean,
    room: RoomDef, cap: number, spread: number,
  ): void;
  /** Build the always-visible mesh-side PointLight pool ONCE (adding a light
   *  later re-keys the lights node and recompiles every lit material). Parent
   *  it to the accent group so props/kit read it through the same registration. */
  createFireLightPool(parent: THREE.Object3D): void;
  /** Write the pool's positions/intensities for this frame. Zeroes the slots
   *  on the transition to no-fire only; `.visible` is never touched. */
  updateFireLightPool(eye: Vec3): void;
  /** Live tuning (capture seam): patches through resolveBurnTuning's clamp. */
  setTuning(patch: Partial<BurnTuning>): BurnTuning;
  /** Capture diagnostic: what the last pushGatherLights saw/did. */
  gatherDebug(): { sources: number; inRoom: number; pushed: number; cap: number; maxIntensity: number };
  igniteAll(): number;
  extinguishAll(): void;
  activeCount(): number;
  /** Fire technique (console seam; the flame panel's copy line calls it). */
  setTechnique(name: GameFireTechnique): GameFireTechnique;
  technique(): GameFireTechnique;
  /** Volumetric fire tuning, clamped by FIRE_VOLUME_BOUNDS. */
  setVolume(patch: Partial<FireVolumeTuning>): FireVolumeTuning;
  volume(): FireVolumeTuning;
  /** Flame-card tuning, clamped by TONGUE_BOUNDS. */
  setTongueTuning(patch: Partial<TongueTuning>): TongueTuning;
  tongue(): TongueTuning;
  /**
   * WARM-UP: switch the fire pass on with one dummy capsule far out of view,
   * so the warm-up's real frame (drawOnce) compiles its three pipelines behind
   * the loader instead of on the first ignite. Returns the undo.
   */
  warmVolume(): () => void;
}

export function createGameBurning(ctx: GameContext): GameBurning {
  const burning = createBurnRegistry<ZombieActor>();
  const tuning: BurnTuning = resolveBurnTuning(BURN_TUNING);
  let tongue: TongueTuning = resolveTongueTuning();
  let technique: GameFireTechnique = 'volume';
  let volume: FireVolumeTuning = resolveFireVolumeTuning();
  /** Per burning body: its fire capsules and their velocities, refreshed on
   *  the sim step from the posed body (the lab's rule, fire-capsules.ts). */
  const fireSrc = new Map<ZombieActor, { caps: FireCapsule[]; vels: [number, number, number][] }>();
  const fireBodies: FireVolumeBody[] = [];
  const firePackBuf = new Float32Array(FIRE_VOLUME_MAX_CAPSULES * FIRE_CAPSULE_STRIDE);
  const _fireView = new THREE.Matrix4();
  const _fireVp = new THREE.Matrix4();
  const _firePrevVp = new THREE.Matrix4();
  let fireWasOn = false;
  let fireFrameIndex = 0;
  const fireFrame: FireVolumeFrame = {
    tuning: volume, time: 0, frame: 0,
    invViewProj: new THREE.Matrix4(), prevViewProj: new THREE.Matrix4(),
    near: 0.05, far: 100, capsuleCount: 0, boundsMin: [0, 0, 0], boundsMax: [0, 0, 0],
  };
  /** The cards' look per technique: as ACCENTS over the volume they are few,
   *  longer and softer (the flame lab's rule); alone they are the full set. */
  function applyCardLook(c: FlameCards): void {
    c.setFlow(tuning.flameFlow);
    if (technique === 'volume') {
      c.setMaxCardsPerBody(Math.round(volume.cardsPerBody));
      c.setTuning({ ...tongue, length: tongue.length * 1.35, gain: tongue.gain * 0.85 });
      c.setSoftFade(tuning.cardSoftFade * 1.8);
    } else {
      c.setMaxCardsPerBody(Number.MAX_SAFE_INTEGER);
      c.setTuning(tongue);
      c.setSoftFade(tuning.cardSoftFade);
    }
  }
  /** Feed (or switch off) the volumetric pass for this frame. */
  function updateVolume(camera: THREE.Camera): void {
    const postAa = ctx.render.postAa;
    fireBodies.length = 0;
    if (technique === 'volume') {
      burning.forEachActive((a, s) => {
        const src = fireSrc.get(a);
        if (!src || s.burn <= 0.02) return;
        const p = a.pose().pos;
        fireBodies.push({ capsules: src.caps, velocities: src.vels, burn: s.burn, centre: [p[0], p[1] + 1, p[2]] });
      });
    }
    if (fireBodies.length === 0) {
      if (fireWasOn) { postAa.setFireVolume(false); fireWasOn = false; }
      return;
    }
    const cam = camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    _fireView.copy(cam.matrixWorld).invert();
    _fireVp.multiplyMatrices(cam.projectionMatrix, _fireView);
    const packed = packFireVolume(
      fireBodies, [cam.position.x, cam.position.y, cam.position.z], firePackBuf, volume,
    );
    if (packed.capsuleCount === 0) {
      if (fireWasOn) { postAa.setFireVolume(false); fireWasOn = false; }
      return;
    }
    postAa.setFireVolumeData(packed.data);
    fireFrame.tuning = volume;
    fireFrame.time = clock();
    fireFrame.frame = fireFrameIndex++;
    fireFrame.invViewProj.copy(_fireVp).invert();
    // First frame after enabling: the history reprojects through the CURRENT
    // view, an identity, rather than a stale matrix.
    fireFrame.prevViewProj.copy(fireWasOn ? _firePrevVp : _fireVp);
    fireFrame.near = cam.near;
    fireFrame.far = cam.far;
    fireFrame.capsuleCount = packed.capsuleCount;
    fireFrame.boundsMin = packed.boundsMin;
    fireFrame.boundsMax = packed.boundsMax;
    fireFrame.resetHistory = !fireWasOn;
    postAa.setFireVolume(true, fireFrame);
    _firePrevVp.copy(_fireVp);
    fireWasOn = true;
  }
  let cards: FlameCards | null = null;
  /** Per-body card input, rebuilt each draw from the posed body. The array is
   *  reused; only its entries are re-pushed. */
  const cardFrames: FlameCardFrame[] = [];
  const cardLastPos = new Map<ZombieActor, Vec3>();
  /** Transition tracking for the actors' burn-panic override (Task 2): the
   *  previous step's alight set and a scratch set to build this step's, swapped
   *  each step so the per-frame cost is set membership, not allocation. */
  let burnPrev = new Set<ZombieActor>();
  let burnCur = new Set<ZombieActor>();
  /** Last tick's dt, so the cards' lean velocity is metres per SIM second. */
  let frameDt = 1 / 60;
  /** The mesh-side fire light pool (created once at boot, see
   *  createFireLightPool) and whether its slots are currently zeroed. */
  const fireLights: THREE.PointLight[] = [];
  let firePoolIdle = true;
  /** Last pushGatherLights census, for the capture diagnostic. */
  let gatherDebugData = { sources: 0, inRoom: 0, pushed: 0, cap: 0, maxIntensity: 0 };

  /** The flicker clock: the practicals' clock, so a frozen-light capture
   *  freezes fire too. */
  const clock = (): number => (ctx.lighting.clockFrozen
    ? ctx.lighting.flickerClockFrozenAt : performance.now() * 0.001);

  /** Every alight body as a light source at `peak`, anchored by
   *  `burnLightAnchor` (chest height). Allocates, and runs at most twice a
   *  frame while something burns. Both callers use the same flicker
   *  clock/phase, so the room and the props agree about the fire's
   *  brightness. */
  function collectFireSources(peak: number): FireLightSource[] {
    const list: FireLightSource[] = [];
    const t = clock();
    burning.forEachActive((a, s) => {
      if (s.burn <= 0.02) return;
      const p = a.pose().pos;
      list.push({
        pos: burnLightAnchor([p[0], p[1], p[2]]),
        intensity: burnLightIntensity(
          s.burn, s.char, peak, tuning.lightFlicker,
          burnLightFlicker(t, tuning.lightFlicker, a.id * 2.7),
        ),
      });
    });
    return list;
  }

  function ensureCards(): FlameCards {
    if (cards) return cards;
    const c = createFlameCards({ maxBodies: FLAME_CARD_BODY_CAP });
    cards = c;
    ctx.vfx.characterEffects.scene.add(c.object);
    applyCardLook(c);
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
      fireSrc.delete(a);
      // The body is leaving the world: release the panic override at once and
      // drop it from the transition sets, so a later reuse of the same actor
      // (or a stale set entry) cannot keep it fleeing.
      burnPrev.delete(a);
      burnCur.delete(a);
      a.setBurning(false);
    },
    step(dt) {
      // An empty registry is a single size check: nothing stepped or written.
      if (burning.size === 0) return;
      frameDt = dt;
      burning.step(Math.min(dt, 1 / 30), tuning);
      // BURNING-BEHAVIOUR TRANSITIONS (Task 2). Push only the EDGE to the
      // actor: setBurning(true) on the frame a body crosses into alight,
      // false when it drops out (extinguished, burnt down or released). The
      // 0.02 floor is pushFlashes' own "actually on fire" threshold.
      burnCur.clear();
      burning.forEachActive((a, s) => { if (s.burn > 0.02) burnCur.add(a); });
      for (const a of burnCur) if (!burnPrev.has(a)) a.setBurning(true);
      for (const a of burnPrev) if (!burnCur.has(a)) a.setBurning(false);
      const swap = burnPrev; burnPrev = burnCur; burnCur = swap;
      let any = false;
      const simDt = Math.min(dt, 1 / 30);
      burning.forEachActive((a, s) => {
        any = true;
        writeUniforms(a, s);
        // The fire volume's sources ride the same posed field the cards do.
        if (technique === 'volume') {
          // The soldier's greaves are a kit mesh over his shins: burn on them.
          const caps = fireCapsules(a.posed(), {
            legKitRadius: a.kind === 'soldier' ? SOLDIER_LEG_KIT_RADIUS : 0,
          });
          const prev = fireSrc.get(a);
          fireSrc.set(a, { caps, vels: capsuleVelocities(prev?.caps ?? null, caps, simDt) as [number, number, number][] });
        }
      });
      if (any) writeCrowdScalars();
    },
    updateCards(camera) {
      // The volume first: it is a post pass fed per frame, and must switch
      // itself off once nothing burns.
      updateVolume(camera);
      // An uncreated pool (nothing has ever ignited) skips this entirely.
      const c = cards;
      if (!c) return;
      applyCardLook(c);
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
      //
      // FLICKER DEPTH IS QUARTERED (burning-feedback task 1, A2). This one
      // light lands on the BURNING body and every non-burning neighbour alike
      // (the bodyFlash slot picks one source per body), so a full-depth flicker
      // here reads as moving molten skin on a neighbour that is not on fire
      // (measured: 0.151 luma/frame on a neighbour vs 0.0001 with flicker off).
      // The burning body keeps its animated surface-fire emissive and the room
      // lights carry the visible flicker; the neighbour gets a near-steady warm
      // light instead.
      if (burning.size === 0) return;
      const t = clock();
      const flickerDepth = tuning.lightFlicker * 0.25;
      burning.forEachActive((a, s) => {
        if (s.burn <= 0.02) return;
        const p = a.pose().pos;
        out.push({
          pos: burnLightAnchor([p[0], p[1], p[2]]),
          intensity: burnLightIntensity(
            s.burn, s.char, tuning.lightPeak, flickerDepth,
            burnLightFlicker(t, flickerDepth, a.id * 2.7),
          ),
        });
      });
    },
    pushGatherLights(out, eye, nearRoomPoint, room, cap, spread) {
      // Nothing burns (or no slot left): the gather list is untouched, so a
      // session with no fire is bit-identical to before this feature.
      //
      // SELF-SHADOW FINDING (task-1 capture, 2026-09-18): the chest anchor sits
      // inside the burning body's own torso capsule, so every probe ray to this
      // light is self-shadowed by the gather's `kdShadowed` and the packed light
      // contributes ZERO dynamic radiance (measured: packed-light count 2 vs 1,
      // identical 400-probe buffer). Lifting the anchor 1.8 m above the crown
      // makes the gather path light the room (+4.2 luma on the floor crop) but
      // re-introduces a ~10x larger flicker on non-burning neighbours
      // (0.016 -> 0.16 luma/frame) — a direct A2 regression. The mesh pool
      // (below) has no shadow test, so it is the shipped room light; this path
      // stays wired and is reported honestly in the task-1 notes.
      if (burning.size === 0 || cap <= 0) {
        gatherDebugData = { sources: 0, inRoom: 0, pushed: 0, cap, maxIntensity: 0 };
        return;
      }
      const all = collectFireSources(tuning.lightGatherPeak);
      const list = all.filter(l => nearRoomPoint(l.pos, room));
      const lamps = list.length === 0 ? [] : fireGatherLights(list, eye, cap);
      gatherDebugData = {
        sources: all.length, inRoom: list.length, pushed: lamps.length, cap,
        maxIntensity: lamps.reduce((m, l) => Math.max(m, l.intensity), 0),
      };
      for (const l of lamps) {
        out.push({ pos: l.pos, color: [1.0, 0.5, 0.18], intensity: l.intensity, fill: spread * 0.5 });
      }
    },
    createFireLightPool(parent) {
      // Idempotent: a second call would add 4 more lights and re-key the
      // LightsNode, which is the stall this pool exists to avoid.
      if (fireLights.length > 0) return;
      for (let i = 0; i < FIRE_LIGHT_POOL; i++) {
        const pl = new THREE.PointLight(0xff8a3a, 0, 0, 2);
        // PERMANENTLY visible (see the explosion pool): `.visible` is never
        // toggled, an idle slot just sits at intensity 0.
        pl.visible = true;
        parent.add(pl);
        fireLights.push(pl);
      }
      firePoolIdle = true;
    },
    updateFireLightPool(eye) {
      if (fireLights.length === 0) return;
      const list = burning.size === 0 ? [] : collectFireSources(tuning.lightMeshPeak);
      if (list.length === 0) {
        // Zero only on the transition; a permanently zeroed pool still pays
        // the idle point-light iterations, which is the documented trade.
        if (firePoolIdle) return;
        for (const pl of fireLights) pl.intensity = 0;
        firePoolIdle = true;
        return;
      }
      const slots = assignFirePool(list, eye, fireLights.length);
      for (let i = 0; i < fireLights.length; i++) {
        const s = slots[i]!;
        const pl = fireLights[i]!;
        pl.position.set(s.pos[0], s.pos[1], s.pos[2]);
        pl.intensity = s.intensity;
      }
      firePoolIdle = false;
    },
    setTuning(patch) {
      Object.assign(tuning, resolveBurnTuning({ ...tuning, ...patch }));
      return tuning;
    },
    setTechnique(name) {
      if (name === 'cards' || name === 'volume') technique = name;
      if (technique !== 'volume') fireSrc.clear();
      return technique;
    },
    technique: () => technique,
    setVolume(patch) { volume = resolveFireVolumeTuning({ ...volume, ...patch }); return { ...volume }; },
    volume: () => ({ ...volume }),
    setTongueTuning(patch) { tongue = resolveTongueTuning({ ...tongue, ...patch }); return { ...tongue }; },
    tongue: () => ({ ...tongue }),
    warmVolume() {
      const postAa = ctx.render.postAa;
      // One capsule 50 m under the floor with a matching tiny AABB: every ray
      // misses and early-outs, but all three fire pipelines are created.
      firePackBuf.fill(0);
      firePackBuf.set([0, -50, 0, 0.1, 0, -49.9, 0, 1, 0, 0, 0, 0]);
      postAa.setFireVolumeData(firePackBuf);
      postAa.setFireVolume(true, {
        ...fireFrame, tuning: volume, capsuleCount: 1,
        boundsMin: [-0.2, -50.2, -0.2], boundsMax: [0.2, -49.7, 0.2], resetHistory: true,
      });
      return () => { postAa.setFireVolume(false); fireWasOn = false; };
    },
    gatherDebug() { return { ...gatherDebugData }; },
    igniteAll() {
      for (const a of ctx.world.actors) { burning.ignite(a); ensureCards(); }
      return burning.size;
    },
    extinguishAll() { burning.extinguishAll(); },
    activeCount,
  };
}
