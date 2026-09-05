import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readNormalGates } from './lib/normal-gradient-gates.mjs';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const phase = valueOf('--phase', 'kernel');
const outDir = resolve(valueOf('--out', '/tmp/zombie-normal-gradient'));
const vite = Number(valueOf('--vite', process.env.LAB_VITE_PORT ?? 5233));
const cdp = Number(valueOf('--cdp', process.env.LAB_CDP_PORT ?? 9223));
const negativeControl = argv.includes('--negative-control');
const allowed = new Set(['kernel', 'intact', 'wounds', 'verdict']);
if (!allowed.has(phase)) throw new Error(`unknown phase ${phase}`);
mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)),
]);
const reasonCode = {
  ok: 0, unsupported: 1, degenerate: 2, 'hard-boundary': 3,
  'owner-unstable': 4, 'wound-pending': 5, 'sampled-cache': 6, inactive: 7,
};

let tab = null;
let ws = null;
let seq = 0;
const pending = new Map();
const consoleEvents = [];
let report = {
  version: 1,
  phase,
  negativeControl,
  vite,
  cdp,
  backend: null,
  referenceGate: null,
  passed: false,
  results: [],
  failures: [],
  console: [],
};

const send = (method, params = {}) => withTimeout(new Promise((resolveSend, reject) => {
  const id = ++seq;
  pending.set(id, { resolve: resolveSend, reject });
  ws.send(JSON.stringify({ id, method, params }));
}), 30000, method);

const evaluate = async expression => {
  const response = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails).slice(0, 1200));
  }
  return response.result?.result?.value;
};

function assess(results) {
  const failures = [];
  const checked = results.map(result => {
    const item = { ...result, comparisons: [] };
    if (!Array.isArray(result.actual) || result.actual.length !== 4) {
      failures.push(`${result.name}: actual output is not four channels`);
      return item;
    }
    if (!result.actual.every(Number.isFinite)) failures.push(`${result.name}: non-finite GPU output`);
    const wantedReason = reasonCode[result.expectedReason];
    if (result.reasonCode !== wantedReason) {
      failures.push(`${result.name}: reason ${result.reasonCode}, expected ${wantedReason} ${result.expectedReason}`);
    }
    if (wantedReason !== 0) {
      if (result.reasonCode === 0) failures.push(`${result.name}: invalid case incorrectly reported ok`);
      return item;
    }
    for (const [source, reference] of [['cpu', result.expected], ['scalar-oracle', result.oracle]]) {
      if (!Array.isArray(reference) || reference.length !== 4 || !reference.every(Number.isFinite)) {
        failures.push(`${result.name}: missing finite ${source} reference`);
        continue;
      }
      for (let channel = 0; channel < 4; channel++) {
        const tolerance = channel === 0
          ? 5e-5 + 1e-4 * Math.abs(reference[channel])
          : 2e-3 + 1e-2 * Math.abs(reference[channel]);
        const error = Math.abs(result.actual[channel] - reference[channel]);
        item.comparisons.push({ source, channel, reference: reference[channel], error, tolerance });
        if (error > tolerance) {
          failures.push(`${result.name}: ${source} channel ${channel} error ${error} > ${tolerance}`);
        }
      }
    }
    return item;
  });
  return { checked, failures };
}

try {
  const gates = await readNormalGates(resolve('docs/dev-notes/2026-09-05-zombie-analytic-normals/gates.json'));
  report.referenceGate = gates.reference ?? null;
  if (gates.reference !== 'pass') throw new Error(`reference gate is ${gates.reference ?? 'missing'}, expected pass`);
  tab = await withTimeout(
    fetch(`http://localhost:${cdp}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json()),
    10000,
    'open CDP target',
  );
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await withTimeout(new Promise((open, reject) => {
    ws.onopen = open;
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  }), 10000, 'CDP websocket');
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: message.params.args.map(x => x.value ?? x.description ?? '').join(' '),
      });
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({ type: 'exception', text: JSON.stringify(message.params.exceptionDetails).slice(0, 1000) });
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  const page = phase === 'kernel' ? 'normal-gradient-check.html' : 'sdf-game.html';
  await send('Page.navigate', { url: `http://localhost:${vite}/${page}` });

  if (phase !== 'kernel') throw new Error(`phase ${phase} is reserved for its dependent task`);
  let status = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    await sleep(250);
    status = await evaluate(`typeof window.__zombieNormalGradient === 'object'
      ? window.__zombieNormalGradient.status() : null`);
    if (status?.phase === 'ready' || status?.phase === 'failed') break;
  }
  if (!status) throw new Error('probe API did not appear');
  if (status.phase !== 'ready') throw new Error(`probe bootstrap ${status.phase}: ${status.error ?? 'unknown'}`);
  if (status.backend !== 'webgpu') throw new Error(`backend ${status.backend}, expected webgpu`);
  report.backend = status.backend;

  const values = await evaluate(`window.__zombieNormalGradient.run({ negateX: ${negativeControl} })`);
  if (!Array.isArray(values) || values.length === 0) throw new Error('probe returned an empty result array');
  if (values.length !== status.count) throw new Error(`probe returned ${values.length} rows, expected ${status.count}`);
  const assessment = assess(values);
  report.results = assessment.checked;
  report.failures.push(...assessment.failures);
  const shaderIssues = consoleEvents.filter(event =>
    event.type === 'error' || event.type === 'exception' ||
    (/warn/i.test(event.type) && /wgsl|shader|webgpu|validation/i.test(event.text)),
  );
  report.console = consoleEvents;
  if (shaderIssues.length) report.failures.push(`shader console is not clean: ${JSON.stringify(shaderIssues.slice(0, 4))}`);
  report.passed = report.failures.length === 0;

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(resolve(outDir, 'numeric-visualization.png'), Buffer.from(shot.result.data, 'base64'));
} catch (error) {
  report.failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  report.passed = false;
} finally {
  report.console = consoleEvents;
  writeFileSync(resolve(outDir, `${phase}.json`), `${JSON.stringify(report, null, 2)}\n`);
  if (ws) ws.close();
  if (tab?.id) {
    try {
      execFileSync('curl', ['-s', '-m', '3', `http://localhost:${cdp}/json/close/${tab.id}`], { stdio: 'ignore' });
    } catch { /* closing an already-gone target is harmless */ }
  }
}

for (const result of report.results) {
  console.log(`${result.name}: actual=${JSON.stringify(result.actual)} reason=${result.reasonCode} expected=${result.expectedReason}`);
}
if (report.passed) {
  console.log(`KERNEL PASS: ${report.results.length} named cases; evidence ${outDir}`);
} else {
  console.error(`KERNEL FAIL: ${report.failures.join(' | ')}`);
  process.exitCode = 1;
}
