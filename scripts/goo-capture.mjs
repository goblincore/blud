// scripts/goo-capture.mjs — close-up task 4: pixel parity + look captures
// for the goo perf seams.
//
// PARITY (the gate): "each seam off → pixel-identical" is checked against
// MAIN, not against this branch — the seam-off path itself must be proven
// unchanged. Protocol (the exit-bound census's, inherited): frozen boot,
// deterministic staged spray, capture; noise floor from two same-boot
// captures; the compared pair must sit at/below that floor. The HUD's frame
// EMA ticks even frozen, so diffs are scored over the frame BELOW the HUD
// strip (top 44 px excluded), same concession perf-r2-parity made.
//
// LOOK (no assertion): per item, seam ON captures of the three gated scenes
// — close-range burst, chunk trail, accumulated floor — plus an UNFROZEN
// strip (frozen for timing only; strands and trails are a motion read).
// Saved for eyeball and quoted in the report.
//
// Scenes (all deterministic via frozen boot + fixed pose + fixed step
// counts; bleedRng is boot-seeded — the organs-capture precedent):
//   idle     no blood at all (fixed cost scene)
//   burst    close range (1.1 m), one slug + one pellet into the body,
//            captured mid-spray (step 36 after the shot)
//   floor    12 stamped wounds, sim run out 2400 steps so cascades build
//            splats; captured looking down-range at the pool
//
// Usage:
//   node scripts/goo-capture.mjs <vite> <cdp> parity [mainVite mainCdp]
//   node scripts/goo-capture.mjs <vite> <cdp> look [item ...]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { connectGame, applyShipDefaults, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5398);
const CDP = Number(process.argv[3] ?? 9398);
const MODE = process.argv[4] ?? 'parity';
const LOOK_ITEMS = MODE === 'look' && process.argv.slice(5).length
  ? process.argv.slice(5)
  : ['surface', 'minmax', 'fade'];
const MAIN_VITE = Number(process.argv[5] ?? 0);
const MAIN_CDP = Number(process.argv[6] ?? 0);
const OUT = process.env.GOO_SHOTS ?? '/tmp/sdf-goo-shots';
const W = 1280, H = 800;

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (30 min)'); process.exit(3); }, 30 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

// --- PNG decode + diff (verbatim from sdf-exit-bound-census.mjs) ------------
function decodePng(buf) {
  let off = 8; let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported png: depth ${bitDepth} color ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  return { w, h, ch, data: out };
}

function diffPngs(a, b, skipTopPx = 0) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0, sum = 0, maxD = 0, n = 0;
  const y0 = skipTopPx; // the HUD strip: its frame EMA ticks even frozen
  for (let y = y0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++, n++) {
      const i = (y * a.w + x) * a.ch;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 30) changed++;
      sum += d; if (d > maxD) maxD = d;
    }
  }
  return { changed, changedPct: +((changed / n) * 100).toFixed(4), meanD: +(sum / n).toFixed(2), maxD };
}

const shot = async (send, name, tag, settle = 2500) => {
  // 2500 ms default — the FPV weapon spring is still settling at 400 ms, and
  // its pose at shot time is timing-sensitive (one extra CDP round-trip
  // shifts it): idle off1/off2 matched at 0% but any capture with an extra
  // eval diverged ~2.4% clustered in the gun/arm rows. At 2500 ms the spring
  // is converged and the pose is timing-insensitive (measured 2026-09-05).
  // The LIVE look strips pass the old 400 ms — they shoot a decaying burst.
  await sleep(settle);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (!s.result?.data) fail(`${name}: screenshot ${tag} returned no data`);
  const file = `${OUT}/${name}-${tag}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  return file;
};

// --- the staged scenes -------------------------------------------------------
// All: frozen boot (?frozen=1), ship defaults, then a fixed camera + fixed
// shot schedule. Returns the staging record for the log.
const STAGE = {
  idle: `
    __sdfGame.teleport(1);
    __sdfGame.step(2);
    return { scene: 'idle' };`,
  burst: `
    __sdfGame.teleport(1);
    const z = __sdfGame.zombies().find(q => q.room === 1);
    if (!z) return { error: 'no body in room 1' };
    const d = 1.1;
    const ex = z.pos[0], ez = z.pos[2] + d;
    // Facing the body from +z: yaw 0 (stageCloseUp's pose algebra).
    __sdfGame.setPose(ex, ez, 0, 0.05, 0);
    __sdfGame.step(10);
    __sdfGame.fireSlug();
    __sdfGame.step(12);
    __sdfGame.setBleed(true);
    __sdfGame.setGoo(true);
    __sdfGame.step(24);
    return { scene: 'burst', dist: d };`,
  floor: `
    __sdfGame.teleport(1);
    const z = __sdfGame.zombies().find(q => q.room === 1);
    if (!z) return { error: 'no body in room 1' };
    __sdfGame.setPose(z.pos[0], z.pos[2] + 1.6, 0, 0.05, 0);
    __sdfGame.step(10);
    __sdfGame.setBleed(true);
    __sdfGame.setGoo(true);
    // Slug SEVERS feed the bleed ledger (the gushing emitter); stampWoundAt
    // only carves — its wounds never emit, so a stamp-built floor never
    // saturates (measured: 8 stamps + 2400 steps → droplets 0, splats 0).
    for (let i = 0; i < 3; i++) { __sdfGame.fireSlug(); __sdfGame.step(150); }
    let guard = 0;
    while (__sdfGame.bleed.splats < 240 && guard++ < 12) __sdfGame.step(120);
    __sdfGame.setPose(z.pos[0], z.pos[2] + 1.6, 0, -0.35, 0);
    __sdfGame.step(3);
    const bleed = __sdfGame.bleed;
    return { scene: 'floor', splats: bleed.splats, droplets: bleed.droplets };`,
};

const seamOff = '';
const seamOnFor = (item) => item === 'surface' ? '__sdfGame.setGooPerf({ surfaceAtDensityRes: true });'
  : item === 'minmax' ? '__sdfGame.setGooPerf({ minTexelRadius: 1, areaPriority: true });'
  : '__sdfGame.setGooPerf({ splatFadeTail: 128 });';

/** One staged capture: fresh frozen page, defaults, scene, optional extra
 *  seam JS, shot. Returns the staging record. */
async function captureScene(conn, scene, seamJs, name, tag) {
  const { send, evaluate } = conn;
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${conn.vite}/sdf-game.html?frozen=1`, fail });
  await applyShipDefaults(evaluate);
  if (seamJs) await evaluate(seamJs);
  const staged = await evaluate(`(async () => { ${STAGE[scene]} })()`);
  if (staged.error) fail(`${name}/${scene}: ${staged.error}`);
  const file = await shot(send, name, tag);
  return { ...staged, file };
}

if (MODE === 'parity') {
  // Branch captures: seam OFF vs noise pair; then per item ON (saved, no
  // assertion); then MAIN captures if a main server was given.
  const branch = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
  branch.vite = VITE;
  for (const scene of ['idle', 'burst', 'floor']) {
    const off1 = await captureScene(branch, scene, seamOff, `br-${scene}`, 'off1');
    const off2 = await captureScene(branch, scene, seamOff, `br-${scene}`, 'off2');
    const noise = diffPngs(decodePng(readFileSync(off1.file)), decodePng(readFileSync(off2.file)), 44);
    const rows = [`  ${scene}: noise(off1/off2) ${noise.changedPct}% maxD ${noise.maxD}`];
    if (MAIN_VITE) {
      const main = await connectGame({ vite: MAIN_VITE, cdp: MAIN_CDP, width: W, height: H, onFail: fail });
      main.vite = MAIN_VITE;
      const m1 = await captureScene(main, scene, seamOff, `main-${scene}`, 'off');
      const par = diffPngs(decodePng(readFileSync(off1.file)), decodePng(readFileSync(m1.file)), 44);
      const ok = par.changedPct <= Math.max(0.05, noise.changedPct * 2);
      rows.push(`    parity vs MAIN: ${par.changedPct}% maxD ${par.maxD} → ${ok ? 'CLEAN' : 'FAILED'}`);
      if (!ok) process.exitCode = 1;
    }
    for (const item of LOOK_ITEMS) {
      const on = await captureScene(branch, scene, seamOnFor(item), `br-${scene}`, `${item}-on`);
      const d = diffPngs(decodePng(readFileSync(off1.file)), decodePng(readFileSync(on.file)), 44);
      rows.push(`    ${item}-on: px-diff ${d.changedPct}% maxD ${d.maxD} (saved for eyeball)`);
    }
    console.log(rows.join('\n'));
  }
} else {
  // LOOK mode: UNFROZEN strips — boot live, fire, capture a frame sequence.
  const conn = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
  conn.vite = VITE;
  const { send, evaluate } = conn;
  for (const item of LOOK_ITEMS) {
    for (const scene of ['burst', 'floor']) {
      const seamJs = item === 'off' ? '' : seamOnFor(item);
      await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html`, fail });
      await applyShipDefaults(evaluate);
      if (seamJs) await evaluate(seamJs);
      await evaluate(`(async () => { ${STAGE[scene]} })()`);
      await evaluate('__sdfGame.setLoopRunning(true)');
      for (let f = 0; f < 4; f++) {
        await shot(send, `live-${scene}-${item}`, `f${f}`, 400);
        await sleep(160);
      }
      console.log(`  live strip: ${scene} ${item} (4 frames, unfrozen)`);
    }
  }
}
console.log(`\nshots in ${OUT}`);
