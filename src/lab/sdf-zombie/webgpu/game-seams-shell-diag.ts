import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';

/** Closures this group still needs from main(). */
export interface ShellDiagDeps {
  /** How many bodies the cull pass kept visible on the last full cull. */
  bodiesOnScreen(): number;
  /** The silhouette-noise amplitude the hull must budget for (marchCfg.z),
   *  read from the live uniform rather than a constant. */
  shellAmpOf(): number;
  /** main()'s destructured `const { camera } = ctx.boot.handle`; the
   *  chunk-census frustum resolves against it. */
  camera: THREE.PerspectiveCamera;
}

export function createShellDiagSeams(ctx: GameContext, d: ShellDiagDeps) {
  return {
    /**
     * PER-PIXEL CROSS-TAB of shell OFF vs ON — the diagnostic that competing
     * aggregates could not settle (2026-08-31: one run said the shell added
     * +10k hits, another said zero; both were sums).
     *
     * Renders the occupancy buffer twice on the SAME frozen frame (shell off,
     * then on) and classifies every pixel by (hitOff, hitOn). For pixels that
     * hit ONLY with the shell on, reports what the OFF march did instead:
     * how many steps it burned and whether it hit the 96-step budget — which
     * separates "budget exhausted at grazing incidence" from "terminated on
     * distance and the extra hits are something else".
     */
    async shellDiag() {
      const readGrid = async () => {
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
          const floatsPerRow = Math.ceil((w * 16) / 256) * 256 / 4;
          return { w, h, buf, floatsPerRow };
        } finally {
          for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = prevMode;
        }
      };
      const wasOn = ctx.render.sdfLayer.shellEnabled;
      try {
        ctx.render.sdfLayer.setShellEnabled(false);
        const off = await readGrid();
        ctx.render.sdfLayer.setShellEnabled(true);
        ctx.world.outerHull.update(ctx.world.actors.map(a => a.posed()), { shellAmp: d.shellAmpOf() });
        const on = await readGrid();
        const stepsHist = new Array(13).fill(0); // OFF steps/8 for ON-only hits
        const onStepsHist = new Array(13).fill(0); // ON steps at ON-only hits
        let onOnly = 0;
        let offOnly = 0;
        let both = 0;
        let onOnlyOffBudget = 0; // OFF burned >= 90 steps at those pixels
        let onOnlyOffMarched = 0; // OFF actually marched there (vs no fragment)
        let onOnlyFirstSample = 0; // ON hit within 2 steps of shellIn = started in/on flesh
        let tSum = 0;
        // For pixels BOTH hit: does the shell move the hit? Identical means the
        // entry bound is sound for hit rays; a shifted t means shellIn lands
        // past the true surface.
        let bothTOff = 0;
        let bothTOn = 0;
        let bothTMoved = 0; // |tOn - tOff| > 5 mm
        for (let row = 0; row < off.h; row++) {
          const ob = row * off.floatsPerRow;
          const nb = row * on.floatsPerRow;
          for (let col = 0; col < off.w; col++) {
            const o = ob + col * 4;
            const n = nb + col * 4;
            const hitOff = off.buf[o + 2]! > 0.5 && off.buf[o + 1]! > 0.5;
            const hitOn = on.buf[n + 2]! > 0.5 && on.buf[n + 1]! > 0.5;
            if (hitOff && hitOn) {
              both++;
              bothTOff += off.buf[o + 3]!;
              bothTOn += on.buf[n + 3]!;
              if (Math.abs(on.buf[n + 3]! - off.buf[o + 3]!) > 0.005) bothTMoved++;
            }
            else if (hitOff) offOnly++;
            else if (hitOn) {
              onOnly++;
              tSum += on.buf[n + 3]!;
              const onSt = on.buf[n]!;
              onStepsHist[Math.min(12, Math.floor(onSt / 8))]!++;
              if (onSt <= 2) onOnlyFirstSample++;
              if (off.buf[o + 2]! > 0.5) {
                onOnlyOffMarched++;
                const st = off.buf[o]!;
                if (st >= 90) onOnlyOffBudget++;
                stepsHist[Math.min(12, Math.floor(st / 8))]!++;
              }
            }
          }
        }
        return {
          both, offOnly, onOnly,
          onOnlyOffMarched, onOnlyOffBudget,
          onOnlyFirstSample,
          onOnlyMeanT: onOnly ? tSum / onOnly : 0,
          bothMeanTOff: both ? bothTOff / both : 0,
          bothMeanTOn: both ? bothTOn / both : 0,
          bothTMoved,
          // Histograms bucketed by 8 steps.
          offStepsAtOnOnly: stepsHist,
          onStepsAtOnOnly: onStepsHist,
        };
      } finally {
        ctx.render.sdfLayer.setShellEnabled(wasOn);
        ctx.boot.handle.setLoopRunning(true);
      }
    },

    chunkCensus: () => {
      // HOW MANY PIECES ARE EVEN IN THE FRAME — the ceiling on what frustum
      // culling can save, so a cost A/B can be read against it rather than
      // against a feeling about where the camera was pointing.
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
          d.camera.projectionMatrix, d.camera.matrixWorldInverse,
        ),
      );
      let inFrustum = 0;
      for (const c of ctx.bake.liveChunks) if (frustum.intersectsObject(c.view.object)) inFrustum++;
      // ——— IS THE SKELETON ACTUALLY DRAWN AS BONE? ————————————————————————
      // The owner's complaint was "i still dont see anything bone related like
      // idk rib cage or something", and there are two separate claims in
      // answering it. `gib-parts.test.ts` proves the FIRST: the ribcage leaves
      // the body as a bone-only chunk. These counters are the second, and they
      // are what a page can see:
      //
      //   * a bone piece renders pale only while its view carries
      //     `meltCfg.x = 1` — the pale matte branch in the melt ramp is the
      //     ONLY thing in the shader that paints bone as bone (`isBone` alone
      //     shades it as meat);
      //   * and it only has bone to paint if its rows are PACKED
      //     (`counts2.x` = packed bone count), which `packBones = true` is what
      //     guarantees: with the bone-tube path's packBones off, a bone-only
      //     chunk packs NOTHING and marches an empty field.
      //
      // `staleBoneFlags` counts the failure mode the lab's own comment warns
      // about: chunk views are RECYCLED, so a flesh piece inheriting a
      // ribcage's meltCfg.x would render pale and matte — a bone-coloured arm.
      let bonePieces = 0, boneRows = 0, organPieces = 0, buriedBonePieces = 0;
      let bonesShadingAsMeat = 0, organsShadingAsBone = 0;
      for (const c of ctx.bake.liveChunks) {
        const pale = c.view.uniforms.meltCfg.value.x > 0;
        const rows = c.view.uniforms.counts2.value.x;
        if (c.kind === 'bone') {
          if (pale && rows > 0) { bonePieces++; boneRows += rows; }
          // A bone piece that lost its pale flag, or that has no rows packed at
          // all (the bone-tube path's packBones off would do both), shades as
          // MEAT — the skeleton is in the pile and cannot be seen.
          //
          // UNLESS THE TUBES ARE DRAWING IT (2026-09-15). Under `gibBoneMesh` a
          // bone piece packs no rows and marches nothing BY DESIGN — the
          // instancer draws it from `posedBones()` and the proxy is hidden. The
          // metric predates that path and would report all of them as a failure,
          // which is the census crying wolf about the shipped configuration.
          else if (!ctx.gibs.boneMesh) bonesShadingAsMeat++;
        } else if (c.boneOnly) {
          // An ORGAN piece: deliberately NOT pale (it tints as viscera), and its
          // rows are organs. If it ever goes pale it renders as bare bone.
          organPieces++;
          if (pale) organsShadingAsBone++;
        } else if (rows > 0) {
          // THE BURIED CASE, which is the one the owner described: a FLESH piece
          // whose bones are packed INSIDE its own field as more capsules unioned
          // with the meat enclosing them. It draws as a solid tube with an
          // invisible femur in it. The cheap `clusters` tier does exactly this,
          // so this counter is how a degraded blast says so out loud.
          buriedBonePieces++;
        }
      }
      return {
      inFrustum, ofPieces: ctx.bake.liveChunks.length,
      bonePieces, boneRows, organPieces, buriedBonePieces,
      bonesShadingAsMeat, organsShadingAsBone,
      live: ctx.bake.liveChunks.length, baked: ctx.bake.chunks.length,
      views: ctx.bake.views.length, spare: ctx.bake.spareViews.length,
      bakePending: ctx.bake.jobs.pendingId !== null,
      cap: ctx.bake.maxChunks,
      };
    },

    /**
     * SCREEN COVERAGE of the outer hull, against the proxy boxes it would
     * replace.
     *
     * The decisive number for the shell march, and it can be taken WITHOUT
     * touching the march: occupancy() already reports what fraction of the
     * target the proxy boxes rasterise (75-100%). This reports what fraction
     * the hull covers. The gap between them is the work a bounded march
     * deletes.
     */
    async hullCoverage() {
      const wasOn = ctx.render.sdfLayer.shellEnabled;
      ctx.render.sdfLayer.setShellEnabled(true);
      ctx.world.outerHull.update(ctx.world.actors.map(a => a.posed()), { shellAmp: d.shellAmpOf() });
      try {
        ctx.boot.handle.setLoopRunning(false);
        ctx.boot.handle.step(1 / 60);
        await ctx.boot.handle.resolveGpu();
        const read = async (t: THREE.RenderTarget) => {
          const w = t.width;
          const h = t.height;
          const buf = new Float32Array(
            await ctx.boot.handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h),
          );
          // Row padding again — bytesPerRow is aligned to 256. RedFormat, so
          // one float per pixel rather than four.
          const floatsPerRow = Math.ceil((w * 4) / 256) * 256 / 4;
          let covered = 0;
          for (let row = 0; row < h; row++) {
            const base = row * floatsPerRow;
            for (let col = 0; col < w; col++) if (buf[base + col]! > 0) covered++;
          }
          return { w, h, covered, frac: covered / (w * h) };
        };
        const entry = await read(ctx.render.sdfLayer.shellEntryTarget);
        const exit = await read(ctx.render.sdfLayer.shellExitTarget);
        return {
          entry, exit,
          instances: ctx.world.outerHull.instanceCount,
          overflowed: ctx.world.outerHull.overflowed,
          bodiesOnScreen: d.bodiesOnScreen(),
        };
      } finally {
        ctx.render.sdfLayer.setShellEnabled(wasOn);
        ctx.boot.handle.setLoopRunning(true);
      }
    },
  };
}
