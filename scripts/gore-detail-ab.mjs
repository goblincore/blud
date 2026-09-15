// scripts/gore-detail-ab.mjs — IS THE PROCEDURAL DETAIL LAYER ACTUALLY IN THE
// FRAME?
//
// The owner, after looking at the procedural mesh parts: "when i saw the mesh they
// had no texture no nothing just albedo". That contradicts `baked-chunks.ts`, which
// claims a per-pixel layer (fbm bump + blood decals + organ gloss) that is ON for
// exactly that material (`goreDetail: true`, bump 1.6, blood 0.9). One of the two
// is wrong and only a frame can say which.
//
// So this does not read uniforms or inspect the node graph — it renders the SAME
// pixels twice with the layer ON and OFF and measures the difference. `goreDetail`
// already provides the switch (`detail: 0` is `goreCfg.x = 0`, the documented
// skip). If the two frames are identical, the layer is not reaching the frame, and
// no amount of reading the shader will explain why.
//
// Usage: node scripts/gore-detail-ab.mjs <vitePort> <cdpPort>
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/demo-presented.mjs';

const VITE = Number(process.argv[2] ?? 5391);
const CDP = Number(process.argv[3] ?? 9391);
const OUT = '/tmp/gore-detail-ab';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, e) => { ws.onopen = ok; ws.onerror = e; });
let seq = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (mm, p = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${mm} timed out`)); }, 60000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id, method: mm, params: p }));
});
ws.addEventListener('close', () => { for (const [, r] of pending) r({ error: 'closed' }); pending.clear(); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`page threw: ${JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)}`);
  return r.result?.result?.value;
};
process.on('unhandledRejection', (e) => { console.error(`FAIL: ${e?.message ?? e}`); process.exit(1); });

const pageErrors = [];
await send('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params?.exceptionDetails?.exception?.description ?? 'exc');
});
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?goreparts=1`;
console.log(`opening ${url}`);
await send('Page.navigate', { url });
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev('typeof window.__sdfGame === "object"')) break; }
for (let i = 0; i < 60; i++) { if (await ev('window.__sdfGame.gunReady === true')) break; await sleep(500); }
await sleep(1500);

// Re-lay the bench in front of the player so the camera is guaranteed to be
// looking at it (the boot copy is laid at the SPAWN pose, and a capture rig that
// points somewhere else measures the room, not the parts).
const laid = await ev('window.__sdfGame.goreShowcase()');
console.log(`gore parts laid: ${laid}`);

const shoot = async () => {
  // presentedShot returns the last PRESENTED frame, so DRAW after the change.
  await ev('window.__sdfGame.setRenderLock(true)');
  await ev('window.__sdfGame.step(2)');
  const b64 = await ev('window.__sdfGame.presentedShot()');
  await ev('window.__sdfGame.setRenderLock(false)');
  const png = decodePng(Buffer.from(b64, 'base64'));
  return { png, b64 };
};

// ——— ISOLATE THE LAYER'S THREE TERMS, AND ANALYSE ONLY THE PARTS' PIXELS ——
// A whole-frame percentage cannot separate "the layer does nothing" from "the
// layer works and the parts are small". So first get the parts' OWN pixel mask by
// hiding the bench and diffing, then run each term of the layer separately:
//
//   A  layer OFF                     (goreCfg.x = 0 — the documented skip)
//   E  layer ON but bump 0 blood 0   (the CONTROL: must equal A to the byte)
//   C  bump only
//   D  blood only
//   B  both (the shipped setting)
//
// A vs E proves the gate itself; A vs C isolates the normal perturbation, which is
// the term the owner's "no texture no nothing" is about; A vs D isolates the
// decals. Roughness is measured inside the mask for the same reason.
const setDetail = async (o) => ev(`window.__sdfGame.goreDetail(${JSON.stringify(o)})`);

await setDetail({ detail: 1, bump: 1.6, blood: 0.9 });
const B = await shoot();
await setDetail({ detail: 1, bump: 0, blood: 0 });
const E = await shoot();
await setDetail({ detail: 1, bump: 1.6, blood: 0 });
const C = await shoot();
await setDetail({ detail: 1, bump: 0, blood: 0.9 });
const D = await shoot();
await setDetail({ detail: 0 });
const A = await shoot();
// The parts' mask: hide the bench and diff.
await ev('window.__sdfGame.goreShowcaseVisible(false)');
const H = await shoot();
await ev('window.__sdfGame.goreShowcaseVisible(true)');
await shoot(); // restore for the captures on disk
await setDetail({ detail: 1, bump: 1.6, blood: 0.9 });

const maskOf = (a, h) => {
  const mask = new Uint8Array(a.png.w * a.png.h);
  let n = 0;
  for (let p = 0, i = 0; i < a.png.data.length; i += 4, p++) {
    const d = Math.abs(a.png.data[i] - h.png.data[i])
      + Math.abs(a.png.data[i + 1] - h.png.data[i + 1])
      + Math.abs(a.png.data[i + 2] - h.png.data[i + 2]);
    if (d > 8) { mask[p] = 1; n++; }
  }
  return { mask, n, pct: (100 * n) / (a.png.w * a.png.h) };
};

/** Diff restricted to the parts' own pixels. */
function compareInMask(x, y, m) {
  let differing = 0, total = 0, sum = 0;
  for (let p = 0, i = 0; i < x.png.data.length; i += 4, p++) {
    if (!m.mask[p]) continue;
    total++;
    const d = Math.abs(x.png.data[i] - y.png.data[i])
      + Math.abs(x.png.data[i + 1] - y.png.data[i + 1])
      + Math.abs(x.png.data[i + 2] - y.png.data[i + 2]);
    sum += d;
    if (d > 8) differing++;
  }
  return { differing, total, pct: total ? (100 * differing) / total : 0, meanAbs: total ? sum / total : 0 };
}

/** Mean |difference to the right/down neighbour|, inside the mask only. */
function roughnessInMask(png, m) {
  const { w, data, ch } = png;
  let sum = 0, n = 0;
  for (let y = 1; y < png.h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!m.mask[p] || !m.mask[p + 1] || !m.mask[p + w]) continue;
      const i = p * ch, r = (p + 1) * ch, d = (p + w) * ch;
      sum += Math.abs(data[i] - data[r]) + Math.abs(data[i] - data[d]);
      n += 2;
    }
  }
  return n ? sum / n : NaN;
}

/**
 * DIRECTIONAL roughness: horizontal vs vertical neighbour differences, separately.
 *
 * This is the metric for the owner's actual complaint — "they have vertical
 * streaks like some kind of rock … it literrally looks like rocks". A field built
 * from sums of PLANE WAVES is a plaid: it varies much faster along one screen axis
 * than the other, and that anisotropy IS the streakiness. Proper noise varies the
 * same in every direction, so the ratio sits near 1.
 *
 * Reported as `vert/horiz` (which axis the detail runs along is not important; the
 * DEPARTURE FROM 1 is).
 */
function directionalInMask(png, m) {
  const { w, data, ch } = png;
  let hs = 0, vs = 0, n = 0;
  for (let y = 1; y < png.h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!m.mask[p] || !m.mask[p + 1] || !m.mask[p + w]) continue;
      const i = p * ch;
      hs += Math.abs(data[i] - data[(p + 1) * ch]);
      vs += Math.abs(data[i] - data[(p + w) * ch]);
      n++;
    }
  }
  return n ? { horiz: hs / n, vert: vs / n, ratio: (vs / n) / Math.max(hs / n, 1e-6) } : null;
}

/** Fraction of the parts' pixels where a field is strongly present, estimated
 *  from how far the pixel has moved toward a stain colour (albedo darkness). */
function darkFraction(png, ref, m, thresh = 18) {
  let dark = 0, total = 0;
  for (let p = 0, i = 0; i < png.data.length; i += 4, p++) {
    if (!m.mask[p]) continue;
    total++;
    const l = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    const l0 = 0.2126 * ref.data[i] + 0.7152 * ref.data[i + 1] + 0.0722 * ref.data[i + 2];
    if (l0 - l > thresh) dark++;
  }
  return total ? (100 * dark) / total : 0;
}

const mask = maskOf(A, H);
console.log(`the parts occupy ${mask.n} px = ${mask.pct.toFixed(2)}% of the frame`);

// ——— THE NOISE-DOMAIN SWEEP ————————————————————————————————————————————————
// The bug this rig was built to find was the bump's noise DOMAIN, not its
// amplitude: the parts are 0.075-0.115 m and the noise frequencies are 6-43 per
// unit, so a whole part spanned LESS THAN ONE NOISE CYCLE and the "bump" came out
// as a smooth tilt with zero pixel-scale content. So the test of the fix is the
// NEIGHBOURING-PIXEL ROUGHNESS as the domain scale rises: flat at the old scale,
// climbing once the domain covers several cycles across a part.
console.log('noise-domain sweep (bump 1.6, blood 0), roughness inside the parts:');
const sweep = [];
const roughOff = roughnessInMask(A.png, mask);
for (const noise of [1, 4, 8, 12, 20, 32]) {
  await setDetail({ detail: 1, bump: 1.6, blood: 0, noise });
  const S = await shoot();
  const r = roughnessInMask(S.png, mask);
  const d = compareInMask(S, A, mask);
  sweep.push({ noise, roughness: r, ratio: r / roughOff, meanAbs: d.meanAbs });
  console.log(`  noise ${String(noise).padStart(2)}: roughness ${r.toFixed(3)} `
    + `(x${(r / roughOff).toFixed(3)} vs layer-off)   meanAbs ${d.meanAbs.toFixed(2)}`);
}
await setDetail({ detail: 1, bump: 1.6, blood: 0.9, noise: 12 });

// ——— THE STAIN TERMS ————————————————————————————————————————————————————————
// The owner's second note: "its okay it still look like rocks - there no dark
// blood or burn stains. it would be nice if there was a contrast of sorts the
// blood is more specular and wet looking". Two things are being asked for and
// they are measurable separately:
//
//   * DARKNESS/CONTRAST — how much darker the stained pixels get. A stain that
//     does not move the luminance is not a stain.
//   * WETNESS — the specular term, which is the BRIGHT tail (specular highlights
//     ADD light), so the test of "more wet" is a higher p99 / max while the
//     median stays put. Mean alone would hide it.
console.log('stain terms (bump 1.6, noise 12), inside the parts:');
const lum = (png, m) => {
  const out = [];
  const { data, ch } = png;
  for (let p = 0, i = 0; i < data.length; i += ch, p++) {
    if (!m.mask[p]) continue;
    out.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  out.sort((a, b) => a - b);
  const q = (f) => out[Math.min(out.length - 1, Math.floor(out.length * f))] ?? 0;
  const mean = out.reduce((a, b) => a + b, 0) / Math.max(1, out.length);
  return { mean, p01: q(0.01), p50: q(0.5), p99: q(0.99), max: out[out.length - 1] ?? 0 };
};
const noStain = await shoot();
await setDetail({ detail: 1, bump: 1.6, blood: 0, noise: 12, burn: 0, wet: 0, dark: 0 });
const clean = await shoot();
await setDetail({ detail: 1, bump: 1.6, blood: 0.9, noise: 12, dark: 0.85, wet: 1, burn: 0 });
const bloodOnly2 = await shoot();
await setDetail({ detail: 1, bump: 1.6, blood: 0.9, noise: 12, dark: 0.85, wet: 1, burn: 1 });
const stained = await shoot();
// COLOUR, not just luminance: the owner's report is that the pieces are "pale,
// like gray offwhite … nothing even abit fleshy". Flesh is R >> G ≈ B; grey is
// R ≈ G ≈ B. Saturation is therefore the number that answers "does it look like
// flesh", and it is the one that catches a material lit by a lamp that is not
// there (a fixed bright key blows the albedo to white and takes the hue with it).
const colourOf = (png, m) => {
  let r = 0, g = 0, b = 0, n = 0, sat = 0, wet = 0;
  const { data, ch } = png;
  for (let p = 0, i = 0; i < data.length; i += ch, p++) {
    if (!m.mask[p]) continue;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    r += R; g += G; b += B; n++;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx > 0 ? (mx - mn) / mx : 0;
    if (mx > 235) wet++;   // clipped-to-white pixels
  }
  return {
    meanRgb: [r / n, g / n, b / n].map(v => Math.round(v)),
    satPct: (100 * sat) / n,
    clippedPct: (100 * wet) / n,
  };
};
const colour = { clean: colourOf(clean.png, mask), blood: colourOf(bloodOnly2.png, mask), stained: colourOf(stained.png, mask) };
for (const [k, v] of Object.entries(colour)) {
  console.log(`  COLOUR ${k.padEnd(8)} mean rgb (${v.meanRgb.join(',')})  saturation ${v.satPct.toFixed(1)}%  `
    + `clipped-to-white ${v.clippedPct.toFixed(1)}% of parts`);
}
const stats = { clean: lum(clean.png, mask), blood: lum(bloodOnly2.png, mask), stained: lum(stained.png, mask) };
for (const [k, v] of Object.entries(stats)) {
  console.log(`  ${k.padEnd(8)} mean ${v.mean.toFixed(2)}  p01 ${v.p01.toFixed(0)}  p50 ${v.p50.toFixed(0)}  `
    + `p99 ${v.p99.toFixed(0)}  max ${v.max.toFixed(0)}`);
}
const dBurn = compareInMask(stained, bloodOnly2, mask);
console.log(`  burn field alone changes ${dBurn.pct.toFixed(1)}% of parts, meanAbs ${dBurn.meanAbs.toFixed(2)}`);
// ——— BANDING: the owner's actual complaint ————————————————————————————————
// "vertical streaks like some kind of rock". A sine-sum field is a plaid and
// shows up as a large horiz/vert asymmetry; perlin fbm is isotropic and should
// sit near 1. This is the number that says whether the streaks are gone.
const dirStained = directionalInMask(stained.png, mask);
const dirClean = directionalInMask(clean.png, mask);
console.log(`  DIRECTIONAL roughness (vert/horiz): layer off ${dirClean.ratio.toFixed(3)}  `
  + `stained ${dirStained.ratio.toFixed(3)}  (1.0 = isotropic; >>1 = vertical streaks)`);
console.log(`  dark-stain coverage: blood ${darkFraction(bloodOnly2.png, clean.png, mask).toFixed(1)}%  `
  + `blood+burn ${darkFraction(stained.png, clean.png, mask).toFixed(1)}% of the parts' pixels`);
await setDetail({ detail: 1, bump: 1.6, blood: 0.9, noise: 12, burn: 1, wet: 1, dark: 0.85, stainScale: 2.5 });
writeFileSync(`${OUT}/stain-stats.json`, JSON.stringify({ stats, colour, dBurn, pageErrors }, null, 2));

console.log('within the parts\' own pixels:');
const rows = [['LAYER ON, both terms 0 (bone/organ retint only)', E, A],
              ['BUMP     bump 1.6, blood 0    vs OFF', C, A],
              ['BLOOD    bump 0,   blood 0.9  vs OFF', D, A],
              ['BOTH     bump 1.6, blood 0.9  vs OFF', B, A]];
const report = {};
for (const [label, x, y] of rows) {
  const r = compareInMask(x, y, mask);
  const rx = roughnessInMask(x.png, mask), ry = roughnessInMask(y.png, mask);
  report[label] = { ...r, roughX: rx, roughOff: ry };
  console.log(`  ${label.padEnd(52)} diff ${r.pct.toFixed(1).padStart(5)}% of parts, `
    + `meanAbs ${r.meanAbs.toFixed(3).padStart(7)}  roughness ${rx.toFixed(3)} vs ${ry.toFixed(3)} (x${(rx / ry).toFixed(3)})`);
}
writeFileSync(`${OUT}/ab.json`, JSON.stringify({ laid, maskPct: mask.pct, sweep, roughOff, report, pageErrors }, null, 2));
writeFileSync(`${OUT}/detail-on.png`, Buffer.from(B.b64, 'base64'));
writeFileSync(`${OUT}/detail-off.png`, Buffer.from(A.b64, 'base64'));
writeFileSync(`${OUT}/bump-only.png`, Buffer.from(C.b64, 'base64'));
writeFileSync(`${OUT}/blood-only.png`, Buffer.from(D.b64, 'base64'));

// ——— THE VERDICT, PER TERM ————————————————————————————————————————————————
// THERE IS NO TRUE "CONTROL" IN THIS LAYER, and the first version of this rig
// called that row one and warned about it. `goreCfg.x > 0` is NOT a no-op even with
// bump and blood at zero: the same branch also RETINTS bones (albedo x (0.9+0.2h),
// alpha x 0.55, gloss 90) and organs (mixed toward red/pink, alpha >= 0.86, gloss
// 220). So that row is a real term, not a control, and the roughness metric is what
// separates the terms: bump is the only one that should change high-frequency
// detail, and at the old domain scale it did not.
const retint = report['LAYER ON, both terms 0 (bone/organ retint only)'];
const blood = report['BLOOD    bump 0,   blood 0.9  vs OFF'];
const bump = report['BUMP     bump 1.6, blood 0    vs OFF'];
console.log(`\nbones/organs retint: ${retint.pct.toFixed(1)}% of parts change with both terms at 0 `
  + '— expected, the same branch retints bone alpha/gloss and organ tint');
console.log(`BLOOD decals: ${blood.pct > 1 ? 'IN THE FRAME' : 'NOT VISIBLE'} `
  + `(${blood.pct.toFixed(1)}% of parts, meanAbs ${blood.meanAbs.toFixed(2)})`);
const bumpRough = bump.roughX / bump.roughOff;
console.log(`BUMP: roughness ratio ${bumpRough.toFixed(3)} — ${bumpRough > 1.02
  ? 'the normal perturbation IS producing per-pixel relief (this is the fix working)'
  : 'the normal perturbation is a smooth tilt, NOT texture (the "no texture, just albedo" report)'}`);
const atOld = sweep.find(s => s.noise === 1);
const atNew = sweep.find(s => s.noise === 12);
if (atOld && atNew) {
  console.log(`\nNOISE DOMAIN: at scale 1 (the old, unscaled code) roughness is x${atOld.ratio.toFixed(3)} — `
    + 'no pixel-scale content;\n  at the shipped scale 12 it is '
    + `x${atNew.ratio.toFixed(3)}. That gap IS the bug the owner saw.`);
}
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 3));
console.log(`captures: ${OUT}/{detail-on,detail-off,bump-only,blood-only}.png`);
try { await fetch(`http://localhost:${CDP}/json/close/${tab.id}`); } catch {}
process.exit(0);

