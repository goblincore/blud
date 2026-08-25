// Dense severed-geometry relax gate (round 3) — the instrument round 2 lacked.
//
// Round 2's gate passed while the shader was wrong because (1) it swept 8 yaws
// 45 deg apart on mostly-intact bodies and (2) it judged by scattered pixel %,
// which a small coherent hole cannot move but silhouette AA matches. This
// harness does the opposite:
//
//   - SEVERED geometry (arms + legs via the lab's own sever path) with wounds
//     stamped AFTER the motion freeze, so wound placement is deterministic.
//   - Dense yaw sweep (default 48 steps) across several pitches.
//   - A/B of two relax settings IN ONE PAGE LOAD — same pose, same wounds,
//     same everything, toggling only woundCfg2.y between the two shots.
//          - Scores by BODY-MASK LOST PIXELS per tile: each shot is
//            classified into flesh / not-flesh by a red-dominant luminance
//            test, and we score tiles by the fraction of pixels that were
//            flesh under relax A and are NOT flesh under relax B. A skipped-
//            geometry hole is a coherent region of lost mask and fills tiles;
//            AA edges, specular-glint flicker and the animated blood/goo
//            layer (dark red/black, never classified as flesh; its bright
//            glints only ever flip a few scattered pixels) do not. Raw
//            whole-frame diffs were tried first and rejected: the goo layer
//            animates forever (blood sim steps unconditionally) and poisoned
//            every tile metric.
//
// The noise floor is measured honestly by the same harness run with
// RELAX_A == RELAX_B (1.0 vs 1.0): every number that pipeline produces is
// pure measurement noise, so the gate for shipping X is
// "max tile fill(X vs 1.0) indistinguishable from floor".
//
// ---------------------------------------------------------------------------
// STATUS 2026-08-25: WORKING GATE, and it returns a verdict.
//
// It was not one at first. The metric was right but the noise floor EXCEEDED
// the signal: two runs at IDENTICAL relax differed more than 1.0 differed from
// 1.4, because the blood sim, goo layer and gib chunks that wounding/severing
// spawn keep stepping BETWEEN the A and B captures inside one page load.
// Hiding them (this harness's first workaround) was not enough — they step
// underneath — and raising SETTLE_MS made it worse.
//
// Fixed by `__sdfLab.freezeCosmetics()` (lab-main), which stops the time
// evolution at source. Once frozen the debris is static geometry, so the gib
// chunks are UNHIDDEN again: hiding them removed the severed arm, i.e. exactly
// the thin geometry the relax question is about, from the measurement.
//
// zombie, 24 yaws x 3 pitches = 72 poses, severed (3,4,5,6) + 8 wounds,
// on dispatch/relax-thin-r2 (= task 1b's retract-to-tSafe fix):
//
//                        floor (1.0 v 1.0)   signal (1.0 v 1.4)
//   max lost tile median       0.0000              0.0139
//   max lost tile mean         0.0028              0.0566
//   max lost tile max          0.0278              0.5503
//   poses > 0.10                  0 / 72             12 / 72
//   poses > 0.30                  0 / 72              5 / 72
//   poses > 0.50                  0 / 72              1 / 72
//
// VERDICT: relax 1.4 demonstrably skips thin geometry EVEN WITH the round-2
// retract fix. Signal max is ~20x the floor, and twelve poses show coherent
// lost-mask regions the floor never produces once. This is the objective
// confirmation of what the owner saw by eye — circular bites out of arms and
// stumps — and it is why woundCfg2.y stays 1.0.
//
// Before this instrument, three attempts failed to measure it. Run the floor
// (RELAX_A == RELAX_B) alongside every signal run; it is what makes the
// numbers mean anything.
// ---------------------------------------------------------------------------
//
// Usage:
//   node scripts/relax-sweep.mjs <vitePort> <cdpPort> <character> <outJson>
// Env:
//   RELAX_A (default 1.0), RELAX_B (default 1.4)
//   YAWS (default 48), PITCHES (default "-0.15,0.12,0.45")
//   CAM_DIST (default 2.4), WOUNDS (default 8), SEVER (default "3,4,5/6 keys")
//   STEPS_OVERRIDE (default unset — e.g. 256 for the budget-exhaustion probe)
//   SETTLE_MS (default 350), TILE (default 24), DIFF_THRESH (default 14)
//   SHOT_DIR (default /tmp/relax-sweep) — worst poses saved as PNG pairs.

const VITE = Number(process.argv[2] ?? 5291);
const CDP = Number(process.argv[3] ?? 9271);
const CHARACTER = process.argv[4] ?? 'zombie';
const OUT = process.argv[5] ?? `/tmp/relax-sweep/${CHARACTER}-${Date.now()}.json`;
const RELAX_A = Number(process.env.RELAX_A ?? 1.0);
const RELAX_B = Number(process.env.RELAX_B ?? 1.4);
const YAWS = Number(process.env.YAWS ?? 48);
const PITCHES = (process.env.PITCHES ?? '-0.15,0.12,0.45').split(',').map(Number);
const CAM_DIST = Number(process.env.CAM_DIST ?? 2.4);
const WOUNDS = Number(process.env.WOUNDS ?? 8);
const SEVER_KEYS = (process.env.SEVER ?? '3,4,5,6').split(',').map(s => s.trim());
const STEPS_OVERRIDE = process.env.STEPS_OVERRIDE ? Number(process.env.STEPS_OVERRIDE) : null;
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 350);
const TILE = Number(process.env.TILE ?? 24);
const DIFF_THRESH = Number(process.env.DIFF_THRESH ?? 14);
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/relax-sweep';
const SHOTS = Number(process.env.SHOTS ?? 3);
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

// ---------- CDP plumbing (same no-deps pattern as sdf-bench.mjs) ----------
const tab = await (
  await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
).json();
// ---------------------------------------------------------------------------
// TAB CLEANUP. `/json/new` above spawns a renderer process (~250 MB) that
// OUTLIVES this script unless it is closed again. Nothing here used to close
// it, so every invocation leaked one — and these scripts are run in loops. A
// 2026-08-25 session accumulated ~35 stale tabs across sweeps and benches,
// drove host load to 27, and silently corrupted every timing number taken in
// that window: the runs still "succeeded", they were just measuring a machine
// fighting itself. That is the dangerous failure mode — not a crash, a quiet
// bias.
//
// `process.on('exit')` fires on EVERY exit path (success, fail(), an uncaught
// throw), which is why the cleanup lives here rather than at the end of the
// happy path. Exit handlers must be synchronous, so this shells out to curl
// instead of using fetch — a dev-only script may be inelegant; it may not
// leak. Failure is ignored: if the browser is already gone there is nothing
// to close.
const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
process.on('exit', () => {
  try {
    execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' });
  } catch { /* browser already gone, or curl missing — nothing to clean */ }
});

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0;
const pending = new Map();
const consoleEvents = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleEvents.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 960, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-lab-webgpu.html?character=${encodeURIComponent(CHARACTER)}`;
console.log(`sweep ${url}  relax ${RELAX_A} vs ${RELAX_B}, yaws ${YAWS}, pitches [${PITCHES}], sever keys [${SEVER_KEYS}], wounds ${WOUNDS}${STEPS_OVERRIDE ? `, stepsOverride ${STEPS_OVERRIDE}` : ''}`);
await send('Page.navigate', { url });

// Boot can take 30 s cold (TSL node-graph build) — poll generously.
let lab = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  lab = await evaluate('typeof window.__sdfLab === "object"');
  if (lab) break;
}
if (!lab) { console.error('console tail:', consoleEvents.slice(-8)); fail('__sdfLab never booted'); }
const backend = await evaluate('window.__sdfLab.backend');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
console.log(`boot ok, backend ${backend}`);

// ---------- In-page differ ----------
// Median of SHOTS frames per setting: wound wet-specular and goo glints
// flicker frame to frame; the per-pixel median keeps only what is stable
// across captures, so shading flicker cannot masquerade as lost body.
await evaluate(`{
  window.__gate = {
    ref: null,
    pending: [],
    ingest(b64) {
      this.pending.push(b64);
      if (this.pending.length < ${SHOTS}) return Promise.resolve(null);
      const shots = this.pending;
      this.pending = [];
      return new Promise((res) => {
        const frames = [];
        for (const b of shots) {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            frames.push(ctx.getImageData(0, 0, c.width, c.height));
            if (frames.length !== shots.length) return;
            const n = frames[0].data.length;
            const med = new Uint8ClampedArray(n);
            for (let i = 0; i < n; i += 4) {
              for (let k = 0; k < 3; k++) {
                const v = [frames[0].data[i + k], frames[1].data[i + k], frames[2].data[i + k]].sort((x, y) => x - y);
                med[i + k] = v[1];
              }
              med[i + 3] = 255;
            }
            const cur = new ImageData(med, frames[0].width, frames[0].height);
            let out = null;
            if (this.ref) {
              const a = this.ref.data, b = cur.data;
              const W = cur.width, H = cur.height, T = ${TILE};
              const nx = Math.floor(W / T), ny = Math.floor(H / T);
              const lostF = new Array(nx * ny).fill(0);
              const gotF = new Array(nx * ny).fill(0);
              const bodyA_F = new Array(nx * ny).fill(0);
              let lost = 0, got = 0, bodyA = 0, bodyB = 0;
              const isFlesh = (d, i) => d[i] > 70 && d[i] > d[i+1] * 1.25 && d[i+2] > d[i] * 0.45;
              for (let p = 0; p < W * H; p++) {
                const i = p * 4;
                const fa = isFlesh(a, i), fb = isFlesh(b, i);
                if (fa) bodyA++;
                if (fb) bodyB++;
                if (fa && !fb) lost++;
                if (!fa && fb) got++;
              }
              for (let ty = 0; ty < ny; ty++) {
                for (let tx = 0; tx < nx; tx++) {
                  let nl = 0, ng = 0, na = 0;
                  for (let y = ty * T; y < (ty + 1) * T; y++) {
                    let row = y * W + tx * T;
                    for (let x = 0; x < T; x++, row++) {
                      const i = row * 4;
                      const fa = isFlesh(a, i), fb = isFlesh(b, i);
                      if (fa) na++;
                      if (fa && !fb) nl++;
                      if (!fa && fb) ng++;
                    }
                  }
                  lostF[ty * nx + tx] = nl / (T * T);
                  gotF[ty * nx + tx] = ng / (T * T);
                  bodyA_F[ty * nx + tx] = na / (T * T);
                }
              }
              // A hole lives INSIDE previously-flesh area, so score only
              // tiles that were substantially flesh under A. This discards
              // the animated goo/blood glints on the floor, whose tiles hold
              // a few mask pixels but no body.
              const BODY_MIN = 0.3;
              const ls = [...lostF].filter((f, i) => bodyA_F[i] >= BODY_MIN).sort((x, y) => y - x);
              const gs = [...gotF].filter((f, i) => bodyA_F[i] >= BODY_MIN).sort((x, y) => y - x);
              // Core = tiles that were mostly flesh under A — where an
              // interior hole necessarily lives. Goo glints near the
              // silhouette cannot reach these.
              const CORE_MIN = 0.6;
              const ls2 = [...lostF].filter((f, i) => bodyA_F[i] >= CORE_MIN).sort((x, y) => y - x);
              out = {
                maxLostTile: ls[0] ?? 0, maxGotTile: gs[0] ?? 0,
                maxLostCore: ls2[0] ?? 0,
                lostFrac: lost / (W * H), gotFrac: got / (W * H),
                bodyFracA: bodyA / (W * H), bodyFracB: bodyB / (W * H),
                w: W, h: H,
              };
            }
            this.ref = cur;
            res(out);
          };
          img.src = 'data:image/png;base64,' + b;
        }
      });
    },
    reset() { this.ref = null; this.pending = []; },
  };
}`);

// ---------- Deterministic pose: freeze FIRST, then sever, then stamp ----------
// Noise sources identified by probe (2026-08-25): the debug panel's live
// readouts, the two blood InstancedMeshes (trails/splats keep animating),
// gib chunks (stepChunk runs even in statue mode), and glow flicker. All are
// neutralised here; the floor run (RELAX_A == RELAX_B) quantifies whatever
// remains. Post chain off too — FXAA/smear add per-frame edge shimmer.
await evaluate(`(() => {
  const L = window.__sdfLab;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' })); // hide debug panel
  L.setMotionEnabled(false);
  L.setWander(false);
  L.setAdaptive(false);
  L.setSdfScale(1.0);
  L.post.setSmear(0);
  L.post.setFxaa(false);
  L.uniforms.faceCfg3.value.x = 0; // glow flicker off
  L.gooLayer.setThreshold(10); // goo quads render from the live blood sim — threshold them out
  ${STEPS_OVERRIDE !== null && STEPS_OVERRIDE !== undefined && !Number.isNaN(STEPS_OVERRIDE) ? `L.setStepsOverride(${STEPS_OVERRIDE});` : ''}
  // Blood layers: drops + splats are the scene's InstancedMeshes — hide them
  // all (the raymarched hero/kit/floor are plain Meshes, unaffected).
  let hidden = 0;
  for (const o of L.scene.children) {
    if (o.isInstancedMesh) { o.visible = false; hidden++; }
  }
  window.__bootChildIds = new Set(L.scene.children.map(o => o.id));
  return { hiddenBlood: hidden };
})()`);
await sleep(400);
for (const k of SEVER_KEYS) {
  // Synthetic keydown through the lab's own sever path (SEVER_KEYS handler).
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}' }))`);
  await sleep(250);
}
const postSever = await evaluate(`(() => {
  // Chunks: every scene child added after boot is a gib piece — hide them all
  // (stepChunk keeps running underneath, but hidden geometry cannot flicker).
  let hid = 0;
  for (const o of window.__sdfLab.scene.children) {
    if (!window.__bootChildIds.has(o.id) && o.visible) { o.visible = false; hid++; }
  }
  return { chunks: window.__sdfLab.chunkCount, hiddenChunks: hid };
})()`);
console.log(`severed via keys [${SEVER_KEYS}] ->`, JSON.stringify(postSever));
await sleep(Number(process.env.SETTLE ?? 2.5) * 1000); // let remaining sim state settle before any capture
if (WOUNDS > 0) {
  const stamped = await evaluate(`(() => { window.__sdfLab.stampWounds(${WOUNDS}); return window.__sdfLab.wounds.length; })()`);
  console.log(`stamped ${WOUNDS} wounds -> ${stamped} total`);
}

// ---------- Silence the debris for real ----------
// The hiding above was this harness's original workaround and it was not
// enough: chunk physics and the blood sim keep STEPPING underneath, and the
// goo pass poses from that live state, so the floor reached 0.814 max
// lost-tile (10 of 36 poses over 0.30) while a clean body floored at 0.014.
// freezeCosmetics() stops the time evolution at source.
//
// And once frozen, the debris is static geometry — so UNHIDE the gib chunks.
// Hiding them removed the severed arm, i.e. precisely the thin geometry the
// relax question is about, from the thing being measured. Blood instances and
// the goo layer stay suppressed: they are floor decoration, not the subject.
const froze = await evaluate(`(() => {
  const L = window.__sdfLab;
  if (typeof L.freezeCosmetics !== 'function') return { frozen: false, shown: 0 };
  L.freezeCosmetics();
  let shown = 0;
  for (const o of L.scene.children) {
    if (!window.__bootChildIds.has(o.id) && !o.visible && !o.isInstancedMesh) {
      o.visible = true; shown++;
    }
  }
  return { frozen: true, shown };
})()`);
if (!froze.frozen) {
  console.warn('WARNING: __sdfLab.freezeCosmetics() missing on this build — '
    + 'the floor will swamp the signal on severed/wounded bodies. See the header.');
} else {
  console.log(`cosmetics frozen; ${froze.shown} chunk object(s) re-shown for measurement`);
}

// ---------- Sweep ----------
mkdirSync(SHOT_DIR, { recursive: true });
const results = [];
let shotIdx = 0;
const total = YAWS * PITCHES.length;

/** One measurement: SHOTS screenshots -> in-page median -> diff against ref. */
async function shoot() {
  let stats = null, b64 = null;
  for (let i = 0; i < SHOTS; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    b64 = shot.result?.data;
    if (!b64) throw new Error('captureScreenshot returned no data');
    stats = await evaluate(`window.__gate.ingest(${JSON.stringify(b64)})`);
  }
  return { stats, b64 };
}

outer:
for (const pitch of PITCHES) {
  for (let yi = 0; yi < YAWS; yi++) {
    const yaw = (yi / YAWS) * Math.PI * 2;
    await evaluate(`window.__sdfLab.setCam(${yaw}, ${pitch}, ${CAM_DIST})`);
    await sleep(SETTLE_MS);

    await evaluate(`window.__sdfLab.setRelax(${RELAX_A}); window.__gate.reset();`);
    await sleep(120);
    const a = await shoot();
    if (process.env.DUMP_PAIR && shotIdx === Number(process.env.DUMP_PAIR)) {
      const fs = await import('node:fs');
      fs.writeFileSync('/tmp/pairA.png', Buffer.from(a.b64, 'base64'));
    }

    await evaluate(`window.__sdfLab.setRelax(${RELAX_B});`);
    await sleep(120);
    const b = await shoot();
    if (process.env.DUMP_PAIR && shotIdx === Number(process.env.DUMP_PAIR)) {
      const fs = await import('node:fs');
      fs.writeFileSync('/tmp/pairB.png', Buffer.from(b.b64, 'base64'));
    }
    // restore A so the next pose's reference is taken under A
    await evaluate(`window.__sdfLab.setRelax(${RELAX_A});`);

    // a.stats is null by design (a's shot seeds the fresh per-pose ref);
    // b.stats is the A/B diff. FLOOR runs use RELAX_A == RELAX_B and measure
    // exactly this same quantity, so numbers are comparable.
    if (!b.stats) fail('diff stats missing');
    results.push({
      pitch, yaw: +yaw.toFixed(4),
      ...b.stats,
    });
    shotIdx++;
    if (shotIdx % 24 === 0) console.log(`  ${shotIdx}/${total} poses, running worst maxLostTile ${(Math.max(...results.map(r => r.maxLostTile)) * 100).toFixed(1)}%`);
  }
}

// Save PNG evidence for the worst poses (A shot and B shot side by side).
results.sort((x, y) => y.maxLostTile - x.maxLostTile);
const worst = results.slice(0, 6);
// re-shoot the worst poses for evidence
console.log('re-shooting worst poses for evidence PNGs...');
for (const w of worst.slice(0, 3)) {
  await evaluate(`window.__sdfLab.setCam(${w.yaw}, ${w.pitch}, ${CAM_DIST}); window.__gate.reset();`);
  await sleep(SETTLE_MS + 200);
  await evaluate(`window.__sdfLab.setRelax(${RELAX_A});`);
  await sleep(150);
  const a = await shoot();
  await evaluate(`window.__sdfLab.setRelax(${RELAX_B});`);
  await sleep(150);
  const b = await shoot();
  writeFileSync(`${SHOT_DIR}/worst-${CHARACTER}-r${RELAX_A}-y${(w.yaw * 180 / Math.PI).toFixed(0)}-p${w.pitch}.png`, Buffer.from(a.b64, 'base64'));
  writeFileSync(`${SHOT_DIR}/worst-${CHARACTER}-r${RELAX_B}-y${(w.yaw * 180 / Math.PI).toFixed(0)}-p${w.pitch}.png`, Buffer.from(b.b64, 'base64'));
}

const lostTiles = results.map(r => r.maxLostTile).sort((a, b) => a - b);
const summary = {
  character: CHARACTER,
  relaxA: RELAX_A, relaxB: RELAX_B,
  yaws: YAWS, pitches: PITCHES, camDist: CAM_DIST,
  wounds: WOUNDS, severKeys: SEVER_KEYS,
  stepsOverride: STEPS_OVERRIDE,
  tile: TILE, mask: 'r>70 && r>1.25g && b>0.45r (pink has blue; blood glints do not)',
  settleMs: SETTLE_MS,
  poses: results.length,
  maxLostTileMax: lostTiles[lostTiles.length - 1],
  maxLostTileP95: lostTiles[Math.floor(lostTiles.length * 0.95)],
  maxLostTileMedian: lostTiles[Math.floor(lostTiles.length * 0.5)],
  maxLostCoreWorst: Math.max(...results.map(r => r.maxLostCore ?? 0)),
  maxGotTileWorst: Math.max(...results.map(r => r.maxGotTile)),
  lostFracWorst: Math.max(...results.map(r => r.lostFrac)),
  worst5: results.slice(0, 5).map(r => ({ yawDeg: +(r.yaw * 180 / Math.PI).toFixed(1), pitch: r.pitch, maxLostTile: r.maxLostTile, maxGotTile: r.maxGotTile })),
};
writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 2));
console.log(`written ${OUT}`);
process.exit(0);
