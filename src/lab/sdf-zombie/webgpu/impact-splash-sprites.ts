import * as THREE from 'three/webgpu';
import { attribute, mix, texture, uv, vec2, vec4, vec3, normalMap, normalize, cameraViewMatrix, positionView, dot, max, pow, float } from 'three/tsl';
import type { ImpactSplashEvent, ImpactSplashLightRig } from './impact-splash';
import { basisFromAxis } from '../vec';

const VARIANTS = 32;
const SHAPES = 16;
const W = 96, H = 192;
const PER_EVENT = 32, CAPACITY = PER_EVENT * 8;
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), a = smooth(x-ix), b = smooth(y-iy);
  const n = (dx: number, dy: number) => hash((ix+dx)*17 + (iy+dy)*73 + seed);
  return (n(0,0)*(1-a)+n(1,0)*a)*(1-b)+(n(0,1)*(1-a)+n(1,1)*a)*b;
}

/** Original masks: branching curved liquid paths, broad connecting lobes,
 * coherent multiscale erosion, and holes. Generated once, never randomised
 * between frames. Transparent gutters prevent adjacent atlas tiles bleeding. */
function makeAtlas(): THREE.DataTexture {
  const data = new Uint8Array(W * VARIANTS * H * 4);
  for (let v=0; v<VARIANTS; v++) {
    const paths = Array.from({length: 9}, (_,k) => ({
      end: (hash(v*71+k*7)-0.5)*1.7,
      height: 0.42+hash(v*91+k*11)*0.56,
      width: 0.045+hash(v*31+k*19)*0.10,
      bend: (hash(v*59+k*13)-0.5)*0.5,
    }));
    for (let j=0; j<H; j++) for (let i=0; i<W; i++) {
      const x=(i/(W-1)-0.5)*2, y=j/(H-1);
      let field=0;
      for (const path of paths) {
        const t=y/path.height;
        if (t>1.08) continue;
        const center=path.end*t + path.bend*Math.sin(t*Math.PI);
        const radius=path.width*(0.35+0.65*(1-t)) + 0.04*Math.exp(-Math.pow((t-0.86)/0.13,2));
        const density=Math.exp(-Math.pow((x-center)/Math.max(0.015,radius),2))
          * (1-smooth((t-0.94)/0.13));
        field=Math.max(field,density);
      }
      if (v >= SHAPES) {
        // Head-on splats: separated rounded lobes and torn bridges, rather
        // than a fan of long fingers all rooted on the same straight edge.
        field = 0;
        const yy = (y - 0.5) * 2;
        for (let l=0; l<7; l++) {
          const a=hash(v*19+l*41)*Math.PI*2;
          const r=0.12+hash(v*31+l*13)*0.48;
          const rx=0.10+hash(v*17+l*53)*0.21;
          const ry=0.10+hash(v*29+l*7)*0.24;
          field=Math.max(field, Math.exp(-Math.pow((x-Math.cos(a)*r)/rx,2)-Math.pow((yy-Math.sin(a)*r)/ry,2)));
        }
      }
      const coarse=noise(x*5+9,y*8,v*83);
      const fine=noise(x*19+4,y*31,v*23);
      field += (coarse-0.5)*0.65+(fine-0.5)*0.20;
      // Holes and notches divide the broad root into irregular islands.
      field -= smooth((noise(x*9,y*13,v*53+17)-0.57)/0.25)*0.75;
      let alpha=smooth((field-0.28)/0.17);
      alpha*=smooth(y/0.045)*smooth((1-y)/0.045)*smooth((1-Math.abs(x))/0.06);
      const o=(j*W*VARIANTS+v*W+i)*4;
      const thickness=0.65+coarse*0.35;
      data[o]=Math.round((105+hash(v*43)*85)*thickness); data[o+1]=3; data[o+2]=8;
      data[o+3]=Math.round(alpha*255);
    }
  }
  const atlas=new THREE.DataTexture(data,W*VARIANTS,H);
  atlas.magFilter=THREE.LinearFilter; atlas.minFilter=THREE.LinearFilter;
  atlas.colorSpace=THREE.SRGBColorSpace;
  atlas.generateMipmaps=false; atlas.needsUpdate=true;
  return atlas;
}

function makeNormalAtlas(atlas: THREE.DataTexture): THREE.DataTexture {
  const source = atlas.image.data as Uint8Array;
  const data = new Uint8Array(source.length);
  const width = W * VARIANTS;
  for(let y=0;y<H;y++) for(let x=0;x<width;x++) {
    const tile = Math.floor(x/W)*W;
    const height = (dx:number,dy:number) => {
      const xx=Math.max(tile,Math.min(tile+W-1,x+dx));
      const yy=Math.max(0,Math.min(H-1,y+dy));
      const i=(yy*width+xx)*4;
      return source[i+3]!/255 * (0.65+source[i]!/255*0.35);
    };
    // Broad slopes across the alpha boundary form rounded liquid ridges.
    const nx=(height(-2,0)-height(2,0))*1.2;
    const ny=(height(0,-2)-height(0,2))*1.2;
    const len=Math.hypot(nx,ny,1), i=(y*width+x)*4;
    data[i]=Math.round((nx/len*.5+.5)*255);
    data[i+1]=Math.round((ny/len*.5+.5)*255);
    data[i+2]=Math.round((1/len*.5+.5)*255);data[i+3]=255;
  }
  const result=new THREE.DataTexture(data,width,H);
  result.minFilter=THREE.LinearFilter;result.magFilter=THREE.LinearFilter;
  result.needsUpdate=true;
  return result;
}

export function createImpactSplashSprites(rig: ImpactSplashLightRig) {
  const atlas=makeAtlas();
  const normals=makeNormalAtlas(atlas);
  const geometry=new THREE.PlaneGeometry(1,1);
  const variant=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY),1);
  const opacity=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY),1);
  const front=new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY),1);
  geometry.setAttribute('splashFront',front);
  geometry.setAttribute('splashVariant',variant);
  geometry.setAttribute('splashOpacity',opacity);
  const atlasUv=vec2(uv().x.add(attribute('splashVariant','float')).div(VARIANTS),uv().y);
  const frontUv=atlasUv.add(vec2(SHAPES/VARIANTS,0));
  const blend=float(attribute('splashFront','float') as never);
  const sample=mix(texture(atlas,atlasUv),texture(atlas,frontUv),blend);
  const N=vec3(normalMap(mix(texture(normals,atlasUv),texture(normals,frontUv),blend),vec2(1.2)) as never);
  const L=normalize(cameraViewMatrix.mul(vec4(rig.lightDir as never,0)).xyz);
  const V=normalize(positionView.negate());
  const H=normalize(L.add(V));
  const diffuse=max(dot(N,L),0);
  const sheen=pow(max(dot(N,H),0),float(65)).mul(0.32);
  const fresnel=pow(float(1).sub(max(dot(N,V),0)),float(4)).mul(0.045);
  const material=new THREE.MeshBasicNodeMaterial();
  material.colorNode=vec4(sample.rgb.mul(diffuse.mul(0.65).add(0.40))
    .add(vec3(rig.keyColor as never).mul(sheen.add(fresnel))),1) as never;
  material.opacityNode=sample.a.mul(attribute('splashOpacity','float')) as never;
  material.transparent=true; material.depthWrite=false; material.depthTest=true;
  material.side=THREE.DoubleSide; material.forceSinglePass=true;
  const mesh=new THREE.InstancedMesh(geometry,material,CAPACITY);
  mesh.frustumCulled=false; mesh.count=0; mesh.renderOrder=2;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m=new THREE.Matrix4(), q=new THREE.Quaternion(), roll=new THREE.Quaternion();
  const scale=new THREE.Vector3(), pos=new THREE.Vector3(), delta=new THREE.Vector3();
  const axis=new THREE.Vector3(0,0,1);
  const cards: {p:THREE.Vector3;velocity:THREE.Vector3;age:number;seed:number;small:boolean;scale:number;opacity:number;duration:number;angle:number;explosion:boolean;z:number}[]=[];
  return {
    object:mesh,
    sync(events: readonly ImpactSplashEvent[], camera:THREE.Camera) {
      cards.length=0;
      for (const ev of events) {
        const basis=basisFromAxis(ev.direction);
        const explosion=ev.profile?.style === 'explosion';
        const count=ev.profile?.count ?? PER_EVENT;
        const variedCount=explosion ? count : Math.max(0,Math.ceil(count*(0.7+hash(ev.seed+377)*0.3)));
        for(let k=0;k<variedCount;k++) {
          const seed=ev.seed+k*83, h=(n:number)=>hash(seed+n*31);
          const age=ev.time-h(1)*0.10;
          if(age<=0 || age>=(ev.profile?.duration ?? 0.9)) continue;
          // Event-wide pressure/scale variation keeps the whole burst coherent,
          // while particle-level variation avoids repeated silhouettes.
          const pressure=0.75+hash(ev.seed+911)*0.50;
          const phi=explosion ? h(2)*Math.PI*2 : hash(ev.seed+57)*Math.PI*2+(h(2)-0.5)*2.4, cone=(explosion ? 0.20 : 0.04)+h(3)*(ev.profile?.spread ?? 1.1), speed=(0.6+h(4)*1.5)*pressure*(ev.profile?.speed ?? 1);
          if(k>23+Math.floor(hash(ev.seed+377)*9)) continue;
          const local=[Math.cos(phi)*Math.sin(cone),Math.sin(phi)*Math.sin(cone),Math.cos(cone)];
          const velocity=new THREE.Vector3(
            basis.u[0]*local[0]!+basis.v[0]*local[1]!+basis.w[0]*local[2]!,
            basis.u[1]*local[0]!+basis.v[1]*local[1]!+basis.w[1]*local[2]!,
            basis.u[2]*local[0]!+basis.v[2]*local[1]!+basis.w[2]*local[2]!).multiplyScalar(speed);
          const travel=(1-Math.exp(-age*2.8))/2.8;
          const p=new THREE.Vector3(...ev.origin).addScaledVector(velocity,travel);
          p.y-=0.6*age*age;
          cards.push({p,velocity,age,seed,small:explosion ? k>=18 : h(24)<0.3,scale:ev.profile?.scale ?? 1,opacity:ev.profile?.opacity ?? 1,duration:ev.profile?.duration ?? .9,angle:hash(seed+57)*Math.PI*2,explosion,z:p.clone().applyMatrix4(camera.matrixWorldInverse).z});
        }
      }
      cards.sort((a,b)=>a.z-b.z);
      let n=0;
      for(const card of cards) {
        if(n>=CAPACITY) break;
        const h=(x:number)=>hash(card.seed+x*31);
        const growth=smooth(card.age/(card.explosion ? 0.14 : 0.07));
        const fade=card.explosion ? 1-smooth((card.age-0.28)/0.55) : 1-smooth((card.age/card.duration-0.25)/0.75);
        const length=(card.small?0.10:0.28)*(0.55+h(5)*1.15)*growth*card.scale;
        delta.copy(card.velocity).transformDirection(camera.matrixWorldInverse);
        const facing=card.explosion ? 0 : smooth((Math.abs(delta.z)-0.45)/0.45);
        const sideAngle=Math.atan2(-delta.x,delta.y);
        const angle=sideAngle+Math.atan2(Math.sin(card.angle-sideAngle),Math.cos(card.angle-sideAngle))*facing+(h(6)-0.5)*0.7+card.age*(h(7)-0.5);
        roll.setFromAxisAngle(axis,angle); q.copy(camera.quaternion).multiply(roll);
        pos.copy(card.p);
        const width=card.explosion ? 0.50+h(8)*0.45 : (0.28+h(8)*0.25)*(1-facing)+(0.7+h(8)*0.6)*facing;
        const foreshorten=1-facing*0.48;
        scale.set(length*width*foreshorten,length*foreshorten,1);
        m.compose(pos,q,scale); mesh.setMatrixAt(n,m);
        variant.setX(n,Math.floor(h(9)*SHAPES));
        front.setX(n,facing);
        opacity.setX(n,(card.small?0.40:0.60+h(10)*0.30)*fade*card.opacity);
        n++;
      }
      mesh.count=n; mesh.instanceMatrix.needsUpdate=true;
      variant.needsUpdate=true; opacity.needsUpdate=true; front.needsUpdate=true;
    },
    dispose(){geometry.dispose();material.dispose();atlas.dispose();normals.dispose();mesh.dispose();}
  };
}
