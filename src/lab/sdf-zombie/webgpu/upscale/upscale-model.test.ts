import { describe, expect, it } from 'vitest';
import {
  createUpscaleModel, parseUpscaleModelJson, serializeUpscaleModel, UPSCALE_MODEL_FORMAT, type UpscaleModelJson,
} from './upscale-model';

const b64 = (values: number[]) => btoa(String.fromCharCode(...new Uint8Array(new Float32Array(values).buffer)));

function trainedJson(): UpscaleModelJson {
  const m = { ...createUpscaleModel('s16', 'rgbd', 7), source: 'trained' as const, run: 's16-rgbd', step: 500 };
  return JSON.parse(JSON.stringify(serializeUpscaleModel(m, { metrics: { overall: 0.1, face: null } })));
}

describe('upscale model JSON (contracts §2)', () => {
  it('round-trips a model bit-exactly and keeps its hash and provenance', () => {
    const m = { ...createUpscaleModel('s16', 'rgbd', 7), source: 'trained' as const, run: 's16-rgbd', step: 500 };
    const json = trainedJson();
    expect(json.format).toBe(UPSCALE_MODEL_FORMAT);
    expect(json.inScale[4]).toBe(Math.fround(0.1));
    const back = parseUpscaleModelJson(json);
    expect(back.weightHash).toBe(m.weightHash);
    expect(back).toMatchObject({ id: 's16', inputs: 'rgbd', source: 'trained', run: 's16-rgbd', step: 500 });
    back.layers.forEach((l, k) => {
      expect(l.weights).toEqual(m.layers[k]!.weights);
      expect(l.bias).toEqual(m.layers[k]!.bias);
      expect(l.relu).toBe(m.layers[k]!.relu);
    });
    expect(Array.from(back.inScale)).toEqual(Array.from(m.inScale));
  });

  it('matches the cross-language hash vectors (the Python exporter asserts the same)', () => {
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgb', 1))).weightHash).toBe('3d86dba5');
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgbd', 1))).weightHash).toBe('55870aa7');
    // run-4 head (zero weights): nupscale weight_hash(Upscaler('zero','rgb',head=True)) == ca56e995
    expect(parseUpscaleModelJson(serializeUpscaleModel(createUpscaleModel('zero', 'rgb', 1, true))).weightHash).toBe('ca56e995');
  });

  it('serializes seeded weights as random and defaults a missing source to trained', () => {
    const json = serializeUpscaleModel(createUpscaleModel('s8', 'rgb', 2));
    expect(json.source).toBe('random');
    expect(parseUpscaleModelJson(json).source).toBe('random');
    const { source: _drop, ...noSource } = json;
    expect(parseUpscaleModelJson(noSource).source).toBe('trained');
  });

  const cases: Array<[string, (j: UpscaleModelJson) => unknown, RegExp]> = [
    ['not an object', () => null, /not a JSON object/],
    ['format', (j) => ({ ...j, format: 'blud-upscale-model/0' }), /format/],
    ['id', (j) => ({ ...j, id: 's128' }), /unknown id/],
    ['inputs', (j) => ({ ...j, inputs: 'rgba' }), /unknown inputs/],
    ['layer count', (j) => ({ ...j, layers: j.layers.slice(0, 2) }), /needs 3 layers/],
    ['chain shape', (j) => ({ ...j, id: 's8' }), /layer 0 is 5->16, expected 5->8/],
    ['relu flag', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 2 ? { ...l, relu: true } : l)) }), /relu must be false/],
    ['dilation', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 1 ? { ...l, dilation: 2 } : l)) }), /dilation 2, expected 1/],
    ['weights length', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 0 ? { ...l, weights: b64([1, 2]) } : l)) }), /has 2 weights/],
    ['partial float', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 0 ? { ...l, bias: 'AAA=' } : l)) }), /not whole float32s/],
    ['non-finite', (j) => ({ ...j, layers: j.layers.map((l, k) => (k === 1 ? { ...l, bias: b64(new Array(16).fill(Number.NaN)) } : l)) }), /non-finite/],
    ['inScale length', (j) => ({ ...j, inScale: [1, 1, 1, 1] }), /inScale must be 5 finite numbers/],
    ['step', (j) => ({ ...j, step: 1.5 }), /step must be an integer/],
    ['hash mismatch', (j) => ({ ...j, weightHash: '00000000' }), /does not match the weights/],
    ['tampered weights', (j) => ({ ...j, inOffset: [0, 0, 0, 0, 0.5] }), /does not match the weights/],
  ];
  it.each(cases)('rejects: %s', (_name, mutate, message) => {
    expect(() => parseUpscaleModelJson(mutate(trainedJson()))).toThrow(message);
  });
});

describe('dilated ladder (run 3)', () => {
  it('t24/t16 carry [1, 2, 1] hidden dilations, the last layer 1, and a missing JSON field defaults to 1', () => {
    const m = createUpscaleModel('t16', 'rgbn', 1);
    expect(m.layers.map((l) => l.dilation)).toEqual([1, 2, 1, 1]);
    expect(m.layers.map((l) => [l.inC, l.outC])).toEqual([[7, 16], [16, 16], [16, 16], [16, 16]]);
    const json = serializeUpscaleModel(m);
    expect(json.layers.map((l) => l.dilation)).toEqual([1, 2, 1, 1]);
    expect(parseUpscaleModelJson(json).layers[1]!.dilation).toBe(2);
    // Absent field = the ladder's value (exports before 2026-09-12 have no field); the id decides.
    const legacy = { ...json, layers: json.layers.map(({ dilation: _d, ...rest }) => rest) };
    expect(parseUpscaleModelJson(legacy).layers.map((l) => l.dilation)).toEqual([1, 2, 1, 1]);
    const s8 = serializeUpscaleModel(createUpscaleModel('s8', 'rgb', 1));
    const s8legacy = { ...s8, layers: s8.layers.map(({ dilation: _d, ...rest }) => rest) };
    expect(parseUpscaleModelJson(s8legacy).layers.map((l) => l.dilation)).toEqual([1, 1, 1]);
  });
});

describe('run-4 head', () => {
  it('round-trips through JSON, hashes after the inputs, and rejects a bad head shape', () => {
    const m = createUpscaleModel('s8', 'rgbn', 3, true);
    expect(m.head!.map((l) => [l.inC, l.outC, l.relu])).toEqual([[10, 8, true], [8, 3, false]]);
    expect(Array.from(m.head![1]!.weights).every((v) => v === 0)).toBe(true);
    const json = serializeUpscaleModel(m);
    const back = parseUpscaleModelJson(json);
    expect(back.head!.length).toBe(2);
    expect(back.weightHash).toBe(m.weightHash);
    const noHead = createUpscaleModel('s8', 'rgbn', 3, false);
    expect(noHead.weightHash).not.toBe(m.weightHash);
    expect(() => parseUpscaleModelJson({ ...json, head: json.head!.slice(0, 1) })).toThrow(/head needs 2 layers/);
    expect(() => parseUpscaleModelJson({ ...json, head: json.head!.map((l, k) => (k === 0 ? { ...l, inC: 7 } : l)) })).toThrow(/head layer 0 is 7->8/);
  });
});

describe('run-5 headInputs', () => {
  it('defaults to detail, round-trips detail+refine with a 17-wide first head layer, and rejects a mismatch', () => {
    const m = createUpscaleModel('s8', 'rgbn', 1, true, 'detail+refine');
    expect(m.headInputs).toBe('detail+refine');
    expect(m.head![0]!.inC).toBe(17);
    const json = serializeUpscaleModel(m);
    expect(json.headInputs).toBe('detail+refine');
    const back = parseUpscaleModelJson(json);
    expect(back.headInputs).toBe('detail+refine');
    expect(back.head![0]!.inC).toBe(17);
    expect(() => parseUpscaleModelJson({ ...json, headInputs: 'detail' })).toThrow(/head layer 0 is 17->8, expected 10->8/);
    expect(() => parseUpscaleModelJson({ ...json, headInputs: 'bogus' })).toThrow(/headInputs/);
    expect(createUpscaleModel('s8', 'rgbn', 1, true).headInputs).toBe('detail');
    expect(createUpscaleModel('s8', 'rgbn', 1).headInputs).toBeUndefined();
  });
});
