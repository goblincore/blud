// scripts/native-spike/inject.js
//
// NATIVE-RENDERER SPIKE, step 1: record one frame's render passes off the raw
// WebGPU API, below three.js, so they can be replayed outside the game.
//
// Injected with Page.addScriptToEvaluateOnNewDocument (capture.mjs), so it runs
// before three creates its device. It wraps the GPU* prototypes to remember the
// descriptor every object was created from, and — while armed — records each
// matching render pass as (descriptor, command list) and appends copy commands
// to the pass's own encoder so every bound buffer and texture is read back with
// the contents that pass actually saw.
//
// The three changes it makes to the page's behaviour: COPY_SRC is OR-ed into
// buffer and texture usages (so they can be read back), depth24plus becomes
// depth32float (the only depth format WebGPU can copy out; on Apple GPUs
// depth24plus already IS a 32-bit float depth buffer), and the staging copies
// ride the recorded frame. None touches the shaders or the draw calls.
(() => {
  if (typeof navigator === 'undefined' || !navigator.gpu || window.__cap) return;

  const BU = GPUBufferUsage, TU = GPUTextureUsage;
  const info = new WeakMap();      // GPU object -> { id, kind, desc, ... }
  const encDevice = new WeakMap(); // GPUCommandEncoder -> GPUDevice
  const live = new WeakMap();      // GPURenderPassEncoder -> pass record
  let nextId = 1;

  const reg = (obj, kind, rec = {}) => { info.set(obj, { id: nextId++, kind, ...rec }); return obj; };
  const isGpu = (v) => v !== null && typeof v === 'object' && info.has(v);
  // Deep-copy a descriptor at call time (three reuses and mutates them), keeping
  // GPU objects as live references; they become { $ref } when serialised.
  const snap = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (isGpu(v)) return v;
    if (ArrayBuffer.isView(v)) return Array.from(v);
    if (Array.isArray(v) || typeof v[Symbol.iterator] === 'function') return Array.from(v, snap);
    const o = {};
    for (const k in v) if (v[k] !== undefined) o[k] = snap(v[k]);
    return o;
  };
  const wrap = (proto, name, make) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = make(orig);
  };

  // bytes per texel of the formats we know how to read back
  const BPP = {
    r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1,
    rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2, r16uint: 2, r16sint: 2, r16float: 2, depth16unorm: 2,
    rgba8unorm: 4, 'rgba8unorm-srgb': 4, rgba8snorm: 4, rgba8uint: 4, rgba8sint: 4,
    bgra8unorm: 4, 'bgra8unorm-srgb': 4, rg16uint: 4, rg16sint: 4, rg16float: 4,
    r32uint: 4, r32sint: 4, r32float: 4, rgb10a2unorm: 4, rg11b10ufloat: 4, depth32float: 4,
    rg32uint: 8, rg32sint: 8, rg32float: 8, rgba16uint: 8, rgba16sint: 8, rgba16float: 8,
    rgba32uint: 16, rgba32sint: 16, rgba32float: 16,
  };
  const size3 = (s) => (typeof s === 'number' ? [s, 1, 1]
    : Array.isArray(s) ? [s[0], s[1] ?? 1, s[2] ?? 1]
    : [s.width, s.height ?? 1, s.depthOrArrayLayers ?? 1]);

  const cap = window.__cap = {
    label: 'unlabelled', // set by capture.mjs from gpu-pass-timing's observer
    filter: null,        // RegExp while armed
    recording: false,
    passes: [],
    seen: [],            // every render pass label of the recorded frame, in order
    device: null,
    deviceDesc: null,
    notes: [],
  };

  // ---- creation-time bookkeeping ------------------------------------------
  wrap(GPUAdapter.prototype, 'requestDevice', (orig) => async function (desc) {
    const device = await orig.call(this, desc);
    cap.device = device;
    cap.deviceDesc = snap(desc ?? {});
    return device;
  });
  wrap(GPUDevice.prototype, 'createBuffer', (orig) => function (desc) {
    const d = { ...desc };
    if (!(d.usage & BU.MAP_READ)) d.usage |= BU.COPY_SRC;
    return reg(orig.call(this, d), 'buffer', { desc: { size: desc.size, usage: desc.usage, label: desc.label } });
  });
  const readable = (format) => (format === 'depth24plus' ? 'depth32float' : format);
  wrap(GPUDevice.prototype, 'createTexture', (orig) => function (desc) {
    const d = { ...desc, format: readable(desc.format) };
    desc = d;
    if ((d.sampleCount ?? 1) === 1) d.usage |= TU.COPY_SRC;
    return reg(orig.call(this, d), 'texture', {
      desc: {
        size: size3(desc.size), format: desc.format, usage: desc.usage, label: desc.label,
        dimension: desc.dimension ?? '2d', mipLevelCount: desc.mipLevelCount ?? 1,
        sampleCount: desc.sampleCount ?? 1, viewFormats: snap(desc.viewFormats ?? []),
      },
    });
  });
  wrap(GPUTexture.prototype, 'createView', (orig) => function (desc) {
    if (desc?.format) desc = { ...desc, format: readable(desc.format) };
    return reg(orig.call(this, desc), 'view', { texture: this, desc: snap(desc ?? {}) });
  });
  for (const [name, kind] of [
    ['createSampler', 'sampler'], ['createBindGroupLayout', 'bindGroupLayout'],
    ['createPipelineLayout', 'pipelineLayout'], ['createShaderModule', 'shaderModule'],
    ['createBindGroup', 'bindGroup'],
  ]) {
    wrap(GPUDevice.prototype, name, (orig) => function (desc) {
      return reg(orig.call(this, desc), kind, { desc: snap(desc ?? {}) });
    });
  }
  const pipelineDesc = (desc) => (desc.depthStencil
    ? { ...desc, depthStencil: { ...desc.depthStencil, format: readable(desc.depthStencil.format) } }
    : desc);
  wrap(GPUDevice.prototype, 'createRenderPipeline', (orig) => function (desc) {
    const d = pipelineDesc(desc);
    return reg(orig.call(this, d), 'renderPipeline', { desc: snap(d) });
  });
  wrap(GPUDevice.prototype, 'createRenderPipelineAsync', (orig) => function (desc) {
    const d = pipelineDesc(desc);
    const s = snap(d);
    return orig.call(this, d).then((p) => reg(p, 'renderPipeline', { desc: s }));
  });
  wrap(GPURenderPipeline.prototype, 'getBindGroupLayout', (orig) => function (index) {
    return reg(orig.call(this, index), 'autoLayout', { pipeline: this, index });
  });
  wrap(GPUDevice.prototype, 'createCommandEncoder', (orig) => function (desc) {
    const e = orig.call(this, desc);
    encDevice.set(e, this);
    return e;
  });

  // ---- readback -----------------------------------------------------------
  // Queue a copy of a texture's every mip into mappable staging buffers.
  const stageTexture = (device, encoder, tex, out) => {
    const t = info.get(tex);
    if (!t || out.has(t.id)) return;
    const d = t.desc, bpp = BPP[d.format];
    if (!bpp || d.sampleCount !== 1) {
      out.set(t.id, { kind: 'texture', skipped: !bpp ? `format ${d.format}` : 'multisampled' });
      return;
    }
    const mips = [];
    for (let m = 0; m < d.mipLevelCount; m++) {
      const w = Math.max(1, d.size[0] >> m), h = Math.max(1, d.size[1] >> m);
      const layers = d.dimension === '3d' ? Math.max(1, d.size[2] >> m) : d.size[2];
      const bytesPerRow = Math.ceil((w * bpp) / 256) * 256;
      const staging = device.createBuffer({ size: bytesPerRow * h * layers, usage: BU.MAP_READ | BU.COPY_DST });
      encoder.copyTextureToBuffer(
        { texture: tex, mipLevel: m, aspect: d.format.startsWith('depth') ? 'depth-only' : 'all' },
        { buffer: staging, bytesPerRow, rowsPerImage: h },
        [w, h, layers],
      );
      mips.push({ staging, w, h, layers, bytesPerRow, tight: w * bpp });
    }
    out.set(t.id, { kind: 'texture', mips });
  };
  const stageBuffer = (device, encoder, buf, out) => {
    const b = info.get(buf);
    if (!b || out.has(b.id)) return;
    const size = Math.ceil(b.desc.size / 4) * 4;
    if (b.desc.usage & BU.MAP_READ) { out.set(b.id, { kind: 'buffer', skipped: 'MAP_READ' }); return; }
    const staging = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
    encoder.copyBufferToBuffer(buf, 0, staging, 0, Math.min(size, buf.size));
    out.set(b.id, { kind: 'buffer', staging, size: b.desc.size });
  };
  const stageView = (device, encoder, view, out) => {
    const v = info.get(view);
    if (v && v.kind === 'view') stageTexture(device, encoder, v.texture, out);
  };

  // ---- pass recording -----------------------------------------------------
  wrap(GPUCommandEncoder.prototype, 'beginRenderPass', (orig) => function (desc) {
    const want = cap.recording && cap.filter;
    if (cap.recording) cap.seen.push(cap.label);
    if (!want || !cap.filter.test(cap.label)) return orig.call(this, desc);
    const device = encDevice.get(this);
    const rec = { label: cap.label, encoder: this, device, desc: snap(desc), cmds: [], pre: new Map(), res: new Map(), post: new Map() };
    // An attachment that LOADS brings state in from an earlier pass (an
    // early-z seed, for one): read it back before this pass overwrites it.
    for (const a of rec.desc.colorAttachments ?? []) {
      if (a && a.loadOp === 'load') stageView(device, this, a.view, rec.pre);
    }
    const ds = rec.desc.depthStencilAttachment;
    if (ds && (ds.depthLoadOp === 'load' || ds.stencilLoadOp === 'load')) stageView(device, this, ds.view, rec.pre);
    const pass = orig.call(this, desc);
    live.set(pass, rec);
    return pass;
  });
  for (const name of [
    'setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer', 'draw', 'drawIndexed',
    'drawIndirect', 'drawIndexedIndirect', 'setViewport', 'setScissorRect', 'setStencilReference',
    'setBlendConstant',
  ]) {
    wrap(GPURenderPassEncoder.prototype, name, (orig) => function (...args) {
      const rec = live.get(this);
      if (rec) rec.cmds.push([name, ...args.map(snap)]);
      return orig.apply(this, args);
    });
  }
  wrap(GPURenderPassEncoder.prototype, 'end', (orig) => function () {
    const r = orig.call(this);
    const rec = live.get(this);
    if (!rec) return r;
    live.delete(this);
    const { device, encoder } = rec;
    for (const [name, ...a] of rec.cmds) {
      if (name === 'setBindGroup' && a[1]) {
        const bg = info.get(a[1]);
        for (const e of bg?.desc.entries ?? []) {
          const res = e.resource;
          if (isGpu(res) && info.get(res).kind === 'view') stageView(device, encoder, res, rec.res);
          else if (res && isGpu(res.buffer)) stageBuffer(device, encoder, res.buffer, rec.res);
        }
      } else if ((name === 'setVertexBuffer' && a[1]) || name === 'drawIndirect' || name === 'drawIndexedIndirect') {
        stageBuffer(device, encoder, name === 'setVertexBuffer' ? a[1] : a[0], rec.res);
      } else if (name === 'setIndexBuffer') {
        stageBuffer(device, encoder, a[0], rec.res);
      }
    }
    // The pass's own output, for the image-parity check in the replayers.
    for (const a of rec.desc.colorAttachments ?? []) {
      if (a) stageView(device, encoder, a.resolveTarget ?? a.view, rec.post);
    }
    cap.passes.push(rec);
    return r;
  });

  // ---- frame boundaries ---------------------------------------------------
  // One requestAnimationFrame callback is one frame: record from the start of
  // the first callback after arm() to the end of the first one that drew a
  // matching pass.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(async (t) => {
    const mine = cap.filter !== null && !cap.recording && cap.passes.length === 0;
    if (mine) { cap.recording = true; cap.seen = []; }
    try { await cb(t); } finally {
      if (mine) {
        cap.recording = false;
        if (cap.passes.length > 0) { cap.filter = null; cap.onFrame?.(); }
      }
    }
  });

  cap.arm = (pattern) => new Promise((resolve) => {
    cap.passes = []; cap.seen = [];
    cap.onFrame = resolve;
    cap.filter = new RegExp(pattern);
  });

  // The game's hand-stepped frames (__sdfGame.step) do not run inside a
  // requestAnimationFrame callback, so the driver brackets those itself.
  cap.begin = (pattern) => {
    cap.passes = []; cap.seen = [];
    cap.filter = new RegExp(pattern);
    cap.recording = true;
  };
  cap.end = () => { cap.recording = false; cap.filter = null; return cap.passes.length; };

  // ---- serialisation ------------------------------------------------------
  // Walk everything the recorded passes reference, map the staging buffers,
  // POST each blob to the sink and return the manifest.
  cap.collect = async (sink) => {
    await cap.device.queue.onSubmittedWorkDone();
    const objects = {};
    const ref = (o) => {
      const i = info.get(o);
      if (!objects[i.id]) {
        objects[i.id] = { kind: i.kind };
        const node = objects[i.id];
        if (i.desc !== undefined) node.desc = ser(i.desc);
        if (i.texture) node.texture = ref(i.texture);
        if (i.pipeline) { node.pipeline = ref(i.pipeline); node.index = i.index; }
      }
      return { $ref: i.id };
    };
    const ser = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if (isGpu(v)) return ref(v);
      if (Array.isArray(v)) return v.map(ser);
      const o = {};
      for (const k in v) o[k] = ser(v[k]);
      return o;
    };
    const post = async (name, bytes) => {
      const r = await fetch(`${sink}/blob/${name}`, { method: 'POST', body: bytes });
      if (!r.ok) throw new Error(`sink refused ${name}: ${r.status}`);
    };
    const drain = async (prefix, staged) => {
      const out = {};
      for (const [id, s] of staged) {
        if (s.skipped) { out[id] = { skipped: s.skipped }; cap.notes.push(`${prefix}${id}: not read back (${s.skipped})`); continue; }
        if (s.kind === 'buffer') {
          await s.staging.mapAsync(GPUMapMode.READ);
          const file = `${prefix}${id}.bin`;
          await post(file, new Uint8Array(s.staging.getMappedRange()).slice(0, s.size));
          s.staging.destroy();
          out[id] = { file, size: s.size };
          continue;
        }
        const mips = [];
        for (let m = 0; m < s.mips.length; m++) {
          const mip = s.mips[m];
          await mip.staging.mapAsync(GPUMapMode.READ);
          const padded = new Uint8Array(mip.staging.getMappedRange());
          const rows = mip.h * mip.layers;
          const tight = new Uint8Array(mip.tight * rows);
          for (let y = 0; y < rows; y++) {
            tight.set(padded.subarray(y * mip.bytesPerRow, y * mip.bytesPerRow + mip.tight), y * mip.tight);
          }
          mip.staging.destroy();
          const file = `${prefix}${id}_m${m}.bin`;
          await post(file, tight);
          mips.push({ file, width: mip.w, height: mip.h, layers: mip.layers, bytesPerRow: mip.tight });
        }
        out[id] = { mips };
      }
      return out;
    };
    const passes = [];
    for (let p = 0; p < cap.passes.length; p++) {
      const rec = cap.passes[p];
      passes.push({
        label: rec.label,
        desc: ser(rec.desc),
        cmds: rec.cmds.map((c) => c.map(ser)),
        pre: await drain(`p${p}_pre_`, rec.pre),
        res: await drain(`p${p}_`, rec.res),
        post: await drain(`p${p}_post_`, rec.post),
      });
    }
    const adapterInfo = cap.device.adapterInfo ?? {};
    return {
      meta: {
        userAgent: navigator.userAgent,
        adapter: { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture, device: adapterInfo.device, description: adapterInfo.description },
        device: cap.deviceDesc,
        features: [...cap.device.features],
        frameLabels: cap.seen,
        notes: cap.notes,
      },
      objects,
      passes,
    };
  };
})();
