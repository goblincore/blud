// BUILD FLAME ATLAS (flame-tongues plan task 3): packs Blood's FIRE01 flipbook
// frames — tiles 3532-3539 of the tiles013 sheet — into one horizontal-strip
// atlas the flame-cards technique samples per frame.
//
//   node scripts/build-flame-atlas.mjs
//
// Writes (both gitignored — `public/assets/**/*-placeholder/`):
//   public/assets/flame-placeholder/fire01.png    8 frames in one row
//   public/assets/flame-placeholder/fire01.json   { frames, cellW, cellH, pad, atlasW, atlasH }
//
// GUTTER (flame-polish task 1): every cell is separated by a 2 px transparent
// gutter, so even a minified/mip or a rounding tap at a cell boundary lands in
// transparent padding rather than the neighbouring frame. `pad` is recorded in
// the sidecar and read back by flame-cards.ts's cardCellUv, which skips it when
// it computes a frame's uv range.
//
// The extraction is a DEV PLACEHOLDER (never commit, never ship): a fresh
// clone has no assets-source/, so this script exits 2 with a clear message
// and the lab falls back to its procedural card shader. Same decode rules as
// flame-capture.mjs's decodePng: 8-bit RGB / RGBA / palette, non-interlaced.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const EXTRACTION = process.env.BLOOD_EXTRACTION
  ?? '/Users/donny/Projects/blud/assets-source/blood-extracted';
const TILE_DIR = `${EXTRACTION}/tiles013_tiles`;
const FIRST_TILE = 3532;
const FRAMES = 8; // 3532..3539
const OUT_DIR = 'public/assets/flame-placeholder';

const fail = (msg) => { console.error(`flame:atlas — ${msg}`); process.exit(2); };

if (!existsSync(TILE_DIR)) {
  fail(`extraction not found at ${TILE_DIR}. Blood assets are dev placeholders,`
    + ' never committed — run the Blood extraction into assets-source/ first,'
    + ' or keep using the lab\'s procedural card fallback (flame-cards.ts).');
}

// --- PNG decode (flame-capture.mjs's decoder, trimmed to what tiles need) ---

import { inflateSync } from 'node:zlib';

function decodePng(png) {
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'PLTE') plte = Buffer.from(data);
    if (type === 'tRNS') trns = Buffer.from(data);
    if (type === 'IEND') break;
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (bitDepth !== 8 || ![2, 3, 6].includes(colorType)) {
    fail(`tile is not an 8-bit RGB(A)/palette PNG (bitDepth=${bitDepth}, colorType=${colorType})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 3 ? 1 : colorType === 6 ? 4 : 3;
  const unfilter = (stride) => {
    const out = Buffer.alloc(h * stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      const cur = out.subarray(y * stride, (y + 1) * stride);
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v = line[i];
        if (f === 1) v = (v + a) & 0xff;
        else if (f === 2) v = (v + b) & 0xff;
        else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        cur[i] = v;
      }
      prev = cur;
    }
    return out;
  };
  if (colorType === 3) {
    const idx = unfilter(w);
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const p = idx[i];
      rgba[i * 4] = plte[p * 3]; rgba[i * 4 + 1] = plte[p * 3 + 1]; rgba[i * 4 + 2] = plte[p * 3 + 2];
      rgba[i * 4 + 3] = trns && p < trns.length ? trns[p] : 255;
    }
    return { w, h, rgba };
  }
  const chans = colorType === 6 ? 4 : 3;
  const out = unfilter(w * chans);
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = out[i * chans]; rgba[i * 4 + 1] = out[i * chans + 1]; rgba[i * 4 + 2] = out[i * chans + 2];
    rgba[i * 4 + 3] = chans === 4 ? out[i * chans + 3] : 255;
  }
  return { w, h, rgba };
}

// --- PNG encode (8-bit RGBA, flame-capture.mjs's encoder) -------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Pack one row -------------------------------------------------------------
// Blood's tiles are CROPPED PER FRAME (3532 is 29x24, 3533 is 30x20, ...), so
// the grid cells are the max across frames and each frame is bottom-centre
// aligned inside its cell: a flame stays planted at its base while it burns,
// and the padding is transparent (tRNS) — free under additive blending.
// A PAD-px transparent gutter separates adjacent cells (see the header).

const PAD = 2;   // texels of transparent gutter on each side of every cell

const frames = [];
let cellW = -1, cellH = -1;
for (let i = 0; i < FRAMES; i++) {
  const file = `${TILE_DIR}/${String(FIRST_TILE + i).padStart(5, '0')}.png`;
  if (!existsSync(file)) fail(`frame tile missing: ${file}`);
  const d = decodePng(readFileSync(file));
  cellW = Math.max(cellW, d.w);
  cellH = Math.max(cellH, d.h);
  frames.push({ rgba: d.rgba, w: d.w, h: d.h });
}

const pitch = cellW + 2 * PAD;
const atlasW = pitch * FRAMES;
const atlasH = cellH + 2 * PAD;
const atlas = Buffer.alloc(atlasW * atlasH * 4);
for (let f = 0; f < FRAMES; f++) {
  const { rgba, w, h } = frames[f];
  const x0 = f * pitch + PAD + ((cellW - w) >> 1);   // centre inside the cell
  const y0 = PAD + (cellH - h);                       // bottom-aligned (fire base)
  for (let y = 0; y < h; y++) {
    rgba.copy(atlas, ((y0 + y) * atlasW + x0) * 4, (y * w) * 4, (y * w + w) * 4);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/fire01.png`, encodePng(atlas, atlasW, atlasH));
writeFileSync(`${OUT_DIR}/fire01.json`, JSON.stringify({
  frames: FRAMES, cellW, cellH, pad: PAD, atlasW, atlasH,
  source: `tiles013 tiles ${FIRST_TILE}-${FIRST_TILE + FRAMES - 1} (dev placeholder)`,
}, null, 2));
console.log(`flame:atlas — wrote ${OUT_DIR}/fire01.png (${atlasW}x${atlasH}, ${FRAMES} frames of ${cellW}x${cellH}, pad ${PAD})`);
