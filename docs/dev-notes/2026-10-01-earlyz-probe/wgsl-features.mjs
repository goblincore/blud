const [, , VITE, CDP] = process.argv;
const tab = await (await fetch(`http://localhost:${CDP}/json/new?http://localhost:${VITE}/`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => setTimeout(r, 2500));
const expr = `(async () => {
  const a = await navigator.gpu.requestAdapter();
  const d = await a.requestDevice();
  const vs = '@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(0.0, 0.0, 0.5, 1.0); }';
  const variants = {
    control_bogus_requires: 'requires bogus_feature_xyz;\\n' + vs + '\\n@fragment fn fs() -> @location(0) vec4f { return vec4f(1.0); }',
    plain_frag_depth: vs + '\\nstruct O { @location(0) c: vec4f, @builtin(frag_depth) d: f32 }\\n@fragment fn fs() -> O { var o: O; o.c = vec4f(1.0); o.d = 0.75; return o; }',
    conservative_greater: 'requires fragment_depth;\\n' + vs + '\\nstruct O { @location(0) c: vec4f, @builtin(frag_depth, greater) d: f32 }\\n@fragment fn fs() -> O { var o: O; o.c = vec4f(1.0); o.d = 0.75; return o; }',
    conservative_no_requires: vs + '\\nstruct O { @location(0) c: vec4f, @builtin(frag_depth, greater) d: f32 }\\n@fragment fn fs() -> O { var o: O; o.c = vec4f(1.0); o.d = 0.75; return o; }',
  };
  const out = {};
  for (const [k, code] of Object.entries(variants)) {
    d.pushErrorScope('validation');
    const m = d.createShaderModule({ code });
    const ci = await m.getCompilationInfo();
    let pipeErr = null;
    try {
      await d.createRenderPipelineAsync({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' },
        fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
    } catch (e) { pipeErr = String(e.message || e).slice(0, 200); }
    const scopeErr = await d.popErrorScope();
    out[k] = { compile: ci.messages.map(x => x.type + ': ' + x.message.slice(0, 160)), pipeErr, scopeErr: scopeErr ? String(scopeErr.message).slice(0, 200) : null };
  }
  return JSON.stringify({ ua: navigator.userAgent.match(/Chrome\\/[0-9.]+/)?.[0], hasFeature: navigator.gpu.wgslLanguageFeatures.has('fragment_depth'), out }, null, 1);
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(r.result?.result?.value ?? JSON.stringify(r));
await fetch(`http://localhost:${CDP}/json/close/${tab.id}`);
process.exit(0);
