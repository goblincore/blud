import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { sdBody } from '../../../src/lab/sdf-zombie/validate';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
const gpu = (await dawnDevice())!;
const A = [0, 0, 0], B = [-0.0248, -0.011, -0.156];
for (const k of [1, 16]) {
  const body: any = { prims: [{ a: A, b: B, radius: 0.02, scale: [1, 1, 1], blendK: 0.0035, limb: 'torso', cluster: 0, bend: [0.008 * k, -0.0002 * k, 0.0089 * k] }], clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 1, alive: true }] };
  const f = await GpuField.create(gpu, packBakeBody(body));
  for (const e of [6e-4, 1.5e-3]) {
    // surface points: march CPU from outside toward the axis at random angles along the prim
    const N = 3000; const pts: number[] = [];
    const surf: number[][] = [];
    for (let j = 0; j < N; j++) {
      const t = 0.1 + 0.8 * (j / N); const c = A.map((v, i) => v + (B[i]! - v) * t);
      const th = j * 2.399; const dir = [Math.cos(th), Math.sin(th), 0.15 * Math.sin(3 * th)]; const L = Math.hypot(...dir); const d = dir.map(v => v / L);
      let s = 0.1; let p = c; for (let i = 0; i < 200; i++) { p = c.map((v, q) => v + d[q]! * s); const dd = sdBody(p as any, body); if (Math.abs(dd) < 1e-6) break; s -= dd * 0.9; }
      surf.push(p);
      for (const o of [[e,0,0],[-e,0,0],[0,e,0],[0,-e,0],[0,0,e],[0,0,-e]]) pts.push(...p.map((v, q) => v + o[q]!));
    }
    const got = await f.evaluate(new Float32Array(pts));
    let worst = 0, sum = 0;
    for (let j = 0; j < N; j++) {
      const g = [got[j*6]! - got[j*6+1]!, got[j*6+2]! - got[j*6+3]!, got[j*6+4]! - got[j*6+5]!];
      const pp = (m: number) => [pts[j*18+m*3]!, pts[j*18+m*3+1]!, pts[j*18+m*3+2]!] as any;
      const c = [sdBody(pp(0), body) - sdBody(pp(1), body), sdBody(pp(2), body) - sdBody(pp(3), body), sdBody(pp(4), body) - sdBody(pp(5), body)];
      const ng = Math.hypot(...g), nc = Math.hypot(...c);
      const cos = (g[0]! * c[0]! + g[1]! * c[1]! + g[2]! * c[2]!) / (ng * nc);
      const deg = Math.acos(Math.min(1, cos)) * 180 / Math.PI; worst = Math.max(worst, deg); sum += deg;
    }
    console.log(`bend x${k}, eps ${e}: normal error mean ${(sum / N).toFixed(3)} deg, worst ${worst.toFixed(2)} deg`);
  }
  f.destroy();
}
