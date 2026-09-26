import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import { roomSpawnPoints } from './game-level-leaves';
import { crowdGridPoints, REGION_INSET_M, type FloorRect } from './crowd-spawn';
import { rngStreams } from './rng';
import { CHUNK_TUNING } from '../gib-chunks';
import { EXPLOSION_PROFILE } from '../explosion-aoe';
import { slotLowerAmount, slotReady } from './game-weapon-slots';
import type { Primitive, Vec3 } from '../types';
import type { Quat } from '../vec';

/** Closures this group still needs from main(). */
export interface SpawnGooDeps {
  /** Maximum room height; feeds the bundle-ceiling readout. */
  BUNDLE_CEIL_M: number;
  playerRoomId(): number;
  spawnChunkPiece(
    piece: {
      limb: string; origin: Vec3; prims: Primitive[]; tornAt: Vec3[];
      bones: Primitive[]; kind?: 'limb' | 'gob' | 'bone';
      /** Pre-release orientation + angular velocity (body-to-gib task 4). */
      spinQuat?: Quat; spinAngVel?: Vec3;
    },
    template: { uniforms: import('./zombie-gpu').MarchUniforms; volumeTexture: THREE.Texture },
    initialVelocity?: Vec3,
  ): void;
}

export function createSpawnGooSeams(ctx: GameContext, d: SpawnGooDeps) {
  return {
    /** Live slot/cook/flight state — the tuning readout and a gate's oracle. */
    dynamite: () => ({
      live: ctx.weapon.slotState.live,
      target: ctx.weapon.slotState.target,
      phase: ctx.weapon.slotState.phase,
      ready: slotReady(ctx.weapon.slotState),
      gunLower: slotLowerAmount(ctx.weapon.slotState, 'shotgun'),
      bundleLower: slotLowerAmount(ctx.weapon.slotState, 'dynamite'),
      cookPhase: ctx.vfx.cook.phase,
      charge: ctx.dynamite.charge,
      inHand: ctx.weapon.heldProp !== null,
      inFlight: ctx.bake.liveBundles.length,
      flights: ctx.bake.liveBundles.map(b => ({
        pos: b.state.pos, vel: b.state.vel, fuse: b.state.fuse,
        resting: b.state.resting, detonated: b.state.detonated,
        drawn: b.prop !== null,
      })),
      // PROP-POOL ACCOUNTING. The pool is where a "the dynamite vanished" bug
      // lives, and none of it is visible from the outside without these.
      props: ctx.bake.bundleProps.length,
      spares: ctx.bake.spareBundles.length,
      heldVisible: ctx.weapon.heldProp ? ctx.weapon.heldProp.object.visible : null,
      heldParent: ctx.weapon.heldProp ? (ctx.weapon.heldProp.object.parent === ctx.bake.bundleRig ? 'rig' : 'other') : null,
      heldLocal: ctx.weapon.heldProp
        ? [ctx.weapon.heldProp.object.position.x, ctx.weapon.heldProp.object.position.y, ctx.weapon.heldProp.object.position.z]
          .map(v => Number(v.toFixed(3)))
        : null,
      drawnBundles: ctx.bake.liveBundles.filter(b => b.prop !== null).length,
      thrown: ctx.dynamite.thrown, detonations: ctx.dynamite.detonations,
      gibbed: ctx.dynamite.gibbed, gibPieces: ctx.dynamite.gibPieces, lastBlastMs: ctx.dynamite.lastBlastMs,
      gibMode: ctx.gibs.mode, gibBones: ctx.gibs.bones, gibStaggerFrames: ctx.gibs.staggerFrames, maxChunks: ctx.bake.maxChunks, dynSpeedScale: ctx.dynamite.speedScale, gibVelScale: ctx.gibs.velScale,
      gibLaunchMode: ctx.gibs.launchMode,
      aoeRadiusScale: ctx.vfx.aoeRadiusScale, aoeLaunchFloor: ctx.vfx.aoeLaunchFloor,
      ceilM: d.BUNDLE_CEIL_M,
      // THE STAGED RELEASE, as numbers a gate can assert on: how many pieces are
      // still waiting for their blast impulse, and how far that queue's oldest
      // entry is from firing. `?gibstagger=1` must empty the queue on the blast
      // frame; the default must NOT.
      pendingPieceImpulses: ctx.gibs.pendingGibImpulses.length,
      pendingPieceFrames: ctx.gibs.pendingGibImpulses.reduce((m, p) => Math.max(m, p.delay), 0),
      // NB there is deliberately NO "pieces at rest" counter: `stepChunk`
      // applies gravity to every chunk, so a piece held for the stagger is at
      // rest for exactly the frame it was born and for none after. The queue
      // length is the honest signal that the blast has not gone off yet.
      pendingPieceDelays: ctx.gibs.pendingGibImpulses.map(p => p.delay),
      fxLightScale: ctx.lighting.fxLightScale, lights: ctx.vfx.explosionLights.length,
      // What the ROOM is actually being lit with right now, and the age of the
      // newest burst's light — the two numbers a light measurement needs.
      meshIntensity: ctx.vfx.explosionLightPool.map(pl => Number(pl.intensity.toFixed(1))),
      lightAges: ctx.vfx.explosionLights.map(e => Number(e.age.toFixed(3))),
      lastBlastRadiusM: ctx.dynamite.lastRadiusM,
      lastGibDropped: ctx.dynamite.lastGibDropped,
      lastGibTier: ctx.dynamite.lastGibTier, lastGibSpawned: ctx.dynamite.lastGibSpawned, gibWounds: ctx.gibs.wounds,
      gibTierLog: ctx.dynamite.gibTierLog,
      gibTearSec: ctx.gibs.tearSec,
      // THE PRE-TEAR WINDOW, live: how many bodies are bending right now, how
      // far into their window the oldest is, and how many are waiting for it to
      // close. A rig asserts the sequence from these rather than from a feeling
      // about the frames.
      tearing: ctx.world.actors.filter(x => x.tearing()).length,
      tearAge: ctx.world.actors.reduce((m, x) => Math.max(m, x.tearAge()), 0),
      // THE RUPTURE'S ACTUAL DISPLACEMENT, in metres: the largest region offset
      // any body is being drawn with right now. A rig asserts that the body is
      // separating (this climbs from 0 to the peak) instead of trusting a
      // frame's silhouette.
      ruptureMaxM: ctx.world.actors.reduce((m, x) => {
        const f = x.tearFrame();
        if (!f) return m;
        for (const o of f.offsets) m = Math.max(m, Math.hypot(o[0], o[1], o[2]));
        return m;
      }, 0),
      // THE RUPTURE'S ACTUAL ROTATION, in radians (task 4): the largest
      // per-region angle any body is being drawn with right now. A rig asserts
      // the pieces are already TILTED before release (this climbs from 0) and
      // that the released chunks keep the orientation (chunkStats().livePieces
      // quats) rather than being a translation-only explosion.
      ruptureMaxRad: ctx.world.actors.reduce((m, x) => {
        const f = x.tearFrame();
        if (!f) return m;
        for (const q of f.quats) {
          const w = Math.min(1, Math.abs(q[3]));
          m = Math.max(m, 2 * Math.acos(w));
        }
        return m;
      }, 0),
      pendingGibs: ctx.gibs.pendingGibs.length,
      // THE PREVIEW'S SHAPE, live (task 3): the regions a pending body is
      // actually being drawn as, and the tier that will spawn. A rig compares
      // these against `lastGibTier`/`lastGibSpawned` after release to prove the
      // preview and the spawn are the same piece set.
      pendingPlanPieces: ctx.gibs.pendingGibs.reduce((n, q) => n + q.plan.pieces.length, 0),
      pendingTiers: ctx.gibs.pendingGibs.map(q => q.tier),
      scheduledGibBodies: ctx.dynamite.scheduledGibBodies, scheduledGibPieces: ctx.dynamite.scheduledGibPieces,
      lastGibParts: ctx.dynamite.lastGibParts, lastGibHeld: ctx.dynamite.lastGibHeld,
      blastProfile: ctx.dynamite.blastProfile,
      // The resolver's own split for the LAST blast. Reset in detonateAt, not
      // here: a getter with a side effect is a trap, and reading this after
      // `blastProfile` (which shares this object) silently consumed the data.
      resolveProfile: { ...EXPLOSION_PROFILE },
    }),
    /** Live tuning for the look pass — threshold/edge/blur are the three
     *  knobs that decide beads-vs-ropes-vs-sheets. */
    /**
     * DIAGNOSTIC: read the density field back off the GPU and report what is
     * actually in it.
     *
     * This exists because "the goo is invisible" has two completely different
     * causes that look identical on screen: an EMPTY field (nothing upstream
     * ever wrote density) versus a FULL field the surface pass is failing to
     * draw. Guessing between them cost several rounds; measuring takes one
     * call. Compare `max` against `threshold`: max below it means no pixel can
     * ever qualify and the fault is upstream in sync/density; max above it
     * with nothing on screen means the fault is the surface or the composite.
     */
    async gooProbe() {
      if (!ctx.goo.layer) return { unavailable: true };
      // Half-float decode: WebGPU hands back raw 16-bit patterns, and the
      // density targets are HalfFloatType because additive blending is only
      // guaranteed on 16-bit float in WebGPU core.
      const h2f = (h: number): number => {
        const sign = (h & 0x8000) ? -1 : 1;
        const exp = (h & 0x7c00) >> 10;
        const frac = h & 0x03ff;
        if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
        if (exp === 0x1f) return frac ? NaN : sign * Infinity;
        return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
      };
      const readOne = async (t: THREE.RenderTarget) => {
        const w = t.width;
        const h = t.height;
        const raw = new Uint16Array(
          await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h) as ArrayLike<number>,
        );
        // WebGPU pads each readback row to a 256-byte boundary; at 8 bytes per
        // RGBA16F texel that is not the same as w * 4 shorts, and ignoring it
        // reads garbage from the padding as if it were density.
        const shortsPerRow = Math.ceil((w * 8) / 256) * 256 / 2;
        let max = 0;
        let nonZero = 0;
        let sum = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const r = h2f(raw[y * shortsPerRow + x * 4] ?? 0);
            if (!Number.isFinite(r)) continue;
            if (r > 0) nonZero++;
            if (r > max) max = r;
            sum += r;
          }
        }
        return { w, h, max, nonZero, mean: sum / (w * h) };
      };
      const { density, blurred } = ctx.goo.layer.debugTargets;
      return {
        enabled: ctx.goo.enabled,
        mode: ctx.goo.layer.mode,
        threshold: ctx.goo.layer.threshold,
        blurPx: ctx.goo.layer.blurPx,
        liveCount: ctx.goo.layer.liveCount,
        syncCalls: ctx.goo.layer.syncCalls,
        density: await readOne(density),
        blurredBuf: await readOne(blurred),
      };
    },
    /** Spawn `n` copies of `name` into the player's room (bench/crowd seam),
     *  spread on a grid centred on the room's first spawn point so the bench
     *  measures bodies-in-a-room, not N stacked on one spawn (perf 7f).
     *
     *  `opts.region` (distance scene, 2026-09-14) places the grid in an
     *  explicit ground rect instead: centred on the region's centre, clamped
     *  inside it, and with columns chosen to fit the region's span so an
     *  elongated region does not clamp bodies into collisions. The room's
     *  spawn point / bounds remain the default when `region` is omitted.
     *
     *  `ring` is accepted for the seam but the measured layout is the grid.
     *  Stops at the first failure; returns how many landed and where. */
    spawnCrowd: (
      name: string, n: number,
      opts?: { spacing?: number; ring?: boolean; region?: FloorRect },
    ) => {
      const rooms = ctx.world.level.rooms;
      const room = rooms.find(r => r.id === d.playerRoomId()) ?? rooms[0]!;
      const spacing = opts?.spacing ?? 1.2;
      let p0: Vec3;
      let floor: FloorRect;
      let gridOpts: { centre: [number, number]; inset: number } | undefined;
      if (opts?.region) {
        const r = opts.region;
        const cxs = (r.minX + r.maxX) / 2;
        const czs = (r.minZ + r.maxZ) / 2;
        p0 = [cxs, 0, czs];
        floor = r;
        gridOpts = { centre: [cxs, czs], inset: REGION_INSET_M };
      } else {
        const starts = roomSpawnPoints(ctx, room);
        // Authored rooms carry no ring spawn slots: fall back to the room centre.
        p0 = starts[0] ?? ([(room.minX + room.maxX) / 2, 0, (room.minZ + room.maxZ) / 2] as Vec3);
        floor = { minX: room.minX, maxX: room.maxX, minZ: room.minZ, maxZ: room.maxZ };
      }
      const points = crowdGridPoints(p0, n, spacing, floor, gridOpts);
      const placed: [number, number, number][] = [];
      let ok = 0;
      for (let i = 0; i < points.length; i++) {
        try {
          (window as any).__sdfGame.spawnDebugCharacter(name, points[i]);
          placed.push([points[i]![0], points[i]![1], points[i]![2]]);
          ok++;
        } catch (e) { console.error('[sdf-game] spawnCrowd stopped at', i, e); break; }
      }
      return { ok, placed };
    },
    /** THE BAKED ALBEDO ITSELF, sampled off a settled piece's `bakeColor`
     *  attribute — the vertex colour the shader composes from.
     *
     *  The whole question about a settled piece is whether it looks wrong
     *  because of the ALBEDO or because of the LIGHT on it, and those two are
     *  indistinguishable on screen. This reads the albedo directly: mean rgb,
     *  its range, and the mean wound-mask alpha. Values are LINEAR, matching
     *  the .blob palette (flesh baseColor is 0.68 0.44 0.40). */
    bakedAlbedoStats: () => ctx.bake.chunks.map(b => {
      const a = b.mesh.geometry.getAttribute('bakeColor');
      if (!a) return { id: b.id, error: 'no bakeColor' };
      const v = a.array as ArrayLike<number>;
      const n = v.length / 4;
      let r = 0, g = 0, bl = 0, wm = 0;
      const mn = [9, 9, 9], mx = [-9, -9, -9];
      for (let i = 0; i < v.length; i += 4) {
        r += v[i]!; g += v[i + 1]!; bl += v[i + 2]!; wm += v[i + 3]!;
        for (let k = 0; k < 3; k++) {
          if (v[i + k]! < mn[k]!) mn[k] = v[i + k]!;
          if (v[i + k]! > mx[k]!) mx[k] = v[i + k]!;
        }
      }
      const f = (x: number) => Math.round(x * 1000) / 1000;
      return {
        id: b.id, verts: n,
        mean: [f(r / n), f(g / n), f(bl / n)],
        min: mn.map(f), max: mx.map(f), meanWoundMask: f(wm / n),
        // AO: mean and range. A flat 1.0 means the attribute is absent or the
        // bake is not writing it, which is indistinguishable from "the piece is
        // simply unoccluded" on screen.
        ao: (() => {
          const g2 = b.mesh.geometry.getAttribute('bakeAo');
          if (!g2) return 'absent';
          const v2 = g2.array as ArrayLike<number>;
          let sum = 0, lo = 9, hi = -9;
          for (let i = 0; i < v2.length; i++) {
            sum += v2[i]!; if (v2[i]! < lo) lo = v2[i]!; if (v2[i]! > hi) hi = v2[i]!;
          }
          return { mean: f(sum / v2.length), min: f(lo), max: f(hi) };
        })(),
      };
    }),
    /** Dev seam (chunk-bake gate/look/bench): spawn one synthetic meat-ball
     *  chunk at a world position through the REAL spawn path — the same
     *  view, sim, settle, bake and gib machinery a severed limb uses, with
     *  a controlled size so drivers get a target whose radius they know.
     *  A severed hand-gob's 4.6 cm bounding sphere is a sniper target; this
     *  is the same machinery at a testable size.
     *
     *  Task-4 additions (additive): an optional `velocity` overrides the random
     *  launch (so a rig can stage a slow SLIDE instead of a lob), and the return
     *  value is the new piece's stable id (was `prims.length`) so a rig can
     *  track it across the exposure/settle. The only prior consumer carried the
     *  count into a JSON blob without asserting on it. */
    spawnTestChunk: (x: number, y: number, z: number, radius = 0.12, stationary = false, velocity?: Vec3, spin?: Vec3) => {
      const prims: Primitive[] = [];
      const rng = rngStreams.misc;
      for (let i = 0; i < 6; i++) {
        const th = rng() * Math.PI * 2;
        const ph = Math.acos(2 * rng() - 1);
        const dx = Math.sin(ph) * Math.cos(th) * radius * 0.5;
        const dy = Math.cos(ph) * radius * 0.5;
        const dz = Math.sin(ph) * Math.sin(th) * radius * 0.5;
        prims.push({
          limb: 'torso', cluster: 0, op: 'add',
          a: [x + dx - 0.02, y + dy, z + dz] as Vec3,
          b: [x + dx + 0.02, y + dy, z + dz] as Vec3,
          radius: radius * 0.55, scale: [1, 1, 1], blendK: 0.03,
        } as unknown as Primitive);
      }
      const id = ctx.bake.nextId;
      d.spawnChunkPiece(
        {
          limb: 'torso', origin: [x, y + radius, z] as Vec3, prims, tornAt: [], bones: [],
          // An explicit spin (including [0,0,0]) overrides the random tumble, so
          // a rig can stage a truly stationary piece that must NOT blur.
          ...(spin ? { spinAngVel: spin } : {}),
        },
        { uniforms: ctx.world.actors[0]!.view.uniforms, volumeTexture: ctx.world.actors[0]!.view.volumeTexture },
        velocity ?? (stationary ? [0, 0, 0] : undefined),
      );
      return id;
    },
    /** THE PARTS' PROCEDURAL DETAIL, live: `{detail, bump, blood, noise}` plus the
     *  STAIN terms `{burn, wet, dark, stainScale}`. `detail: 0` turns the whole
     *  layer off, which is the A/B control for whether the bumps and the decals are
     *  doing anything at all.
     *
     *  `noise` scales the bump's noise DOMAIN: it is the term that decides whether
     *  the bump is surface texture or a smooth tilt, and the measurement to re-run
     *  when changing it is the neighbouring-pixel roughness in
     *  `scripts/gore-detail-ab.mjs`.
     *
     *  The stain half answers the owner's next note — "still look like rocks -
     *  there no dark blood or burn stains … the blood is more specular and wet
     *  looking": `dark` pushes blood toward near-black, `wet` drives it into the
     *  highlight, `burn` is the charred field (matte, near-black — the contrast
     *  against wet blood), and `stainScale` is the stains' own broader domain. */
    /**
     * THE GORE MATERIAL'S LIGHT RESPONSE — `look` = (stain, wetTint, specGain,
     * fresGain) on every detail-layer chunk material.
     *
     * Exposed because the carve changed the regime these defaults were tuned in.
     * `chunkShade`'s specular is ADDITIVE and is NOT multiplied by albedo:
     *
     *     specular = keyC * wetTint * (shine * specGain * keyI + fres * (0.5 + 0.5 * keyI))
     *
     * and both terms are scaled by the wound mask (`fres *= 1 + wm * 1.5`). On a
     * settled chunk wm is a LOCAL halo round a torn end, so the defaults (1.2,
     * 0.6) never had to behave at wm = 1 over a large area. A carved piece is a
     * third cut face, all of it at wm = 1, under a 4x flashlight beam — measured
     * 8-11% of piece pixels blown to white against 0.0% on the marched body it is
     * supposed to match. That is the "white / concrete" read.
     */
    goreLook: (o: { spec?: number; fres?: number; wetTint?: number; stain?: number } = {}) => {
      if (o.stain !== undefined) ctx.vfx.goreLookCfg.x = o.stain;
      if (o.wetTint !== undefined) ctx.vfx.goreLookCfg.y = o.wetTint;
      if (o.spec !== undefined) ctx.vfx.goreLookCfg.z = o.spec;
      if (o.fres !== undefined) ctx.vfx.goreLookCfg.w = o.fres;
      for (const m of [ctx.vfx.gorePartMat, ctx.bake.carvedMaterial, ctx.gibs.assetMaterial]) {
        m?.uniforms.look.value.set(ctx.vfx.goreLookCfg.x, ctx.vfx.goreLookCfg.y, ctx.vfx.goreLookCfg.z, ctx.vfx.goreLookCfg.w);
      }
      return { stain: ctx.vfx.goreLookCfg.x, wetTint: ctx.vfx.goreLookCfg.y, spec: ctx.vfx.goreLookCfg.z, fres: ctx.vfx.goreLookCfg.w };
    },
    /** PURE-SPIN FIXTURE (task 4). Spawn ONE piece at a known world point
     *  through the REAL spawn path with a chosen angular velocity and NO net
     *  gravity for the first frame: the upward kick cancels `CHUNK_TUNING.
     *  gravity * (1/60)` exactly, so after ONE 1/60 step the piece has ~zero
     *  linear velocity and sits where it was placed while still turning. That
     *  is the fixed-centre spin the shutter resolve must smear at the EDGES and
     *  leave STILL at the centre — translation-only blur cannot fake it.
     *  Returns the new piece id (or -1 if the actor view is not up yet). */
    spawnSpinFixture: (x: number, y: number, z: number, radius = 0.2, spin: Vec3 = [0, 0, 8]) => {
      const view = ctx.world.actors[0]?.view;
      if (!view) return -1;
      const prims: Primitive[] = [];
      const rng = rngStreams.misc;
      for (let i = 0; i < 6; i++) {
        const th = rng() * Math.PI * 2;
        const ph = Math.acos(2 * rng() - 1);
        const dx = Math.sin(ph) * Math.cos(th) * radius * 0.5;
        const dy = Math.cos(ph) * radius * 0.5;
        const dz = Math.sin(ph) * Math.sin(th) * radius * 0.5;
        prims.push({
          limb: 'torso', cluster: 0, op: 'add',
          a: [x + dx - 0.02, y + dy, z + dz] as Vec3,
          b: [x + dx + 0.02, y + dy, z + dz] as Vec3,
          radius: radius * 0.55, scale: [1, 1, 1], blendK: 0.03,
        } as unknown as Primitive);
      }
      const id = ctx.bake.nextId;
      // One 1/60 s of gravity exactly cancelled: after `step(1)` the piece's
      // velocity is ~0, so the exposure gather is spin-only.
      const cancel: Vec3 = [0, -CHUNK_TUNING.gravity / 60, 0];
      d.spawnChunkPiece(
        {
          limb: 'torso', origin: [x, y + radius, z] as Vec3, prims, tornAt: [], bones: [],
          spinAngVel: spin,
        },
        { uniforms: view.uniforms, volumeTexture: view.volumeTexture },
        cancel,
      );
      return id;
    },
    /**
     * Close-up task 4's PERF SEAMS (goo-layer.ts) — all default to the
     * shipped state; the goo A/B driver flips them per leg. Deliberately NOT
     * part of setGooTuning: these are bench levers, not look knobs, and the
     * goo panel's copy button emits tuning keys (see the emit-key warning on
     * the panel) — mixing the two would let a paste silently move a perf
     * seam.
     */
    setGooPerf(o: {
      surfaceAtDensityRes?: boolean;
      minTexelRadius?: number;
      areaPriority?: boolean;
      splatFadeTail?: number;
      passGate?: { density?: boolean; blur?: boolean; surface?: boolean };
      /** Density target fraction of the SDF size (ship 0.5). */
      densityScale?: number;
      /** Density quads per frame, at most GOO_TUNING.maxParticles (1000). */
      particleCap?: number;
    }) {
      if (!ctx.goo.layer) return { unavailable: true };
      if (o.densityScale !== undefined) ctx.goo.layer.setDensityScale(o.densityScale);
      if (o.particleCap !== undefined) ctx.goo.layer.setParticleCap(o.particleCap);
      if (o.surfaceAtDensityRes !== undefined) ctx.goo.layer.setSurfaceAtDensityRes(o.surfaceAtDensityRes);
      if (o.minTexelRadius !== undefined) ctx.goo.layer.setMinTexelRadius(o.minTexelRadius);
      if (o.areaPriority !== undefined) ctx.goo.layer.setAreaPriority(o.areaPriority);
      if (o.splatFadeTail !== undefined) ctx.goo.layer.setSplatFadeTail(o.splatFadeTail);
      if (o.passGate !== undefined) ctx.goo.layer.setPassGate(o.passGate);
      return {
        densityScale: ctx.goo.layer.densityScale,
        particleCap: ctx.goo.layer.particleCap,
        targetSize: ctx.goo.layer.targetSize,
        surfaceAtDensityRes: ctx.goo.layer.surfaceAtDensityRes,
        minTexelRadius: ctx.goo.layer.minTexelRadius,
        areaPriority: ctx.goo.layer.areaPriority,
        splatFadeTail: ctx.goo.layer.splatFadeTail,
        passGate: ctx.goo.layer.passGate,
      };
    },
  };
}
