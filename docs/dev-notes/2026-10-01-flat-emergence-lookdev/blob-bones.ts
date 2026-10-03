// Dump a .blob's compiled skeleton (game frame: x, y up, +z forward) as world heads and unit dirs, rest and posed.
// usage: tsx blob-bones.ts <file.blob> <out.json> ["bone=key=value" overrides...]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBlob } from '../../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../../src/lab/sdf-zombie/blob-compile';
const [file, out, ...over] = process.argv.slice(2);
function skeleton(src: string) {
  const doc = parseBlob(src);
  const c = compileBlob(doc, compileFace(doc)) as any;
  const heads: Record<string, number[]> = {}, dirs: Record<string, number[]> = {};
  const byName: Record<string, any> = {}; for (const b of c.bones) byName[b.name] = b;
  const root = c.root;   // { name, at }
  const place = (name: string, side: number, sx: number): number[] => {
    const key = name + (sx > 0 ? '.l' : sx < 0 ? '.r' : '');
    if (heads[key]) return heads[key]!;
    const b = byName[name];
    let h: number[];
    if (!b.parent) h = [0, typeof root?.at === 'number' ? root.at : 0.6, 0];
    else {
      const pb = byName[b.parent]; const pside = pb.mirror ? sx : 0;
      const ph = place(b.parent, pside, sx); const pd = dir(b.parent, sx);
      h = [ph[0]! + pd[0]! * pb.length, ph[1]! + pd[1]! * pb.length, ph[2]! + pd[2]! * pb.length];
      if (b.side) h[0] = h[0]! + (b.side as number) * (sx || 1);
    }
    heads[key] = h; dirs[key] = dir(name, sx); return h;
  };
  const dir = (name: string, sx: number) => { const d = byName[name].dir as number[]; return byName[name].mirror && sx < 0 ? [-d[0]!, d[1]!, d[2]!] : [...d]; };
  for (const b of c.bones) { if (b.mirror) { place(b.name, 1, 1); place(b.name, -1, -1); } else place(b.name, 0, 0); }
  return { heads, dirs, lengths: Object.fromEntries(c.bones.map((b: any) => [b.name, b.length])), root };
}
let src = readFileSync(file!, 'utf8');
const rest = skeleton(src);
for (const o of over) {
  const [bone, key, val] = o.split('=');
  const re = new RegExp('(\\n\\s*bone ' + bone + '\\s[^\\n]*)');
  src = src.replace(re, (line: string) => { const kv = new RegExp('\\b' + key + '=\\S+'); return kv.test(line) ? line.replace(kv, key + '=' + val) : line + ' ' + key + '=' + val; });
}
const posed = skeleton(src);
writeFileSync(out!, JSON.stringify({ rest, posed }, null, 1));
console.log('BONES', out, Object.keys(rest.heads).length, JSON.stringify(rest.root));
