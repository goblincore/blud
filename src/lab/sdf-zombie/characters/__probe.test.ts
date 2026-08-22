// TEMPORARY PROBE — delete before final commit. Camera-free measurements of
// the compiled mouse head: front/back z extent per height, ear extents.
import { it } from 'vitest';
import src from './mouse.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';

it('probe head extents', () => {
  const doc = parseBlob(src);
  const b = buildBody(compileBlob(doc, compileFace(doc)));
  console.log('errors', b.errors);
  const surfaceZ = (y: number, z0: number, z1: number, x = 0) => {
    // march z, return last inside point
    let last = NaN;
    for (let z = z0; z <= z1; z += 0.001)
      if (sdBody([x, y, z], b) < 0) last = z;
    return last;
  };
  const backAt = (y: number, x = 0) => {
    for (let z = -0.4; z <= 0.6; z += 0.001)
      if (sdBody([x, y, z], b) < 0) return z;
    return NaN;
  };
  for (let y = 0.60; y <= 1.101; y += 0.025) {
    const front = surfaceZ(y, -0.4, 0.6);
    const back = backAt(y);
    // x extent at this height
    let xr = NaN;
    for (let x = 0; x <= 0.45; x += 0.001)
      if (sdBody([x, y, 0.0], b) < 0) xr = x;
    console.log(`y=${y.toFixed(3)} front=${front.toFixed(3)} back=${back.toFixed(3)} depth=${(front - back).toFixed(3)} x=${xr.toFixed(3)}`);
  }
  // ear: max x anywhere, and its z thickness at that point's height
  let earX = 0, earY = 0;
  for (let y = 0.8; y <= 1.15; y += 0.005)
    for (let x = 0; x <= 0.45; x += 0.002)
      if (sdBody([x, y, 0.0], b) < 0 && x > earX) { earX = x; earY = y; }
  console.log('ear max x', earX.toFixed(3), 'at y', earY.toFixed(3));
  const earFront = surfaceZ(earY, -0.2, 0.3, earX - 0.02);
  const earBack = backAt(earY, earX - 0.02);
  console.log('ear z thickness near rim', (earFront - earBack).toFixed(3));
  // crown top and ear top
  const topAt = (x: number, z: number) => {
    let last = NaN;
    for (let y = 0.5; y <= 1.3; y += 0.001)
      if (sdBody([x, y, z], b) < 0) last = y;
    return last;
  };
  console.log('crown top', topAt(0, 0).toFixed(3), 'ear top', topAt(0.17, 0).toFixed(3));
});
