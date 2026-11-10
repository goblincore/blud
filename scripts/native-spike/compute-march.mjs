// scripts/native-spike/compute-march.mjs
//
// THE COMPUTE-MARCH SPIKE (docs/dev-notes/2026-11-10-compute-march-spike/NOTES.md; the idea is
// docs/dev-notes/2026-11-09-sdf-perf-research/NOTES.md section 3 D). Is the march faster as a COMPUTE pass, one
// workgroup per screen tile, than as the shipped fragment pass? A measurement in the replay harness: no game code.
//
// One captured `sdf:march` pass (capture.mjs; compute-capture.sh stages the three frames) is replayed in the lab
// Chrome (replay-chrome.mjs / replay.html) as recorded, and as compute variants made from the SAME fragment shader
// text by exact-match edits: the field code, the buffers and the textures are the game's. Legs run in ALTERNATION
// with the order rotated each repeat, and the numbers that matter are each leg's difference from `frag` measured in
// the same repeat (lean-ab.mjs's method; `frag2` is the A/A control).
//
//   node scripts/native-spike/compute-march.mjs <reps> <captureDir> [legs]
//
//   legs (default frag,frag2,port,list,shared,mask):
//     frag    the fragment pass as captured (the base)
//     frag2   the same again: the A/A control
//     port    the fragment body as a compute entry point, 16 x 16 invocations a workgroup, one workgroup per tile of
//             the draw's screen rect (empty tiles included: each pixel runs the shipped empty-tile test and returns)
//     list    the same program, dispatched over the tiles whose list is not empty only
//     shared  list + the tile's entries read ONCE a workgroup into workgroup storage (its first n invocations load
//             one entry each, then a barrier); a pixel culls against that copy and keeps its own compacted list
//     mask    shared + the pixel's own list replaced by a 64-bit mask over the workgroup's copy
//   A number after a compute leg's name is the workgroup's side in invocations, when it is not one workgroup a tile:
//   list8 is list with 8 x 8 invocations a workgroup and four workgroups a tile; list4, list2 and list1 (one
//   invocation a workgroup) likewise; list8x4 is 8 wide and 4 high (32 invocations, eight workgroups a tile).
//   shared and mask need at least 64 invocations to load a 64-entry list: mask8.
//
// Every compute leg writes colour (rgba32float) and depth (r32float) as storage textures; the depth is read back
// and tested (less-equal, as the render pipeline does) so a frame with several draws composes as the fragment pass
// does. Each leg is run once first, untimed: the seconds (a cold compile) and its colour target against the game's
// own readback of that frame (texels over the harness's 1e-4 bar, the largest difference, floats that are not the
// same value). Then <reps> rotations, SPIKE_REPEAT copies of the pass a submit (default 10) and SPIKE_ROUNDS rounds
// (default 15), the median of a run. Results land in `<captureDir>-compute.json`.
//
//   COMPUTE_DUMP=<dir>   also write each leg's WGSL there
//
// Under the GPU lock, as every timing here:
//   until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done
//   LAB_TMP=.lab-tmp LAB_VITE_PORT=5391 LAB_CDP_PORT=9391 scripts/native-spike/servers.sh \
//     node scripts/native-spike/compute-march.mjs 6 .scratch/compute/closeup-flat
//   rm -rf /tmp/blud-gpu-timing.lock
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPS = Number(process.argv[2]);
const DIR = process.argv[3];
const LEGS = (process.argv[4] ?? 'frag,frag2,port,list,shared,mask').split(',').filter(Boolean);
if (!(REPS >= 0) || !DIR || !existsSync(join(DIR, 'manifest.json'))) {
  console.error('usage: node scripts/native-spike/compute-march.mjs <reps> <captureDir> [legs]');
  process.exit(2);
}
const REPEAT = process.env.SPIKE_REPEAT ?? '10';
const ROUNDS = process.env.SPIKE_ROUNDS ?? '15';
const CDP = process.env.LAB_CDP_PORT ?? '9291';
const DUMP = process.env.COMPUTE_DUMP ?? '';
const TILE = 16; // TILE_SIZE_PX: a tile is at most this many pixels a side
// A compute leg's name is its form and, optionally, the side of a workgroup in invocations (default: the tile's).
const parseLeg = (name) => {
  const m = /^(port|list|shared|mask)(?:(16|8|4|2|1)(?:x(16|8|4|2|1))?)?$/.exec(name);
  if (!m) throw new Error(`compute-march: unknown leg ${name}`);
  const wx = Number(m[2] ?? TILE), wy = Number(m[3] ?? m[2] ?? TILE);
  if ((m[1] === 'shared' || m[1] === 'mask') && wx * wy < 64) throw new Error(`compute-march: ${name} has too few invocations a workgroup to load a 64-entry list`);
  return { base: m[1], wx, wy };
};

// ---- text tools ------------------------------------------------------------------------------------------------
// Exact-match replacement, counted: an edit that no longer matches the shader text throws by name.
const edit = (code, name, from, to, count = 1) => {
  const n = code.split(from).length - 1;
  if (n !== count) throw new Error(`compute-march: edit "${name}" matched ${n} time(s), expected ${count}`);
  return code.split(from).join(to);
};
// Split a parameter or argument list at its top-level commas.
const splitTop = (text, angles) => {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[' || (angles && ch === '<')) depth++;
    if (ch === ')' || ch === ']' || (angles && ch === '>')) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
// marchBody's parameter names against the expressions main() passes: which uniform is tileCfg, which buffer the
// tile entries, and so on. three.js names them by counter, so they differ between programs.
const marchArgs = (code) => {
  const head = code.indexOf('fn marchBody (');
  const headEnd = code.indexOf(') -> vec4<f32>', head);
  if (head < 0 || headEnd < 0) throw new Error('compute-march: no marchBody in this program');
  const params = splitTop(code.slice(head + 'fn marchBody ('.length, headEnd).replace(/\/\/[^\n]*/g, ''), true).map((p) => p.split(':')[0].trim());
  const call = code.indexOf('= marchBody( ');
  if (call < 0) throw new Error('compute-march: main() does not call marchBody');
  let i = call + '= marchBody('.length, depth = 1;
  const start = i;
  for (; depth > 0; i++) { if (code[i] === '(') depth++; else if (code[i] === ')') depth--; }
  const args = splitTop(code.slice(start, i - 1), false);
  if (args.length !== params.length) throw new Error(`compute-march: marchBody takes ${params.length} parameters, main() passes ${args.length}`);
  return Object.fromEntries(params.map((p, k) => [p, args[k]]));
};
// A uniform struct's field offsets by WGSL's layout rules.
const SIZES = { f32: [4, 4], i32: [4, 4], u32: [4, 4], 'vec2<f32>': [8, 8], 'vec3<f32>': [16, 12], 'vec4<f32>': [16, 16], 'mat3x3<f32>': [16, 48], 'mat4x4<f32>': [16, 64] };
const structLayout = (code, name) => {
  const m = new RegExp(`struct ${name} \\{([^}]*)\\}`).exec(code);
  if (!m) throw new Error(`compute-march: no struct ${name}`);
  const out = {};
  let at = 0;
  for (const f of m[1].split(',\n').map((l) => l.trim()).filter(Boolean)) {
    const [field, type] = f.split(':').map((x) => x.trim());
    const sz = SIZES[type];
    if (!sz) throw new Error(`compute-march: ${name}.${field} has a type this does not lay out: ${type}`);
    at = Math.ceil(at / sz[0]) * sz[0];
    out[field] = { offset: at, n: sz[1] / 4 };
    at += sz[1];
  }
  return out;
};

// ---- the fragment program as a compute program -------------------------------------------------------------------
const ENTRY = `@fragment
fn main( @location( 0 ) v_clipSpace : vec4<f32>,
	@builtin( position ) fragCoord : vec4<f32> ) -> OutputStruct {
`;
const EMPTY_TILE = /\tif \( \( \( \( [^\n]*quadTileEmpty\( [^\n]*\) \) \) \{\n\n\t\tdiscard;\n\t\t\n\n\t\}\n/;
const toCompute = (frag, variant) => {
  const a = marchArgs(frag);
  for (const k of ['tileHdr', 'tileEnt', 'tileCfg', 'screenUV']) if (!a[k]) throw new Error(`compute-march: marchBody has no ${k}`);
  const ent = a.tileEnt.replace(/^&/, '');
  const { base, wx, wy } = parseLeg(variant);
  const shared = base === 'shared' || base === 'mask';
  const ax = TILE / wx, ay = TILE / wy;
  let c = frag;

  // -- what a tile shares (shared, mask) --
  if (shared) {
    // The preload's loop reads the workgroup's copy of the entries, not the entry buffer.
    const loop = c.slice(c.indexOf('    for (var e = 0; e < 64; e = e + 1) {\n      if (e >= i32(n)) { break; }'), c.indexOf('    gTileN = f32(w);'));
    if (/\bg\.[xyw]\b/.test(loop.replace(/\/\/[^\n]*/g, ''))) throw new Error('compute-march: the preload reads more of the entry than its distortion lane');
    c = edit(c, 'preload header', `    let head = (*tileHdr)[tid.y * gx + tid.x];\n    let n = min(head.y, 64u);`, `    let n = min(gCmpHead.y, 64u);`);
    c = edit(c, 'preload entry', `      let lin = (head.x + u32(e)) * 3u;\n      let b = (*tileEnt)[lin];\n      let g = (*tileEnt)[lin + 1u];`,
      `      let b = wgBound[e];\n      let g = vec4<f32>(0.0, 0.0, wgDist[e], 0.0);`);
    c = edit(c, 'preload ref', `      let entMeta = (*tileEnt)[lin + 2u];\n      gTileRef[w] = u32(floor(entMeta.x)) * 256u + u32(fract(entMeta.x) * 256.0 + 0.5);`,
      `      gTileRef[w] = wgRef[e];`);
  }
  if (base === 'mask') {
    // The pixel keeps a 64-bit mask over the workgroup's list, not a compacted list of its own. gTileN becomes the
    // TILE's count (every reader's loop bound); an entry or a slot run whose bits are clear is skipped where the
    // compacted list simply did not hold it, so every fold sees the same entries in the same order.
    c = edit(c, 'mask: the list', `var<private> gTileRef: array<u32, 64>;`, `var<private> gCmpMask: vec2<u32> = vec2<u32>(0u, 0u);
fn cmpKept(e: i32) -> bool {
  return ((select(gCmpMask.x, gCmpMask.y, e >= 32) >> (u32(e) & 31u)) & 1u) != 0u;
}
fn cmpBelow(n: i32) -> vec2<u32> {
  let lo = clamp(n, 0, 32);
  let hi = clamp(n - 32, 0, 32);
  return vec2<u32>(select((1u << (u32(lo) & 31u)) - 1u, 0xffffffffu, lo >= 32), select((1u << (u32(hi) & 31u)) - 1u, 0xffffffffu, hi >= 32));
}
fn cmpRunKept(first: i32, end: i32) -> bool {
  let m = gCmpMask & cmpBelow(end) & ~cmpBelow(first);
  return (m.x | m.y) != 0u;
}`);
    c = edit(c, 'mask: keep', `      gTileRef[w] = wgRef[e];\n      w = w + 1;`,
      `      if (e < 32) { gCmpMask.x = gCmpMask.x | (1u << u32(e)); } else { gCmpMask.y = gCmpMask.y | (1u << u32(e - 32)); }\n      w = w + 1;`);
    c = edit(c, 'mask: count', `    gTileN = f32(w);`, `    gTileN = f32(n);`);
    c = edit(c, 'mask: empty', `    if (quadMode && gTileN < 0.5) { discard;`, `    if (quadMode && w < 1) { discard;`);
    c = edit(c, 'mask: mapBody run', `    if (tiled) { rFirst = tRun; rEnd = tileRunEnd(rFirst); tRun = rEnd; }\n`,
      `    if (tiled) { rFirst = tRun; rEnd = tileRunEnd(rFirst); tRun = rEnd; }\n    if (tiled && !cmpRunKept(rFirst, rEnd)) { continue; }\n`);
    c = edit(c, 'mask: mapBody fold', `    for (var e = rFirst; e < rEnd; e = e + 1) {\n      let tRange = tileRange(data, e, band);`,
      `    for (var e = rFirst; e < rEnd; e = e + 1) {\n      if (!cmpKept(e)) { continue; }\n      let tRange = tileRange(data, e, band);`);
    c = edit(c, 'mask: mapLean run', `    tRun = rEnd;\n    let s = i32(gTileRef[rFirst] >> 8u);`,
      `    tRun = rEnd;\n    if (!cmpRunKept(rFirst, rEnd)) { continue; }\n    let s = i32(gTileRef[rFirst] >> 8u);`);
    c = edit(c, 'mask: mapLean fold', `    for (var e = rFirst; e < rEnd; e = e + 1) {\n      d = foldGroup(d, pIn, data, counts, band, tileBounds(data, e, band), tileRange(data, e, band));`,
      `    for (var e = rFirst; e < rEnd; e = e + 1) {\n      if (!cmpKept(e)) { continue; }\n      d = foldGroup(d, pIn, data, counts, band, tileBounds(data, e, band), tileRange(data, e, band));`);
    c = edit(c, 'mask: normal fold', `      if (f32(e) >= gTileN) { break; }\n      // CROWD (2026-09-14)`, `      if (f32(e) >= gTileN) { break; }\n      if (!cmpKept(e)) { continue; }\n      // CROWD (2026-09-14)`);
    c = edit(c, 'mask: normal listed', `          if (f32(e) >= gTileN) { break; }\n          if ((gTileRef[e] & 255u) == u32(g)`, `          if (f32(e) >= gTileN) { break; }\n          if (!cmpKept(e)) { continue; }\n          if ((gTileRef[e] & 255u) == u32(g)`);
    c = edit(c, 'mask: lean test', `      lRun = tileRunEnd(lFirst);\n`, `      lRun = tileRunEnd(lFirst);\n      if (!cmpRunKept(lFirst, lRun)) { continue; }\n`);
    // Every reader left reads the workgroup's list.
    c = c.split('gTileRef[').join('wgRef[');
    if (/\bgTileRef\b/.test(c.replace(/\/\/[^\n]*/g, ''))) throw new Error('compute-march: mask left a reader of gTileRef');
  }

  // -- the entry point --
  // A discard inside marchBody is always followed by its return; main() then drops the pixel. main()'s own
  // empty-tile discard returns at once (the shared forms dispatch no empty tile, so it goes).
  if (!EMPTY_TILE.test(c)) throw new Error('compute-march: main() has no empty-tile discard');
  c = c.replace(EMPTY_TILE, shared ? '' : (m) => m.replace('discard;', 'return;'));
  const discards = c.split('discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0);').length - 1;
  c = c.split('discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0);').join('gCmpDiscard = true; return vec4<f32>(0.0, 0.0, 0.0, 0.0);');
  if (discards < 1 || /\bdiscard\s*;/.test(c.replace(/\/\/[^\n]*/g, ''))) throw new Error('compute-march: a discard without its return is left');

  c = edit(c, 'output struct', `struct OutputStruct {\n\t@location( 0 ) color: vec4<f32>,\n\t@builtin( frag_depth ) depth : f32\n};`,
    `struct OutputStruct {\n\tcolor: vec4<f32>,\n\tdepth : f32\n};
// ---- the compute-march spike (compute-march.mjs) ----
@group( 2 ) @binding( 0 ) var cmpColor : texture_storage_2d<rgba32float, write>;
@group( 2 ) @binding( 1 ) var cmpDepth : texture_storage_2d<r32float, read_write>;
// [0] the draw's pixel rect (x0, y0, x1, y1; upper bounds exclusive), [1] (width, height, tilesX, tilesY), then two
// a tile: (tileX, tileY, first pixel x, first pixel y) and (its list's offset, its count, 0, 0).
struct CmpTiles { v : array<vec4<u32>> };
@group( 2 ) @binding( 2 ) var<storage, read> cmpTiles : CmpTiles;
var<private> gCmpDiscard : bool = false;
var<private> gCmpHead : vec2<u32> = vec2<u32>(0u, 0u);
${shared ? `var<workgroup> wgBound : array<vec4<f32>, 64>;
var<workgroup> wgDist : array<f32, 64>;
var<workgroup> wgRef : array<u32, 64>;` : ''}`);

  c = edit(c, 'entry', ENTRY, `@compute @workgroup_size( ${wx}, ${wy} )
fn main( @builtin( workgroup_id ) cmpWid : vec3<u32>,
	@builtin( local_invocation_id ) cmpLid : vec3<u32>,
	@builtin( local_invocation_index ) cmpLi : u32 ) {

	let cmpRect = cmpTiles.v[0];
	// ${ax * ay} workgroup(s) a tile: which tile, and which block of it.
	let cmpAt0 = cmpWid.x;
	let cmpSub = cmpWid.y;
	let cmpTile = cmpTiles.v[2u + 2u * cmpAt0];
	let cmpList = cmpTiles.v[3u + 2u * cmpAt0];
	gCmpHead = cmpList.xy;
${shared ? `	// What the tile shares, once a workgroup: its first n invocations load one entry each.
	if ( cmpLi < min( cmpList.y, 64u ) ) {
		let lin = ( cmpList.x + cmpLi ) * 3u;
		wgBound[cmpLi] = ${ent}[lin];
		wgDist[cmpLi] = ${ent}[lin + 1u].z;
		let cmpMeta = ${ent}[lin + 2u].x;
		wgRef[cmpLi] = u32( floor( cmpMeta ) ) * 256u + u32( fract( cmpMeta ) * 256.0 + 0.5 );
	}
	workgroupBarrier();
` : ''}	let cmpPix = cmpTile.zw + vec2<u32>( cmpSub % ${ax}u, cmpSub / ${ax}u ) * vec2<u32>( ${wx}u, ${wy}u ) + cmpLid.xy;
	if ( cmpPix.x < cmpRect.x || cmpPix.y < cmpRect.y || cmpPix.x >= cmpRect.z || cmpPix.y >= cmpRect.w ) { return; }
	let fragCoord = vec4<f32>( vec2<f32>( cmpPix ) + vec2<f32>( 0.5 ), 0.0, 1.0 );
	let v_clipSpace = vec4<f32>( 0.0, 0.0, 1.0, 1.0 );
	// This workgroup's tile only, by the march's own expression for a pixel's tile.
	let cmpCfg = ${a.tileCfg};
	let cmpGrid = vec2<i32>( max( 1, i32( cmpCfg.y ) ), max( 1, i32( cmpCfg.w ) ) );
	let cmpTid = clamp( vec2<i32>( floor( ${a.screenUV} * vec2<f32>( cmpGrid ) ) ), vec2<i32>( 0, 0 ), cmpGrid - vec2<i32>( 1, 1 ) );
	if ( cmpTid.x != i32( cmpTile.x ) || cmpTid.y != i32( cmpTile.y ) ) { return; }
`);

  c = edit(c, 'result', `\n\treturn output;\n\n}`, `
	if ( gCmpDiscard ) { return; }
	// The render pipeline's depth test (less-equal, depth written), by hand.
	let cmpZ = clamp( output.depth, 0.0, 1.0 );
	let cmpAt = vec2<i32>( cmpPix );
	if ( cmpZ <= textureLoad( cmpDepth, cmpAt ).r ) {
		textureStore( cmpDepth, cmpAt, vec4<f32>( cmpZ, 0.0, 0.0, 0.0 ) );
		textureStore( cmpColor, cmpAt, output.color );
	}

}`);
  return c;
};

// ---- the pass as dispatches ---------------------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
if (manifest.passes.length !== 1) throw new Error(`compute-march: ${DIR} holds ${manifest.passes.length} passes, expected the one sdf:march pass`);
const rec = manifest.passes[0];
const obj = manifest.objects;
const floats = (file) => { const b = readFileSync(join(DIR, file)); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2); };
const words = (file) => { const b = readFileSync(join(DIR, file)); return new Uint32Array(b.buffer, b.byteOffset, b.length >> 2); };

// The draws, each with the pipeline and bind groups in force when it was issued.
const draws = [];
{
  let pipeline = null;
  const groups = [];
  for (const [name, ...args] of rec.cmds) {
    if (name === 'setPipeline') pipeline = args[0].$ref;
    else if (name === 'setBindGroup') groups[args[0]] = args[1];
    else if (name === 'drawIndexed' || name === 'draw') draws.push({ pipeline, groups: [...groups] });
    else if (name === 'setScissorRect') throw new Error('compute-march: the pass sets a scissor rect');
  }
}
const colourView = rec.desc.colorAttachments[0];
const target = obj[obj[colourView.view.$ref].texture.$ref].desc;
const [W, H] = target.size;
if (rec.desc.colorAttachments.length !== 1 || target.format !== 'rgba32float') throw new Error('compute-march: expected one rgba32float colour target');

// A group's resource at a binding, as the capture's blob.
const bound = (group, binding) => {
  const e = obj[group.$ref].desc.entries.find((x) => x.binding === binding);
  const id = e.resource.buffer.$ref;
  return rec.res[id].file;
};
const describe = (draw) => {
  const p = obj[draw.pipeline].desc;
  const ds = p.depthStencil;
  if (!ds || ds.depthCompare !== 'less-equal' || !ds.depthWriteEnabled) throw new Error('compute-march: the pipeline is not depth less-equal with depth writes');
  const frag = obj[p.fragment.module.$ref].desc.code, vert = obj[p.vertex.module.$ref].desc.code;
  const a = marchArgs(frag);
  const layout = structLayout(frag, 'objectStruct');
  const uniforms = floats(bound(draw.groups[1], 0));
  const field = (expr) => {
    const m = /^object\.(\w+)$/.exec(expr);
    if (!m || !layout[m[1]]) throw new Error(`compute-march: ${expr} is not a field of the object uniforms`);
    return Array.from(uniforms.subarray(layout[m[1]].offset / 4, layout[m[1]].offset / 4 + layout[m[1]].n));
  };
  const tileCfg = field(a.tileCfg), instCfg = field(a.instCfg);
  if (!(tileCfg[0] > 0.5) || !(instCfg[1] > 1.5)) throw new Error(`compute-march: this draw is not the quad dispatch with tile lists (tileCfg.x ${tileCfg[0]}, instCfg.y ${instCfg[1]})`);
  const gx = Math.max(1, Math.trunc(tileCfg[1])), gy = Math.max(1, Math.trunc(tileCfg[3]));
  // The quad's NDC rect (crowd-type.ts quadRect), named by the vertex shader; the pixels whose centre it covers.
  const rm = /mix\( object\.(nodeUniform\d+)\.x, object\.\1\.z,/.exec(vert);
  if (!rm) throw new Error('compute-march: the vertex shader is not the crowd quad');
  const r = field(`object.${rm[1]}`);
  const lo = (v) => Math.max(0, Math.ceil(v - 0.5));
  const rect = [lo((r[0] * 0.5 + 0.5) * W), lo((1 - (r[3] * 0.5 + 0.5)) * H), Math.min(W, lo((r[2] * 0.5 + 0.5) * W)), Math.min(H, lo((1 - (r[1] * 0.5 + 0.5)) * H))];
  // The tile header buffer: (offset, count) a tile.
  const hb = new RegExp(`@binding\\( (\\d+) \\) @group\\( 1 \\)\\s*\\nvar<storage, read> ${a.tileHdr.replace(/^&/, '').replace(/\.value$/, '')} :`).exec(frag);
  if (!hb) throw new Error('compute-march: no binding for the tile header buffer');
  const hdr = words(bound(draw.groups[1], Number(hb[1])));
  const tiles = [];
  for (let ty = 0; ty < gy; ty++) for (let tx = 0; tx < gx; tx++) {
    const x0 = lo(tx * W / gx), x1 = lo((tx + 1) * W / gx), y0 = lo(ty * H / gy), y1 = lo((ty + 1) * H / gy);
    if (x1 - x0 > TILE || y1 - y0 > TILE) throw new Error(`compute-march: tile ${tx},${ty} is ${x1 - x0} x ${y1 - y0} px, more than one workgroup`);
    if (x1 <= rect[0] || x0 >= rect[2] || y1 <= rect[1] || y0 >= rect[3]) continue;
    tiles.push({ tx, ty, x0, y0, offset: hdr[(ty * gx + tx) * 2], count: hdr[(ty * gx + tx) * 2 + 1] });
  }
  return { frag, rect, gx, gy, tiles };
};
const described = draws.map(describe);

// One compute manifest a variant: the pass keeps its descriptor (the parity check reads the game's readback through
// it), loses its draw commands, and gains `compute`.
const codeCache = new Map();
const buildVariant = (variant) => {
  const m = JSON.parse(JSON.stringify(manifest));
  const pass = m.passes[0];
  const codes = [];
  const stats = [];
  const out = { width: W, height: H, clear: colourView.clearValue, codes, draws: [] };
  described.forEach((d, i) => {
    const key = `${variant}\n${d.frag}`;
    if (!codeCache.has(key)) codeCache.set(key, toCompute(d.frag, variant));
    const code = codeCache.get(key);
    let ci = codes.indexOf(code);
    if (ci < 0) { codes.push(code); ci = codes.length - 1; }
    const { base, wx, wy } = parseLeg(variant);
    const tiles = base === 'port' ? d.tiles : d.tiles.filter((t) => t.count > 0);
    const buf = new Uint32Array(8 + tiles.length * 8);
    buf.set([...d.rect, W, H, d.gx, d.gy], 0);
    tiles.forEach((t, k) => buf.set([t.tx, t.ty, t.x0, t.y0, t.offset, t.count, 0, 0], 8 + k * 8));
    const file = `cmp_${variant}_${i}.bin`;
    writeFileSync(join(DIR, file), Buffer.from(buf.buffer));
    out.draws.push({ code: ci, groups: draws[i].groups, tiles: file, count: [tiles.length, (TILE / wx) * (TILE / wy)] });
    stats.push({ rect: d.rect, grid: [d.gx, d.gy], tilesInRect: d.tiles.length, tilesNonEmpty: d.tiles.filter((t) => t.count > 0).length, dispatched: tiles.length, maxCount: Math.max(0, ...d.tiles.map((t) => t.count)) });
  });
  pass.cmds = [];
  pass.compute = out;
  const name = `manifest.cmp-${variant}.json`;
  writeFileSync(join(DIR, name), JSON.stringify(m));
  if (DUMP) { mkdirSync(DUMP, { recursive: true }); codes.forEach((code, k) => writeFileSync(join(DUMP, `${variant}-${k}.wgsl`), code)); }
  return { name, stats, programs: codes.length };
};

const legs = LEGS.map((name) => {
  if (name === 'frag' || name === 'frag2') return { name, manifest: 'manifest.json', compute: false };
  const v = buildVariant(name);
  return { name, manifest: v.name, compute: true, stats: v.stats, programs: v.programs };
});
if (legs[0].name !== 'frag') throw new Error('compute-march: the first leg must be frag (the base)');
const first = described[0];
console.log(`${DIR}: ${W} x ${H}, ${draws.length} draw(s); tiles ${first.gx} x ${first.gy}`);
described.forEach((d, i) => console.log(`  draw ${i}: rect px ${d.rect.join(',')}  tiles in rect ${d.tiles.length}, not empty ${d.tiles.filter((t) => t.count > 0).length}, longest list ${Math.max(0, ...d.tiles.map((t) => t.count))}`));

// replay-chrome.mjs exits 1 when the replay reported errors; its JSON line is still the last line of stdout.
const run = (leg, repeat = REPEAT, rounds = ROUNDS) => {
  let out;
  try {
    out = execFileSync('node', ['scripts/native-spike/replay-chrome.mjs', CDP, DIR, repeat, rounds, leg.manifest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    out = String(e.stdout ?? '');
    if (!out.trim()) throw new Error(`compute-march: ${leg.name} replay failed: ${String(e.stderr || e.message).slice(0, 2000)}`);
  }
  return JSON.parse(out.trim().split('\n').pop());
};

// Warm each leg once: the cold compile, and its colour target against the game's own readback of the frame.
const info = {};
const file = `${DIR.replace(/\/+$/, '')}-compute.json`;
const save = (extra = {}) => writeFileSync(file, JSON.stringify({ dir: DIR, scene: manifest.meta?.scene, reps: REPS, repeat: Number(REPEAT), rounds: Number(ROUNDS), legs, info, ...extra }, null, 1));
let failed = false;
for (const leg of legs) {
  const t0 = Date.now();
  const res = run(leg, '2', '2');
  const p = res.parity?.[0] ?? {};
  info[leg.name] = { warmS: (Date.now() - t0) / 1000, parity: res.parity, errors: res.errors };
  console.log(`warm ${leg.name.padEnd(7)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  texels over 1e-4: ${String(p.differingTexels ?? '?').padStart(6)}  max ${(p.maxDiff ?? NaN).toPrecision(3)}  floats not identical: ${p.inexactFloats ?? '?'}  over the bar by channel rgba ${(p.chanOver ?? []).join('/')}  colour moved > 0.02: ${p.over02 ?? '?'}  hit/miss flips ${p.hitFlips ?? '?'}`);
  if (res.errors?.length) {
    failed = true;
    for (const e of res.errors.slice(0, 6)) console.error(`  ERROR ${leg.name}: ${e.slice(0, 1500)}`);
  }
}
save();
if (failed) { console.error('compute-march: a leg replays with errors; nothing timed'); process.exit(1); }
if (REPS === 0) { console.log(`wrote ${file}`); process.exit(0); }

// Rotations: repeat r starts at leg r (mod n), so no leg is always first (coolest) or last.
const BASE = legs[0].name;
const reps = [];
for (let rep = 0; rep < REPS; rep++) {
  const order = legs.map((_, i) => legs[(i + rep) % legs.length]);
  const row = { rep: rep + 1, order: order.map((l) => l.name), ms: {}, minMs: {} };
  for (const leg of order) {
    const res = run(leg);
    row.ms[leg.name] = res.medianMs;
    row.minMs[leg.name] = res.minMs;
  }
  row.diff = Object.fromEntries(legs.slice(1).map((l) => [l.name, row.ms[l.name] - row.ms[BASE]]));
  reps.push(row);
  console.log(`  rep ${String(rep + 1).padStart(2)}  ${legs.map((l) => `${l.name} ${row.ms[l.name].toFixed(2)}${l.name === BASE ? '' : ` (${row.diff[l.name] >= 0 ? '+' : ''}${row.diff[l.name].toFixed(2)})`}`).join('  ')}`);
  save({ runs: reps });
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const baseMed = med(reps.map((r) => r.ms[BASE]));
const table = [];
console.log(`\nthe paired differences: each repeat's leg median minus ${BASE}'s in the same repeat (base median ${baseMed.toFixed(2)} ms)`);
console.log(`${'leg'.padEnd(8)}${'median ms'.padStart(10)}${'range of medians'.padStart(18)}${'diff med'.padStart(10)}${'min'.padStart(8)}${'max'.padStart(8)}${'med %'.padStart(8)}${'min %'.padStart(8)}${'max %'.padStart(8)}`);
for (const leg of legs) {
  const m = reps.map((r) => r.ms[leg.name]);
  const row = { leg: leg.name, medianMs: med(m), lo: Math.min(...m), hi: Math.max(...m) };
  if (leg.name !== BASE) {
    const d = reps.map((r) => r.diff[leg.name]);
    Object.assign(row, { diffMedianMs: med(d), diffMinMs: Math.min(...d), diffMaxMs: Math.max(...d) });
    Object.assign(row, { diffMedianPct: 100 * row.diffMedianMs / baseMed, diffMinPct: 100 * row.diffMinMs / baseMed, diffMaxPct: 100 * row.diffMaxMs / baseMed });
  }
  table.push(row);
  const f = (v, n = 2) => (v === undefined ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(n)}`);
  console.log(`${leg.name.padEnd(8)}${row.medianMs.toFixed(2).padStart(10)}${`${row.lo.toFixed(2)}..${row.hi.toFixed(2)}`.padStart(18)}`
    + `${f(row.diffMedianMs).padStart(10)}${f(row.diffMinMs).padStart(8)}${f(row.diffMaxMs).padStart(8)}${f(row.diffMedianPct, 1).padStart(8)}${f(row.diffMinPct, 1).padStart(8)}${f(row.diffMaxPct, 1).padStart(8)}`);
}
save({ runs: reps, base: BASE, baseMedianMs: baseMed, table });
console.log(`\nwrote ${file}`);
