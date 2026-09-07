// Real WebGPU regression: an arm wound must not erase neighboring head flesh.
// Run against the lab/CDP ports managed by scripts/lab-servers.sh.
import { writeFileSync } from 'node:fs';
const port=process.env.LAB_CDP_PORT ?? '9226';
const vite=process.env.LAB_VITE_PORT ?? '5184';
const tab=await (await fetch(`http://localhost:${port}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;const pending=new Map();const browserErrors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown'){browserErrors.push(JSON.stringify(m.params));console.error('BROWSER_EXCEPTION',JSON.stringify(m.params));}if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){const error=m.params.args.map(a=>a.value??a.description).join(' ');browserErrors.push(error);console.error('BROWSER_ERROR',error.slice(0,1800));}if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}};
const send=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
try {
  await send('Runtime.enable');
  await send('Page.navigate',{url:`http://localhost:${vite}/sdf-lab-webgpu.html?character=soldier`});
  await evaluate(`(async()=>{const start=Date.now();while(!window.__sdfLab?.holdPose){if(Date.now()-start>60000)throw new Error('lab boot timeout');await new Promise(r=>setTimeout(r,100));}})()`);
  const result=await evaluate(`(async()=>{
    const base='/src/lab/sdf-zombie/';
    const [{buildBody},{compileBlob},{parseBlob},{default:source},{bindRig,applyRig},motion,{SOLDIER_PROFILE},{makeRng},damage,{packBody},gpu,wgsl,{MAX_PRIMS},carry]=await Promise.all([
      import(base+'build-body.ts'),import(base+'blob-compile.ts'),import(base+'blob-parse.ts'),import(base+'characters/soldier.blob?import&raw'),import(base+'rig-bind.ts'),import(base+'motion.ts'),import(base+'motion-profile.ts'),import(base+'wander.ts'),import(base+'damage.ts'),import(base+'pack.ts'),import(base+'webgpu/zombie-gpu.ts'),import(base+'webgpu/march.wgsl.ts'),import(base+'validate.ts'),import(base+'carry.ts')]);
    const body=buildBody(compileBlob(parseBlob(source))),bound=bindRig(body);
    const j=motion.makeMotionJoints(body,bound.rig.restPose);
    let state=motion.makeMotionState(3,[0,0,0]);
    const signals={dt:1/60,shot:null,fire:false,wounded:{armL:false,armR:false,legL:false,legR:false},missing:{armL:false,armR:false,legL:false,legR:false},severed:[],headAlive:true,forcedCollapse:false,freshWounds:[]};
    const pose=kind=>{
      for(let n=0;n<120;n++){
        const r=motion.stepMotion(state,j,{enabled:true,wander:false,profile:SOLDIER_PROFILE,forceSpeed:0,carryOverride:kind},signals,bound.rig.points,{minX:-3,maxX:3,minZ:-3,maxZ:3},makeRng(42));
        state=r.state;bound.rig.points.forEach((p,i)=>{p.pos=r.frame.restPose[i];p.prev=p.pos;});
      }
      return applyRig(body,bound);
    };
    const low=pose('low');
    const arm=low.prims.find(p=>p.bone==='upperarm.l'&&Math.hypot(...p.a.map((v,i)=>v-p.b[i]))>.01);
    const wound=damage.worldHitToWound(low.prims,[arm.a[0],arm.a[1]-.04,arm.a[2]+arm.radius],.13,'blast',0);
    if(low.prims[wound.primIdx].limb!=='armL')throw new Error('fixture missed shoulder');
    // Keep the reported high-elbow pose in the regression even after carry tuning.
    const approvedCarry=carry.CARRIES.aim;
    carry.CARRIES.aim={right:{pitch:.20,yaw:.17,fold:2.44},gunPitch:-1.209,leftPole:[.25,1,.4]};
    const aimed=pose('aim');carry.CARRIES.aim=approvedCarry;
    const centre=damage.woundWorldPos(aimed.prims,wound,0);
    const ownerId=aimed.clusters.findIndex(c=>wound.primIdx>=c.start&&wound.primIdx<c.start+c.count);
    const owner={cluster:ownerId,...aimed.clusters[ownerId]};
    const packed=packBody(aimed),data=gpu.createDataTexture();
    const rows={PRIM_A:'primA',PRIM_B:'primB',PRIM_SCALE:'primScale',PRIM_QUAT:'primQuat',REST_A:'restA',REST_B:'restB',PRIM_SHAPE:'primShape',PRIM_BEND:'primBend',PRIM_COLOR:'primColor',PRIM_SHELL:'primShell',PRIM_WARP:'primWarp',PRIM_STRAND:'primStrand',PRIM_CLIP:'primClip',CLUSTER_BOUNDS:'clusterBounds',CLUSTER_RANGE:'clusterRange',GROUP_BOUNDS:'groupBounds',GROUP_RANGE:'groupRange',CLUSTER_GROUPS:'clusterGroups'};
    for(const [row,key]of Object.entries(rows))data.writeRow(wgsl['ROW_'+row],packed[key],packed[key].length/4);
    const head=aimed.prims.filter(p=>p.limb==='head'&&p.bone==='skull');
    // Dense sample grid through the head/shoulder overlap; evaluate the real mapBody.
    const samples=[];
    for(let x=-.20;x<=.22;x+=.02)for(let y=1.20;y<=1.62;y+=.02)for(let z=-.04;z<=.32;z+=.02)samples.push([x,y,z,0]);
    const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
    const tex=device.createTexture({size:[MAX_PRIMS,wgsl.DATA_ROWS],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
    const volume=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING});
    const points=device.createBuffer({size:samples.length*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(points,0,new Float32Array(samples.flat()));
    const output=device.createBuffer({size:samples.length*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const readback=device.createBuffer({size:samples.length*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    const helpers=wgsl.HELPERS.slice(0,wgsl.HELPERS.indexOf(wgsl.MAP_BODY)+1).join('\\n');
    const code=helpers+\`
@group(0) @binding(0) var dataTex: texture_2d<f32>;
@group(0) @binding(1) var volumeTex: texture_3d<f32>;
@group(0) @binding(2) var<storage,read> points: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> output: array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&points)) { return; }
  output[id.x] = mapBody(points[id.x].xyz,dataTex,vec4<f32>(\${packed.primCount}.0,\${packed.clusterCount}.0,0.0,0.004),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(1.0,0.017,0.55,1.15),vec4<f32>(0.42,0.0,0.0,0.0),vec3<f32>(0.0),volumeTex,vec4<f32>(0.0),vec4<f32>(0.0),vec3<f32>(0.0),vec3<f32>(1.0),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0),vec4<f32>(0.0,0.0,0.0,1e9));
}\`;
    const module=device.createShaderModule({code});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw new Error(JSON.stringify(errors.map(e=>({line:e.lineNum,message:e.message}))));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:tex.createView()},{binding:1,resource:volume.createView()},{binding:2,resource:{buffer:points}},{binding:3,resource:{buffer:output}}]});
    const run=async scoped=>{
      gpu.writeWounds(data.texels,[centre],[.13],[1],[0],[.45],[.85],{},undefined,undefined,scoped?[owner]:undefined);
      device.queue.writeTexture({texture:tex},data.texels,{bytesPerRow:MAX_PRIMS*16},[MAX_PRIMS,wgsl.DATA_ROWS]);
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(samples.length/64));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,samples.length*16);device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);const result=new Float32Array(readback.getMappedRange().slice(0));readback.unmap();return result;
    };
    const legacy=await run(false),scoped=await run(true);
    const {sdPrimitive}=await import(base+'validate.ts');
    let erased=0,restored=0,armCraters=0;
    for(let i=0;i<samples.length;i++){
      const p=samples[i].slice(0,3);
      if(Math.min(...head.map(h=>sdPrimitive(p,h)))<-.003&&legacy[i*4]>.003){erased++;if(scoped[i*4]<0)restored++;}
      if(Math.min(...aimed.prims.filter(h=>h.limb==='armL').map(h=>sdPrimitive(p,h)))<-.003&&scoped[i*4]>.003)armCraters++;
    }
    device.destroy();data.tex.dispose();
    if(erased<5||restored!==erased||armCraters<1)throw new Error(JSON.stringify({erased,restored,armCraters}));
    return {erasedHeadSamplesBefore:erased,restoredHeadSamplesAfter:restored,armCavitySamples:armCraters};
  })()`);
  console.log(JSON.stringify(result));
  // Also capture the actual soldier with the new lower support-arm pose.
  await evaluate(`(async()=>{const start=Date.now();while(!window.__sdfLab?.holdPose){if(Date.now()-start>60000)throw new Error('lab boot timeout');await new Promise(r=>setTimeout(r,100));}const lab=window.__sdfLab;lab.respawn();lab.holdPose('rest');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const arm=lab.heroPosed().prims.find(p=>p.bone==='upperarm.l'&&Math.hypot(...p.a.map((v,i)=>v-p.b[i]))>.01);lab.stampWoundAt([arm.a[0]+.03,arm.a[1]-.03,arm.a[2]+3],[0,0,-1]);const wound=lab.wounds.at(-1);if(!wound||lab.current.prims[wound.primIdx].limb!=='armL')throw new Error('visual fixture missed left shoulder');lab.holdPose('aim');lab.focusHead();lab.setCam(.30,.08,.85,1.43);lab.freezeCosmetics();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));lab.pauseLoop(true);})()`);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync('/tmp/soldier-wound-aim.png',Buffer.from(shot.result.data,'base64'));
  if(browserErrors.length)throw new Error(`Lab render failed: ${browserErrors.length} browser errors; first: ${browserErrors[0]}`);
  console.log('Lab rendered wounded soldier with no browser errors.');
} finally {ws.close();await fetch(`http://localhost:${port}/json/close/${tab.id}`);}
