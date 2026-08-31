// scripts/sdf-game-bleed-gate.mjs — bleeding-wounds gate driver.
//
// No-deps CDP, same plumbing as scripts/sdf-game-half-rate.mjs. Subcommands:
//
//   parity   Off-state ZERO gate, WITHIN ONE PAGE LOAD (cross-load captures
//            can never be pixel-identical — boot runs the render loop before
//            __sdfGame exists; measured floor 1.2% any-delta, see the C2
//            spike note). Protocol: fire a slug so wounds + emitters exist,
//            freeze, settle, then setBleed(false) -> capture -> ON window ->
//            setBleed(false) -> settle -> capture; the two OFF captures must
//            diff to zero. An ON capture is saved as evidence.
//   reel     Per-calibre sequences (pellet ooze / slug spurt / stump gush,
//            12+ frames each) plus a closeup sequence staging the DEPTH FIX
//            (droplet between camera and its own body — depthWrite:true lets
//            the SDF composite's depth test leave it visible). Fresh page
//            load per sequence. Prints a moving-red signal per frame
//            (pixels red here but not in the previous frame — a crude
//            droplet-motion detector; the crater itself is static red).
//   bench    Fires scripts/sdf-game-bench.sh with BENCH_LEGS=baseline,bleed-off
//            (interleaved, chunked+fenced, fresh page per run) and rooms
//            restricted to the busy ones. The fire segment is the probe.
//
// Usage: LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 node scripts/sdf-game-bleed-gate.mjs <mode>
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const MODE = process.argv[2] ?? '';
const VITE = Number(process.env.LAB_VITE_PORT ?? 5320);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9320);
const OUT = process.env.GAME_OUT ?? 'docs/dev-notes/2026-08-31-bleeding-wounds';
const W = Number(process.env.GAME_W ?? 800);
const H = Number(process.env.GAME_H ?? 600);
const URL_BASE = `http://localhost:${VITE}/sdf-game.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const log = (s) => console.log(s);

// --- PNG decode + diff (8-bit RGB/RGBA non-interlaced) — house pattern ----
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2)) throw new Error(`unsupported png depth=${depth} color=${color}`);
  const ch = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let pos = 0;
  const row = Buffer.alloc(stride);
  const prevRaw = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b = prevRaw[x];
      const c = x >= ch ? prevRaw[x - ch] : 0;
      let v = raw[pos + x];
      switch (filter) {
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      row[x] = v;
    }
    pos += stride;
    row.copy(prevRaw);
    for (let x = 0; x < w; x++) {
      const o = y * w * 4 + x * 4;
      out[o] = row[x * ch];
      out[o + 1] = row[x * ch + 1];
      out[o + 2] = row[x * ch + 2];
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

export function diffPngs(aBuf, bBuf) {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  if (a.w !== b.w || a.h !== b.h) fail(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const n = a.w * a.h;
  let d0 = 0, max = 0;
  for (let i = 0; i < n * 4; i += 4) {
    let md = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d > md) md = d;
    }
    if (md > max) max = md;
    if (md > 0) d0++;
  }
  return { w: a.w, h: a.h, diffAny: d0, pctAny: (100 * d0 / n).toFixed(4) + '%', maxChannelDelta: max };
}

/** Droplet-red mask: R dominant and dark — the droplet palette band
 *  (190,16,28)/(140,10,24)/(70,4,12). The wound crater interior is red too,
 *  but STATIC; the reel's moving-red signal = mask(f) & ~mask(f-1). */
function redMask(img) {
  const m = new Uint8Array(img.w * img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      m[y * img.w + x] = r >= 60 && r <= 240 && g < 60 && b < 75 && r > g + 40 ? 1 : 0;
    }
  }
  return m;
}

// --- CDP plumbing (house style) -------------------------------------------
if (MODE === 'bench') {
  // Thin wrapper: the honest bench lives in sdf-game-bench.mjs (fresh page
  // per run, hidden-frame invalidation, census) and now knows the bleed-off
  // leg. Rooms 3+4 are the busy ones; repeats give the spread table.
  const args = process.argv.slice(3);
  const env = {
    ...process.env,
    LAB_VITE_PORT: String(VITE),
    LAB_CDP_PORT: String(CDP),
    BENCH_LEGS: process.env.BENCH_LEGS ?? 'baseline,bleed-off',
    BENCH_ROOMS: process.env.BENCH_ROOMS ?? '3,4',
    BENCH_OUT: process.env.BENCH_OUT ?? `${OUT}/bench`,
  };
  mkdirSync(env.BENCH_OUT, { recursive: true });
  const r = spawn('bash', ['scripts/sdf-game-bench.sh', ...args], { env, stdio: 'inherit' });
  r.on('exit', (code) => process.exit(code ?? 1));
} else if (MODE !== '' && MODE !== 'parity' && MODE !== 'reel') {
  fail(`unknown mode: ${MODE} (use parity|reel|bench)`);
}

if (MODE === 'parity' || MODE === 'reel') {
  const tab = await (
    await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })
  ).json();
  const __closeTabUrl = `http://localhost:${CDP}/json/close/${tab.id}`;
  process.on('exit', () => {
    try { execFileSync('curl', ['-s', '-m', '2', __closeTabUrl], { stdio: 'ignore' }); } catch {}
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
      consoleEvents.push({
        type: m.params.type,
        text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 500) });
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const withTimeout = (p, ms, what) => Promise.race([
    p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`); }),
  ]);
  const evaluate = async (expression, timeoutMs = 60000) => {
    const r = await withTimeout(
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      timeoutMs, expression.slice(0, 60),
    );
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  let shotCount = 0;
  async function shot(name) {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(s.result.data, 'base64');
    writeFileSync(name, buf);
    shotCount++;
    log(`  shot ${name} (${buf.length} bytes)`);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  const consoleErrors = () => consoleEvents.filter((e) => e.type === 'error' || e.type === 'exception');

  async function boot() {
    await send('Page.navigate', { url: URL_BASE });
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      const api = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
      if (api) {
        if (api !== 'webgpu') fail(`backend is ${api}, not webgpu`);
        return;
      }
    }
    console.error('console tail:', consoleEvents.slice(-8));
    fail('game page never booted (__sdfGame absent)');
  }

  async function commonSetup() {
    await evaluate('window.__sdfGame.setAdaptive(false)');
    await evaluate('var h = document.getElementById("hud"); if (h) h.style.display = "none";');
    await sleep(500);
  }

  /** Stage: face a room-1 zombie at `standoff`, confirm a surface aim. */
  async function stageShot(standoff) {
    await evaluate('window.__sdfGame.teleport(1)');
    const zs = await evaluate('window.__sdfGame.zombies()');
    const z = zs.find((q) => q.room === 1);
    if (!z) fail('no zombie in room 1');
    const px = z.pos[0], pz = z.pos[2] + standoff;
    const yaw = Math.atan2(z.pos[0] - px, -(z.pos[2] - pz));
    await evaluate(`window.__sdfGame.setPose(${px}, ${pz}, ${yaw}, 0)`);
    await evaluate('window.__sdfGame.step(5, 1/60)');
    const aimed = await evaluate('window.__sdfGame.aimSurface()');
    if (!aimed) fail('aimSurface could not confirm a target');
    await evaluate('window.__sdfGame.step(2, 1/60)');
    return z;
  }

  // -------------------------------------------------------------------------
  // parity — the off-state ZERO gate (within one load)
  // -------------------------------------------------------------------------
  if (MODE === 'parity') {
    mkdirSync(OUT, { recursive: true });
    await boot();
    await commonSetup();
    // Make the feature REAL first: wounds + emitters + chunks must exist so
    // the OFF gate proves something (an empty page proves nothing).
    await stageShot(3.0);
    await evaluate('window.__sdfGame.setSlugMode(true)');
    await evaluate('window.__sdfGame.fire(1)');
    await evaluate('window.__sdfGame.step(30, 1/60)'); // droplets mid-flight, emitters live
    const state = await evaluate('window.__sdfGame.bleed');
    log(`post-fire bleed state: ${JSON.stringify(state)}`);
    if (!state.emitters && !state.droplets) fail('no bleed activity after a slug — wiring broken');

    // Freeze + settle, then the cycle. OFF clears the sim (setBleed), so both
    // OFF captures show the pre-feature page; the rng stream does not advance
    // while OFF, making OFF a perfect pause of the subsystem.
    await evaluate('window.__sdfGame.freeze(true)');
    await evaluate('window.__sdfGame.setLoopRunning(false)');

    // THE SAME-STATE NOISE FLOOR, measured, not assumed. Two captures of the
    // same static scene in one load differ on ~50-120 SILHOUETTE-EDGE px
    // (max channel ~6-25): the march's edge AA sampling jitters with frame
    // index, so a capture is a sample, not a fixed point. (The C2 spike's
    // scene happened to be AA-stable and read literal 0; this one does not —
    // measured CONTROL diffs below.) The gate is therefore the plan's own
    // wording: OFF must add NOTHING ABOVE THE FLOOR — the toggle cycle is
    // judged against control cycles run on the SAME load, same protocol.
    //
    // Protocol per cycle: settle -> off0 -> [middle window] -> off -> settle
    // -> off1 -> pixel diff. OFF clears the sim (setBleed), so both OFF
    // captures show the pre-feature page; the rng stream does not advance
    // while OFF, making OFF a perfect pause of the subsystem.
    const SETTLE = 60;
    async function cycle(mid, label) {
      await evaluate('window.__sdfGame.setBleed(false)');
      await evaluate(`window.__sdfGame.step(${SETTLE}, 1/60)`);
      await shot(`${OUT}/${label}-off0.png`);
      if (mid) {
        await evaluate('window.__sdfGame.setBleed(true)');
        await evaluate('window.__sdfGame.step(31, 1/60)');
        await shot(`${OUT}/${label}-on.png`); // evidence only — will differ
      } else {
        await evaluate('window.__sdfGame.step(31, 1/60)');
      }
      await evaluate('window.__sdfGame.setBleed(false)');
      await evaluate(`window.__sdfGame.step(${SETTLE}, 1/60)`);
      await shot(`${OUT}/${label}-off1.png`);
      return diffPngs(
        readFileSync(`${OUT}/${label}-off0.png`),
        readFileSync(`${OUT}/${label}-off1.png`),
      );
    }

    // GATING at smear 0 first: no temporal filter history, so the only
    // residue possible is the edge-AA jitter floor itself.
    await evaluate('window.__sdfGame.setSmear(0)');
    const ctlA = await cycle(false, 'ctl-a');
    const ctlB = await cycle(false, 'ctl-b');
    const floorAny = Math.max(ctlA.diffAny, ctlB.diffAny);
    const floorMax = Math.max(ctlA.maxChannelDelta, ctlB.maxChannelDelta);
    log(`control cycles (no toggle, smear 0): A=${JSON.stringify(ctlA)} B=${JSON.stringify(ctlB)}`);
    log(`same-state floor: ${floorAny} px, max channel ${floorMax}`);

    const real = await cycle(true, 'parity');
    log(`toggle cycle (smear 0, GATING): ${JSON.stringify(real)}`);

    // REPORTED at the shipped default smear: the temporal filter leaves its
    // rounding residue after bright droplet ghosts; documented, not gated.
    await evaluate('window.__sdfGame.setSmear(0.25)');
    const rep = await cycle(true, 'parity-smear');
    log(`toggle cycle (smear 0.25, reported): ${JSON.stringify(rep)}`);

    const bad = consoleErrors();
    for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 200));
    const aboveFloor = real.diffAny > floorAny || real.maxChannelDelta > floorMax;
    if (aboveFloor) {
      fail(`OFF path moved ABOVE the same-state floor: ${real.diffAny} px / max ${real.maxChannelDelta}`
        + ` vs floor ${floorAny} px / max ${floorMax}`);
    }
    if (bad.length) fail(`${bad.length} console error(s)`);
    log(`parity: PASS (toggle adds nothing above the ${floorAny}px/${floorMax} same-state floor)`);
    ws.close();
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // reel — per-calibre sequences + the depth-fix closeup
  // -------------------------------------------------------------------------
  if (MODE === 'reel') {
    const SEQ_DIR = `${OUT}/seq`;
    mkdirSync(SEQ_DIR, { recursive: true });
    const only = process.env.REEL_ONLY ?? '';
    const smear = process.env.REEL_SMEAR; // undefined = shipped default

    const sequences = [
      { name: 'pellet', standoff: 4.0, frames: 12, fire: 'single' },
      { name: 'slug', standoff: 3.0, frames: 12, fire: 'slug' },
      { name: 'sever', standoff: 3.0, frames: 24, fire: 'slug', needChunks: true },
      { name: 'closeup', standoff: 1.6, frames: 12, fire: 'slug' },
    ];

    for (const sq of sequences) {
      if (only && sq.name !== only) continue;
      const dir = `${SEQ_DIR}/${sq.name}`;
      if (existsSync(`${dir}/f00.png`) && !process.env.REEL_FORCE) {
        log(`reel: ${sq.name} already captured, skipping`);
        continue;
      }
      log(`reel: ${sq.name}`);
      mkdirSync(dir, { recursive: true });
      await boot();
      await commonSetup();
      if (smear !== undefined) await evaluate(`window.__sdfGame.setSmear(${smear})`);
      await evaluate('window.__sdfGame.freeze(true)');
      await stageShot(sq.standoff);
      if (sq.fire === 'both') await evaluate('window.__sdfGame.fire(2)');
      else if (sq.fire === 'single') await evaluate('window.__sdfGame.fire(1)');
      else await evaluate('window.__sdfGame.fireSlug()');

      let prevMask = null;
      for (let f = 0; f < sq.frames; f++) {
        await evaluate('window.__sdfGame.step(1, 1/60)');
        const name = `${dir}/f${String(f).padStart(2, '0')}.png`;
        await shot(name);
        const mask = redMask(decodePng(readFileSync(name)));
        if (prevMask) {
          let moving = 0;
          for (let i = 0; i < mask.length; i++) if (mask[i] && !prevMask[i]) moving++;
          log(`    f${f}: moving-red px ${moving}`);
        }
        prevMask = mask;
      }
      if (sq.needChunks) {
        const chunks = await evaluate('window.__sdfGame.chunkCount');
        const bleedState = await evaluate('window.__sdfGame.bleed');
        log(`  ${sq.name}: chunks=${chunks} bleed=${JSON.stringify(bleedState)}`);
        if (chunks === 0) fail(`${sq.name}: nothing severed — no stump/chunk to gate on`);
      }
      const bad = consoleErrors();
      if (bad.length) {
        for (const e of bad.slice(0, 5)) console.error('  |', e.type, e.text.slice(0, 300));
        fail(`${sq.name}: console errors during reel`);
      }
    }
    log(`reel: done, ${shotCount} frames`);
    ws.close();
    process.exit(0);
  }
}
