// src/lab/sdf-zombie/webgpu/emergence-field.test.ts
import { describe, it, expect } from 'vitest';
import { paramsAt, DURATION, type EmergenceParams } from './emergence-timeline';
import {
  COAT, DESK_Y, EGG, EGG_REST, FRAME_FACE_Z, GLASS, KEYBOARD_RECT, KEYBOARD_TOP, KEYBOARD_Z, SKIN, SAC_MAX, PICTURE_TABLE_N, SAC_BLEND, SLUMP, TEAR_KNIT,
  coatCoverage, coatEggBlob, coatThickness, dripFloor, eggCentre, eggFront, eggHeld, lipOpening, pictureTable, pictureUV, sacBlend, sacExtent, sacSolid, sacZ,
  sheetThickness, tearEdge, tearRadius, tearTip, wrinkleAmp, FIGURE_BLOBS, FIGURE_DRIFT, SHELL, VEIN_TREE, figureAt,
} from './emergence-field';
import * as FIELD from './emergence-field';

const REST: EmergenceParams = paramsAt(0);
const at = (o: Partial<EmergenceParams>): EmergenceParams => ({ ...REST, ...o });
/** The sac solid's half-width at depth z along (ax, ay) from (0, cy): the outermost inside point within 0.4 m, to the millimetre. */
const halfWidth = (p: EmergenceParams, z: number, ax: number, ay: number, cy: number) => {
  let w = 0;
  for (let r = 0; r <= 0.4; r += 0.001) if (sacSolid(p, [ax * r, cy + ay * r, z]) <= 0) w = r;
  return w;
};
/** The top of the sac solid above (x, y): scan down from in front of everything, then bisect. */
const solidTop = (p: EmergenceParams, x: number, y: number) => {
  let hi = 1.0;
  while (hi > -0.2 && sacSolid(p, [x, y, hi - 0.002]) > 0) hi -= 0.002;
  let lo = hi - 0.002;
  for (let i = 0; i < 30; i++) { const m = 0.5 * (lo + hi); if (sacSolid(p, [x, y, m]) <= 0) lo = m; else hi = m; }
  return lo;
};

describe('emergence field', () => {
  it('the sheet is flat at rest and meets the lip at the opening', () => {
    expect(sacZ(REST, 0, 0)).toBeCloseTo(0, 12);
    expect(sacZ(REST, GLASS.hw, 0)).toBeCloseTo(0, 12);
    const p = at({ push: 1 });
    expect(sacZ(p, GLASS.hw * 1.0001, 0)).toBeCloseTo(lipOpening(p).z, 3);   // outside the (unbowed) lip it is the rim height
    expect(sacZ(p, 0, 0)).toBeGreaterThan(0.5);
  });

  it('the apex reaches about 0.65 m at full push (the egg is 0.70 of round one\'s, its reach kept within 0.62..0.70)', () => {
    expect(SAC_MAX).toBeGreaterThan(0.62);
    expect(SAC_MAX).toBeLessThan(0.7);
    expect(sacZ(at({ push: 1 }), 0, 0)).toBeGreaterThanOrEqual(SAC_MAX - 0.02);
  });

  it('the sac grows monotonically with push, at every sampled point', () => {
    for (const [x, y] of [[0, 0], [0.08, 0.03], [0.15, -0.05], [0, 0.12]] as const) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const z = sacZ(at({ push: i / 20 }), x, y); expect(z, `x=${x} y=${y} push=${i / 20}`).toBeGreaterThanOrEqual(prev - 1e-9); prev = z; }
    }
  });

  it('the sac wraps the egg: at every point inside the egg\'s silhouette the sheet is in front of the egg by at least the skin', () => {
    for (let i = 0; i <= 20; i++) {
      const p = at({ push: i / 20, lipBow: Math.min(1, (i / 20) * 1.5) });
      const c = eggCentre(p);
      for (let ix = -4; ix <= 4; ix++) for (let iy = -4; iy <= 4; iy++) {
        const x = (ix / 4) * EGG.rx * 0.95, y = c[1] + (iy / 4) * EGG.ry * 0.95;
        const f = eggFront(p, x, y);
        if (f === null) continue;
        expect(sacZ(p, x, y), `push=${i / 20} x=${x.toFixed(3)} y=${y.toFixed(3)}`).toBeGreaterThanOrEqual(f + SKIN - 1e-9);
      }
    }
  });

  it('the sac solid holds the egg grown by the skin, its back half too', () => {
    for (const push of [0.3, 0.6, 1]) {
      const p = at({ push, lipBow: push }), c = eggCentre(p);
      for (let i = 0; i < 12; i++) for (let j = 1; j < 12; j++) {
        const th = (i / 12) * 2 * Math.PI, ph = (j / 12) * Math.PI;
        const v: [number, number, number] = [c[0] + EGG.rx * Math.sin(ph) * Math.cos(th), c[1] + EGG.ry * Math.sin(ph) * Math.sin(th), c[2] + EGG.rz * Math.cos(ph)];
        expect(sacSolid(p, v), `push=${push} th=${th.toFixed(2)} ph=${ph.toFixed(2)}`).toBeLessThanOrEqual(-SKIN + 1e-9);
      }
    }
  });

  it('the sac tapers from the egg\'s equator back to the lip: a rounded wall, not the egg swept back as a tube (round one)', () => {
    const p = at({ push: 1, lipBow: 1 }), c = eggCentre(p), lo = lipOpening(p);
    for (const [ax, ay, eggR] of [[1, 0, EGG.rx], [0, 1, EGG.ry]] as const) {
      const wEq = halfWidth(p, c[2], ax, ay, c[1]);
      expect(wEq, `axis ${ax},${ay}`).toBeGreaterThanOrEqual(eggR + SKIN - 0.002);
      expect(wEq, `axis ${ax},${ay}`).toBeLessThan(eggR + SKIN + 0.02);
      const ws: number[] = [];
      for (let z = lo.z + 0.02; z <= c[2] + 1e-9; z += 0.01) ws.push(halfWidth(p, z, ax, ay, c[1]));
      // a tube holds the equator's width all the way back to the glass; this wall leaves it by more than 3 cm...
      expect(Math.max(...ws.map(w => Math.abs(w - wEq))), `axis ${ax},${ay}`).toBeGreaterThan(0.03);
      // ...and gets there smoothly: no step between samples a centimetre apart
      for (let i = 1; i < ws.length; i++) expect(Math.abs(ws[i]! - ws[i - 1]!), `axis ${ax},${ay} sample ${i}`).toBeLessThan(0.02);
    }
  });

  it('the blend is the cap\'s in front of the equator, the tent\'s behind it at full push, narrow at rest', () => {
    expect(sacBlend(1, 0.7, 0.55)).toBe(SAC_BLEND.cap);
    expect(sacBlend(1, 0.55 - SAC_BLEND.run, 0.55)).toBeCloseTo(SAC_BLEND.tent, 12);
    expect(sacBlend(0, -0.5, -0.25)).toBeCloseTo(SAC_BLEND.rest, 12);
    expect(SAC_BLEND.tent).toBeGreaterThanOrEqual(0.1);
  });

  it('sacZ is the top of the sac solid where the sheet faces the front (the twins agree)', () => {
    for (const push of [0.4, 0.7, 1]) {
      const p = at({ push, lipBow: push }), c = eggCentre(p), lo = lipOpening(p);
      const pts: [number, number][] = [[0, c[1]], [EGG.rx * 0.5, c[1]], [0, c[1] + EGG.ry * 0.6], [-EGG.rx * 0.7, c[1] - EGG.ry * 0.3], [lo.hw * 0.9, 0], [-lo.hw * 0.92, 0.02]];
      for (const [x, y] of pts) expect(Math.abs(solidTop(p, x, y) - sacZ(p, x, y)), `push=${push} x=${x.toFixed(3)} y=${y.toFixed(3)}`).toBeLessThan(0.015);
    }
  });

  it('the egg is bigger than the glass, so the lip has to give', () => {
    expect(2 * EGG.ry).toBeGreaterThan(2 * GLASS.hh);
    // the owner's second notes: 0.123 x 0.158 x 0.123
    expect([EGG.rx, EGG.ry, EGG.rz]).toEqual([0.123, 0.158, 0.123]);
    expect(lipOpening(at({ lipBow: 1 })).hh).toBeGreaterThanOrEqual(EGG.ry * 0.99);
    expect(lipOpening(REST).hh).toBe(GLASS.hh);
  });

  it('the egg slumps from the sac to the keyboard and stays there', () => {
    const inSac = eggCentre(at({ push: 1, slump: 0 }));
    const onDesk = eggCentre(at({ push: 1, slump: 1 }));
    expect(onDesk[1]).toBeLessThan(inSac[1]);
    expect(onDesk[2]).toBeLessThan(inSac[2]);
    expect(eggCentre(paramsAt(DURATION))).toEqual(onDesk);
  });

  it('the slumped egg rests ON the keyboard (its bottom on the key rows, over the keyboard), in front of the CRT\'s face and short of the knees', () => {
    expect(EGG_REST[1] - EGG.ry).toBeCloseTo(KEYBOARD_TOP, 12);
    expect(dripFloor(EGG_REST[0], EGG_REST[2])).toBe(KEYBOARD_TOP);    // its lowest point is over the keyboard, not the desk
    expect(EGG_REST[2] - EGG.rz).toBeGreaterThan(FRAME_FACE_Z + 0.02); // its back is 2 cm or more in front of the CRT's face (at the chin)
    expect(EGG_REST[2] + EGG.rz).toBeLessThan(0.365 + 1e-9);           // its front is short of the lab's desk front (0.365; the knees about 0.38)
  });

  it('the sheet thins as it stretches and is never gone', () => {
    const t0 = sheetThickness(at({ push: 0 }), 0, 0);
    const t1 = sheetThickness(at({ push: 1, thin: 1 }), 0, 0);
    expect(t1).toBeLessThan(t0);
    expect(t1).toBeGreaterThan(0.0005);
  });

  it('the tear opens from the tip and never reverses, and is zero when closed', () => {
    for (const th of [0, 0.7, 1.9, 3.1, 5]) {
      expect(tearRadius(at({ tear: 0 }), th)).toBe(0);
      let prev = -1;
      for (let i = 0; i <= 20; i++) { const r = tearRadius(at({ tear: i / 20 }), th); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
      // fully open it is most of the egg's width at every angle (0.1 m for the 80% egg; this bound scales with the egg)
      expect(prev).toBeGreaterThan(0.7 * EGG.rx);
    }
  });

  it('the tear\'s edge lies on the sheet, at the tear\'s radius from the tip on the apex axis', () => {
    for (const t of [7.2, 8, 9, 10.5]) {
      const p = paramsAt(t), tip = tearTip(p, t);
      expect(tip[0]).toBe(0); expect(tip[1]).toBe(0);
      expect(tip[2]).toBeCloseTo(sacZ(p, 0, 0, t), 12);
      for (let th = 0; th < 2 * Math.PI; th += 0.4) {
        const e = tearEdge(p, th, t);
        expect(e[2], `t=${t} th=${th.toFixed(1)}`).toBeCloseTo(sacZ(p, e[0], e[1], t), 9);
        // at the tear's radius from the tip, or (where the sheet drops down the wall at the egg's silhouette) at that wall: just inside
        // the point is within the radius, just outside it is beyond
        const R = tearRadius(p, th), r = Math.hypot(e[0], e[1]);
        const dAt = (rr: number) => Math.hypot(rr, sacZ(p, rr * Math.cos(th), rr * Math.sin(th), t) - tip[2]);
        const onSphere = Math.abs(dAt(r) - R) < 0.002;
        const atWall = dAt(r) <= R + 1e-9 && dAt(r + 0.001) > R;
        expect(onSphere || atWall, `t=${t} th=${th.toFixed(1)} r=${r.toFixed(4)} d=${dAt(r).toFixed(4)} R=${R.toFixed(4)}`).toBe(true);
        expect(Math.atan2(e[1], e[0])).toBeCloseTo(Math.atan2(Math.sin(th), Math.cos(th)), 6);
      }
    }
    expect(tearEdge(REST, 1)).toEqual(tearTip(REST));
  });

  it('the egg leaves the sac: the sac holds it until the slump, lets go by SLUMP.release, and the empty sheet dishes back behind it', () => {
    expect(eggHeld(at({ slump: 0 }))).toBe(1);
    expect(eggHeld(at({ slump: SLUMP.release }))).toBe(0);
    const out = at({ push: 1, lipBow: 1, tear: 1, slump: 1 }), c = eggCentre(out);
    // points just outside the egg's front cap are no longer inside the sac solid (it used to wrap the egg wherever it went)
    for (const [ux, uy] of [[0, 0], [0.4, 0.2], [-0.3, -0.3]] as const) {
      const x = ux * EGG.rx, y = c[1] + uy * EGG.ry, f = eggFront(out, x, y)!;
      expect(sacSolid(out, [x, y, f + SKIN * 0.5]), `${ux},${uy}`).toBeGreaterThan(0);
    }
    // the sheet's middle is behind the egg's back (a real gap for the strands), and below the bowed lip's rim
    expect(sacZ(out, 0, 0)).toBeLessThan(c[2] - EGG.rz * 0.5);
    expect(sacZ(out, 0, 0)).toBeLessThan(lipOpening(out).z);
  });

  it('the egg falls onto the keyboard: carried back, an ease-in drop that never goes below the key rows, a small settle, then rest', () => {
    let prevY = 0, prevZ = Infinity, landV = 0;
    for (let i = 0; i <= 200; i++) {
      const s = i / 200, c = eggCentre(at({ push: 1, slump: s }));
      expect(c[1] - EGG.ry, `s=${s}`).toBeGreaterThanOrEqual(KEYBOARD_TOP - 1e-9);
      expect(c[2], `s=${s}`).toBeLessThanOrEqual(prevZ + 1e-12);
      if (s <= SLUMP.land) { expect(c[1]).toBeLessThanOrEqual(prevY + 1e-12); landV = prevY - c[1]; }
      prevY = c[1]; prevZ = c[2];
    }
    expect(landV).toBeGreaterThan(0);                                          // still falling when it lands (ease-in)
    expect(eggCentre(at({ push: 1, slump: 1 }))).toEqual(EGG_REST);
  });

  it('the keyboard never moves (no shove): a drip lands on its top over its footprint and on the desk elsewhere, at every time', () => {
    expect('keyboardShove' in FIELD).toBe(false);
    expect('KEYBOARD_SHOVE' in FIELD).toBe(false);
    expect(dripFloor(0, KEYBOARD_Z)).toBe(KEYBOARD_TOP);
    expect(dripFloor(KEYBOARD_RECT.x1 - 1e-4, KEYBOARD_RECT.z0 + 1e-4)).toBe(KEYBOARD_TOP);
    expect(dripFloor(0, KEYBOARD_RECT.z0 - 1e-4)).toBe(DESK_Y);             // between the CRT's face and the keyboard
    expect(dripFloor(0, KEYBOARD_RECT.z1 + 1e-4)).toBe(DESK_Y);             // in front of it
    expect(dripFloor(KEYBOARD_RECT.x1 + 1e-4, KEYBOARD_Z)).toBe(DESK_Y);
    expect(KEYBOARD_RECT.z0).toBeGreaterThan(FRAME_FACE_Z);
  });

  it('the keyboard\'s goo coat: none until the egg starts to fall past t 10.5 s, then it only grows; thickest round the egg, on the keyboard only', () => {
    expect(coatEggBlob(paramsAt(10.4)).r).toBe(0);
    let prev = 0;
    for (let t = 9; t <= DURATION + 1e-9; t += 0.1) {
      const b = coatEggBlob(paramsAt(t));
      expect(b.r, `t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = b.r;
      expect([b.x, b.z]).toEqual([EGG_REST[0], EGG_REST[2]]);
    }
    const blobs = [coatEggBlob(paramsAt(13))];
    const at0 = coatThickness(blobs, EGG_REST[0], EGG_REST[2]);
    expect(at0).toBeGreaterThan(0.008);                                    // over the key rows round the egg: the keys are under the goo
    expect(at0).toBeLessThanOrEqual(COAT.max);
    // thinner away from the egg, gone off the keyboard
    expect(coatThickness(blobs, EGG_REST[0] + 0.15, EGG_REST[2])).toBeLessThan(at0);
    expect(coatThickness(blobs, KEYBOARD_RECT.x1 - 0.01, KEYBOARD_RECT.z0 + 0.01)).toBe(0);
    for (const [x, z] of [[0, KEYBOARD_RECT.z1 + 0.001], [0, KEYBOARD_RECT.z0 - 0.001], [KEYBOARD_RECT.x0 - 0.001, KEYBOARD_Z]] as const)
      expect(coatThickness(blobs, x, z)).toBe(0);
    // it reaches the keyboard's front edge in front of the egg (where the runs go over it)
    expect(coatThickness(blobs, 0, KEYBOARD_RECT.z1 - 0.006)).toBeGreaterThan(0.002);
  });

  it('the coat\'s coverage of the keyboard: 0 before the egg falls, growing, most of the keys by the settle', () => {
    expect(coatCoverage([coatEggBlob(paramsAt(10.4))])).toBe(0);
    let prev = 0;
    for (let t = 10.4; t <= DURATION + 1e-9; t += 0.2) {
      const c = coatCoverage([coatEggBlob(paramsAt(t))]);
      expect(c, `t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(c).toBeLessThanOrEqual(1);
      prev = c;
    }
    expect(coatCoverage([coatEggBlob(paramsAt(11.5))])).toBeGreaterThan(0.25);
    expect(coatCoverage([coatEggBlob(paramsAt(13))])).toBeGreaterThan(0.45);
    // a drip's blob adds to it
    const egg = coatEggBlob(paramsAt(11.5));
    expect(coatCoverage([egg, { x: -0.16, z: KEYBOARD_RECT.z0 + 0.02, r: COAT.drip.r, h: COAT.drip.h }])).toBeGreaterThan(coatCoverage([egg]));
  });

  it('the healed sheet wrinkles: none before the heal, most mid-heal, a faint residual after, and it still meets the lip', () => {
    expect(wrinkleAmp(at({ heal: 0 }))).toBe(0);
    const mid = wrinkleAmp(at({ heal: 0.5 })), end = wrinkleAmp(at({ heal: 1 }));
    expect(mid).toBeGreaterThan(3 * end);
    expect(end).toBeGreaterThan(0);
    const p = paramsAt(13);
    expect(sacZ(p, GLASS.hw * 1.0001 * lipOpening(p).hw / GLASS.hw, 0)).toBeCloseTo(lipOpening(p).z, 6);
  });

  it('the tear knits shut: as it heals it narrows to a slit along TEAR_KNIT.angle instead of shrinking as a circle', () => {
    const along = (heal: number) => tearRadius(at({ tear: 0.6, heal }), TEAR_KNIT.angle);
    const across = (heal: number) => tearRadius(at({ tear: 0.6, heal }), TEAR_KNIT.angle + Math.PI / 2);
    expect(along(1)).toBeCloseTo(along(0), 12);
    expect(across(1) / along(1)).toBeLessThan(0.5 * across(0) / along(0));
  });

  it('the picture mapping is the identity at rest, runs 0..1 monotonically, and stretches when pushed', () => {
    const rest = pictureTable(REST);
    expect(rest).toHaveLength(PICTURE_TABLE_N);
    for (let i = 0; i < PICTURE_TABLE_N; i++) expect(rest[i]!).toBeCloseTo(i / (PICTURE_TABLE_N - 1), 9);
    const pushed = pictureTable(at({ push: 1 }));
    expect(pushed[0]).toBe(0);
    expect(pushed[PICTURE_TABLE_N - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < PICTURE_TABLE_N; i++) expect(pushed[i]!).toBeGreaterThan(pushed[i - 1]!);
    // the apex stretches: the picture's centre covers more sheet, so the first steps cover LESS picture than at rest
    expect(pushed[4]!).toBeLessThan(rest[4]!);
    expect(pictureUV(REST, 0.1, -0.05)).toEqual([0.1 / GLASS.hw, -0.05 / GLASS.hh]);
  });

  it('the egg\'s figure stays inside the shell, drifts visibly from second to second, and never darts', () => {
    const steps: number[] = [];
    for (let t = 0; t <= 60; t += 0.05) {
      const fig = figureAt(t);
      expect(fig).toHaveLength(FIGURE_BLOBS.length);
      fig.forEach((c, i) => {
        // each blob's 1.5-sigma box (corners and all: conservative) stays inside the egg
        const sc = FIGURE_BLOBS[i]!.sc;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const q = [c[0] + 1.5 * sx * sc[0], c[1] + 1.5 * sy * sc[1], c[2] + 1.5 * sz * sc[2]];
          expect((q[0]! / EGG.rx) ** 2 + (q[1]! / EGG.ry) ** 2 + (q[2]! / EGG.rz) ** 2, `t=${t.toFixed(2)} blob ${i}`).toBeLessThan(1);
        }
      });
      const a = figureAt(t)[0]!, b = figureAt(t + 1)[0]!;
      steps.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      // continuous: a 50 ms step moves it at most 5 mm
      const n = figureAt(t + 0.05)[0]!;
      expect(Math.hypot(a[0] - n[0], a[1] - n[1], a[2] - n[2])).toBeLessThan(0.005);
    }
    steps.sort((x, y) => x - y);
    // two frames a second apart: the body has moved 2 cm or more nine times in ten (the owner: "you can see something moving"), and
    // never more than 7 cm (a drift, not a dart)
    expect(steps[Math.floor(steps.length * 0.1)]!).toBeGreaterThan(0.02);
    expect(steps[steps.length - 1]!).toBeLessThan(0.07);
    expect(FIGURE_DRIFT.axes).toHaveLength(3);
  });

  it('the shell\'s speckles are 3 to 9 mm across and fit their cells; the vein tree tapers and its branches spread within a sector', () => {
    expect(2 * SHELL.rMin).toBeGreaterThanOrEqual(0.003);
    expect(2 * SHELL.rMax).toBeLessThanOrEqual(0.009);
    expect(SHELL.rMax).toBeLessThanOrEqual(SHELL.cell / 2);           // scrSpots searches only the 2 x 2 x 2 nearest cells
    expect(SHELL.pepper.r).toBeLessThanOrEqual(SHELL.pepper.cell / 2);
    expect(SHELL.density + SHELL.fat).toBeLessThanOrEqual(1);
    expect(VEIN_TREE.taper).toBeLessThan(1);
    for (let k = 1; k < VEIN_TREE.forks.length; k++) {
      expect(VEIN_TREE.forks[k]!).toBeGreaterThan(VEIN_TREE.forks[k - 1]!);
      expect(VEIN_TREE.spread[k]!).toBeLessThan(VEIN_TREE.spread[k - 1]!);
    }
    // the leaves' nominal places (the trunk's jitter and the spreads, before the meander, which the shader clamps) lie inside the trunk's
    // sector, so the one-sector distance is the nearest vein
    expect(0.08 + VEIN_TREE.spread.reduce((a, b) => a + b, 0)).toBeLessThan(0.5);
  });
});
