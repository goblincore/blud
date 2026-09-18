// src/lab/sdf-zombie/webgpu/game-seams-render-diag.ts
//
// Extracted from game-main.ts's window.__sdfGame literal. Each member takes the
// GameContext explicitly instead of capturing main()'s scope; the handful of
// remaining main()-scope closures arrive through RenderDiagDeps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import * as THREE from 'three/webgpu';
import {
  wgslFn, texture as tslTexture, screenUV as tslScreenUV, vec4 as tslVec4,
  length as tslLength, sub as tslSub, positionWorld, cameraPosition, uniform as tslUniform,
} from 'three/tsl';
import type { GameContext } from './game-context';

/** Closures this group still needs from main(). */
export interface RenderDiagDeps {
  /** Visible-actor count for the HUD; the occupancy/boneEvals readouts report it. */
  bodiesOnScreen(): number;
  /** The main perspective camera (main()'s `camera` from ctx.boot.handle); the
   *  texRoundTrip probe stages its quad relative to it. Not reachable from the
   *  bare GameContext the way the `ctx.` state is, so it is passed in. */
  camera: THREE.PerspectiveCamera;
}

export function createRenderDiagSeams(ctx: GameContext, d: RenderDiagDeps) {
  return {
    /**
     * TEXTURE ROUND-TRIP PROBE (close-up diagnostics task 1, question B).
     *
     * Writes a KNOWN ray parameter into render targets in the shapes the
     * quarter-res depth prepass (and the parked hull exit bound) would use,
     * and reads it back through BOTH consumption paths — the CPU readback
     * and the WGSL textureLoad fetch the march actually binds — at a range
     * ladder. Purpose: decide whether a written t survives the round-trip
     * (the prepass may proceed) or decays with range (the phenomenon that
     * killed the occluder pre-pass and holds GAME_HULL_EXIT_BOUND at 0).
     *
     * Three write paths, so a decay can be attributed:
     *   mode 'uniform' — colorNode = vec4(uT), uT set from the CPU. No
     *     geometry involvement at all: isolates the TEXTURE itself.
     *   mode 'dist' — the exact shipped expression,
     *     colorNode = vec4(length(positionWorld - cameraPosition)), on a
     *     quad perpendicular to the camera's forward at `dist`. Isolates
     *     the TSL distance expression under rasterisation: every fragment
     *     of a forward-facing plane at that distance should read dist
     *     exactly.
     *   (mode 'mesh' — the occluder's instanced-sphere path — is the
     *     existing syntheticSphereCheck; the driver runs both and merges
     *     the table.)
     *
     * Targets: RGBA32F and R32F (the occluder's and the outer hull's
     * formats), each at FULL march-target scale and QUARTER scale (the
     * depth prepass's scale). All NearestFilter, depth-tested like the
     * shipped pre-passes. Quarter dims are ceil, matching how a prepass
     * would allocate.
     *
     * The WGSL read is the occFetch/shellFetch body verbatim (clamp to
     * dims, floor(screenUV * dims), textureLoad .x) rendered through a
     * second material into a second target set — so the validated operator
     * is the one the march would bind, not a lookalike.
     *
     * Self-contained and idle by default: builds its scene/targets lazily
     * on first call, parks the loop, restores everything it touched.
     */
    async texRoundTrip(o: { dist: number; mode?: 'uniform' | 'dist' | 'dist-small' }) {
      const dist = o.dist;
      const mode = o.mode ?? 'uniform';
      // ---- lazily-built probe rig ----------------------------------------
      if (!ctx.render.texProbe) {
        const QuadFetchWGSL = /* wgsl */ `fn quadFetch(
  srcTex: texture_2d<f32>,
  suv: vec2<f32>
) -> f32 {
  let dims = vec2<f32>(textureDimensions(srcTex, 0));
  let c = clamp(vec2<i32>(floor(suv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(srcTex, c, 0).x;
}`;
        const mkWriteTarget = (fmt: 'rgba' | 'red', quarter: boolean): THREE.RenderTarget => new THREE.RenderTarget(
          quarter ? Math.max(1, Math.ceil(ctx.render.sdfLayer.marchTarget.width / 4)) : ctx.render.sdfLayer.marchTarget.width,
          quarter ? Math.max(1, Math.ceil(ctx.render.sdfLayer.marchTarget.height / 4)) : ctx.render.sdfLayer.marchTarget.height,
          {
            depthBuffer: true,
            type: THREE.FloatType,
            ...(fmt === 'red' ? { format: THREE.RedFormat } : {}),
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
          },
        );
        // Read targets are ALWAYS RGBA32F at the write target's scale: the
        // production consumers never CPU-read a RedFormat target either —
        // they textureLoad it in-shader — so the validated chain is
        // write(fmt) -> textureLoad -> rgba32f -> CPU, and the r32f CPU
        // readback (which this renderer's helper does not support) never
        // enters the picture.
        const mkReadTarget = (quarter: boolean): THREE.RenderTarget => new THREE.RenderTarget(
          quarter ? Math.max(1, Math.ceil(ctx.render.sdfLayer.marchTarget.width / 4)) : ctx.render.sdfLayer.marchTarget.width,
          quarter ? Math.max(1, Math.ceil(ctx.render.sdfLayer.marchTarget.height / 4)) : ctx.render.sdfLayer.marchTarget.height,
          {
            depthBuffer: false,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
          },
        );
        const scene = new THREE.Scene();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        quad.frustumCulled = false;
        scene.add(quad);
        const uniformMat = new THREE.MeshBasicNodeMaterial();
        const u = tslUniform(0);
        uniformMat.colorNode = tslVec4(u, u, u, 1);
        const distMat = new THREE.MeshBasicNodeMaterial();
        const dNode = tslLength(tslSub(positionWorld, cameraPosition));
        distMat.colorNode = tslVec4(dNode, dNode, dNode, 1);
        // The read pass quad faces +z from z = 0 toward an ortho camera at
        // z = 5 looking down -z: a fixed full-screen blit shape, so the
        // fetch operator's screenUV maps 1:1 onto the write target's texels.
        const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
        ortho.position.set(0, 0, 5);
        ortho.lookAt(0, 0, 0);
        ctx.render.texProbe = {
          scene, quad, ortho,
          writes: { uniform: { m: uniformMat, u }, dist: { m: distMat }, 'dist-small': { m: distMat } },
          fetchNode: wgslFn(QuadFetchWGSL),
          targets: {
            'rgba-full': [mkWriteTarget('rgba', false), mkReadTarget(false)],
            'rgba-quarter': [mkWriteTarget('rgba', true), mkReadTarget(true)],
            'red-full': [mkWriteTarget('red', false), mkReadTarget(false)],
            'red-quarter': [mkWriteTarget('red', true), mkReadTarget(true)],
          },
        };
      }
      const probe = ctx.render.texProbe;
      try {
        ctx.boot.handle.setLoopRunning(false);
        // One step so the camera's world matrix reflects any pose the driver
        // set just before this call.
        ctx.boot.handle.step(1 / 60);
        const fwd = new THREE.Vector3();
        d.camera.getWorldDirection(fwd);
        // Near-plane guard: a quad closer than the near plane clips, which
        // must read as a staging fault, never as decay.
        if (dist <= d.camera.near * 1.2) {
          return { error: `dist ${dist} <= near ${d.camera.near} — stage further out` };
        }
        // The value every covered fragment should carry.
        const expected = mode === 'uniform'
          ? (probe.writes.uniform.u.value = dist, dist)
          : dist;
        // 'dist-small': the SAME per-fragment distance expression on a quad
        // only 0.4 m tall — the synthetic sphere's projected size class. If
        // THIS decays with range, the defect is projected-size-dependent
        // (rasteriser/precision), not mesh-specific; if it is exact, the
        // occluder's instanced-geometry path owns the fault alone.
        const smallQuad = mode === 'dist-small';
        probe.quad.material = probe.writes[mode].m;
        // Where the WRITE pass needs the quad: perpendicular to the view
        // axis at `dist`, sized to overflow the frustum there, so the centre
        // pixel and its neighbours are all covered by the quad itself.
        const writePos = d.camera.position.clone().addScaledVector(fwd, dist);
        const writeQuat = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(d.camera.position, writePos, d.camera.up),
        );
        const writeScale = smallQuad
          ? 0.4
          : Math.max(1, 2.5 * dist * Math.tan(THREE.MathUtils.degToRad(d.camera.fov / 2)));
        const rows: { target: string; cpu: number; wgsl: number; relErr: number; neighbourSpread: string }[] = [];
        for (const [name, [writeT, readT]] of Object.entries(probe.targets)) {
          // ---- write pass (main camera; renderer autoClears) ----
          probe.quad.position.copy(writePos);
          probe.quad.quaternion.copy(writeQuat);
          probe.quad.scale.setScalar(writeScale);
          ctx.boot.handle.renderer.setRenderTarget(writeT);
          ctx.boot.handle.renderer.render(probe.scene, d.camera);
          await ctx.boot.handle.resolveGpu();
          // ---- CPU read of the WRITE target (RGBA only — see mkReadTarget):
          // centre pixel + neighbours, so a partial-coverage write shows up
          // as spread rather than silently aliasing into the centre value ----
          const w = writeT.width, ht = writeT.height;
          const buf = new Float32Array(
            await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(writeT, 0, 0, w, ht),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          const cx = Math.floor(w / 2), cy = Math.floor(ht / 2);
          const at = (x: number, y: number) => buf[y * floatsPerRow + x * 4] ?? NaN;
          const cpu = at(cx, cy);
          const spread = [at(cx - 1, cy), at(cx + 1, cy), at(cx, cy - 1), at(cx, cy + 1)];
          // ---- WGSL read: the occFetch/shellFetch operator rendered into
          // the paired RGBA target through the fixed ortho blit, then
          // CPU-read at the same centre texel ----
          const mat = new THREE.MeshBasicNodeMaterial();
          const fetched = probe.fetchNode({ srcTex: tslTexture(writeT.texture), suv: tslScreenUV });
          mat.outputNode = tslVec4(fetched, fetched, fetched, 1);
          mat.depthTest = false;
          mat.depthWrite = false;
          const savedMat: THREE.Material = probe.quad.material as THREE.Material;
          probe.quad.material = mat;
          probe.quad.position.set(0, 0, 0);
          probe.quad.quaternion.identity();
          probe.quad.scale.set(1, 1, 1);
          ctx.boot.handle.renderer.setRenderTarget(readT);
          ctx.boot.handle.renderer.render(probe.scene, probe.ortho);
          await ctx.boot.handle.resolveGpu();
          const buf2 = new Float32Array(
            await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(readT, 0, 0, w, ht),
          );
          const wgsl = buf2[cy * floatsPerRow + cx * 4] ?? NaN;
          rows.push({
            target: name,
            cpu: +cpu.toFixed(5), wgsl: +wgsl.toFixed(5),
            relErr: expected !== 0 ? +Math.abs((cpu - expected) / expected).toFixed(5) : 0,
            neighbourSpread: spread.map(v => +v.toFixed(4)).join(','),
          });
          probe.quad.material = savedMat;
          mat.dispose();
        }
        return { dist, mode, expected, near: d.camera.near, far: d.camera.far, rows };
      } finally {
        ctx.boot.handle.renderer.setRenderTarget(null);
        ctx.boot.handle.setLoopRunning(true);
      }
    },

    /**
     * TEMPORAL START PER-PIXEL DIAG (spike program, 2026-09-10). Freezes ONE
     * frame (loop off), renders it with the temporal start ON and OFF — the
     * ONLY difference is temporalCfg.x, the lastTex copy is the same frozen
     * frame — and classifies every marched pixel by (hitOn, hitOff). The
     * classes that matter: hitOff && !hitOn = a pixel the temporal start
     * BROKE (the see-through holes); hitOn && !hitOff = pixels it created
     * (inside-accepts). Per broken pixel we keep the ray distance t each leg
     * ended at and the step counts, which separates "started past the
     * surface, ran out of budget" (steps ~96, tOn ~ body far side) from
     * "terminated early" (few steps, tOn short).
     */
    async temporalDiag() {
      const prevMode = ctx.world.actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = 4;
      const prevWarm = ctx.render.sdfLayer.temporalStart.on;
      try {
        ctx.boot.handle.setLoopRunning(false);
        ctx.boot.handle.step(1 / 60);
        await ctx.boot.handle.resolveGpu();
        const read = async () => {
          const t = ctx.render.sdfLayer.marchTarget;
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          return { w, h, buf, floatsPerRow };
        };
        ctx.render.sdfLayer.setTemporalStart(true);
        // dt = 0: re-render the SAME frozen sim state — the two legs must
        // differ ONLY by temporalCfg.x, or a swinging limb between legs
        // masquerades as the artifact (measured 2026-09-10: dt=1/60 legs
        // 'broke' ~450 px that were just melee motion).
        ctx.boot.handle.step(0);
        await ctx.boot.handle.resolveGpu();
        const A = await read();
        ctx.render.sdfLayer.setTemporalStart(false);
        ctx.boot.handle.step(0);
        await ctx.boot.handle.resolveGpu();
        const B = await read();
        let broke = 0, fixed = 0, bothMiss = 0, bothHit = 0;
        const broken: { x: number; y: number; tOn: number; tOff: number; stepsOn: number; stepsOff: number }[] = [];
        const pushCap = 400;
        for (let row = 0; row < A.h; row++) {
          const base = row * A.floatsPerRow;
          for (let col = 0; col < A.w; col++) {
            const o = base + col * 4;
            if (A.buf[o + 2]! < 0.5 || B.buf[o + 2]! < 0.5) continue;
            const hitA = A.buf[o + 1]! > 0.5;
            const hitB = B.buf[o + 1]! > 0.5;
            if (hitA && hitB) { bothHit++; continue; }
            if (!hitA && !hitB) { bothMiss++; continue; }
            if (!hitA && hitB) {
              broke++;
              if (broken.length < pushCap) {
                broken.push({ x: col, y: row, tOn: A.buf[o + 3]!, tOff: B.buf[o + 3]!, stepsOn: A.buf[o]!, stepsOff: B.buf[o]! });
              }
            } else fixed++;
          }
        }
        const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
        return {
          broke, fixed, bothMiss, bothHit,
          meanStepsOnBroken: mean(broken.map((b) => b.stepsOn)),
          meanStepsOffBroken: mean(broken.map((b) => b.stepsOff)),
          meanTOnBroken: mean(broken.map((b) => b.tOn)),
          maxTOnBroken: broken.reduce((m, b) => Math.max(m, b.tOn), 0),
          maxTOffBroken: broken.reduce((m, b) => Math.max(m, b.tOff), 0),
          meanTOffBroken: mean(broken.map((b) => b.tOff)),
          brokenSample: broken,
        };
      } finally {
        for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = prevMode;
        ctx.render.sdfLayer.setTemporalStart(prevWarm);
        ctx.boot.handle.setLoopRunning(true);
      }
    },

    /**
     * PROXY-BOX OCCUPANCY — the shell-march decision measurement.
     *
     * How much of the screen area the march actually rasterises is flesh?
     * A bounded entry/exit hull never rasterises the rest, so `1 - occupancy`
     * is the shell march's addressable market. This exists because the step
     * budget sweep showed the spike's "14x fewer evals" counted the CHEAP
     * evals: cost is per-PIXEL, not per-step, so what matters is how many
     * pixels are marched for nothing.
     *
     * Method: march debug mode 4 returns raw counters BEFORE the miss-discard
     * (r = steps, g = hit, b = rasterised, a = t), one frame is rendered, and
     * the float target is read back and summed.
     *
     * Reported occupancy is a LOWER BOUND on the waste: depth-testing means
     * only the front-most body writes each pixel, so overlapping proxy boxes
     * hide extra fragment invocations this cannot see.
     */
    async occupancy() {
      const prevMode = ctx.world.actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = 4;
      try {
        ctx.boot.handle.setLoopRunning(false);
        ctx.boot.handle.step(1 / 60);
        await ctx.boot.handle.resolveGpu();
        const t = ctx.render.sdfLayer.marchTarget;
        const w = t.width;
        const h = t.height;
        const buf = new Float32Array(
          await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
        );
        // ROW PADDING, and it is not optional: WebGPU aligns bytesPerRow to
        // 256, so the readback is NOT densely packed. Walking it as w*h*4
        // reads progressively misaligned rows and still yields a plausible
        // percentage — the exact shape of wrong number this whole exercise
        // keeps producing. (Same arithmetic as shell-spike-main.ts.)
        const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
        let rasterised = 0;
        let hits = 0;
        let stepsOnHit = 0;
        let stepsOnMiss = 0;
        for (let row = 0; row < h; row++) {
          const base = row * floatsPerRow;
          for (let col = 0; col < w; col++) {
            const o = base + col * 4;
            if (buf[o + 2]! < 0.5) continue;
            rasterised++;
            if (buf[o + 1]! > 0.5) { hits++; stepsOnHit += buf[o]!; }
            else { stepsOnMiss += buf[o]!; }
          }
        }
        const misses = rasterised - hits;
        return {
          targetW: w, targetH: h, screenPx: w * h,
          rasterised, hits, misses,
          /** Fraction of MARCHED pixels that actually hit flesh. */
          occupancy: rasterised ? hits / rasterised : 0,
          /** Fraction of the SDF target the march touched at all. */
          coverage: rasterised / (w * h),
          meanStepsHit: hits ? stepsOnHit / hits : 0,
          meanStepsMiss: misses ? stepsOnMiss / misses : 0,
          /** Share of all marched STEPS spent on rays that hit nothing. */
          missStepShare: (stepsOnHit + stepsOnMiss) > 0
            ? stepsOnMiss / (stepsOnHit + stepsOnMiss) : 0,
          bodiesOnScreen: d.bodiesOnScreen(),
        };
      } finally {
        for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = prevMode;
        ctx.boot.handle.setLoopRunning(true);
      }
    },

    /**
     * Bone capsule evaluations per marched ray (gore r3 refinement 3).
     *
     * Debug mode 5, read back exactly like occupancy() above — including the
     * 256-byte row alignment, which is not optional and has produced
     * plausible-but-wrong numbers here before.
     *
     * This exists because the TIMING bench cannot see the bone fold at all:
     * it measured +0.0% against a 4% within-run spread, which is not a
     * measurement. A counter is not subject to machine noise, so it is what
     * any bone-fold cull must be judged on. Wound some bodies first — with no
     * wounds the nearWound gate means the honest answer is zero.
     */
    async boneEvals() {
      const prevMode = ctx.world.actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = 5;
      try {
        ctx.boot.handle.setLoopRunning(false);
        ctx.boot.handle.step(1 / 60);
        await ctx.boot.handle.resolveGpu();
        const t = ctx.render.sdfLayer.marchTarget;
        const w = t.width;
        const h = t.height;
        const buf = new Float32Array(
          await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
        );
        const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
        let rasterised = 0;
        let hits = 0;
        let bonesOnHit = 0;
        let bonesTotal = 0;
        let maxBones = 0;
        let pixelsWithBone = 0;
        for (let row = 0; row < h; row++) {
          const base = row * floatsPerRow;
          for (let col = 0; col < w; col++) {
            const o = base + col * 4;
            if (buf[o + 2]! < 0.5) continue;
            rasterised++;
            const b = buf[o]!;
            bonesTotal += b;
            if (b > 0) pixelsWithBone++;
            if (b > maxBones) maxBones = b;
            if (buf[o + 1]! > 0.5) { hits++; bonesOnHit += b; }
          }
        }
        return {
          rasterised, hits,
          /** Total bone capsule evaluations across the whole marched frame. */
          bonesTotal,
          /** Mean over MARCHED pixels — the number a cull must move. */
          meanPerRay: rasterised ? bonesTotal / rasterised : 0,
          /** Mean over pixels that actually paid any bone cost. */
          meanPerPayingRay: pixelsWithBone ? bonesTotal / pixelsWithBone : 0,
          /** Share of marched pixels that touched the bone fold at all —
           *  the nearWound gate's effectiveness, measured rather than argued. */
          payingShare: rasterised ? pixelsWithBone / rasterised : 0,
          meanOnHit: hits ? bonesOnHit / hits : 0,
          maxBones,
          bodiesOnScreen: d.bodiesOnScreen(),
        };
      } finally {
        for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = prevMode;
        ctx.boot.handle.setLoopRunning(true);
      }
    },
  };
}
