// scripts/native-spike/raymask-probe.mjs
//
// NATIVE-RENDERER SPIKE follow-up: the ceiling of a per-ray primitive mask in
// the REAL march. Boots sdf-game.html?raymask (march/raymask-flag.ts), stages a
// scene, and reads debug mode 21: per pixel, the primitive folds the walk made
// and how many of them a per-ray mask would have skipped. Counters only: this
// is what a finer cull could remove, before its own cost. It waits for the
// crowd program, so the numbers are the tile-list path's.
//
//   scripts/native-spike/servers.sh node scripts/native-spike/raymask-probe.mjs
import {
  applyShipDefaults, bootCloseupPage, connectGame, failHard, sleep, stageCloseUp,
} from '../lib/sdf-closeup-stage.mjs';
import { waitForLoader } from '../lib/wait-loader.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5291);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9291);
const { send, evaluate } = await connectGame({ vite: VITE, cdp: CDP });

async function read(mode) {
  await evaluate(`__sdfGame.setMarchDebugMode(${mode})`);
  let prev = null;
  for (let i = 0; i < 40; i++) {
    await evaluate('__sdfGame.step(1)');
    const r = await evaluate('__sdfGameDebug.readMarchTarget()');
    if (prev && r.rgba32f === prev.rgba32f && r.rgba32f.length > 0) break;
    prev = r;
  }
  const b = Buffer.from(prev.rgba32f, 'base64');
  const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  const s = { texels: 0, hits: 0, steps: 0, prims: 0, g: 0 };
  for (let i = 0; i < f.length; i += 4) {
    const code = f[i + 2];
    if (!(code >= 0.5)) continue; // never rasterised: the clear colour
    s.texels++;
    s.hits += code >= 1000 ? 1 : 0;
    s.steps += code % 1000;
    s.prims += f[i];
    s.g += f[i + 1];
  }
  return s;
}

async function scene(name, stage) {
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?raymask` });
  await waitForLoader(evaluate, { fail: failHard });
  // The tile path only exists once the crowd program has compiled (see capture.mjs).
  let tilesOn = false;
  for (let i = 0; i < 1200 && !tilesOn; i++) {
    tilesOn = await evaluate('__sdfGame.warmBackground().crowd === "ready"');
    if (!tilesOn) await sleep(1000);
  }
  await applyShipDefaults(evaluate);
  const staged = await stage();
  await evaluate('__sdfGame.step(4)');
  await sleep(500);
  const walk = await read(13);   // the shipped census: must agree with mode 21's prims
  const probe = await read(21);
  await evaluate('__sdfGame.setMarchDebugMode(0)');
  const row = {
    scene: name, tilesOn, staged,
    marchedTexels: probe.texels, hitTexels: probe.hits,
    stepsPerTexel: +(probe.steps / probe.texels).toFixed(2),
    walkFolds: probe.prims, foldsPerStep: +(probe.prims / probe.steps).toFixed(2),
    maskWouldSkip: probe.g, skipShare: +(probe.g / probe.prims).toFixed(3),
    foldsPerStepMasked: +((probe.prims - probe.g) / probe.steps).toFixed(2),
    mode13Folds: walk.prims,
  };
  console.log(JSON.stringify(row));
  return row;
}

await scene('closeup zombie', () => stageCloseUp(evaluate));
for (const [type, n] of [['zombie', 12], ['zombie', 24]]) {
  try {
    await scene(`crowd ${type} x${n}`, () => evaluate(`(() => {
    const r = __sdfGame.rooms.find(x => x.id === 1);
    const b = r.bounds;
    const px = b.minX + 0.6, pz = b.minZ + 0.6;
    const yaw = Math.atan2(b.maxX - px, -(b.maxZ - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const region = { minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 };
    return String(JSON.stringify(__sdfGame.spawnCrowd(${JSON.stringify(type)}, ${n}, { spacing: 0.9, region }))).slice(0, 60);
  })()`));
  } catch (e) {
    console.log(JSON.stringify({ scene: `crowd ${type} x${n}`, error: String(e.message ?? e).replace(/.*"description":/s, '').slice(0, 300) }));
  }
}
process.exit(0);
