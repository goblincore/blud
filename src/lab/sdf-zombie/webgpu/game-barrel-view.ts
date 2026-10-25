// src/lab/sdf-zombie/webgpu/game-barrel-view.ts
//
// THE BARREL VIEW (plan 2026-10-25-sector-levels-3b Task 12): the three.js side of barrel-look.ts. One barrel is a
// lathe drum, an emissive nukage-green lid and a hidden sooty stub; explode() swaps the drum for the stub. The drum
// wears our procedural albedo (one shared DataTexture per page), the walls' own metalSheet normal and roughness
// (game-sector-mesh's shared set — no texture memory of its own), and is lit like a sector wall: its zone's light
// list plus albedo × the sector's current level (ctx.world.sectorFx), so a drum in a dark sector is as dark as its
// walls. One scorch pool per barrel runtime draws the floor scorches (an InstancedMesh ring).
//
// Renderer side only: every number comes from barrel-look.ts / barrel-state.ts.
import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, int, texture, vec3, vec4 } from 'three/tsl';
import type { GameContext } from './game-context';
import type { BarrelDef } from './level-def';
import { BARREL } from './barrel-state';
import { BARREL_LOOK, barrelAlbedo, barrelProfile, barrelYaw, fnv1a, scorchAlpha, stubProfile, stubTear, type ProfilePoint } from './barrel-look';
import { sectorPanelSet } from './game-sector-mesh';

const SEGMENTS = 28;
const ALBEDO_PX = 256;
const SCORCH_PX = 64;
/** Soot on the blown stub: its albedo × this. */
const STUB_SOOT = 0.25;
/** The lid's nukage glow (linear RGB × gain), × the pools' glowGain. */
const LID_GLOW: readonly [number, number, number] = [0.35, 0.9, 0.2];
const LID_GAIN = 0.45;

export interface BarrelView {
  group: THREE.Group;
  drum: THREE.Mesh;
  lid: THREE.Mesh;
  stub: THREE.Mesh;
  /** Hide the drum and lid, show the stub. */
  explode(): void;
  dispose(): void;
}

let albedoTex: THREE.DataTexture | null = null;
/** The drum's albedo, built once per page (256² RGBA8, 256 KB before mips). */
function drumAlbedo(): THREE.DataTexture {
  if (albedoTex) return albedoTex;
  const t = new THREE.DataTexture(barrelAlbedo(ALBEDO_PX, ALBEDO_PX, 7), ALBEDO_PX, ALBEDO_PX, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  albedoTex = t;
  return t;
}

/** A lathe of the profile whose v is height / drum height (three's lathe spaces v by point index, which would
 *  smear the hazard band off the drum's middle). */
function lathe(profile: ProfilePoint[]): THREE.LatheGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), SEGMENTS);
  const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / BARREL.heightM);
  uv.needsUpdate = true;
  return g;
}

/** The stub's lathe with its rim torn round the drum too: each lathe column's top rows (above the kept bottom)
 *  move by that column's stubTear offset. Column SEGMENTS is column 0 (the seam closes). */
function stubGeometry(seed: number): THREE.LatheGeometry {
  const profile = stubProfile(seed);
  const g = lathe(profile);
  const tear = stubTear(seed, SEGMENTS);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rows = profile.length, cut = BARREL_LOOK.stubHeightM - BARREL_LOOK.tearM;
  for (let col = 0; col <= SEGMENTS; col++) {
    const d = tear[col % SEGMENTS]!;
    for (let row = 0; row < rows; row++) {
      if (profile[row]![1] <= cut) continue;
      const i = col * rows + row;
      pos.setY(i, pos.getY(i) + d);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** The zone's light list on a material (forward path), as game-main does for the level group's meshes. */
function lightBy(ctx: GameContext, m: THREE.NodeMaterial, zoneRoom: number): void {
  if (ctx.boot.deferredMode) return;
  const list = ctx.world.levelLightLists.get(zoneRoom);
  if (!list) return;
  m.lightsNode = list;
  ctx.world.levelNodeMaterials.push(m);
}

/** The drum (or stub) material: the albedo, the walls' metalSheet normal and roughness, and albedo × the sector's
 *  level as emissive (game-sector-mesh sectorMaterial's wall term). */
function drumMaterial(ctx: GameContext, sector: number, gain: number): MeshStandardNodeMaterial {
  const map = drumAlbedo();
  const metal = sectorPanelSet('metalSheet');
  const m = new MeshStandardNodeMaterial();
  m.name = gain === 1 ? 'barrel-drum' : 'barrel-stub';
  m.map = map;
  m.color = new THREE.Color(gain, gain, gain);
  m.normalMap = metal.normalMap;
  m.metalness = 0.35;
  m.roughness = 0.7;
  // The panel roughness is one channel (RedFormat): read as .r, not as a roughnessMap (.g).
  m.roughnessNode = texture(metal.roughness).r.mul(0.7).clamp(0.04, 1);
  const fx = ctx.world.sectorFx;
  if (fx) m.emissiveNode = texture(map).rgb.mul(gain).mul(fx.levels.element(int(sector)));
  return m;
}

export function createBarrelView(ctx: GameContext, b: BarrelDef, sector: number, zoneRoom: number): BarrelView {
  const group = new THREE.Group();
  group.name = `barrel-${b.id}`;
  group.position.set(b.pos[0], b.pos[1], b.pos[2]);
  group.rotation.y = barrelYaw(b.id);

  const drumMat = drumMaterial(ctx, sector, 1);
  const drum = new THREE.Mesh(lathe(barrelProfile()), drumMat);
  drum.name = 'barrel-drum';

  const fx = ctx.world.sectorFx;
  const lidMat = new MeshStandardNodeMaterial();
  lidMat.name = 'barrel-lid';
  lidMat.color = new THREE.Color(0.05, 0.09, 0.03);
  lidMat.roughness = 0.35;
  lidMat.metalness = 0;
  const glow = vec3(...LID_GLOW).mul(LID_GAIN);
  lidMat.emissiveNode = fx ? glow.mul(fx.glowGain) : glow;
  const lidGeo = new THREE.CircleGeometry(BARREL.radiusM - 0.02, SEGMENTS);
  lidGeo.rotateX(-Math.PI / 2);
  const lid = new THREE.Mesh(lidGeo, lidMat);
  lid.name = 'barrel-lid';
  // 1 mm over the lathe's own lid disc, so the two never fight.
  lid.position.y = BARREL.heightM - BARREL_LOOK.lidRecessM + 0.001;

  const stubMat = drumMaterial(ctx, sector, STUB_SOOT);
  const stub = new THREE.Mesh(stubGeometry(fnv1a(b.id)), stubMat);
  stub.name = 'barrel-stub';
  stub.visible = false;

  for (const [mesh, mat] of [[drum, drumMat], [lid, lidMat], [stub, stubMat]] as const) {
    mesh.userData.room = zoneRoom; // the zone's light list applies, like a sector wall
    lightBy(ctx, mat, zoneRoom);
    group.add(mesh);
  }
  ctx.world.levelGroup.add(group);

  return {
    group, drum, lid, stub,
    explode() {
      drum.visible = false;
      lid.visible = false;
      stub.visible = true;
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of [drum, lid, stub]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        const i = ctx.world.levelNodeMaterials.indexOf(mesh.material as THREE.NodeMaterial);
        if (i >= 0) ctx.world.levelNodeMaterials.splice(i, 1);
      }
    },
  };
}

export interface ScorchPool {
  mesh: THREE.InstancedMesh;
  /** Lay a scorch of `size` m (edge) at the floor point, turned by `yaw`; the oldest is reused past the cap. */
  add(x: number, y: number, z: number, size: number, yaw: number): void;
  dispose(): void;
}

let scorchTex: THREE.DataTexture | null = null;
function scorchTexture(): THREE.DataTexture {
  if (scorchTex) return scorchTex;
  const t = new THREE.DataTexture(scorchAlpha(SCORCH_PX), SCORCH_PX, SCORCH_PX, THREE.RedFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  scorchTex = t;
  return t;
}

/** The floor scorches, one pool per barrel runtime: a flat quad instanced `n` times, soot coloured, alpha from
 *  scorchAlpha in colorNode.w. Each scorch sits a hair above the last so overlapping ones never fight. Drawn
 *  forward (registered with the deferred router like the surface blood). */
export function createScorchPool(ctx: GameContext, n = 12): ScorchPool {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshStandardNodeMaterial();
  mat.name = 'barrel-scorch';
  mat.colorNode = vec4(0.02, 0.018, 0.016, texture(scorchTexture()).r.mul(float(0.85)));
  mat.roughness = 1;
  mat.metalness = 0;
  mat.transparent = true;
  mat.depthWrite = false;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'barrel-scorches';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.userData.shadow = false;
  ctx.boot.handle.scene.add(mesh);
  ctx.boot.deferredApi?.router.register(mesh, 'forward');
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let next = 0;
  return {
    mesh,
    add(x, y, z, size, yaw) {
      const i = next % n;
      p.set(x, y + 0.004 + i * 0.0002, z);
      q.setFromAxisAngle(up, yaw);
      s.set(size, 1, size);
      mesh.setMatrixAt(i, m4.compose(p, q, s));
      mesh.instanceMatrix.needsUpdate = true;
      next++;
      mesh.count = Math.min(next, n);
    },
    dispose() {
      ctx.boot.deferredApi?.router.unregister(mesh);
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
