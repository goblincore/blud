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
import { nearestPrim, sdBody } from '../validate';
import { lerp } from '../vec';
import type { Vec3 } from '../types';
import { measureProfile, CINEMATIC_PROFILE_PROBES, GOBLIN_PROFILE_PROBES, PROFILE_TOL } from './goblin-head-profile';
import { bindRig, applyRig } from '../rig-bind';
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

  it('its kit is the goblin kit with bare eyes: no lens or frame material, the jaw bone carried, the same armour bones', () => {
    type G = { materials: { name: string }[]; nodes: { name?: string }[] };
    const kit = JSON.parse(kitJson) as G, baseKit = JSON.parse(baseKitJson) as G;
    const mats = kit.materials.map(m => m.name);
    expect(mats).not.toContain('glass');
    expect(mats).not.toContain('black');
    expect(baseKit.materials.map(m => m.name).filter(n => n !== 'glass' && n !== 'black')).toEqual(mats);
    const nodes = kit.nodes.map(n => n.name);
    expect(nodes).toContain('jaw');
    expect(nodes.filter(n => n !== 'jaw')).toEqual(baseKit.nodes.map(n => n.name));
  });

  it('the head paint is only inside the mouth: 11 teeth, the dark throat bar and the jaw floor, on the skull or the jaw', () => {
    // The lips stay flesh: the owner rejected painted lips.
    const headPaint = doc.parts.filter(p => p.limb === 'head' && p.color != null);
    expect(headPaint.length, 'head stays flesh but for the 11 teeth and the mouth interior').toBe(13);
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

describe('goblin teeth and mouth interior (expression pass)', () => {
  // Found by their colour markers, not by bone: the chin and the lower lip are `on jaw` too, so the teeth are the prims the
  // full goblin has that the same .blob with the marked lines stripped does not.
  // The tooth paint string, the ONE place the tests name it (Task 12 brightened the teeth from `color=8f8266 gloss=0.15`).
  const TOOTH = /color=e0d8c0 gloss=0\.35 glow=0\.15/;
  const INTERIOR = /color=2a0608/;
  const bodyOf = (text: string) => buildBody(compileBlob(parseBlob(text), compileFace(parseBlob(text))));
  const full = bodyOf(src);
  const bare = bodyOf(src.split('\n').filter(l => !TOOTH.test(l) && !INTERIOR.test(l)).join('\n'));
  const same = (p: { a: Vec3; b: Vec3 }, q: { a: Vec3; b: Vec3 }) =>
    p.a.every((v, k) => Math.abs(v - q.a[k]!) < 1e-9) && p.b.every((v, k) => Math.abs(v - q.b[k]!) < 1e-9);
  const teeth = full.prims.filter(p => !bare.prims.some(q => same(p, q)));
  // A tooth from an interior prim by its paint: the teeth are light ivory (red 0.75 linear), the interior near-black (0.02).
  const TOOTH_RGB = (p: { color?: Vec3 }) => p.color !== undefined && p.color[0] > 0.5;

  it('has 11 teeth plus the mouth interior (throat bar and jaw floor), 5 small and 2 fangs above, 4 small below', () => {
    expect(full.errors).toEqual([]);
    // Task 3b added the dark FLOOR on the jaw: with the lowered hinge the open jaw tips its top toward the viewer.
    expect(teeth.length).toBe(13); // 11 teeth + the throat bar + the floor
    const upper = teeth.filter(p => p.bone === 'skull');
    const lower = teeth.filter(p => p.bone === 'jaw');
    expect(upper.length, 'upper: 7 teeth + the throat bar').toBe(8);
    expect(lower.length, 'lower: 4 teeth + the floor').toBe(5);
    expect(teeth.filter(p => TOOTH_RGB(p)).length, 'teeth').toBe(11);
  });

  it('every tooth and the interior bar is buried at rest: both ends are inside the tooth-free flesh', () => {
    for (const p of teeth) {
      expect(sdBody(p.a, bare), `end a of ${p.bone} prim`).toBeLessThan(-0.0005);
      expect(sdBody(p.b, bare), `end b of ${p.bone} prim`).toBeLessThan(-0.0005);
    }
  });

  it('adding them does not move the head profile', () => {
    for (const m of measureProfile(full, CINEMATIC_PROFILE_PROBES)) expect(Math.abs(m.got - m.probe.want), m.probe.name).toBeLessThanOrEqual(PROFILE_TOL);
  });

  // Buried ends are not enough: paint goes to the hit's NEAREST prim, and the mouth corners are a blend fillet with every
  // real prim 5-8 mm away, so a buried tooth can still paint the rest skin ivory (the first tuning pass did). Sweep the face
  // from the front (1 mm grid over the mouth, sphere-traced along -z) and read which prim paints each hit.
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
  const toothIndices = teeth.map(p => full.prims.indexOf(p));

  it('paints nothing when the jaw is shut: no tooth and not the interior is the nearest prim anywhere on the rest face', () => {
    const rest = painters(0);
    for (const i of toothIndices) expect(rest.has(i), `prim ${i} (${full.prims[i]!.bone}, x ${full.prims[i]!.a[0]}) paints the rest skin`).toBe(false);
  });

  it('shows when the jaw drops: every tooth and the interior paint part of the face at a 0.3 rad gape', () => {
    const open = painters(0.3);
    for (const i of toothIndices) expect(open.has(i), `prim ${i} (${full.prims[i]!.bone}, x ${full.prims[i]!.a[0]}) never shows`).toBe(true);
  });

  // THE GRIN (Task 3b): the mouth opens AT THE LIP LINE, so a small gape already bares the whole upper row. Before 3b the opening
  // sat in the chin's bevel 2-3 cm lower and the upper row stayed hidden behind the upper face mass at 0.15.
  it('bares every upper tooth at the grin gape (0.15 rad)', () => {
    const grin = painters(0.15);
    const upperTeeth = toothIndices.filter(i => full.prims[i]!.bone === 'skull' && TOOTH_RGB(full.prims[i]!));
    expect(upperTeeth.length).toBe(7);
    for (const i of upperTeeth) expect(grin.has(i), `upper tooth x ${full.prims[i]!.a[0]} hidden at 0.15`).toBe(true);
  });
});

describe('goblin face morphs (Task 12: the smile widens the chin, pushes the cheeks and corners, lifts the upper lip)', () => {
  const doc = parseBlob(src);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const stripped = src.replace(/ morph=\S+/g, '');
  const plainDoc = parseBlob(stripped);
  const plain = buildBody(compileBlob(plainDoc, compileFace(plainDoc)));
  const bound = bindRig(body);
  const grin = (morphs: boolean) => applyRig(body, { ...bound, rig: { ...bound.rig, jawGape: 0.204,
    ...(morphs ? { morphs: { gape: 0.34, smile: 1, browDown: 1, lipCurl: 0, lid: 0 } } : {}) } }, 0);
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
    expect(morphed.length, 'upper lip, lower lip, chin, upper ridge, cheek pair, corner pair').toBe(8);
    for (const p of morphed) expect(p.morphs!.map(m => m.channel)).toEqual(['smile']);
  });

  it('the grin widens the lower face by most of a centimetre a side at the chin (owner: "his chins n stuff should get wider")', () => {
    const on = grin(true), off = grin(false);
    for (const y of [1.07, 1.08]) expect(reachX(on, y) - reachX(off, y), `y ${y}`).toBeGreaterThan(0.007);
  });

  it('the grin still bares every upper tooth (front rays over the mouth, as the teeth tests sweep it)', () => {
    const on = grin(true);
    const teeth = on.prims.map((p, i) => [p, i] as const).filter(([p]) => p.bone === 'skull' && p.color !== undefined && p.color[0] > 0.5);
    expect(teeth.length).toBe(7);
    const hit = new Set<number>();
    for (let x = -0.05; x <= 0.0501; x += 0.001) for (let y = 1.09; y <= 1.15; y += 0.001) {
      let z = 0.16;
      while (z > -0.02) { const d = sdBody([x, y, z], on); if (d < 0.0002) break; z -= Math.max(d * 0.8, 0.0002); }
      if (z > -0.02) hit.add(nearestPrim([x, y, z + 0.0002], on));
    }
    for (const [p, i] of teeth) expect(hit.has(i), `upper tooth x ${p.a[0].toFixed(3)}`).toBe(true);
  });
});
