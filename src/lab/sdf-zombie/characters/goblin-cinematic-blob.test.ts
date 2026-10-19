// src/lab/sdf-zombie/characters/goblin-cinematic-blob.test.ts
//
// THE CINEMATIC GOBLIN (goblin expressions Task 13, owner 2026-10-15: "we would have a base goblin without the facial head
// complexity"). goblin-cinematic.blob is the goblin with the FACE RIG: the `jaw` bone and its own hinge, the lower face split at
// the lip line, the teeth and the mouth interior, and the smile morphs. These are the expression pass's tests, moved here from
// goblin-blob.test.ts when the base goblin went back to its pre-expression head (f81e5b10). The first block pins the split
// itself: the variant is the base goblin from the neck down, and the base goblin carries none of the face rig.
import { describe, it, expect } from 'vitest';
import src from './goblin-cinematic.blob?raw';
import baseSrc from './goblin.blob?raw';
import kitJson from '../../../../public/assets/lab/goblin-cinematic-kit.gltf?raw';
import baseKitJson from '../../../../public/assets/lab/goblin-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { nearestPrim, restSpacePoint, sdBody } from '../validate';
import { add, dot, len, lerp, normalize, qFromAxisAngle, qRotate, sub, scale, type Quat } from '../vec';
import type { Vec3 } from '../types';
import { measureProfile, CINEMATIC_PROFILE_PROBES, GOBLIN_PROFILE_PROBES, PROFILE_TOL } from './goblin-head-profile';
import { bindRig, applyRig, kitFrames, morphedRest } from '../rig-bind';
import { boneFrames } from '../rig-frames';
import { jawTargetAt } from '../jaw';
import { makeActorMotion } from '../actor';
import { actuate, expressionAt } from '../expression';
import { compileSheet } from '../blob-compile';
import { GOBLIN_EXPRESSIONS, GOBLIN_EXPRESSION_TUNING } from './goblin-expressions';

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
// The base goblin is scaled to 1.70 m by its `scale 1.3077` line (PR #46, merged with #47); goblin-cinematic is still authored and
// built at 1.30 m, so it is compared with the base goblin's AUTHORED (unscaled) body: the same numbers below the neck.
const baseDoc = { ...parseBlob(baseSrc), scale: null };
const baseBuilt = () => buildBody(compileBlob(baseDoc, compileFace(baseDoc)));

describe('goblin-cinematic is the goblin plus a face rig; the base goblin has none of it', () => {
  it('declares its own model name', () => {
    expect(/^model\s+(\S+)/m.exec(src)?.[1]).toBe('goblin-cinematic');
  });

  it('the base goblin has no jaw bone, no morph words, no head paint, and keeps its ORIGINAL head profile', () => {
    const base = baseBuilt();
    expect(base.errors).toEqual([]);
    expect(base.bones.has('jaw'), 'base goblin: no jaw bone').toBe(false);
    expect(/\bmorph=/.test(baseSrc), 'base goblin: no morph= word').toBe(false);
    expect(/\bhinge=/.test(baseSrc), 'base goblin: no hinge= word').toBe(false);
    expect(base.prims.filter(p => p.morphs).length).toBe(0);
    expect(baseDoc.parts.filter(p => p.limb === 'head' && p.color != null).length, 'no teeth, no mouth interior').toBe(0);
    for (const m of measureProfile(base, GOBLIN_PROFILE_PROBES))
      expect(Math.abs(m.got - m.probe.want), m.probe.name).toBeLessThanOrEqual(PROFILE_TOL);
  });

  it('is the base goblin below the neck: every non-head prim and every bone but the jaw is identical', () => {
    const body = built(), base = baseBuilt();
    expect(body.errors).toEqual([]);
    // `src` is the .blob line number, which the variant's longer header and head block shift.
    const strip = (b: typeof body) => b.prims.filter(p => p.limb !== 'head').map(({ src: _s, ...p }) => p);
    expect(strip(body)).toEqual(strip(base));
    for (const [name, bone] of base.bones) expect(body.bones.get(name), `bone ${name}`).toEqual(bone);
    expect([...body.bones.keys()].filter(n => !base.bones.has(n))).toEqual(['jaw']);
  });

  it('its kit is the goblin kit with bare eyes and mesh teeth: no lens or frame material, the jaw bone carried, the same armour bones', () => {
    type G = { materials: { name: string }[]; nodes: { name?: string }[] };
    const kit = JSON.parse(kitJson) as G, baseKit = JSON.parse(baseKitJson) as G;
    const mats = kit.materials.map(m => m.name);
    expect(mats).not.toContain('glass');
    expect(mats).not.toContain('black');
    // ...plus its own `tooth` (Task 14: the teeth are mesh in this kit).
    expect(mats).toContain('tooth');
    expect(baseKit.materials.map(m => m.name).filter(n => n !== 'glass' && n !== 'black')).toEqual(mats.filter(n => n !== 'tooth'));
    const nodes = kit.nodes.map(n => n.name);
    expect(nodes).toContain('jaw');
    expect(nodes.filter(n => n !== 'jaw')).toEqual(baseKit.nodes.map(n => n.name));
  });

  it('the head paint is only inside the mouth: the dark throat bar and the jaw floor, on the skull or the jaw', () => {
    // The lips stay flesh: the owner rejected painted lips. The 11 teeth are mesh in the kit since Task 14.
    const headPaint = doc.parts.filter(p => p.limb === 'head' && p.color != null);
    expect(headPaint.length, 'head stays flesh but for the mouth interior').toBe(2);
    expect(headPaint.every(p => p.bone === 'skull' || p.bone === 'jaw'), 'mouth paint rides the skull or the jaw').toBe(true);
  });
});

describe('goblin-cinematic head rest profile (expression pass)', () => {
  // Pinned BEFORE the jaw split (see goblin-head-profile.ts), the mouth line re-pinned by Task 3b. The split must leave the
  // approved silhouette where it was.
  it.each(measureProfile(built(), CINEMATIC_PROFILE_PROBES).map(m => [m.probe.name, m] as const))('%s is within 3 mm of the approved head', (_n, m) => {
    expect(Number.isFinite(m.got), 'probe starts inside the flesh and leaves it').toBe(true);
    expect(Math.abs(m.got - m.probe.want)).toBeLessThanOrEqual(PROFILE_TOL);
  });
});

describe('goblin jaw (expression pass)', () => {
  const body = built();

  it('has a jaw bone: a carrier from the skull pivot down and forward to the chin, below the lips', () => {
    const jaw = body.bones.get('jaw');
    expect(jaw, 'bone jaw').toBeDefined();
    const pivot = body.bones.get('skull')!.head;
    expect(jaw!.head).toEqual(pivot);
    expect(jaw!.tail[1]).toBeLessThan(1.10); // under the lower lip (y 1.09-1.129)
    expect(jaw!.tail[2]).toBeGreaterThan(0.07); // forward of the skull axis
  });

  // Task 3b: the shared hinge (jaw.ts JAW_HINGE, 0.30 of the skull: the BRIDE's upper lip) sits 5.6 cm above this face's lip line,
  // so the goblin's jaw swung back into its throat as it opened. Its own `hinge=0.06` puts the hinge at the lip line.
  it('hinges at its own lip line (hinge=0.06), and rig-bind and the motion joints agree', () => {
    const skull = body.bones.get('skull')!;
    expect(body.bones.get('jaw')!.jawHinge).toBe(0.06);
    const bound = bindRig(body);
    const hinge = bound.head!.jaw!.rest.hinge;
    expect(skull.head[1] + hinge[1]).toBeCloseTo(1.1326, 3); // the lip line
    const m = makeActorMotion(body, { seed: 1 });
    m.motionJoints!.jaw!.hinge.forEach((v, k) => expect(v).toBeCloseTo(hinge[k]!, 9));
  });

  it('opening wide drops the lower lip rather than swinging it back into the throat', () => {
    const bound = bindRig(body);
    const lip = body.prims.findIndex(p => p.bone === 'jaw' && p.blendProfile === 'chamfer');
    expect(lip, 'the chamfered lower lip').toBeGreaterThanOrEqual(0);
    const shut = applyRig(body, bound, 0).prims[lip]!;
    const open = applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: 0.5 } }, 0).prims[lip]!;
    const mid = (p: { a: Vec3; b: Vec3 }) => lerp(p.a, p.b, 0.5);
    const drop = mid(shut)[1] - mid(open)[1], back = mid(shut)[2] - mid(open)[2];
    // Measured 2026-10-14: drop 5.1 cm, back 1.7. The shared hinge gave 4.7 and 4.5: as far back as down.
    expect(drop).toBeGreaterThan(0.045);
    expect(back).toBeLessThan(drop * 0.5);
  });

  it('is a named motion joint, so the rig can pin it', () => {
    const m = makeActorMotion(body, { seed: 1 });
    expect(m.motionJoints, 'goblin still builds motion joints').not.toBeNull();
    expect(m.motionJoints!.index.jaw, 'jaw joint index').toBeDefined();
    expect(m.motionJoints!.jaw, 'jaw rest geometry').toBeDefined();
  });

  it('only the `on jaw` prims open (lower lip and chin mass); everything else stays', () => {
    const bound = bindRig(body);
    const shut = applyRig(body, bound, 0);
    const open = applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: 0.15 } }, 0);
    const moved = body.prims.map((_, i) => Math.hypot(
      shut.prims[i]!.a[0] - open.prims[i]!.a[0], shut.prims[i]!.a[1] - open.prims[i]!.a[1], shut.prims[i]!.a[2] - open.prims[i]!.a[2]));
    body.prims.forEach((p, i) => {
      if (p.bone === 'jaw') expect(moved[i], `jaw prim ${i}`).toBeGreaterThan(0.008);
      else expect(moved[i], `${p.bone} prim ${i}`).toBe(0);
    });
    expect(body.prims.filter(p => p.bone === 'jaw').length, 'lower lip + chin mass (+ lower teeth once Task 3 lands)').toBeGreaterThanOrEqual(2);
  });
});

describe('goblin-cinematic mouth interior (SDF) and teeth (MESH in the kit since Task 14)', () => {
  // The SDF teeth (11 prims, `color=e0d8c0 gloss=0.35 glow=0.15`) left the .blob in Task 14; the mouth's inside, a dark throat bar on
  // the skull and a dark floor on the jaw, stays SDF. Found by its paint marker: the bare body is the .blob without those lines.
  const INTERIOR = /color=2a0608/;
  const bodyOf = (text: string) => buildBody(compileBlob(parseBlob(text), compileFace(parseBlob(text))));
  const full = bodyOf(src);
  const bare = bodyOf(src.split('\n').filter(l => !INTERIOR.test(l)).join('\n'));
  const same = (p: { a: Vec3; b: Vec3 }, q: { a: Vec3; b: Vec3 }) =>
    p.a.every((v, k) => Math.abs(v - q.a[k]!) < 1e-9) && p.b.every((v, k) => Math.abs(v - q.b[k]!) < 1e-9);
  const interior = full.prims.filter(p => !bare.prims.some(q => same(p, q)));

  it('the .blob has no teeth any more: the inside is the throat bar (skull) and the floor (jaw), and nothing glows', () => {
    expect(full.errors).toEqual([]);
    expect(interior.map(p => p.bone).sort()).toEqual(['jaw', 'skull']);
    const painted = full.prims.filter(p => p.color !== undefined && (p.bone === 'skull' || p.bone === 'jaw'));
    expect(painted.length, 'the only paint on the skull and the jaw is the inside').toBe(2);
    expect(painted.every(p => p.color![0] < 0.1), 'and it is dark').toBe(true);
    expect(/glow=/.test(src.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')), 'no glow word').toBe(false);
  });

  it('the inside is buried at rest: both ends are inside the rest of the flesh', () => {
    for (const p of interior) {
      expect(sdBody(p.a, bare), `end a of ${p.bone} prim`).toBeLessThan(-0.0005);
      expect(sdBody(p.b, bare), `end b of ${p.bone} prim`).toBeLessThan(-0.0005);
    }
  });

  it('the head profile holds without the SDF teeth', () => {
    for (const m of measureProfile(full, CINEMATIC_PROFILE_PROBES)) expect(Math.abs(m.got - m.probe.want), m.probe.name).toBeLessThanOrEqual(PROFILE_TOL);
  });

  const painters = (gape: number): Set<number> => {
    const bound = bindRig(full);
    const b = gape === 0 ? full : applyRig(full, { ...bound, rig: { ...bound.rig, jawGape: gape } }, 0);
    const hit = new Set<number>();
    for (let x = -0.05; x <= 0.0501; x += 0.001) for (let y = 1.07; y <= 1.15; y += 0.001) {
      let z = 0.16;
      while (z > -0.02) { const d = sdBody([x, y, z], b); if (d < 0.0002) break; z -= Math.max(d * 0.8, 0.0002); }
      if (z > -0.02) hit.add(nearestPrim([x, y, z + 0.0002], b));
    }
    return hit;
  };
  const insideIdx = interior.map(p => full.prims.indexOf(p));

  // Paint goes to the hit's NEAREST prim, so a buried prim can still paint the rest skin (a buried SDF tooth once did).
  it('the inside paints nothing when the jaw is shut, and shows at a 0.3 rad gape', () => {
    const rest = painters(0), open = painters(0.3);
    for (const i of insideIdx) {
      expect(rest.has(i), `prim ${i} (${full.prims[i]!.bone}) paints the rest skin`).toBe(false);
      expect(open.has(i), `prim ${i} (${full.prims[i]!.bone}) never shows`).toBe(true);
    }
  });
});

// THE MESH TEETH (Task 14; sculpted in Blender since Task 17; two rows since Task 20). assets-source/goblin-teeth/goblin_teeth.py
// (run headless) builds 16 teeth, 8 upper on `skull` and 8 lower on `jaw`, laid out where the grin clip's lips put the opening, and
// scripts/merge-kit-teeth.mjs adds them to the compiled kit as one skinned `tooth` primitive with vertex colours. Read from the COMPILED glTF, posed the way the lab poses it: rig-bind `kitFrames`
// (the jaw bone takes the `on jaw` prims' transform) and three's skinning, `frame.pos + frame.quat * (v - kit bone head)` (WAM's
// inverse binds are translations to each bone's rest head).
describe('goblin-cinematic mesh teeth (Tasks 14, 17, 20): the kit\'s teeth follow the SDF face', () => {
  type Acc = { bufferView: number; byteOffset?: number; count: number; type: string; componentType: number };
  const g = JSON.parse(kitJson) as {
    buffers: { uri: string }[]; bufferViews: { byteOffset?: number }[]; accessors: Acc[];
    meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
    materials: { name: string }[]; nodes: { name?: string }[]; skins: { joints: number[]; inverseBindMatrices: number }[];
  };
  const bytes = Uint8Array.from(atob(g.buffers[0]!.uri.split(',', 2)[1]!), c => c.charCodeAt(0));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (i: number): number[][] => {
    const a = g.accessors[i]!, base = (g.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type]!;
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const get = (o: number) => a.componentType === 5126 ? dv.getFloat32(o, true) : size === 4 ? dv.getUint32(o, true)
      : size === 2 ? dv.getUint16(o, true) : dv.getUint8(o);
    return Array.from({ length: a.count }, (_, k) => Array.from({ length: n }, (_, c) => get(base + (k * n + c) * size)));
  };
  const skin = g.skins[0]!;
  const jointName = skin.joints.map(j => g.nodes[j]!.name!);
  // Each joint's bind head: WAM's inverse binds are pure translations (checked below), so the head is minus that translation.
  const ibm = read(skin.inverseBindMatrices);
  const kitHead = new Map(jointName.map((n, k) => [n, [-ibm[k]![12]!, -ibm[k]![13]!, -ibm[k]![14]!] as Vec3]));
  const prim = g.meshes[0]!.primitives.find(p => g.materials[p.material]!.name === 'tooth')!;
  const pos = read(prim.attributes.POSITION!) as unknown as Vec3[];
  const joints = read(prim.attributes.JOINTS_0!), weights = read(prim.attributes.WEIGHTS_0!);
  const tris = read(prim.indices).map(r => r[0]!);
  // One tooth = one connected component of the tooth triangles, vertices at the same point counted as one (a flat-shaded chip face
  // has its own copies of the rim's vertices: glTF splits a vertex wherever its normal does).
  const parent = new Map<number, number>();
  const find = (i: number): number => { let r = i; while (parent.get(r)! !== r) r = parent.get(r)!; return r; };
  for (const i of tris) if (!parent.has(i)) parent.set(i, i);
  for (let t = 0; t < tris.length; t += 3) for (const k of [1, 2]) parent.set(find(tris[t + k]!), find(tris[t]!));
  const atPoint = new Map<string, number>();
  for (const i of new Set(tris)) {
    const key = pos[i]!.map(c => c.toFixed(7)).join(',');
    const j = atPoint.get(key);
    if (j == null) atPoint.set(key, i); else parent.set(find(i), find(j));
  }
  const groups = new Map<number, number[]>();
  for (const i of new Set(tris)) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); }
  const boneOf = (i: number) => jointName[joints[i]![weights[i]!.indexOf(Math.max(...weights[i]!))]!]!;
  const teeth = [...groups.values()].map(ix => ({ bone: boneOf(ix[0]!), ix, rest: ix.map(i => pos[i]!) }))
    .sort((a, b) => a.rest[0]![0] - b.rest[0]![0]);
  // Surface samples: every vertex plus every triangle's centroid, per tooth.
  const samplesOf = (t: (typeof teeth)[number]) => {
    const own = new Set(t.ix), out = [...t.ix.map(i => [i, i, i])];
    for (let k = 0; k < tris.length; k += 3) if (own.has(tris[k]!)) out.push([tris[k]!, tris[k + 1]!, tris[k + 2]!]);
    return out;
  };
  const body = built();
  const bound = bindRig(body);
  /** Where three draws kit vertex v (rest position as stored) of bone `bone`, for frames from kitFrames. */
  const skinned = (frames: Map<string, { pos: Vec3; quat: readonly number[] }>, bone: string, v: Vec3): Vec3 => {
    const f = frames.get(bone)!;
    return add(f.pos, qRotate(f.quat as Quat, sub(v, kitHead.get(bone)!)));
  };
  const posedSamples = (b: typeof bound, t: (typeof teeth)[number], yaw = 0): Vec3[] => {
    const frames = kitFrames(body, b, yaw);
    return samplesOf(t).map(([i, j, k]) => {
      const [p, q, r] = [pos[i!]!, pos[j!]!, pos[k!]!].map(v => skinned(frames, t.bone, v));
      return [(p![0] + q![0] + r![0]) / 3, (p![1] + q![1] + r![1]) / 3, (p![2] + q![2] + r![2]) / 3] as Vec3;
    });
  };
  const withGape = (gape: number, morphs?: Record<string, number>) =>
    ({ ...bound, rig: { ...bound.rig, jawGape: gape, ...(morphs ? { morphs } : {}) } });

  // TASK 20 (owner: "when he grins there's this dark gap ... cartoonishly his teeth would be bigger and take up the space"): two big
  // rows, 8 upper (two fangs) on the skull and 8 lower (two small canines) on the jaw, regenerated headless from goblin_teeth.py.
  it('has 16 teeth: 8 upper rigid on the skull, 8 lower rigid on the jaw; the inverse binds are translations', () => {
    expect(teeth.length).toBe(16);
    expect(teeth.filter(t => t.bone === 'skull').length).toBe(8);
    expect(teeth.filter(t => t.bone === 'jaw').length).toBe(8);
    for (const t of teeth) for (const i of t.ix) expect(Math.max(...weights[i]!), 'one bone, weight 1').toBeCloseTo(1, 6);
    for (const m of ibm) [0, 5, 10, 15].forEach((d, k) => expect(m[d], `ibm diag ${k}`).toBe(1));
    for (const m of ibm) [1, 2, 3, 4, 6, 7, 8, 9, 11].forEach(o => expect(m[o]).toBe(0));
    // The kit's pivot is the .blob's within a tenth of a millimetre (the kit renders at the .blob's rig point regardless).
    expect(len(sub(kitHead.get('jaw')!, body.bones.get('skull')!.head))).toBeLessThan(0.0001);
  });

  // Task 17: SCULPTED, not sweeps. 150-400 triangles a tooth (the plan's budget), a few thousand in all; the colour is in COLOR_0
  // (the material's base colour is white and untextured, so the vertex colour IS the albedo): warm (r > g > b), never clean white,
  // and darker toward the gum than at the crown.
  it('the teeth are sculpted meshes with vertex colour: 150-400 triangles each, warm dirty ivory, stained toward the gum', () => {
    const triCount = new Map(teeth.map(t => [t, 0]));
    const own = new Map(teeth.flatMap(t => t.ix.map(i => [i, t] as const)));
    for (let k = 0; k < tris.length; k += 3) { const t = own.get(tris[k]!)!; triCount.set(t, triCount.get(t)! + 1); }
    for (const [t, n] of triCount) {
      expect(n, `${t.bone} tooth at x ${t.rest[0]![0].toFixed(3)}`).toBeGreaterThanOrEqual(150);
      expect(n).toBeLessThanOrEqual(400);
    }
    expect(tris.length / 3).toBeLessThan(4000); // 3246 (Task 17's 11: 3096)
    const mat = g.materials[prim.material]! as { pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } };
    expect(mat.pbrMetallicRoughness?.baseColorTexture, 'no texture: the colour is per vertex').toBeUndefined();
    expect(mat.pbrMetallicRoughness?.baseColorFactor).toEqual([1, 1, 1, 1]);
    expect(prim.attributes.COLOR_0, 'COLOR_0').toBeDefined();
    const col = read(prim.attributes.COLOR_0!);
    expect(col.length).toBe(pos.length);
    for (const c of col) {
      expect(c[0]! >= c[1]! && c[1]! > c[2]!, `warm: ${c.map(v => v.toFixed(3))}`).toBe(true);
      expect(Math.max(...c), 'never clean white (linear)').toBeLessThan(0.75);
    }
    // per tooth: the mean colour of the third nearest the gum is darker than the third at the crown
    const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    for (const t of teeth) {
      const ys = t.ix.map(i => pos[i]![1]), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo;
      const upper = t.bone === 'skull';
      const gum = t.ix.filter(i => upper ? pos[i]![1] > hi - span / 3 : pos[i]![1] < lo + span / 3);
      const crown = t.ix.filter(i => upper ? pos[i]![1] < lo + span / 3 : pos[i]![1] > hi - span / 3);
      const mean = (ix: number[]) => ix.reduce((m, i) => m + lum(col[i]!), 0) / ix.length;
      expect(mean(gum), `${t.bone} tooth at x ${t.rest[0]![0].toFixed(3)}: gum darker than crown`).toBeLessThan(mean(crown) * 0.8);
    }
  });

  // The grin clip's peak, as the lab plays it (the teeth are laid out for it: goblin_teeth.py THE LAYOUT).
  const grinAct = actuate(expressionAt(GOBLIN_EXPRESSIONS.grin!, 99), compileSheet(doc)!, GOBLIN_EXPRESSION_TUNING);
  const grinBound = withGape(grinAct.jawGape, grinAct.morphs);
  const grinBody = applyRig(body, grinBound, 0);

  it('two rows that span the opening, packed edge to edge, the fangs longest (Task 20 layout)', () => {
    for (const bone of ['skull', 'jaw']) {
      const row = teeth.filter(t => t.bone === bone).map(t => {
        const ps = posedSamples(grinBound, t), xs = ps.map(p => p[0]);
        return { lo: Math.min(...xs), hi: Math.max(...xs), mid: (Math.min(...xs) + Math.max(...xs)) / 2, ys: ps.map(p => p[1]) };
      }).sort((a, b) => a.mid - b.mid);
      // the row runs across the opening (which ends near x +-0.04 at the grin), both sides
      expect(row[0]!.lo, `${bone} row, the goblin's right`).toBeLessThan(-0.036);
      expect(row.at(-1)!.hi, `${bone} row, its left`).toBeGreaterThan(0.036);
      // packed: neighbours' crowns touch or overlap in x (no comb of pegs with gaps between them)
      for (let k = 1; k < row.length; k++) expect(row[k]!.lo - row[k - 1]!.hi, `${bone} gap ${k}`).toBeLessThan(0.0015);
      // big: every tooth at least 7 mm wide
      for (const t of row) expect(t.hi - t.lo, `${bone} tooth at ${t.mid.toFixed(3)}`).toBeGreaterThan(0.007);
      if (bone === 'skull') {
        // the 2nd and 7th of the 8 are the fangs: each reaches at least 3 mm below both its neighbours (the smile line curves up
        // toward the corners, so "longest" is against the neighbours, not the middle incisors)
        const tips = row.map(t => Math.min(...t.ys));
        if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TEETH_PRINT) console.log(row.map(t => `${t.mid.toFixed(4)}: ${t.lo.toFixed(4)}..${t.hi.toFixed(4)} tip ${Math.min(...t.ys).toFixed(4)}`).join('\n'));
        for (const f of [1, 6]) expect(tips[f]!, `fang ${f}`).toBeLessThan(Math.min(tips[f - 1]!, tips[f + 1]!) - 0.003);
      }
    }
  });

  it('every tooth is inside the shut mouth\'s flesh at rest (the SDF\'s depth hides it from any angle)', () => {
    let worst = -1;
    for (const t of teeth) for (const p of posedSamples(bound, t)) {
      const d = sdBody(p, body);
      worst = Math.max(worst, d);
      expect(d, `${t.bone} tooth at x ${t.rest[0]![0].toFixed(3)}: (${p.map(v => v.toFixed(4)).join(', ')})`).toBeLessThan(-0.0005);
    }
    expect(worst).toBeLessThan(-0.0005); // measured -1.7 mm (the outer upper pair)
  });

  // Seen from the front: some surface point of the tooth is outside the posed flesh and a ray from the camera side (+z) reaches it.
  const showsFromFront = (b: typeof bound, t: (typeof teeth)[number], posedBody = applyRig(body, b, 0)) =>
    posedSamples(b, t).some(p => {
      if (sdBody(p, posedBody) < 0.0003) return false;
      let z = 0.2;
      while (z > p[2] + 0.0005) { const d = sdBody([p[0], p[1], z], posedBody); if (d < 0.0002) return false; z -= Math.max(d * 0.8, 0.0002); }
      return true;
    });

  // Task 20: the grin opens with the LIPS (a 0.072 rad gape), and both rows show from the front: every one of the 16 teeth.
  it('the grin (the clip\'s peak: morphs on, the head squashed) bares every tooth of both rows from the front', () => {
    expect(grinAct.morphs.squash).toBeGreaterThan(0);
    for (const t of teeth) expect(showsFromFront(grinBound, t, grinBody), `${t.bone} x ${t.rest[0]![0].toFixed(3)}`).toBe(true);
  });

  it('a wide-open jaw (0.3 rad, no smile) still bares the upper row\'s middle six', () => {
    const open = withGape(0.3), ob = applyRig(body, open, 0);
    const upper = teeth.filter(t => t.bone === 'skull').sort((a, b) => a.rest[0]![0] - b.rest[0]![0]).slice(1, 7);
    for (const t of upper) expect(showsFromFront(open, t, ob), `upper x ${t.rest[0]![0].toFixed(3)}`).toBe(true);
  });

  // A small orthographic render of the posed head WITH the kit's teeth: the teeth rasterised into a depth buffer, the SDF
  // sphere-traced per pixel, the nearer wins (the lab's polygon pass depth-tests against the march exactly so). Classes per pixel:
  // tooth (upper or lower), the dark inside (the painted throat bar and floor), skin. `poke` counts tooth pixels lying on the OUTER
  // skin: skin that faces the camera within 2 mm behind the tooth, i.e. a tooth showing through a lip rather than in the opening.
  const render = (b: typeof bound, posedBody: typeof body, yaw: number, res = 0.001) => {
    const fwd: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)], right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    // the window follows the mouth (x 0, z ~0.10) round as the view turns
    const X0 = -0.05 - 0.10 * Math.sin(yaw), Y1 = 1.16, NX = 100, NY = 60;
    const depth = new Float64Array(NX * NY).fill(-1e9), row = new Uint8Array(NX * NY);
    for (const t of teeth) {
      const f = kitFrames(body, b, 0).get(t.bone)!, h = kitHead.get(t.bone)!;
      const P = (v: Vec3) => { const q = add(f.pos, qRotate(f.quat as Quat, sub(v, h))); return [(dot(q, right) - X0) / res, (Y1 - q[1]) / res, dot(q, fwd)]; };
      for (const [i, j, k] of samplesOf(t).filter(s => s[0] !== s[1])) {
        const [A, B, C] = [pos[i!]!, pos[j!]!, pos[k!]!].map(P) as number[][];
        const den = (B![1]! - C![1]!) * (A![0]! - C![0]!) + (C![0]! - B![0]!) * (A![1]! - C![1]!);
        if (Math.abs(den) < 1e-12) continue;
        for (let y = Math.max(0, Math.floor(Math.min(A![1]!, B![1]!, C![1]!))); y <= Math.min(NY - 1, Math.ceil(Math.max(A![1]!, B![1]!, C![1]!))); y++)
          for (let x = Math.max(0, Math.floor(Math.min(A![0]!, B![0]!, C![0]!))); x <= Math.min(NX - 1, Math.ceil(Math.max(A![0]!, B![0]!, C![0]!))); x++) {
            const w0 = ((B![1]! - C![1]!) * (x + 0.5 - C![0]!) + (C![0]! - B![0]!) * (y + 0.5 - C![1]!)) / den;
            const w1 = ((C![1]! - A![1]!) * (x + 0.5 - C![0]!) + (A![0]! - C![0]!) * (y + 0.5 - C![1]!)) / den;
            if (w0 < 0 || w1 < 0 || 1 - w0 - w1 < 0) continue;
            const z = w0 * A![2]! + w1 * B![2]! + (1 - w0 - w1) * C![2]!;
            if (z > depth[y * NX + x]!) { depth[y * NX + x] = z; row[y * NX + x] = t.bone === 'skull' ? 1 : 2; }
          }
      }
    }
    const n = { upper: 0, lower: 0, dark: 0, poke: 0 };
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
      const u = X0 + (x + 0.5) * res, v = Y1 - (y + 0.5) * res, o: Vec3 = [right[0] * u + fwd[0] * 0.3, v, right[2] * u + fwd[2] * 0.3];
      let t = 0, p = o, hit = false;
      for (let k = 0; k < 200 && t < 0.5; k++) { p = [o[0] - fwd[0] * t, v, o[2] - fwd[2] * t]; const d = sdBody(p, posedBody); if (d < 0.0002) { hit = true; break; } t += Math.max(d * 0.9, 0.0002); }
      const sd = hit ? dot(p, fwd) : -1e9, at = y * NX + x;
      if (depth[at]! > sd + 0.0001) {
        if (row[at] === 1) n.upper++; else n.lower++;
        if (hit && depth[at]! - sd < 0.002 && posedBody.prims[nearestPrim(p, posedBody)]!.color === undefined) {
          const e = 0.0003, gx = sdBody(add(p, [e, 0, 0]), posedBody) - sdBody(sub(p, [e, 0, 0]), posedBody), gz = sdBody(add(p, [0, 0, e]), posedBody) - sdBody(sub(p, [0, 0, e]), posedBody);
          const gy = sdBody(add(p, [0, e, 0]), posedBody) - sdBody(sub(p, [0, e, 0]), posedBody);
          if ((gx * fwd[0] + gz * fwd[2]) / Math.hypot(gx, gy, gz) > 0.6) n.poke++;
        }
      } else if (hit && posedBody.prims[nearestPrim(p, posedBody)]!.color !== undefined) n.dark++;
    }
    return n;
  };

  // THE PIN the plan asks for: the dark shows only as a thin band between the rows (and the gaps between teeth), at most about a
  // third of the opening; both rows are on show. Measured 2026-10-16 (0.4 mm render): dark 0.30, upper 4869 / lower 4800 px; the
  // Task 18 grin: dark 0.38 with the lower row a fifth of the upper's.
  it('the grin\'s opening is mostly teeth: the dark inside is at most a third of it, and both rows show (front)', () => {
    const n = render(grinBound, grinBody, 0);
    const open = n.upper + n.lower + n.dark;
    expect(n.dark / open, JSON.stringify(n)).toBeLessThanOrEqual(0.34);
    expect(n.upper / open).toBeGreaterThan(0.25);
    expect(n.lower / open).toBeGreaterThan(0.25);
  });

  // "Not clipping or whatever" (owner): no tooth shows through a lip or the cheek at any yaw, only in the opening. And the shout,
  // whose wide-open jaw carries the lower row away from the skull's flesh (the outer lower pair sits back and short for it: set
  // flush with its neighbours its crowns came out through the mouth-corner balls; 49-71 skin pixels in the 0.6 mm render).
  it('no tooth lies on the outer skin at the grin (front, three-quarter both sides, profile), the evil grin or the shout', () => {
    for (const yaw of [0, 0.785, -0.785, 1.57]) {
      const n = render(grinBound, grinBody, yaw);
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TEETH_PRINT) console.log(`grin yaw ${yaw}`, n);
      expect(n.poke / Math.max(1, n.upper + n.lower), `grin, yaw ${yaw}: ${JSON.stringify(n)}`).toBeLessThan(0.01);
    }
    for (const name of ['evil-grin', 'shout']) {
      const a = actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), compileSheet(doc)!, GOBLIN_EXPRESSION_TUNING);
      const b = withGape(a.jawGape, a.morphs), pb = applyRig(body, b, 0);
      for (const yaw of [0, 0.785]) {
        const n = render(b, pb, yaw);
        expect(n.poke / Math.max(1, n.upper + n.lower), `${name}, yaw ${yaw}: ${JSON.stringify(n)}`).toBeLessThan(0.015);
        expect(n.upper + n.lower, `${name}, yaw ${yaw}: the teeth are in the window`).toBeGreaterThan(300);
      }
    }
  });

  // THE CATCH (plan Task 14). The SDF `on jaw` prims open about the per-body HINGE by the gape and then turn with the head; a plain
  // bone frame turns its vertices about the bone's HEAD (the skull pivot). kitFrames gives the jaw bone the prims' own transform. A
  // probe prim authored `on jaw` at a lower tooth's rest vertex must land where that vertex is drawn.
  const probeAt = (v: Vec3) => {
    const jawTail = body.bones.get('jaw')!.tail;
    const off = sub(v, jawTail).map(c => c.toFixed(9)).join(',');
    const pbody = bodyOf2(src + `\nbody\n  blob head on jaw at=1.0 r=0.001 blend=0.0002 offset=(${off}) tip=(0,0.0001,0)\n`);
    return { pbody, pi: probeIndex(pbody, v) };
  };
  /** The probe prim: the one 1 mm prim whose root is at v. */
  const probeIndex = (b: typeof body, v: Vec3) => {
    const i = b.prims.findIndex(p => p.radius === 0.001 && len(sub(p.a, v)) < 1e-6);
    expect(i, 'the probe prim').toBeGreaterThanOrEqual(0);
    return i;
  };
  const bodyOf2 = (text: string) => buildBody(compileBlob(parseBlob(text), compileFace(parseBlob(text))));
  /** The rig with the skull TIP moved: the head tilted by `tilt` about `axis` through the pivot (and the whole rig yawed by `yaw`). */
  const turned = (b: typeof bound, axis: Vec3, tilt: number, yaw = 0) => {
    const h = b.head!, pivot = b.rig.points[h.pivot]!.pos, qT = qFromAxisAngle(axis, tilt), qY = qFromAxisAngle([0, 1, 0], yaw);
    const points = b.rig.points.map((p, i) => {
      let q = i === h.tip ? add(pivot, qRotate(qT, sub(p.pos, pivot))) : p.pos;
      if (yaw) q = qRotate(qY, q);
      return { ...p, pos: q };
    });
    return { ...b, rig: { ...b.rig, points } };
  };
  const POSES: [string, (b: typeof bound) => typeof bound, number][] = [
    ['head level', b => b, 0],
    ['head nodded 0.3 rad', b => turned(b, [1, 0, 0], 0.3), 0],
    ['head tilted 0.4 rad sideways', b => turned(b, [0, 0, 1], 0.4), 0],
    ['body turned 1.1 rad, head tilted 0.25', b => turned(b, [1, 0, 0], 0.25, 1.1), 1.1],
    ['head past the cone (0.9 rad nod, clamped to 0.5)', b => turned(b, [1, 0, 0], 0.9), 0],
  ];

  it('a lower tooth vertex lands within 0.5 mm of an SDF prim authored at the same rest point (gapes 0.1, 0.3, 0.5; head turned)', () => {
    const lower = teeth.filter(t => t.bone === 'jaw');
    const rest = kitFrames(body, bound, 0);
    // Every lower tooth's point and one root corner.
    const verts = lower.flatMap(t => {
      const vs = t.rest; const top = vs.reduce((m, v) => v[1] > m[1] ? v : m);
      return [top, vs[0]!];
    });
    let worst = 0;
    for (const v of verts) {
      const restAt = skinned(rest, 'jaw', v);
      const { pbody, pi } = probeAt(restAt);
      const pbound = bindRig(pbody);
      expect(pbound.head!.jaw!.prims.has(pi), 'the probe is an `on jaw` head prim').toBe(true);
      for (const gape of [0.1, 0.3, 0.5]) for (const [name, pose, yaw] of POSES) {
        const sdf = applyRig(pbody, pose({ ...pbound, rig: { ...pbound.rig, jawGape: gape } }), yaw).prims[pi]!.a;
        const kit = skinned(kitFrames(body, pose(withGape(gape)), yaw), 'jaw', v);
        const d = len(sub(kit, sdf));
        worst = Math.max(worst, d);
        expect(d, `gape ${gape}, ${name}`).toBeLessThan(0.0005);
      }
    }
    expect(worst).toBeLessThan(0.0005);
  });

  it('the upper row rides the skull exactly as the face does inside the head\'s cone', () => {
    const upper = teeth.filter(t => t.bone === 'skull');
    const rest = kitFrames(body, bound, 0);
    for (const t of upper) {
      const v = t.rest[0]!, restAt = skinned(rest, 'skull', v);
      const text = src + `\nbody\n  blob head on skull at=0.0 r=0.001 blend=0.0002 offset=(${sub(restAt, body.bones.get('skull')!.head).map(c => c.toFixed(9)).join(',')}) tip=(0,0.0001,0)\n`;
      const pbody = bodyOf2(text), pi = probeIndex(pbody, restAt), pbound = bindRig(pbody);
      for (const [name, pose, yaw] of POSES.slice(0, 4)) {
        const sdf = applyRig(pbody, pose({ ...pbound, rig: { ...pbound.rig, jawGape: 0.3 } }), yaw).prims[pi]!.a;
        const kit = skinned(kitFrames(body, pose(withGape(0.3)), yaw), 'skull', v);
        expect(len(sub(kit, sdf)), name).toBeLessThan(0.0005);
      }
    }
  });

  it('a plain bone frame would NOT have done it (the catch, measured): 1-4 mm off in motion, the full drop in the lab statue', () => {
    const v = teeth.filter(t => t.bone === 'jaw')[0]!.rest[0]!;
    const h = bound.head!, jr = h.jaw!;
    for (const [gape, min] of [[0.1, 0.001], [0.5, 0.003]] as const) {
      const sdf = skinned(kitFrames(body, withGape(gape), 0), 'jaw', v);
      // motion.ts pins the jaw point to jawTargetAt; boneFrames then turns the jaw bone about its HEAD.
      const points = bound.rig.points.map((p, i) => i === jr.point
        ? { ...p, pos: jawTargetAt(jr.rest, bound.rig.points[h.pivot]!.pos, normalize(sub(bound.rig.points[h.tip]!.pos, bound.rig.points[h.pivot]!.pos)), 0, gape) } : p);
      const plain = boneFrames(body, { ...bound, rig: { ...bound.rig, points, jawGape: gape } }, 0);
      expect(len(sub(skinned(plain, 'jaw', v), sdf)), `motion path, gape ${gape}`).toBeGreaterThan(min);
      // The lab's statue path never moves the jaw point at all.
      expect(len(sub(skinned(boneFrames(body, withGape(gape), 0), 'jaw', v), sdf)), `statue, gape ${gape}`).toBeGreaterThan(gape * 0.08);
    }
  });

  it('every body without a jaw gets exactly boneFrames (no other kit can change)', () => {
    const base = baseBuilt(), bb = bindRig(base);
    expect(kitFrames(base, bb, 0.4)).toEqual(boneFrames(base, bb, 0.4));
    // With a jaw, only the jaw's frame differs.
    const k = kitFrames(body, withGape(0.3), 0), p = boneFrames(body, withGape(0.3), 0);
    for (const [name, f] of p) if (name !== 'jaw') expect(k.get(name), name).toEqual(f);
  });
});

describe('goblin face morphs (Task 12: the smile widens the chin, pushes the cheeks and corners, lifts the upper lip)', () => {
  const doc = parseBlob(src);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  // Without every morph: the `morph=` words and the face block's `morph <tag>` lines (Task 15), and the cheek-roll pair (Task 18:
  // the only prims added for an expression, buried at rest).
  const BAND = /^  blob head on skull at=0\.0 r=0\.003 .*\n/m;
  // Task 19: the furrow pair (the inner-brow bulges), the other prims added for an expression, buried at rest.
  const FURROW = /^  blob head on skull at=0\.0 r=0\.0028 .*morph=furrow.*\n/m;
  const stripped = src.replace(BAND, '').replace(FURROW, '').replace(/ morph=\S+/g, '').replace(/^  morph .*\n/gm, '');
  const plainDoc = parseBlob(stripped);
  const plain = buildBody(compileBlob(plainDoc, compileFace(plainDoc)));
  const bound = bindRig(body);
  const grin = (morphs: boolean) => applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: 0.204,
    ...(morphs ? { morphs: { gape: 0.2, smile: 1, browDown: 0.8, lipCurl: 0, lid: 0, squint: 0.8 } } : {}) } }, 0);
  const reachX = (b: typeof body, y: number) => Math.max(...[0.02, 0.04, 0.06, 0.08].map(z => {
    let t = 0; if (sdBody([0, y, z], b) > 0) return 0;
    while (t < 0.2 && sdBody([t, y, z], b) <= 0) t += 0.0005;
    return t;
  }));

  it('morphs existing prims only: the same prims as the .blob without its morph words (and the cheek rolls, the furrow pair)', () => {
    const bare = src.replace(BAND, '').replace(FURROW, '');
    const bandless = buildBody(compileBlob(parseBlob(bare), compileFace(parseBlob(bare))));
    expect(bandless.prims.length).toBe(plain.prims.length);
    expect(body.prims.length, 'Task 18: + the cheek-roll pair; Task 19: + the furrow pair').toBe(plain.prims.length + 4);
    bandless.prims.forEach((p, i) => {
      const { morphs: _m, ...rest } = p;
      expect(rest, `prim ${i}`).toEqual(plain.prims[i]);
    });
    // Which channels move which prims (built prims do not keep facePrims' tags; the two face-block prims are the ones with squint):
    const morphed = body.prims.filter(p => p.morphs);
    const sets = new Map<string, number>();
    for (const p of morphed) { const k = [...new Set(p.morphs!.map(m => m.channel))].sort().join('+'); sets.set(k, (sets.get(k) ?? 0) + 1); }
    expect(Object.fromEntries(sets)).toEqual({
      // chin, the cheek-fill pair, the throat bar, the nose (Task 12-18's smile); Task 21: + the throat fill under the chin, which
      // follows the chin's smile (a new prim, so it is in `plain` too: the prim count above is unchanged)
      smile: 6,
      // Task 20: the lower lip and the floor also part on a wide gape (the shout bares the lower row: the lip drops 15 mm and comes
      // 10 mm forward of the teeth, the floor drops behind them)
      'gape+smile': 2,
      // Task 20: the upper ridge and the upper lip lift a little on a wide gape, and curl off the fangs on the evil grin's sneer
      'gape+smile+sneer': 2,
      // Task 20: the mouth-corner pair and the cheek-roll pair hike on the sneer
      'smile+sneer': 4,
      // Task 15: the face block's cheek mass (smile since Task 18); its brow ridge (browDown one-sided twice, Task 16; furrow, Task 19)
      'smile+squint': 1,
      'browDown+furrow+squint': 1,
      // Task 19: the inner-brow bulge pair
      furrow: 2,
    });
    expect(morphed.length).toBe(18);
  });

  it('weights 0 pose exactly as the body without any morph (rest, and the jaw open)', () => {
    const plainBound = bindRig(plain);
    for (const gape of [0, 0.3]) {
      const zero = applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: gape,
        morphs: { gape: 0, smile: 0, browDown: 0, lipCurl: 0, lid: 0, squint: 0, squash: 0, furrow: 0, sneer: 0 } } }, 0);
      // The cheek rolls (Task 18) and the furrow pair (Task 19) are extra prims: compare the rest without them.
      const none = applyRig(plain, { ...plainBound, rig: { ...plainBound.rig, jawGape: gape } }, 0);
      const bare = applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: gape } }, 0);
      expect(zero).toEqual(bare);
      const rolls = new Set(body.prims.map((p, i) => [p, i] as const)
        .filter(([p]) => p.radius === 0.003 || p.morphs?.every(m => m.channel === 'furrow')).map(([, i]) => i));
      expect(rolls.size).toBe(4);
      // (`src` is the .blob line, which the rolls' line shifts.)
      zero.prims.filter((_p, i) => !rolls.has(i)).forEach((p, i) => {
        const { morphs: _m, src: _s, ...rest } = p;
        const { src: _t, ...want } = none.prims[i]!;
        expect(rest, `prim ${i}`).toEqual(want);
      });
    }
  });

  // Task 15 (owner: "the eyes would have to get smaller with the cheeks and eyelids closing more"). The cheek mass under the eyes is
  // the face block's jaw ellipsoid; on squint it rises and fills. Measured as the face's front (z) at heights under the eye.
  const frontZ = (b: typeof body, x: number, y: number) => {
    let z = 0.25; while (z > 0 && sdBody([x, y, z], b) > 0) z -= 0.0002; return z;
  };
  const posed = (m?: Record<string, number>) => applyRig(body, { ...bound, rig: { ...bound.rig, ...(m ? { morphs: m } : {}) } }, 0);

  it('squint 1 raises the cheek mass under the eyes: the face comes forward 5 mm or more at y 1.17-1.19', () => {
    const rest = posed(), sq = posed({ squint: 1 });
    for (const x of [0.02, 0.035, 0.05]) for (const y of [1.17, 1.19])
      expect(frontZ(sq, x, y) - frontZ(rest, x, y), `x ${x} y ${y}`).toBeGreaterThan(0.0045);
  });

  // Task 15: the grin's width is the smile morphs' now (its jaw barely opens). The mouth = the lower lip bar, end to end.
  it('the grin\'s mouth is at least 20% wider than the neutral\'s (the lower lip, end to end, outer edges)', () => {
    const li = body.prims.findIndex(p => p.bone === 'jaw' && p.bend !== undefined && !p.color);
    const width = (b: typeof body) => { const p = b.prims[li]!; return Math.abs(p.b[0] - p.a[0]) + 2 * p.radius; };
    const rest = width(posed()), g = width(grin(true));
    expect(g / rest).toBeGreaterThan(1.2); // measured 0.0720 -> 0.1036 m (x1.44)
  });

  it('browDown brings the brow ridge down: the face under it fills forward at y 1.26', () => {
    const rest = posed(), bd = posed({ browDown: 1 });
    for (const x of [0.02, 0.035, 0.05]) expect(frontZ(bd, x, 1.26) - frontZ(rest, x, 1.26), `x ${x}`).toBeGreaterThan(0.0025);
  });

  // TASK 16 (owner: "although his 'eye brows' move his actual brow shape doesnt"). The ridge over the eyes is the face block's
  // generated `brow` prim; its morph line now knits it into a V on browDown (lower, forward, the middle dipping toward the nose)
  // and lifts it on browDown -1 (surprise). The ridge line = the height where the face is furthest forward over the eye.
  // Sphere-traced front (the field is Lipschitz-bounded), so the 200-height scan stays cheap.
  const traceZ = (b: typeof body, x: number, y: number) => {
    let z = 0.25; for (let k = 0; k < 200 && z > 0; k++) { const d = sdBody([x, y, z], b); if (d < 0.0001) break; z -= Math.max(d * 0.9, 0.0001); }
    return z;
  };
  const ridgeY = (b: typeof body, x: number) => {
    let best = { y: 0, z: -1 };
    for (let y = 1.22; y < 1.32; y += 0.0005) { const z = traceZ(b, x, y); if (z > best.z) best = { y, z }; }
    return best;
  };
  it('the brow ridge follows browDown: it travels 6 mm or more in height between surprise (-1) and the scowl (+1)', () => {
    for (const x of [0.015, 0.03, 0.045]) {
      const up = ridgeY(posed({ browDown: -1 }), x), rest = ridgeY(posed(), x), down = ridgeY(posed({ browDown: 1 }), x);
      if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.RIDGE_PRINT) console.log(`x ${x}: up ${up.y.toFixed(4)}/${up.z.toFixed(4)} rest ${rest.y.toFixed(4)}/${rest.z.toFixed(4)} down ${down.y.toFixed(4)}/${down.z.toFixed(4)}`);
      // measured (sphere-traced): travel 19 / 15 / 11.5 mm at x 0.015 / 0.03 / 0.045 (Task 15's linear 3 mm a unit gave about 6);
      // browDown 1 lowers it 15 / 11 / 7.5 mm and brings it 6 / 5.6 / 5.4 mm forward; surprise lifts it 4 mm
      expect(up.y - down.y, `x ${x}: travel`).toBeGreaterThan(0.010);
      expect(up.y, `x ${x}: surprise lifts it`).toBeGreaterThan(rest.y + 0.002);
      expect(down.y, `x ${x}: browDown lowers it`).toBeLessThan(rest.y - 0.006);
      // and pushes it forward into an overhang
      expect(down.z, `x ${x}: browDown pushes it forward`).toBeGreaterThan(rest.z + 0.003);
    }
    // The V: on browDown the middle (by the nose) drops further than the outer end.
    const rest = posed(), down = posed({ browDown: 1 });
    expect(ridgeY(rest, 0.015).y - ridgeY(down, 0.015).y).toBeGreaterThan(ridgeY(rest, 0.045).y - ridgeY(down, 0.045).y + 0.002);
  });

  // TASK 16: the skin noise (normal bump, grain, mottle) is anchored in each surface point's DOMINANT prim's rest frame. Against the
  // bare rest body a morphed prim's frame is off by its move, so the noise jumped where the dominant prim changed: a thin dark
  // seam traced the dropped brow ridge and the grin's corners on screen (not in the field). rig-bind morphedRest moves the morphed
  // prims' rest endpoints with them; with the head unturned and the jaw shut, every surface point then maps to itself.
  it('the noise anchor has no seam at a morphed prim\'s edge: with morphedRest every face point maps to itself (statue, jaw shut)', () => {
    const w = { browDown: 1, squint: 0.8, smile: 1 };
    const b = posed(w), restM = morphedRest(body, w);
    let worstMorphed = 0, worstBare = 0;
    for (let x = 0; x <= 0.06; x += 0.006) for (let y = 1.1; y <= 1.29; y += 0.006) {
      const z = frontZ(b, x, y); if (z <= 0) continue;
      const p: Vec3 = [x, y, z];
      worstMorphed = Math.max(worstMorphed, len(sub(restSpacePoint(p, b, restM), p)));
      worstBare = Math.max(worstBare, len(sub(restSpacePoint(p, b, body), p)));
    }
    expect(worstBare, 'the bare rest is off by the morphs\' moves (the seam)').toBeGreaterThan(0.005);
    expect(worstMorphed).toBeLessThan(1e-6);
    expect(morphedRest(body, {}), 'no weights: the rest body itself').toBe(body);
    expect(morphedRest(body, undefined)).toBe(body);
  });

  // TASK 16 (owner's screenshot 2: "some weird shape stuff happening in the grin"): the mouth corner pair and the cheek fill are
  // small balls on a smile; pushed out they stood off the face as a knob at the corner and a separate round bump on the cheek.
  // Their smile morphs now MELT them (blend*k), so they read as the corner and the cheek pushing up, not as balls.
  it('the smile melts the mouth corners and the cheek fill into the face (their blend at least 2.5x at the grin)', () => {
    const g = grin(true);
    const corners = body.prims.map((p, i) => [p, i] as const).filter(([p]) => p.bone === 'jaw' && p.radius === 0.010 && !p.bend && p.morphs);
    const cheeks = body.prims.map((p, i) => [p, i] as const).filter(([p]) => p.bone === 'skull' && p.radius === 0.012 && p.morphs && !p.color);
    expect(corners.length).toBe(2);
    expect(cheeks.length).toBe(2);
    for (const [p, i] of [...corners, ...cheeks]) expect(g.prims[i]!.blendK / p.blendK, `prim ${i}`).toBeGreaterThanOrEqual(2.5);
  });

  // TASK 20 (owner: "there's something a little too chipmunky about his overall grin"): the chin no longer balloons on the smile.
  // Task 12 widened it on the owner's "his chins n stuff should get wider" (+9.5 / +9.0 mm a side at y 1.10 / 1.11 after the Task 18
  // corner fix, +14.5 / +18.5 before it, pinned over 7 mm); with the cheek fill's puff and the squash's widening, that wide round
  // lower face was most of the chipmunk. Now the chin is 10% wider on the smile (was 15%) and drops 4 mm under the lower lip, which
  // goes down to bare the lower row: measured +1.5 mm a side at y 1.10 and -4 mm at y 1.11 (where the lower lip used to bulge out
  // over the chin it now sits lower and further in), no wider anywhere there than 4 mm.
  it('the grin keeps the lower face its own width at the chin (no chipmunk jowls): within -5..+4 mm a side at y 1.10-1.11', () => {
    const on = grin(true), off = grin(false);
    for (const y of [1.10, 1.11]) {
      const d = reachX(on, y) - reachX(off, y);
      expect(d, `y ${y}`).toBeLessThan(0.004);
      expect(d, `y ${y}`).toBeGreaterThan(-0.005);
    }
  });
  // 'The grin still bares every upper tooth' is a mesh-teeth test now (Task 14, the block above).
});

// TASK 18 (owner on PR #48: "make his face distort more, like when he grins it should be a bit cartoonish and exaggerated", with a
// 3D emoji evil grin as the look reference): harder smile morphs, a cheek-roll pair along the nasolabial line, and the head
// squash (squash.ts). Measured at the grin CLIP's peak, as the lab plays it.
describe('the cartoon grin (Task 18): a crescent mouth, cheek rolls, the head squashed', () => {
  const body = built();
  const bound = bindRig(body);
  const peak = (name: string) => actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), compileSheet(doc)!, GOBLIN_EXPRESSION_TUNING);
  const at = (name: string) => { const a = peak(name); return { ...bound, rig: { ...bound.rig, jawGape: a.jawGape, morphs: a.morphs } }; };
  const rest = applyRig(body, bound, 0), grin = applyRig(body, at('grin'), 0);
  const lip = body.prims.findIndex(p => p.bone === 'jaw' && p.bend !== undefined && !p.color);
  const rolls = body.prims.map((p, i) => [p, i] as const).filter(([p]) => p.radius === 0.003 && p.bone === 'skull').map(([, i]) => i);
  const halfWidth = (b: typeof body, y: number) => Math.max(...[0, 0.02, 0.04, 0.06].map(z => {
    let t = 0; if (sdBody([0, y, z], b) > 0) return 0;
    while (t < 0.25 && sdBody([t, y, z], b) <= 0) t += 0.0005;
    return t;
  }));

  it('the grin\'s mouth (the lower lip, end to end, outer edges) is at least 1.8x the neutral\'s', () => {
    const width = (b: typeof body) => { const p = b.prims[lip]!; return Math.abs(p.b[0] - p.a[0]) + 2 * p.radius * p.scale[0]; };
    expect(width(grin) / width(rest)).toBeGreaterThanOrEqual(1.8); // measured 0.0720 -> 0.1653 m (x2.30; x2.84 before the corner fix pulled the lip's ends in off the face's side)
  });

  it('the corners (the lower lip\'s ends) ride at least 15 mm higher than at rest, gape and all', () => {
    for (const k of ['a', 'b'] as const) expect(grin.prims[lip]![k][1] - rest.prims[lip]![k][1], k).toBeGreaterThan(0.015); // 35.5 mm
  });

  // Task 20 (the chipmunk): the grin squashes half as hard (squash 1 -> 0.5: 7.5% wider, 4% shorter), so the lower face no longer
  // spreads into jowls; the head still widens as it grins (it was pinned at 10%, measured 15%).
  it('the head is at least 6% wider at the grin\'s peak (the cranium, above the cheeks and below the ears)', () => {
    for (const y of [1.19, 1.2, 1.21]) {
      expect(halfWidth(grin, y) / halfWidth(rest, y), `y ${y}`).toBeGreaterThanOrEqual(1.06); // x1.07
      expect(halfWidth(grin, y) / halfWidth(rest, y), `y ${y}: not the old chipmunk squash`).toBeLessThan(1.1);
    }
  });

  it('surprise stretches it instead: narrower and taller', () => {
    const s = applyRig(body, at('surprise'), 0);
    expect(halfWidth(s, 1.2)).toBeLessThan(halfWidth(rest, 1.2) * 0.95);
    const top = (b: typeof body) => { let y = 1.25; while (sdBody([0, y, 0], b) <= 0) y += 0.0005; return y; };
    expect(top(s)).toBeGreaterThan(top(rest) + 0.003);
  });

  it('the cheek rolls are buried at rest (a millimetre or more inside the rest of the flesh) and come out on the smile', () => {
    expect(rolls.length).toBe(2);
    const bandless = buildBody(compileBlob(parseBlob(src.replace(/^  blob head on skull at=0\.0 r=0\.003 .*\n/m, '')),
      compileFace(parseBlob(src.replace(/^  blob head on skull at=0\.0 r=0\.003 .*\n/m, '')))));
    for (const i of rolls) {
      const p = body.prims[i]!;
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, mid = scale(add(p.a, p.b), 0.5), c = add(mid, p.bend!);
        const q = add(add(scale(p.a, (1 - t) ** 2), scale(c, 2 * t * (1 - t))), scale(p.b, t * t));
        expect(sdBody(q, bandless) + p.radius, `roll ${i} t ${t}`).toBeLessThan(-0.001);
      }
      // At the grin it is 1.7x as thick (toned down from 4.5: owner, "too puffy ... those jowls"; from 2.4 in Task 20, the chipmunk:
      // the crease stays, the puff goes) and stands proud of the face it was buried in SOMEWHERE along its length: the roll tucks
      // under the cheek fill at its nose end, so probe the curve.
      const g = grin.prims[i]!;
      expect(g.radius / p.radius).toBeGreaterThanOrEqual(1.7);
      expect(g.radius / p.radius).toBeLessThan(2);
      const gc = add(scale(add(g.a, g.b), 0.5), g.bend!);
      const shows = Array.from({ length: 11 }, (_, k) => k / 10).some(t => {
        const q = add(add(scale(g.a, (1 - t) ** 2), scale(gc, 2 * t * (1 - t))), scale(g.b, t * t));
        return nearestPrim(add(q, [0, 0, g.radius * 0.9]), grin) === i;
      });
      expect(shows, 'the roll is the surface in front of it somewhere along its length').toBe(true);
    }
  });

  it('the noise anchor follows the squash too: every face point maps to itself at the grin (statue, jaw shut)', () => {
    const w = { ...peak('grin').morphs, gape: 0 };
    const b = applyRig(body, { ...bound, rig: { ...bound.rig, morphs: w } }, 0), restM = morphedRest(body, w, bound.head);
    let worst = 0, bare = 0;
    for (let x = 0; x <= 0.06; x += 0.012) for (let y = 1.1; y <= 1.29; y += 0.012) {
      let z = 0.25; while (z > 0 && sdBody([x, y, z], b) > 0) z -= 0.0005; if (z <= 0) continue;
      const p: Vec3 = [x, y, z];
      worst = Math.max(worst, len(sub(restSpacePoint(p, b, restM), p)));
      bare = Math.max(bare, len(sub(restSpacePoint(p, b, morphedRest(body, { ...w, squash: 0 }, bound.head)), p)));
    }
    expect(bare, 'without the squash in the anchor it is off by the squash').toBeGreaterThan(0.004);
    expect(worst).toBeLessThan(1e-6);
  });
});

// TASK 19 (owner on PR #48: "a variant like an 'evil grin' where the brows angle more inward to produce a furrow"): the `furrow`
// channel. The brow ridge's V is pulled deeper (its face-block morph line) and a pair of inner-brow bulges, buried at rest, comes
// forward on top of the dropped ridge with a crease between them at the midline. Measured at the evil-grin CLIP's peak.
describe('the furrow (Task 19): the evil grin knits its brows', () => {
  const body = built();
  const bound = bindRig(body);
  const peak = (name: string) => actuate(expressionAt(GOBLIN_EXPRESSIONS[name]!, 99), compileSheet(doc)!, GOBLIN_EXPRESSION_TUNING);
  const at = (morphs: Record<string, number>, gape: number) => applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: gape, morphs } }, 0);
  const evilPeak = peak('evil-grin');
  const evil = at(evilPeak.morphs, evilPeak.jawGape);
  const unknit = at({ ...evilPeak.morphs, furrow: 0 }, evilPeak.jawGape);
  const pair = body.prims.map((p, i) => [p, i] as const).filter(([p]) => p.morphs?.every(m => m.channel === 'furrow')).map(([, i]) => i);
  const traceZ = (b: typeof body, x: number, y: number) => {
    let z = 0.25; for (let k = 0; k < 300 && z > 0; k++) { const d = sdBody([x, y, z], b); if (d < 0.00005) break; z -= Math.max(d * 0.9, 0.00005); }
    return z;
  };
  const PRINT = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.FURROW_PRINT;

  it('is one mirrored pair on the skull, buried at rest (a millimetre or more inside the rest of the flesh)', () => {
    expect(pair.length).toBe(2);
    const without = src.replace(/^  blob head on skull at=0\.0 r=0\.0028 .*morph=furrow.*\n/m, '');
    const bare = buildBody(compileBlob(parseBlob(without), compileFace(parseBlob(without))));
    for (const i of pair) {
      const p = body.prims[i]!;
      expect(p.bone).toBe('skull');
      for (let k = 0; k <= 10; k++) {
        const q = lerp(p.a, p.b, k / 10);
        expect(sdBody(q, bare) + p.radius, `prim ${i} t ${k / 10}`).toBeLessThan(-0.001);
      }
    }
  });

  it('at the evil grin the pair is the surface in front of the glabella, and a crease runs down the midline between them', () => {
    for (const i of pair) {
      const g = evil.prims[i]!, mid = scale(add(g.a, g.b), 0.5);
      expect(nearestPrim([mid[0], mid[1], traceZ(evil, mid[0], mid[1])], evil), `prim ${i}`).toBe(i);
    }
    // The crease: the face's front at the midline sits well behind the bulges either side of it (sphere-traced, posed).
    for (const y of [1.2475, 1.25, 1.2525]) {
      const mid = traceZ(evil, 0, y), side = Math.max(traceZ(evil, 0.011, y), traceZ(evil, -0.011, y));
      if (PRINT) console.log(`y ${y}: midline ${(mid * 1000).toFixed(1)} side ${(side * 1000).toFixed(1)}`);
      expect(side - mid, `y ${y}`).toBeGreaterThan(0.0025);
    }
  });

  it('the furrow pulls the brow ridge\'s V deeper: the inner brow comes lower and forward (the brows angle more inward)', () => {
    const ridge = (b: typeof body, x: number) => {
      let best = { y: 0, z: -1 };
      for (let y = 1.22; y < 1.30; y += 0.0005) { const z = traceZ(b, x, y); if (z > best.z) best = { y, z }; }
      return best;
    };
    const inner = 0.024, outer = 0.045;
    const ki = ridge(evil, inner), ui = ridge(unknit, inner), ko = ridge(evil, outer), uo = ridge(unknit, outer);
    if (PRINT) console.log(`inner ${ui.y.toFixed(4)}/${ui.z.toFixed(4)} -> ${ki.y.toFixed(4)}/${ki.z.toFixed(4)}; outer ${uo.y.toFixed(4)} -> ${ko.y.toFixed(4)}`);
    expect(ki.y, 'inner end lower').toBeLessThan(ui.y - 0.002);
    expect(ui.y - ki.y, 'more at the inner end than the outer').toBeGreaterThan(uo.y - ko.y);
  });

  it('the grin (no furrow) poses exactly as before Task 19: the pair stays buried and nothing else moves', () => {
    const g = peak('grin');
    expect(g.morphs.furrow).toBe(0);
    const posed = at(g.morphs, g.jawGape);
    const without = src.replace(/^  blob head on skull at=0\.0 r=0\.0028 .*morph=furrow.*\n/m, '').replace(/ furrow:\S+/, '');
    const wb = buildBody(compileBlob(parseBlob(without), compileFace(parseBlob(without))));
    const wposed = applyRig(wb, { ...bindRig(wb), rig: { ...bindRig(wb).rig, jawGape: g.jawGape, morphs: g.morphs } }, 0);
    const keep = posed.prims.filter((_p, i) => !pair.includes(i));
    expect(keep.length).toBe(wposed.prims.length);
    keep.forEach((p, i) => {
      const { morphs: _m, src: _s, ...rest } = p;
      const { morphs: _n, src: _t, ...want } = wposed.prims[i]!;
      expect(rest, `prim ${i}`).toEqual(want);
    });
  });
});
