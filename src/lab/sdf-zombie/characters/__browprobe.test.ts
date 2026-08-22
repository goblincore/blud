import { it } from 'vitest';
import blobSrc from './mouse.blob?raw';
import kitJson from '../../../../public/assets/lab/mouse-kit.gltf?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
it('brow depths', () => {
  const body = buildBody(compileBlob(parseBlob(blobSrc)));
  const g = JSON.parse(kitJson as unknown as string);
  const bytes = Uint8Array.from(atob(g.buffers[0].uri.split(',',2)[1]), c=>c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const off = (i:number)=>{const a=g.accessors[i];const bv=g.bufferViews[a.bufferView];return (bv.byteOffset??0)+(a.byteOffset??0);};
  const readV=(i:number)=>{const a=g.accessors[i],b=off(i),o:any[]=[];for(let k=0;k<a.count;k++)o.push([view.getFloat32(b+k*12,true),view.getFloat32(b+k*12+4,true),view.getFloat32(b+k*12+8,true)]);return o;};
  const readI=(i:number)=>{const a=g.accessors[i],b=off(i),o:number[]=[];const s=a.componentType===5121?1:a.componentType===5123?2:4;for(let k=0;k<a.count;k++)o.push(s===1?view.getUint8(b+k):s===2?view.getUint16(b+k*2,true):view.getUint32(b+k*4,true));return o;};
  for (const prim of g.meshes[0].primitives) {
    const name = g.materials[prim.material].name;
    if (name !== 'black' && name !== 'shorts') continue;
    const pos = readV(prim.attributes.POSITION);
    const idx = [...new Set(readI(prim.indices))];
    const vs = idx.map(i=>pos[i]);
    const inside = vs.filter(v=>sdBody(v,body)<0).length;
    console.log(name, 'verts', vs.length, 'inside', inside);
    if (name==='black') {
      const brows = vs.filter(v=>v[1]>0.85);
      const shades = vs.filter(v=>v[1]<=0.85);
      console.log(' brow verts', brows.length, 'inside', brows.filter(v=>sdBody(v,body)<0).length,
        'z range', Math.min(...brows.map(v=>v[2])).toFixed(3), Math.max(...brows.map(v=>v[2])).toFixed(3),
        'y range', Math.min(...brows.map(v=>v[1])).toFixed(3), Math.max(...brows.map(v=>v[1])).toFixed(3));
      console.log(' shades verts', shades.length, 'inside', shades.filter(v=>sdBody(v,body)<0).length);
    }
    if (name==='shorts') {
      const back = vs.filter(v=>v[2]<-0.03);
      console.log(' shorts back verts', back.length, 'proud', back.filter(v=>sdBody(v,body)>0).length);
    }
  }
});
