// scripts/sdf-demo-synth.mjs — record a SYNTHETIC .dem for the deterministic
// demo recorder (stage 3, 2026-09-14).
//
// WHY A SYNTHETIC RECORDING. The owner records real runs with F7 in play. An
// executor cannot hold keys and work a mouse, so it needs a recording that is
// still HONEST: not hand-authored frames, but the scripted firefight driven
// through the SAME input seam a live run uses (`applyInputFrame` via
// `__sdfGame.demoSynthesize`). The result is an ordinary input log — the bench,
// the demo hash and any future gate replay it without knowing how it was made.
//
// It is NOT a substitute for an owner recording: it only exercises the inputs
// the script schedules. Treat it as a determinism fixture, and record a real
// run (F7) before drawing play-feel conclusions.
//
// Usage, inside scripts/lab-servers.sh with LAB_VITE_PORT/LAB_CDP_PORT set:
//   node scripts/sdf-demo-synth.mjs <vite> <cdp> [out.dem.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { connectGame, applyShipDefaults, bootCloseupPage, StageFail } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? process.argv[2] ?? 5326);
const CDP = Number(process.env.LAB_CDP_PORT ?? process.argv[3] ?? 9326);
const OUT = process.argv.find((a) => a.endsWith('.dem.json'))
  ?? 'docs/dev-notes/demos/synthetic-firefight-room2.dem.json';
// A FIXED seed so a re-synthesis on a clean checkout is byte-comparable. The
// bench and the demo hash both boot the page with the recording's seed (the
// cast spawns before a replay can reseed), so this value travels in the file.
const SEED = Number(process.env.DEMO_SYNTH_SEED ?? 1337);
const ROOM = Number(process.env.DEMO_SYNTH_ROOM ?? 2);
const WALK = Number(process.env.DEMO_SYNTH_WALK ?? 200);
const FIRE = Number(process.env.DEMO_SYNTH_FIRE ?? 200);
const GIB = Number(process.env.DEMO_SYNTH_GIB ?? 200);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (20 min)'); process.exit(3); }, 20 * 60_000).unref();

const conn = await connectGame({ vite: VITE, cdp: CDP, onFail: fail });
try {
  await bootCloseupPage({
    send: conn.send, evaluate: conn.evaluate,
    url: `http://localhost:${VITE}/sdf-game.html?simidle=1&seed=${SEED}`,
    fail,
  });
  await applyShipDefaults(conn.evaluate);
  const file = await conn.evaluate(
    `__sdfGame.demoSynthesize(${JSON.stringify({
      room: ROOM, walkFrames: WALK, fireFrames: FIRE, gibFrames: GIB,
      label: `synthetic-firefight-room${ROOM}`,
    })})`,
    10 * 60_000,
  );
  if (!file || !Array.isArray(file.frames) || file.frames.length === 0) {
    fail(`demoSynthesize returned no frames — the seam did not bind: ${JSON.stringify(file)?.slice(0, 300)}`);
  }
  if (file.seed !== SEED) console.warn(`  WARN: recording seed ${file.seed} != requested ${SEED}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(file, null, 2));
  const fired = file.frames.filter((f) => f.fire).length;
  console.log(`OK: ${file.frames.length} frames (${fired} firing), seed ${file.seed}, room ${file.room} -> ${OUT}`);
  process.exit(0);
} catch (err) {
  if (err instanceof StageFail) fail(err.message);
  throw err;
}
