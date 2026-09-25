// src/lab/sdf-zombie/webgpu/game-void-leaves.ts
//
// THE VOID in the game (spec 2026-09-24-void-portal-design.md §5-§6): the portal
// quads, the glow pools, the embers, black fog, and the portal trigger. Decisions
// are pure (void-portal.ts); the WGSL is portal.wgsl.ts. A level with no portals
// gets null and nothing is added.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, instanceIndex, mix, positionWorld, uniform, uv, varying, vec3, vec4, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import { levelUrl } from './game-menu';
import { EMBER_POS, GLOW_POOL, PORTAL_COLOR, PORTAL_H21, PORTAL_VNOISE } from './portal.wgsl';
import { insidePortal, portalFrame } from './void-portal';

const EMBER_COUNT = 300;
const EMBER_BOX_M = 24;
const GLOW_RADIUS_M = 4;
const PORTAL_PAD = 1.4;   // quad size / oval size: room for the wisps
const FLASH_MS = 250;
const BLACK = new THREE.Color(0, 0, 0);

export interface VoidRuntime {
  time: { value: number };
  entered: string | null;
  objects: THREE.Object3D[];
}

export function createVoid(ctx: GameContext): VoidRuntime | null {
  const portals = ctx.world.level.portals;
  if (portals.length === 0) return null;
  const scene = ctx.boot.handle.scene;
  const uTime = uniform(0);
  const objects: THREE.Object3D[] = [];
  // WGSL has no nested fn: the noise helpers ride along as includes.
  // wgslFn's result proxies its FunctionNode (property reads go to the node), so it
  // works as an include as is; the types only accept the node.
  const include = (fn: ReturnType<typeof wgslFn>) => fn as unknown as NonNullable<Parameters<typeof wgslFn>[1]>[number];
  const portalFn = wgslFn(PORTAL_COLOR, [include(wgslFn(PORTAL_VNOISE, [include(wgslFn(PORTAL_H21))]))]);
  for (const p of portals) {
    const f = portalFrame(p);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = vec4(portalFn({
      wpos: positionWorld, eye: cameraPosition, base: vec3(...p.pos),
      facing: vec3(...f.facing), right: vec3(...f.right), cfg: vec3(float(p.width), float(p.height), uTime),
    }) as unknown as ReturnType<typeof vec3>, 1);
    mat.blending = THREE.AdditiveBlending; mat.transparent = true; mat.depthWrite = false; mat.fog = false;
    mat.side = THREE.DoubleSide;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(p.width * PORTAL_PAD, p.height * PORTAL_PAD), mat);
    quad.position.set(p.pos[0], p.pos[1] + p.height / 2, p.pos[2]);
    quad.rotation.y = -p.yaw + Math.PI; // plane normal +z -> portal facing
    quad.name = `portal:${p.id}`;
    const glowMat = new MeshBasicNodeMaterial();
    glowMat.colorNode = vec4(wgslFn(GLOW_POOL)({ uv: uv() }) as unknown as ReturnType<typeof vec3>, 1);
    glowMat.blending = THREE.AdditiveBlending; glowMat.transparent = true; glowMat.depthWrite = false; glowMat.fog = false;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(GLOW_RADIUS_M * 2, GLOW_RADIUS_M * 2), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(p.pos[0] + f.facing[0] * 1.5, p.pos[1] + 0.01, p.pos[2] + f.facing[2] * 1.5);
    scene.add(quad, glow);
    objects.push(quad, glow);
  }
  const first = portals[0]!;
  const emberMat = new SpriteNodeMaterial();
  const pos = wgslFn(EMBER_POS)({ i: float(instanceIndex), t: uTime, cam: cameraPosition, box: float(EMBER_BOX_M) });
  const vpos = varying(pos as unknown as ReturnType<typeof vec3>);
  emberMat.positionNode = vpos;
  emberMat.scaleNode = float(0.035);
  const near = float(1).sub(vpos.sub(vec3(...first.pos)).length().div(10).clamp(0, 1));
  emberMat.colorNode = vec4(mix(vec3(0.35, 0.22, 0.18), vec3(1.0, 0.18, 0.08), near).mul(0.8), 1);
  emberMat.blending = THREE.AdditiveBlending; emberMat.transparent = true; emberMat.depthWrite = false; emberMat.fog = false;
  const embers = new THREE.Sprite(emberMat);
  embers.count = EMBER_COUNT;
  embers.frustumCulled = false;
  scene.add(embers);
  objects.push(embers);
  ctx.boot.handle.renderer.setClearColor(new THREE.Color(0, 0, 0));
  return { time: uTime as unknown as { value: number }, entered: null, objects };
}

/** Per frame: advance the shader clock on sim time, keep the fog black, fire a portal. */
export function stepVoid(ctx: GameContext, dt: number): void {
  const rt = ctx.lighting.void;
  if (!rt) return;
  rt.time.value += dt;
  // applyRig (and its panel) write the dungeon fog colour into fog and clear colour;
  // the Void holds both at black.
  const fog = ctx.boot.handle.scene.fog as THREE.Fog | null;
  if (fog) fog.color.setRGB(0, 0, 0);
  ctx.boot.handle.renderer.setClearColor(BLACK);
  if (rt.entered) return;
  const pos = ctx.player.player.pos;
  const hit = ctx.world.level.portals.find(p => insidePortal(p, pos));
  if (!hit) return;
  rt.entered = hit.target;
  const flash = document.createElement('div');
  flash.style.cssText = `position:fixed;inset:0;z-index:60;pointer-events:none;background:#c01010;opacity:0;transition:background ${FLASH_MS}ms,opacity ${FLASH_MS / 2}ms`;
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.opacity = '1'; flash.style.background = '#fff'; });
  setTimeout(() => location.assign(levelUrl(location.href, hit.target)), FLASH_MS);
}

export function createVoidSeams(ctx: GameContext) {
  return {
    voidState: () => {
      const rt = ctx.lighting.void;
      return rt ? { portals: ctx.world.level.portals.map(p => ({ id: p.id, target: p.target, pos: [...p.pos] })), entered: rt.entered } : null;
    },
  };
}
