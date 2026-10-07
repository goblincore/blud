// src/lab/sdf-zombie/webgpu/game-egg.ts
//
// THE CONTROL ROOM'S EGG in the game (spec 2026-09-30-night-train-egg-ending-design.md §2): finds the
// plan-1 placeholder egg in the level art (material train.egg), hides it, and draws the real one as a
// single WGSL pass (egg.wgsl.ts) on a proxy box in the SDF layer's late scene, so it hangs over the
// flesh and depth-tests against the level. Decisions are pure (egg-look.ts): the pulse, how the
// figure resolves with distance. A level with no egg gets null and nothing changes.
//
// The proxy box (front faces) hugs the outer egg, so its depth is a conservative stand-in for the
// egg's; the plinth (radius 1.2 m) keeps the player out of the box, so the eye is never inside it.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, positionWorld, uniform, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import { EGG, advancePhase, eggPulse, eggProximity, eggResolve, type Vec3 } from './egg-look';
import { EGG_GAUSS, EGG_RAY, EGG_SHADE, EGG_SPOTS, EGG_VEINS } from './egg.wgsl';
import { roomIdAt } from './game-level-rooms';
import { nearRoomMask } from './game-light-list';

/** The proxy box is this much bigger than the outer egg on every side (m). */
const PAD_M = 0.15;

type Include = NonNullable<Parameters<typeof wgslFn>[1]>[number];

export interface EggRuntime {
  /** The plan-1 placeholder (hidden while the real egg draws). */
  placeholder: THREE.Mesh;
  room: number;
  /** The egg's centre (world). */
  centre: Vec3;
  proxy: THREE.Mesh;
  /** Shader inputs. look = (pulse, resolve, time, 0). */
  look: { value: THREE.Vector4 };
  /** The beat phase 0..1, the train clock at the last step, the pulse and resolve this step. */
  phase: number;
  lastT: number;
  pulse: number;
  resolve: number;
  dist: number;
  /** Look controls: the resolve setting, a held pulse (null = live), and `off` (measurement: placeholder instead). */
  resolveSetting: number;
  holdPulse: number | null;
  off: boolean;
}

const matName = (m: THREE.Mesh): string => {
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return (mat?.name ?? '') as string;
};

/** Find the placeholder, build the proxy and uniforms. Before the per-room light lists (the proxy is
 *  unlit). Null without a placeholder egg. */
export function createEgg(ctx: GameContext): EggRuntime | null {
  const objects = (ctx.world.art?.objects ?? []) as THREE.Mesh[];
  const placeholder = objects.find(m => !!m.isMesh && (m.name.includes('train.egg') || matName(m).includes('train.egg')));
  if (!placeholder) return null;
  placeholder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(placeholder);
  const centre: Vec3 = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
  const room = typeof placeholder.userData.room === 'number' ? (placeholder.userData.room as number) : roomIdAt(ctx, centre[0], centre[2]);

  const inc = (fn: ReturnType<typeof wgslFn>) => fn as unknown as Include;
  const shade = wgslFn(EGG_SHADE, [inc(wgslFn(EGG_RAY)), inc(wgslFn(EGG_GAUSS)), inc(wgslFn(EGG_SPOTS)), inc(wgslFn(EGG_VEINS))]);
  const look = uniform(new THREE.Vector4(0.6, EGG.resolveDefault, 0, 0));
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = shade({
    wpos: positionWorld, eye: cameraPosition,
    c: uniform(new THREE.Vector3(centre[0], centre[1], centre[2])),
    axes: uniform(new THREE.Vector4(EGG.a, EGG.b, EGG.innerScale, EGG.innerDy)),
    look,
    milk: uniform(new THREE.Vector4(EGG.milkSigma, EGG.milkFront, EGG.shellAlpha, EGG.figureStrength)),
  }) as never;
  mat.transparent = true;
  mat.premultipliedAlpha = true;
  mat.blending = THREE.NormalBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = THREE.FrontSide;
  mat.fog = false;
  mat.name = 'train.egg-pass';

  const proxy = new THREE.Mesh(new THREE.BoxGeometry(2 * EGG.a + 2 * PAD_M, 2 * EGG.b + 2 * PAD_M, 2 * EGG.a + 2 * PAD_M), mat);
  proxy.position.set(centre[0], centre[1], centre[2]);
  proxy.name = 'train.egg-pass';
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  proxy.userData.skipLevelLights = true;
  ctx.boot.handle.scene.add(proxy);   // moved to the late-effects scene by adoptEggFx
  placeholder.visible = false;

  const rt: EggRuntime = {
    placeholder, room, centre, proxy, look: look as unknown as { value: THREE.Vector4 },
    phase: 0, lastT: 0, pulse: 0.6, resolve: 0, dist: 99,
    resolveSetting: EGG.resolveDefault, holdPulse: null, off: false,
  };
  ctx.world.egg = rt;
  return rt;
}

/** Once the SDF layer exists: the egg draws after the bodies (sdf-layer lateScene). */
export function adoptEggFx(ctx: GameContext): void {
  const late = ctx.render.sdfLayer?.lateScene, rt = ctx.world.egg;
  if (late && rt) late.add(rt.proxy);
}

/** Per sim step: the pulse (on the train clock, quickening as you close in), how far the figure
 *  resolves, and whether the egg is near enough to draw. */
export function stepEgg(ctx: GameContext): void {
  const rt = ctx.world.egg;
  if (!rt) return;
  const [px, , pz] = ctx.player.player.pos;
  rt.dist = Math.hypot(px - rt.centre[0], pz - rt.centre[2]);
  const near = nearRoomMask(ctx.world.level.tunnels, roomIdAt(ctx, px, pz), px, pz);
  const show = !rt.off && (near === 0 || (rt.room >= 0 && rt.room < 31 && (near & (1 << rt.room)) !== 0));
  rt.proxy.visible = show;
  rt.placeholder.visible = rt.off;
  if (!show) return;
  const t = ctx.world.train?.time.value ?? 0;
  const dt = Math.max(0, Math.min(0.25, t - rt.lastT));
  rt.lastT = t;
  rt.phase = advancePhase(rt.phase, dt, eggProximity(rt.dist));
  rt.pulse = rt.holdPulse ?? eggPulse(rt.phase);
  rt.resolve = eggResolve(rt.dist, rt.resolveSetting);
  rt.look.value.set(rt.pulse, rt.resolve, t, 0);
}

/** Seams: `__sdfGame.egg()` and `setEgg({ off, resolve, pulse })` (look and cost checks only). */
export function createEggSeams(ctx: GameContext) {
  return {
    egg: () => {
      const rt = ctx.world.egg;
      if (!rt) return null;
      return {
        room: rt.room, centre: rt.centre.map(v => +v.toFixed(3)), visible: rt.proxy.visible,
        inLateScene: rt.proxy.parent?.name === 'sdf.late-fx', placeholderVisible: rt.placeholder.visible,
        pulse: +rt.pulse.toFixed(4), resolve: +rt.resolve.toFixed(4), phase: +rt.phase.toFixed(4),
        dist: +rt.dist.toFixed(3), resolveSetting: rt.resolveSetting, holdPulse: rt.holdPulse, off: rt.off,
        material: (rt.proxy.material as THREE.Material).name, placeholderName: rt.placeholder.name,
      };
    },
    setEgg: (o: { off?: boolean; resolve?: number; pulse?: number | null }) => {
      const rt = ctx.world.egg;
      if (!rt) return null;
      if (o.off !== undefined) rt.off = o.off;
      if (o.resolve !== undefined) rt.resolveSetting = o.resolve;
      if (o.pulse !== undefined) rt.holdPulse = o.pulse;
      return { off: rt.off, resolveSetting: rt.resolveSetting, holdPulse: rt.holdPulse };
    },
  };
}
