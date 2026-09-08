import { it } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { stepRig } from '../../rig';
import zombieSrc from '../../characters/zombie.blob?raw';
import { createSkeletonSources } from './contract';

it('measure', () => {
  const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);
  let rig = bound.rig;
  for (let i = 0; i < 60; i++)
    rig = stepRig(rig, 1 / 60, { gravity: [0, -9.8, 0], damping: 0.04, iterations: 4, restStiffness: 0.2 });
  const srcs = createSkeletonSources(body, bound, { character: 'zombie', rig: () => rig });
  const bonePrims = body.bonePrims.filter(b => b.op !== 'organ');
  console.log('segments:', srcs.length, 'bonePrims:', bonePrims.length,
    'organs:', body.bonePrims.length - bonePrims.length, 'flesh prims:', body.prims.length);
  for (const s of srcs)
    console.log(`${s.rigidity.padEnd(6)} ${s.segment.padEnd(28)} prims=${s.primCount} endpErr=${(s.poseEndpointError() * 1000).toFixed(3)}mm bounds=[${s.bounds.min.map(v=>v.toFixed(3))}]..[${s.bounds.max.map(v=>v.toFixed(3))}]`);
});

it('measure-bent-gap', async () => {
  const { applyRig } = await import('../../rig-bind');
  const { sdPrimitive } = await import('../../validate');
  const body = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
  const bound = bindRig(body);
  let rig = bound.rig;
  for (let i = 0; i < 60; i++)
    rig = stepRig(rig, 1 / 60, { gravity: [0, -9.8, 0], damping: 0.04, iterations: 4, restStiffness: 0.2 });
  const posed = applyRig(body, { ...bound, rig });
  const srcs = createSkeletonSources(body, bound, { character: 'zombie', rig: () => rig });
  const keyOf = (i: number) => {
    const p = body.bonePrims[i]!;
    if (p.op === 'organ') return null;
    if (bound.head?.bones.has(i)) return 'head';
    const f = bound.boneFrames.get(i);
    if (f) return `axial:${f.head}-${f.tail}`;
    const b = bound.boneBinding[i]!;
    return `limb:${p.limb}:${b.a.point}-${b.b.point}`;
  };
  for (const s of srcs.filter(s => s.rigidity === 'rigid')) {
    const idxs = body.bonePrims.map((_, i) => i).filter(i => keyOf(i) === s.segment);
    const bent = idxs.filter(i => body.bonePrims[i]!.bend !== undefined);
    if (bent.length === 0) continue;
    let worst = 0;
    const c = s.toWorld([0, 0, 0]);
    for (let x = -0.05; x <= 0.05; x += 0.01) for (let y = -0.05; y <= 0.05; y += 0.01) for (let z = -0.05; z <= 0.05; z += 0.01) {
      const p: [number, number, number] = [c[0] + x, c[1] + y, c[2] + z];
      let ref = Infinity;
      for (const i of idxs) ref = Math.min(ref, sdPrimitive(p, posed.bonePrims[i]!));
      worst = Math.max(worst, Math.abs(s.distance(s.toLocal(p)) - ref));
    }
    console.log(`bent-gap ${s.segment}: bentPrims=${bent.length}/${idxs.length} worst=${(worst * 1000).toFixed(3)}mm`);
  }
});
