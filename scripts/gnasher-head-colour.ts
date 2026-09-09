// scripts/gnasher-head-colour.ts
// Front-view COLOUR render of the head cluster, to judge whether the maw reads
// as a mouth (dark opening + lips + gum + teeth) rather than teeth on a face.
// For each (x,y) pixel it walks +z -> -z and takes the frontmost solid surface,
// attributes it via `nearestPrim`, and shades by surface depth so protruding
// teeth are bright and a recessed dark cavity reads dark. Same sdBody field the
// pins use. Usage: npx tsx scripts/gnasher-head-colour.ts <out.png> [N]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody, nearestPrim } from '../src/lab/sdf-zombie/validate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const here = (...p: string[]) => resolve(__dirname, '..', ...p);
const OUT = process.argv[2] ?? '/tmp/gnasher-head.png';
const N = Number(process.argv[3] ?? 140);

const src = readFileSync(here('src/lab/sdf-zombie/characters/gnasher.blob'), 'utf8');
const doc = parseBlob(src);
const built = buildBody(compileBlob(doc, compileFace(doc)));
if (built.errors.length) { console.error('ERR', built.errors); process.exit(1); }

const c = built.clusters.find((x) => x.limb === 'head')!;
const prims = built.prims.slice(c.start, c.start + c.count);
const clusters = [{ ...c, start: 0, count: prims.length }];
const body = { prims, clusters };

let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const p of prims) if (!p.dead && p.op !== 'sub')
  for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
    mn[i] = Math.min(mn[i], e[i] - p.radius * p.scale[i]);
    mx[i] = Math.max(mx[i], e[i] + p.radius * p.scale[i]);
  }
console.log(`head bounds mn=${mn.map(v=>v.toFixed(3))} mx=${mx.map(v=>v.toFixed(3))}`);
const PAD = 0.02;
for (let i = 0; i < 3; i++) { mn[i]-=PAD; mx[i]+=PAD; }

const FLESH: [number,number,number] = [0.72, 0.42, 0.46];
const W = N, H = Math.round(N * (mx[1]-mn[1])/(mx[0]-mn[0]));
const ZLO = mn[2], ZHI = mx[2];
const STEPS = 90;
const px = Buffer.alloc(W*H*3);
for (let r = 0; r < H; r++) {
  const y = mn[1] + (H-1-r)/(H-1)*(mx[1]-mn[1]);
  for (let xc = 0; xc < W; xc++) {
    const x = mn[0] + xc/(W-1)*(mx[0]-mn[0]);
    let surfZ = null;
    for (let s = STEPS-1; s >= 0; s--) {
      const z = ZLO + s/STEPS*(ZHI-ZLO);
      if (sdBody([x,y,z], body) < 0) { surfZ = z; break; }
    }
    const i = (r*W+xc)*3;
    if (surfZ === null) { px[i]=18; px[i+1]=16; px[i+2]=18; continue; }
    const pi = nearestPrim([x,y,surfZ], body);
    const col = (pi >= 0 ? built.prims[pi]!.color : undefined) ?? FLESH;
    const dt = (surfZ - ZLO)/(ZHI-ZLO); // 0 deepest (recessed), 1 frontmost (protruding)
    const sh = 0.25 + 0.75*dt;
    px[i]   = Math.min(255, Math.floor(col[0]*255*sh));
    px[i+1] = Math.min(255, Math.floor(col[1]*255*sh));
    px[i+2] = Math.min(255, Math.floor(col[2]*255*sh));
  }
}

const CRC = (()=>{const t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c;}return t;})();
function crc(b:Buffer){let c=-1;for(const x of b)c=CRC[(c^x)&0xff]^(c>>>8);return (c^-1)>>>0;}
function chunk(t:string,d:Buffer){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t,'ascii'),d]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(b));return Buffer.concat([l,b,cr]);}
function writePng(p:string,w:number,h:number,rgb:Buffer){const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.alloc(h*(1+w*3));for(let rr=0;rr<h;rr++){raw[rr*(1+w*3)]=0;rgb.copy(raw,rr*(1+w*3)+1,rr*w*3,(rr+1)*w*3);}writeFileSync(p,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
writePng(OUT, W, H, px);
console.log(`wrote ${W}x${H} -> ${OUT}`);
