import { PRESETS } from './presets';
const vec = (values: readonly number[]) => `vec3<f32>(${values.map(v => Number.isInteger(v) ? `${v}.0` : v).join(',')})`;
/** Standalone comparison shader, never included in the game material. */
export const PROBE_WGSL = /* wgsl */ `
struct Config { view: vec4<f32>, state: vec4<f32>, atlas: vec4<f32> }
@group(0) @binding(0) var<uniform> cfg: Config;
@group(0) @binding(1) var atlas: texture_3d<f32>;
struct Sample { value: f32, gradient: vec3<f32>, lip: f32 }
fn sphere(p:vec3<f32>,c:vec3<f32>,r:f32)->Sample {
 let q=p-c; let l=length(q);
 return Sample(l-r,q/max(l,1e-9),1.0);
}
fn analytic(p:vec3<f32>,id:i32)->Sample {
 let radii=array<vec2<f32>,3>(${PRESETS.map(c => `vec2<f32>(${c.map(x => x.radius.toFixed(6)).join(',')})`).join(',')});
 let a=sphere(p,${vec(PRESETS[0]![0]!.center)},radii[id].x);
 if(id==1){return a;}
 let b=sphere(p,${vec(PRESETS[0]![1]!.center)},radii[id].y);
 if(b.value<a.value){return b;}return a;
}
fn cached(p:vec3<f32>,id:i32)->Sample {
 if(id==0){return analytic(p,0);}
 let n=i32(cfg.atlas.x);let pitch=cfg.atlas.y;let extent=cfg.atlas.z;
 let q=clamp(p,vec3<f32>(-extent),vec3<f32>(extent));
 let f=(q+vec3<f32>(extent))/pitch;
 let lo=min(vec3<i32>(floor(f)),vec3<i32>(n-2));let t=f-vec3<f32>(lo);
 var value=0.0;var gradient=vec3<f32>(0.0);
 // Value and gradient share exactly eight texture loads.
 for(var z=0;z<2;z++) {for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let bits=vec3<i32>(x,y,z);let w=select(vec3<f32>(1.0)-t,t,bits==vec3<i32>(1));
  let sign=vec3<f32>(bits)*2.0-vec3<f32>(1.0);
  let c=textureLoad(atlas,lo+bits+vec3<i32>(0,0,(id-1)*n),0).x;
  value=value+c*w.x*w.y*w.z;
  gradient=gradient+c*sign*vec3<f32>(w.y*w.z,w.x*w.z,w.x*w.y)/pitch;
 }}}
 let outside=p-q;let dist=length(outside);let lip=cfg.atlas.w;
 if(dist>0.0){value=value+dist;gradient=select(gradient,outside/max(dist,1e-9),outside!=vec3<f32>(0.0));}
 return Sample(value,gradient,lip);
}
fn endpoint(p:vec3<f32>,id:i32,mode:i32)->Sample {
 if(mode==1){return cached(p,id);}return analytic(p,id);
}
fn field(p:vec3<f32>,mode:i32)->Sample {
 let axes=vec3<f32>(.28,.48,.22);let q=p/axes;let l=length(q);
 let body=Sample((l-1.0)*.22,.22*p/(axes*axes*max(l,1e-9)),1.0);
 if(cfg.state.x==0.0 && cfg.state.y==0.0){return body;}
 let local=p-vec3<f32>(0.0,.12,.205);
 var damage=endpoint(local,i32(cfg.state.y),mode);
 if(cfg.state.z<1.0 && cfg.state.x!=cfg.state.y){
  let a=endpoint(local,i32(cfg.state.x),mode);
  damage=Sample(mix(a.value,damage.value,cfg.state.z),mix(a.gradient,damage.gradient,cfg.state.z),max(a.lip,damage.lip));
 }
 // The max field inherits the larger derivative bound from either input,
 // regardless of which value currently wins.
 let bound=max(body.lip,damage.lip);
 if(-damage.value>body.value){return Sample(-damage.value,-damage.gradient,bound);}
 return Sample(body.value,body.gradient,bound);
}
@vertex fn vs(@builtin(vertex_index) id:u32)->@builtin(position) vec4<f32>{
 let p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
 return vec4<f32>(p[id],0.0,1.0);
}
@fragment fn fs(@builtin(position) pixel:vec4<f32>)->@location(0) vec4<f32>{
 let halfWidth=cfg.view.x*.5;let mode=select(0,1,pixel.x>=halfWidth);
 let x=(pixel.x-f32(mode)*halfWidth)/halfWidth*2.0-1.0;
 let y=1.0-pixel.y/cfg.view.y*2.0;
 let yaw=cfg.view.z;let ro=vec3<f32>(sin(yaw)*1.6,0.0,cos(yaw)*1.6);
 let forward=normalize(-ro);let right=vec3<f32>(cos(yaw),0.0,-sin(yaw));
 let rd=normalize(forward+right*x*.42*halfWidth/cfg.view.y+vec3<f32>(0.0,y*.42,0.0));
 // The intact torso is an exact conservative envelope of every carved state.
 let axes=vec3<f32>(.28,.48,.22);let o=ro/axes;let dir=rd/axes;
 let aa=dot(dir,dir);let bb=dot(o,dir);let cc=dot(o,o)-1.0;let disc=bb*bb-aa*cc;
 if(disc<0.0){if(cfg.view.w>.5){return vec4<f32>(0.0,0.0,0.0,1.0);}return vec4<f32>(.025,.032,.045,1.0);}
 let enter=(-bb-sqrt(disc))/aa;let exit=(-bb+sqrt(disc))/aa;
 var t=max(0.0,enter);var hit=false;var steps=0;var result=Sample(1.0,vec3<f32>(0.0),1.0);
 for(var i=0;i<160;i++){
  if(i>=i32(cfg.state.w)||t>exit){break;}
  steps=steps+1;result=field(ro+rd*t,mode);
  if(result.value<.0008){hit=true;break;}
  t=t+result.value/max(1.0,result.lip);
 }
 let p=ro+rd*t;let torso=(length(p/vec3<f32>(.28,.48,.22))-1.0)*.22;
 let cavity=hit && torso<-.004;
 if(cfg.view.w>.5){return vec4<f32>(f32(steps)/255.0,select(0.0,1.0,cavity),select(0.0,1.0,hit),1.0);}
 if(!hit){return vec4<f32>(.025,.032,.045,1.0);}
 let n=result.gradient/max(length(result.gradient),1e-9);
 let light=max(dot(n,normalize(vec3<f32>(-.5,.8,1.0))),0.0);
 let albedo=select(vec3<f32>(.59,.37,.32),vec3<f32>(.33,.047,.039),cavity);
 let color=albedo*(.25+.75*light);
 return vec4<f32>(pow(color,vec3<f32>(1.0/2.2)),1.0);
}`;
