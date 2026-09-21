// wound-bisect.mjs — which mechanism owns the wound cost, and does it scale with pixels? (2026-09-21)
//
// One page, uncapped, frozen, 5 wounds stamped up front. Legs = a seam state x a march scale,
// run in rotating order. Every leg first RESTORES the ship state it read at boot, then applies
// its own seam, so no leg inherits another's.
//
// Usage: node wound-bisect.mjs <vitePort> <cdpPort> <repoRoot>
import { writeFileSync } from 'node:fs';
const [, , VITE = '5391', CDP = '9391', ROOT] = process.argv;
const { connectGame, bootCloseupPage, stageCloseUp, stampFacingWounds, sleep } = await import(`${ROOT}/scripts/lib/sdf-closeup-stage.mjs`);
const OUT = process.env.PROBE_OUT ?? '.';
const FRAMES = Number(process.env.PROBE_FRAMES ?? 60);
const REPS = Number(process.env.PROBE_REPS ?? 2);
const SCALES = JSON.parse(process.env.PROBE_SCALES ?? '[1.0,0.5,0.25]');

const { send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1` });
for (let i = 0; i < 120; i++) { if (await evaluate('__sdfGame.upscaleInfo?.()?.on === true')) break; await sleep(500); }
await evaluate('__sdfGame.setFrameCap(0); __sdfGame.setWoundTuning({ spillChance: 0 }); 1');
const staged = await stageCloseUp(evaluate, { settleTries: 2400 });
const ship = JSON.parse(await evaluate(`JSON.stringify({ woundList: __sdfGame.woundList, ownerRefold: __sdfGame.ownerRefold, woundEarlyOut: __sdfGame.woundEarlyOut, woundStep: __sdfGame.woundStep, relax: __sdfGame.relax })`));
console.log('staged', JSON.stringify(staged), 'ship', JSON.stringify(ship));
const wounds = await stampFacingWounds(evaluate, {});
console.log('wounds', JSON.stringify(wounds));
console.log('threats', await evaluate('JSON.stringify(__sdfGame.woundThreats?.() ?? null)'), 'clusters', await evaluate(`JSON.stringify(__sdfGame.zombie(${staged.body}).posed?.().clusters?.map(c => c.name ?? c.limb ?? c.start) ?? null)`));

const RESTORE = `__sdfGame.setWoundList(${ship.woundList}); __sdfGame.setOwnerRefold(${ship.ownerRefold}); __sdfGame.setWoundEarlyOut(${ship.woundEarlyOut}); __sdfGame.setFlatAlbedo(false);`;
const SEAMS = {
  ship: '',
  refoldOff: '__sdfGame.setOwnerRefold(false);',
  listOn: '__sdfGame.setWoundList(true);',
  listOnRefoldOff: '__sdfGame.setWoundList(true); __sdfGame.setOwnerRefold(false);',
  gate: '__sdfGame.setOwnerRefoldGate(true);',
  mask: '__sdfGame.setOwnerRefoldMask(true);',
  flat: '__sdfGame.setFlatAlbedo(true);',
  flatRefoldOff: '__sdfGame.setFlatAlbedo(true); __sdfGame.setOwnerRefold(false);',
};
const want = (process.env.PROBE_SEAMS ?? Object.keys(SEAMS).join(',')).split(',');
const legs = [];
for (const s of want) for (const sc of SCALES) legs.push({ name: `${s}@${sc}`, seam: s, scale: sc });

const census = async () => {
  const raw = await evaluate(`(async () => { __sdfGame.setMarchDebugMode(4); __sdfGame.step(3); await new Promise(r => setTimeout(r, 300)); const r = await __sdfGameDebug.readMarchTarget(); __sdfGame.setMarchDebugMode(0); return JSON.stringify({ w: r.w, h: r.h, b: r.rgba32f }); })()`, 300_000);
  const { w, h, b } = JSON.parse(raw); const buf = Buffer.from(b, 'base64');
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  let ra = 0, st = 0, mx = 0;
  for (let i = 0; i < w * h; i++) if (f[i * 4 + 2] > 0.5) { ra++; st += f[i * 4]; mx = Math.max(mx, f[i * 4]); }
  return { rays: ra, steps: st, stepsPerRay: +(st / ra).toFixed(2), maxSteps: mx };
};

const rows = [];
for (let rep = 0; rep < REPS; rep++) {
  for (let k = 0; k < legs.length; k++) {
    const leg = legs[(k + rep * 2) % legs.length];
    await evaluate(`(() => { ${RESTORE} ${SEAMS[leg.seam]} __sdfGame.setSdfScale(${leg.scale}); __sdfGame.step(3); return 1; })()`);
    const r = JSON.parse(await evaluate(`(async () => {
      const r = await __sdfGame.bench({ kind: 'closeup', mode: 'passes', closeupFrames: ${FRAMES}, warmup: 15, label: '${leg.name}' });
      return JSON.stringify({ valid: r.valid, frame: r.overall.p50, march: r.passes?.overall?.labels?.['sdf:march']?.p50 ?? null });
    })()`, 600_000));
    const c = rep === 0 ? await census() : null;
    rows.push({ rep, ...leg, ...r, census: c });
    console.log(rep, leg.name.padEnd(22), 'march', r.march?.toFixed(2).padStart(6), 'frame', r.frame.toFixed(2).padStart(6), c ? JSON.stringify(c) : '', r.valid ? '' : 'INVALID');
  }
}
// PIXEL PARITY of the raiser gate: ship vs gate vs ship again (the second ship read is the
// noise floor). Render-locked so step() is a deterministic re-render of one frozen frame.
const readTarget = async (seam, scale) => {
  const raw = await evaluate(`(async () => { ${RESTORE} ${seam} __sdfGame.setSdfScale(${scale}); __sdfGame.setRenderLock(true); __sdfGame.step(4); await new Promise(r => setTimeout(r, 300)); const r = await __sdfGameDebug.readMarchTarget(); return JSON.stringify({ w: r.w, h: r.h, b: r.rgba32f }); })()`, 300_000);
  const { w, h, b } = JSON.parse(raw); const buf = Buffer.from(b, 'base64');
  return { w, h, f: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
};
const diff = (a, b) => { let n = 0, mx = 0, hit = 0; for (let i = 0; i < a.f.length; i += 4) { if (a.f[i + 3] < 1) hit++; let d = 0; for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.f[i + c] - b.f[i + c])); if (d > 0) { n++; mx = Math.max(mx, d); } } return { differingPixels: n, maxAbs: mx, hitPixels: hit }; };
const parity = {};
if (want.includes('gate') || want.includes('mask')) for (const sc of [0.5, 1.0]) {
  const a = await readTarget('', sc), b = await readTarget(SEAMS.gate, sc), m = await readTarget(SEAMS.mask, sc), c = await readTarget('', sc), o = await readTarget(SEAMS.refoldOff, sc);
  parity[sc] = { gateVsShip: diff(a, b), maskVsShip: diff(a, m), shipVsShip: diff(a, c), refoldOffVsShip: diff(a, o) };
  console.log('parity', sc, JSON.stringify(parity[sc]));
}
await evaluate(`(() => { ${RESTORE} __sdfGame.setRenderLock(false); __sdfGame.setSdfScale(0.5); return 1; })()`);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const summary = {};
for (const l of legs) summary[l.name] = +med(rows.filter(r => r.name === l.name && r.valid).map(r => r.march)).toFixed(2);
console.log('summary', JSON.stringify(summary, null, 1));
writeFileSync(`${OUT}/${process.env.PROBE_NAME ?? 'wound-bisect'}.json`, JSON.stringify({ staged, ship, wounds, rows, summary, parity }, null, 1));
process.exit(0);
