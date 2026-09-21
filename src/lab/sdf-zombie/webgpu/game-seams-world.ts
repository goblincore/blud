// src/lab/sdf-zombie/webgpu/game-seams-world.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { ATTACK_TUNING, type SwingVariant } from '../attack';
import { woundCarveNormal, woundWorldPos } from '../damage';
import { type Vec3 } from '../types';
import { sdBody } from '../validate';
import { ROOMS, TUNNELS, FURNITURE, enclosureKeyAt, enclosureOf } from './game-level';
import { RING_TUNING } from '../melee-ring';
import { MOTION_TUNING } from '../motion';
import { characterNames } from '../character-registry';
import { HULL_SHRINK, buildHullInstances } from './occluder-hull';

export function createWorldSeams(ctx: GameContext) {
  const { camera } = ctx.boot.handle;
  return {
    /** IS THE STATIC PROBE GRID BAKED YET?
     *
     *  The per-room grids are gathered ONCE at boot in a module WORKER, and the
     *  reply lands on whichever frame it finishes. Nothing in a recording pinned
     *  WHEN, so a capture started before the bake completed would differ from one
     *  started after it — the same async-landing problem the plan already calls
     *  out for the chunk-bake worker. `ready` is false until every queued room
     *  has replied, so a recorder can WAIT rather than assume.
     *
     *  This is a precondition seam, not a gate: it reports, it does not block.
     *  See scripts/sdf-demo-hash.mjs, which refuses to record until it is true. */
    roomProbesReady: () => ctx.world.roomProbes.ready,
    /** Every zombie: id, room, live ground pose. */
    zombies: () => ctx.world.actors.map(a => ({ id: a.id, room: a.room, ...a.pose() })),
    /** Per-actor brain readout — the crowd/AI capture driver's oracle. */
    encounter: () => ctx.world.encounter.debug(),
    /** CAPTURE SEAM: force one actor into a specific swing pose and step it,
     *  so a strip can photograph the same body at chosen phases. Not a
     *  simulation input — it drives the actor's motion config directly for
     *  one frame and the brain overwrites it on the next step. */
    poseSwing: (id: number, phase: number, side: 'L' | 'R', variant: string) => {
      ctx.world.actors.find(a => a.id === id)?.forceSwing(phase, side, variant as SwingVariant);
    },
    /** Closest surface gap (m) between arm primitives belonging to DIFFERENT
     *  bodies. Negative means interpenetration — which is exactly the defect
     *  the owner photographed on 2026-09-04, so it is a number now rather
     *  than something we look at. Endpoint-to-endpoint minus the two radii:
     *  a conservative under-estimate of the true capsule gap, which is the
     *  right direction for a gate (it can cry wolf, it cannot miss a clip).
     *  O(n^2 k^2) over ten bodies — only the capture driver calls it. */
    minHandGap: () => {
      const arms = ctx.world.actors.map(a => {
        const posed = a.posed();
        const pts: { p: Vec3; r: number }[] = [];
        for (const prim of posed.prims) {
          if (prim.limb !== 'armL' && prim.limb !== 'armR') continue;
          pts.push({ p: prim.a, r: prim.radius }, { p: prim.b, r: prim.radius });
        }
        return pts;
      });
      let best = Infinity;
      let bestPair: [number, number] = [-1, -1];
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) {
          for (const u of arms[i]!) {
            for (const v of arms[j]!) {
              const g = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1], u.p[2] - v.p[2])
                - u.r - v.r;
              if (g < best) { best = g; bestPair = [ctx.world.actors[i]!.id, ctx.world.actors[j]!.id]; }
            }
          }
        }
      }
      return best;
    },
    /** Which two bodies produced minHandGap()'s number, and what rooms they
     *  are in. Diagnostic: the metric is GLOBAL, so a negative can come from
     *  two idle wanderers in a distant room rather than from the melee ring
     *  around the player — which is exactly what it did on 2026-09-05. */
    minHandGapPair: () => {
      const arms = ctx.world.actors.map(a => {
        const posed = a.posed();
        const pts: { p: Vec3; r: number }[] = [];
        for (const prim of posed.prims) {
          if (prim.limb !== 'armL' && prim.limb !== 'armR') continue;
          pts.push({ p: prim.a, r: prim.radius }, { p: prim.b, r: prim.radius });
        }
        return pts;
      });
      let best = Infinity;
      let pair: { a: number; b: number; roomA: number; roomB: number } | null = null;
      for (let i = 0; i < arms.length; i++) {
        for (let j = i + 1; j < arms.length; j++) {
          for (const u of arms[i]!) {
            for (const v of arms[j]!) {
              const g = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1], u.p[2] - v.p[2])
                - u.r - v.r;
              if (g < best) {
                best = g;
                pair = {
                  a: ctx.world.actors[i]!.id, b: ctx.world.actors[j]!.id,
                  roomA: ctx.world.actors[i]!.room, roomB: ctx.world.actors[j]!.room,
                };
              }
            }
          }
        }
      }
      return { gap: best, ...(pair ?? {}) };
    },
    /** Debug seam for the crowd capture driver: the separation nudge, by id,
     *  with the same bounds clamp and furniture rejection. Lets a driver
     *  PLACE bodies (e.g. coincident, to watch separate() push them apart)
     *  without a separate teleport path that could dodge the clamps. */
    zombieNudge: (id: number, dx: number, dz: number) => {
      ctx.world.actors.find(a => a.id === id)?.nudge(dx, dz);
    },
    /** One zombie's internals — the weapon seam: view (uniforms/wounds),
     *  posed() (raycast target), boundRig() (impulse/recoil entry). */
    zombie: (id: number) => {
      const a = ctx.world.actors.find(a => a.id === id);
      return a ? {
        get body() { return a.body; },
        view: a.view, posed: a.posed, boundRig: a.boundRig, pose: a.pose, room: a.room,
        hit: a.hit, hitSlug: a.hitSlug,
        woundCount: () => a.wounds().length,
        woundList: () => [...a.wounds()],
        visualWoundList: () => [...a.visualWounds()],
      } : undefined;
    },
    /** Where every wound of a body sits IN WORLD SPACE right now — the
     *  surface anchor (= the GPU carve sphere's centre) plus the depth-slab
     *  cap, mapped at the actor's live yaw (the body-frame wound contract,
     *  game-actor refreshWounds). The placement gate diffs the surface
     *  against the fired ray's impact point; carveDepth is the punch-through
     *  guard (0.45 × measured local flesh). */
    debugWounds: (id: number) => {
      const a = ctx.world.actors.find(a => a.id === id);
      if (!a) return undefined;
      const prims = a.posed().prims;
      const yaw = a.pose().yaw;
      return a.wounds().map(w => ({
        surface: woundWorldPos(prims, w, yaw),
        // Where it was PLACED, before the hit's recoil shove moved the body.
        // `surface` is the live position and is what the renderer uses; this
        // is the one to compare against a pre-shot prediction. Conflating the
        // two is what made the slug placement gate read 18 cm of "error" that
        // was really IMPULSE.blast — see game-actor's stampWorld note.
        stampSurface: a.stampWorldOf(w),
        carveNormal: woundCarveNormal(prims, w, yaw),
        carveDepth: w.carveDepth,
        radius: w.radius,
        type: w.type,
        primIdx: w.primIdx,
      }));
    },
    setProbes: (weight: number, gain = -1) => { ctx.world.roomProbes.setProbes(weight, gain); return { weight: ctx.world.roomProbes.weight, gain: ctx.world.roomProbes.gain }; },
    get probes() { return { weight: ctx.world.roomProbes.weight, gain: ctx.world.roomProbes.gain, ready: ctx.world.roomProbes.ready, matched: ROOMS.map(r => [r.id, ctx.world.roomProbes.matchedGain(r.id)]) }; },
    /** TASK-6 TRUE-EMPTY PROOF SEAM: hide/show the static level meshes
     *  (dungeon shell + accents). With them hidden and the camera aimed at
     *  the (now absent) ceiling, verified rays see NO producer at any depth:
     *  the G-buffer there is the far sentinel with an empty class — the
     *  deterministic true-empty region this enclosed dungeon otherwise
     *  lacks. The router's sync() skips visible=false subtrees, so this is
     *  exact for both the G-buffer and the forward pass. */
    setLevelMeshVisible: (on: boolean) => {
      ctx.world.levelGroup.visible = on;
      ctx.world.accentGroup.visible = on;
    },
    /** P3 capture: world centre of an actor's live head or torso cluster, or null. */
    actorLimbCenter: (actorId: number, limb: 'head' | 'torso') => {
      const a = ctx.world.actors.find((q) => q.id === actorId);
      const c = a?.posed().clusters.find((cc) => cc.limb === limb && cc.alive)?.center;
      return c ? ([c[0], c[1], c[2]] as Vec3) : null;
    },
    /** Burning-feedback task 1: project a WORLD point to output px (row 0 =
     *  top), or null behind the camera. The neighbour diagnosis crops a fixed
     *  box on the returned (x, y) and measures frame-to-frame change over it;
     *  the fire-light pair crops a floor point computed from it. */
    worldToScreen: (x: number, y: number, z: number, width: number, height: number) => {
      const ndc = new THREE.Vector3(x, y, z).project(camera);
      if (ndc.z > 1) return null;
      return { x: (ndc.x + 1) * 0.5 * width, y: (1 - ndc.y) * 0.5 * height };
    },
    /** P3 capture: an actor's wounds in world space — the transform rendering uses. */
    actorWounds: (actorId: number) => {
      const a = ctx.world.actors.find((q) => q.id === actorId);
      if (!a) return [];
      const posed = a.posed();
      const yaw = a.pose().yaw;
      return a.wounds().map((w) => ({ pos: woundWorldPos(posed.prims, w, yaw), radius: w.radius, type: w.type }));
    },
    /** P3 capture: every actor's head circle and wound circles, projected through the live camera to
     *  output px (row 0 = top); circles behind the camera are omitted. Call after a render, with the
     *  march jitter off. */
    captureAnnotations: (width: number, height: number, headRadius = 0.12) => {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const circle = (c: readonly number[], r: number) => {
        const centre = new THREE.Vector3(c[0], c[1], c[2]);
        const a = centre.clone().project(camera);
        if (a.z > 1) return null;
        const b = centre.clone().addScaledVector(up, r).project(camera);
        const ax = (a.x + 1) * 0.5 * width;
        const ay = (1 - a.y) * 0.5 * height;
        const bx = (b.x + 1) * 0.5 * width;
        const by = (1 - b.y) * 0.5 * height;
        return { x: ax, y: ay, r: Math.hypot(bx - ax, by - ay) };
      };
      return ctx.world.actors.map((a) => {
        const posed = a.posed();
        const yaw = a.pose().yaw;
        const head = posed.clusters.find((cc) => cc.limb === 'head' && cc.alive)?.center;
        const wounds: Array<{ x: number; y: number; r: number; type: unknown }> = [];
        for (const w of a.wounds()) {
          const c = circle(woundWorldPos(posed.prims, w, yaw), w.radius);
          if (c) wounds.push({ ...c, type: w.type });
        }
        return { actorId: a.id, head: head ? circle(head, headRadius) : null, wounds };
      });
    },
    /**
     * March step budget across every body (marchCfg.x, ships at 96).
     *
     * This is a MEASUREMENT seam, and the measurement it exists for is the
     * shell-march decision. Cost decomposes as roughly
     *   cost(budget) ~= hitPixels * (steps to converge) + missPixels * budget
     * because a ray that lands on flesh converges in ~8 steps while a ray that
     * misses runs on toward the budget. Sweeping the budget and fitting the
     * line therefore splits the frame into what HITS cost (the intercept) and
     * what MISSES cost (the slope) — and the misses are exactly the work a
     * bounded entry/exit shell would delete.
     *
     * Lowering this degrades the image (rays give up before converging), so
     * it is for benching only; nothing should ship on a reduced budget without
     * its own visual gate.
     */
    /** Over-relaxation (woundCfg2.y). Ships at GAME_RELAX; <= 1.0 falls back
     *  to marchCfg.y, which is the UNDER-relaxed 0.6 the page used to run. */
    setRelax(v: number) {
      for (const a of ctx.world.actors) a.view.uniforms.woundCfg2.value.y = v;
    },
    get relax() { return ctx.world.actors[0]?.view.uniforms.woundCfg2.value.y ?? 0; },
    get flatAlbedo() { return (ctx.world.actors[0]?.view.uniforms.debugCfg.value.y ?? 0) > 0.5; },
    setHullExitBound(on: boolean) { for (const a of ctx.world.actors) a.view.uniforms.perfCfg.value.x = on ? 1 : 0; },
    get hullExitBound() { return (ctx.world.actors[0]?.view.uniforms.perfCfg.value.x ?? 0) > 0.5; },
    /** Wound-loop early-out (perf round 2 task 3, perfCfg.y). */
    setWoundEarlyOut(on: boolean) { for (const a of ctx.world.actors) a.view.uniforms.perfCfg.value.y = on ? 1 : 0; },
    get woundEarlyOut() { return (ctx.world.actors[0]?.view.uniforms.perfCfg.value.y ?? 0) > 0.5; },
    get woundStep() { return ctx.world.actors[0]?.view.uniforms.perfCfg.value.z ?? 0; },
    /** Last-step secant accept multiplier (perfCfg.w); 0 = off. */
    setLastStep(v: number) {
      const n = v <= 0 ? 0 : Math.min(16, v);
      for (const a of ctx.world.actors) a.view.uniforms.perfCfg.value.w = n;
    },
    get lastStep() { return ctx.world.actors[0]?.view.uniforms.perfCfg.value.w ?? 0; },
    /** ATTRIBUTION ONLY: the per-limb owner re-fold under another cluster's
     *  wound (march.wgsl.ts, counts2.z). OFF renders a wrong frame on
     *  purpose; it exists to price the mechanism in the passes bench. */
    setOwnerRefold(on: boolean) {
      for (const a of ctx.world.actors) a.view.uniforms.counts2.value.z = on ? 0 : 1;
    },
    /** Owner re-fold RAISER GATE (counts2.z == 2, 2026-09-21): re-fold a limb only where a wound
     *  it does not own actually raised the field. Value-identical by construction; off = ship. */
    setOwnerRefoldGate(on: boolean) {
      for (const a of ctx.world.actors) a.view.uniforms.counts2.value.z = on ? 2 : 0;
    },
    /** Owner re-fold THREAT MASK (counts2.z == 3, 2026-09-21): the raiser gate, narrowed per
     *  cluster by the CPU masks the body view uploads (wound-threat.ts). off = ship. */
    setOwnerRefoldMask(on: boolean) {
      for (const a of ctx.world.actors) a.view.uniforms.counts2.value.z = on ? 3 : 0;
    },
    get ownerRefoldMask() { return (ctx.world.actors[0]?.view.uniforms.counts2.value.z ?? 0) > 2.5; },
    /** Diagnostic: every wounded actor's per-wound threat masks (bit c+1 = cluster c). */
    woundThreats() {
      return ctx.world.actors.map(a => ({ id: a.id, margin: a.view.woundThreatMargin, masks: a.view.woundThreats?.() ?? [] })).filter(m => m.masks.length > 0);
    },
        get ownerRefoldGate() { const z = ctx.world.actors[0]?.view.uniforms.counts2.value.z ?? 0; return z > 1.5 && z < 2.5; },
    get ownerRefold() { return (ctx.world.actors[0]?.view.uniforms.counts2.value.z ?? 0) < 0.5; },
    /** Per-ray wound list (march.wgsl.ts, counts2.w): build the reachable
     *  wound set once per pixel and fold only those. OFF is bit-identical. */
    setWoundList(on: boolean) {
      for (const a of ctx.world.actors) a.view.uniforms.counts2.value.w = on ? 1 : 0;
    },
    get woundList() { return (ctx.world.actors[0]?.view.uniforms.counts2.value.w ?? 0) > 0.5; },
    /** Diagnostic read: every actor's wound bound [x, y, z, radius]. Proves
     *  the wire end-to-end — a radius in (0, 1e8) is a COMPUTED bound; 1e9
     *  is the no-cull identity; 0 means no wounds uploaded. */
    woundBound() {
      return ctx.world.actors.map(a => {
        const v = a.view.uniforms.woundBound.value;
        return [v.x, v.y, v.z, v.w];
      });
    },
    /** Step multiplier (marchCfg.y). Ships at GAME_OMEGA. */
    setOmega(v: number) {
      const n = Math.max(0.1, Math.min(1.0, v));
      for (const a of ctx.world.actors) a.view.uniforms.marchCfg.value.y = n;
    },
    get omega() { return ctx.world.actors[0]?.view.uniforms.marchCfg.value.y ?? 0; },
    get aa() { return ctx.world.actors[0]?.view.uniforms.aaCfg.value.y ?? 0; },
    get levelShadow() { return (ctx.world.actors[0]?.view.uniforms.levelShadowCfg.value.x ?? 0) > 0.5; },
    setMarchSteps(n: number) {
      for (const a of ctx.world.actors) a.view.uniforms.marchCfg.value.x = n;
    },
    get marchSteps() { return ctx.world.actors[0]?.view.uniforms.marchCfg.value.x ?? 0; },
    /**
     * INSIDE-NESS OF THE LIVE, POSED OCCLUDER HULL.
     *
     * occluder-hull.test.ts already asserts every emitted sphere sits inside
     * the flesh — but only for bodies straight out of buildBody, i.e. in the
     * REST pose. This runs the same assertion against the bodies the game is
     * actually rendering, through the same sdBody the raycaster trusts, and
     * reports which primitive authored each sphere that fails.
     */
    hullInsideness(tol = 1e-4) {
      const bad: Array<Record<string, unknown>> = [];
      let total = 0;
      let worst = 0;
      for (let bi = 0; bi < ctx.world.actors.length; bi++) {
        const body = ctx.world.actors[bi]!.posed();
        const spheres = buildHullInstances([body], HULL_SHRINK);
        for (const sph of spheres) {
          total++;
          // Inside means the centre is at least `radius` deep in the flesh.
          const d = sdBody(sph.centre, body);
          const proud = d + sph.radius;
          if (proud > worst) worst = proud;
          if (proud > tol) {
            bad.push({
              actor: ctx.world.actors[bi]!.id, centre: sph.centre.map(v => +v.toFixed(3)),
              radius: +sph.radius.toFixed(4), sdBody: +d.toFixed(4),
              proudMm: +(proud * 1000).toFixed(1),
            });
          }
        }
      }
      return {
        spheres: total, outside: bad.length,
        worstProudMm: +(worst * 1000).toFixed(1),
        sample: bad.slice(0, 12),
      };
    },
    /** Settled-chunk bake (close-up task 5). ON at boot (GAME_CHUNK_BAKE);
     *  off is pixel-identical. Toggling mid-session only affects FUTURE
     *  settles — baked pieces stay baked until shot or recycled. */
    soldierCorpseBake: () => ctx.world.soldierCorpses?.stats(),
    setSoldierCorpseBake(on: boolean) { ctx.world.soldierCorpses?.setEnabled(on); },
    /** WHAT THE MATERIALS ACTUALLY HOLD, not what was requested. `chunkDetail`
     *  is the override; this is the value the per-frame push last wrote into
     *  each registered material's `fleshDetail.x`, which is what the shader
     *  reads. They differ whenever the push is not reaching a material — the
     *  exact failure this getter exists to make visible, because a look A/B on
     *  a floor full of recycling gore cannot distinguish "the term does nothing"
     *  from "the term never arrived". */
    chunkDetailApplied: () => ctx.world.litChunkMaterials.map(m => {
      const d = m.uniforms.fleshDetail.value;
      return { amp: d.x, freq: d.y, albedo: d.z, ambient: m.uniforms.ambient.value.getHex() };
    }),
    /** The live roster in world terms — what a blast gate needs to pick a
     *  target and to count what a detonation removed. Read-only scalars only:
     *  id, kind, room, ground position, yaw, collapse phase. No GPU state, so
     *  this is safe to poll between stepped frames. */
    actorList: () => ctx.world.actors.map(a => {
      const p = a.pose();
      const d = a.debug();
      return {
        id: a.id, kind: a.kind, room: a.room,
        pos: [p.pos[0], p.pos[1], p.pos[2]] as Vec3, yaw: p.yaw,
        phase: d.phase, meter: d.meter,
      };
    }),
    brains: () => ctx.world.actors.map(a => {
      const b = a.mind().debug();
      const p = a.pose().pos;
      return {
        id: a.id, room: a.room, kind: a.kind, phase:a.debug().phase, state: b.state, alert: b.alert,
        swingT: b.swingT, side: b.side, variant: b.variant,
        hasToken: a.debug().hasToken,
        aimT: b.aimT, cooldown: b.cooldown, sinceFire: a.sinceFire(),
        meleeContacts: a.debug().meleeContacts,
        speed: a.debug().speed, target: a.debug().target,
        dist: Math.hypot(p[0] - ctx.player.player.pos[0], p[2] - ctx.player.player.pos[2]),
        bearing: Math.atan2(p[0] - ctx.player.player.pos[0], p[2] - ctx.player.player.pos[2]),
      };
    }),
    /** Ring tuning, so a capture driver asserts against the real numbers
     *  rather than duplicating them. */
    ringTuning: () => ({ ...RING_TUNING }),
    /** attack.ts's beat boundaries, so a capture driver derives its phases
     *  from the real numbers instead of duplicating them. */
    attackTuning: () => ({ ...ATTACK_TUNING }),

    /** Project a world point through the LIVE game camera to NDC + a
     *  behind-camera flag (M2 task 5 boot driver: proves a capture subject
     *  is actually IN FRAME — the old wounded capture faced +Z with the
     *  actor 1.2 m to the west and nothing caught it). |ndc| <= 1 is on
     *  screen; z > 1 means behind/clipped. */
    screenPosOf(x: number, y: number, z: number) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: v.x, y: v.y, z: v.z };
    },
    /** The live camera's world position (task-6 normal-direction evidence:
     *  an OUTWARD camera-facing surface normal points toward the eye, so it
     *  satisfies n·(eye−surface) > 0 — the camera-surface oracle). */
    cameraWorld: () => [camera.position.x, camera.position.y, camera.position.z] as Vec3,
    /** The exact inverse of screenPosOf: the world point `dist` metres along
     *  the live camera ray through an NDC point (depth-probe evidence seam —
     *  lets a gate place a forward sprite on a pixel it has already verified
     *  is empty-far in the raw G-buffer). */
    screenRayToWorld(ndcX: number, ndcY: number, dist: number) {
      const v = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
      v.sub(camera.position).normalize();
      const w = camera.position.clone().addScaledVector(v, dist);
      return [w.x, w.y, w.z] as Vec3;
    },

    /** Footprint-AA strength (perf round 2 task 6, aaCfg.y). 0 = the old
     *  march bit-for-bit; also refreshes the one-pixel footprint (aaCfg.x) so
     *  a frozen-scene A/B at a pinned scale reads the intended pair. */
    setAa(strength: number) {
      const k = ctx.render.sdfLayer.pixelConeK;
      for (const a of ctx.world.actors) {
        a.view.uniforms.aaCfg.value.x = k;
        a.view.uniforms.aaCfg.value.y = strength;
      }
    },
    /** Level shadows on bodies (perf round 2 task 7, levelShadowCfg.x).
     *  0 = the pre-task-7 march bit-for-bit (the helper returns 1.0 before
     *  sampling). The per-frame pose block ANDs this with the beam and map
     *  existence, so a false here also survives ?spotshadow=0 boots. */
    setLevelShadow(on: boolean) {
      ctx.lighting.levelShadowEnabled = !!on;
      for (const a of ctx.world.actors) a.view.uniforms.levelShadowCfg.value.x = on ? 1 : 0;
    },

    /** A/B seam for the shoulder socket clamp (motion.ts
     *  MOTION_TUNING.shoulderSocket). 0.05 is the shipped cap; 0 disables the
     *  clamp entirely. Live — the next stepMotion reads it — and pairable
     *  with refreshHull() / ?frozen=1 for single-variable captures. */
    setShoulderSocket: (cap: number) => {
      (MOTION_TUNING as { shoulderSocket: number }).shoulderSocket = cap;
    },

    /** CAPTURE SEAM (M2 task 5): spawn one extra REGISTRY character in the
     *  player's current room through THE SAME spawnEnemy path as boot (so
     *  deferred gpu opts, router registrations and kit/prop wiring all flow
     *  identically), and return its actor id. Task-6's "all registered
     *  characters rendered once" gate drives this; ordinary play never
     *  calls it. Face/kit/prop evidence needs a live goblin/clown, which the
     *  room roster (zombies + the one soldier) does not carry. */
    /** THE REGISTRY, live (task-6 gate): the roster the gate must cover is
     *  character-registry.ts's own keys, read through the page so a driver
     *  cannot silently drift from the registry the game actually spawns
     *  (the zombie-only blind spot this gate exists to kill was exactly
     *  such a drift). Read-only, JSON-serialisable, order = registry order. */
    characterNames: (): string[] => [...characterNames()],

    /** THE ENCLOSURE A POINT IS IN, in metres: the same box the probe gather and
     *  the bundle's ceiling resolve against. A rig that wants to assert "this
     *  piece stayed in the room" needs the room's rectangle, and hard-coding it
     *  in the rig would let the level move out from under the assertion. */
    enclosureBoxAt: (x: number, z: number) => {
      const key = enclosureKeyAt(x, z);
      const enc = enclosureOf(key);
      return enc ? { key, min: enc.box.min, max: enc.box.max } : null;
    },

    rooms: ROOMS.map(r => ({
      id: r.id, name: r.name, zombies: r.zombies,
      bounds: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ },
    })),
    tunnels: TUNNELS.map(t => t.name),
    furniture: FURNITURE,
    /** Accent lights per room — capture/measurement seam (pair-shot framing). */
    accents: ROOMS.flatMap(r => r.accents.map(a => ({ room: r.id, ...a })))
  };
}
