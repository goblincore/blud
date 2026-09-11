// scripts/upscale-make-test-model.ts — writes SEEDED RANDOM weights in the trained-model JSON format
// into the dev model store, so the in-game loader can be smoke-tested before any real export exists.
// It is labelled source "trained" only so the loader path runs; it is not a trained model.
// Usage: npx tsx scripts/upscale-make-test-model.ts [name=test-s8-rgbd] [id=s8] [inputs=rgbd]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUpscaleModel, parseUpscaleConfig, serializeUpscaleModel } from '../src/lab/sdf-zombie/webgpu/upscale/upscale-model';
import { MODEL_NAME_RE, modelStoreRoot } from './lib/upscale-model-store';

const [name = 'test-s8-rgbd', id = 's8', inputs = 'rgbd'] = process.argv.slice(2);
if (!MODEL_NAME_RE.test(name)) throw new Error(`bad model name ${name} (expected ${MODEL_NAME_RE})`);
const cfg = parseUpscaleConfig({ model: id, inputs });
// SEED 1, the same seed the G1-parity reference fixtures use: seed 3's worst sp pixel sits just
// outside the 2e-3 self-check gate on Metal (docs/dev-notes/2026-09-11-neural-upscale/p3c-ingame.md).
const model = { ...createUpscaleModel(cfg.model, cfg.inputs, 1), source: 'trained' as const, run: 'test-random-weights', step: 0 };
const dir = join(modelStoreRoot(process.cwd()), name);
mkdirSync(dir, { recursive: true });
const json = serializeUpscaleModel(model, { trainedOn: { dataset: 'none (seeded random weights)', manifestHash: '0000000000000000' } });
writeFileSync(join(dir, 'model.json'), JSON.stringify(json, null, 1));
console.log(`wrote ${join(dir, 'model.json')} (${cfg.model} ${cfg.inputs}, weightHash ${json.weightHash})`);
