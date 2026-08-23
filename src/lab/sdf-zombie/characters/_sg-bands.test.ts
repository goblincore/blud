// TEMP helper: full band table vs mesh for schoolgirl (front+side).
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import src from './schoolgirl.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { parseGlb, gltfTriangles, maskFromTriangles, maskFromBody, compareSilhouette } from '../silhouette';

const RANGE = process.env.SG_RANGE ? (process.env.SG_RANGE!.split(':').map(Number) as [number, number]) : undefined;
const BANDS = Number(process.env.SG_BANDS ?? 24);

it('band table', () => {
  const doc = parseBlob(src);
  const body = buildBody(compileBlob(doc, compileFace(doc)));
  const { json: gltf, bin } = parseGlb(readFileSync('docs/dev-notes/refs/schoolgirl-mesh/schoolgirl.glb'));
  const tris = gltfTriangles(gltf as never, bin!);
  for (const view of ['front', 'side'] as const) {
    const ref = maskFromTriangles(tris, { view, heightPx: 256 });
    const got = maskFromBody(body, { view, heightPx: 256 });
    const rep = compareSilhouette(ref, got, { range: RANGE, bands: BANDS });
    console.log(`=== ${view}  iou ${(rep.iou * 100).toFixed(1)}  mean ${rep.meanWidthError.toFixed(4)}  worst ${'-'}`);
    rep.bands.forEach((b, i) => {
      
      
      const y = 1.70 * (1 - b.at);
      console.log(`  b${String(i).padStart(2)} y ${y.toFixed(3)}  ours ${b.gotWidth.toFixed(3)}  ref ${b.refWidth.toFixed(3)}  d ${(b.delta > 0 ? '+' : '')}${b.delta.toFixed(3)}`);
    });
  }
}, 600000);
