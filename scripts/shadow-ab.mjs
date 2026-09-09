// scripts/shadow-ab.mjs — the character shadow, before and after, in ONE load.
//
// WHY NOT dungeon-look.sh TWICE. A cross-load A/B of the shadow caster is not
// trustworthy: the actors wander, and two builds captured back to back freeze
// at different headings. Measured on this page — a same-state pair already
// moves ~6.6k px of a 1.0 Mpx frame, and the residual sits ON the figure, i.e.
// exactly where the shadow change is. Reloading also re-rolls which zombie is
// standing in the beam at all (one attempt framed an empty wall).
//
// So: one page load, one frozen frame, and __sdfGame.setShadowSpan toggled
// between shots. Nothing but the caster changes, and the in-load floor is
// ~150 changed px rather than 6600.
//
// It also STAGES the shot from the live positions rather than a fixed pose:
// it picks the zombie with about 2.6 m of clear wall behind it and stands
// LOOK_DIST in front. Shadow size on that wall goes as (d + w) / d, so this
// is what makes the caster's shape legible at all.
//
//   scripts/shadow-ab.sh                 # -> /tmp/shadow-ab/ab-{before,after}.png
//   LOOK_DIST=2.4 LOOK_ZID=10 scripts/shadow-ab.sh
//
// Shots written: -before (no span, inflate 1.35 — the state the owner
// rejected), -after (the shipped hull), -before2 (the in-load noise floor),
// and -on/-off (the caster hidden entirely — the CONTROL that proves the
// shadow reaches the capture at all, without which no delta below means
// anything).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const VITE=Number(process.argv[2]??5288), CDP=Number(process.argv[3]??9288);
const OUT=process.env.LOOK_OUT ?? '/tmp/shadow-ab';
const POSE=(process.env.LOOK_POSE ?? '-7.4,-7.4,2.3561945,0').split(',').map(Number);
const TAG=process.argv[4] ?? 'ab';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tab=await (await fetch(`http://localhost:${CDP}/json/new?about:blank`,{method:'PUT'})).json();
process.on('exit',()=>{try{execFileSync('curl',['-s','-m','2',`http://localhost:${CDP}/json/close/${tab.id}`],{stdio:'ignore'});}catch{}});
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,err)=>{ws.onopen=ok;ws.onerror=err;});
let seq=0;const pend=new Map();const errs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;}
  if(m.method==='Runtime.exceptionThrown')errs.push(JSON.stringify(m.params.exceptionDetails).slice(0,200));};
const send=(method,params={})=>new Promise(res=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
  if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
mkdirSync(OUT,{recursive:true});
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:`http://localhost:${VITE}/sdf-game.html`});
for(let i=0;i<600;i++){await sleep(200);if(await ev('typeof window.__sdfGame === "object"'))break;}
if(!(await ev('typeof window.__sdfGame === "object"'))){console.error('never booted',errs);process.exit(1);}
await ev('typeof window.__sdfGame.gooPanel === "function" && window.__sdfGame.gooPanel(false)');
await ev('typeof window.__sdfGame.vhsPanel === "function" && window.__sdfGame.vhsPanel(false)');
await ev('window.__sdfGame.freeze(true)');
await ev('window.__sdfGame.setLoopRunning(false)');
// STAGE THE SHOT FROM THE LIVE POSITIONS. The actors wander, so a fixed
// camera pose finds a different room every load — the `solo` attempt framed
// an empty wall because its zombie had walked out of the beam. Instead: pick
// the zombie with the most clear wall behind it, and stand DIST in front of
// it on the far side. Shadow size on that wall goes as (d + w) / d, so this
// is the staging that makes the caster's shape legible at all.
const DIST = Number(process.env.LOOK_DIST ?? 2.2);
const stage = await ev(`(() => {
  const HALF = 4, BAND = 0.8;
  const rooms = { 1: [-8.8,-0.8,-8.8,-0.8], 2: [0.8,8.8,-8.8,-0.8], 3: [0.8,8.8,0.8,8.8], 4: [-8.8,-0.8,0.8,8.8] };
  let best = null;
  const only = ${Number(process.env.LOOK_ZID ?? 0)};
  for (const z of window.__sdfGame.zombies()) {
    if (only && z.id !== only) continue;
    const r = rooms[z.room]; if (!r) continue;
    const [x0,x1,z0,z1] = r, x = z.pos[0], zz = z.pos[2];
    // Four candidate sight-lines: +x, -x, +z, -z. w is the wall BEHIND the
    // body; room is the space in front for the camera to stand in.
    const cands = [
      { dir: [1,0],  w: x1 - x, room: x - x0 },
      { dir: [-1,0], w: x - x0, room: x1 - x },
      { dir: [0,1],  w: z1 - zz, room: zz - z0 },
      { dir: [0,-1], w: zz - z0, room: z1 - zz },
    ];
    for (const c of cands) {
      if (c.room < ${DIST} + 0.4) continue;
      // Nothing else between the camera and the body, or the near zombie
      // fills the frame (which is exactly what the first attempt did).
      const cam = [x - c.dir[0] * ${DIST}, zz - c.dir[1] * ${DIST}];
      const blocked = window.__sdfGame.zombies().some(o => o.id !== z.id
        && Math.hypot(o.pos[0] - cam[0], o.pos[2] - cam[1]) < 1.8);
      if (blocked) continue;
      // Prefer a wall about WANT metres behind the body: too close and the
      // shadow is the body's own size, too far and the beam has fallen off.
      const score = Math.abs(c.w - 2.6);
      if (!best || score < best.score) best = { id: z.id, w: c.w, score, cam, dir: c.dir, body: [x, zz] };
    }
  }
  return best ? JSON.stringify(best) : null;
})()`);
if (!stage) { console.error('no stageable zombie'); process.exit(3); }
const st = JSON.parse(stage);
// yaw convention, read from game-main rather than guessed at:
//   forward = (sin yaw, -cos yaw)      [game-main.ts:1410]
// which the shipped `corridor` pose confirms (yaw pi/2 at (-7.4,-4.8) looks
// +x, straight down tunnel-1-2). Two wrong guesses at this cost two captures.
const yaw = Math.atan2(st.dir[0], -st.dir[1]);
console.log('stage:', stage, 'yaw', yaw.toFixed(4));
await ev(`window.__sdfGame.setPose(${st.cam[0]}, ${st.cam[1]}, ${yaw}, 0)`);
await ev('window.__sdfGame.step(20, 1/60)');
async function shot(name, span, inflate){
  await ev(`window.__sdfGame.setShadowSpan(${span}${inflate === undefined ? '' : ', ' + inflate})`);
  await ev('window.__sdfGame.refreshHull()');
  // Re-arm the shadow node: with the loop stopped three r185 will not
  // re-render the shadow map unless the light's shadow is marked dirty.
  await ev(`(()=>{const s=window.__dungeon&&window.__dungeon.spot;if(!s||!s.shadow)return false;s.shadow.intensity=1;return true;})()`);
  await ev('window.__sdfGame.step(3, 1/60)');
  await sleep(Number(process.env.LOOK_SETTLE_MS ?? 500));
  const s=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${OUT}/${name}.png`,Buffer.from(s.result.data,'base64'));
  console.log(name, 'hull', JSON.stringify(await ev('JSON.stringify(window.__sdfGame.hullDebug())')));
}
// beads first, then spanned, then beads AGAIN — the repeat is the in-load
// noise floor, and it must be far smaller than the A/B delta or the toggle
// is not doing anything the compositor can see.
// CONTROL FIRST: does the character shadow reach the capture AT ALL? Hide the
// caster entirely. If that shows no delta, nothing downstream is measurable
// and the harness is what is wrong, not the fix.
const hide = async (v) => ev(`(()=>{const s=window.__dungeon.spot;let r=s;while(r.parent)r=r.parent;
  let n=0;r.traverse(o=>{if(o.isInstancedMesh&&o.layers.mask===64){o.visible=${v};n++;}});return n;})()`);
await hide(true);  await shot(`${TAG}-on`, true);
await hide(false); await shot(`${TAG}-off`, true);
await hide(true);  await shot(`${TAG}-on2`, true);
// BEFORE = exactly what the owner rejected: no spanning, inflate 1.35.
await shot(`${TAG}-before`, false, 1.35);
await shot(`${TAG}-after`, true);
await shot(`${TAG}-before2`, false, 1.35);   // in-load floor for the pair
if(errs.length)console.log('errors',errs.slice(-3));
ws.close();process.exit(0);
