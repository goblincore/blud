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

const doc = parseBlob(src);
const built = () => buildBody(compileBlob(doc, compileFace(doc)));
const baseDoc = parseBlob(baseSrc);
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

// THE MESH TEETH (Task 14). goblin-cinematic-kit.wam's TEETH block: 7 upper sweeps skinned to `skull`, 4 lower to `jaw`, at the SDF
// teeth's old roots and tips. Read from the COMPILED glTF, posed the way the lab poses it: rig-bind `kitFrames` (the jaw bone takes
// the `on jaw` prims' transform) and three's skinning, `frame.pos + frame.quat * (v - kit bone head)` (WAM's inverse binds are
// translations to each bone's rest head).
describe('goblin-cinematic mesh teeth (Task 14): the kit\'s teeth follow the SDF face', () => {
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
  // One tooth = one connected component of the tooth triangles.
  const parent = new Map<number, number>();
  const find = (i: number): number => { let r = i; while (parent.get(r)! !== r) r = parent.get(r)!; return r; };
  for (const i of tris) if (!parent.has(i)) parent.set(i, i);
  for (let t = 0; t < tris.length; t += 3) for (const k of [1, 2]) parent.set(find(tris[t + k]!), find(tris[t]!));
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

  it('has 11 teeth: 7 upper rigid on the skull, 4 lower rigid on the jaw, near-white; the inverse binds are translations', () => {
    expect(teeth.length).toBe(11);
    expect(teeth.filter(t => t.bone === 'skull').length).toBe(7);
    expect(teeth.filter(t => t.bone === 'jaw').length).toBe(4);
    for (const t of teeth) for (const i of t.ix) expect(Math.max(...weights[i]!), 'one bone, weight 1').toBeCloseTo(1, 6);
    for (const m of ibm) [0, 5, 10, 15].forEach((d, k) => expect(m[d], `ibm diag ${k}`).toBe(1));
    for (const m of ibm) [1, 2, 3, 4, 6, 7, 8, 9, 11].forEach(o => expect(m[o]).toBe(0));
    // The kit's pivot is the .blob's within a tenth of a millimetre (the kit renders at the .blob's rig point regardless).
    expect(len(sub(kitHead.get('jaw')!, body.bones.get('skull')!.head))).toBeLessThan(0.0001);
  });

  // The SDF teeth these replace (goblin-cinematic.blob at 7587c2a0, resolved): root `a`, tip `b`, root radius. Each mesh tooth is
  // a cone from `a` along a->b, as long as the prim plus its 1 mm rounded end.
  const SDF_TEETH: [Vec3, Vec3, number][] = [
    [[-0.031, 1.1370, 0.0950], [-0.031, 1.1240, 0.0980], 0.005],
    [[-0.021, 1.1380, 0.0990], [-0.021, 1.1110, 0.1040], 0.0068],
    [[-0.011, 1.1380, 0.1020], [-0.011, 1.1210, 0.1060], 0.0055],
    [[-0.001, 1.1380, 0.1030], [-0.001, 1.1230, 0.1070], 0.005],
    [[0.010, 1.1380, 0.1020], [0.010, 1.1190, 0.1060], 0.0055],
    [[0.021, 1.1380, 0.0990], [0.021, 1.1130, 0.1040], 0.0068],
    [[0.031, 1.1370, 0.0950], [0.031, 1.1250, 0.0980], 0.005],
    [[-0.026, 1.1210, 0.0851], [-0.026, 1.1380, 0.0901], 0.0048],
    [[-0.009, 1.1220, 0.0901], [-0.009, 1.1410, 0.0951], 0.0058],
    [[0.011, 1.1220, 0.0901], [0.011, 1.1390, 0.0951], 0.0052],
    [[0.027, 1.1210, 0.0851], [0.027, 1.1390, 0.0901], 0.0048],
  ];
  it('keeps the SDF teeth\'s layout: each root, point and radius within a millimetre (fangs the 2nd and 6th upper)', () => {
    const rest = kitFrames(body, bound, 0);
    for (const [a, b, r] of SDF_TEETH) {
      const dir = normalize(sub(b, a)), apex = add(b, scale(dir, 0.001));
      // The tooth whose point is nearest this prim's: its point within a millimetre.
      const pointOf = (t: (typeof teeth)[number]) => {
        const vs = t.rest.map(v => skinned(rest, t.bone, v));
        return vs.reduce((m, v) => dot(sub(v, a), dir) > dot(sub(m, a), dir) ? v : m);
      };
      const t = teeth.reduce((m, t) => len(sub(pointOf(t), apex)) < len(sub(pointOf(m), apex)) ? t : m);
      expect(len(sub(pointOf(t), apex)), `point of the tooth at x ${a[0]}`).toBeLessThan(0.001);
      expect(t.bone, `bone of the tooth at x ${a[0]}`).toBe(a[1] > 1.13 ? 'skull' : 'jaw');
      const vs = t.rest.map(v => skinned(rest, t.bone, v));
      // The root ring: the vertices at the root, r out from the axis (a polygon's corners sit ON the circle).
      const root = vs.filter(v => Math.abs(dot(sub(v, a), dir)) < 1e-4 && len(sub(v, a)) > 1e-4);
      expect(root.length, `root ring at x ${a[0]}`).toBeGreaterThanOrEqual(6);
      for (const v of root) expect(Math.abs(len(sub(v, a)) - r), `root radius at x ${a[0]}`).toBeLessThan(0.0005);
    }
    const len3 = (i: number) => teeth.filter(t => t.bone === 'skull')[i]!.rest.reduce((m, v) => Math.min(m, v[1]), 9);
    const tips = [0, 1, 2, 3, 4, 5, 6].map(len3);
    expect(Math.min(tips[1]!, tips[5]!), 'the fangs reach lowest').toBeLessThan(Math.min(...tips.filter((_, i) => i !== 1 && i !== 5)) - 0.004);
  });

  it('every tooth is inside the shut mouth\'s flesh at rest (the SDF\'s depth hides it from any angle)', () => {
    let worst = -1;
    for (const t of teeth) for (const p of posedSamples(bound, t)) {
      const d = sdBody(p, body);
      worst = Math.max(worst, d);
      expect(d, `${t.bone} tooth at x ${t.rest[0]![0].toFixed(3)}: (${p.map(v => v.toFixed(4)).join(', ')})`).toBeLessThan(-0.0005);
    }
    expect(worst).toBeLessThan(-0.0005);
  });

  // Seen from the front: some surface point of the tooth is outside the posed flesh and a ray from the camera side (+z) reaches it.
  const showsFromFront = (b: typeof bound, t: (typeof teeth)[number], posedBody = applyRig(body, b, 0)) =>
    posedSamples(b, t).some(p => {
      if (sdBody(p, posedBody) < 0.0003) return false;
      let z = 0.2;
      while (z > p[2] + 0.0005) { const d = sdBody([p[0], p[1], z], posedBody); if (d < 0.0002) return false; z -= Math.max(d * 0.8, 0.0002); }
      return true;
    });

  it('bares every upper tooth at the grin gape (0.15 rad), and every tooth at 0.3', () => {
    for (const t of teeth.filter(t => t.bone === 'skull')) expect(showsFromFront(withGape(0.15), t), `upper x ${t.rest[0]![0].toFixed(3)}`).toBe(true);
    for (const t of teeth) expect(showsFromFront(withGape(0.3), t), `${t.bone} x ${t.rest[0]![0].toFixed(3)}`).toBe(true);
  });

  // Task 15: the grin's jaw barely opens (0.12 rad); the lips' lift and the corners' pull show the teeth.
  it('the grin (morphs on, gape 0.12) still bares every upper tooth', () => {
    const grin = withGape(0.12, { gape: 0.2, smile: 1, browDown: 0.8, lipCurl: 0, lid: 0, squint: 0.8 });
    for (const t of teeth.filter(t => t.bone === 'skull')) expect(showsFromFront(grin, t), `upper x ${t.rest[0]![0].toFixed(3)}`).toBe(true);
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
  // Without every morph: the `morph=` words and the face block's `morph <tag>` lines (Task 15).
  const stripped = src.replace(/ morph=\S+/g, '').replace(/^  morph .*\n/gm, '');
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

  it('morphs existing prims only, on the smile alone: the same prims as the .blob without its morph words', () => {
    expect(body.prims.length).toBe(plain.prims.length);
    body.prims.forEach((p, i) => {
      const { morphs: _m, ...rest } = p;
      expect(rest, `prim ${i}`).toEqual(plain.prims[i]);
    });
    const morphed = body.prims.filter(p => p.morphs);
    const smiles = morphed.filter(p => p.morphs!.every(m => m.channel === 'smile'));
    // Task 15 added the throat bar (it widens with the opening).
    expect(smiles.length, 'upper lip, lower lip, chin, upper ridge, cheek pair, corner pair, throat bar').toBe(9);
    // Task 15: the two GENERATED face prims carry the eye area's morphs (face block `morph <tag>` lines).
    // (Built prims do not keep facePrims' tags: the two are the only skull prims morphed on anything but the smile.)
    const eyeArea = morphed.filter(p => !p.morphs!.every(m => m.channel === 'smile')).map(p => p.morphs!.map(m => m.channel).sort());
    // Task 16: the brow ridge's browDown is two ONE-SIDED words (browDown+ knits it into a V, browDown- lifts it).
    expect(eyeArea).toEqual([['squint'], ['browDown', 'browDown', 'squint']]);
    expect(morphed.length).toBe(11);
  });

  it('weights 0 pose exactly as the body without any morph (rest, and the jaw open)', () => {
    const plainBound = bindRig(plain);
    for (const gape of [0, 0.3]) {
      const zero = applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: gape,
        morphs: { gape: 0, smile: 0, browDown: 0, lipCurl: 0, lid: 0, squint: 0 } } }, 0);
      const none = applyRig(plain, { ...plainBound, rig: { ...plainBound.rig, jawGape: gape } }, 0);
      zero.prims.forEach((p, i) => {
        const { morphs: _m, ...rest } = p;
        expect(rest, `prim ${i}`).toEqual(none.prims[i]);
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
  const ridgeY = (b: typeof body, x: number) => {
    let best = { y: 0, z: -1 };
    for (let y = 1.22; y < 1.32; y += 0.0005) { const z = frontZ(b, x, y); if (z > best.z) best = { y, z }; }
    return best;
  };
  it('the brow ridge follows browDown: it travels 6 mm or more in height between surprise (-1) and the scowl (+1)', () => {
    for (const x of [0.015, 0.03, 0.045]) {
      const up = ridgeY(posed({ browDown: -1 }), x), rest = ridgeY(posed(), x), down = ridgeY(posed({ browDown: 1 }), x);
      // measured 18 / 17 / 13.5 mm at x 0.015 / 0.03 / 0.045 (Task 15's linear 3 mm a unit gave 5.5-6.5)
      expect(up.y - down.y, `x ${x}: travel`).toBeGreaterThan(0.010);
      expect(up.y, `x ${x}: surprise lifts it`).toBeGreaterThan(rest.y + 0.002);
      expect(down.y, `x ${x}: browDown lowers it`).toBeLessThan(rest.y - 0.008);
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

  it('the grin widens the lower face by most of a centimetre a side at the chin (owner: "his chins n stuff should get wider")', () => {
    const on = grin(true), off = grin(false);
    for (const y of [1.07, 1.08]) expect(reachX(on, y) - reachX(off, y), `y ${y}`).toBeGreaterThan(0.007);
  });
  // 'The grin still bares every upper tooth' is a mesh-teeth test now (Task 14, the block above).
});
