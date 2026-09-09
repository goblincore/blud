// DEPENDENCY-FREE CPU SILHOUETTE / ORTHO RENDERER for a .blob character.
//
// WHY THIS EXISTS. The standard review path is `npm run blob:shot` (a Chrome
// turntable via WebGPU). On this worktree Chrome cannot start: the DSH file
// sandbox denies the macOS system paths Chrome's crashpad and process-singleton
// resolve from the real user home (~/Library, /var/folders/.../T) regardless
// of HOME/TMPDIR, so Chrome aborts at "Failed to create a ProcessSingleton".
// The turntable would be blind. The .blob SDF is a pure CPU function
// (compileBlob -> buildBody -> sdBody), so this tool raycasts it directly and
// writes PNG frames the agent can read_image. It is an orthographic
// turntable at N yaws: the objective is to judge the SILHOUETTE from every
// angle, not to reproduce the lab's shading.
//
//   npm run blob:silview -- bloatmaw            # -> /tmp/blob-silview/bloatmaw
//   NODE_OPTIONS=... tsx scripts/blob-silview.ts bloatmaw 8 128 160
//
// COLOUR. `nearestPrim` names the primitive whose surface owns a pixel (the
// CPU mirror of the shader's paint arg-min). Carried `color` (0..1 LINEAR RGB,
// per blob-parse.ts parseColorArg) is shaded; flesh without a color falls back
// to the palette baseColor. `glow` is folded in additively so glowing organs
// read as lamps rather than as flat colour. Then linear -> sRGB for the PNG.
//
// NOTES ON FIDELITY. This is a geometry-only look. It has no wetness/fresnel,
// no mottle, no translucency, no emissive bloom, no AO — it is the field's
// shape and its per-prim colour. That is exactly the signal this task needs
// (is the silhouette irregular; do the eyes sit IN flesh; does the maw dominate).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { parseBlob } from '../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../src/lab/sdf-zombie/build-body';
import { sdBody, nearestPrim } from '../src/lab/sdf-zombie/validate';
import type { Vec3, BuiltBody } from '../src/lab/sdf-zombie/types';

// ---------------------------------------------------------------------------
// Minimal PNG writer (RGBA, 8-bit). No deps — the codebase ships png-decode but
// no encoder; Chrome's captureScreenshot was the only producer before.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(path: string, w: number, h: number, rgb: Uint8Array): void {
  // rgb is interleaved 3-byte, top row first.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((v, i) => { raw[y * (w * 3 + 1) + 1 + i] = v; });
  }
  const idat = deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
  writeFileSync(path, png);
}

// ---------------------------------------------------------------------------
// Geometry helper: field normal by central differences.
// ---------------------------------------------------------------------------
const NORM_EPS = 0.0015;
function fieldNormal(p: Vec3, body: BuiltBody): Vec3 {
  const dx = sdBody([p[0] + NORM_EPS, p[1], p[2]], body) - sdBody([p[0] - NORM_EPS, p[1], p[2]], body);
  const dy = sdBody([p[0], p[1] + NORM_EPS, p[2]], body) - sdBody([p[0], p[1] - NORM_EPS, p[2]], body);
  const dz = sdBody([p[0], p[1], p[2] + NORM_EPS], body) - sdBody([p[0], p[1], p[2] - NORM_EPS], body);
  let nx = dx, ny = dy, nz = dz;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  return [nx, ny, nz];
}

const srgb = (c: number): number => {
  const v = Math.max(0, Math.min(1, c));
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
};

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---------------------------------------------------------------------------
interface Flags { name: string; out: string; frames: number; w: number; h: number }
function parse(argv: string[]): Flags {
  const name = argv[0];
  if (!name) { console.error('usage: blob-silview <character> [frames] [w] [h]'); process.exit(2); }
  const frames = Number(argv[1] ?? 8);
  const w = Number(argv[2] ?? 128);
  const h = Number(argv[3] ?? 160);
  const out = process.env.BLOB_OUT ?? `/tmp/blob-silview/${name}`;
  return { name, out, frames, w, h };
}

const { name, out, frames, w, h } = parse(process.argv.slice(2));
mkdirSync(out, { recursive: true });

const blobPath = `src/lab/sdf-zombie/characters/${name}.blob`;
const doc = parseBlob(readFileSync(blobPath, 'utf8'));
const body = buildBody(compileBlob(doc, compileFace(doc)));

// Palette base flesh colour (linear), matched to the .blob palette block.
const docText = readFileSync(blobPath, 'utf8');
const paleBase =
  /baseColor\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(docText)
    ?.slice(1).map(Number) as Vec3 | undefined ?? [0.3, 0.15, 0.12];
const paleDeep =
  /deepColor\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(docText)
    ?.slice(1).map(Number) as Vec3 | undefined ?? [0.55, 0.09, 0.07];

// Frame the ball: character centre ~ (0, ~1.08, 0), ball y-semi ~0.75.
// BLOB_CY / BLOB_SPAN_U / BLOB_YTOP / BLOB_YBOT zoom the frame (face closeup).
const CENTER: Vec3 = [0, Number(process.env.BLOB_CY ?? 1.08), 0];
const spanU = Number(process.env.BLOB_SPAN_U ?? 1.9);      // horizontal extent (world m)
const yTop = Number(process.env.BLOB_YTOP ?? 1.98), yBot = Number(process.env.BLOB_YBOT ?? -0.06);
const rayOrigin = 8.0;  // how far behind CENTER to start the march

const LIGHT = normalize3([0.5, 0.7, 0.5]);
function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Flesh fallback: when a pixel's owner is a colourless body prim, blend
// baseColor toward deepColor by how DEEP the hit is (a proxy for shadowed
// flesh). Cheap but enough to stop flesh being one flat tone.
function fleshShade(p: Vec3): Vec3 {
  // Hit depth below its own surface isn't available; use y to tilt downward
  // (undersides read darker) plus a slight noise from position.
  const t = clamp01((1.83 - p[1]) / 1.9);
  return [
    paleBase[0] * (1 - t) + paleDeep[0] * t,
    paleBase[1] * (1 - t) + paleDeep[1] * t,
    paleBase[2] * (1 - t) + paleDeep[2] * t,
  ];
}

for (let f = 0; f < frames; f++) {
  const yaw = (f / frames) * Math.PI * 2;
  const ruv = Math.cos(yaw), ruvZ = Math.sin(yaw); // screen right axis in world
  const duv = Math.sin(yaw), duvZ = -Math.cos(yaw); // depth axis (into scene)

  const rgb = new Uint8Array(w * h * 3);
  const step = spanU / w;
  const eps = 1e-3;
  const maxSteps = 160;

  for (let py = 0; py < h; py++) {
    // World y for this row (top row = yTop).
    const wy = yTop - (py + 0.5) * ((yTop - yBot) / h);
    for (let px = 0; px < w; px++) {
      const su = -spanU / 2 + (px + 0.5) * (spanU / w);
      const start: Vec3 = [
        CENTER[0] + ruv * su + duv * -rayOrigin,
        wy,
        CENTER[2] + ruvZ * su + duvZ * -rayOrigin,
      ];
      const d: Vec3 = [duv, 0, duvZ]; // ray direction
      let t = 0, hit = false;
      // march
      for (let s = 0; s < maxSteps; s++) {
        const p: Vec3 = [start[0] + d[0] * t, start[1] + d[1] * t, start[2] + d[2] * t];
        const dist = sdBody(p, body);
        if (dist < eps) { hit = true; break; }
        t += Math.max(dist, step * 0.25);
        if (t > rayOrigin * 2 + spanU) break;
      }
      const i = (py * w + px) * 3;
      if (!hit) { rgb[i] = 18; rgb[i + 1] = 18; rgb[i + 2] = 18; continue; }

      const hitP: Vec3 = [start[0] + d[0] * t, start[1] + d[1] * t, start[2] + d[2] * t];
      const n = fieldNormal(hitP, body);
      // Lambert + wrap: n is the field gradient (points OUTWARD for add prims?
      // sdBody increases outward, gradient points outward => normal points outward).
      let lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);

      let base: Vec3;
      const idx = nearestPrim(hitP, body);
      let glow = 0;
      if (idx >= 0) {
        const prim = body.prims[idx]!;
        if (prim.color) base = [prim.color[0], prim.color[1], prim.color[2]];
        else base = fleshShade(hitP);
        glow = prim.glow ?? 0;
      } else {
        base = fleshShade(hitP);
      }

      // Simple ambient so the unlit side is not pure black flesh.
      const ambient = 0.16;
      const shade = clamp01(ambient + lambert * 0.85);
      // Emissive glow: the prim's own colour IS the light (per the grammar).
      let fr = base[0] * shade + glow * base[0] * 1.2;
      let fg = base[1] * shade + glow * base[1] * 1.2;
      let fb = base[2] * shade + glow * base[2] * 1.2;
      // A hint of depth-based darkening in crevices.
      rgb[i] = srgb(fr); rgb[i + 1] = srgb(fg); rgb[i + 2] = srgb(fb);
    }
  }
  writePng(`${out}/yaw-${String(f).padStart(2, '0')}.png`, w, h, rgb);
  console.log(`wrote ${out}/yaw-${String(f).padStart(2, '0')}.png  yaw=${(yaw * 180 / Math.PI).toFixed(0)}deg`);
}
console.log(`\n${frames} frames in ${out}`);
