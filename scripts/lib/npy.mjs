// scripts/lib/npy.mjs — minimal NumPy .npy v1.0 writer/reader for float32 arrays.
// Used by the neural upscale capture (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md §7).

/** @param {Float32Array} data @param {number[]} shape @returns {Buffer} */
export function encodeNpy(data, shape) {
  const count = shape.reduce((a, b) => a * b, 1);
  if (data.length !== count) throw new Error(`encodeNpy: ${data.length} floats do not fit shape (${shape.join(', ')})`);
  const dict = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const pad = (64 - ((10 + dict.length + 1) % 64)) % 64;
  const header = `${dict}${' '.repeat(pad)}\n`;
  const buf = Buffer.alloc(10 + header.length + data.byteLength);
  buf.write('\x93NUMPY', 0, 'latin1');
  buf[6] = 1;
  buf[7] = 0;
  buf.writeUInt16LE(header.length, 8);
  buf.write(header, 10, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(buf, 10 + header.length);
  return buf;
}

/** @param {Buffer} buf @returns {{ shape: number[], data: Float32Array }} */
export function decodeNpy(buf) {
  if (buf.subarray(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('decodeNpy: bad magic');
  const headerLen = buf.readUInt16LE(8);
  const header = buf.subarray(10, 10 + headerLen).toString('latin1');
  if (!header.includes("'descr': '<f4'")) throw new Error(`decodeNpy: only <f4 supported, got ${header}`);
  const m = header.match(/'shape': \(([^)]*)\)/);
  if (!m) throw new Error('decodeNpy: no shape');
  const shape = m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const start = 10 + headerLen;
  const copy = Buffer.from(buf.subarray(start));
  return { shape, data: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4) };
}
