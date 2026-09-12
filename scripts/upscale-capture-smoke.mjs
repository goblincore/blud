// scripts/upscale-capture-smoke.mjs — GPU smoke for the P3 capture seams
// (docs/superpowers/plans/2026-09-11-neural-upscale-p3a-capture-v2.md Task 6).
// Usage: LAB_VITE_PORT=5321 LAB_CDP_PORT=9321 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-smoke.mjs'
import { bootCapturePage, maxAbsDiff, readMarch, renderAt } from './lib/upscale-capture.mjs';
import { cameraPose } from './lib/upscale-framing.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5321);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9321);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 20 min'), 20 * 60_000).unref();
const decodeF32 = (b64) => { const c = Buffer.from(Buffer.from(b64, 'base64')); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };
const problems = [];

const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail });
const characters = await evaluate('__sdfGame.characterNames()');
const castSize = await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.teleport(1); return __sdfGame.resetCast(); })()');
if (!(castSize > 0)) problems.push(`resetCast returned ${castSize}`);
let spawned = null;
for (const name of characters) {
  const r = await evaluate(`__sdfGame.spawnDebugCharacter(${JSON.stringify(name)})`);
  if (r.errors.length === 0) { spawned = { name, id: r.id }; break; }
}
if (!spawned) fail('no character could be spawned');
await evaluate('(() => { __sdfGame.freeze(true); __sdfGame.step(10); return 1; })()');
const head = await evaluate(`__sdfGame.actorLimbCenter(${spawned.id}, 'head')`);
const torso = await evaluate(`__sdfGame.actorLimbCenter(${spawned.id}, 'torso')`);
if (!head || !torso) fail(`limb centres missing: head ${JSON.stringify(head)} torso ${JSON.stringify(torso)}`);
const body = (await evaluate('__sdfGame.zombies()')).find((z) => z.id === spawned.id);
await evaluate('(() => { const p = __sdfGame.pose(); __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw, 0, 0); __sdfGame.step(1); return 1; })()');
const eyeBase = (await evaluate('__sdfGame.cameraWorld()'))[1] - (await evaluate('__sdfGame.pose()')).pos[1];

const pose = cameraPose(head, body.yaw, 1.2, 0, head[1]);
await evaluate(`(() => { __sdfGame.setPose(${pose.x}, ${pose.z}, ${pose.yaw}, ${pose.pitch}, ${pose.eyeY - eyeBase}); __sdfGame.step(2); __sdfGame.setRenderLock(true); return 1; })()`);

// 1. a (0, 0) jitter bit-matches no jitter
const plain = await renderAt(evaluate, 1.0);
const zeroOk = await evaluate('(() => { const ok = __sdfGame.setMarchJitter(0, 0); __sdfGame.step(4); return ok; })()');
await evaluate('__sdfGame.resolveGpu()');
const zero = await readMarch(evaluate);
await evaluate('(() => { __sdfGame.setMarchJitter(null); return 1; })()');
if (!zeroOk) problems.push('setMarchJitter(0, 0) refused with fields off');
const zeroDiff = maxAbsDiff(plain, zero);
if (zeroDiff !== 0) problems.push(`(0,0) jitter differs from no jitter: ${zeroDiff}`);

// 2. a real jitter changes the march (the hook reaches it)
await evaluate('(() => { __sdfGame.setMarchJitter(0.375, 0.375); __sdfGame.step(4); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const jittered = await readMarch(evaluate);
await evaluate('(() => { __sdfGame.setMarchJitter(null); __sdfGame.step(4); return 1; })()');
if (maxAbsDiff(plain, jittered) === 0) problems.push('a 0.375 px jitter left the march unchanged — the hook is not reaching the march');

// 3. supersampled target
const ss = await evaluate('__sdfGameDebug.readSupersampledTarget(4)', 600_000);
if (ss.w !== 800 || ss.h !== 600) problems.push(`supersampled target is ${ss.w}x${ss.h}`);
if (ss.offsets.length !== 16) problems.push(`offsets ${ss.offsets.length}`);
const target = decodeF32(ss.target);
const cov = decodeF32(ss.coverage);
let nativeFlesh = 0, targetCovered = 0, disagree = 0;
for (let p = 0; p < 800 * 600; p++) {
  if (plain.data[p * 4 + 3] < 1) nativeFlesh++;
  if (target[p * 4 + 3] < 1) targetCovered++;
  if ((target[p * 4 + 3] < 1) !== (cov[p] >= 0.5)) disagree++;
}
if (disagree) problems.push(`${disagree} pixels where target alpha and coverage >= 0.5 disagree`);
if (nativeFlesh < 1000) problems.push(`only ${nativeFlesh} native flesh px — the head close-up is not in frame`);
if (Math.abs(targetCovered - nativeFlesh) > 0.05 * nativeFlesh) problems.push(`supersampled coverage ${targetCovered} vs native ${nativeFlesh} differs by > 5%`);
if ((await evaluate('__sdfGame.temporalStart.on')) !== true) problems.push('temporal ray start was not restored after supersampling');
if ((await evaluate('__sdfGame.marchJitter ?? null')) !== null && (await evaluate('__sdfGame.marchJitter')) !== undefined) problems.push('march jitter left on');

// 4. annotations
await evaluate('(() => { __sdfGame.step(2); return 1; })()');
const ann = await evaluate('__sdfGame.captureAnnotations(800, 600)');
const mine = ann.find((a) => a.actorId === spawned.id);
if (!mine?.head) problems.push('no head annotation for the spawned actor');
else {
  const { x, y, r } = mine.head;
  if (!(x > 0 && x < 800 && y > 0 && y < 600 && r > 2)) problems.push(`head circle off-frame or tiny: ${JSON.stringify(mine.head)}`);
  else if (!(plain.data[(Math.round(y) * 800 + Math.round(x)) * 4 + 3] < 1)) problems.push(`head centre (${x.toFixed(1)}, ${y.toFixed(1)}) is not on flesh`);
}

// 5. wounds: shoot the torso from 3 m
const shot = cameraPose(torso, body.yaw, 3.0, 0, torso[1] + 0.1);
await evaluate(`(() => { __sdfGame.setRenderLock(false); __sdfGame.refillShells(); __sdfGame.setPose(${shot.x}, ${shot.z}, ${shot.yaw}, ${shot.pitch}, ${shot.eyeY - eyeBase}); __sdfGame.step(2); __sdfGame.fire(1); __sdfGame.step(30); return 1; })()`);
const wounds = await evaluate(`__sdfGame.actorWounds(${spawned.id})`);
if (wounds.length === 0) problems.push('fire(1) at the torso from 3 m left no wounds (check the aim convention)');
else {
  await evaluate(`(() => { __sdfGame.setPose(${shot.x}, ${shot.z}, ${shot.yaw}, ${shot.pitch}, ${shot.eyeY - eyeBase}); __sdfGame.setRenderLock(true); __sdfGame.step(2); return 1; })()`);
  const ann2 = await evaluate('__sdfGame.captureAnnotations(800, 600)');
  if (!(ann2.find((a) => a.actorId === spawned.id)?.wounds.length > 0)) problems.push('wounds exist but none were projected');
}

// 6. refusal while fields are on
const refused = await evaluate(`(() => { __sdfGame.setFieldStyle('bodies'); const ok = __sdfGame.setMarchJitter(0.1, 0); __sdfGame.setFieldStyle('off'); return ok; })()`);
if (refused !== false) problems.push('setMarchJitter was accepted with fields on');

const logged = await evaluate('(() => window.__capConsole ?? [])()');
const shaderErrors = logged.filter(([, t]) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(t));
if (shaderErrors.length) problems.push(`${shaderErrors.length} shader console errors: ${shaderErrors[0][1].slice(0, 200)}`);
console.log(JSON.stringify({ spawned, castSize, zeroDiff, nativeFlesh, targetCovered, wounds: wounds.length, head: mine?.head ?? null }, null, 2));
for (const p of problems) console.log(`PROBLEM: ${p}`);
console.log(problems.length ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(problems.length ? 1 : 0);
