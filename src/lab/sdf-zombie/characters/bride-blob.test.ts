// src/lab/sdf-zombie/characters/bride-blob.test.ts
//
// Pins the bride's DESIGN INTENT (spec 2026-09-24-bride-sword-enemy-design.md).
// Prose + one inspiration photo (not committed), so these are STRUCTURAL pins,
// each naming a decision from the .blob header. Whether she reads as
// beautiful-then-wrong is the owner's call on frames, not this file's.
import { describe, it, expect } from 'vitest';
import src from './bride.blob?raw';
import { parseBlob } from '../blob-parse';
// @ts-expect-error — node:fs available in vitest via happy-dom/node (strand-wiring.test.ts)
import { readFileSync } from 'node:fs';
// @ts-expect-error — node:zlib, same arrangement as node:fs above
import { inflateSync } from 'node:zlib';
import { compileBlob, compileFace, compilePalette, compileSheet, compileSheetImage } from '../blob-compile';
import { buildBody } from '../build-body';
import { characterEntry } from '../character-registry';
import { MAX_PRIMS, sdBody, nearestPrim } from '../validate';
import { checkStance } from '../blob-checks';
import { bindRig, applyRig, HEM_REST_SCALE } from '../rig-bind';
import { makeMotionJoints } from '../motion';

const doc = parseBlob(src);
const body = buildBody(compileBlob(doc, compileFace(doc)));
const bone = (n: string) => {
  const b = body.bones.get(n);
  if (!b) throw new Error(`no bone ${n}`);
  return b;
};
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('bride — build', () => {
  it('compiles clean and is registered', () => {
    expect(body.errors).toEqual([]);
    expect(characterEntry('bride').name).toBe('bride');
  });

  it('stands humanoid: knees fold forward (the lab refuses to load her otherwise)', () => {
    expect(checkStance(body.bones, doc.stance)).toEqual([]);
  });

  it('drives the motion rig: every bone maps to a gait joint, and the rig carries the long sword arm', () => {
    // makeMotionJoints returns null on any unmapped bone (the spec's reason
    // for faking the second elbow with length instead of a new joint).
    const joints = makeMotionJoints(body, bindRig(body).rig.restPose);
    expect(joints).not.toBeNull();
    const [, foreR] = joints!.arm.R;
    const [, foreL] = joints!.arm.L;
    expect(foreR - foreL).toBeGreaterThan(0.03);
  });

  it('has her feet pointing FORWARD (+z, the way she faces): toe ahead of ankle', () => {
    // Owner (2026-09-24): "feet point backwards". The .blob was right; the
    // lab turntable rotated her offset prims by a stale wander yaw
    // (lab-main.ts setMotionEnabled). Pinned here in the rest skeleton AND in
    // the motion rig's base pose, which is what the gait and the renderer
    // pose from — the face is at +z, so the toes must be too.
    for (const s of ['l', 'r']) {
      const foot = bone(`foot.${s}`);
      expect(foot.tail[2] - foot.head[2], `foot.${s}`).toBeGreaterThan(0.08);
    }
    const joints = makeMotionJoints(body, bindRig(body).rig.restPose)!;
    const at = (n: string) => joints.base[joints.index[n as keyof typeof joints.index]!]!;
    expect(at('toeL')[2]).toBeGreaterThan(at('footL')[2]);
    expect(at('toeR')[2]).toBeGreaterThan(at('footR')[2]);
    // ...and the face is on the same side: nose tip ahead of the cranium.
    const skull = body.prims.filter(p => p.bone === 'skull');
    const cranium = skull.reduce((m, p) => (p.radius > m.radius ? p : m));
    const noseTip = Math.max(...skull.map(p => Math.max(p.a[2], p.b[2]) + p.radius * p.scale[2]));
    expect(noseTip).toBeGreaterThan(cranium.a[2] + cranium.radius * cranium.scale[2]);
  });

  it('has no typo in its face, sheet or palette parameter names', () => {
    expect(() => compilePalette(doc)).not.toThrow();
    expect(() => compileSheet(doc)).not.toThrow();
  });

  it('wears the corpse-makeup sheet at rgb multiply, eyes unlit (Task 2)', () => {
    const sheet = compileSheet(doc)!;
    expect(sheet.enabled).toBe(1);
    expect(compileSheetImage(doc)).toBe('bride-face.png');
    // MULTIPLY with blendLuma 0: the sheet's base is neutral grey, and the
    // makeup's hues (bruise, violet hollows, blue veins) are the point.
    expect(sheet.decal).toBe(0);
    expect(sheet.blendLuma).toBe(0);
    // Her eyes do not glow; the sheet's bright grey base must not either.
    expect(sheet.eyeGlowAmp).toBe(0);
    expect(sheet.eyeGlowCut).toBeGreaterThanOrEqual(0.99);
    // The registry declares the MEASURED mean (the game does not measure;
    // bakedFace's fallback 1 would darken her face).
    const face = characterEntry('bride').face;
    expect(face.url).toBe('/assets/lab/faces/bride-face.png');
    expect(face.mean).toBeCloseTo(measuredSheetMean('public/assets/lab/faces/bride-face.png'), 3);
  });

  it('paints with the SAME projection the sheet block declares', () => {
    // make-bride-face.py places every stroke through these four numbers; if
    // the .blob moves the projection without rerunning the painter, the
    // liner lands off the lids and the sutures off the mouth corners.
    const py = readFileSync('scripts/make-bride-face.py', 'utf8');
    const num = (k: string) => Number(new RegExp(`^${k} = ([0-9.]+)`, 'm').exec(py)?.[1]);
    const sheet = compileSheet(doc)!;
    expect(num('PROJ_SCALE_X')).toBe(sheet.projScaleX);
    expect(num('PROJ_SCALE_Y')).toBe(sheet.projScaleY);
    expect(num('PROJ_CENTRE_X')).toBe(sheet.projCentreX);
    expect(num('PROJ_CENTRE_Y')).toBe(sheet.projCentreY);
  });

  it('fits the 128 flesh+bone prim budget with the cloth and hair on', () => {
    // Task 1 left 20 prims of headroom; Task 3's shells, laces, hair and
    // stocking tops spent most of it. MAX_PRIMS bounds flesh AND bone
    // together (validate.ts), so the sum is what must fit.
    expect(body.prims.length + body.bonePrims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });
});

describe('bride — wrong anatomy (the cheap version)', () => {
  // Primitive carries endpoints a/b (no `center`), per-axis scale and an
  // optional far radius; the crown is the highest endpoint plus its y extent.
  const height = Math.max(...body.prims.map(p =>
    Math.max(p.a[1] + p.radius * p.scale[1], p.b[1] + (p.radiusB ?? p.radius) * p.scale[1])));

  it('is tall: ~1.85 m', () => {
    expect(height).toBeGreaterThan(1.80);
    expect(height).toBeLessThan(1.92);
  });

  it('has legs ~10% too long: hip-to-floor over total height >= 0.54', () => {
    // A typical adult woman is ~0.49-0.50.
    const hipY = bone('thigh.l').head[1];
    expect(hipY / height).toBeGreaterThanOrEqual(0.54);
  });

  // The hourglass, probed on the CPU field along x at the body's centreline
  // depth: the first x where the field goes positive is the flesh's
  // half-width. Blend volume is included, which is the point — the first
  // "double the blends" pass looked fine in the .blob and probed a 0.131
  // waist.
  // FLESH only: the Task 3 bodice and skirt stand off the body on purpose.
  const flesh = { ...body, prims: body.prims.map(p => (p.shell || p.strand ? { ...p, dead: true } : p)) };
  const halfWidth = (y: number) => {
    for (let x = 0; x < 0.4; x += 0.001) if (sdBody([x, y, 0], flesh) > 0) return x;
    return Infinity;
  };

  it('has a wasp waist (half-width <= 0.095) over flared hips (>= 0.15)', () => {
    const waist = Math.min(...[1.10, 1.12, 1.14, 1.16, 1.18].map(halfWidth));
    const hips = Math.max(...[0.94, 0.97, 1.00].map(halfWidth));
    expect(waist).toBeLessThanOrEqual(0.095);
    expect(hips).toBeGreaterThanOrEqual(0.15);
    // ...and the hip flare stops short of the hanging arms: daylight, not a
    // body fused to its own wrists (hips were 0.214 wide = touching the
    // forearm before the arms were splayed out).
    expect(hips).toBeLessThan(0.18);
  });

  it('has a long neck: neck bone >= 0.13 m', () => {
    expect(dist(bone('neck').head, bone('neck').tail)).toBeGreaterThanOrEqual(0.13);
  });

  it('has the sword forearm longer than the off forearm (hidden by the vambrace)', () => {
    const r = dist(bone('forearm.r').head, bone('forearm.r').tail);
    const l = dist(bone('forearm.l').head, bone('forearm.l').tail);
    expect(r - l).toBeGreaterThan(0.03);
  });
});

// ---------------------------------------------------------------------------
// Task 3: the cloth (bodice, ruffle skirt, veil), the strand hair, the laces
// and the painted stockings. Shells are cloth, not mass (the cultist's road);
// the hair is a mass for the volume plus strands for every hanging edge (the
// schoolgirl-described road).
// ---------------------------------------------------------------------------
describe('bride — cloth and hair', () => {
  const shells = body.prims.filter(p => p.shell);
  const bodiceI = body.prims.findIndex(p => p.shell && p.bone === 'chest');
  // The LOWER (longest) tier: the lowest hem.
  const skirtI = body.prims.reduce((best, p, i) => (p.shell && p.bone === 'hem'
    && (best < 0 || p.shell.clipOffset > body.prims[best]!.shell!.clipOffset) ? i : best), -1);
  const veilI = body.prims.findIndex(p => p.shell && p.bone === 'skull');
  /** The prim that owns the first surface a ray meets (the paint lookup's
   *  arg-min at the hit, validate.ts nearestPrim), or -1 on a miss. */
  const firstHit = (o: readonly number[], d: readonly number[], max = 1): number => {
    let t = 0;
    while (t < max) {
      const p = [o[0]! + d[0]! * t, o[1]! + d[1]! * t, o[2]! + d[2]! * t] as const;
      const f = sdBody(p, body);
      if (f < 0.0003) return nearestPrim(p, body);
      t += Math.max(f * 0.8, 0.0005);
    }
    return -1;
  };
  const fromFront = (x: number, y: number) => firstHit([x, y, 0.4], [0, 0, -1]);
  const fromBack = (x: number, y: number) => firstHit([x, y, -0.4], [0, 0, 1]);
  // .blob colours are sRGB hex compiled to LINEAR rgb (blob-parse.ts);
  // convert back to compare against the file's hex.
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const hex = (i: number) => body.prims[i]?.color?.map(v => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0')).join('');

  it('is dressed in SHELLS: bodice, two ruffle tiers on the hem, veil on the skull', () => {
    // The plan said three; a second, shorter skirt tier was added so the
    // skirt reads as tiered ruffles (owner: build for the look first).
    const s = shells.map(p => `${p.limb}:${p.bone}`).sort();
    expect(s).toEqual(['head:skull', 'torso:chest', 'torso:hem', 'torso:hem']);
  });

  it('opens the bodice down the sternum over the rib window, and covers the bust', () => {
    expect(body.prims[bodiceI]!.shell!.clipNormal[2]).toBeGreaterThan(0.9);
    // Straight at the sternum, through the rib window's height (y 1.17-1.31):
    // the first thing a ray meets is NOT the bodice — flesh (ribs, skin) or
    // a lace. The clip leaves the front open.
    for (const y of [1.18, 1.21, 1.24, 1.27, 1.29]) expect(fromFront(0, y), `sternum y ${y}`).not.toBe(bodiceI);
    // ...and a ray at each breast meets the bodice: she is covered. (The
    // bust is painted the bodice's ivory too, so a mound pushing through the
    // lid reads as the corset's cup — the cultist's rule — and never skin.)
    for (const x of [-0.063, 0.063]) expect(fromFront(x, 1.34), `bust x ${x}`).toBe(bodiceI);
    for (const x of [-0.063, 0.063]) for (const y of [1.30, 1.36, 1.38])
      expect(hex(fromFront(x, y)), `bust x ${x} y ${y}`).toBe('f1ece0');
  });

  it('laces the gap: dark thin prims cross the sternum in front of the ribs', () => {
    const laces = body.prims.filter(p => !p.shell && p.limb === 'torso' && hex(body.prims.indexOf(p)) === '3a2a22');
    expect(laces.length).toBeGreaterThanOrEqual(4);
    expect(laces.length).toBeLessThanOrEqual(5);
    // Each one CROSSES the centreline.
    for (const l of laces) expect(Math.sign(l.a[0]) * Math.sign(l.b[0])).toBe(-1);
  });

  it('has a short ruffled skirt on the hem pendulum, hemmed below the crotch', () => {
    const skirt = body.prims[skirtI]!;
    expect(skirt.shell!.warpAmp ?? 0).toBeGreaterThan(0);
    // clip=(0,-1,0): keeps y > -clipd. Below the crotch (flesh ends ~0.88 at
    // the centreline) so she is not bare from the front; above the stocking
    // tops, so the thigh band shows.
    const hemY = -skirt.shell!.clipOffset;
    expect(hemY).toBeLessThan(0.87);
    expect(hemY).toBeGreaterThan(0.80);
    // `rigid`: both ends ride the hem bone head; the tail swings.
    const bound = bindRig(body);
    const hem = bone('hem');
    const pointAt = (p: readonly number[]) => bound.rig.points.findIndex(q => dist(q.pos, p) < 1e-4);
    body.prims.forEach((p, i) => {
      if (!(p.shell && p.bone === 'hem')) return;
      expect(bound.binding[i]!.a.point).toBe(pointAt(hem.head));
      expect(bound.binding[i]!.b.point).toBe(pointAt(hem.head));
    });
    const tail = pointAt(hem.tail);
    expect(bound.rig.restScale![tail]).toBe(HEM_REST_SCALE);
    expect(bound.rig.points[tail]!.pinned).toBe(false);
  });

  it('binds NO flesh or bone prim to the swinging hem (only the skirt rides it)', () => {
    // The stocking tops ended nearer the hem tail than the hip or knee and,
    // in a walk, rose off the leg as tubes to it (rig-bind.ts distal set).
    const bound = bindRig(body);
    const tail = bound.rig.points.findIndex(q => dist(q.pos, bone('hem').tail) < 1e-4);
    body.prims.forEach((p, i) => {
      if (p.bone === 'hem') return;
      const b = bound.binding[i]!;
      expect([b.a.point, b.b.point], `prim ${i} on ${p.bone}`).not.toContain(tail);
    });
    bound.boneBinding.forEach((b, i) =>
      expect([b.a.point, b.b.point], `bone prim ${i}`).not.toContain(tail));
  });

  it('veils the head but leaves the face open', () => {
    const veil = body.prims[veilI]!;
    // `rigid` on the skull: both ends ride the skull as one piece, so the
    // veil does not stretch to the nearest back joint, and the opening turns
    // with her (a 90 degree body yaw turns the clip normal from +z to +x).
    const bound = bindRig(body);
    const skull = bone('skull');
    const pointAt = (p: readonly number[]) => bound.rig.points.findIndex(q => dist(q.pos, p) < 1e-4);
    expect(bound.binding[veilI]!.a.point).toBe(pointAt(skull.head));
    expect(bound.binding[veilI]!.b.point).toBe(pointAt(skull.head));
    const n1 = applyRig(body, bound, Math.PI / 2).prims[veilI]!.shell!.clipNormal;
    expect(n1[0]).toBeGreaterThan(0.9);
    // Eyes, nose and mouth are not behind the veil...
    for (const [x, y] of [[0.034, 1.70], [0, 1.66], [0, 1.635]] as const)
      expect(fromFront(x, y), `face ${x},${y}`).not.toBe(veilI);
    // ...and the crown is under it.
    expect(firstHit([0, 2.1, 0], [0, -1, 0])).toBe(veilI);
    expect(veil.shell!.clipNormal[2]).toBeGreaterThan(0.5);
  });

  it('has long black centre-parted strand hair covering the back of the skull', () => {
    const strands = body.prims.filter(p => p.strand);
    expect(strands.length).toBeGreaterThanOrEqual(3);
    for (const s of strands) expect(hex(body.prims.indexOf(s))).toBe('141216');
    // Nothing bald shows from behind: the back of the head is hair or veil.
    for (const y of [1.66, 1.72, 1.78]) {
      const i = fromBack(0, y);
      expect(i === veilI || hex(i) === '141216', `back of head y ${y}`).toBe(true);
    }
    // Long: the lowest strand reaches down the back past the shoulder blades.
    expect(Math.min(...strands.map(p => Math.min(p.a[1], p.b[1])))).toBeLessThan(1.30);
  });

  it('keeps the CRANIUM as the face frame in game AND lab (hair/veil never out-size it)', () => {
    // game-main.ts headShape takes the fattest head prim by radius x max
    // scale over ALL prims (lab-main skips painted ones). A hair mass or veil
    // that won would re-centre the Task 2 sheet in game only: sutures off the
    // mouth, liner off the lids. So every covering prim stays under it.
    const head = body.clusters.find(c => c.limb === 'head')!;
    const prims = body.prims.slice(head.start, head.start + head.count).filter(p => p.op !== 'sub');
    const metric = (p: typeof prims[number]) => p.radius * Math.max(...p.scale);
    const fattest = prims.reduce((m, p) => (metric(p) > metric(m) ? p : m));
    expect(fattest.color).toBeUndefined();
    expect(fattest.shell).toBeUndefined();
    expect(fattest.strand).toBeUndefined();
  });

  it('wears ivory stockings on the thigh band below the skirt', () => {
    // The Task 4 boots cover from above the knee down; the band between the
    // hem and the boots is where the stockings show.
    for (const s of [1, -1]) {
      const i = fromFront(s * 0.075, 0.72);
      expect(hex(i), `stocking at x ${s * 0.075}`).toBe('e8e0d0');
    }
  });
});

/** The sheet mean exactly as the lab measures it (lab-main.ts applyMeanOf):
 *  Rec.709 luma over texels with alpha >= 8. Decodes the committed PNG
 *  (8-bit RGBA, non-interlaced — what make-bride-face.py writes) so a re-run
 *  of the painter that moves the mean fails here instead of leaving the
 *  registry's declared value stale. */
function measuredSheetMean(path: string): number {
  const buf: Uint8Array = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let w = 0, h = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o < buf.length;) {
    const len = dv.getUint32(o), type = String.fromCharCode(...buf.subarray(o + 4, o + 8));
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8); h = dv.getUint32(o + 12);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error('expected 8-bit RGBA, non-interlaced');
    } else if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  idat.reduce((at, c) => (all.set(c, at), at + c.length), 0);
  const raw: Uint8Array = inflateSync(all);
  const stride = w * 4, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[dst + x - 4]! : 0, b = y > 0 ? px[dst - stride + x]! : 0;
      const c = x >= 4 && y > 0 ? px[dst - stride + x - 4]! : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4
        ? ((pa, pb, pc) => (pa <= pb && pa <= pc ? a : pb <= pc ? b : c))(Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c))
        : 0;
      px[dst + x] = (raw[src + x]! + pred) & 255;
    }
  }
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3]! < 8) continue;
    sum += (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
    n++;
  }
  return sum / n;
}
