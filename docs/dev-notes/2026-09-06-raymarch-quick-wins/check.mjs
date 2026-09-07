import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {connectGame} from '../../../scripts/lib/sdf-closeup-stage.mjs';
const vite=Number(process.env.LAB_VITE_PORT),cdp=Number(process.env.LAB_CDP_PORT);
const c=await connectGame({vite,cdp,onFail:m=>{throw Error(m)}});
const source=execFileSync('git',['show','0a1906d0:src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts'],{encoding:'utf8'});
const extract=name=>source.split(`const ${name} = /* wgsl */ \``)[1].split('`;')[0].replaceAll('${TILE_MAX_ENTRIES}','64');
const negativeControl=process.argv.includes('--negative-control');
const legacy={NG_BODY:extract('NG_BODY'),NG_EXCLUDED:extract('NG_EXCLUDED')};
const marchSource=execFileSync('git',['show','0a1906d0:src/lab/sdf-zombie/webgpu/march.wgsl.ts'],{encoding:'utf8'});
const oldFold= /    var sd = sdPrim[^\n]+\n    if \(ori\)[^\n]+/.exec(marchSource)[0];
try {
 await c.send('Page.navigate',{url:`http://localhost:${vite}/package.json`});
 await c.evaluate('document.readyState');
 const report=await c.evaluate(`(async()=>{
 const M=await import('/src/lab/sdf-zombie/webgpu/march.wgsl.ts');
 const N=await import('/src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts');
 const legacy=${JSON.stringify(legacy)},oldFold=${JSON.stringify(oldFold)};
 const adapter=await navigator.gpu.requestAdapter();const device=await adapter.requestDevice();
 const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const size=64*3*16;
 const data=device.createTexture({size:[128,M.DATA_ROWS],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const vol=device.createTexture({size:[1,1,1],dimension:'3d',format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING});
 const out=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const args='p, data, vec4<f32>(3.0, 1.0, 0.0, 0.02), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec3<f32>(0.0), vol, vec4<f32>(0.0), vec4<f32>(0.0), vec3<f32>(0.0), vec3<f32>(1.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0,0.0,0.0,1e9)';
 const pipelines=[];
 for(const mode of ['legacy','candidate']) {
  let helpers=[...M.HELPERS,...N.NORMAL_GRADIENT_HELPERS,...N.NORMAL_GRADIENT_GAME_HELPERS];
  if(mode==='legacy'||${negativeControl})helpers=helpers.map(h=>h.startsWith('fn ngBody(')?legacy.NG_BODY:h.startsWith('fn ngExcluded(')?legacy.NG_EXCLUDED:h.startsWith('fn foldGroup(')?h.replace(/    var sd: f32;\\n    if \\(ori\\)[^\\n]+\\n    else[^\\n]+/,oldFold):h);
  for(const [key,value] of Object.entries(M))if(typeof value==='number')helpers=helpers.map(h=>h.split('$'+'{'+key+'}').join(String(value)));
  // Count actual helper calls; this diagnostic shader is never used for timing.
  helpers=helpers.map(h=>/^fn (ngGroup|sdPrim|sdPrimO)\\(/.test(h)?h.replace('{','{ testCalls = testCalls + 1.0;'):h);
  const code='var<private> testCalls: f32;\\n'+helpers.join('\\n')+\`\n@group(0) @binding(0) var data: texture_2d<f32>;
@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<vec4<f32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>) {
 let p=vec3<f32>(f32(id.x%8u)*0.04-0.14, f32(id.x/8u)*0.04-0.14,0.26);
 gTileActive=f32(textureLoad(data,vec2<i32>(127,0),0).x);
 gTileN=select(3.0,1.0,gTileActive>1.5);
 for(var e=0;e<3;e=e+1){gTileBounds[e]=textureLoad(data,vec2<i32>(e,\${M.ROW_GROUP_BOUNDS}),0);gTileGrp[e]=textureLoad(data,vec2<i32>(e,\${M.ROW_GROUP_RANGE}),0);gTileBand[e]=0.0;}
 testCalls=0.0;
 let ng=ngBody(\${args});let reason=gNgReason;let analyticCalls=testCalls;
 var normal=ng.yzw;
 if(reason!=0){normal=calcNormal(\${args});}else{normal=normalize(normal);}
 testCalls=0.0;
 let field=mapBody(\${args});
 output[id.x*3u]=vec4<f32>(normal,field.x);
 output[id.x*3u+1u]=vec4<f32>(f32(reason),analyticCalls,testCalls,field.y);
 output[id.x*3u+2u]=select(vec4<f32>(0.0),ng,reason==0);
}\`;
  const module=device.createShaderModule({code});const info=await module.getCompilationInfo();
  if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
  const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:data.createView()},{binding:1,resource:vol.createView()},{binding:2,resource:{buffer:out}}]});
  pipelines.push({pipeline,bind});
 }
 const results=[];
 for(const tile of [0,1,2])for(const far of [false,true])for(const unsupported of [-1,0,1,2])for(const oriented of [false,true]){
  const texels=new Float32Array(128*M.DATA_ROWS*4);
  const put=(row,i,v)=>texels.set(v,(row*128+i)*4);
  put(0,127,[tile,0,0,0]);
  for(let i=0;i<3;i++){
   const x=far&&i>0?3.0+i:i*0.18;
   put(M.ROW_PRIM_A,i,[x,-0.1,0,0.24]);put(M.ROW_PRIM_B,i,[x,0.1,0,0.02]);
   put(M.ROW_PRIM_SCALE,i,[1.4,0.8,1,0]);put(M.ROW_PRIM_SHAPE,i,[-1,i===unsupported?8:0,0,0]);
   put(M.ROW_PRIM_QUAT,i,oriented?[0,0,Math.sin(.3),Math.cos(.3)]:[0,0,0,1]);
   put(M.ROW_GROUP_BOUNDS,i,[x,0,0,0.5]);put(M.ROW_GROUP_RANGE,i,[i,1,1.75,(oriented?1:0)+(i===unsupported?2:0)]);
  }
  put(M.ROW_CLUSTER_BOUNDS,0,[.18,0,0,1]);put(M.ROW_CLUSTER_RANGE,0,[0,3,1,0]);put(M.ROW_CLUSTER_GROUPS,0,[0,3,1.75,0]);
  device.queue.writeTexture({texture:data},texels,{bytesPerRow:128*16},[128,M.DATA_ROWS]);
  const frames=[];
  for(const {pipeline,bind} of pipelines){const enc=device.createCommandEncoder();const pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();enc.copyBufferToBuffer(out,0,read,0,size);device.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);frames.push(new Float32Array(read.getMappedRange().slice(0)));read.unmap();}
  const [a,b]=frames;let maxDelta=0,reasonChanges=0,oldCalls=0,newCalls=0,oldScalar=0,newScalar=0;
  for(let i=0;i<64;i++){let k=i*12;for(const j of [0,1,2,3,7,8,9,10,11])maxDelta=Math.max(maxDelta,Math.abs(a[k+j]-b[k+j]));if(a[k+4]!==b[k+4])reasonChanges++;oldCalls+=a[k+5];newCalls+=b[k+5];oldScalar+=a[k+6];newScalar+=b[k+6];}
  if(!a.every(Number.isFinite)||!b.every(Number.isFinite)||maxDelta>1e-6||reasonChanges||newCalls>oldCalls||newScalar>oldScalar)throw Error(JSON.stringify({tile,unsupported,oriented,maxDelta,reasonChanges,oldCalls,newCalls,oldScalar,newScalar}));
  results.push({tile,far,unsupported,oriented,maxDelta,reasonChanges,oldCalls,newCalls,oldScalar,newScalar});
 }
 if(!results.some(r=>r.oldCalls>r.newCalls)||!results.some(r=>r.oldScalar>r.newScalar))throw Error('negative control: expected eliminated helper calls were not eliminated');
 device.destroy();if(errors.length)throw Error(errors.join('\\n'));return {passed:true,scope:'Raw WebGPU production helper parity and invocation counts, synthetic 3-group fixtures; no frame-time claim',results};
})()`,60000);
 writeFileSync(new URL('./gpu-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {await fetch(`http://localhost:${cdp}/json/close/${c.tab.id}`).catch(()=>{});}
process.exit();
