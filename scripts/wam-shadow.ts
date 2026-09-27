// scripts/wam-shadow.ts
//
// A SHADOW of WAM's geometry, for pre-flighting a kit where WAM cannot run
// (the cloud container sandboxes it as external code). Transcribed from WAM's
// own skeleton.py / mesh.py for the SUBSET the kits use: skeleton (root, bone
// with parent/at/side/offset/dir/pitch/yaw/tilt/len, mirror), `loft` (bone=
// free ray and bones=a..b chains; rings w/d/wtop../fwd/side/up/shape/tip;
// caps; frame=/refaxis=), `attach` sphere|eye|box, and `sweep` (up/down/fwd/
// back/curl bends). NOT covered: on=, around=, along/across/aim, arc=,
// opening, profile, group, web, continues=, rest=, material_arc, follow=.
//
// Checked against the compiled juggernaut-kit.gltf (2026-09-27): every ring
// vertex within 1 mm and identical per-material bounds; sweeps are
// transcribed but unchecked against a compiled kit. Emits every ring vertex
// plus in-between samples, in metres. It is a pre-flight, not the compiler:
// the owner's build and the kit's *-kit.test.ts are the truth.
import { readFileSync } from 'node:fs';
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(...a) || 1e-12; return mul(a, 1 / l); };
type M = number[][];
const mv = (m: M, v: V): V => [0, 1, 2].map(i => m[i]![0]! * v[0] + m[i]![1]! * v[1] + m[i]![2]! * v[2]) as V;
const mm = (a: M, b: M): M => [0, 1, 2].map(i => [0, 1, 2].map(j => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!));
const rad = (d: number) => d * Math.PI / 180;
const rotX = (d: number): M => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const rotY = (d: number): M => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const rotZ = (d: number): M => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
function rotAxis(axis: V, d: number): M {
  const n = Math.hypot(...axis); if (n < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = mul(axis, 1 / n); const a = rad(d), c = Math.cos(a), s = Math.sin(a), C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}
const BASE: Record<string, V> = { up: [0, 1, 0], down: [0, -1, 0], fwd: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0], in: [-1, 0, 0] };
const resolveDir = (spec: string, pitch = 0, yaw = 0, tilt = 0) => norm(mv(mm(mm(rotY(yaw), rotX(pitch)), rotZ(tilt)), BASE[spec]!));
export interface Bone { name: string; head: V; dir: V; len: number }
const tailOf = (b: Bone) => add(b.head, mul(b.dir, b.len));
const pointAt = (b: Bone, t: number) => add(b.head, mul(b.dir, b.len * t));

function kv(tokens: string[]) {
  const o: Record<string, string> = {};
  for (const t of tokens) { const i = t.indexOf('='); if (i > 0) o[t.slice(0, i)] = t.slice(i + 1); else o[t] = 'true'; }
  return o;
}
const num = (o: Record<string, string>, k: string, d = 0) => (o[k] === undefined ? d : parseFloat(o[k]!));
const vec = (s: string | undefined): V => (s ? s.replace(/[()]/g, '').split(',').map(Number) as V : [0, 0, 0]);

export interface Vert { p: V; part: string; mat: string; bone: string }
export function shadow(path: string) {
  const lines = readFileSync(path, 'utf8').split('\n').map(l => l.replace(/#.*$/, '')).filter(l => l.trim());
  let section = '', H = 1, style = 'chunky';
  const bones = new Map<string, Bone>();
  const parts: any[] = []; let inMirror = false; let cur: any = null;
  for (const raw of lines) {
    const ind = raw.length - raw.trimStart().length; const t = raw.trim().split(/\s+/);
    if (ind === 0) { section = t[0]!; inMirror = false; continue; }
    if (section === 'model') { if (t[0] === 'height') H = +t[1]!; if (t[0] === 'style') style = t[1]!; continue; }
    if (t[0] === 'mirror') { inMirror = true; continue; }
    if (t[0] === 'end') { inMirror = false; continue; }
    if (section === 'skeleton') {
      const o = kv(t.slice(2));
      const mk = (suffix: string, mir: boolean) => {
        const name = t[1]! + suffix;
        if (t[0] === 'root') { bones.set(name, { name, head: [0, parseFloat(t[3]!) * H, 0], dir: [0, 1, 0], len: num(o, 'len') * H }); return; }
        const par = bones.get(o.parent! + suffix) ?? bones.get(o.parent!)!;
        const head = pointAt(par, num(o, 'at', 1));
        const off: V = [...vec(o.offset)] as V; off[0] += num(o, 'side'); off[1] += num(o, 'up'); off[2] += num(o, 'fwd'); off[0] *= H; off[1] *= H; off[2] *= H;
        let d = resolveDir(o.dir ?? 'up', num(o, 'pitch'), num(o, 'yaw'), num(o, 'tilt'));
        if (mir) { off[0] = -off[0]; d = [-d[0], d[1], d[2]]; }
        bones.set(name, { name, head: add(head, off), dir: d, len: num(o, 'len') * H });
      };
      if (t[0] === 'root') mk('', false);
      else if (inMirror) { mk('.l', false); mk('.r', true); } else mk('', false);
      continue;
    }
    if (section === 'parts') {
      if (['loft', 'sweep', 'attach'].includes(t[0]!)) { cur = { kind: t[0], name: t[1], mirror: inMirror, o: kv(t.slice(2)), rings: [], segs: [] }; parts.push(cur); continue; }
      if (t[0] === 'ring') { cur.rings.push({ t: +t[1]!, ...kv(t.slice(2)) }); continue; }
      if (t[0] === 'seg') { cur.segs.push(kv(t.slice(1))); continue; }
      if (t[0] === 'cap') { const o = kv(t.slice(1)); cur.capStart = o.start ?? 'flat'; cur.capEnd = o.end; continue; }
    }
  }
  const SIDES = ({ chunky: 8, smooth: 12, fine: 16 } as Record<string, number>)[style]!;
  const EXP: Record<string, number> = { round: 2, squarish: 3, box: 6 };
  const FRAME: Record<string, V> = { up: [0, 1, 0], fwd: [0, 0, 1], side: [1, 0, 0] };
  const S = (x: number) => x * H; // fractions -> metres
  const frame = (tang: V, ref?: V): [V, V] => {
    const tt = norm(tang);
    if (ref) { const r = norm(ref); let other = sub(r, mul(tt, dot(r, tt))); if (Math.hypot(...other) > 1e-6) { other = norm(other); return [norm(cross(other, tt)), other]; } }
    const Z: V = [0, 0, 1], Y: V = [0, 1, 0];
    let other = Math.abs(dot(tt, Z)) < 0.75 ? sub(Z, mul(tt, dot(Z, tt))) : sub(Y, mul(tt, dot(Y, tt)));
    other = norm(other); return [norm(cross(other, tt)), other];
  };
  const superellipse = (n: number, e: number) => Array.from({ length: n }, (_, i) => { const ph = 2 * Math.PI * (i + 0.5) / n, c = Math.cos(ph), s = Math.sin(ph); return [Math.sign(c) * Math.abs(c) ** (2 / e), Math.sign(s) * Math.abs(s) ** (2 / e)]; });
  const verts: Vert[] = [];
  const mboneMap = (n: string, reflect: boolean) => (reflect && n.endsWith('.l') ? n.slice(0, -2) + '.r' : n);
  const boneRef = (n: string, suffix: string) => bones.get(n + suffix) ?? bones.get(n)!;
  for (const part of parts) {
    const variants: [string, boolean][] = part.mirror ? [['.l', false], ['.l', true]] : [['', false]];
    for (const [suffix, reflect] of variants) {
      const o = part.o; const pname = part.name + (reflect ? '.r' : suffix); const out: Vert[] = [];
      const push = (p: V, mat: string, bone: string) => out.push({ p: reflect ? [-p[0], p[1], p[2]] : p, part: pname, mat, bone: mboneMap(bone, reflect) });
      const ref = o.refaxis ? vec(o.refaxis) : o.frame && o.frame !== 'auto' ? FRAME[o.frame] : undefined;
      if (part.kind === 'loft') {
        const n = o.sides ? +o.sides : SIDES; const e0 = EXP[o.shape ?? 'round'] ?? 2;
        let pts: V[], boneAt: (t: number) => string;
        if (o.bones) {
          const [a, b] = o.bones.split('..'); const chain: Bone[] = []; let bn: Bone | undefined = boneRef(b!, suffix);
          // walk parents from b to a
          const parentOf = (x: Bone) => [...bones.values()].find(p => Math.hypot(...sub(tailOf(p), x.head)) < 1e-9 && (x.name.endsWith('.l') ? !p.name.endsWith('.r') : x.name.endsWith('.r') ? !p.name.endsWith('.l') : !p.name.match(/\.[lr]$/)));
          while (bn) { chain.unshift(bn); if (bn.name === boneRef(a!, suffix).name) break; bn = parentOf(bn); }
          let off = vec(o.offset).map(S) as V; if (reflect) off = [-off[0], off[1], off[2]];
          pts = [chain[0]!.head, ...chain.map(tailOf)].map(p => add(p, off));
          const segL = pts.slice(1).map((p, i) => Math.hypot(...sub(p, pts[i]!))); const tot = segL.reduce((x, y) => x + y, 0);
          boneAt = (t: number) => { let s = t * tot; for (let i = 0; i < segL.length; i++) { if (s <= segL[i]! || i === segL.length - 1) return chain[i]!.name; s -= segL[i]!; } return chain[0]!.name; };
        } else {
          const host = boneRef(o.bone, suffix); const origin = add(pointAt(host, num(o, 'at', 1)), vec(o.offset).map(S) as V);
          const d = resolveDir(o.dir ?? 'up', num(o, 'pitch'), num(o, 'yaw'), num(o, 'tilt'));
          pts = [origin, add(origin, mul(d, S(num(o, 'len'))))]; boneAt = () => host.name;
        }
        const segL = pts.slice(1).map((p, i) => Math.hypot(...sub(p, pts[i]!))); const tot = segL.reduce((x, y) => x + y, 0);
        const pointT = (t: number): V => { let s = Math.min(Math.max(t, 0), 1) * tot; for (let i = 0; i < segL.length; i++) { if (s <= segL[i]! || i === segL.length - 1) return add(pts[i]!, mul(sub(pts[i + 1]!, pts[i]!), s / segL[i]!)); s -= segL[i]!; } return pts[0]!; };
        const tangT = (t: number) => norm(sub(pointT(Math.min(1, t + 0.02)), pointT(Math.max(0, t - 0.02))));
        const rings = [...part.rings].sort((a: any, b: any) => a.t - b.t);
        const ringPts: V[][] = []; const centers: V[] = [];
        for (const r of rings) {
          const tt = r.t; let c = pointT(tt); const tg = tangT(tt); const [side, other] = frame(tg, ref);
          c = add(c, add(mul(other, S(num(r, 'fwd'))), mul(side, S(num(r, 'side'))))); if (r.up !== undefined) c = add(c, [0, S(+r.up), 0]);
          const e = EXP[r.shape ?? ''] ?? e0; const w = S(num(r, 'w')), d = S(num(r, 'd', num(r, 'w')));
          const wh = S(num(r, 'wtop', num(r, 'w'))) / 2, wl = S(num(r, 'wbot', num(r, 'w'))) / 2, dh = S(num(r, 'dtop', num(r, 'd', num(r, 'w')))) / 2, dl = S(num(r, 'dbot', num(r, 'd', num(r, 'w')))) / 2;
          void w; void d;
          const ring = r.tip ? [c] : superellipse(n, e).map(([cx, sy]) => add(c, add(mul(side, cx! * (sy! >= 0 ? wh : wl)), mul(other, sy! * (sy! >= 0 ? dh : dl)))));
          ringPts.push(ring); centers.push(c);
          const mat = r.material ?? o.material; for (const p of ring) push(p, mat, boneAt(tt));
          // interpolate between rings too, for dense sampling
        }
        for (let i = 0; i + 1 < ringPts.length; i++) if (ringPts[i]!.length === ringPts[i + 1]!.length) for (let k = 0; k < ringPts[i]!.length; k++) for (const f of [0.25, 0.5, 0.75]) push(add(mul(ringPts[i]![k]!, 1 - f), mul(ringPts[i + 1]![k]!, f)), o.material, boneAt(rings[i].t));
        const cap = (ri: number, style: string | undefined, sign: number) => {
          if (!style || style === 'none' || ringPts[ri]!.length < 2) return; const c = centers[ri]!; const tg = tangT(rings[ri].t);
          const rr = ringPts[ri]!.reduce((s, p) => s + Math.hypot(...sub(p, c)), 0) / ringPts[ri]!.length;
          const apex = add(c, mul(tg, sign * rr * (style === 'dome' ? 0.45 : style === 'point' ? 1 : 0))); push(apex, o.material, boneAt(rings[ri].t));
        };
        cap(0, part.capStart ?? 'flat', -1); cap(rings.length - 1, part.capEnd ?? 'flat', 1);
      } else if (part.kind === 'attach') {
        const host = boneRef(o.bone, suffix); const origin = add(pointAt(host, num(o, 'at', 0)), vec(o.offset).map(S) as V);
        const size = S(num(o, 'size', 0.05)); const kind = o.kind ?? 'sphere';
        if (kind === 'sphere' || kind === 'eye') {
          const w = o.w ? S(+o.w) : size, h = o.h ? S(+o.h) : size, d = o.d ? S(+o.d) : size; const lats = kind === 'eye' ? 3 : 4, lons = kind === 'eye' ? 6 : 8;
          push(add(origin, [0, h / 2, 0]), o.material, host.name); push(add(origin, [0, -h / 2, 0]), o.material, host.name);
          for (let li = 1; li < lats; li++) for (let lo = 0; lo < lons; lo++) { const th = Math.PI * li / lats, ph = 2 * Math.PI * lo / lons; push(add(origin, [Math.sin(th) * Math.cos(ph) * w / 2, Math.cos(th) * h / 2, Math.sin(th) * Math.sin(ph) * d / 2]), o.material, host.name); }
        } else {
          const w = o.w ? S(+o.w) : size, h = o.h ? S(+o.h) : size, d = o.d ? S(+o.d) : size, tp = num(o, 'taper', 1);
          for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { push(add(origin, [sx! * w / 2, 0, sz! * d / 2]), o.material, host.name); push(add(origin, [sx! * w / 2 * tp, -h, sz! * d / 2 * tp]), o.material, host.name); }
          // face centres
          push(add(origin, [0, -h, 0]), o.material, host.name); push(add(origin, [w / 2, -h / 2, 0]), o.material, host.name); push(add(origin, [-w / 2, -h / 2, 0]), o.material, host.name); push(add(origin, [0, -h / 2, d / 2]), o.material, host.name); push(add(origin, [0, -h / 2, -d / 2]), o.material, host.name);
        }
      } else if (part.kind === 'sweep') {
        const host = boneRef(o.bone, suffix); let pos = add(pointAt(host, num(o, 'at', 1)), vec(o.offset).map(S) as V);
        let tang = resolveDir(o.dir ?? 'up', num(o, 'pitch'), num(o, 'yaw'), num(o, 'tilt'));
        let [side, other] = frame(tang, ref); const n = Math.max(6, (o.sides ? +o.sides : SIDES) - 2);
        const ringAt = (c: V, r: number) => { for (const [cx, sy] of superellipse(n, 2)) push(add(c, add(mul(side, cx! * r), mul(other, sy! * r))), o.material, host.name); };
        const segs = part.segs; ringAt(pos, S(+segs[0].r));
        const Y: V = [0, 1, 0], Z: V = [0, 0, 1];
        for (const sg of segs) {
          let R: M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
          const rise = num(sg, 'up') - num(sg, 'down'), ahead = num(sg, 'fwd') - num(sg, 'back');
          if (rise) R = mm(rotAxis(cross(tang, Y), rise), R);
          if (ahead) R = mm(rotAxis(cross(tang, Z), ahead), R);
          if (sg.curl) R = mm(rotAxis(side, +sg.curl), R);
          tang = mv(R, tang); side = mv(R, side); other = mv(R, other);
          const prev = pos; pos = add(pos, mul(tang, S(+sg.len)));
          for (const f of [0.33, 0.66]) ringAt(add(mul(prev, 1 - f), mul(pos, f)), S(+sg.r));
          if (sg.tip) push(pos, o.material, host.name); else ringAt(pos, S(+sg.r));
        }
      }
      verts.push(...out);
    }
  }
  return { verts, bones, H };
}
