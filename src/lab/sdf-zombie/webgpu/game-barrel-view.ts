// src/lab/sdf-zombie/webgpu/game-barrel-view.ts
//
// THE BARREL VIEW (plan 2026-10-25-sector-levels-3b Tasks 12–13): the three.js side of barrel-look.ts. One barrel is a
// lathe drum, an emissive nukage-green lid and a hidden sooty stub; explode() swaps the drum for the stub. The drum
// wears our procedural albedo (one shared DataTexture per page), the walls' own metalSheet normal and roughness
// (game-sector-mesh's shared set — no texture memory of its own), and is lit like a sector wall: its zone's light
// list plus albedo × the sector's current level (ctx.world.sectorFx), so a drum in a dark sector is as dark as its
// walls. One scorch pool per barrel runtime draws the floor scorches (an InstancedMesh ring).
//
// SHARED MATERIALS (owner, 2026-10-25): materials are per ZONE, not per barrel — the light list is the zone room's,
// and everything else a barrel needs rides its geometry, as the sector walls do: a `sectorIndex` attribute (read
// with +0.5 before the cast) picks the sector's light level, and a `barrelTint` attribute is the stub's soot (1 on
// the drum, STUB_SOOT on the stub), so the drum and the stub share ONE material and one pipeline (the stub, hidden
// until a blast, needs no compile when it first shows). A zone with barrels has two materials: drum/stub and lid.
// The meshes are direct children of the level group (feet position, hashed yaw) so game-main's light-list loop
// stamps the zone's list on them like any level surface; forZone() also stamps it when the lists already exist.
//
// Renderer side only: every number comes from barrel-look.ts / barrel-state.ts.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, texture, vec3, vec4 } from 'three/tsl';
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
  drum: THREE.Mesh;
  lid: THREE.Mesh;
  stub: THREE.Mesh;
  /** Hide the drum and lid, show the stub. */
  explode(): void;
  /** Remove the meshes and free their geometry (the materials are the zone's: BarrelMaterials.dispose). */
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

/** Per-vertex constants a barrel's geometry carries for the shared material: its sector and its tint. */
function tag(g: THREE.BufferGeometry, sector: number, tint: number): void {
  const n = g.attributes.position!.count;
  g.setAttribute('sectorIndex', new THREE.Float32BufferAttribute(new Float32Array(n).fill(sector), 1));
  g.setAttribute('barrelTint', new THREE.Float32BufferAttribute(new Float32Array(n).fill(tint), 1));
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

/** The drum (and stub) material: the albedo × the vertex tint, the walls' metalSheet normal and roughness, and
 *  albedo × tint × the vertex's sector level as emissive (game-sector-mesh sectorMaterial's wall term). */
function drumMaterial(ctx: GameContext): MeshStandardNodeMaterial {
  const map = drumAlbedo();
  const metal = sectorPanelSet('metalSheet');
  const m = new MeshStandardNodeMaterial();
  m.map = map;                                   // the deferred router's copy; forward reads colorNode
  m.normalMap = metal.normalMap;
  m.metalness = 0.35;
  m.roughness = 0.7;
  // The panel roughness is one channel (RedFormat): read as .r, not as a roughnessMap (.g).
  m.roughnessNode = texture(metal.roughness).r.mul(0.7).clamp(0.04, 1);
  const albedo = texture(map).rgb.mul(attribute('barrelTint', 'float'));
  m.colorNode = vec4(albedo, 1);
  const fx = ctx.world.sectorFx;
  // +0.5 before the cast: the interpolated index may arrive as 2.9999998, which truncates to 2.
  if (fx) m.emissiveNode = albedo.mul(fx.levels.element(attribute('sectorIndex', 'float').add(0.5).toInt()));
  return m;
}

function lidMaterial(ctx: GameContext): MeshStandardNodeMaterial {
  const fx = ctx.world.sectorFx;
  const m = new MeshStandardNodeMaterial();
  m.color = new THREE.Color(0.05, 0.09, 0.03);
  // 0.6, not 0.35: head-on under the flashlight a glossier lid washed out to a flat pale disc (Task 13 look check).
  m.roughness = 0.6;
  m.metalness = 0;
  const glow = vec3(...LID_GLOW).mul(LID_GAIN);
  m.emissiveNode = fx ? glow.mul(fx.glowGain) : glow;
  return m;
}

export interface ZoneBarrelMaterials { drum: MeshStandardNodeMaterial; lid: MeshStandardNodeMaterial }
export interface BarrelMaterials {
  /** The zone room's shared set, made on first use (its light list stamped when the lists exist). */
  forZone(zoneRoom: number): ZoneBarrelMaterials;
  /** Materials made so far (2 per zone with barrels). */
  count(): number;
  dispose(): void;
}

export function createBarrelMaterials(ctx: GameContext): BarrelMaterials {
  const zones = new Map<number, ZoneBarrelMaterials>();
  const lightBy = (m: THREE.NodeMaterial, zoneRoom: number) => {
    if (ctx.boot.deferredMode) return;
    const list = ctx.world.levelLightLists.get(zoneRoom);
    if (!list) return;                           // not built yet: game-main's light-list loop stamps the meshes
    m.lightsNode = list;
    if (!ctx.world.levelNodeMaterials.includes(m)) ctx.world.levelNodeMaterials.push(m);
  };
  return {
    forZone(zoneRoom) {
      let z = zones.get(zoneRoom);
      if (z) return z;
      z = { drum: drumMaterial(ctx), lid: lidMaterial(ctx) };
      z.drum.name = `barrel-drum-zone-${zoneRoom}`;
      z.lid.name = `barrel-lid-zone-${zoneRoom}`;
      lightBy(z.drum, zoneRoom);
      lightBy(z.lid, zoneRoom);
      zones.set(zoneRoom, z);
      return z;
    },
    count: () => zones.size * 2,
    dispose() {
      for (const z of zones.values()) {
        for (const m of [z.drum, z.lid]) {
          m.dispose();
          const i = ctx.world.levelNodeMaterials.indexOf(m);
          if (i >= 0) ctx.world.levelNodeMaterials.splice(i, 1);
        }
      }
      zones.clear();
    },
  };
}

export function createBarrelView(ctx: GameContext, b: BarrelDef, sector: number, zoneRoom: number, mats: BarrelMaterials): BarrelView {
  const { drum: drumMat, lid: lidMat } = mats.forZone(zoneRoom);
  const yaw = barrelYaw(b.id);

  const drumGeo = lathe(barrelProfile());
  tag(drumGeo, sector, 1);
  const drum = new THREE.Mesh(drumGeo, drumMat);
  drum.name = `barrel-drum-${b.id}`;

  const lidGeo = new THREE.CircleGeometry(BARREL.radiusM - 0.02, SEGMENTS);
  lidGeo.rotateX(-Math.PI / 2);
  const lid = new THREE.Mesh(lidGeo, lidMat);
  lid.name = `barrel-lid-${b.id}`;

  const stubGeo = stubGeometry(fnv1a(b.id));
  tag(stubGeo, sector, STUB_SOOT);
  const stub = new THREE.Mesh(stubGeo, drumMat);
  stub.name = `barrel-stub-${b.id}`;
  stub.visible = false;

  for (const mesh of [drum, lid, stub]) {
    mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
    mesh.rotation.y = yaw;
    mesh.userData.room = zoneRoom;               // the zone's light list applies, like a sector wall
    mesh.userData.barrel = b.id;
    ctx.world.levelGroup.add(mesh);
  }
  // 1 mm over the lathe's own lid disc, so the two never fight.
  lid.position.y += BARREL.heightM - BARREL_LOOK.lidRecessM + 0.001;

  return {
    drum, lid, stub,
    explode() {
      drum.visible = false;
      lid.visible = false;
      stub.visible = true;
    },
    dispose() {
      for (const mesh of [drum, lid, stub]) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
    },
  };
}

export interface ScorchPool {
  mesh: THREE.InstancedMesh;
  /** Lay a scorch of `size` m (edge) at the floor point, turned by `yaw`; the oldest is reused past the cap. */
  add(x: number, y: number, z: number, size: number, yaw: number): void;
  /** The laid scorches' centres (instance translations), oldest slot first (gate readback). */
  positions(): [number, number, number][];
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
 *  forward (registered with the deferred router like the surface blood).
 *
 *  UNLIT (Task 13 look check): the pool lives in the scene, not the level group, so a lit material there takes the
 *  scene's whole light list (every lamp, through walls) and the near-black soot read as a light grey square. Soot is
 *  a darkening, so it is a MeshBasicNodeMaterial — like the blood splats — and needs no light at all. */
export function createScorchPool(ctx: GameContext, n = 12): ScorchPool {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicNodeMaterial();
  mat.name = 'barrel-scorch';
  mat.colorNode = vec4(0.02, 0.018, 0.016, texture(scorchTexture()).r.mul(float(0.85)));
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
    positions() {
      const out: [number, number, number][] = [];
      for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m4); p.setFromMatrixPosition(m4); out.push([p.x, p.y, p.z]); }
      return out;
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
