// src/lab/sdf-zombie/webgpu/game-render-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu'
import { visibleFovDeg } from './fisheye'
import { type GibBlurSubject } from './gib-shutter-layer'
import { SDF_LAYER } from './sdf-layer'
import { type MarchUniforms } from './zombie-gpu'


/** What `__sdfGame.fisheye`, `setFisheye` and `setRenderFov` all report.
 *  A shared function rather than three copies of the same object literal
 *  — and the setters' own return value, not just the getter, because an
 *  object-literal method can't write `return this.fisheye` and a shared
 *  local is the way around that. Reads renderFovDeg/k off the LENS, not
 *  the camera: the lens is what the blit actually applied, so this is
 *  what tells a console user their setRenderFov(500) landed on 179. */
export function fisheyeReport(ctx: GameContext) {
  return {
    renderFovDeg: ctx.render.postAa.lens.renderFovDeg,
    centerFovDeg: ctx.player.centerFovDeg,
    visibleFovDeg: visibleFovDeg(ctx.render.postAa.lens),
    k: ctx.render.postAa.lens.k,
  };
}

/**
 * This frame's gib-blur candidates. Built from the SAME lists the renderers
 * draw: sprite/asset/carve pieces (all `spritePieces.live`) and the marched
 * fallback chunks (`liveChunks`). Each carries its real drawn mesh, its
 * current `Chunk` and the layer it belongs on when NOT blurred, which is what
 * lets the layer put it back exactly. `ageSeconds` is 0 on a piece's first
 * presented frame (spawn OR recycled id), so the exposure clamps to that
 * frame and no streak is drawn into an emitter that did not exist.
 */
export function gibBlurSubjects(ctx: GameContext): GibBlurSubject[] {
  const out: GibBlurSubject[] = [];
  const nextKeys = new Set<string>();
  for (const p of ctx.vfx.spritePieces.live) {
    if (!p.mesh.visible) continue;
    const key = `sprite:${p.id}`;
    nextKeys.add(key);
    out.push({
      id: p.id, state: p.state, mesh: p.mesh,
      baseLayer: 0,
      ageSeconds: ctx.gibs.blurPrevKeys.has(key) ? Number.POSITIVE_INFINITY : 0,
    });
  }
  for (const c of ctx.bake.liveChunks) {
    if (!c.view.object.visible) continue;
    const key = `chunk:${c.id}`;
    nextKeys.add(key);
    out.push({
      id: c.id, state: c.state, mesh: c.view.object as unknown as THREE.Mesh,
      baseLayer: SDF_LAYER,
      ageSeconds: ctx.gibs.blurPrevKeys.has(key) ? Number.POSITIVE_INFINITY : 0,
    });
  }
  ctx.gibs.blurPrevKeys = nextKeys;
  return out;
}

export function median(ctx: GameContext, xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  const hi = s[m]!;
  return s.length % 2 ? hi : (s[m - 1]! + hi) / 2;
}

/** Copy every uniform VALUE from a stamped per-body view into a type's own
 *  nodes. The crowd material reads per-TYPE fields from these nodes and
 *  every per-INSTANCE field from the record, so an exact copy of the view's
 *  block is both correct and immune to a per-type stamp the wiring forgot to
 *  list. Textures are shared by reference (they are per-type anyway);
 *  vectors/colours/matrices copy through .copy(). */
export function copyUniformValues(ctx: GameContext, dst: MarchUniforms, src: MarchUniforms): void {
  const d = dst as unknown as Record<string, { value: unknown }>;
  const s = src as unknown as Record<string, { value: unknown }>;
  for (const k of Object.keys(s)) {
    const dn = d[k], sn = s[k];
    if (!dn || !sn) continue;
    const sv = sn.value;
    const dv = dn.value;
    if (sv !== null && typeof sv === 'object' && !(sv instanceof THREE.Texture)
        && dv !== null && typeof dv === 'object'
        && typeof (dv as { copy?: unknown }).copy === 'function') {
      (dv as { copy: (o: unknown) => void }).copy(sv);
    } else {
      dn.value = sv;
    }
  }
}

export function applyBoneCullMode(ctx: GameContext, mode: 'off' | 'cluster' | 'segment'): void {
  ctx.render.boneCullMode = mode;
  ctx.render.boneCull = mode !== 'off';
  for (const a of ctx.world.actors) a.view.setBoneCullMode(mode);
  for (const c of ctx.bake.liveChunks) c.view.setBoneCullMode(mode);
}

export function applyBoneMesh(ctx: GameContext, on: boolean): void {
  ctx.render.boneMesh = on;
  ctx.render.boneInstancer.object.visible = on || ctx.gibs.boneMesh;
  for (const a of ctx.world.actors) a.view.setPackBones(!on);
  for (const c of ctx.bake.liveChunks) c.view.setPackBones(!on);
}

export function updateUpscaleAbLabel(ctx: GameContext) {
  const c = ctx.render.upscaleAb.config;
  if (!c) {
    if (ctx.render.upscaleAbLabel) ctx.render.upscaleAbLabel.hidden = true;
    return;
  }
  if (!ctx.render.upscaleAbLabel) {
    ctx.render.upscaleAbLabel = document.createElement('div');
    ctx.render.upscaleAbLabel.id = 'upscale-ab';
    ctx.render.upscaleAbLabel.setAttribute('style',
      'position:fixed; left:8px; bottom:8px; z-index:40; pointer-events:none;'
      + ' font:12px/1.3 monospace; color:#ffd98a; background:rgba(0,0,0,0.6); padding:3px 6px; border-radius:3px;');
    document.body.appendChild(ctx.render.upscaleAbLabel);
  }
  const m = ctx.render.upscaleAb.model;
  const what = ctx.render.upscaleAb.mode === 'native' ? 'native (march 1.0, no upscale)'
    : ctx.render.upscaleAb.mode === 'nearest' ? 'nearest 2x (zero model)'
    : m ? `model ${ctx.render.upscaleAb.modelName ?? m.id} (${m.id} ${m.inputs}${m.step !== undefined ? `, step ${m.step}` : ''})`
    : `random ${c.model} ${c.inputs} (untrained weights)`;
  ctx.render.upscaleAbLabel.textContent = `upscale [U]: ${what} · ${c.layout}`;
  ctx.render.upscaleAbLabel.hidden = false;
}
