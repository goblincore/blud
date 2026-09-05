// scripts/closeup-probes-capture.mjs — close-up task 2: pixel parity + look
// captures for the shading-normal modes (perfCfg.z — march.wgsl.ts's post-hit
// mode select).
//
// PARITY (the gate): "mode 0 → pixel-identical to the base branch" is checked
// by capturing the SAME staged frame on THIS branch and on the stashed base
// tree and diffing. Protocol (task 4's, inherited): frozen boot, deterministic
// staged scene, bringToFront so the AA smear settles in a foreground tab,
// 2500 ms settle (weapon spring), noise floor from two same-tree mode-0
// captures, compared pair must sit at/below that floor. Diffs are scored over
// the frame BELOW the HUD strip (top 44 px excluded) and with the FPV weapon
// region masked — its animator pose phase is boot-timing sensitive and carries
// no normal-mode content (measured 2026-09-05, goo-capture).
//
// LOOK (no assertion): the WOUNDED fill-screen staging (stageCloseUp +
// stampFacingWounds — the scene this task is measured on) captured at modes
// 0/1/2. The visual gate these feed is judged by eye at the specular
// highlight, not by a counter.
//
// Usage:
//   node scripts/closeup-probes-capture.mjs <vite> <cdp> parity|look
//   PROBES_SHOTS=/tmp/probes-base (output dir; base-tree run uses its own)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { connectGame, applyShipDefaults, bootCloseupPage, stageCloseUp, stampFacingWounds, sleep } from './lib/sdf-closeup-stage.mjs';

const VITE = Number(process.argv[2] ?? 5399);
const CDP = Number(process.argv[3] ?? 9399);
const MODE = process.argv[4] ?? 'parity';
const OUT = process.env.PROBES_SHOTS ?? '/tmp/sdf-probes-shots';
const W = 1280, H = 800;
const SETTLE_STEPS = Number(process.env.PROBES_SETTLE ?? 600);
// Mode 2's straddle threshold (perfCfg.w, world metres). Default 0.02 — the
// boot constant. A sweep sets this to compare thresholds on the SAME scene.
const THRESH = process.env.PROBES_THRESH !== undefined ? Number(process.env.PROBES_THRESH) : null;

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (25 min)'); process.exit(3); }, 25 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

// --- PNG decode + diff (verbatim from goo-capture.mjs, which took it from
// sdf-exit-bound-census.mjs) -------------------------------------------------
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
  const raw = inflateSync(Buffer.concat(idat));
  const channels = { 2: 3, 6: 4 }[colorType];
  const stride = w * channels;
  const out = Buffer.alloc(w * h * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, ch: channels, data: out };
}

const WEAPON_MASK = [[310, 532, 801, 799]];

function diffPngs(a, b, skipTopPx = 0, masks = WEAPON_MASK) {
  if (a.w !== b.w || a.h !== b.h) throw new Error('size mismatch');
  let changed = 0, sum = 0, maxD = 0, n = 0;
  const y0 = skipTopPx; // the HUD strip: its frame EMA ticks even frozen
  for (let y = y0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++, n++) {
      if (masks.some(([mx0, my0, mx1, my1]) => x >= mx0 && x <= mx1 && y >= my0 && y <= my1)) continue;
      const i = (y * a.w + x) * a.ch;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 30) changed++;
      sum += d; if (d > maxD) maxD = d;
    }
  }
  return { changed, changedPct: +((changed / n) * 100).toFixed(4), meanD: +(sum / n).toFixed(2), maxD };
}

const shot = async (send, name, tag, settle = 2500) => {
  // 2500 ms — the FPV weapon spring's settle time (goo-capture's measurement).
  await sleep(settle);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (!s.result?.data) fail(`${name}: screenshot ${tag} returned no data`);
  const file = `${OUT}/${name}-${tag}.png`;
  writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  return file;
};

/** One staged capture: fresh frozen page, ship defaults, the requested normal
 *  mode (read back to prove the seam bit), the fill-screen staging, wounds,
 *  settle, shot. Returns the staging + wound records for the log. */
async function captureMode(conn, mode, tag, { wounds = true } = {}) {
  const { send, evaluate } = conn;
  await send('Page.bringToFront');
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${conn.vite}/sdf-game.html?frozen=1`, fail });
  await applyShipDefaults(evaluate);
  if (!process.env.PROBES_NO_SEAM) {
    await evaluate(`__sdfGame.setNormalMode(${JSON.stringify(mode)}${THRESH !== null ? `, ${THRESH}` : ''})`);
    const readBack = await evaluate('JSON.stringify({ m: __sdfGame.normalMode, t: __sdfGame.normalThresh })');
    const rb = JSON.parse(readBack);
    if (rb.m !== mode) fail(`normalMode readback ${rb.m} != requested ${mode} — seam did not bind`);
    if (THRESH !== null && rb.t !== THRESH) fail(`normalThresh readback ${rb.t} != requested ${THRESH}`);
  }
  const staging = await stageCloseUp(evaluate, {}, fail);
  let woundInfo = null;
  if (wounds) {
    woundInfo = await stampFacingWounds(evaluate, { minStamped: 3 }, fail);
    await evaluate(`__sdfGame.step(${SETTLE_STEPS})`);
  }
  const file = await shot(send, `m${mode}`, tag);
  return { mode, tag, staging, wounds: woundInfo, file };
}

const conn = await connectGame({ vite: VITE, cdp: CDP, width: W, height: H, onFail: fail });
conn.vite = VITE;
console.log(`closeup-probes-capture ${MODE} → ${OUT}`);

if (MODE === 'parity') {
  // Noise floor: two same-tree mode-0 captures (fresh page each).
  const off1 = await captureMode(conn, 0, 'off1');
  const off2 = await captureMode(conn, 0, 'off2');
  const noise = diffPngs(decodePng(readFileSync(off1.file)), decodePng(readFileSync(off2.file)), 44);
  console.log(`  noise(m0-off1 / m0-off2): ${noise.changedPct}% maxD ${noise.maxD} meanD ${noise.meanD}`);
  // Modes 1 and 2: saved, diffed against off1 for information only — these
  // are EXPECTED to differ (the stencil error, the quad-flat normals); the
  // gate for them is the look pass, not this number.
  const rows = [`noise ${JSON.stringify(noise)}`];
  for (const m of [1, 2]) {
    const r = await captureMode(conn, m, 'on');
    const d = diffPngs(decodePng(readFileSync(off1.file)), decodePng(readFileSync(r.file)), 44);
    rows.push(`m${m} vs m0 ${JSON.stringify(d)}`);
    console.log(`  info m${m} vs m0: ${d.changedPct}% maxD ${d.maxD} meanD ${d.meanD}`);
  }
  writeFileSync(`${OUT}/parity.json`, JSON.stringify({
    staging: [off1.staging, off2.staging], noise, rows,
  }, null, 2));
  console.log(`parity rows written to ${OUT}/parity.json`);
} else if (MODE === 'parity0') {
  // ONE mode-0 capture with no seam call — the variant for the STASHED BASE
  // tree, where setNormalMode does not exist. Diff its m0-*.png against this
  // branch's m0-off1.png; the gate is at/below this tree's own noise floor.
  const r = await captureMode(conn, 0, 'base');
  console.log(`base m0 capture — ${r.file} (staging ${JSON.stringify(r.staging)})`);
} else if (MODE === 'look') {
  const recs = [];
  for (const m of [0, 1, 2]) recs.push(await captureMode(conn, m, 'wounded'));
  writeFileSync(`${OUT}/look.json`, JSON.stringify(recs.map(({ staging, wounds, mode, file }) => ({ mode, staging, wounds, file })), null, 2));
  console.log(`look captures written (m0/m1/m2), manifest ${OUT}/look.json`);
} else {
  fail(`unknown mode ${MODE} (parity|look)`);
}
process.exit(0);
