import { createPresetLibrary, createRegionState, advanceRegion, hitRegion } from './presets';
import { PROBE_WGSL } from './probe.wgsl';
async function boot() {
    const canvas = document.querySelector('canvas');
    const status = document.querySelector('#status');
    const library = createPresetLibrary(32);
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter)
        throw new Error('WebGPU adapter unavailable');
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', e => { errors.push(e.error.message); status.textContent = errors.join('\n'); });
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC, alphaMode: 'opaque' });
    const texture = device.createTexture({ size: [32, 32, 64], dimension: '3d', format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture }, library.copyAtlas(), { bytesPerRow: 32 * 4, rowsPerImage: 32 }, [32, 32, 64]);
    const uniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: PROBE_WGSL });
    const info = await module.getCompilationInfo();
    const compileErrors = info.messages.filter(m => m.type === 'error');
    if (compileErrors.length)
        throw new Error(compileErrors.map(m => m.message).join('\n'));
    const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: texture.createView() }] });
    let state = createRegionState(), yaw = 0, diagnostic = false, clock = null;
    let animation;
    const config = new Float32Array(12);
    function render() {
        const blend = advanceRegion(state, clock ?? performance.now());
        config.set([canvas.width, canvas.height, yaw, diagnostic ? 1 : 0, blend.from, blend.to, blend.blend, 160, 32, library.pitch, .22, library.lipschitz]);
        device.queue.writeBuffer(uniform, 0, config);
        const target = context.getCurrentTexture();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        status.textContent = `State ${blend.from} → ${blend.to} · blend ${blend.blend.toFixed(2)}\nShared GPU fields: ${(library.byteLength / 1024).toFixed(0)} KiB total · 32³ × 2 R32F fields · no per-actor volume\nPer actor: 4 numbers (IDs + time); at most 2 endpoints · cached field derivative bound ${library.lipschitz.toFixed(3)}\nNot a gameplay FPS benchmark. Both paths calculate gradients during each field evaluation in this first comparison.`;
        return target;
    }
    function animate() { render(); if (state.current !== state.target)
        animation = requestAnimationFrame(animate);
    else
        animation = undefined; }
    function setStage(stage) { if (animation !== undefined)
        cancelAnimationFrame(animation); animation = undefined; clock = null; state = { current: stage, target: stage, queued: stage, startedAt: 0 }; render(); }
    async function read() {
        const target = render();
        const stride = Math.ceil(canvas.width * 4 / 256) * 256;
        const buffer = device.createBuffer({ size: stride * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: stride }, [canvas.width, canvas.height]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const raw = new Uint8Array(buffer.getMappedRange());
        const rgba = new Uint8Array(canvas.width * canvas.height * 4);
        for (let y = 0; y < canvas.height; y++)
            rgba.set(raw.subarray(y * stride, y * stride + canvas.width * 4), y * canvas.width * 4);
        buffer.unmap();
        buffer.destroy();
        if (format.startsWith('bgra'))
            for (let i = 0; i < rgba.length; i += 4) {
                const b = rgba[i];
                rgba[i] = rgba[i + 2];
                rgba[i + 2] = b;
            }
        let binary = '';
        for (let i = 0; i < rgba.length; i += 8192)
            binary += String.fromCharCode(...rgba.subarray(i, i + 8192));
        return { width: canvas.width, height: canvas.height, rgba: btoa(binary), errors: [...errors] };
    }
    document.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => setStage(Number(b.dataset.stage)));
    document.querySelector('#reset').onclick = () => setStage(0);
    document.querySelector('#hit').onclick = () => { clock = null; hitRegion(state, performance.now()); if (animation === undefined)
        animate(); };
    document.querySelector('#yaw').oninput = e => { yaw = Number(e.target.value); render(); };
    const api = { setStage, read, render, setView(v) { yaw = v; render(); }, setDiagnostic(v) { diagnostic = v; render(); }, setTransition(from, to, t) { if (animation !== undefined) cancelAnimationFrame(animation); animation = undefined; clock = t; state = { current: from, target: to, queued: to, startedAt: 0 }; render(); }, info: () => ({ libraryBytes: library.byteLength, resolution: 32, state: { ...state }, errors: [...errors], lipschitz: library.lipschitz }) };
    Object.assign(window, { __sharedWoundProbe: api });
    render();
}
void boot().catch(error => { document.querySelector('#status').textContent = String(error); Object.assign(window, { __sharedWoundError: String(error) }); });
