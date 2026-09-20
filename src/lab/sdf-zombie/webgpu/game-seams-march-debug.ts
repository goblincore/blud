// src/lab/sdf-zombie/webgpu/game-seams-march-debug.ts
//
// March-shader debug/A-B seams: the flat-albedo + normal-gradient shader
// switches, the per-body/crowd uniform diff/dump tools and the
// set-any-uniform hammer. Members moved VERBATIM out of
// game-seams-leftover.ts (leaves wave 1's ctx-only bucket, 2026-09-20
// split; see the 2026-09-20-seams-leftover-split notes).
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md
import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { REC_ANCHOR_BAND, REC_COUNTS, REC_COUNTS2, REC_MELT, REC_VEC4S, REC_VOL_POSE0, REC_WIND_ALIVE, REC_WOUND_BOUND } from './crowd-records';
import { classifyNormalSupport } from './normal-gradient-support';

export function createMarchDebugSeams(ctx: GameContext) {
  const { camera } = ctx.boot.handle;
  return {
    /** FLAT-ALBEDO SEAM (close-up diagnostics task 1, 2026-09-04). 1 = the
     *  march fragment returns the body's base albedo at the hit and skips
     *  the whole post-hit chain (see the seam block in MARCH_BODY); 0 =
     *  bit-identical to the pre-seam shader (pinned by test). Rides the
     *  spare debugCfg.y channel, so no march signature or literal changes.
     *  Chunk views own COPIED uniform sets ("Its VALUES are copied, not the
     *  nodes" — createChunkGpuView), so they are looped too: a gib-frame A/B
     *  with flying chunks must not read chunks shaded by a different rule
     *  than the bodies. */
    setNormalGradient(mode: 0 | 1) {
      ctx.telemetry.normalGradientMode = mode === 1 ? 1 : 0;
      for (const a of ctx.world.actors) a.view.uniforms.normalGradientCfg.value.x = ctx.render.skeletonVolumes.has(a) ? 0 : ctx.telemetry.normalGradientMode;
      for (const c of ctx.bake.views) c.uniforms.normalGradientCfg.value.x = ctx.telemetry.normalGradientMode;
    },
    setNormalGradientDebug(mode: 0 | 1 | 2) {
      ctx.telemetry.normalGradientDebug = mode === 1 || mode === 2 ? mode : 0;
      for (const a of ctx.world.actors) a.view.uniforms.normalGradientCfg.value.y = ctx.telemetry.normalGradientDebug;
      for (const c of ctx.bake.views) c.uniforms.normalGradientCfg.value.y = ctx.telemetry.normalGradientDebug;
    },
    /** Read-only diagnostic identities; chunk ids survive pooled-view reuse. */
    normalGradientPieces() {
      return [
        ...ctx.world.actors.map(a=>({key:`body:${a.id}`,kind:'body',id:a.id,ownerLimbs:[...a.posed().prims.map(p=>p.limb),...(a.posed().bonePrims??[]).map(()=> 'internal')]})),
        ...ctx.bake.liveChunks.map(c=>({key:`chunk:${c.id}`,kind:'chunk',id:c.id,ownerLimbs:Array.from({length:Math.round(c.view.uniforms.counts.value.x)},()=>c.state.limb)})),
      ];
    },
    normalGradientPiece(key: string) {
      if(key.startsWith('body:')) return ctx.world.actors.find(a=>a.id===Number(key.slice(5)))?.view;
      if(key.startsWith('chunk:')) return [...ctx.bake.liveChunks, ...ctx.bake.chunks].find(c=>c.id===Number(key.slice(6)))?.view;
      return undefined;
    },
    normalGradientStatus() {
      const supportedBodies = ctx.world.actors.filter(a => classifyNormalSupport(a.posed()).commonFlesh).length;
      return { mode: ctx.telemetry.normalGradientMode, diagnostic: ctx.telemetry.normalGradientDebug,
        supportedBodies, legacyBodies: ctx.world.actors.length - supportedBodies };
    },
    /** Diagnostic: march debugCfg.x mode on every per-body view and crowd type (9 = normal output). */
    /** Diagnostic: per crowd type, which per-TYPE uniform values differ between the type's block and
     *  each attached actor's own view (per-instance/record-driven keys skipped). Textures compared by identity. */
    crowdUniformDiff() {
      const skip = new Set(['counts', 'counts2', 'woundBound', 'bodyCentre', 'bodyHalf', 'bodyAnchor', 'windDrift',
        'meltCfg', 'bodyFlash', 'headCentre', 'headQuat', 'volumePose0', 'volumePose1', 'tileCfg', 'debugCfg']);
      const out: Record<string, Record<string, string[]>> = {};
      for (const [name, t] of ctx.crowd.types) {
        const per: Record<string, string[]> = {};
        for (const a of ctx.world.actors) {
          if (a.crowd?.type !== t) continue;
          const diffs: string[] = [];
          const tu = t.uniforms as unknown as Record<string, { value: unknown }>;
          const vu = a.view.uniforms as unknown as Record<string, { value: unknown }>;
          for (const k of Object.keys(tu)) {
            if (skip.has(k) || !vu[k]) continue;
            const x = tu[k]!.value, y = vu[k]!.value;
            const sx = (x as { toArray?: () => number[] }).toArray ? JSON.stringify((x as { toArray: () => number[] }).toArray()) : (x instanceof THREE.Texture ? 'tex#' + x.id : String(x));
            const sy = (y as { toArray?: () => number[] }).toArray ? JSON.stringify((y as { toArray: () => number[] }).toArray()) : (y instanceof THREE.Texture ? 'tex#' + y.id : String(y));
            if (sx !== sy) diffs.push(`${k}: type=${sx} view=${sy}`);
          }
          per[`actor${a.id}${a.crowd ? '@' + a.crowd.slot : ''}`] = diffs;
        }
        out[name] = per;
      }
      return out;
    },

    crowdSlotDump() {
      const out: Record<string, unknown[]> = {};
      for (const [name, t] of ctx.crowd.types) {
        const rows: unknown[] = [];
        for (const a of ctx.world.actors) {
          if (a.crowd?.type !== t) continue;
          const s = a.crowd.slot; const f = t.records.floats; const b = s * REC_VEC4S * 4;
          rows.push({ actor: a.id, slot: s, alive: f[b + REC_WIND_ALIVE * 4 + 3], counts: Array.from(f.subarray(b + REC_COUNTS * 4, b + REC_COUNTS * 4 + 4)),
            counts2: Array.from(f.subarray(b + REC_COUNTS2 * 4, b + REC_COUNTS2 * 4 + 4)), band: f[b + REC_ANCHOR_BAND * 4 + 3],
            woundBound: Array.from(f.subarray(b + REC_WOUND_BOUND * 4, b + REC_WOUND_BOUND * 4 + 4)),
            volPose0w: f[b + REC_VOL_POSE0 * 4 + 3], melt: Array.from(f.subarray(b + REC_MELT * 4, b + REC_MELT * 4 + 4)),
            isSource: ctx.crowd.sourceView.get(t) === a.view, room: a.room });
        }
        out[name] = rows;
      }
      return out;
    },

    /** Diagnostic: per crowd type, each attached actor's slot, alive flag, counts row, band, bone cull mode,
     *  wound count and whether it is the type's uniform source. */
    /** Per-actor diagnostic (2026-09-14): who is in the cast, who the cull
     *  kept, what the per-body proxy's visibility is, and the corpse bake
     *  state — the fields a "why does this leg march / not march" question
     *  needs, in one call. */
    actorDump() {
      const cam = camera.position;
      return ctx.world.actors.map((a) => {
        const o = a.view.object;
        return {
          id: a.id, room: a.room,
          name: (a as unknown as { name?: string }).name ?? null,
          visible: ctx.render.visibleActors.includes(a),
          proxyVisible: o.visible,
          crowdSlot: a.crowd?.slot ?? null,
          dist: Math.round(o.position.distanceTo(cam) * 100) / 100,
          pos: [o.position.x, o.position.y, o.position.z].map((v) => Math.round(v * 100) / 100),
          kit: (() => {
            const k = a.character?.kit?.object;
            if (!k) return null;
            const w = k.getWorldPosition(new THREE.Vector3());
            return { visible: k.visible, parent: k.parent?.name ?? k.parent?.type ?? null, world: [w.x, w.y, w.z].map((v) => Math.round(v * 100) / 100) };
          })(),
          bakeEligible: a.corpseBakeEligible(),
          baked: ctx.world.soldierCorpses?.bakedState(a.id) ?? 'n/a',
          rev: a.damageRevision(),
        };
      });
    },

    /** Diagnostic: set one component of a uniform on every per-body view AND every crowd type
     *  (idx 0..3 = x/y/z/w for vectors; -1 for scalars). */
    setUniformAll(name: string, idx: number, value: number) {
      const apply = (u: Record<string, { value: unknown }>) => {
        const n = u[name]; if (!n) return;
        if (idx < 0) { n.value = value; return; }
        const v = n.value as Record<string, number>; v[['x', 'y', 'z', 'w'][idx]!] = value;
      };
      for (const a of ctx.world.actors) apply(a.view.uniforms as unknown as Record<string, { value: unknown }>);
      for (const t of ctx.crowd.types.values()) apply(t.uniforms as unknown as Record<string, { value: unknown }>);
    },
    setMarchDebugMode(x: number) {
      for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = x;
      for (const t of ctx.crowd.types.values()) t.uniforms.debugCfg.value.x = x;
    },
    setFlatAlbedo(on: boolean) {
      const v = on ? 1 : 0;
      for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.y = v;
      for (const c of ctx.bake.views) c.uniforms.debugCfg.value.y = v;
      // Crowd stage a: a type's uniforms are seeded by copyUniformValues from
      // its source actor view each frame (crowdOn block in the draw fn), so
      // the write above usually reaches them — but the crowd parity gate must
      // not depend on that frame ordering. Write the type nodes directly too.
      for (const t of ctx.crowd.types.values()) t.uniforms.debugCfg.value.y = v;
    },
  };
}
