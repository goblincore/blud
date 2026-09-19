// src/lab/sdf-zombie/webgpu/march/primitives.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `primitives`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import {
  HELPERS,
  DATA_ROWS,
  SD_PRIM,
  SD_PRIM_ORIENTED,
  MAP_BODY,
  APPLY_CARVES,
  CONE_CAP,
  SMIN_CHAMFER,
  SD_GROOVE,
  CONE_BEND,
  SD_BEZIER_T,
  ROW_PRIM_A,
  ROW_PRIM_B,
  ROW_PRIM_SCALE,
  ROW_PRIM_QUAT,
  ROW_PRIM_BEND,
  ROW_PRIM_SHELL,
  ROW_PRIM_WARP,
  ROW_PRIM_CLIP,
  SD_SHELL,
  SD_ROUND_BOX,
} from '../march.wgsl';
import { sdBody, sdPrimitive, MAX_PRIMS } from '../../validate';
import { packBody } from '../../pack';
import { add, cross, scale as vscale, sub, qFromAxisAngle, qNormalize } from '../../vec';
import type { Primitive, Vec3 } from '../../types';
import { declaredName } from '../march-test-support';

describe('ported features reach the entry point', () => {

  it('grooves cut a channel rather than subtracting a solid', () => {
    const applyCarves = HELPERS.find(h => declaredName(h) === 'applyCarves')!;
    // ONE sd evaluation feeds both branches, the same invariant mapBody's fold
    // keeps — evaluating the field twice is how the two paths drift apart.
    expect(applyCarves).toContain('let sd = select(sdPrim(p, idx, data, r2, prof, cpos, band), sdPrimO(p, idx, data, r2, prof, cpos, band), ori);');
    expect(applyCarves).toContain('if (isGroove) { d = sdGroove(d, sd, gr.x, gr.y); } else { d = smax(d, -sd, k); }');
    // Depth and width ride primShape.zw, spare since the taper claimed xy.
    expect(applyCarves).toContain('gr = T.zw;');
    // The BAND GATE, which hg_sdf's original does not have. Without it the
    // whole interior lifts by the groove depth — see sdGroove in validate.ts.
    expect(SD_GROOVE).toContain('let inBand = rb - abs(b);');
    expect(SD_GROOVE).toContain('if (inBand <= 0.0) { return a; }');
    expect(SD_GROOVE).toContain('max(a, min(a + ra, inBand))');
  });
});

describe('CPU field mirror is pinned', () => {
  // validate.ts's sdPrimitive/smin are mirrored line-for-line by the WGSL, and
  // that mirror backs click-to-shoot raycasting — drift means shots land where
  // the body isn't. Nothing can diff the two automatically, so this pins the
  // CPU half: if someone edits the maths, these numbers move and the WGSL beside
  // them gets read.
  const capsule: Primitive = {
    a: [0, 0, 0], b: [0, 0.4, 0], radius: 0.1,
    scale: [1, 1, 1], blendK: 0.02, limb: 'torso', cluster: 0,
  };
  const ball: Primitive = {
    a: [0, 0.5, 0], b: [0, 0.5, 0], radius: 0.15,
    scale: [1, 1.2, 1], blendK: 0.02, limb: 'head', cluster: 0,
  };
  const body = {
    prims: [capsule, ball],
    clusters: [{
      id: 0, limb: 'torso' as const, start: 0, count: 2,
      center: [0, 0.25, 0] as const, radius: 0.8, alive: true,
    }],
  };

  // Every value below was worked out by hand against the capsule/ellipsoid
  // formulae and iq's smin, not recorded from a run — a pin copied from output
  // certifies whatever the code did on the day, including a bug.
  it.each([
    // Inside the capsule, well outside smin's blend zone: the plain min wins.
    [[0, 0.2, 0], -0.1],
    // Outside both, inside the blend: 0.2 - h*h*k*0.25 with h = 0.4938.
    [[0.3, 0.2, 0], 0.195127],
    // Just outside the capsule's 0.1 radius, and the ball is further still.
    [[0, 0.2, 0.15], 0.05],
    // Dead centre of the ball. The 1.2 y-scale divides in, so the ellipsoid
    // reads -0.15 and the capsule's endpoint reads exactly 0.
    [[0, 0.5, 0], -0.15],
    // Both surfaces near, so the blend deepens the min by 0.001467.
    [[0, 0.45, 0], -0.10980],
    // Clear of the body: the ellipsoid's scaled distance, not the capsule's.
    [[0, 1.2, 0], 0.433333],
  ] as [number[], number][])('sdBody(%j) stays at %f', (p, want) => {
    expect(sdBody(p as [number, number, number], {
      ...body,
      clusters: body.clusters.map(c => ({ ...c, center: [...c.center] as [number, number, number] })),
    })).toBeCloseTo(want, 3);
  });
});

describe('tapered primitive and chamfer fold', () => {
  // String pins on the DECISIVE lines. The round cone's three-branch structure
  // is where a port goes wrong — swap a sign or a comparison and it still
  // compiles, still returns plausible distances, and quietly reports the wrong
  // surface. The semantics are proven on the CPU side in taper.test.ts; this
  // proves the shader is running the same construction, and this field backs
  // click-to-shoot, so a divergence lands shots where nothing is drawn.
  it('coneCap keeps the round cone\'s branch structure', () => {
    expect(CONE_CAP).toContain('if (sign(z) * a2 * z2 > k)');
    expect(CONE_CAP).toContain('if (sign(y) * a2 * y2 < k)');
    expect(CONE_CAP).toContain('let k = sign(rr) * rr * rr * x2;');
  });

  // The untapered branch is not an optimisation. With r1 == r2 the round cone
  // is mathematically identical but NOT bit-identical, and
  // characters/zombie-blob.test.ts pins the shipped zombie to 0.1 mm.
  it('coneCap takes the plain capsule path when r2 is negative', () => {
    expect(CONE_CAP).toContain('if (r2 < 0.0) {');
    expect(CONE_CAP).toContain('let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);');
  });

  // One NaN in a smooth-min fold takes the whole body with it, and a blob with
  // a zero `tip=` has a === b, which is exactly where the divisions blow up.
  it('coneCap guards coincident endpoints before dividing by their separation', () => {
    const guard = CONE_CAP.indexOf('if (l2 < 1e-12)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(CONE_CAP.indexOf('let il2 = 1.0 / l2;'));
  });

  it('sminChamfer shares smin\'s width convention and its k <= 0 degenerate', () => {
    // Same `kIn * 4.0`, so one authored `blend=` means a comparable reach in
    // either profile and swapping them is not also a size change.
    expect(SMIN_CHAMFER).toContain('let k = kIn * 4.0;');
    expect(SMIN_CHAMFER).toContain('if (k <= 0.0) { return min(a, b); }');
    expect(SMIN_CHAMFER).toContain('(a - k + b) * 0.70710678');
  });
});

describe('arc capsule — bent primitives', () => {
  // The Bezier path is gated on primShape.y >= 2 (profile + bend), so an
  // unbent cluster never pays for ROW_PRIM_BEND — the same hoist that keeps
  // an untapered body from paying for the shape row, which measured +10-18%
  // frame time when it was missing.
  it('loads ROW_PRIM_BEND only for prims whose profile encodes bend', () => {
    // The prim loop lives in foldGroup now (shared by the cluster walk and
    // the tile-list path); APPLY_CARVES keeps its own copy.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(APPLY_CARVES).toContain(`cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;`);
    expect(foldGroup).toContain(
      `cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;`);
    for (const src of [foldGroup, APPLY_CARVES]) {
      // Bit 1 (value 2) of prof means bend, tested before the load so an
      // unbent — or straight-shell (prof 4) — prim never pays for the row.
      const gateAt = src.indexOf('if ((i32(prof) & 2) != 0) {');
      expect(gateAt).toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(src.indexOf('cpos = textureLoad'));
    }
  });

  // Chamfer must be an EXACT bit-0-only match (`& 7 == 1`), not a magnitude
  // window: a magnitude window ("prof > 0.5 && prof < 1.5") happened to also
  // exclude bend (bit 1, +2) and shell (bit 2, +4) only because neither ever
  // pushed prof outside (0.5, 1.5) on its own — true while prof topped out
  // at 6. A BOX adds bit 3 (+8), so a chamfered box packs as 9, which a
  // magnitude window puts OUTSIDE (0.5, 1.5) — silently folding it round.
  // `& 7 == 1` isolates the low three bits and asks for exactly chamfer,
  // which is immune to any bit above it, box included.
  it('isolates chamfer with a low-bit mask, not a magnitude window (immune to bit 3)', () => {
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
  });

  // One NaN takes the entire body: the degenerate guard must sit before the
  // Bezier evaluation it protects, exactly as coneCap's l2 guard sits before
  // its division.
  it('coneBend guards collinear control points before evaluating the curve', () => {
    const guard = CONE_BEND.indexOf('if (dot(bb, bb) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(CONE_BEND.indexOf('sdBezierT('));
    // ...and the coincident-ends twin right beside it.
    expect(CONE_BEND).toContain('if (dot(b - a, b - a) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }');
  });

  // iq's construction divides by dot of the quadratic coefficient; that is
  // where infinity comes from. The guard's position relative to the call is
  // pinned above; this pins that the helper really carries the division.
  it('sdBezierT is the Cardano/trigonometric cubic solve with the stability fix', () => {
    expect(SD_BEZIER_T).toContain('let kk = 1.0 / dot(bv, bv);');
    expect(SD_BEZIER_T).toContain('if (abs(pp) < 1e-4 && qq != 0.0) {');
    expect(SD_BEZIER_T).toContain('acos(clamp(qq / (pp * z * 2.0), -1.0, 1.0)) / 3.0');
  });

  it('sits in HELPERS between CONE_CAP and sdPrim, declared before use', () => {
    // WGSL requires declaration before use; an omitted helper passes every
    // unit test and fails at pipeline creation (the empty-SDF-layer trap).
    expect(HELPERS.indexOf(CONE_CAP)).toBeLessThan(HELPERS.indexOf(SD_BEZIER_T));
    expect(HELPERS.indexOf(SD_BEZIER_T)).toBeLessThan(HELPERS.indexOf(CONE_BEND));
    expect(HELPERS.indexOf(CONE_BEND)).toBeLessThan(HELPERS.indexOf(SD_PRIM));
    expect(SD_PRIM).toContain('coneBend(p * inv');
    expect(SD_PRIM_ORIENTED).toContain('coneBend(qq, a, b, c * inv');
  });
});

describe('shell fold — the thin clipped sheet (2026-08-25)', () => {
  it('sdShell is in HELPERS and implements abs(dBase)-thick with the rounded-rim clip', () => {
    expect(HELPERS).toContain(SD_SHELL);
    expect(SD_SHELL).toContain('let d = abs(base) - thick;');
    // The rim: distance to the sheet/plane intersection curve + rounding.
    expect(SD_SHELL).toContain('rim - length(vec2(d, dPlane))');
  });

  it('the fold reads the shell rows and wraps the field when profile marks a shell', () => {
    // The prim loop moved out of mapBody into foldGroup when tile binning
    // landed — the cluster walk and the tile-list path share it, so pinning
    // mapBody here would pass while the shell silently vanished from BOTH.
    const fold = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    // A shell is profile bit 2 (value 4); the fold must read both shell rows
    // and pass them to sdShell, and a straight shell (prof 4) must NOT take the
    // bend row (bit test, equivalent to prof > 1.5 on the 0-3 range). The gate
    // itself must be a bit test too — a BOX (bit 3, value 8) has bit 2 clear,
    // so "prof >= 4" would wrongly fold it as a shell (its shell/clip rows
    // are all zero); "& 4 != 0" reads only bit 2.
    expect(fold).toContain(`textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHELL} + band), 0)`);
    expect(fold).toContain(`textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_CLIP} + band), 0)`);
    expect(fold).toContain('if ((i32(prof) & 4) != 0) {');
    expect(fold).toContain(`textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_WARP} + band), 0)`);
    expect(fold).toContain('sd = sdShell(sd, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);');
    const profGate = fold.indexOf('if ((i32(prof) & 4) != 0) {');
    const bendGate = fold.indexOf('if ((i32(prof) & 2) != 0) {');
    // The shell wrap must come AFTER the base field is computed (sdPrim) and
    // the bend ctrl loaded; ordering is load-bearing for the fold.
    expect(profGate).toBeGreaterThan(fold.indexOf('var sd = sdPrim(p, idx, data, r2, prof, cpos, band);'));
    expect(bendGate).toBeGreaterThan(-1);
    expect(profGate).toBeGreaterThan(bendGate);
  });
});

describe('BOX bit (prof +8) does not break the shell/chamfer readers (task 5 follow-up)', () => {
  // pack.ts (task 5) gave a BOX primitive bit 3 (value 8) of prof. Two
  // readers in foldGroup used to test prof by MAGNITUDE rather than by bit
  // — correct only as long as bit 2 (shell, value 4) was the highest bit
  // anyone ever set, which stopped being true the moment a box could set
  // bit 3 on top. Both are pinned here as NEGATIVE literal checks (the old
  // magnitude form must be gone, not just "a mask form also exists") so a
  // future edit that reintroduces either magnitude test fails loudly.
  const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;

  it('shell gate is a bit test, not "prof >= 4.0" — a lone box (prof 8) is not a shell', () => {
    // 8 >= 4 is true, so the old magnitude test would have loaded
    // ROW_PRIM_SHELL/ROW_PRIM_CLIP for a box (both all-zero — see pack.ts)
    // and wrapped it as a zero-thickness shell instead of leaving it as the
    // plain body sdPrim already computed.
    expect(foldGroup).not.toContain('prof >= 4.0');
    expect(foldGroup).toContain('if ((i32(prof) & 4) != 0) {');
  });

  it('chamfer gate is a bit test, not "prof > 0.5 && prof < 1.5" — a chamfered box (prof 9) still chamfers', () => {
    // 9 falls outside (0.5, 1.5), so the old magnitude window would have
    // silently folded a chamfered box round — the author writes `chamfer`,
    // pack.ts packs bit 0, and the crease never appears.
    expect(foldGroup).not.toContain('prof > 0.5 && prof < 1.5');
    expect(foldGroup).toContain('if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }');
  });
});

describe('sdRoundBox in WGSL (task 6 — the GPU field)', () => {
  // String pins: these prove the branch EXISTS and is wired the way the CPU
  // field requires. The numeric PARITY test below proves its MATHS agree
  // with sdRoundBox/sdPrimitive's box branch in validate.ts — string
  // containment alone cannot catch a transposed operand or a missing
  // `* minScale`.
  it('sdRoundBox is defined, mirroring validate.ts\'s sdRoundBox exactly', () => {
    expect(declaredName(SD_ROUND_BOX)).toBe('sdRoundBox');
    expect(SD_ROUND_BOX).toContain('let q = abs(p) - e;');
    expect(SD_ROUND_BOX).toContain('length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r');
  });

  it('registers sdRoundBox in HELPERS before sdPrim and sdPrimO, which call it', () => {
    const names = HELPERS.map(declaredName);
    const boxIdx = names.indexOf('sdRoundBox');
    const primIdx = names.indexOf('sdPrim');
    const primOIdx = names.indexOf('sdPrimO');
    expect(boxIdx).toBeGreaterThan(-1);
    expect(boxIdx).toBeLessThan(primIdx);
    expect(boxIdx).toBeLessThan(primOIdx);
  });

  it('sdPrim and sdPrimO both branch on the box bit (& 8), and it appears before the bend bit (& 2)', () => {
    // Matched with the `if (` prefix, not on the bit test alone: the STRAND
    // branch above these reads the same bit inside a select() to decide
    // whether coneStrand may use the control point, and a bare substring
    // search finds THAT first and reports the gates as mis-ordered.
    for (const src of [SD_PRIM, SD_PRIM_ORIENTED]) {
      const boxGate = src.indexOf('if ((i32(prof) & 8) != 0)');
      const bendGate = src.indexOf('if ((i32(prof) & 2) != 0)');
      expect(boxGate).toBeGreaterThan(-1);
      expect(bendGate).toBeGreaterThan(-1);
      expect(boxGate).toBeLessThan(bendGate);
    }
  });

  it('the box branch calls sdRoundBox, reads round from ROW_PRIM_BEND.w, and applies minScale', () => {
    // A box never sets the bend bit (bend= is rejected on a box at compile
    // time — Task 2), so the caller's cpos/cpos-row fetch never runs for one;
    // the box branch must fetch ROW_PRIM_BEND itself, which is what makes
    // sharing that row's .w with a bent prim's .xyz safe.
    for (const src of [SD_PRIM, SD_PRIM_ORIENTED]) {
      expect(src).toContain('sdRoundBox(');
      expect(src).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND} + band), 0).w`);
      const boxBranch = src.slice(
        src.indexOf('if ((i32(prof) & 8) != 0)'), src.indexOf('if ((i32(prof) & 2) != 0)'));
      expect(boxBranch).toContain('* minScale');
    }
  });

  /**
   * Line-for-line TS transcription of the box branch shared by sdPrim and
   * sdPrimO — identical once p/a/b are in the prim's rotated, scale-divided
   * frame, which the "PARITY: CPU sdPrimitive matches the WGSL math on
   * random oriented prims" test above already proves sdPrimO's rotation
   * prefix produces correctly. Mirrors sdPrimitive's `if (prim.box)` branch
   * in validate.ts and sdRoundBox itself. Kept in sync BY HAND, like every
   * other WGSL transcription in this file — this proves the WGSL MATHS agree
   * with the CPU field's; it does NOT compile or execute WGSL, so it cannot
   * catch a mistake shared identically by both transcriptions, and it says
   * nothing about GPU-side texture layout, precision, or driver behaviour.
   * `blob:render-check` is the real parity gate for those.
   */
  function sdBoxWgsl(p: Vec3, i: number, tex: Float32Array): number {
    const load = (row: number): number[] => {
      const o = (row * MAX_PRIMS + i) * 4;
      return [tex[o]!, tex[o + 1]!, tex[o + 2]!, tex[o + 3]!];
    };
    const A = load(ROW_PRIM_A), B = load(ROW_PRIM_B), S = load(ROW_PRIM_SCALE);
    const bendRow = load(ROW_PRIM_BEND);
    const inv: Vec3 = [1 / S[0]!, 1 / S[1]!, 1 / S[2]!];
    const qq: Vec3 = [p[0] * inv[0], p[1] * inv[1], p[2] * inv[2]];
    const a: Vec3 = [A[0]! * inv[0], A[1]! * inv[1], A[2]! * inv[2]];
    const b: Vec3 = [B[0]! * inv[0], B[1]! * inv[1], B[2]! * inv[2]];
    const ab = sub(b, a);
    const ap = sub(qq, a);
    const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = ab2 === 0 ? 0
      : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2));
    const closest: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const minScale = Math.min(S[0]!, S[1]!, S[2]!);
    const round = bendRow[3]!;
    const e = A[3]! * (1 - round);
    const r = A[3]! * round;
    const rp: Vec3 = [qq[0] - closest[0], qq[1] - closest[1], qq[2] - closest[2]];
    const qx = Math.abs(rp[0]) - e, qy = Math.abs(rp[1]) - e, qz = Math.abs(rp[2]) - e;
    return (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0))
      + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r) * minScale;
  }

  it('PARITY: WGSL box branch matches sdPrimitive on random box prims, isotropic and anisotropic', () => {
    let seed = 0xb0f5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 40; trial++) {
      const centre: Vec3 = [rnd() * 2 - 1, 1 + rnd(), rnd() * 2 - 1];
      const span = rnd() * 0.12;
      const round = rnd(); // 0 = sharp box, 1 = exactly the capsule
      const prim: Primitive = {
        a: [centre[0], centre[1] - span, centre[2]],
        b: [centre[0], centre[1] + span, centre[2]],
        radius: 0.03 + rnd() * 0.1,
        // Anisotropic every trial: * minScale is invisible to a point ON the
        // box surface (0 * anything === 0), so points below are NOT
        // constrained to the surface — this is what makes the test sensitive
        // to a missing or misplaced `* minScale`.
        scale: [0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4],
        blendK: 0.02, limb: 'torso', cluster: 0,
        box: { round },
      } as unknown as Primitive;
      const packed = packBody({
        prims: [prim],
        clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 10, alive: true }],
        bones: new Map(), bonePrims: [],
      });
      const tex = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
      tex.set(packed.primA, ROW_PRIM_A * MAX_PRIMS * 4);
      tex.set(packed.primB, ROW_PRIM_B * MAX_PRIMS * 4);
      tex.set(packed.primScale, ROW_PRIM_SCALE * MAX_PRIMS * 4);
      tex.set(packed.primBend, ROW_PRIM_BEND * MAX_PRIMS * 4);
      for (let s = 0; s < 25; s++) {
        const p: Vec3 = [
          centre[0] + (rnd() - 0.5) * 0.8,
          centre[1] + (rnd() - 0.5) * 0.8,
          centre[2] + (rnd() - 0.5) * 0.8,
        ];
        expect(sdPrimitive(p, prim)).toBeCloseTo(sdBoxWgsl(p, 0, tex), 4);
      }
    }
  });
});

describe('per-prim orientation (motion-polish task 3)', () => {
  it('sdPrimO reads the quat row and guards identity prims with a cheap branch', () => {
    // String pins: the parity test below proves the CPU mirror, these prove
    // the WGSL actually contains the branch being mirrored.
    expect(SD_PRIM_ORIENTED).toContain(`textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT} + band), 0)`);
    // Was 11; the arc capsule added ROW_PRIM_BEND, per-primitive colour added
    // ROW_PRIM_COLOR, bound groups added ROW_GROUP_BOUNDS/RANGE and
    // ROW_CLUSTER_GROUPS, and the shell fold added ROW_PRIM_SHELL/ROW_PRIM_CLIP
    // — each without displacing any existing row. The wound depth slab added
    // ROW_WOUND_CAP (2026-08-27, pale-wound fix). The entrails cavity flag
    // added ROW_WOUND_FLAGS (2026-09-02). The shell cloth spike added
    // ROW_PRIM_WARP and hairlock ROW_PRIM_STRAND (both 2026-09-05 — they
    // collided on index 20 across two branches; see ROW_PRIM_STRAND's doc).
    expect(DATA_ROWS).toBe(22);
    expect(SD_PRIM_ORIENTED).toContain('abs(1.0 - O.w) > 1e-6');
  });

  it('sdPrim stays the plain world-axis capsule, diffable against the frozen GLSL', () => {
    expect(SD_PRIM).not.toContain('QUAT');
    expect(SD_PRIM).not.toContain('cross(');
  });

  it('mapBody hoists BOTH per-prim branches to the cluster flag (clusterRange.w)', () => {
    // Paying the quat textureLoad per prim measured +10-18% frame time; the
    // hoist makes everything but a turned head cluster take the plain path.
    // ROW_PRIM_SHAPE arrived later and is hoisted the same way for the same
    // reason, so range.w is now a BITFIELD (1 oriented, 2 shaped) rather than
    // the bool it started as. A cluster with no tapered or chamfered prim
    // never reads the shape row at all.
    const foldGroup = HELPERS.find(h => declaredName(h) === 'foldGroup')!;
    expect(foldGroup).toContain('let flags = i32(grp.w + 0.5);');
    expect(foldGroup).toContain('let ori = (flags & 1) != 0;');
    expect(foldGroup).toContain('let shaped = (flags & 2) != 0;');
    expect(foldGroup).toContain('if (shaped) {');
    // BOTH fold paths call foldGroup with the group texels, so neither can
    // drift from the other's sphere-cull or flag semantics.
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, gTileBounds[e], gTileGrp[e]);');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, bounds, range);');
    // The carve pass reads the same bitfield, so a tapered carve is a taper in
    // BOTH fields. This one backs click-to-shoot; a divergence here lands
    // shots where nothing is drawn.
    expect(APPLY_CARVES).toContain('let flags = i32(range.w + 0.5);');
    expect(APPLY_CARVES).toContain('if (shaped) {');
    expect(APPLY_CARVES).toContain('r2 = T.x;');
  });

  /**
   * Line-for-line TS transcription of the WGSL sdPrimO, reading from a
   * Float32Array laid out exactly like the data texture (row-major,
   * MAX_PRIMS wide). Kept in sync BY HAND, like the march-tracer
   * transcriptions — the string pins above prove the branch exists; this
   * proves its semantics match validate.sdPrimitive, which backs
   * click-to-shoot.
   */
  function sdPrimWgsl(p: Vec3, i: number, tex: Float32Array): number {
    const load = (row: number): number[] => {
      const o = (row * MAX_PRIMS + i) * 4;
      return [tex[o]!, tex[o + 1]!, tex[o + 2]!, tex[o + 3]!];
    };
    const A = load(ROW_PRIM_A), B = load(ROW_PRIM_B), S = load(ROW_PRIM_SCALE);
    let qq: Vec3 = [p[0], p[1], p[2]];
    let a: Vec3 = [A[0]!, A[1]!, A[2]!];
    let b: Vec3 = [B[0]!, B[1]!, B[2]!];
    const O = load(ROW_PRIM_QUAT);
    if (Math.abs(1 - O[3]!) > 1e-6) {
      const mid = vscale(add(a, b), 0.5);
      const u: Vec3 = [-O[0]!, -O[1]!, -O[2]!];
      const w = O[3]!;
      const rot = (x: Vec3): Vec3 => {
        const v = sub(x, mid);
        const t = vscale(cross(u, v), 2);
        return add(mid, add(v, add(vscale(t, w), cross(u, t))));
      };
      qq = rot(qq); a = rot(a); b = rot(b);
    }
    const inv: Vec3 = [1 / S[0]!, 1 / S[1]!, 1 / S[2]!];
    qq = [qq[0] * inv[0], qq[1] * inv[1], qq[2] * inv[2]];
    a = [a[0] * inv[0], a[1] * inv[1], a[2] * inv[2]];
    b = [b[0] * inv[0], b[1] * inv[1], b[2] * inv[2]];
    const ab = sub(b, a), ap = sub(qq, a);
    const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = ab2 === 0 ? 0
      : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2));
    const minScale = Math.min(S[0]!, S[1]!, S[2]!);
    return (Math.hypot(qq[0] - (a[0] + ab[0] * t), qq[1] - (a[1] + ab[1] * t), qq[2] - (a[2] + ab[2] * t))
      - A[3]!) * minScale;
  }

  it('PARITY: CPU sdPrimitive matches the WGSL math on random oriented prims', () => {
    // Deterministic RNG — a parity test that flakes is worse than none.
    let seed = 0x5eed;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 40; trial++) {
      const centre: Vec3 = [rnd() * 2 - 1, 1 + rnd(), rnd() * 2 - 1];
      const span = rnd() * 0.15; // 0 = sphere (the face case), else capsule
      const axis = qFromAxisAngle([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5] as Vec3, rnd() * 2.4);
      const prim: Primitive = {
        a: [centre[0], centre[1] - span, centre[2]],
        b: [centre[0], centre[1] + span, centre[2]],
        radius: 0.03 + rnd() * 0.1,
        scale: [0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4, 0.4 + rnd() * 1.4],
        blendK: 0.02, limb: 'head', cluster: 0,
        // Half the trials identity (absent), half a real rotation.
        orient: trial % 2 === 0 ? undefined : qNormalize(axis),
      };
      const packed = packBody({
        prims: [prim],
        clusters: [{ id: 0, limb: 'head', start: 0, count: 1, center: [0, 0, 0], radius: 10, alive: true }],
        bones: new Map(), bonePrims: [],
      });
      const tex = new Float32Array(MAX_PRIMS * DATA_ROWS * 4);
      tex.set(packed.primA, ROW_PRIM_A * MAX_PRIMS * 4);
      tex.set(packed.primB, ROW_PRIM_B * MAX_PRIMS * 4);
      tex.set(packed.primScale, ROW_PRIM_SCALE * MAX_PRIMS * 4);
      tex.set(packed.primQuat, ROW_PRIM_QUAT * MAX_PRIMS * 4);
      for (let s = 0; s < 25; s++) {
        const p: Vec3 = [
          centre[0] + (rnd() - 0.5) * 0.8,
          centre[1] + (rnd() - 0.5) * 0.8,
          centre[2] + (rnd() - 0.5) * 0.8,
        ];
        // f32 packing rounds the inputs, so tolerance is f32-scale, not f64.
        expect(sdPrimitive(p, prim)).toBeCloseTo(sdPrimWgsl(p, 0, tex), 4);
      }
    }
  });
});

describe('coneBend and the untapered sentinel', () => {
  // sdPrim hands every prim without r2= a -1; coneCap has always branched on
  // it, coneBend did not, and an untapered bent capsule rendered as one
  // sphere at its start end (the mouse's sunglass lens, 2026-08-22).
  it('treats r2 < 0 as "same radius at both ends", like coneCap', () => {
    expect(CONE_BEND).toContain('let rb = select(r2, r1, r2 < 0.0);');
    expect(CONE_BEND).not.toContain('(r1 + (r2 - r1) * t)');
    expect(CONE_BEND).toContain('(r1 + (rb - r1) * t)');
  });
});
