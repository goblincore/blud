// Owned headless surface-blood gate: real triangle impacts, default/deferred captures,
// persistent stains and same-frame toggle parity. Requires warm-ready and clean pipelines.
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
const VITE=process.env.LAB_VITE_PORT ?? '5368', CDP=process.env.LAB_CDP_PORT ?? '9368';
const OUT=process.env.GAME_OUT ?? 'docs/dev-notes/2026-09-30-surface-blood';
mkdirSync(OUT,{recursive:true});
const tab=await (await fetch(`http://localhost:${CDP}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,err)=>{ws.onopen=ok;ws.onerror=err;});
let seq=0; const pending=new Map(), events=[];
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}
 else if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error') events.push(m.params.args.map(a=>a.value??a.description).join(' '));
 else if(m.method==='Runtime.exceptionThrown')events.push(JSON.stringify(m.params.exceptionDetails));};
const send=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const clean=()=>check(events.length===0,events.join('\n'));
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (color !== 6 && color !== 2)) throw new Error(`unsupported png depth=${depth} color=${color}`);
  const ch = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let pos = 0;
  const row = Buffer.alloc(stride);
  const prevRaw = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0;
      const b = prevRaw[x];
      const c = x >= ch ? prevRaw[x - ch] : 0;
      let v = raw[pos + x];
      switch (filter) {
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      row[x] = v;
    }
    pos += stride;
    row.copy(prevRaw);
    for (let x = 0; x < w; x++) {
      const o = y * w * 4 + x * 4;
      out[o] = row[x * ch];
      out[o + 1] = row[x * ch + 1];
      out[o + 2] = row[x * ch + 2];
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

export function diffPngs(aBuf, bBuf) {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  if (a.w !== b.w || a.h !== b.h) throw new Error(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const n = a.w * a.h;
  let d0 = 0, max = 0;
  for (let i = 0; i < n * 4; i += 4) {
    let md = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c]);
      if (d > md) md = d;
    }
    if (md > max) max = md;
    if (md > 0) d0++;
  }
  return { w: a.w, h: a.h, diffAny: d0, pctAny: (100 * d0 / n).toFixed(4) + '%', maxChannelDelta: max };
}


async function boot(query){
 events.length=0;const start=Date.now();
 await send('Page.navigate',{url:`http://localhost:${VITE}/sdf-game.html?seed=123&frozen&${query}`});
 for(let i=0;i<480;i++){await sleep(500);clean();const phase=await evaluate('window.__warmGate?.phase').catch(()=>null);
  if(phase==='ready'){console.log(`ready ${query} (${Date.now()-start} ms)`);return await evaluate('window.__warmDone');}
  if(phase==='failed')throw new Error('warm gate failed');
 }throw new Error('warm-ready timeout');
}
async function prepare(pose){await evaluate(`__sdfGame.setLoopRunning(false);__sdfGame.freeze(true);__sdfGame.setAdaptive(false);__sdfGame.setDemoHold(true);__sdfGame.setVhs(null);__sdfGame.setSmear(0);__sdfGame.setProbeDynamic(0,0);__sdfGame.setTrainSpeed(0);__sdfGame.setFlashlight(true);__sdfGame.setViewModelVisible(false);__sdfGame.setPose(${pose.join(',')});__sdfGame.step(90);__sdfGame.setLightClockFrozen(true);`);
 await evaluate(`for(const k of ['gooPanel','woundPanel','shutterPanel','vhsPanel','lightLayersPanel','surfaceBloodPanel']) __sdfGame[k]?.(false);document.getElementById('loader')?.classList.add('loader-hidden');for(const e of document.querySelectorAll('body *')){if(e.tagName!=='CANVAS' && ['fixed','absolute'].includes(getComputedStyle(e).position))e.style.visibility='hidden';}`);
}
async function shot(name){await evaluate('__sdfGame.step(1)');await sleep(150);clean();const png=Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64');writeFileSync(`${OUT}/${name}.png`,png);return png;}
const metrics={};
try{
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:750,deviceScaleFactor:1,mobile:false});
 if(process.env.BOOT_ONLY){
   metrics.boot=await boot(process.env.BOOT_QUERY??'level=night-train');
 }else{
 for(const mode of (process.env.RENDERERS ?? 'legacy').split(',')){
  metrics[mode]={boot:await boot(`level=night-train&surfaceblood=1&renderer=${mode}`)};
  await prepare([0,-6,0,-0.6]);
  await evaluate('__sdfGame.setBleed(false);__sdfGame.setRenderLock(true)');
  const before=await shot(`${mode}-floor-before`);
  await evaluate('__sdfGame.setRenderLock(false);__sdfGame.setBleed(true);__sdfGame.setSurfaceBloodLook("wet")');
  const floor=await evaluate('__sdfGame.surfaceBloodBurst([0,0.8,-8],[0,-1,-8],36)');check(floor,'floor receiver missing');
  await evaluate('__sdfGame.step(150);__sdfGame.setBleed(false);__sdfGame.setRenderLock(true)');
  const stats=await evaluate('__sdfGame.surfaceBloodStats()');check(stats.stains>0&&stats.vertices>0,`no floor deposits ${JSON.stringify(stats)}`);
  const on=await shot(`${mode}-floor-wet`);const unchanged=await shot(`${mode}-floor-control`);metrics[mode].control=diffPngs(on,unchanged);metrics[mode].floor={stats,diff:diffPngs(before,on)};
  check(metrics[mode].floor.diff.diffAny>100,'floor stains not visible');
  await evaluate('__sdfGame.setSurfaceBlood(false)');const off=await shot(`${mode}-floor-off`);
  await evaluate('__sdfGame.setSurfaceBlood(true)');const restored=await shot(`${mode}-floor-restored`);
  metrics[mode].toggle=diffPngs(on,restored);console.log('toggle',metrics[mode].toggle);check(metrics[mode].toggle.diffAny===0,'toggle did not restore identical surface');
  metrics[mode].visible=diffPngs(off,restored);
  await evaluate('__sdfGame.setRenderLock(false);__sdfGame.setPose(0,-8,Math.PI/2,0);__sdfGame.step(2);__sdfGame.setBleed(true);__sdfGame.setSurfaceBloodLook("wet")');
  check(await evaluate('__sdfGame.surfaceBloodBurst([0,1.3,-8],[3,1.3,-8],36)'),'wall receiver missing');
  await evaluate('__sdfGame.step(150);__sdfGame.setBleed(false);__sdfGame.setRenderLock(true)');
  await shot(`${mode}-wall-wet`);metrics[mode].wall=await evaluate('__sdfGame.surfaceBloodStats()');
  await evaluate('__sdfGame.setRenderLock(false);__sdfGame.setBleed(true);__sdfGame.setSurfaceBloodLook("smear")');
  check(await evaluate('__sdfGame.surfaceBloodBurst([0,1.3,-7.3],[3,1.3,-7.3],24)'),'smear receiver missing');
  await evaluate('__sdfGame.step(150);__sdfGame.setBleed(false);__sdfGame.setRenderLock(true)');await shot(`${mode}-wall-smear`);
  await evaluate('__sdfGame.setRenderLock(false);__sdfGame.setBleed(true);__sdfGame.setSurfaceBloodLook("dry")');
  check(await evaluate('__sdfGame.surfaceBloodBurst([0,0.8,-8],[3,0.8,-8],24)'),'dry receiver missing');
  await evaluate('__sdfGame.step(150);__sdfGame.setBleed(false);__sdfGame.setRenderLock(true)');await shot(`${mode}-wall-variants`);
  await evaluate('__sdfGame.setPose(-0.65,-8.8,Math.PI/2,0);__sdfGame.setRenderLock(false);__sdfGame.step(2);__sdfGame.setRenderLock(true)');
  await shot(`${mode}-wall-oblique`);
  metrics[mode].final=await evaluate('__sdfGame.surfaceBloodStats()');metrics[mode].deposits=await evaluate('__sdfGame.surfaceBloodStains()');
  check(metrics[mode].deposits.some(d=>Math.abs(d.normal[0])>.8),'no wall-oriented stains');check(metrics[mode].deposits.some(d=>d.normal[1]>.8),'no floor-oriented stains');check(metrics[mode].final.vertices<=65536&&metrics[mode].final.stains<=192,'stain budget exceeded');
  const looks={};
  for(const look of ['wet','dry','smear']){
   await evaluate(`__sdfGame.setRenderLock(false);__sdfGame.clearSurfaceBlood();__sdfGame.setPose(0,-6,0,-0.6);__sdfGame.setBleed(true);__sdfGame.setSurfaceBloodLook('${look}');__sdfGame.step(2);`);
   check(await evaluate('__sdfGame.surfaceBloodBurst([0,0.8,-8],[0,-1,-8],18)'),'look comparison receiver missing');
   await evaluate('__sdfGame.step(150);__sdfGame.setBleed(false);__sdfGame.setRenderLock(true)');
   looks[look]=await shot(`${mode}-look-${look}`);
  }
  metrics[mode].looks={wetDry:diffPngs(looks.wet,looks.dry),wetSmear:diffPngs(looks.wet,looks.smear)};
  check(metrics[mode].looks.wetDry.diffAny>100,'wet/dry appearance is inert');
  // Cost is measured in one frozen page, alternating visible/hidden stains.
  const costs=[];
  for(let round=0;round<3;round++){
   await evaluate('__sdfGame.setSurfaceBlood(false);__sdfGame.timeDraws(2)');
   const offMs=await evaluate('__sdfGame.timeDraws(9)');
   await evaluate('__sdfGame.setSurfaceBlood(true);__sdfGame.timeDraws(2)');
   const onMs=await evaluate('__sdfGame.timeDraws(9)');costs.push({offMs,onMs});
  }
  metrics[mode].costs=costs;

 }
 }
 clean();writeFileSync(`${OUT}/metrics.json`,JSON.stringify(metrics,null,2));
 for(const [mode,m] of Object.entries(metrics)) console.log(JSON.stringify({mode,warmMs:m.boot?.ms??m.ms,drawOnce:m.boot?.phases?.drawOnce??m.phases?.drawOnce,floor:m.floor?.stats,final:m.final,visible:m.visible,looks:m.looks,costs:m.costs}));
}catch(error){writeFileSync(`${OUT}/failure.json`,JSON.stringify({error:String(error),events,metrics},null,2));throw error;}finally{await fetch(`http://localhost:${CDP}/json/close/${tab.id}`).catch(()=>{});ws.close();}
