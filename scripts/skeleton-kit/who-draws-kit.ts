// Which characters draw the skeleton kit: for every .blob, whether the kit admits its body (SkeletonKit.admit) and
// the bone segments it then draws. A character it does not admit keeps its extracted bones.
// Usage: npx tsx scripts/skeleton-kit/who-draws-kit.ts [kit.glb]
import { readdirSync, readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../src/lab/sdf-zombie/build-body';
import { bindRig } from '../../src/lab/sdf-zombie/rig-bind';
import { createSkeletonSources } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/contract';
import { SkeletonKit, parseSkeletonKit } from '../../src/lab/sdf-zombie/webgpu/skeleton-spike/skeleton-kit';

const kit = new SkeletonKit(parseSkeletonKit(readFileSync(process.argv[2] ?? 'public/assets/lab/skeleton-kit.glb')));
const dir = 'src/lab/sdf-zombie/characters';
const none: string[] = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.blob')).sort()) {
  const name = file.replace(/\.blob$/, '');
  try {
    const body = buildBody(compileBlob(parseBlob(readFileSync(`${dir}/${file}`, 'utf8'))), DEFAULT_BUILD_OPTS);
    const bones = createSkeletonSources(body, bindRig(body), { character: name }).filter(s => s.kind === 'bone');
    kit.admit(bones);
    const drawn = bones.filter(s => kit.pieceOf(s)).map(s => s.segment);
    if (drawn.length) console.log(`${name}: ${drawn.length} of ${bones.length} bone segments draw kit pieces${drawn.length < bones.length - 1 ? ` (${drawn.join(', ')})` : ''}`);
    else none.push(name);
  } catch (error) {
    console.log(`${name}: did not build (${error instanceof Error ? error.message.slice(0, 80) : error})`);
  }
}
console.log(`no kit piece (extracted bones, as before): ${none.join(', ')}`);
