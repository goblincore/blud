#!/usr/bin/env node
// Bounded functional smoke + matched capture driver for the opt-in skeleton
// representations. This intentionally does no timing: the Task 4 coordinator
// owns serial GPU measurement after functional validation.
//
// Usage:
//   node scripts/skeleton-compare.mjs [vitePort] [cdpPort] [outDir]
// Env:
//   SKELETON_MODES=procedural,mesh,volume (default)
//   SKELETON_SCALES=1,0.5                 (default)
//   SKELETON_OVERALL_MS=240000            (hard driver deadline)
//   SKELETON_CDP_MS=30000                 (per-CDP-call deadline)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const vite = integer(process.argv[2] ?? '5396', 'vite port');
const cdp = integer(process.argv[3] ?? '9396', 'CDP port');
const outDir = resolve(process.argv[4] ?? '/tmp/skeleton-compare');
const modes = csv(process.env.SKELETON_MODES ?? 'procedural,mesh,volume');
const scales = csv(process.env.SKELETON_SCALES ?? '1,0.5').map((v) => finite(v, 'scale'));
const overallMs = integer(process.env.SKELETON_OVERALL_MS ?? '240000', 'overall deadline');
const cdpMs = integer(process.env.SKELETON_CDP_MS ?? '30000', 'CDP deadline');
const bootMs = Math.min(integer(process.env.SKELETON_BOOT_MS ?? '60000', 'boot deadline'), overallMs);
const width = integer(process.env.SKELETON_W ?? '960', 'width');
const height = integer(process.env.SKELETON_H ?? '720', 'height');
const lifecycle = process.env.SKELETON_LIFECYCLE === '1';

assert.deepEqual(modes.filter((v) => !['procedural', 'mesh', 'volume'].includes(v)), [],
  'SKELETON_MODES may contain only procedural,mesh,volume');
assert.ok(scales.length > 0 && scales.every((v) => v === 1 || v === 0.5),
  'SKELETON_SCALES may contain only 1 and 0.5');

function csv(value) { return value.split(',').map((v) => v.trim()).filter(Boolean); }
function finite(value, label) {
  const n = Number(value); assert.ok(Number.isFinite(n), `${label} must be finite`); return n;
}
function integer(value, label) {
  const n = finite(value, label); assert.ok(Number.isInteger(n) && n > 0, `${label} must be a positive integer`); return n;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const now = () => new Date().toISOString();
const git = (args, fallback = null) => {
  try { return execFileSync('git', args, { encoding: 'utf8', timeout: 3000 }).trim(); } catch { return fallback; }
};

mkdirSync(outDir, { recursive: true });
const evidencePath = `${outDir}/validation.json`;
const evidence = {
  schema: 1,
  startedAt: now(),
  source: { branch: git(['branch', '--show-current']), commit: git(['rev-parse', 'HEAD']) },
  request: { vite, cdp, modes, scales, width, height, overallMs, cdpMs, bootMs, lifecycle },
  purpose: 'functional smoke and matched captures; no timing or performance verdict',
  runs: [],
  errors: [],
};
const save = () => writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
save();

let tab = null;
let ws = null;
let seq = 0;
const pending = new Map();
let run = null;
let timedOut = false;
const overallTimer = setTimeout(() => {
  timedOut = true;
  evidence.errors.push({ at: now(), stage: 'driver', message: `overall deadline exceeded (${overallMs} ms)` });
  save();
  ws?.close();
}, overallMs);

const boundedFetch = async (url, init = {}) => {
  const signal = AbortSignal.timeout(Math.min(cdpMs, 5000));
  const response = await fetch(url, { ...init, signal });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${response.status}`);
  return response;
};

const isTabIcon404 = (url, status) => {
  try {
    const parsed = new URL(url);
    return status === 404 && parsed.protocol === 'http:' && parsed.hostname === 'localhost'
      && parsed.port === String(vite) && parsed.pathname === '/favicon.ico' && parsed.search === '';
  } catch {
    return false;
  }
};

const pageError = (kind, value) => {
  const item = { at: now(), kind, value: typeof value === 'string' ? value.slice(0, 2000) : value };
  if (run) run.pageErrors.push(item); else evidence.errors.push({ stage: 'page-before-run', ...item });
  save();
};

const send = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
  if (timedOut) return rejectRequest(new Error('overall deadline exceeded'));
  const id = ++seq;
  const finish = (fn, value) => { clearTimeout(timer); pending.delete(id); fn(value); };
  const timer = setTimeout(() => finish(rejectRequest, new Error(`CDP timeout: ${method}`)), cdpMs);
  pending.set(id, { resolve: (m) => finish(resolveRequest, m), reject: (e) => finish(rejectRequest, e) });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: Math.max(1000, cdpMs - 1000),
  });
  if (r.error || r.result?.exceptionDetails) throw new Error(`evaluation failed: ${JSON.stringify(r).slice(0, 1200)}`);
  return r.result?.result?.value;
};

const settleAndLock = async () => {
  await evaluate(`(async () => {
    const g = window.__sdfGame;
    g.setRenderLock(false); g.freeze(true); g.setLoopRunning(false);
    g.setLightClockFrozen(true); g.step(90, 1 / 60);
    g.setRenderLock(true); g.step(2, 1 / 60);
    await g.resolveGpu();
  })()`);
  await sleep(400);
};

const capture = async (name) => {
  const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const data = response.result?.data;
  assert.ok(data, `${name}: Page.captureScreenshot returned no data`);
  const buf = Buffer.from(data, 'base64');
  const file = `${run.mode}-r${String(run.scale).replace('.', '_')}-${name}.png`;
  writeFileSync(`${outDir}/${file}`, buf);
  const item = { file, bytes: buf.length, sha256: sha256(buf) };
  run.captures.push(item); save(); return item;
};

const diagnostic = () => evaluate(`(async () => {
  const g = window.__sdfGame;
  const mesh = typeof g.skeletonMesh === 'function' ? g.skeletonMesh() : null;
  const volume = typeof g.skeletonVolume === 'function' ? g.skeletonVolume() : null;
  const volumeEvals = typeof g.skeletonVolumeEvals === 'function' ? await g.skeletonVolumeEvals() : null;
  const combined = typeof g.skeletonDiagnostics === 'function' ? g.skeletonDiagnostics() : null;
  return { requested: new URLSearchParams(location.search).get('skeleton') || 'procedural',
    backend: g.backend, boneMesh: g.boneMesh, mesh, volume, volumeEvals, combined };
})()`);

const lifecycleSmoke = async () => {
  const result = await evaluate(`(() => {
    const g = window.__sdfGame;
    if (typeof g.skeletonDiagnostics !== 'function' || typeof g.setWoundTuning !== 'function') {
      throw new Error('lifecycle smoke needs skeletonDiagnostics and setWoundTuning');
    }
    const counts = () => {
      const d = g.skeletonDiagnostics();
      if (d.activeMode !== 'volume' || !d.volume) throw new Error('lifecycle smoke requires active volume mode');
      const v = d.volume;
      return { actors: v.actors, atlases: v.atlases, grids: v.grids, gridBytes: v.gridBytes,
        atlasBytes: v.atlasBytes, bakeMs: v.bakeMs, atlasBuilds: v.atlasBuilds };
    };
    const originalBoneRatio = g.woundTuning?.boneRatio;
    if (!Number.isFinite(originalBoneRatio)) throw new Error('lifecycle smoke needs finite woundTuning.boneRatio');
    const before = counts();
    g.setLoopRunning(false); g.freeze(false); g.step(20, 1 / 60); g.freeze(true);
    const afterSteps = counts();
    let afterRebuild;
    let afterRestore;
    try {
      g.setWoundTuning({ boneRatio: originalBoneRatio + 0.0001 });
      afterRebuild = counts();
    } finally {
      g.setWoundTuning({ boneRatio: originalBoneRatio });
      afterRestore = counts();
      g.freeze(true);
    }
    return { steps: 20, originalBoneRatio, before, afterSteps, afterRebuild, afterRestore };
  })()`);
  const select = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
  const liveCountKeys = ['actors', 'atlases', 'grids'];
  const residencyKeys = [...liveCountKeys, 'gridBytes', 'atlasBytes'];
  assert.deepEqual(result.afterSteps, result.before, 'ordinary simulation steps must not rebuild or change volume residency');
  assert.deepEqual(select(result.afterRebuild, liveCountKeys), select(result.before, liveCountKeys),
    'cast rebuild must preserve live actor/atlas/grid counts');
  assert.equal(result.afterRebuild.atlasBuilds, result.before.atlasBuilds + 1,
    'bone-ratio cast rebuild must construct exactly one atlas');
  assert.deepEqual(select(result.afterRestore, residencyKeys), select(result.before, residencyKeys),
    'bone-ratio restore must recover original volume residency');
  assert.equal(result.afterRestore.atlasBuilds, result.before.atlasBuilds + 2,
    'restoring the comparison bone ratio must construct exactly one additional atlas');
  return result;
};

const assertActivePath = (mode, diag) => {
  assert.equal(diag.backend, 'webgpu', 'game backend must be WebGPU');
  assert.equal(diag.requested, mode, 'loaded query must name the requested mode');
  if (diag.combined?.activeMode != null) {
    assert.equal(diag.combined.activeMode, mode, 'combined diagnostic must prove the requested mode is active');
  } else if (mode === 'procedural') {
    // Compatibility with snapshots predating skeletonDiagnostics().
    assert.equal(diag.mesh, null, 'procedural mode must not have an active mesh renderer');
    assert.equal(diag.volume, null, 'procedural mode must not have an active volume renderer');
    assert.equal(diag.boneMesh, false, 'procedural mode must not use polygonal bone tubes');
  }
  if (mode === 'mesh') {
    assert.equal(diag.mesh?.mode, 'mesh', 'mesh diagnostic must prove mesh mode is active');
    assert.ok((diag.mesh?.segments ?? 0) > 0, 'mesh mode must render at least one segment');
  }
  if (mode === 'volume') {
    const d = diag.volume ?? diag.combined?.volume ?? diag.combined;
    assert.ok(d, 'volume mode needs an active-path diagnostic; refusing procedural fallback');
    if (diag.combined?.activeMode == null) {
      assert.equal(d.mode, 'volume', 'volume diagnostic must prove volume mode is active');
    }
    assert.ok((d.segments ?? d.activeSegments ?? d.sampledSegments ?? d.grids ?? 0) > 0,
      'volume mode must report at least one sampled/active segment');
  }
};

const stage = async (scale) => evaluate(`(() => {
  const g = window.__sdfGame;
  const required = ['setLoopRunning','freeze','setRenderLock','setLightClockFrozen','step','resolveGpu',
    'setPose','zombies','screenPosOf','cameraWorld','screenRayToWorld','stampWoundAt','setSdfScale'];
  const missing = required.filter((k) => typeof g[k] !== 'function');
  if (missing.length) return { deterministic: false, missing };
  g.woundPanel?.(false); g.gooPanel?.(false); g.setAdaptive?.(false); g.setSdfScale(${scale});
  g.teleport(1);
  const actor = g.zombies().find((z) => z.room === 1);
  if (!actor) throw new Error('room 1 has no comparison actor');
  const px = actor.pos[0] + 1.6, pz = actor.pos[2];
  const yaw = Math.atan2(actor.pos[0] - px, -(actor.pos[2] - pz));
  g.setPose(px, pz, yaw, -0.12, 0);
  return { deterministic: true, actor, pose: g.pose(), scale: ${scale},
    lights: { practicalClockFrozen: true, authoredForwardLightingUnchanged: true },
    resolution: { viewport: [${width}, ${height}], sdfScale: ${scale} } };
})()`);

const stampTorsoWound = async (actorId) => evaluate(`(() => {
  const g = window.__sdfGame;
  const z = g.zombies().find((q) => q.id === ${actorId});
  const sp = g.screenPosOf(z.pos[0], 1.1, z.pos[2]);
  const origin = g.cameraWorld();
  const ray = g.screenRayToWorld(sp.x, sp.y, 2);
  const dir = ray.map((v, i) => v - origin[i]);
  const len = Math.hypot(...dir); const n = dir.map((v) => v / len);
  const hit = g.stampWoundAt(origin[0], origin[1], origin[2], n[0], n[1], n[2], 'slug', z.id);
  return { actorId: z.id, screen: sp, hit };
})()`);

let exitCode = 0;
try {
  tab = await (await boundedFetch(`http://127.0.0.1:${cdp}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolveOpen, rejectOpen) => { ws.onopen = resolveOpen; ws.onerror = rejectOpen; }),
    new Promise((_, rejectOpen) => setTimeout(() => rejectOpen(new Error('WebSocket open timeout')), cdpMs)),
  ]);
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); return; }
    if (m.method === 'Runtime.exceptionThrown') pageError('exception', m.params.exceptionDetails);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      pageError('console.error', m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
      const entry = m.params.entry;
      const tabIcon404 = isTabIcon404(entry.url, 404) && /\b404\b/.test(entry.text);
      pageError(tabIcon404 ? 'log.warning' : `log.${entry.level}`, {
        text: entry.text,
        url: entry.url ?? null,
        networkRequestId: entry.networkRequestId ?? null,
        source: entry.source,
        nonRendering: tabIcon404,
      });
    }
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      const tabIcon404 = isTabIcon404(m.params.response.url, m.params.response.status);
      pageError(tabIcon404 ? 'network.warning' : 'network.http', {
        status: m.params.response.status,
        statusText: m.params.response.statusText,
        url: m.params.response.url,
        networkRequestId: m.params.requestId,
        type: m.params.type,
        nonRendering: tabIcon404,
      });
    }
  };
  ws.onclose = () => { for (const request of pending.values()) request.reject(new Error('CDP connection closed')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    addEventListener('unhandledrejection', e => console.error('[skeleton-compare] unhandled rejection', e.reason));
    addEventListener('error', e => console.error('[skeleton-compare] window error', e.message));
  ` });

  for (const scale of scales) for (const mode of modes) {
    run = { mode, scale, startedAt: now(), status: 'running', pageErrors: [], captures: [] };
    evidence.runs.push(run); save();
    try {
      const url = `http://localhost:${vite}/sdf-game.html?frozen=1&skeleton=${mode}`;
      run.url = url;
      const navigation = await send('Page.navigate', { url });
      if (navigation.result?.errorText) throw new Error(`navigation failed: ${navigation.result.errorText}`);
      const deadline = Date.now() + bootMs;
      while (Date.now() < deadline) {
        if (run.pageErrors.some((e) => e.kind === 'exception' || e.kind === 'console.error' || e.kind === 'log.error')) break;
        if (await evaluate('window.__sdfGame?.backend ?? null')) break;
        await sleep(250);
      }
      assert.equal(await evaluate('window.__sdfGame?.backend ?? null'), 'webgpu', 'game did not boot WebGPU before deadline');
      run.stage = await stage(scale);
      assert.equal(run.stage.deterministic, true, `missing deterministic seams: ${run.stage.missing?.join(',')}`);
      if (lifecycle && mode === 'volume') {
        run.lifecycle = await lifecycleSmoke();
        save();
      }
      await settleAndLock();
      run.diagnostic = await diagnostic();
      assertActivePath(mode, run.diagnostic);
      const first = await capture('intact-a');
      await evaluate('__sdfGame.step(2, 1 / 60); __sdfGame.resolveGpu()');
      await sleep(400);
      const repeat = await capture('intact-b');
      run.repeatable = first.sha256 === repeat.sha256;
      run.paritySuitable = run.repeatable;
      if (!run.repeatable) console.warn(`WARN ${mode} scale=${scale}: locked intact captures differ; captures are smoke-only`);
      run.wound = await stampTorsoWound(run.stage.actor.id);
      assert.ok(run.wound.hit, 'controlled torso wound ray missed');
      await evaluate('__sdfGame.setRenderLock(false); __sdfGame.freeze(true); __sdfGame.step(8, 1/60)');
      await settleAndLock();
      await capture('torso-wound');
      run.diagnosticAfterWound = await diagnostic();
      assertActivePath(mode, run.diagnosticAfterWound);
      assert.deepEqual(run.pageErrors.filter((e) => !['log.warning', 'network.warning'].includes(e.kind)), [], 'page errors occurred');
      assert.ok(run.repeatable, `${mode} scale ${scale}: locked intact captures differ; smoke completed but parity is unsuitable`);
      run.status = 'passed'; run.completedAt = now(); save();
      console.log(`PASS ${mode} scale=${scale} (${run.captures.length} captures)`);
    } catch (error) {
      run.status = 'failed'; run.completedAt = now(); run.error = String(error?.stack ?? error).slice(0, 4000);
      evidence.errors.push({ at: now(), stage: `${mode}@${scale}`, message: run.error });
      save(); exitCode = 1;
      console.error(`FAIL ${mode} scale=${scale}: ${error.message}`);
    }
  }
} catch (error) {
  evidence.errors.push({ at: now(), stage: 'driver', message: String(error?.stack ?? error).slice(0, 4000) });
  save(); exitCode = 1; console.error(`FAIL driver: ${error.message}`);
} finally {
  clearTimeout(overallTimer);
  evidence.completedAt = now(); evidence.status = exitCode === 0 ? 'passed' : 'failed'; save();
  try { ws?.close(); } catch {}
  for (const request of pending.values()) request.reject(new Error('driver cleanup'));
  if (tab?.id) {
    try { await boundedFetch(`http://127.0.0.1:${cdp}/json/close/${tab.id}`); } catch {}
  }
}

console.log(`evidence: ${evidencePath}`);
process.exitCode = exitCode;
