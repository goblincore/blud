// CPU-only A/B of the real goo sync: a sharp pool partition followed by the
// selected airborne partition, as the shutter capture does each frame.
import { writeFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createGooLayer } from '../src/lab/sdf-zombie/webgpu/goo-layer';
import { SHUTTER_SHARP_SELECTION, SHUTTER_SELECTED_SELECTION } from '../src/lab/sdf-zombie/webgpu/shutter-game-layer';
import type { BloodSim, Droplet } from '../src/lab/sdf-zombie/blood-sim';

const camera = new THREE.PerspectiveCamera(65, 4/3, .1, 200);
camera.position.set(1, 1.6, 2); camera.lookAt(0, 1, -3); camera.updateMatrixWorld();
const rig = {
  lightDir: uniform(new THREE.Vector3(0, 1, 0)),
  keyColor: uniform(new THREE.Vector3(1, 1, 1)),
  lightCfg: uniform(new THREE.Vector4(1, 1, 1, 1)),
};
const layers = [false,true].map(optimized => {
  const layer = createGooLayer({} as THREE.WebGPURenderer, rig);
  layer.setUploadOptimization(optimized); layer.setSize(400,300);
  return layer;
});
const rows = [];
for (const [name,drops,pools] of [['empty',0,0],['spray',48,32],['blast',431,256]] as const) {
  const sim = {
    droplets: Array.from({length:drops},(_,i): Droplet => ({
      pos:[Math.sin(i)*2,1+i*.001,-3],vel:[i*.01,2,-1],size:.2,age:.1,life:2,kind:'drop',
    } as Droplet)),
    splats: Array.from({length:pools},(_,i)=>({pos:[Math.sin(i)*2,0,-3],size:.2,yaw:i*.1})),
  } as unknown as BloodSim;
  const sync = (index:number) => {
    const l=layers[index]!;
    l.setSelection(SHUTTER_SHARP_SELECTION); l.sync(sim,camera);
    l.setSelection(SHUTTER_SELECTED_SELECTION); l.sync(sim,camera);
  };
  for(let i=0;i<1000;i++){ sync(0); sync(1); }
  for(let rep=0;rep<15;rep++) for(const index of rep%2?[1,0]:[0,1]) {
    const start=performance.now();
    for(let i=0;i<1000;i++) sync(index);
    rows.push({name,rep,optimized:!!index,ms:(performance.now()-start)/1000,drops,pools});
  }
}
for (const name of ['empty','spray','blast']) {
  const median=(on:boolean)=>{
    const a=rows.filter(r=>r.name===name && r.optimized===on).map(r=>r.ms).sort((a,b)=>a-b);
    return a[Math.floor(a.length/2)];
  };
  console.log(name,JSON.stringify({reference:median(false),candidate:median(true)}));
}
if(process.env.GOO_OUT)writeFileSync(process.env.GOO_OUT,JSON.stringify({note:'CPU sync only, excludes GPU submission',rows},null,2));
for(const l of layers)l.dispose();
