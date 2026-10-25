// src/lab/sdf-zombie/webgpu/game-barrel-view.ts
//
// THE BARREL VIEW (plan 2026-10-25-sector-levels-3b Tasks 12–13, owner look pass 2026-10-25): the three.js side of
// barrel-look.ts. One barrel is a dented lathe drum, a grimy lid with a raised rim, a plug and a small vent that
// glows, and a hidden open, charred stub with a torn rim; explode() swaps the drum for the stub. The drum wears our
// procedural albedo (roughness in its alpha; one shared DataTexture per page, the lid another), the walls' own
// metalSheet normal and roughness grain (game-sector-mesh's shared set — no texture memory of its own), and is lit
// like a sector wall: its zone's light list plus albedo × the sector's current level (ctx.world.sectorFx), so a drum
// in a dark sector is as dark as its walls. One scorch pool per barrel runtime draws the floor scorches (an
// InstancedMesh ring).
//
// SHARED MATERIALS (owner, 2026-10-25): materials are per ZONE, not per barrel — the light list is the zone room's,
// and everything else a barrel needs rides its geometry, as the sector walls do: a `sectorIndex` attribute (read
// with +0.5 before the cast) picks the sector's light level, and a `barrelTint` attribute mixes the albedo toward
// char (1 less a little dent grime on the drum, scorched to black on the stub), so the drum and the stub share ONE
// material and one pipeline (the stub, hidden until a blast, needs no compile when it first shows). A zone with barrels has two materials: drum/stub and lid.
// The meshes are direct children of the level group (feet position, hashed yaw) so game-main's light-list loop
// stamps the zone's list on them like any level surface; forZone() also stamps it when the lists already exist.
//
// Renderer side only: every number comes from barrel-look.ts / barrel-state.ts.
import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, texture, vec3, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from './game-context';
import type { BarrelDef } from './level-def';
import { BARREL } from './barrel-state';
import {
  BARREL_LOOK, barrelAlbedo, barrelDents, barrelProfile, barrelYaw, dentDepth, fnv1a, lidAlbedo, scorchMask,
  stubBend, stubInnerStart, stubProfile, stubTear, stubWarp, type Dent, type ProfilePoint,
} from './barrel-look';
import { sectorPanelSet } from './game-sector-mesh';

const SEGMENTS = 48;
const ALBEDO_PX = 256;
const LID_PX = 128;
const SCORCH_PX = 512;
/** What `barrelTint` mixes toward: char, a dark burnt brown (linear RGB). The drum's tint is 1 less a little dent
 *  grime; the stub's falls from a scorched foot to black at the torn rim and inside. */
const CHAR: readonly [number, number, number] = [0.012, 0.008, 0.005];
/** The stub's tint: at its foot, at the cut, on the torn band, inside. */
const STUB_TINT = { foot: 0.3, cut: 0.12, torn: 0.06, inside: 0.008 } as const;
/** The char's roughness (the drum's runs 0.26–0.62). */
const CHAR_ROUGH = 0.42;
/** Dent grime: a dent at dentMax darkens the drum's albedo toward char by this much. */
const DENT_GRIME = 0.35;
/** The vent's nukage glow (linear RGB × gain), × the pools' glowGain. Small and faint: it reads as a light in
 *  the dark, not a lamp. */
const VENT_GLOW: readonly [number, number, number] = [0.35, 0.9, 0.2];
const VENT_GAIN = 1.1;
/** Soot on the floor (linear RGB): black, near enough — a dark sector's floor is darker than 0.01 linear. */
const SOOT: readonly [number, number, number] = [0.0015, 0.0011, 0.0008];

export interface BarrelView {
  drum: THREE.Mesh;
  lid: THREE.Mesh;
  stub: THREE.Mesh;
  /** Hide the drum and lid, show the stub. */
  explode(): void;
  /** Remove the meshes and free their geometry (the materials are the zone's: BarrelMaterials.dispose). */
  dispose(): void;
}

/** An RGBA8 sRGB DataTexture (A = roughness, linear) with mips. */
function rgbaTexture(data: Uint8Array, n: number, wrapS: THREE.Wrapping): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = wrapS;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
let albedoTex: THREE.DataTexture | null = null;
/** The drum's albedo, built once per page (256² RGBA8, 256 KB before mips). */
function drumAlbedo(): THREE.DataTexture {
  return (albedoTex ??= rgbaTexture(barrelAlbedo(ALBEDO_PX, ALBEDO_PX, 7), ALBEDO_PX, THREE.RepeatWrapping));
}
let lidTex: THREE.DataTexture | null = null;
/** The lid's albedo, built once per page (128² RGBA8). */
function lidTexture(): THREE.DataTexture {
  return (lidTex ??= rgbaTexture(lidAlbedo(LID_PX, 11), LID_PX, THREE.ClampToEdgeWrapping));
}

/** Per-vertex constants a barrel's geometry carries for the shared material: its sector and its tint. */
function tag(g: THREE.BufferGeometry, sector: number, tint: number | Float32Array): void {
  const n = g.attributes.position!.count;
  g.setAttribute('sectorIndex', new THREE.Float32BufferAttribute(new Float32Array(n).fill(sector), 1));
  g.setAttribute('barrelTint', new THREE.Float32BufferAttribute(typeof tint === 'number' ? new Float32Array(n).fill(tint) : tint, 1));
}

/** A lathe of the profile whose v is height / drum height (three's lathe spaces v by point index, which would
 *  smear the hazard band off the drum's middle). Vertex (col, row) is col × rows + row; u = col / SEGMENTS. */
function lathe(profile: ProfilePoint[], segments = SEGMENTS): THREE.LatheGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  const pos = g.attributes.position as THREE.BufferAttribute, uvs = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uvs.setY(i, pos.getY(i) / BARREL.heightM);
  uvs.needsUpdate = true;
  return g;
}

/** Recompute a lathe's normals after its vertices moved, and close the seam (column SEGMENTS is column 0). */
function relight(g: THREE.BufferGeometry, rows: number): void {
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let row = 0; row < rows; row++) {
    const a = row, b = SEGMENTS * rows + row;
    const x = nrm.getX(a) + nrm.getX(b), y = nrm.getY(a) + nrm.getY(b), z = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(a, x / l, y / l, z / l);
    nrm.setXYZ(b, x / l, y / l, z / l);
  }
  nrm.needsUpdate = true;
}

/** Push the shell in by the dents at every vertex of radius ≥ minR; returns each vertex's dent depth. */
function dent(g: THREE.BufferGeometry, profile: ProfilePoint[], dents: readonly Dent[], minR: number): Float32Array {
  const pos = g.attributes.position as THREE.BufferAttribute, rows = profile.length;
  const depth = new Float32Array(pos.count);
  for (let col = 0; col <= SEGMENTS; col++) {
    for (let row = 0; row < rows; row++) {
      const [r, y] = profile[row]!;
      if (r < minR) continue;
      const d = dentDepth(dents, (col % SEGMENTS) / SEGMENTS, y);
      if (d <= 0) continue;
      const i = col * rows + row, k = (r - d) / r;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
      depth[i] = d;
    }
  }
  pos.needsUpdate = true;
  return depth;
}

/** The drum: the lathe, dented (seeded per barrel), its tint darkened in the dents. */
function drumGeometry(seed: number, sector: number): THREE.LatheGeometry {
  const profile = barrelProfile();
  const g = lathe(profile);
  const depth = dent(g, profile, barrelDents(seed), BARREL.radiusM - 0.003);
  relight(g, profile.length);
  const tint = new Float32Array(depth.length);
  for (let i = 0; i < tint.length; i++) tint[i] = 1 - DENT_GRIME * (depth[i]! / BARREL_LOOK.dentMaxM);
  tag(g, sector, tint);
  return g;
}

/** The stub: the open lathe (stubProfile), the same dents as the drum below the cut, and its torn band warped
 *  per column — jagged (stubTear) and peeled outward (stubBend, stubWarp), inner wall with it. Tinted toward char:
 *  scorched at the foot, black at the rim and inside. */
function stubGeometry(seed: number, sector: number): THREE.LatheGeometry {
  const profile = stubProfile(seed);
  const g = lathe(profile);
  const rows = profile.length, inner = stubInnerStart(profile);
  const cut = BARREL_LOOK.stubHeightM - BARREL_LOOK.tearM, top = profile[inner - 1]![1];
  dent(g, profile, barrelDents(seed), BARREL.radiusM - BARREL_LOOK.stubWallM - 0.001);
  const tear = stubTear(seed, SEGMENTS), bend = stubBend(seed, SEGMENTS);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const tint = new Float32Array(pos.count);
  for (let col = 0; col <= SEGMENTS; col++) {
    const c = col % SEGMENTS;
    for (let row = 0; row < rows; row++) {
      const [r, y] = profile[row]!, i = col * rows + row;
      if (row >= inner) tint[i] = STUB_TINT.inside;
      else if (y <= cut) tint[i] = STUB_TINT.foot + (STUB_TINT.cut - STUB_TINT.foot) * Math.min(1, y / cut);
      else tint[i] = STUB_TINT.torn;
      if (y <= cut + 1e-6 || r <= 0) continue;
      const [dr, dy] = stubWarp(tear[c]!, bend[c]!, (y - cut) / (top - cut));
      const x = pos.getX(i), z = pos.getZ(i), rr = Math.hypot(x, z), k = (rr + dr) / rr;
      pos.setXYZ(i, x * k, pos.getY(i) + dy, z * k);
    }
  }
  pos.needsUpdate = true;
  relight(g, rows);
  tag(g, sector, tint);
  return g;
}

/** The lid, in its own space (y 0 = the lid plate): the plate, the vent bung (a collar round a recessed vent that
 *  glows: `lidGlow` 1) and the plug (a hex nut). UVs planar over the lid (lidAlbedo's mapping). */
function lidGeometry(sector: number): THREE.BufferGeometry {
  const L = BARREL_LOOK.lidRadiusM, { vent, plug } = BARREL_LOOK;
  const plate = new THREE.CircleGeometry(L, SEGMENTS);
  plate.rotateX(-Math.PI / 2);
  const bung = (cx: number, cz: number, r: number, profile: ProfilePoint[], segs: number, glowBelow: number) => {
    const g = new THREE.LatheGeometry(profile.map(([pr, py]) => new THREE.Vector2(pr, py)), segs);
    g.translate(cx, 0, cz);
    const n = g.attributes.position!.count, glow = new Float32Array(n);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) if (Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) <= glowBelow * r + 1e-6 && pos.getY(i) < 0.006) glow[i] = 1;
    g.setAttribute('lidGlow', new THREE.Float32BufferAttribute(glow, 1));
    return g;
  };
  const vr = vent.r, pr = plug.r;
  const ventGeo = bung(vent.x, vent.z, vr,
    [[vr + 0.007, 0], [vr + 0.007, 0.006], [vr + 0.002, 0.013], [vr * 0.72, 0.013], [vr * 0.7, 0.004], [0, 0.004]], 20, 0.7);
  const plugGeo = bung(plug.x, plug.z, pr,
    [[pr + 0.007, 0], [pr + 0.007, 0.005], [pr, 0.006], [pr, 0.014], [pr * 0.4, 0.016], [0, 0.016]], 6, 0);
  plate.setAttribute('lidGlow', new THREE.Float32BufferAttribute(new Float32Array(plate.attributes.position!.count), 1));
  const g = mergeGeometries([plate, ventGeo, plugGeo], false)!;
  for (const p of [plate, ventGeo, plugGeo]) p.dispose();
  const pos = g.attributes.position as THREE.BufferAttribute, uvs = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uvs.setXY(i, (pos.getX(i) / L + 1) / 2, (-pos.getZ(i) / L + 1) / 2);
  uvs.needsUpdate = true;
  tag(g, sector, 1);
  return g;
}

/** The sector light term (game-sector-mesh sectorMaterial's wall term): the vertex's sector level. */
function sectorLevel(ctx: GameContext) {
  const fx = ctx.world.sectorFx;
  // +0.5 before the cast: the interpolated index may arrive as 2.9999998, which truncates to 2.
  return fx ? fx.levels.element(attribute('sectorIndex', 'float').add(0.5).toInt()) : null;
}

/** The drum (and stub) material: the albedo mixed toward char by the vertex tint, its roughness from the albedo's
 *  alpha (× the walls' metalSheet roughness grain), bare steel (low roughness) metallic, the walls' metalSheet
 *  normal, and albedo × the vertex's sector level as emissive (the walls' term). */
function drumMaterial(ctx: GameContext): MeshStandardNodeMaterial {
  const map = drumAlbedo();
  const metal = sectorPanelSet('metalSheet');
  const m = new MeshStandardNodeMaterial();
  m.map = map;                                   // the deferred router's copy; forward reads colorNode
  m.normalMap = metal.normalMap;
  m.metalness = 0.2;
  m.roughness = 0.55;
  const tint = attribute('barrelTint', 'float');
  const tex = texture(map);
  // Below a tint of 0.05 the char fades on to soot black (the stub's inside: a hole, not a brown dome).
  const albedo = mix(vec3(...CHAR), tex.rgb, tint).mul(tint.div(0.05).clamp(0.04, 1));
  m.colorNode = vec4(albedo, 1);
  // Roughness from the albedo's alpha, remapped into 0.26–0.62 (× the walls' metalSheet roughness grain, one
  // channel, RedFormat: read as .r). Not higher: above ~0.65 the flashlight's broad rough lobe at arm's length
  // lays a pale grey veil over the drum (a black-albedo, roughness-0.96 test drum read mid grey; the same at 0.4
  // read dark) — the old lid's "flat pale disc". The char is 0.42: a dull, slightly oily sheen.
  const rough = mix(float(0.26), float(0.62), tex.a).mul(texture(metal.roughness).r.mul(0.3).add(0.85));
  m.roughnessNode = mix(float(CHAR_ROUGH), rough, tint).clamp(0.2, 0.68);
  // Bare steel (alpha ≈ 0.36) is metal; paint, rust and grime are not.
  // The whole stub (tint ≤ 0.32) is sooted steel: metal, so its near-black albedo is also its specular colour. A
  // dielectric char kept F0 0.04 and its head-on highlight under the flashlight drew the foot band pale tan.
  const charMetal = float(1).sub(tint.sub(0.32).div(0.3).clamp(0, 1));
  m.metalnessNode = mix(float(0.62).sub(tex.a).mul(4).clamp(0, 1).mul(0.75).add(0.05), float(1), charMetal);
  const level = sectorLevel(ctx);
  if (level) m.emissiveNode = albedo.mul(level);
  return m;
}

/** The lid material: grimy lid albedo, rough, the vent glowing faintly (`lidGlow`), lit like a wall. */
function lidMaterial(ctx: GameContext): MeshStandardNodeMaterial {
  const fx = ctx.world.sectorFx;
  const map = lidTexture();
  const m = new MeshStandardNodeMaterial();
  m.map = map;
  m.roughness = 0.55;
  m.metalness = 0.05;
  const tex = texture(map);
  m.colorNode = vec4(tex.rgb, 1);
  // Remapped like the drum's (0.3–0.6): rougher veils pale under the flashlight.
  m.roughnessNode = mix(float(0.3), float(0.6), tex.a);
  m.metalnessNode = float(0.62).sub(tex.a).mul(4).clamp(0, 1).mul(0.6).add(0.03);
  const glow = vec3(...VENT_GLOW).mul(VENT_GAIN).mul(attribute('lidGlow', 'float'));
  const vent = fx ? glow.mul(fx.glowGain) : glow;
  const level = sectorLevel(ctx);
  m.emissiveNode = level ? tex.rgb.mul(level).add(vent) : vent;
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

  const seed = fnv1a(b.id);

  const drum = new THREE.Mesh(drumGeometry(seed, sector), drumMat);
  drum.name = `barrel-drum-${b.id}`;

  const lid = new THREE.Mesh(lidGeometry(sector), lidMat);
  lid.name = `barrel-lid-${b.id}`;

  const stub = new THREE.Mesh(stubGeometry(seed, sector), drumMat);
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
  const t = new THREE.DataTexture(scorchMask(SCORCH_PX), SCORCH_PX, SCORCH_PX, THREE.RedFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  scorchTex = t;
  return t;
}

/** The floor scorches, one pool per barrel runtime: a flat quad instanced `n` times. Each scorch sits a hair above
 *  the last so overlapping ones never fight.
 *
 *  OPAQUE SOOT (owner look pass, 2026-10-25): the scorch was a transparent black-at-alpha quad (unlit since the
 *  Task 13 look check), and it barely showed. Debugging it in this pass: a transparent quad here does NOT darken
 *  the floor under it — black at any alpha, premultiplied black and a CustomBlending multiply all drew nothing,
 *  while red at alpha drew red and the old 0.02 soot drew a pale ring LIGHTER than the dark floor (headless E1M1,
 *  b37). So the scorch is drawn the way the floor is: OPAQUE, unlit black, alpha-tested against scorchMask (soot
 *  density from scorchAlpha's amount — a solid core, gritty body, flecked ragged edge). It needs no light, takes
 *  the level's fog like the floor (MeshBasic fog), and darkens whatever lights the floor, flashlight included. */
export function createScorchPool(ctx: GameContext, n = 12): ScorchPool {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicNodeMaterial();
  mat.name = 'barrel-scorch';
  mat.colorNode = vec4(vec3(...SOOT), 1);
  mat.opacityNode = texture(scorchTexture()).r;
  mat.alphaTest = 0.5;
  mat.polygonOffset = true;                       // over the floor at grazing angles too
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -1;
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
