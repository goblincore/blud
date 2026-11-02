import { packBakeBody } from '../../../src/lab/sdf-zombie/body-normal-bake/gpu-pack';
import { sdBody } from '../../../src/lab/sdf-zombie/validate';
import { dawnDevice, GpuField } from '../../../scripts/lib/dawn-field';
import { samplePoints } from '../../../scripts/body-normal-bake/gpu-parity-lib';
const gpu = (await dawnDevice())!;
const base = { a: [-0.3791, 1.5167, -0.3461], b: [-0.4039, 1.5057, -0.5021], radius: 0.02, scale: [1, 1, 1], blendK: 0.0035, limb: 'torso', cluster: 0 };
for (const k of [0.25, 1, 4, 16]) {
  for (const shift of [0, 1]) {
    const off = shift ? [0.3791, -1.5167 + 0.1, 0.3461] : [0, 0, 0];
    const a = base.a.map((v, i) => v + off[i]!), b = base.b.map((v, i) => v + off[i]!);
    const body: any = { prims: [{ ...base, a, b, bend: [0.008 * k, -0.0002 * k, 0.0089 * k] }], clusters: [{ id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0, 0], radius: 1, alive: true }] };
    const f = await GpuField.create(gpu, packBakeBody(body));
    const pts = samplePoints(body, 20000, 3); const got = await f.evaluate(pts);
    let me = 0; for (let j = 0; j < 20000; j++) me = Math.max(me, Math.abs(got[j]! - sdBody([pts[j*3]!, pts[j*3+1]!, pts[j*3+2]!], body)));
    console.log(`bend x${k} ${shift ? 'near origin' : 'at |p|~1.6'}: max err ${me.toExponential(2)}`);
    f.destroy();
  }
}
