// @vitest-environment happy-dom
// src/lab/sdf-zombie/characters/goblin-cinematic-home-teeth.test.ts
//
// THE HOME GOBLIN'S TEETH (emergence in the Flat, plan Task 4b). goblin-cinematic-home is goblin-cinematic.blob (the face rig) at the
// goblin's 1.70 m (`scale 1.3077`); its mesh teeth are BORROWED from the 1.30 m goblin-cinematic-kit.gltf, where they are one skinned
// `tooth` primitive beside the armour's: the registry names the kit, `kitOnly: ['tooth']` drops the armour at load, and `kitScale`
// composes every bone frame with the body's scale (kit-overlay.ts KitLoadOpts). Read here through the SAME three.js code the game
// runs: GLTFLoader parses the committed kit (its atlas stripped: the loader would need a DOM for the image, and the teeth have none),
// keepKitMaterials filters it, bindKitBones / poseKitBones pose it from rig-bind kitFrames of the compiled HOME body, and three's own
// skinning (SkinnedMesh.applyBoneTransform) places every vertex. The checks are goblin-cinematic-blob.test.ts's mesh-teeth checks
// (buried at rest, bared at the grin, nothing through the lips), against the 1.70 m body.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import kitJson from '../../../../public/assets/lab/goblin-cinematic-kit.gltf?raw';
import homeSrc from './goblin-cinematic-home.blob?raw';
import cinematicSrc from './goblin-cinematic.blob?raw';
import { characterEntry } from '../character-registry';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace, compileSheet } from '../blob-compile';
import { buildBody, type BuildResult } from '../build-body';
import { nearestPrim, sdBody } from '../validate';
import { add, dot, len, scale as vscale, sub, qRotate, type Quat } from '../vec';
import { bindRig, applyRig, kitFrames, type BoundRig } from '../rig-bind';
import { actuate, expressionAt } from '../expression';
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './goblin-expressions';
import { expressionsFor } from '../expression-library';
import { bindKitBones, keepKitMaterials, poseKitBones, type KitBones } from '../webgpu/kit-overlay';
import type { Vec3 } from '../types';

const homeDoc = parseBlob(homeSrc), cinDoc = parseBlob(cinematicSrc);
const S = homeDoc.scale!;
const bodyOf = (doc: ReturnType<typeof parseBlob>) => buildBody(compileBlob(doc, compileFace(doc)));
const home = bodyOf(homeDoc), cin = bodyOf(cinDoc);

/** The committed kit, parsed by three, filtered to `only` (or whole), its bones readied: what loadKit does before the renderer. */
async function kitScene(only?: readonly string[]) {
  const json = JSON.parse(kitJson);
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) delete m.pbrMetallicRoughness?.baseColorTexture;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  if (only) keepKitMaterials(gltf.scene, only);
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.SkinnedMesh); });
  const bones = bindKitBones(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  return { scene: gltf.scene, meshes, bones };
}

/** Every vertex of `mesh`, skinned by three for the rig `b` of `body` (world: the kit's root and mesh carry no transform). */
function skin(mesh: THREE.SkinnedMesh, bones: KitBones, body: BuildResult, b: BoundRig, scale: number): Vec3[] {
  poseKitBones(bones, kitFrames(body, b, 0), scale);
  const pos = mesh.geometry.getAttribute('position'), v = new THREE.Vector3(), out: Vec3[] = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

const withGape = (b: BoundRig, gape: number, morphs?: Record<string, number>): BoundRig =>
  ({ ...b, rig: { ...b.rig, jawGape: gape, ...(morphs ? { morphs } : {}) } });
const peak = (doc: ReturnType<typeof parseBlob>, name: string) =>
  actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), compileSheet(doc)!, GOBLIN_EXPRESSION_TUNING);

describe('goblin-cinematic-home wears the cinematic kit\'s teeth, scaled to 1.70 m (plan Task 4b)', async () => {
  const { meshes, bones } = await kitScene(characterEntry('goblin-cinematic-home').kitOnly);
  const mesh = meshes[0]!;
  const geo = mesh.geometry;
  const tris = Array.from(geo.getIndex()!.array as ArrayLike<number>);
  const restPos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const boneName = (i: number) => {
    let best = 0;
    for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > sw.getComponent(i, best)) best = c;
    return mesh.skeleton.bones[si.getComponent(i, best)]!.name;
  };
  // One tooth = one connected component of the triangles, vertices at the same point counted as one (as the cinematic test does).
  const parent = new Map<number, number>();
  const find = (i: number): number => { let r = i; while (parent.get(r)! !== r) r = parent.get(r)!; return r; };
  for (const i of tris) if (!parent.has(i)) parent.set(i, i);
  for (let t = 0; t < tris.length; t += 3) for (const k of [1, 2]) parent.set(find(tris[t + k]!), find(tris[t]!));
  const atPoint = new Map<string, number>();
  for (const i of new Set(tris)) {
    const key = [restPos.getX(i), restPos.getY(i), restPos.getZ(i)].map(c => c.toFixed(7)).join(',');
    const j = atPoint.get(key);
    if (j == null) atPoint.set(key, i); else parent.set(find(i), find(j));
  }
  const groups = new Map<number, number[]>();
  for (const i of new Set(tris)) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); }
  const teeth = [...groups.values()].map(ix => ({ bone: boneName(ix[0]!), ix, own: new Set(ix), x: restPos.getX(ix[0]!) }))
    .sort((a, b) => a.x - b.x);
  type Tooth = (typeof teeth)[number];
  /** A tooth's surface samples: its vertices and its triangles' centroids (a rigid tooth: the centroid of the skinned corners). */
  const samples = (P: Vec3[], t: Tooth): Vec3[] => {
    const out = t.ix.map(i => P[i]!);
    for (let k = 0; k < tris.length; k += 3) if (t.own.has(tris[k]!)) {
      const [a, b, c] = [P[tris[k]!]!, P[tris[k + 1]!]!, P[tris[k + 2]!]!];
      out.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    }
    return out;
  };

  const bound = bindRig(home);
  const grinA = peak(homeDoc, 'grin');
  const grinB = withGape(bound, grinA.jawGape, grinA.morphs), grinBody = applyRig(home, grinB, 0);
  const restP = skin(mesh, bones, home, bound, S);
  const grinP = skin(mesh, bones, home, grinB, S);

  it('the registry lends him the cinematic kit, its `tooth` material only, at the .blob\'s own scale', () => {
    const e = characterEntry('goblin-cinematic-home');
    expect(e.kit).toBe(characterEntry('goblin-cinematic').kit);
    expect(e.kitOnly).toEqual(['tooth']);
    expect(cinDoc.scale ?? 1, 'the kit was built for the unscaled 1.30 m cinematic').toBe(1);
    expect(e.kitScale).toBe(S);
    expect(S).toBeCloseTo(1.3077, 6);
  });

  it('the filtered kit is the teeth alone: one skinned `tooth` mesh, 16 teeth (8 on the skull, 8 on the jaw), nothing else', async () => {
    const whole = await kitScene();
    // ...+ the bony hands (`goblinskin` and `goblinclaw`, scripts/merge-kit-hands.ts), which the filter drops: at home the orbs stay.
    expect(whole.meshes.length, 'the whole kit: 8 armour primitives + the teeth + the hands\' skin and claws').toBe(11);
    expect(meshes.length).toBe(1);
    expect(mesh.isSkinnedMesh).toBe(true);
    expect((mesh.material as THREE.Material).name).toBe('tooth');
    expect(restPos.count).toBe(1819);
    expect(tris.length / 3).toBe(3246);
    expect(teeth.length).toBe(16);
    expect(teeth.filter(t => t.bone === 'skull').length).toBe(8);
    expect(teeth.filter(t => t.bone === 'jaw').length).toBe(8);
  });

  it('poseKitBones: scale 1 is the rigid frame (pos + q * (v - head)); scale s is pos + s * q * (v - head)', () => {
    const inv = mesh.skeleton.boneInverses, bs = mesh.skeleton.bones;
    for (const s of [1, S]) {
      const frames = kitFrames(home, grinB, 0.4);
      poseKitBones(bones, frames, s);
      const v = new THREE.Vector3();
      for (const i of [0, 500, 1000, 1818]) {
        v.fromBufferAttribute(restPos, i);
        mesh.applyBoneTransform(i, v);
        const k = si.getComponent(i, 0), f = frames.get(bs[k]!.name)!;
        const head: Vec3 = [-inv[k]!.elements[12]!, -inv[k]!.elements[13]!, -inv[k]!.elements[14]!];
        const want = add(f.pos, vscale(qRotate(f.quat as Quat, sub([restPos.getX(i), restPos.getY(i), restPos.getZ(i)], head)), s));
        expect(len(sub([v.x, v.y, v.z], want)), `vertex ${i}, scale ${s}`).toBeLessThan(1e-6);
      }
    }
  });

  it('his skeleton is the cinematic\'s times the scale, so the scaled teeth are the 1.30 m teeth scaled about the floor (the jaw\'s hinge aside)', () => {
    for (const name of ['skull', 'jaw', 'neck', 'pelvis']) {
      expect(len(sub(home.bones.get(name)!.head, vscale(cin.bones.get(name)!.head, S))), name).toBeLessThan(1e-5);
    }
    // At rest the posed teeth ARE the cinematic's (the unscaled kit on the 1.30 m body) times S.
    const cb = bindRig(cin), ca = peak(cinDoc, 'grin');
    const off = (hp: Vec3[], cp: Vec3[], ix: (i: number) => boolean) => {
      let worst = 0;
      for (let i = 0; i < cp.length; i++) if (ix(i)) worst = Math.max(worst, len(sub(hp[i]!, vscale(cp[i]!, S))));
      return worst;
    };
    expect(off(restP, skin(mesh, bones, cin, cb, 1), () => true), 'rest: m off the scaled 1.30 m teeth').toBeLessThan(1e-6);
    // At the grin the upper row still is; the LOWER row is 0.45 mm off, because the jaw's hinge is not quite scaled: jaw.ts
    // JAW_HINGE.back puts it an ABSOLUTE 2 cm behind the skull axis (not 2 cm x S), so his lips open about a hinge 6.2 mm forward
    // of the scaled one. kitFrames reads the same hinge his `on jaw` prims open about, so the lower teeth follow HIS lips (the
    // checks below), not the scaled 1.30 m ones.
    const cg = skin(mesh, bones, cin, withGape(cb, ca.jawGape, ca.morphs), 1);
    expect(off(grinP, cg, i => boneName(i) === 'skull'), 'grin, upper row').toBeLessThan(1e-6);
    expect(off(grinP, cg, i => boneName(i) === 'jaw'), 'grin, lower row').toBeLessThan(0.0006);
    expect(bound.head!.jaw!.rest.hinge[2] - S * cb.head!.jaw!.rest.hinge[2], 'the unscaled 2 cm').toBeCloseTo(0.020 * (S - 1), 6);
  });

  it('the teeth sit in his mouth: inside the head, between the lips, and every tooth is buried in the shut mouth\'s flesh at rest', () => {
    // The mouth: the `on jaw` prims (lower lip, chin mass) below, the head's prims around. The rows span the mouth's width.
    const headPrims = home.prims.filter(p => p.bone === 'skull' || p.bone === 'jaw');
    const lo = [0, 1, 2].map(c => Math.min(...headPrims.flatMap(p => [p.a[c]!, p.b[c]!])));
    const hi = [0, 1, 2].map(c => Math.max(...headPrims.flatMap(p => [p.a[c]!, p.b[c]!])));
    const all = teeth.flatMap(t => samples(restP, t));
    for (let c = 0; c < 3; c++) {
      expect(Math.min(...all.map(p => p[c]!)), `axis ${c} low`).toBeGreaterThan(lo[c]!);
      expect(Math.max(...all.map(p => p[c]!)), `axis ${c} high`).toBeLessThan(hi[c]!);
    }
    const jawTop = Math.max(...home.prims.filter(p => p.bone === 'jaw').map(p => Math.max(p.a[1], p.b[1])));
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    expect(Math.min(...xs), 'the row reaches his right corner').toBeLessThan(-0.036 * S);
    expect(Math.max(...xs), 'and his left').toBeGreaterThan(0.036 * S);
    expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - jawTop), 'the rows straddle the lip line').toBeLessThan(0.02 * S);
    let worst = -1;
    for (const t of teeth) for (const p of samples(restP, t)) {
      const d = sdBody(p, home);
      worst = Math.max(worst, d);
      expect(d, `${t.bone} tooth at x ${t.x.toFixed(3)}: (${p.map(v => v.toFixed(4)).join(', ')})`).toBeLessThan(-0.0005);
    }
    expect(worst).toBeLessThan(-0.0005);
  });

  // Seen from the front: some surface point of the tooth is outside the posed flesh and a ray from the camera side (+z) reaches it.
  const showsFromFront = (P: Vec3[], t: Tooth, posedBody: BuildResult) =>
    samples(P, t).some(p => {
      if (sdBody(p, posedBody) < 0.0003) return false;
      let z = 0.3;
      while (z > p[2] + 0.0005) { const d = sdBody([p[0], p[1], z], posedBody); if (d < 0.0002) return false; z -= Math.max(d * 0.8, 0.0002); }
      return true;
    });

  it('the grin (the clip\'s peak, his own expression set) bares every one of the 16 teeth from the front', () => {
    expect(expressionsFor('goblin-cinematic-home')?.clips.grin, 'his library has the grin').toBeDefined();
    expect(grinA.morphs.squash).toBeGreaterThan(0);
    for (const t of teeth) expect(showsFromFront(grinP, t, grinBody), `${t.bone} x ${t.x.toFixed(3)}`).toBe(true);
  });

  // The cinematic test's orthographic render, scaled: the teeth rasterised into a depth buffer, the SDF sphere-traced per pixel, the
  // nearer wins. `poke` counts tooth pixels on camera-facing OUTER skin within 2 mm (x S) behind the tooth: a tooth through a lip.
  const render = (P: Vec3[], posedBody: BuildResult, yaw: number) => {
    const res = 0.001 * S;
    const fwd: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)], right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const X0 = (-0.05 - 0.10 * Math.sin(yaw)) * S, Y1 = 1.16 * S, NX = 100, NY = 60;
    const depth = new Float64Array(NX * NY).fill(-1e9), row = new Uint8Array(NX * NY);
    const proj = (q: Vec3) => [(dot(q, right) - X0) / res, (Y1 - q[1]) / res, dot(q, fwd)];
    for (let k = 0; k < tris.length; k += 3) {
      const [A, B, C] = [P[tris[k]!]!, P[tris[k + 1]!]!, P[tris[k + 2]!]!].map(proj) as number[][];
      const upper = boneName(tris[k]!) === 'skull';
      const den = (B![1]! - C![1]!) * (A![0]! - C![0]!) + (C![0]! - B![0]!) * (A![1]! - C![1]!);
      if (Math.abs(den) < 1e-12) continue;
      for (let y = Math.max(0, Math.floor(Math.min(A![1]!, B![1]!, C![1]!))); y <= Math.min(NY - 1, Math.ceil(Math.max(A![1]!, B![1]!, C![1]!))); y++)
        for (let x = Math.max(0, Math.floor(Math.min(A![0]!, B![0]!, C![0]!))); x <= Math.min(NX - 1, Math.ceil(Math.max(A![0]!, B![0]!, C![0]!))); x++) {
          const w0 = ((B![1]! - C![1]!) * (x + 0.5 - C![0]!) + (C![0]! - B![0]!) * (y + 0.5 - C![1]!)) / den;
          const w1 = ((C![1]! - A![1]!) * (x + 0.5 - C![0]!) + (A![0]! - C![0]!) * (y + 0.5 - C![1]!)) / den;
          if (w0 < 0 || w1 < 0 || 1 - w0 - w1 < 0) continue;
          const z = w0 * A![2]! + w1 * B![2]! + (1 - w0 - w1) * C![2]!;
          if (z > depth[y * NX + x]!) { depth[y * NX + x] = z; row[y * NX + x] = upper ? 1 : 2; }
        }
    }
    const n = { upper: 0, lower: 0, dark: 0, poke: 0 };
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const u = X0 + (x + 0.5) * res, v = Y1 - (y + 0.5) * res, o: Vec3 = [right[0] * u + fwd[0] * 0.3 * S, v, right[2] * u + fwd[2] * 0.3 * S];
      let t = 0, p = o, hit = false;
      for (let k = 0; k < 200 && t < 0.5 * S; k++) { p = [o[0] - fwd[0] * t, v, o[2] - fwd[2] * t]; const d = sdBody(p, posedBody); if (d < 0.0002) { hit = true; break; } t += Math.max(d * 0.9, 0.0002); }
      const sd = hit ? dot(p, fwd) : -1e9, at = y * NX + x;
      if (depth[at]! > sd + 0.0001) {
        if (row[at] === 1) n.upper++; else n.lower++;
        if (hit && depth[at]! - sd < 0.002 * S && posedBody.prims[nearestPrim(p, posedBody)]!.color === undefined) {
          const e = 0.0003, gx = sdBody(add(p, [e, 0, 0]), posedBody) - sdBody(sub(p, [e, 0, 0]), posedBody), gz = sdBody(add(p, [0, 0, e]), posedBody) - sdBody(sub(p, [0, 0, e]), posedBody);
          const gy = sdBody(add(p, [0, e, 0]), posedBody) - sdBody(sub(p, [0, e, 0]), posedBody);
          if ((gx * fwd[0] + gz * fwd[2]) / Math.hypot(gx, gy, gz) > 0.6) n.poke++;
        }
      } else if (hit && posedBody.prims[nearestPrim(p, posedBody)]!.color !== undefined) n.dark++;
    }
    return n;
  };

  it('no tooth through a lip, and the opening mostly teeth: the grin (front, three-quarter), the evil grin and the shout', () => {
    const print = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TEETH_PRINT;
    for (const yaw of [0, 0.785]) {
      const n = render(grinP, grinBody, yaw);
      if (print) console.log(`grin yaw ${yaw}`, n);
      expect(n.poke / Math.max(1, n.upper + n.lower), `grin, yaw ${yaw}: ${JSON.stringify(n)}`).toBeLessThan(0.01);
      if (yaw === 0) expect(n.dark / (n.upper + n.lower + n.dark), `grin: ${JSON.stringify(n)}`).toBeLessThanOrEqual(0.34);
    }
    for (const name of ['evil-grin', 'shout']) {
      const a = peak(homeDoc, name), b = withGape(bound, a.jawGape, a.morphs), pb = applyRig(home, b, 0);
      const n = render(skin(mesh, bones, home, b, S), pb, 0);
      if (print) console.log(name, n);
      expect(n.poke / Math.max(1, n.upper + n.lower), `${name}: ${JSON.stringify(n)}`).toBeLessThan(0.015);
      expect(n.upper + n.lower, `${name}: the teeth are in the window`).toBeGreaterThan(300);
    }
  });
});
