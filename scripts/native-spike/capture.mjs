// scripts/native-spike/capture.mjs
//
// NATIVE-RENDERER SPIKE, step 1 driver: boot sdf-game.html with inject.js
// installed, stage a scene, record one hand-stepped frame's matching render
// passes and write them to a capture directory:
//
//   <out>/manifest.json   every GPU object the passes reference + the commands
//   <out>/*.bin           buffer and texture contents as each pass saw them
//
// The same directory feeds both replayers: replay.html (bare WebGPU in Chrome)
// and native/march-replay (wgpu). Run through capture.sh, which owns the vite
// and Chrome lifecycle.
//
//   SPIKE_SCENE   closeup (default) | crowd | asis
//   SPIKE_PASSES  regex over the pass label (default ^sdf:march$)
//   SPIKE_QUERY   extra query string for sdf-game.html (e.g. level=night-train)
//   SPIKE_PRELUDE JS evaluated in the page after staging, before the capture
//   SPIKE_CROWD   bodies for the crowd scene (default 12)
//   SPIKE_VARIANTS  'name=js;name=js' — one capture per variant from one boot, into <out>-<name>
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyShipDefaults, bootCloseupPage, connectGame, failHard, sleep, stageCloseUp,
} from '../lib/sdf-closeup-stage.mjs';
import { waitForLoader } from '../lib/wait-loader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9291);
const OUT = process.argv[4] ?? '.scratch/native-spike/capture';
const SCENE = process.env.SPIKE_SCENE ?? 'closeup';
const PASSES = process.env.SPIKE_PASSES ?? '^sdf:march$';
const QUERY = process.env.SPIKE_QUERY ?? '';
const PRELUDE = process.env.SPIKE_PRELUDE ?? '';
const CROWD = Number(process.env.SPIKE_CROWD ?? 12);
const W = Number(process.env.GAME_W ?? 1280);
const H = Number(process.env.GAME_H ?? 800);


// The page POSTs each blob here; CDP's returnByValue is no place for 16 MB of
// rgba32float.
let blobBytes = 0;
let sinkDir = OUT;
const sink = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const m = /^\/blob\/([\w.-]+)$/.exec(req.url ?? '');
  if (req.method !== 'POST' || !m) { res.writeHead(404).end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    blobBytes += body.length;
    writeFileSync(join(sinkDir, m[1]), body);
    res.writeHead(200).end();
  });
});
await new Promise((ok) => sink.listen(0, '127.0.0.1', ok));
const sinkUrl = `http://127.0.0.1:${sink.address().port}`;

const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H });
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(join(HERE, 'inject.js'), 'utf8') });
const url = `http://localhost:${VITE}/sdf-game.html${QUERY ? `?${QUERY}` : ''}`;
await bootCloseupPage({ send, evaluate, url });
await waitForLoader(evaluate, { fail: failHard });
if (!(await evaluate('!!(window.__cap && window.__cap.device)'))) failHard('inject.js never saw a GPUDevice');

// gpu-pass-timing owns the pass labels; vite serves the same module instance
// the game imported, so its observer tells the recorder which pass is which.
await evaluate(`import('/src/lab/sdf-zombie/webgpu/gpu-pass-timing.ts')
  .then((m) => { m.setPassLabelObserver((l) => { __cap.label = l; }); })`);


// A cold boot draws bodies per actor until the crowd program has compiled in
// the background (minutes after a march text change); only then does the
// march run through the tile lists. `crowdInfo().tilesOn` is true long before
// that — warmBackground() is the readiness signal. Capturing early records a
// different pipeline, so wait for it.
let crowd = null;
for (let i = 0; i < 1200; i++) {
  crowd = await evaluate('(() => { const w = __sdfGame.warmBackground(); return { state: w.crowd, tilesOn: w.crowd === "ready" && __sdfGame.crowdInfo().tilesOn }; })()');
  if (crowd.state === 'ready' || crowd.state === 'failed') break;
  await sleep(1000);
}
if (!crowd.tilesOn) console.warn(`WARNING: the crowd program is ${crowd.state} — this is the per-actor march, without tile lists`);

const ship = await applyShipDefaults(evaluate);
let staged = null;
if (SCENE === 'closeup') {
  staged = await stageCloseUp(evaluate);
} else if (SCENE === 'crowd') {
  // The bench's `distance` scene (sdf-game-bench.mjs): the player in room 1's
  // near corner, the crowd on a grid in the far half, so the crowd is in view.
  staged = await evaluate(`(() => {
    const r = __sdfGame.rooms.find(x => x.id === 1);
    const b = r.bounds;
    const px = b.minX + 0.6, pz = b.minZ + 0.6;
    const yaw = Math.atan2(b.maxX - px, -(b.maxZ - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const region = { minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 };
    return String(JSON.stringify(__sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: 0.9, region }))).slice(0, 60);
  })()`);
} else if (SCENE !== 'asis') {
  failHard(`unknown SPIKE_SCENE ${SCENE}`);
}
if (PRELUDE) await evaluate(PRELUDE);

// SPIKE_VARIANTS='name=js;name=js': one capture per variant, all of the SAME
// staged, frozen scene in the same boot, into <out>-<name>. Two boots do not
// stage the same frame, so an A/B has to come from one.
const variants = (process.env.SPIKE_VARIANTS ?? '').split(';').filter(Boolean).map((v) => {
  const i = v.indexOf('=');
  return { name: v.slice(0, i), js: v.slice(i + 1) };
});
for (const variant of variants.length > 0 ? variants : [{ name: '', js: '' }]) {
  const out = variant.name ? `${OUT}-${variant.name}` : OUT;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  sinkDir = out;
  blobBytes = 0;
  if (variant.js) await evaluate(variant.js);
  await evaluate('__sdfGame.step(4)'); // settle temporal history on the staged pose
  await sleep(500);

  let recorded = 0;
  for (let attempt = 0; attempt < 5 && recorded === 0; attempt++) {
    recorded = await evaluate(`(async () => {
      __cap.begin(${JSON.stringify(PASSES)});
      __sdfGame.step(1);
      await new Promise((r) => setTimeout(r, 50));
      return __cap.end();
    })()`);
  }
  if (recorded === 0) {
    const seen = await evaluate('JSON.stringify(__cap.seen)');
    failHard(`no render pass matched /${PASSES}/ — the frame's passes were ${seen}`);
  }
  const manifest = await evaluate(`__cap.collect(${JSON.stringify(sinkUrl)})`, 300_000);
  manifest.meta.scene = { scene: SCENE, query: QUERY, prelude: PRELUDE, variant, passes: PASSES, ship, staged, crowd, width: W, height: H };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));

  console.log(`captured ${manifest.passes.length} pass(es) -> ${out} (${(blobBytes / 1e6).toFixed(1)} MB of blobs)`);
  for (const p of manifest.passes) {
    const draws = p.cmds.filter((c) => c[0].startsWith('draw')).length;
    console.log(`  ${p.label}: ${draws} draw(s), ${Object.keys(p.res).length} resource(s)`);
  }
  for (const n of manifest.meta.notes) console.log(`  note: ${n}`);
  console.log(`  crowd tile path: ${crowd.tilesOn ? 'on' : 'OFF'}; staged ${JSON.stringify(staged).slice(0, 80)}`);
}
sink.close();
process.exit(0);
