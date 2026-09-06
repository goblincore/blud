import { writeFileSync } from 'node:fs';
import { connectGame } from '../../../scripts/lib/sdf-closeup-stage.mjs';
const vite=Number(process.env.LAB_VITE_PORT??5289),cdp=Number(process.env.LAB_CDP_PORT??9225);
const c=await connectGame({vite,cdp,onFail:m=>{throw Error(m)}});
try {
 await c.send('Page.navigate',{url:`http://localhost:${vite}/package.json`});
 const report=await c.evaluate(`(async()=>{
 const M=await import('/src/lab/sdf-zombie/webgpu/march.wgsl.ts'),N=await import('/src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.ts');
 const a=await navigator.gpu.requestAdapter(),d=await a.requestDevice();const errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const texture=d.createTexture({size:[128,M.DATA_ROWS],format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 const bytes=64*16,out=d.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=d.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const helpers=[...M.HELPERS.filter(s=>/^fn (smin|smax)\\(/.test(s)),M.APPLY_WOUNDS,...N.NORMAL_GRADIENT_HELPERS,N.NG_WOUND_LIP,N.NG_WOUNDS];
 const code=helpers.join('\\n')+\`
 @group(0) @binding(0) var data: texture_2d<f32>;
 @group(0) @binding(1) var<storage,read_write> output: array<vec4<f32>>;
 fn scalar(p:vec3<f32>)->f32{return applyWounds(p.z-0.04,p,data,vec4<f32>(2.,.015,.55,1.15),vec4<f32>(.42,1.,0.,0.),vec4<f32>(0.),vec4<f32>(0.,0.,0.,1e9)).x;}
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
 let p=vec3<f32>(f32(id.x%8u)*.028-.095,f32(id.x/8u)*.023-.071,.011);
 let ng=ngWounds(vec4<f32>(p.z-.04,0.,0.,1.),p,data,vec4<f32>(2.,.015,.55,1.15),vec4<f32>(.42,1.,0.,0.),vec4<f32>(0.),vec4<f32>(0.,0.,0.,1e9));
 let e=.00001;let fd=vec3<f32>(scalar(p+vec3<f32>(e,0.,0.))-scalar(p-vec3<f32>(e,0.,0.)),scalar(p+vec3<f32>(0.,e,0.))-scalar(p-vec3<f32>(0.,e,0.)),scalar(p+vec3<f32>(0.,0.,e))-scalar(p-vec3<f32>(0.,0.,e)))/(2.*e);
 output[id.x]=vec4<f32>(abs(ng.x-scalar(p)),select(length(ng.yzw-fd),0.,gNgReason!=0),f32(gNgReason),scalar(p));
 }\`;
 const module=d.createShaderModule({code}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\\n'));
 const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}}),bind=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:out}}]});
 const cases=[];
 for(const cap of [0,.025,.06])for(const second of [-1,0]){
 const texels=new Float32Array(128*M.DATA_ROWS*4),put=(row,i,v)=>texels.set(v,(row*128+i)*4);
 put(M.ROW_WOUND,0,[-.018,0,0,.12]);put(M.ROW_WOUND,1,[.035,.03,0,.07]);put(M.ROW_WOUND_META,0,[-1,0,.8,1]);put(M.ROW_WOUND_META,1,[second,0,.8,1]);
 for(let i=0;i<2;i++)put(M.ROW_WOUND_CAP,i,[0,0,-1,cap]);
 d.queue.writeTexture({texture},texels,{bytesPerRow:128*16},[128,M.DATA_ROWS]);const enc=d.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();enc.copyBufferToBuffer(out,0,read,0,bytes);d.queue.submit([enc.finish()]);await read.mapAsync(GPUMapMode.READ);const values=new Float32Array(read.getMappedRange().slice(0));read.unmap();
 let scalarError=0,gradientError=0,valid=0;for(let i=0;i<64;i++){scalarError=Math.max(scalarError,values[i*4]);gradientError=Math.max(gradientError,values[i*4+1]);if(values[i*4+2]===0)valid++;}
 if(second===-1)for(let i=0;i<64;i++){const p=[(i%8)*.028-.095,Math.floor(i/8)*.023-.071,.011];let expected=p[2]-.04;for(const [x,y,r] of [[-.018,0,.12],[.035,.03,.07]])expected=Math.max(expected,Math.min(r-Math.hypot(p[0]-x,p[1]-y,p[2]),(cap>0?cap:1e5)+p[2]));if(Math.abs(values[i*4+3]-expected)>1e-6)throw Error('independent hard-cut reference mismatch');}
 if(!values.every(Number.isFinite)||scalarError>1e-6||gradientError>.003||!valid)throw Error(JSON.stringify({cap,second,scalarError,gradientError,valid}));cases.push({cap,second,scalarError,gradientError,valid});
 }
 if(errors.length)throw Error(errors.join(';'));d.destroy();return {cases,errors,passed:true};})()`);
 writeFileSync(new URL('gradient-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await fetch(`http://localhost:${cdp}/json/close/${c.tab.id}`).catch(()=>{});}
process.exit();
