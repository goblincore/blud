// src/lab/sdf-zombie/webgpu/game-render-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { visibleFovDeg } from './fisheye';
import { type GibBlurSubject } from './gib-shutter-layer';
import { SDF_LAYER } from './sdf-layer';
import { type MarchUniforms } from './zombie-gpu';
import { type Vec3 } from '../types';
import { billboardGib, makeGibSprite } from './gib-sprites';
import { clearSight } from './encounter-director';
import { type ZombieActor } from './game-actor';
import { gateRefineTwin } from './game-world-leaves2';
import { simTimeMs } from './sim-clock';

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

export function sizeSdfLayer(ctx: GameContext) {
  const s = ctx.render.postAa.contentSize;
  ctx.render.sdfLayer.setSize(s.width, s.height);
  // The deferred layer tracks the same capped buffer (post-aa hands it the
  // same capture target as a sink).
  ctx.boot.deferredApi?.setSize(s.width, s.height);
  ctx.render.sdfLayer.setConeGeometry(ctx.boot.handle.camera.fov, ctx.render.sdfLayer.targetSize.height);
  // Density follows the SDF layer at GOO_TUNING.densityScale. Called from
  // here rather than a separate resize listener (lab-main's shape) because
  // ADAPTIVE RESOLUTION moves the SDF target at runtime through
  // applySdfScale -> sizeSdfLayer: a listener would never fire and the goo
  // would keep splatting into a stale-sized field.
  const t = ctx.render.sdfLayer.targetSize;
  ctx.goo.layer?.setSize(t.width, t.height);
}

/** Lay the sprite bench out in front of the player, sized like real gibs. */
export function laySpriteBench(ctx: GameContext): number {
  if (!ctx.gibs.atlas) return 0;
  if (!ctx.vfx.spriteBenchGroup) {
    ctx.vfx.spriteBenchGroup = new THREE.Group();
    ctx.vfx.spriteBenchGroup.name = 'gib-sprite-bench';
    ctx.boot.handle.scene.add(ctx.vfx.spriteBenchGroup);
    ctx.boot.deferredApi?.router.register(ctx.vfx.spriteBenchGroup, 'mesh', 'level-only');
  }
  for (const child of [...ctx.vfx.spriteBenchGroup.children]) {
    ctx.vfx.spriteBenchGroup.remove(child);
    const m = child as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material)?.dispose();
  }
  ctx.vfx.spriteBenchSprites.length = 0;
  const fwd: Vec3 = [Math.sin(ctx.player.player.yaw), 0, -Math.cos(ctx.player.player.yaw)];
  const right: Vec3 = [Math.cos(ctx.player.player.yaw), 0, Math.sin(ctx.player.player.yaw)];
  // EVERY frame once, then the whole set again a size down: a gib has to read
  // at the size it will actually be thrown at, not just at bench scale.
  const sizes = [0.34, 0.2];
  let i = 0;
  for (const size of sizes) {
    for (const frame of ctx.gibs.atlas.frames) {
      const mesh = makeGibSprite(frame, size);
      const col = i % 9, line = Math.floor(i / 9);
      const along = 1.7 + line * 0.5;
      const across = (col - 4) * 0.38;
      mesh.position.set(
        ctx.player.player.pos[0] + fwd[0] * along + right[0] * across,
        0.45 + (line % 2) * 0.1,
        ctx.player.player.pos[2] + fwd[2] * along + right[2] * across,
      );
      // Face the camera AT SPAWN as well as per frame: `tick` early-returns
      // under the render lock, so a capture would otherwise photograph the
      // bench edge-on — a plane facing +Z photographed from a player looking
      // east is a line.
      billboardGib(mesh, ctx.boot.handle.camera);
      ctx.vfx.spriteBenchGroup.add(mesh);
      ctx.vfx.spriteBenchSprites.push(mesh);
      i++;
    }
  }
  return ctx.vfx.spriteBenchSprites.length;
}

export const CULL_DWELL_MS = 250;

export function updateVisibleActors(ctx: GameContext): void {
  const now = simTimeMs();
  ctx.world.cullCounts.total = ctx.world.actors.length;
  if (!ctx.render.actorCullEnabled) {
    ctx.render.visibleActors = ctx.world.actors;
    ctx.world.cullCounts.visible = ctx.world.actors.length;
    // Cull off: the frustum/dwell work is skipped, but the refine gate is
    // NOT — the spec's first rule (a dead body never refines) has to hold in
    // both modes, so a body that collapses with the cull off still loses its
    // twin. Same band + hysteresis, every actor, no visibility work.
    ctx.world.sightA[0] = ctx.boot.handle.camera.position.x; ctx.world.sightA[1] = ctx.boot.handle.camera.position.y; ctx.world.sightA[2] = ctx.boot.handle.camera.position.z;
    ctx.render.refinedBodies = 0;
    for (const a of ctx.world.actors) {
      const torso = a.posed().clusters.find(c => c.limb === 'torso');
      if (gateRefineTwin(ctx, a, torso ? torso.center as Vec3 : null, true)) ctx.render.refinedBodies++;
    }
    ctx.world.coverage.screenFrac = 0; ctx.world.coverage.nearestM = 0; ctx.world.coverage.biggestFrac = 0;
    return;
  }
  ctx.world.projScreen.multiplyMatrices(ctx.boot.handle.camera.projectionMatrix, ctx.boot.handle.camera.matrixWorldInverse);
  ctx.world.frustum.setFromProjectionMatrix(ctx.world.projScreen);
  ctx.world.sightA[0] = ctx.boot.handle.camera.position.x; ctx.world.sightA[1] = ctx.boot.handle.camera.position.y; ctx.world.sightA[2] = ctx.boot.handle.camera.position.z;
  const out: ZombieActor[] = [];
  const tw = ctx.render.sdfLayer.marchTarget.width, th = ctx.render.sdfLayer.marchTarget.height;
  const px = Math.max(1, tw * th);
  const halfHpx = th / 2;
  const tanHalfFov = Math.tan((ctx.boot.handle.camera.fov * Math.PI / 180) / 2);
  let area = 0, nearest = 0, biggest = 0;
  ctx.render.refinedBodies = 0;
  for (const a of ctx.world.actors) {
    const torso = a.posed().clusters.find(c => c.limb === 'torso');
    // No torso cluster (mid-gib, exotic body): never cull what we cannot
    // measure — fall back to drawing it. No distance to band-test either, so
    // the refine twin stays off for it.
    if (!torso) {
      out.push(a); ctx.world.lastSeenMs.set(a.id, now);
      gateRefineTwin(ctx, a, null, true);
      continue;
    }
    const c = torso.center;
    ctx.world.bodySphere.center.set(c[0], c[1], c[2]);
    let seen = ctx.world.frustum.intersectsSphere(ctx.world.bodySphere);
    if (seen) {
      // Two probes: torso centre, then a head-height point. A body edging
      // out of cover reveals its head before its chest.
      const head: Vec3 = [c[0], c[1] + 0.6, c[2]];
      seen = clearSight(ctx.world.sightA, c as Vec3, ctx.world.colliders) || clearSight(ctx.world.sightA, head, ctx.world.colliders);
    }
    if (seen) ctx.world.lastSeenMs.set(a.id, now);
    const since = now - (ctx.world.lastSeenMs.get(a.id) ?? -Infinity);
    const kept = seen || since < CULL_DWELL_MS;
    if (kept) out.push(a);

    // Run 5b: the per-body refine gate (see gateRefineTwin).
    if (gateRefineTwin(ctx, a, c as Vec3, kept)) ctx.render.refinedBodies++;

    // Coverage estimate — only for bodies actually seen this frame, so a
    // body coasting on its dwell grace does not inflate the area.
    if (seen) {
      const dx = c[0] - ctx.world.sightA[0], dy = c[1] - ctx.world.sightA[1], dz = c[2] - ctx.world.sightA[2];
      const dist = Math.hypot(dx, dy, dz);
      if (nearest === 0 || dist < nearest) nearest = dist;
      const r = ctx.world.bodySphere.radius;
      // Camera inside the bound: treat as full screen rather than dividing
      // by a distance that is about to go through zero.
      const frac = dist <= r ? 1 : Math.min(1, Math.PI * ((r / dist) * halfHpx / tanHalfFov) ** 2 / px);
      area += frac;
      if (frac > biggest) biggest = frac;
    }
  }
  ctx.world.coverage.screenFrac = Math.min(1, area);
  ctx.world.coverage.nearestM = nearest;
  ctx.world.coverage.biggestFrac = biggest;
  ctx.render.visibleActors = out;
  ctx.world.cullCounts.visible = out.length;
}
