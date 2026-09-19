// scripts/compile-census.mjs — PER-PIPELINE COLD-BOOT COMPILE CENSUS
// (shader-compile-time task 1, 2026-09-19). MEASURE ONLY.
//
// WHY. Cold boots are usually 1.3–6 s but intermittently take 100–135 s, and
// the boot log only says "drawOnce blocked" / "asyncFirst 79 s" — not WHICH
// pipeline or whether one variant is pathological. This script drives N cold
// boots (each with a FRESH Chrome profile, because the Metal shader cache lives
// in the profile and a reused one reports a warm boot as cold), then dumps the
// per-creation census that `pipeline-log.ts` records under `?pipelinelog=1`.
//
// It starts its OWN vite and its OWN headless Chrome, one process per run, and
// stops only what it started. Runs are SEQUENTIAL: two cold boots at once would
// contend for the GPU (the other dispatch agents may be doing the same thing),
// so the wall-clock timestamp of every run is recorded and a `--note` can be
// passed to mark observed contention.
//
// Usage:
//   node scripts/compile-census.mjs [runs] [--out <path>] [--note <text>]
//   node scripts/compile-census.mjs --report [path]   # summarise a census.json
//
// Default output: docs/dev-notes/2026-09-19-shader-compile/census.json
//
// The census page is `/sdf-game.html?pipelinelog=1&seed=20260919`. The seed
// keeps the scene deterministic run-to-run; the flag turns on per-creation
// recording from the first frame (the device wraps are always installed, the
// arrays/hashing/fingerprints are not).

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const DEFAULTS = {
  vite: 5396,
  cdp: 9396,
  out: 'docs/dev-notes/2026-09-19-shader-compile/census.json',
  query: 'pipelinelog=1&seed=20260919',
  bootTimeoutMs: 240000, // plan: wait for ready OR a 240 s timeout, record which
};
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAB_TMP = resolve('.lab-tmp');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// --report <path>: the analysis half, so the notes' numbers are reproducible.
// (Dispatched near the bottom, after the helpers are initialised.)
// ---------------------------------------------------------------------------
const isReport = process.argv[2] === '--report' || process.argv[2] === 'report';

/** Median of a numeric list (even count: mean of the two middles). */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

const MARCH_FNS = [
  'marchBody', 'refineBody', 'sdfSurfaceMarch', 'coneMarch', 'depthPrepassMarch',
  'quadTileEmpty', 'mapBody', 'calcNormal', 'detailField', 'applyCarves', 'applyWounds',
];
/** A module is march-family when its include list contains a march entry. */
function isMarchHash(hash, run) {
  const mod = run.census?.modules?.find((m) => m.hash === hash);
  if (!mod) return false;
  return mod.fingerprint.fns.some((f) => MARCH_FNS.includes(f));
}

/** Merge [start,end] intervals and return the covered wall ms. */
function coverage(intervals) {
  const s = [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, curS = null, curE = null;
  for (const [a, b] of s) {
    if (curS === null) { curS = a; curE = b; continue; }
    if (a <= curE) curE = Math.max(curE, b);
    else { total += curE - curS; curS = a; curE = b; }
  }
  if (curS !== null) total += curE - curS;
  return total;
}
const overlapMs = (e, a, b) => Math.max(0, Math.min(e.endT, b) - Math.max(e.t, a));
const pearson = (pts) => {
  const n = pts.length;
  if (n < 3) return NaN;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
/** The module fingerprint behind an entry in a run. */
function modOf(run, e) {
  return run.census?.modules?.find((m) => m.hash === e.fragmentShaderHash);
}
/** The three-key minus the two per-instance stage ids — the part that names
 *  the render context rather than the shader. */
const contextKey = (threeKey) => threeKey.split(',').slice(2).join(',');
/** Shape signature: the facts that survive identifier renaming. */
const shapeOf = (mod) => mod
  ? `${mod.fingerprint.bytes}B/${mod.fingerprint.fnCount}fn/${mod.fingerprint.bindings}bind/${mod.fingerprint.locations}loc`
  : 'no-module';

/** Print the tables the notes quote. */
function report(data) {
  const runs = data.runs.filter((r) => r.census?.entries?.length);
  console.log(`census: ${runs.length} usable runs of ${data.runs.length}`);
  console.log('\n== runs ==');
  for (const r of data.runs) {
    const ph = r.warm?.phases ?? {};
    console.log(`  ${r.index} ${r.wallStart} warmMs=${r.warm?.ms ?? '-'} drawOnce=${r.warm ? round(ph.drawOnce ?? 0) : '-'} asyncFirst=${r.warm ? round(ph.asyncFirst ?? 0) : '-'} gibVariant=${r.warm ? round(ph.gibVariant ?? 0) : '-'} precompile=${r.warm ? round(ph.precompile ?? 0) : '-'} phase=${r.gate.phase} gateTimedOut=${r.gate.timedOut} entries=${r.census?.count ?? 0}`);
  }

  // --- top 15 pipelines by median ms --------------------------------------
  const byKey = new Map();
  for (const run of runs) {
    for (const e of run.census.entries) {
      const key = e.threeKey || `${e.name}|${e.sig?.slice(0, 60) ?? ''}`;
      if (!byKey.has(key)) byKey.set(key, { sample: e, ms: [], runs: new Set() });
      byKey.get(key).ms.push(e.ms);
      byKey.get(key).runs.add(run.index);
    }
  }
  const ranked = [...byKey.values()].sort((a, b) => median(b.ms) - median(a.ms));
  console.log('\n== top 15 pipelines by median compile ms ==');
  console.log('medianMs  runs  sync/async  vKB   fKB   label');
  for (const g of ranked.slice(0, 15)) {
    const e = g.sample;
    console.log(`${String(round(median(g.ms))).padStart(8)}  ${String(g.runs.size).padStart(4)}  ${(e.async ? 'async' : 'sync').padStart(9)}  ${String(round(e.vertexShaderBytes / 1024)).padStart(4)}  ${String(round(e.fragmentShaderBytes / 1024)).padStart(4)}  ${e.name}  [ctx ${contextKey(e.threeKey)}]`);
  }

  // --- march family, by shape ---------------------------------------------
  const marchEntries = [];   // { run, e, mod, shape }
  const otherEntries = [];
  for (const run of runs) {
    for (const e of run.census.entries) {
      const mod = modOf(run, e);
      const fam = isMarchHash(e.fragmentShaderHash, run) || isMarchHash(e.vertexShaderHash, run);
      if (fam) marchEntries.push({ run, e, mod, shape: shapeOf(mod) });
      else otherEntries.push({ run, e, mod });
    }
  }
  const distinctHashes = new Set(marchEntries.map((m) => m.e.fragmentShaderHash));
  const contextKeys = new Set(marchEntries.map((m) => contextKey(m.e.threeKey)));
  const shapes = new Map();
  for (const m of marchEntries) {
    if (!shapes.has(m.shape)) shapes.set(m.shape, { ms: [], hashes: new Set(), entries: 0, fns: m.mod?.fingerprint.fns ?? [], sample: m });
    const g = shapes.get(m.shape);
    g.ms.push(m.e.ms);
    g.hashes.add(m.e.fragmentShaderHash);
    g.entries++;
  }
  const shapesRanked = [...shapes.entries()].sort((a, b) => b[1].hashes.size - a[1].hashes.size);
  const dominantFns = shapesRanked[0]?.[1].fns ?? [];
  console.log(`\n== march-family: ${marchEntries.length} entries, ${distinctHashes.size} distinct fragment-module hashes, ${shapes.size} shapes, ${contextKeys.size} context keys ==`);
  for (const [shape, g] of shapesRanked) {
    const missing = dominantFns.filter((f) => !g.fns.includes(f));
    const extra = g.fns.filter((f) => !dominantFns.includes(f));
    console.log(`  shape ${shape}: distinct modules=${g.hashes.size} entries=${g.entries} medianMs=${round(median(g.ms))} fnSetDiff(-${missing.length}/+${extra.length})`);
    console.log(`      -[${missing.join(', ')}]  +[${extra.join(', ')}]`);
  }

  // --- share of naive total ms + union wall coverage ----------------------
  const sum = (xs) => xs.reduce((s, e) => s + e.e.ms, 0);
  const marchMs = sum(marchEntries);
  const otherMs = sum(otherEntries);
  console.log(`\n== march-family share (naive sum of creation ms, overlapping async included) ==`);
  console.log(`march ${round(marchMs)} ms / other ${round(otherMs)} ms / total ${round(marchMs + otherMs)} ms  (march ${round(100 * marchMs / (marchMs + otherMs))}%)`);
  console.log('\n== union wall coverage per run (merged [t,endT] intervals) ==');
  console.log('run  wallSpan  allCov  allSum  marchCov  marchSum  marchEntries  otherCov');
  for (const run of runs) {
    const es = run.census.entries;
    const t0 = Math.min(...es.map((e) => e.t));
    const t1 = Math.max(...es.map((e) => e.endT));
    const me = marchEntries.filter((m) => m.run === run);
    const oe = otherEntries.filter((m) => m.run === run);
    console.log(`${String(run.index).padStart(3)}  ${String(round(t1 - t0)).padStart(8)}  ${String(round(coverage(es.map((e) => [e.t, e.endT])))).padStart(6)}  ${String(round(es.reduce((s, e) => s + e.ms, 0))).padStart(6)}  ${String(round(coverage(me.map((m) => [m.e.t, m.e.endT])))).padStart(8)}  ${String(round(sum(me))).padStart(8)}  ${String(me.length).padStart(12)}  ${String(round(coverage(oe.map((m) => [m.e.t, m.e.endT])))).padStart(8)}`);
  }

  // --- SLOW runs: where did the warm go? ----------------------------------
  const slow = runs.filter((r) => (r.warm?.ms ?? 0) > 30000);
  console.log(`\n== slow runs (warmMs > 30 s): ${slow.length} of ${runs.length} ==`);
  for (const run of slow) {
    const marks = new Map((run.bootMarks ?? []).map((m) => [m.n, m.t]));
    const a = marks.get('warm-steps-start');
    const b = marks.get('warm-async-first-done') ?? marks.get('warm-draw-once-done');
    console.log(`run ${run.index}: warmMs=${run.warm.ms} asyncFirst=${round(run.warm.phases?.asyncFirst ?? 0)} window=[${a}, ${b}] (${a != null && b != null ? round(b - a) : '?'} ms)`);
    if (a != null && b != null) {
      const inside = run.census.entries.filter((e) => overlapMs(e, a, b) > 0);
      const inflightAtStart = run.census.entries.filter((e) => e.t <= a && e.endT > a);
      const contrib = inside.map((e) => ({ e, ov: overlapMs(e, a, b) })).sort((x, y) => y.ov - x.ov);
      console.log(`  ${inside.length} pipelines overlap the window; ${inflightAtStart.length} already in flight at window start; union coverage inside ${round(coverage(inside.map((e) => [e.t, Math.min(e.endT, b)])))} ms`);
      console.log(`  coverage by kind: async ${round(coverage(inside.filter((e) => e.async).map((e) => [e.t, Math.min(e.endT, b)])))} ms, sync ${round(coverage(inside.filter((e) => !e.async).map((e) => [e.t, Math.min(e.endT, b)])))} ms`);
      for (const { e, ov } of contrib.slice(0, 12)) {
        const mod = modOf(run, e);
        // Fast-run median for the same shader string, when it exists there.
        const others = [];
        for (const r2 of runs) if (r2 !== run) for (const e2 of r2.census.entries) if (e2.fragmentShaderHash === e.fragmentShaderHash) others.push(e2.ms);
        console.log(`    ${String(round(e.ms)).padStart(9)} ms (overlap ${String(round(ov)).padStart(8)})  ${e.async ? 'async' : 'sync '}  ${shapeOf(mod).padEnd(26)} otherRunsMedian=${others.length ? round(median(others)) : '-'}  ${e.name}`);
      }
    }
  }

  // --- WGSL size vs compile ms correlation --------------------------------
  const marchPts = marchEntries.map((m) => [m.e.fragmentShaderBytes, m.e.ms]);
  const allPts = runs.flatMap((r) => r.census.entries.filter((e) => e.fragmentShaderBytes > 0).map((e) => [e.fragmentShaderBytes, e.ms]));
  console.log(`\n== compile ms vs fragment WGSL bytes ==`);
  console.log(`  march variants: pearson r = ${round(pearson(marchPts), 3)} over ${marchPts.length} (variant,run) samples`);
  console.log(`  all pipelines:  pearson r = ${round(pearson(allPts), 3)} over ${allPts.length} samples`);
  const big = allPts.filter((p) => p[0] > 100000);
  console.log(`  pipelines >=100 KB fragment WGSL: ${big.length} of ${allPts.length} creations (${round(100 * big.length / allPts.length)}%)`);
}


if (isReport) {
  const path = resolve(process.argv[3] ?? DEFAULTS.out);
  report(JSON.parse(readFileSync(path, 'utf8')));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const RUNS = Number(args.find((a) => /^\d+$/.test(a)) ?? 6);
const VITE = DEFAULTS.vite;
const CDP = DEFAULTS.cdp;
const OUT = resolve(getOpt('--out', DEFAULTS.out));
const NOTE = getOpt('--note', '');
/** --sources N: also retain the N largest distinct march-family fragment WGSL
 *  sources into <out dir>/march-wgsl-samples.json, for offline diffing. */
const SOURCES = Number(getOpt('--sources', 0));

const children = [];
let finished = false;
function shutdown(code) {
  if (finished) return;
  finished = true;
  for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }
  process.exit(code);
}
process.on('exit', () => { for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } } });

mkdirSync(LAB_TMP, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });

async function waitFor(url, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`${what} never came up at ${url}`);
}

// ---------------------------------------------------------------------------
// One cold boot: fresh profile, fresh Chrome, own CDP tab.
// ---------------------------------------------------------------------------
async function bootOnce(index) {
  const profile = mkdtempSync(join(LAB_TMP, `census-profile-${index}-`));
  const port = CDP + index;
  const wallStart = new Date().toISOString();
  const result = { index, wallStart, gate: { phase: null, timedOut: false }, warm: null, census: null, sources: null, gpuDiagnostics: null, bootWallMs: null, error: null };
  let chrome = null, ws = null;
  try {
    chrome = spawn(CHROME, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--enable-unsafe-webgpu',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-reporter',
      `--crash-dumps-dir=${join(LAB_TMP, `census-crashpad-${index}`)}`,
      '--window-size=1380,820',
      'about:blank',
    ], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(chrome);
    await waitFor(`http://localhost:${port}/json/version`, `chrome debug port ${port}`);

    const tab = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = () => err(new Error('cdp websocket failed')); });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, timeoutMs = 30000) => {
      const reply = await Promise.race([
        send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
        sleep(timeoutMs).then(() => ({ __timeout: true })),
      ]);
      if (reply.__timeout) throw new Error(`Runtime.evaluate timed out: ${expression.slice(0, 80)}`);
      if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 300));
      return reply.result?.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    const url = `http://localhost:${VITE}/sdf-game.html?${DEFAULTS.query}`;
    const tNav = Date.now();
    await send('Page.navigate', { url });

    let booted = false;
    for (let i = 0; i < 240 && !booted; i++) {
      await sleep(500);
      booted = await evaluate('typeof window.__sdfGame === "object"').catch(() => false);
    }
    if (!booted) throw new Error('__sdfGame never booted within 120 s');

    // Wait for the loader gate to settle, OR 240 s from navigation.
    let gate = null;
    const deadline = tNav + DEFAULTS.bootTimeoutMs;
    while (Date.now() < deadline && !gate) {
      gate = await evaluate('window.__warmGate ?? null').catch(() => null);
      if (!gate) await sleep(500);
    }
    result.bootWallMs = Date.now() - tNav;
    if (!gate) {
      result.gate = { phase: null, timedOut: true, note: 'gate never settled within 240 s' };
      // Best-effort partial payload: whatever the log has so far.
      result.warm = await evaluate('window.__warmDone ? JSON.parse(JSON.stringify(window.__warmDone)) : null').catch(() => null);
      result.census = await evaluate('JSON.stringify(window.__sdfGame.pipelineCensus())').then((s) => (s ? JSON.parse(s) : null)).catch(() => null);
      return result;
    }
    result.gate = { phase: gate.phase, timedOut: Boolean(gate.timedOut) };
    result.warm = await evaluate('window.__warmDone ? JSON.parse(JSON.stringify(window.__warmDone)) : null').catch(() => null);
    result.bootMarks = await evaluate('window.__sdfGame.bootMarks()').catch(() => null);
    result.gpuDiagnostics = await evaluate('window.__sdfGame.gpuDiagnostics()').catch(() => null);
    const json = await evaluate('JSON.stringify(window.__sdfGame.pipelineCensus())', 60000);
    result.census = json ? JSON.parse(json) : null;
    if (SOURCES > 0 && result.census) {
      result.sources = {};
      const hashes = [...new Set(result.census.entries
        .filter((e) => isMarchHash(e.fragmentShaderHash, result))
        .sort((a, b) => b.fragmentShaderBytes - a.fragmentShaderBytes)
        .map((e) => e.fragmentShaderHash))].slice(0, SOURCES);
      for (const hash of hashes) {
        const src = await evaluate(`window.__sdfGame.pipelineShaderSource(${JSON.stringify(hash)})`, 30000).catch(() => null);
        if (typeof src === 'string') result.sources[hash] = src;
      }
      console.log(`captured ${Object.keys(result.sources).length} march sources`);
    }
    return result;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return result;
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    if (chrome) {
      try { process.kill(-chrome.pid, 'SIGKILL'); } catch { try { chrome.kill('SIGKILL'); } catch { /* gone */ } }
      const i = children.indexOf(chrome); if (i >= 0) children.splice(i, 1);
    }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`compile census: ${RUNS} cold boots, fresh profile each, out ${OUT}`);
const vite = spawn('npx', ['vite', '--port', String(VITE), '--strictPort'], {
  cwd: resolve('.'), detached: true, stdio: ['ignore', 'ignore', 'ignore'],
});
children.push(vite);
await waitFor(`http://localhost:${VITE}/sdf-game.html`, 'vite dev server', 60000);

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  process.stdout.write(`run ${i}/${RUNS} @ ${new Date().toISOString()} ... `);
  const r = await bootOnce(i);
  runs.push(r);
  const ph = r.warm?.phases ?? {};
  console.log(r.error
    ? `ERROR ${r.error}`
    : `phase=${r.gate.phase} warmMs=${r.warm?.ms ?? '-'} drawOnce=${ph.drawOnce ?? '-'} asyncFirst=${ph.asyncFirst ?? '-'} entries=${r.census?.count ?? 0} bootWall=${r.bootWallMs} ms`);
}

const payload = {
  task: 'shader-compile-time task 1',
  createdAt: new Date().toISOString(),
  host: process.env.HOSTNAME ?? '',
  note: NOTE,
  page: `/sdf-game.html?${DEFAULTS.query}`,
  // Sources are kept out of census.json (they are megabytes and go to the
  // sibling march-wgsl-samples.json instead).
  runs: runs.map(({ sources, ...r }) => r),
};
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`\nwrote ${OUT}`);
if (SOURCES > 0) {
  const sourcesPath = resolve(dirname(OUT), 'march-wgsl-samples.json');
  writeFileSync(sourcesPath, JSON.stringify({
    note: 'WGSL sources retained by --sources for offline variant diffing',
    runs: runs.map((r) => ({ index: r.index, sources: r.sources ?? {} })),
  }, null, 2));
  console.log(`wrote ${sourcesPath}`);
}
shutdown(0);
