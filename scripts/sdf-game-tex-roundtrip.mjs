// scripts/sdf-game-tex-roundtrip.mjs — QUESTION B of the close-up
// diagnostics (2026-09-04): does a written ray parameter survive a texture
// round-trip?
//
// Three write paths, so a decay can be attributed (the distinction the
// earlier investigations never made):
//   uniform — a CPU-computed t written through a uniform node. No geometry
//     involvement: isolates the TEXTURE + readback.
//   dist    — the exact shipped expression length(positionWorld -
//     cameraPosition) on a quad perpendicular to the camera's forward.
//     Isolates the TSL distance expression under rasterisation.
//   mesh    — the occluder's instanced-sphere path via the existing
//     __sdfGame.syntheticSphereCheck (the seam that measured the original
//     decay). Isolates the mesh-rasterised producer.
//
// Formats: RGBA32F (the occluder target's) and R32F (the outer hull's), at
// full march-target scale and quarter scale (the depth-prepass scale).
// Reads: CPU readback AND the occFetch/shellFetch textureLoad operator.
//
// Usage: node scripts/sdf-game-tex-roundtrip.mjs <vitePort> <cdpPort> <outJson>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const VITE = Number(process.argv[2] ?? 5377);
const CDP = Number(process.argv[3] ?? 9377);
const OUT = process.argv[4] ?? '/tmp/sdf-closeup/tex-roundtrip.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog (10 min)'); process.exit(3); }, 600_000).unref();
mkdirSync(OUT.slice(0, OUT.lastIndexOf('/')) || '.', { recursive: true });

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: 180_000,
  });
  if (r.result?.exceptionDetails) fail(`page threw: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
await send('Page.bringToFront');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const url = `http://localhost:${VITE}/sdf-game.html?frozen=1`;
console.log(`tex-roundtrip ${url}`);
await send('Page.navigate', { url });
let backend = null;
for (let i = 0; i < 240; i++) {
  await sleep(500);
  backend = await evaluate('typeof window.__sdfGame === "object" ? window.__sdfGame.backend : null');
  if (backend) break;
}
if (!backend) fail('game page never booted');
if (backend !== 'webgpu') fail(`backend is ${backend}, not webgpu`);
await sleep(2500);

// Park the wanderers and look at open space; the probe scene contains only
// its own quad, so the room behind is irrelevant — only the near plane and
// the camera's world matrix matter.
await evaluate(`(() => {
  __sdfGame.teleport(1);
  __sdfGame.setPose(0, 0, 0, 0, 0);
  __sdfGame.freeze(true);
  __sdfGame.step(2);
  return 1;
})()`);

// The reported-decay ladder plus the task's mandated 0.5 / 3 / 9.
const LADDER = [0.5, 1.9, 2.4, 2.9, 3, 3.9, 4.9, 5.9, 7.9, 9, 9.9, 11.9];
const rows = [];
for (const dist of LADDER) {
  for (const mode of ['uniform', 'dist']) {
    const r = await evaluate(`__sdfGame.texRoundTrip({ dist: ${dist}, mode: '${mode}' })`);
    if (r.error) { rows.push({ dist, mode, error: r.error }); console.log(`  ${dist}m ${mode}: ERROR ${r.error}`); continue; }
    for (const row of r.rows) {
      const [target, neighbours] = [row.target.split(' ')[0], row.target.split(' ')[1] ?? ''];
      rows.push({
        dist, mode, target,
        cpu: row.cpu, wgsl: row.wgsl, expected: r.expected,
        cpuRelErr: +Math.abs((row.cpu - r.expected) / r.expected).toFixed(5),
        wgslRelErr: +Math.abs((row.wgsl - r.expected) / r.expected).toFixed(5),
        neighbours,
      });
    }
    const worst = Math.max(...r.rows.map((x) => Math.abs((x.cpu - r.expected) / r.expected)));
    console.log(`  ${dist}m ${mode}: worst cpu relErr ${(worst * 100).toFixed(2)}%`);
  }
  // The shipped mesh-rasterised producer (the seam that measured the
  // original decay), same ladder. Two radii at one range re-test the
  // "error depends on DISTANCE alone, not radius" claim.
  const rad = dist === 4.9 ? null : 0.2;
  const s = await evaluate(`__sdfGame.syntheticSphereCheck(${dist}, ${rad ?? 0.2})`);
  rows.push({
    dist, mode: 'mesh', target: 'rgba-full(occluder)',
    cpu: s.atCentrePixelTopDown, expected: s.analyticCentrePixel,
    cpuRelErr: s.analyticCentrePixel ? +Math.abs((s.atCentrePixelTopDown - s.analyticCentrePixel) / s.analyticCentrePixel).toFixed(5) : null,
    coveredPx: s.coveredPx, minWritten: s.minWritten, maxWritten: s.maxWritten,
  });
  console.log(`  ${dist}m mesh: centre ${s.atCentrePixelTopDown} vs analytic ${s.analyticCentrePixel} (covered ${s.coveredPx}px)`);
  if (dist === 4.9) {
    for (const radius of [0.05, 0.5]) {
      const s2 = await evaluate(`__sdfGame.syntheticSphereCheck(4.9, ${radius})`);
      rows.push({
        dist: 4.9, mode: 'mesh', target: `rgba-full(occluder) r=${radius}`,
        cpu: s2.atCentrePixelTopDown, expected: s2.analyticCentrePixel,
        cpuRelErr: +Math.abs((s2.atCentrePixelTopDown - s2.analyticCentrePixel) / s2.analyticCentrePixel).toFixed(5),
        coveredPx: s2.coveredPx,
      });
      console.log(`  4.9m mesh r=${radius}: centre ${s2.atCentrePixelTopDown} vs analytic ${s2.analyticCentrePixel}`);
    }
  }
}

const md = ['', '| dist | mode | target | expected | cpu read | cpu relErr | wgsl read | wgsl relErr |', '| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |'];
for (const r of rows) {
  if (r.error) { md.push(`| ${r.dist} | ${r.mode} | — | — | ERROR | — | — | ${r.error} |`); continue; }
  md.push(`| ${r.dist} | ${r.mode} | ${r.target} | ${r.expected} | ${r.cpu} | ${r.cpuRelErr != null ? (r.cpuRelErr * 100).toFixed(2) + '%' : '—'} | ${r.wgsl ?? '—'} | ${r.wgslRelErr != null ? (r.wgslRelErr * 100).toFixed(2) + '%' : '—'} |`);
}
console.log(md.join('\n'));

writeFileSync(OUT, JSON.stringify({ meta: { url, when: new Date().toISOString() }, rows }, null, 2));
console.log(`\nwrote ${OUT}`);
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`);
process.exit(0);
