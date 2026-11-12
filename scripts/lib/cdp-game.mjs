// scripts/lib/cdp-game.mjs — a small CDP driver for headless sdf-game captures (body LOD spike, 2026-11-08).
// openGame(vite, cdp) gives { boot(query), ev(expr), shot() -> png buffer, measure(), close() }.
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT(${ms}ms): ${what}`)), ms))]);

export async function openGame(VITE, CDP, { width = 960, height = 540 } = {}) {
  const tab = await (await fetch(`http://localhost:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const close = () => { try { execFileSync('curl', ['-s', '-m', '2', `http://localhost:${CDP}/json/close/${tab.id}`], { stdio: 'ignore' }); } catch {} };
  process.on('exit', close);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
  let seq = 0; const pending = new Map(); let events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') events.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    if (m.method === 'Runtime.exceptionThrown') events.push({ type: 'exception', text: JSON.stringify(m.params.exceptionDetails).slice(0, 600) });
  };
  const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression, ms = 90000) => {
    const r = await withTimeout(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), ms, expression.slice(0, 80));
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await fetch(`http://localhost:${CDP}/json/activate/${tab.id}`);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return {
    events: () => events,
    errors: () => events.filter((e) => e.type === 'error' || e.type === 'exception'),
    ev, send, sleep, close,
    async boot(query, { readyTries = 400 } = {}) {
      events = [];
      await send('Page.navigate', { url: `http://localhost:${VITE}/sdf-game.html?${query}` });
      for (let i = 0; i < readyTries; i++) {
        await sleep(500);
        const phase = await ev('window.__warmGate ? window.__warmGate.phase : null', 5000).catch(() => null);
        if (phase === 'ready') return true;
        if (events.some((e) => e.type === 'exception')) break;
      }
      throw new Error(`boot ${query} never reached ready: ${JSON.stringify(events.slice(-6))}`);
    },
    async shot() { return Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'); },
    /** frameSplit (loop stopped) + pass timings over a few draws. */
    async measure(n = 21) {
      const split = await ev(`__sdfGame.frameSplit(${n})`, 180000);
      await ev('__sdfGame.passTimings()');                       // drain
      // Completion-order attribution (gpu-pass-timing.ts attributePassSamples): on this GPU every pass reports the
      // command buffer's start, so a pass is charged only for the time the timeline advanced while it completed.
      const march = [], total = [];
      for (let i = 0; i < 7; i++) {
        await ev('__sdfGame.timeDraws(1)');
        const s = ((await ev('__sdfGame.passTimings()'))?.samples ?? []).filter((x) => x.start !== undefined && x.end !== undefined);
        if (!s.length) continue;
        s.sort((a, b) => a.end - b.end);
        let cur = Math.min(...s.map((x) => x.start)), m = 0;
        const t0 = cur;
        for (const x of s) { const c = Math.max(0, x.end - Math.max(cur, x.start)); if (String(x.label).startsWith('sdf:march')) m += c; cur = Math.max(cur, x.end); }
        march.push(m); total.push(cur - t0);
      }
      const med = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];
      return { ...split, marchMs: march.length ? +med(march).toFixed(2) : null, gpuSpanMs: total.length ? +med(total).toFixed(2) : null };
    },
  };
}
