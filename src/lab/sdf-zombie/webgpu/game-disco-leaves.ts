// src/lab/sdf-zombie/webgpu/game-disco-leaves.ts
//
// THE BOILER ROOM DISCO BALL in the game (spec 2026-09-27-disco-ball-design.md): the ball gets a
// mirror-tile material (hand-written WGSL, disco-tiles.wgsl.ts) and throws DISCO.count soft stars
// across its room's walls, floor and ceiling as it spins: one additive instanced quad mesh in the
// SDF layer's late scene (disco-star.wgsl.ts). Decisions are pure (disco-stars.ts): the
// directions, the ray-box hits, the fade and the light on the ball (party white, the strobe's
// flash, then the beacons' red as their beams pass over it).
//
// A level without a spinning ball gets null and nothing changes. The star mesh is hidden (a mesh,
// never a light) while the player is neither in the ball's room nor in one joined to it.

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, instancedDynamicBufferAttribute, normalWorld, positionLocal, positionWorld, uniform, uv, vec3, vec4, wgslFn } from 'three/tsl';
import type { GameContext } from './game-context';
import { countsAsRoomLamp } from './beacon';
import { DISCO, discoDirections, discoFade, discoHits, discoLight, type BeaconView, type Box, type Vec3 } from './disco-stars';
import { DISCO_STAR_WGSL } from './disco-star.wgsl';
import { DISCO_TILES_WGSL } from './disco-tiles.wgsl';
import { roomIdAt } from './game-level-leaves';
import { nearRoomMask } from './game-light-list-leaves';
import { discoSpin } from './train-motion';

/** A star sits this far off its surface (m); polygon offset does the rest. */
const LIFT_M = 0.005;
/** The ball's tiles: rows pole to pole, glint strength, the dim floor, seed. */
const TILES = { rows: 22, glint: 2.4, floor: 0.035, seed: 17 } as const;

type Lamp = NonNullable<GameContext['world']['light']>['lamps'][number];

export interface DiscoRuntime {
  ball: THREE.Mesh;
  room: number;
  /** The ball's centre (world) and its room's box. */
  centre: Vec3;
  box: Box;
  dirs: Float32Array;
  /** discoHits' output, 7 floats a star. */
  hits: Float32Array;
  stars: THREE.InstancedMesh;
  fade: THREE.InstancedBufferAttribute;
  /** rgb · intensity: the stars' colour and the ball's tint. */
  tint: { value: THREE.Vector3 };
  light: { rgb: Vec3; intensity: number };
  /** The room's party lamps (lamps, not fires or beacons) and its beacons, with their views. */
  party: Lamp[];
  beaconLamps: Lamp[];
  beacons: BeaconView[];
  /** Stars written this step. */
  live: number;
  /** Measurement only (cost A/B): the star mesh stays hidden. */
  off: boolean;
}

/** The ball's centre in its mesh's local frame: its sphere sits at the bottom of the piece
 *  (build_train_kit.py disco_ball: radius r, the cap and chain above), so the centre is r above
 *  the lowest point, on the vertical axis. */
function localCentre(g: THREE.BufferGeometry): THREE.Vector3 {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const r = (b.max.x - b.min.x) / 2;
  return new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y + r, (b.min.z + b.max.z) / 2);
}

/** Find the spinning ball, give it the mirror tiles, build the stars. Before the per-room light
 *  lists (the ball is unlit: `skipLevelLights`). Null without a ball. */
export function createDisco(ctx: GameContext): DiscoRuntime | null {
  const objects = (ctx.world.art?.objects ?? []) as THREE.Mesh[];
  const ball = objects.find(m => m.userData.sway === 'spin' && !(m as THREE.InstancedMesh).isInstancedMesh);
  if (!ball || typeof ball.userData.room !== 'number') return null;
  const room = ball.userData.room as number;
  const def = ctx.world.level.rooms.find(r => r.id === room);
  if (!def) return null;
  const lc = localCentre(ball.geometry);
  ball.updateMatrixWorld(true);
  const wc = lc.clone().applyMatrix4(ball.matrixWorld);
  const centre: Vec3 = [wc.x, wc.y, wc.z];
  const box: Box = { min: [def.minX, 0, def.minZ], max: [def.maxX, def.height, def.maxZ] };

  // The light on the ball, shared by the tiles and the stars.
  const tint = uniform(new THREE.Vector3(1, 1, 1));

  // THE BALL: unlit mirror tiles (a basic node material, like the window glass).
  const tiles = wgslFn(DISCO_TILES_WGSL);
  const mirror = new MeshBasicNodeMaterial();
  mirror.colorNode = vec4(tiles({
    local: positionLocal, centre: vec3(lc.x, lc.y, lc.z), n: normalWorld, wpos: positionWorld, eye: cameraPosition,
    tint, cfg: vec4(TILES.rows, TILES.glint, TILES.floor, TILES.seed),
  }) as unknown as ReturnType<typeof vec3>, 1);
  mirror.fog = true;
  mirror.name = 'train.disco-tiles';
  ball.material = mirror;
  ball.userData.skipLevelLights = true;

  // THE STARS: one additive instanced quad, flush with the walls.
  const n = DISCO.count;
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  const star = wgslFn(DISCO_STAR_WGSL);
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = vec4(star({ uv: uv(), fade: instancedDynamicBufferAttribute(fade, 'float') as unknown as ReturnType<typeof float>, color: tint }) as unknown as ReturnType<typeof vec3>, 1);
  mat.transparent = true;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -4;
  mat.fog = false;
  mat.name = 'train.disco-stars';
  const stars = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), mat, n);
  stars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stars.name = 'train.disco-stars';
  stars.frustumCulled = false;
  stars.castShadow = false;
  stars.receiveShadow = false;
  stars.count = 0;
  stars.userData.skipLevelLights = true;
  ctx.boot.handle.scene.add(stars);   // moved to the late-effects scene by adoptDiscoFx

  const lamps = ctx.world.light?.lamps ?? [];
  const party = lamps.filter(l => l.room === room && countsAsRoomLamp(l));
  const beaconLamps = lamps.filter(l => l.room === room && l.beacon);
  const beacons: BeaconView[] = beaconLamps.map(l => {
    const s = l.beacon!.spot;
    const inner = s.angle * (1 - s.penumbra);
    return { pos: [s.position.x, s.position.y, s.position.z], axis: [0, -1, 0], cosOuter: Math.cos(s.angle), cosInner: Math.cos(inner), level: 0, color: [s.color.r, s.color.g, s.color.b] };
  });
  const rt: DiscoRuntime = {
    ball, room, centre, box, dirs: discoDirections(), hits: new Float32Array(n * 7), stars, fade,
    tint: tint as unknown as { value: THREE.Vector3 }, light: { rgb: [...DISCO.party], intensity: 1 },
    party, beaconLamps, beacons, live: 0, off: false,
  };
  ctx.world.disco = rt;
  return rt;
}

/** Once the SDF layer exists: the stars draw after the bodies (sdf-layer lateScene). */
export function adoptDiscoFx(ctx: GameContext): void {
  const late = ctx.render.sdfLayer?.lateScene, rt = ctx.world.disco;
  if (late && rt) late.add(rt.stars);
}

/** Per sim step: the light on the ball, and (while its room is near the player) where the stars land. */
export function stepDisco(ctx: GameContext): void {
  const rt = ctx.world.disco;
  if (!rt) return;
  // The light on the ball: the party lamps' mean level, and each beacon's heading and level.
  let sum = 0;
  for (const l of rt.party) sum += l.level;
  const lampLevel = rt.party.length > 0 ? sum / rt.party.length : 1;
  for (let i = 0; i < rt.beaconLamps.length; i++) {
    const l = rt.beaconLamps[i]!, v = rt.beacons[i]!, s = l.beacon!.spot;
    const ax = s.target.position.x - s.position.x, ay = s.target.position.y - s.position.y, az = s.target.position.z - s.position.z;
    const len = Math.hypot(ax, ay, az) || 1;
    v.axis[0] = ax / len; v.axis[1] = ay / len; v.axis[2] = az / len;
    v.level = l.level;
  }
  discoLight(lampLevel, rt.beacons, rt.centre, rt.light);
  const k = rt.light.intensity * DISCO.rgbScale;
  rt.tint.value.set(rt.light.rgb[0] * k, rt.light.rgb[1] * k, rt.light.rgb[2] * k);

  // Only near the ball's room (its room or one a tunnel joins to it); mask 0 = unknown: draw.
  const [px, , pz] = ctx.player.player.pos;
  const near = nearRoomMask(ctx.world.level.tunnels, roomIdAt(ctx, px, pz), px, pz);
  const show = !rt.off && (near === 0 || (rt.room >= 0 && rt.room < 31 && (near & (1 << rt.room)) !== 0));
  rt.stars.visible = show;
  if (!show) return;

  // Where the stars land: the directions turned with the ball (stepTrain spins it by discoSpin on
  // the train clock, instance 0), cast against the room's box. The ball is night-train level art
  // (build_train_kit.py), so a disco runtime never exists without a train runtime alongside it —
  // asserted, not defaulted, so a level that ever decoupled them would throw here instead of
  // silently spinning the stars from a wrong clock.
  const t = ctx.world.train!.time.value;
  const live = discoHits(rt.dirs, discoSpin(t), rt.centre, rt.box, rt.hits);
  const m = rt.stars.instanceMatrix.array as Float32Array, f = rt.fade.array as Float32Array, h = rt.hits;
  for (let i = 0; i < live; i++) {
    const o = i * 7;
    const nx = h[o + 3]!, ny = h[o + 4]!, nz = h[o + 5]!, dist = h[o + 6]!;
    // The ray's cosine on the face: its component along the normal.
    const cosIn = ((rt.centre[0] - h[o]!) * nx + (rt.centre[1] - h[o + 1]!) * ny + (rt.centre[2] - h[o + 2]!) * nz) / Math.max(dist, 1e-4);
    const s = DISCO.starRadius + DISCO.starGrow * dist;
    // A basis with the quad's +Z on the (axis-aligned) normal: tangent t, bitangent b = n × t.
    let tx = 0, ty = 0, tz = 0;
    if (nx !== 0) tz = nx; else if (ny !== 0) tx = 1; else tx = -nz;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const e = i * 16;
    m[e] = tx * s; m[e + 1] = ty * s; m[e + 2] = tz * s; m[e + 3] = 0;
    m[e + 4] = bx * s; m[e + 5] = by * s; m[e + 6] = bz * s; m[e + 7] = 0;
    m[e + 8] = nx; m[e + 9] = ny; m[e + 10] = nz; m[e + 11] = 0;
    m[e + 12] = h[o]! + nx * LIFT_M; m[e + 13] = h[o + 1]! + ny * LIFT_M; m[e + 14] = h[o + 2]! + nz * LIFT_M; m[e + 15] = 1;
    f[i] = discoFade(dist, cosIn);
  }
  rt.live = live;
  rt.stars.count = live;
  rt.stars.instanceMatrix.clearUpdateRanges();
  rt.stars.instanceMatrix.addUpdateRange(0, live * 16);
  rt.stars.instanceMatrix.needsUpdate = true;
  rt.fade.clearUpdateRanges();
  rt.fade.addUpdateRange(0, live);
  rt.fade.needsUpdate = true;
}

/** Seams: `__sdfGame.disco()` and `setDiscoStars(on)` (cost A/B only: hides the star mesh). */
export function createDiscoSeams(ctx: GameContext) {
  return {
    disco: () => {
      const rt = ctx.world.disco;
      if (!rt) return null;
      // Every live star on a face of the ball's room's box (the check script's "stars land in room 5").
      let onBox = 0;
      const h = rt.hits, eps = 0.02;
      for (let i = 0; i < rt.live; i++) {
        const o = i * 7;
        let inside = true, face = false;
        for (let k = 0; k < 3; k++) {
          const v = h[o + k]!, lo = rt.box.min[k]!, hi = rt.box.max[k]!;
          if (v < lo - eps || v > hi + eps) inside = false;
          if (Math.abs(v - lo) < eps || Math.abs(v - hi) < eps) face = true;
        }
        if (inside && face) onBox++;
      }
      const sample = [];
      for (let i = 0; i < Math.min(rt.live, 4); i++) sample.push([h[i * 7]!, h[i * 7 + 1]!, h[i * 7 + 2]!].map(v => +v.toFixed(3)));
      return {
        room: rt.room, centre: rt.centre.map(v => +v.toFixed(3)), count: rt.live, onBox, visible: rt.stars.visible,
        inLateScene: rt.stars.parent?.name === 'sdf.late-fx',
        rgb: [...rt.light.rgb], intensity: rt.light.intensity,
        material: (rt.ball.material as THREE.Material).name, sample,
      };
    },
    setDiscoStars: (on: boolean) => {
      const rt = ctx.world.disco;
      if (!rt) return null;
      rt.off = !on;
      rt.stars.visible = on && rt.stars.visible;
      return !rt.off;
    },
  };
}
