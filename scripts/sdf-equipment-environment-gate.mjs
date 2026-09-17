// Real WebGPU lifetime regression. Run from the worktree root against servers
// owned by scripts/lab-servers.sh, with LAB_VITE_PORT and LAB_CDP_PORT set.
// The unisolated control must alter the surviving object's pixels; both fixed
// paths must preserve them byte-for-byte and produce no GPU validation errors.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';

mkdirSync('.lab-tmp', { recursive: true });
const dir = mkdtempSync(resolve('.lab-tmp/equipment-environment-'));
const html = `${dir}/index.html`;
writeFileSync(html, `<!doctype html><body><script type="module">
import * as T from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setMaterialEnvironment } from '/src/lab/sdf-zombie/webgpu/material-environment.ts';
window.result = { errors: [] };
try {
  const query = new URLSearchParams(location.search);
  const renderer = new T.WebGPURenderer();
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw Error('WebGPU required');
  renderer.setSize(256, 256);
  const device = renderer.backend.device;
  device.addEventListener('uncapturederror', e => result.errors.push(e.error.message));
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(60, 1, .1, 100);
  camera.position.z = 5;
  const make = () => {
    const generator = new T.PMREMGenerator(renderer), room = new RoomEnvironment();
    const environment = generator.fromScene(room, .04);
    generator.dispose(); room.dispose();
    const material = new T.MeshStandardMaterial({ envMap: environment.texture });
    if (query.get('isolated') === '1') setMaterialEnvironment(material, environment.texture);
    const mesh = new T.Mesh(new T.BoxGeometry(), material);
    scene.add(mesh);
    return { mesh, material, environment };
  };
  const retired = make(), survivor = make();
  retired.mesh.position.x = -1; survivor.mesh.position.x = 1;
  const target = new T.RenderTarget(256, 256);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  // Only the right-hand object's crop is compared; removing the left object
  // must not alter any of these pixels. This also catches silent blank-PMREM
  // recreation when Three recovers without raising a validation error.
  const before = await renderer.readRenderTargetPixelsAsync(target, 140, 70, 100, 120);
  result.litValues = before.reduce((n, v, i) => n + (i % 4 !== 3 && v > 0), 0);
  scene.remove(retired.mesh);
  if (query.get('disposal') === 'texture') retired.environment.texture.dispose();
  else retired.environment.dispose();
  retired.mesh.geometry.dispose(); retired.material.dispose();
  for (let i = 0; i < 5; i++) {
    renderer.render(scene, camera);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const after = await renderer.readRenderTargetPixelsAsync(target, 140, 70, 100, 120);
  result.changedValues = after.reduce((n, v, i) => n + (v !== before[i]), 0);
  scene.remove(survivor.mesh);
  survivor.mesh.geometry.dispose(); survivor.material.dispose(); survivor.environment.dispose();
  retired.environment.dispose(); target.dispose(); renderer.dispose();
} catch (error) { result.failure = String(error.stack || error); }
result.done = true;
</script>`);

const vite = Number(process.env.LAB_VITE_PORT ?? 5494);
const cdp = Number(process.env.LAB_CDP_PORT ?? 9494);
try {
  const { send, evaluate } = await connectGame({ vite, cdp });
  for (const isolated of [false, true]) {
    for (const disposal of ['texture', 'target']) {
      await send('Page.navigate', { url: `http://localhost:${vite}/${relative(process.cwd(), html)}?isolated=${+isolated}&disposal=${disposal}` });
      let result;
      for (let i = 0; i < 120; i++) {
        await sleep(250);
        result = await evaluate('window.result');
        if (result?.done) break;
      }
      assert.ok(result?.done, 'GPU test timed out');
      assert.ok(!result.failure, result.failure);
      assert.ok(result.litValues > 1000, 'survivor crop must contain a rendered, lit object');
      if (isolated) {
        assert.equal(result.changedValues, 0, 'retirement changed the surviving object');
        assert.deepEqual(result.errors, []);
      } else {
        assert.ok(result.changedValues > 0 || result.errors.length > 0, 'control did not expose the lifetime bug');
      }
      console.log(JSON.stringify({ isolated, disposal, ...result }));
    }
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__equipmentGpuErrors = [];
    const requestDevice = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function(...args) {
      const device = await requestDevice.apply(this, args);
      device.addEventListener('uncapturederror', e => __equipmentGpuErrors.push(e.error.message));
      return device;
    };
  ` });
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${vite}/sdf-game.html?room=arena` });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    ready = await evaluate('!!window.__warmDone && __sdfGame.roomProbesReady()');
    if (ready) break;
    await sleep(250);
  }
  assert.ok(ready, 'game warm-up timed out');
  await evaluate('__sdfGame.freeze(true)');
  const soldiersBefore = await evaluate("__sdfGame.actorList().filter(a => a.kind === 'soldier').length");
  assert.equal(soldiersBefore, 4, 'expected the default four-soldier encounter');
  for (let i = 0; i < soldiersBefore; i++) {
    const victim = await evaluate("__sdfGame.actorList().find(a => a.kind === 'soldier')");
    if (!victim) break;
    const [x, , z] = victim.pos;
    await evaluate(`__sdfGame.setPose(${x + 2.5}, ${z + 2.5}, -Math.PI/4, -.17, 0)`);
    await sleep(500); // render the equipment before retiring its owner
    await evaluate(`__sdfGame.detonate(...__sdfGame.actorLimbCenter(${victim.id}, 'torso'))`);
    // Keep the real RAF/simulation running while panning over the aftermath.
    for (let step = 0; step < 20; step++) {
      const angle = step * Math.PI / 10;
      await evaluate(`__sdfGame.setPose(${x + Math.sin(angle) * 2.5}, ${z + Math.cos(angle) * 2.5}, ${-angle}, -.17, 0)`);
      await sleep(100);
    }
  }
  const gameplay = await evaluate(`({
    soldiersAfter: __sdfGame.actorList().filter(a => a.kind === 'soldier').length,
    gibbed: __sdfGame.dynamite().gibbed,
    errors: __equipmentGpuErrors,
  })`);
  assert.equal(gameplay.soldiersAfter, 0, 'soldier equipment was not retired');
  assert.ok(gameplay.gibbed >= soldiersBefore);
  assert.deepEqual(gameplay.errors, []);
  console.log(JSON.stringify({ gameplay }));
  console.log('PASS: independent environment bindings survive owner retirement');
  process.exitCode = 0;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// connectGame closes only this driver's tab on process exit.
process.exit(process.exitCode);
